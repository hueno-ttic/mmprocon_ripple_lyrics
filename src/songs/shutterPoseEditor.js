// ─────────────────────────────────────────────────────────────
// シャッターチャンス: ユーザー向け「ポーズ作成エディタ」
//
// 撮影モードのサブモードとして動作する。ユーザーが選択中の被写体(ミク/リン)の
// ボーンをスライダーで動かして自作ポーズを作り、localStorageへ保存して、
// 「かわいいポーズ」バーから自分のポーズで撮影できるようにする。
//
// 設計方針(2026-06-27 確定):
//  - 編集方式は「かんたん / こだわり」の2モード。editPose は共通、UIだけ切替。
//  - 適用対象は選択中の被写体のみ(モデルIDは持たない)。
//  - 崩れ防止=クランプ強め。関節ごとの可動域(BONE_CLAMP)でスライダー範囲を制限し、
//    腕の体貫通は song 側 clampArmsWorld に委譲する。
//
// 本ファイルにUI/UX(DOM・CSS・操作)を集約し、song-shutter.js 側は薄い
// 統合フック(poseEditing フラグ・getAllCutePoses・refreshPoseBar 等)のみに留める。
// → 後からUI/UXを差し替えても song-shutter.js への波及を最小化する。
//
// 保存フォーマットは SHUTTER_CUTE_POSES と完全同一(正規化ヒューマノイドボーンの
// オイラー回転辞書 + 任意の expr)。上腕zの±0.5補正は lerpSubjectPose 側で行われる
// ため、エディタは「補正前(オーサリング規約)」の値をそのまま編集・保存する。
// ─────────────────────────────────────────────────────────────

import { playerManager } from '../core/player.js';
import { appState } from '../core/appState.js';

export const USER_POSE_STORAGE_KEY = 'shutter_user_poses';

const R = (min, max) => ({ min, max });

// 関節ごとの可動域(ラジアン)。スライダーの min/max になる＝物理的に崩せない上限。
// 「崩れ防止=クランプ強め」方針: 胴・頭・脚は崩れの目立つ部位なのでやや狭め、
// 腕は表現の幅を残しつつ体への貫通は clampArmsWorld(実行時)に委ねる。
const BONE_CLAMP = {
  head:          { x: R(-0.5, 0.5),  y: R(-0.6, 0.6),  z: R(-0.5, 0.5) },
  neck:          { x: R(-0.3, 0.3),  y: R(-0.4, 0.4),  z: R(-0.3, 0.3) },
  spine:         { x: R(-0.25, 0.25), y: R(-0.3, 0.3), z: R(-0.25, 0.25) },
  chest:         { x: R(-0.25, 0.25), y: R(-0.3, 0.3), z: R(-0.25, 0.25) },
  hips:          { x: R(-0.25, 0.25), y: R(-0.35, 0.35), z: R(-0.25, 0.25) },
  leftShoulder:  { x: R(-1.6, 0.6),  y: R(-0.8, 1.0),  z: R(-1.0, 1.0) },
  rightShoulder: { x: R(-1.6, 0.6),  y: R(-1.0, 0.8),  z: R(-1.0, 1.0) },
  leftUpperArm:  { x: R(-2.0, 0.6),  y: R(-1.0, 1.0),  z: R(-2.4, 2.0) },
  rightUpperArm: { x: R(-2.0, 0.6),  y: R(-1.0, 1.0),  z: R(-2.0, 2.4) },
  leftLowerArm:  { x: R(-1.4, 1.4),  y: R(-1.9, 1.9),  z: R(-2.4, 2.4) },
  rightLowerArm: { x: R(-1.4, 1.4),  y: R(-1.9, 1.9),  z: R(-2.4, 2.4) },
  leftHand:      { x: R(-2.2, 2.2),  y: R(-1.2, 1.2),  z: R(-1.2, 1.2) },
  rightHand:     { x: R(-2.2, 2.2),  y: R(-1.2, 1.2),  z: R(-1.2, 1.2) },
  leftUpperLeg:  { x: R(-0.5, 1.2),  y: R(-0.5, 0.5),  z: R(-0.5, 0.5) },
  rightUpperLeg: { x: R(-0.5, 1.2),  y: R(-0.5, 0.5),  z: R(-0.5, 0.5) },
  leftLowerLeg:  { x: R(0, 1.8),     y: R(-0.4, 0.4),  z: R(-0.3, 0.3) },
  rightLowerLeg: { x: R(0, 1.8),     y: R(-0.4, 0.4),  z: R(-0.3, 0.3) },
  leftFoot:      { x: R(-0.5, 0.5),  y: R(-0.5, 0.5),  z: R(-0.3, 0.3) },
  rightFoot:     { x: R(-0.5, 0.5),  y: R(-0.5, 0.5),  z: R(-0.3, 0.3) },
};
const DEFAULT_CLAMP = { x: R(-1.0, 1.0), y: R(-1.0, 1.0), z: R(-1.0, 1.0) };

// 編集開始時の基本姿勢(リラックス立ち)。土台プリセット未選択時の初期値。
// ここに全編集ボーンを列挙しておくことで「リセット」や土台切替時に確実に初期化される。
const BASE_POSE = {
  spine: { x: 0, y: 0, z: 0 }, chest: { x: 0, y: 0, z: 0 }, neck: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 0 },
  hips: { x: 0, y: 0, z: 0 },
  leftShoulder: { x: 0, y: 0, z: 0 }, leftUpperArm: { x: 0, y: 0, z: 1.12 }, leftLowerArm: { x: 0, y: 0.26, z: 0 }, leftHand: { x: 0, y: 0, z: 0 },
  rightShoulder: { x: 0, y: 0, z: 0 }, rightUpperArm: { x: 0, y: 0, z: -1.12 }, rightLowerArm: { x: 0, y: -0.26, z: 0 }, rightHand: { x: 0, y: 0, z: 0 },
  leftUpperLeg: { x: 0, y: 0, z: 0 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 },
  rightUpperLeg: { x: 0, y: 0, z: 0 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 },
};

// かんたんモード: 腕・頭・上半身のみ(初心者/スマホ向け)。
const GROUPS_SIMPLE = [
  { title: 'あたま', bones: [['head', 'あたま'], ['neck', 'くび']] },
  { title: '上半身', bones: [['spine', 'せなか'], ['chest', 'むね']] },
  { title: '左うで', bones: [['leftUpperArm', '左 上腕'], ['leftLowerArm', '左 ひじ']] },
  { title: '右うで', bones: [['rightUpperArm', '右 上腕'], ['rightLowerArm', '右 ひじ']] },
];
// こだわりモード: 全身(肩・手首・脚まで)。
const GROUPS_ADVANCED = [
  { title: 'あたま', bones: [['head', 'あたま'], ['neck', 'くび']] },
  { title: '上半身', bones: [['spine', 'せなか'], ['chest', 'むね'], ['hips', 'こし']] },
  { title: '左うで', bones: [['leftShoulder', '左 かた'], ['leftUpperArm', '左 上腕'], ['leftLowerArm', '左 ひじ'], ['leftHand', '左 手首']] },
  { title: '右うで', bones: [['rightShoulder', '右 かた'], ['rightUpperArm', '右 上腕'], ['rightLowerArm', '右 ひじ'], ['rightHand', '右 手首']] },
  { title: '左あし', bones: [['leftUpperLeg', '左 もも'], ['leftLowerLeg', '左 ひざ'], ['leftFoot', '左 足首']] },
  { title: '右あし', bones: [['rightUpperLeg', '右 もも'], ['rightLowerLeg', '右 ひざ'], ['rightFoot', '右 足首']] },
];

// 表情モーフ(モデルに存在するもののみ採用)。先頭は「なし」。
const EXPR_OPTIONS = [
  ['', 'なし'], ['ウィンク', 'ウィンク'], ['ウィンク右', 'ウィンク(右)'],
  ['笑い', 'にっこり'], ['なごみ', 'なごみ'], ['びっくり', 'びっくり'],
  ['照れ', 'てれ'], ['じゅるり', 'じゅるり'], ['はぅ', 'はぅ'],
];

const AXES = [['x', 'X'], ['y', 'Y'], ['z', 'Z']];

const clampVal = (bone, axis, v) => {
  const c = (BONE_CLAMP[bone] || DEFAULT_CLAMP)[axis] || DEFAULT_CLAMP[axis];
  v = +v;
  if (!isFinite(v)) v = 0;
  return Math.max(c.min, Math.min(c.max, v));
};
const clonePose = (p) => JSON.parse(JSON.stringify(p));
const mergePose = (base, over) => {
  const out = clonePose(base);
  if (!over) return out;
  Object.keys(over).forEach((k) => {
    if (k === 'expr') { out.expr = over.expr; return; }
    out[k] = { x: over[k].x || 0, y: over[k].y || 0, z: over[k].z || 0 };
  });
  return out;
};

// ── localStorage 永続化(SHUTTER_CUTE_POSES と同一スキーマ + user/createdAt) ──
export function loadUserPoses() {
  try {
    const raw = localStorage.getItem(USER_POSE_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((p) => p && p.id && p.pose) : [];
  } catch (e) {
    console.warn('[POSE-EDITOR] ユーザーポーズ読込失敗', e);
    return [];
  }
}
export function saveUserPoses(list) {
  try {
    localStorage.setItem(USER_POSE_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[POSE-EDITOR] ユーザーポーズ保存失敗', e);
  }
}

export class ShutterPoseEditor {
  constructor(song) {
    this.song = song;
    this.editing = false;
    this.mode = 'simple';
    this.editPose = clonePose(BASE_POSE);
    this.panel = null;
    this._exprApplied = null; // 直近に適用した表情モーフ名(切替時に0へ戻す)
    this._styleEl = null;
    // 「かっちり止める」ための差分適用: 変化があった時だけ即時セット＋クランプし、
    // 落ち着いたら凍結して一切触らない(lerp綱引きによるプルプル振動を根絶)。
    this._poseDirty = true;   // 適用が必要か(編集・土台変更・リセット・起動で立てる)
    this._settleClock = 0;    // 変化後の経過秒(一定で凍結)
    this._wasPlaying = false;  // 起動時に再生中だったか(閉じる時に再開するため)
  }

  get isEditing() { return this.editing; }

  // ── 起動/終了 ────────────────────────────────────────────
  open(baseId) {
    if (this.editing) return;
    const song = this.song;
    song.poseOverride = null;            // 進行中のキメポーズを解除
    this._exprApplied = null;
    this.mode = 'simple';
    // 土台プリセットがあれば BASE_POSE に重ねる(未指定ボーンは初期化される)
    let base = clonePose(BASE_POSE);
    if (baseId) {
      const p = (song.getAllCutePoses ? song.getAllCutePoses() : []).find((x) => x.id === baseId);
      if (p) base = mergePose(base, p.pose);
    }
    this.editPose = base;
    this._markDirty();

    song.poseEditing = true;
    this.editing = true;

    // 編集中は楽曲をPauseして被写体をじっくり作れるようにする。
    // 再生ループ(requestAnimationFrame)は止まらないのでライブプレビューは継続する。
    // appState と player.isPlaying がズレていても確実に止まるよう、どちらかが再生中なら pause する
    // （止め損ねると「ポーズを作っている間も曲が進む」＝写真選択が早出しする原因になる）。
    const playing = !!appState.isPlaying ||
      !!(playerManager.player && playerManager.player.isPlaying);
    this._wasPlaying = playing;
    if (playing) { try { playerManager.pause(); } catch (e) { /* noop */ } }

    // 「湖面へ戻る」ボタン・シークバー(プレイヤーUI)をエディタの裏へ隠して誤操作を防ぐ。
    // body クラスでCSS的に display:none。閉じる時にクラスを外せば元の表示へ戻る。
    document.body.classList.add('spe-editing');

    this._injectStyle();
    this._buildPanel();
    // 編集中はポーズバー(かわいいポーズ)を隠す
    const bar = song.viewfinder && song.viewfinder.querySelector('#shutter-pose-bar');
    if (bar) bar.style.display = 'none';
  }

  close() {
    if (!this.editing) return;
    const song = this.song;
    this.editing = false;
    song.poseEditing = false;
    // エディタが直接適用した表情モーフを戻す(通常更新の poseExprApplied 機構の管理外のため)。
    // 「このポーズで撮る」(_shoot)は poseOverride.pose.expr で通常経路が再適用するので消えても問題ない。
    if (this._exprApplied) {
      const shown = song.subjects.find((s) => s.key === song.shownKey);
      const dict = shown && shown.mesh && shown.mesh.morphTargetDictionary;
      const infl = shown && shown.mesh && shown.mesh.morphTargetInfluences;
      if (dict && infl) { const i = dict[this._exprApplied]; if (i !== undefined) infl[i] = 0; }
      this._exprApplied = null;
    }
    if (this.panel && this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
    this.panel = null;
    const bar = song.viewfinder && song.viewfinder.querySelector('#shutter-pose-bar');
    if (bar) bar.style.display = '';

    // プレイヤーUI(戻る・シークバー)を再表示＝再び押せる状態へ戻す
    document.body.classList.remove('spe-editing');

    // 起動時に再生中だったら再開する(「このポーズで撮る」後の撮影には再生が必要)
    if (this._wasPlaying) { try { playerManager.play(); } catch (e) { /* noop */ } }
    this._wasPlaying = false;
  }

  destroy() {
    this.close();
    if (this._styleEl && this._styleEl.parentNode) this._styleEl.parentNode.removeChild(this._styleEl);
    this._styleEl = null;
  }

  // ── 毎フレーム適用(song.update から編集中のみ呼ばれる) ──────────
  // 被写体を中央へ据えてカメラへ正対させ、editPose を反映する。
  // ポーズ本体は「変化があった時だけ即時セット＋クランプ」を行い、少し落ち着いたら凍結する。
  //   - 即時セット(applySubjectPoseImmediate): 毎フレーム同じ editPose から始めるので
  //     clampArmsWorld の結果が決定論的になり、lerp(増分補間)×クランプの綱引きで起きる
  //     プルプル振動が原理的に発生しない。
  //   - 凍結: 変化が収まったら一切ボーンに触らない＝かっちり静止。
  applyToSubject(subject, deltaTime) {
    const song = this.song;
    if (!subject || !subject.mesh) return;

    if (this._poseDirty) {
      song.applySubjectPoseImmediate(subject, this.editPose); // 毎回 editPose から開始＝決定論的
      if (song.clampArmsWorld) song.clampArmsWorld(subject);
      this._settleClock += deltaTime;
      if (this._settleClock > 0.12) this._poseDirty = false;  // 入り後に凍結(以後は不干渉)
    }

    this._applyExpr(subject); // 表情は固定値の代入のみ＝振動しない

    // 中央固定＋カメラ正対(撮影者が周り込んでも正面を維持)。
    // ルート回転はボーンのローカル回転に影響しないため、凍結中でも貫通は再発しない。
    const px = subject.baseX;
    const pz = song.mikuBaseZ;
    subject.mesh.position.set(px, song.mikuBaseY, pz);
    subject.mesh.rotation.set(
      0,
      Math.atan2(song.camera.position.x - px, song.camera.position.z - pz),
      0,
    );
  }

  _applyExpr(subject) {
    const dict = subject.mesh.morphTargetDictionary;
    const infl = subject.mesh.morphTargetInfluences;
    if (!dict || !infl) return;
    const want = (typeof this.editPose.expr === 'string' && this.editPose.expr) ? this.editPose.expr : null;
    if (this._exprApplied && this._exprApplied !== want) {
      const i = dict[this._exprApplied];
      if (i !== undefined) infl[i] = 0;
      this._exprApplied = null;
    }
    if (want) {
      const i = dict[want];
      if (i !== undefined) infl[i] = 1;
      this._exprApplied = want;
    }
  }

  // ── 値の更新 ─────────────────────────────────────────────
  // editPose が変わったら適用を再開させる(凍結→再適用→再凍結)。
  _markDirty() { this._poseDirty = true; this._settleClock = 0; }

  _setBone(bone, axis, value) {
    if (!this.editPose[bone]) this.editPose[bone] = { x: 0, y: 0, z: 0 };
    this.editPose[bone][axis] = clampVal(bone, axis, value);
    this._markDirty();
  }

  // ── DOM 構築(UI/UXはここに集約。後から差し替えやすいよう自己完結) ──
  _buildPanel() {
    const song = this.song;
    if (this.panel && this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
    const panel = document.createElement('div');
    panel.className = 'spe-panel';
    panel.innerHTML = `
      <div class="spe-head">
        <span class="spe-title">ポーズを作る</span>
        <button class="spe-close" title="やめる">×</button>
      </div>
      <div class="spe-modes">
        <button class="spe-mode" data-mode="simple">かんたん</button>
        <button class="spe-mode" data-mode="advanced">こだわり</button>
      </div>
      <div class="spe-tools">
        <label class="spe-tool-label">土台
          <select class="spe-base"></select>
        </label>
        <label class="spe-tool-label">表情
          <select class="spe-expr"></select>
        </label>
        <button class="spe-reset" title="リセット">リセット</button>
      </div>
      <div class="spe-groups"></div>
      <div class="spe-foot">
        <input class="spe-name" type="text" maxlength="12" placeholder="ポーズの名前" />
        <button class="spe-save">保存</button>
        <button class="spe-shoot">このポーズで撮る</button>
      </div>
    `;
    // 編集パネル内の操作は撮影/カメラ首振りへ伝播させない
    ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'click'].forEach((ev) => {
      panel.addEventListener(ev, (e) => e.stopPropagation(), ev === 'touchstart' ? { passive: true } : undefined);
    });

    // 土台プリセット
    const baseSel = panel.querySelector('.spe-base');
    baseSel.innerHTML = '<option value="">なし(立ち)</option>' +
      (song.getAllCutePoses ? song.getAllCutePoses() : [])
        .map((p) => `<option value="${p.id}">${(p.emoji || '⭐')} ${p.label}</option>`).join('');
    baseSel.addEventListener('change', () => {
      let base = clonePose(BASE_POSE);
      const p = (song.getAllCutePoses ? song.getAllCutePoses() : []).find((x) => x.id === baseSel.value);
      if (p) base = mergePose(base, p.pose);
      this.editPose = base;
      this._markDirty();
      this._syncExprSelect();
      this._buildGroups();
    });

    // 表情
    const exprSel = panel.querySelector('.spe-expr');
    exprSel.innerHTML = EXPR_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    exprSel.addEventListener('change', () => {
      this.editPose.expr = exprSel.value || undefined;
    });

    // モード切替
    panel.querySelectorAll('.spe-mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mode = btn.getAttribute('data-mode');
        panel.querySelectorAll('.spe-mode').forEach((b) => b.classList.toggle('active', b === btn));
        this._buildGroups();
      });
    });

    panel.querySelector('.spe-reset').addEventListener('click', () => {
      this.editPose = clonePose(BASE_POSE);
      this._markDirty();
      baseSel.value = '';
      this._syncExprSelect();
      this._buildGroups();
    });
    panel.querySelector('.spe-close').addEventListener('click', () => this.close());
    panel.querySelector('.spe-save').addEventListener('click', () => this._save());
    panel.querySelector('.spe-shoot').addEventListener('click', () => this._shoot());

    song.songWrapper.appendChild(panel);
    this.panel = panel;
    panel.querySelector('.spe-mode[data-mode="simple"]').classList.add('active');
    this._syncExprSelect();
    this._buildGroups();
  }

  _syncExprSelect() {
    if (!this.panel) return;
    const exprSel = this.panel.querySelector('.spe-expr');
    if (exprSel) exprSel.value = (typeof this.editPose.expr === 'string') ? this.editPose.expr : '';
  }

  _buildGroups() {
    if (!this.panel) return;
    const cont = this.panel.querySelector('.spe-groups');
    cont.innerHTML = '';
    const groups = this.mode === 'advanced' ? GROUPS_ADVANCED : GROUPS_SIMPLE;
    groups.forEach((grp, gi) => {
      const det = document.createElement('details');
      det.className = 'spe-grp';
      if (gi < 2) det.open = true; // 上の方は開いておく
      const sum = document.createElement('summary');
      sum.textContent = grp.title;
      det.appendChild(sum);
      grp.bones.forEach(([bone, label]) => {
        if (!this.editPose[bone]) this.editPose[bone] = { x: 0, y: 0, z: 0 };
        const row = document.createElement('div');
        row.className = 'spe-bone';
        const cap = document.createElement('div');
        cap.className = 'spe-bone-cap';
        cap.textContent = label;
        row.appendChild(cap);
        AXES.forEach(([axis, alabel]) => {
          const c = (BONE_CLAMP[bone] || DEFAULT_CLAMP)[axis] || DEFAULT_CLAMP[axis];
          const ax = document.createElement('div');
          ax.className = 'spe-axis';
          const k = document.createElement('span');
          k.className = 'spe-axis-k';
          k.textContent = alabel;
          const range = document.createElement('input');
          range.type = 'range';
          range.min = c.min; range.max = c.max; range.step = 0.01;
          range.value = this.editPose[bone][axis];
          range.addEventListener('input', () => {
            this._setBone(bone, axis, range.value);
            range.value = this.editPose[bone][axis];
          });
          ax.append(k, range);
          row.appendChild(ax);
        });
        det.appendChild(row);
      });
      cont.appendChild(det);
    });
  }

  // ── 保存 / 撮影 ───────────────────────────────────────────
  _exportPose() {
    // editPose をそのまま保存(全編集ボーンを含む完全なポーズ)。
    const pose = clonePose(this.editPose);
    if (typeof pose.expr !== 'string' || !pose.expr) delete pose.expr;
    return pose;
  }

  _save() {
    const song = this.song;
    const nameInput = this.panel.querySelector('.spe-name');
    const list = song.userPoses || [];
    const label = (nameInput.value || '').trim() || `マイポーズ${list.length + 1}`;
    const id = 'user_' + (list.length + 1) + '_' + performance.now().toString(36).replace('.', '');
    const entry = { id, label, emoji: '⭐', user: true, pose: this._exportPose() };
    if (song.saveUserPose) song.saveUserPose(entry);
    if (song.showDanceToast) song.showDanceToast(`「${label}」を保存しました`);
  }

  _shoot() {
    const song = this.song;
    const pose = this._exportPose();
    this.close();
    // 撮影モードへ戻り、作ったポーズを少し長めにホールドして構図を作って撮れるようにする
    song.poseOverride = { pose, until: performance.now() + 9000, id: '__user_draft__', startedAt: performance.now() };
    const shown = song.subjects.find((s) => s.key === song.shownKey);
    if (shown && shown.mesh && shown.mesh.springBoneManager) shown.mesh.springBoneManager.reset();
  }

  // ── スタイル(自己注入。1回のみ) ───────────────────────────
  _injectStyle() {
    if (this._styleEl) return;
    const theme = this.song.themeColor || '#D85A30';
    const el = document.createElement('style');
    el.innerHTML = `
      /* 編集中はプレイヤーUI(湖面へ戻る・再生/シークバー)をエディタの裏へ隠して誤操作を防ぐ */
      body.spe-editing #back-to-lake,
      body.spe-editing #player-controls { display: none !important; }
      /* 音量トグルは画面右端に常設されエディタパネルと重なるため、編集中はパネルの裏へ回す
         (z-index 1200 → 40。.spe-panel の z-index 55 より下=ポーズエディタより下に潜らせる) */
      body.spe-editing .app-volume-control { z-index: 40; }
      .spe-panel {
        position: absolute; top: 0; right: 0; height: 100%; width: min(42%, 340px);
        z-index: 55; box-sizing: border-box; pointer-events: auto;
        background: rgba(10, 5, 4, 0.86); border-left: 1px solid ${theme};
        backdrop-filter: blur(6px); color: #f3ece6;
        font-family: 'Hiragino Sans', sans-serif; font-size: 12px;
        display: flex; flex-direction: column;
      }
      .spe-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 6px; }
      .spe-title { font-weight: 700; letter-spacing: 1px; color: ${theme}; text-shadow: 0 0 8px ${theme}; }
      .spe-close { background: none; border: none; color: #f3ece6; font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px; }
      .spe-modes { display: flex; gap: 6px; padding: 0 12px 8px; }
      .spe-mode { flex: 1; background: rgba(0,0,0,0.4); color: #f3ece6; border: 1px solid rgba(216,90,48,0.5);
        border-radius: 8px; padding: 7px 0; font-size: 12px; cursor: pointer; }
      .spe-mode.active { background: rgba(216,90,48,0.8); border-color: #FFEE11; box-shadow: 0 0 10px rgba(255,238,17,0.5); }
      .spe-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 0 12px 8px; }
      .spe-tool-label { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #cdbfb6; }
      .spe-tools select { background: #1a1410; color: #f3ece6; border: 1px solid #4a3a32; border-radius: 6px; padding: 4px 6px; font-size: 11px; max-width: 110px; }
      .spe-reset { background: rgba(0,0,0,0.4); color: #f3ece6; border: 1px solid rgba(216,90,48,0.5); border-radius: 6px; padding: 5px 9px; font-size: 11px; cursor: pointer; }
      .spe-groups { flex: 1; overflow-y: auto; padding: 0 12px 10px; -webkit-overflow-scrolling: touch; }
      .spe-grp { border: 1px solid rgba(216,90,48,0.3); border-radius: 8px; margin-bottom: 7px; background: rgba(255,255,255,0.03); }
      .spe-grp summary { padding: 7px 9px; font-size: 12px; font-weight: 700; color: #ffd6a8; cursor: pointer; list-style: none; }
      .spe-grp summary::-webkit-details-marker { display: none; }
      .spe-bone { padding: 4px 9px 7px; border-top: 1px solid rgba(255,255,255,0.05); }
      .spe-bone-cap { font-size: 11px; color: #cdbfb6; margin: 3px 0; }
      .spe-axis { display: flex; align-items: center; gap: 7px; padding: 2px 0; }
      .spe-axis-k { width: 12px; color: #8d9; font-size: 10px; }
      .spe-axis input[type=range] { flex: 1; accent-color: ${theme}; }
      .spe-foot { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-top: 1px solid rgba(216,90,48,0.3); flex-wrap: wrap; }
      .spe-name { flex: 1 1 100px; min-width: 80px; background: #1a1410; color: #f3ece6; border: 1px solid #4a3a32; border-radius: 6px; padding: 6px 8px; font-size: 12px; }
      .spe-save { background: rgba(0,0,0,0.4); color: #f3ece6; border: 1px solid rgba(216,90,48,0.6); border-radius: 7px; padding: 7px 11px; font-size: 12px; cursor: pointer; }
      .spe-shoot { background: rgba(216,90,48,0.85); color: #fff; border: 1px solid #FFEE11; border-radius: 7px; padding: 7px 11px; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 0 12px rgba(255,238,17,0.5); }
      @media (max-width: 767px) {
        .spe-panel { width: min(56%, 320px); font-size: 11px; }
        .spe-tools select { max-width: 92px; }
      }
    `;
    document.head.appendChild(el);
    this._styleEl = el;
  }
}
