import * as THREE from 'three';
import { sfx } from '../core/sfx.js';
import { quality } from '../core/quality.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { groupPhraseWordsByMinLength, findGroupForWord } from '../utils/lyricGroups.js';

export class SongTakeover extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.debris = [];

        // AES-256-GCM key (generated once per scene, non-extractable)
        this._cryptoKey = null;
        this._cryptoReady = false;

        this.phraseTargets = [];
        this.lastPhraseStart = -1;
        this.lastGroupStartTime = -1;
        this.takenCount = 0;
        this.totalCount = 0;

        this.isClimax = false;
        this.prevIsClimax = false;

        this.scoreEl = null;

        this._debrisEdgesGeo = null;
        this._debrisMat = null;
        this.cardMargin = 0; // no extra margin for decoded tiles
        this.allGroups = [];
        this.bgTiles = {};
        this.lyricCardBuilt = false; // 歌詞カード構築済みフラグ（update内で遅延構築・成功時にtrue）

        // ── 侵食 / コンボ / TAKEOVER COMPLETE 用の状態 ──
        this.combo = 0;                  // 現在の連続解読数
        this.maxCombo = 0;               // 最大コンボ（成果サマリー用）
        this._lastDecodeAt = 0;          // 直前の解読時刻 (performance.now)
        this._comboHideTimer = null;     // コンボ表示の自動消灯タイマー
        this.comboEl = null;
        this.erosionEl = null;           // 赤侵食オーバーレイ
        this._erosionStage = 0;          // 0〜4 の侵食段階（CSSクラス切替）
        this._completeFired = false;     // TAKEOVER COMPLETE は一度だけ
        this._completeLeadMs = 8000;     // 曲終わりの何ms前に完走演出を起動するか
        this._rebootTimers = [];         // 再起動シーケンスのタイマー群
        this.rebootEl = null;
        // 奪還カラー補間用（シーン背景: 敵に支配された赤 → 奪還したシアン）
        this._bgColorFrom = new THREE.Color(0x2a0008);
        this._bgColorTo = new THREE.Color(0x001712);

        // ── 陣取り（緑の制圧領域 vs 赤の侵食）リアルタイムモデル ──
        // 旧実装は takenCount/totalCount の単調増加で侵食率が決まる静的モデルだった。
        // ここでは「制圧率 greenCoverage(0〜1)」を主指標にし、タップで広げ・無操作で
        // じわじわ赤に押し戻される綱引きにする。曲終わりに 0.5 以上なら CLEAR。
        this.greenCoverage = 0.12;       // 開幕は赤優勢（敵に支配された状態）
        this.territoryEl = null;         // 緑（奪還）領域オーバーレイ（下からせり上がる）
        this._lastFrameAt = 0;           // 制圧率の時間減衰用 dt 計測（performance.now）
        this._lastSummaryAt = 0;         // 成果サマリー更新の間引き用
        this._outcome = null;            // 'clear' | 'failed'（終局演出の分岐）
        // チューニング（実機で踊らせて調整しやすいよう定数化）
        this._coverageGainBase = 0.075;     // 1解読あたりの制圧獲得
        this._coverageGainClimax = 0.055;   // サビは的が多いので一手の重みを下げる
        this._coverageComboBonus = 0.02;    // コンボ中の上乗せ
        this._coverageDecayBase = 0.020;    // 無操作時の毎秒減衰（赤の再侵食）
        this._coverageDecayClimax = 0.034;  // サビは侵食が速い＝疾走感
        this._clearThreshold = 0.5;         // 画面の半分以上が緑なら CLEAR

        // ── スタート時の WARNING 警告演出 ──
        this.warningEl = null;
        this._warningShown = false;      // WARNING は一度だけ（カーテンが開く瞬間に出す）
        this._introTimers = [];          // WARNING のタイマー群

        // ── ミクの視覚アンカー（軽量ツインテール・シルエット） ──
        // 他5曲はVRMミクが登場するが、TAKEOVERだけ不在で密度差が出るため、
        // 中央に「ミクがそこにいる」象徴を1つだけ常設し、リズムで淡く脈動させる。
        this.mikuAnchorSprite = null;       // CanvasTextureのスプライト
        this.mikuAnchorTexture = null;
        this.mikuAnchorMat = null;
        this._mikuAnchorPhase = 0;          // 脈動位相
        this._mikuColorCyan = new THREE.Color(0x00ffaa); // 解読色（シアン）
        this._mikuColorRed = new THREE.Color(0xff3a3a);  // 侵食色（赤）
        this._mikuAnchorColor = new THREE.Color(0x00ffaa);
        this._mikuTakeRatio = 0;            // 直近の解読率（脈動の色補間に使用）
        // ── 完走演出: 歌詞爆散 → シアン逆転 → ミク実体化 ──
        this._mikuReclaim = false;          // 完走時にtrue: アンカーをヒーロー化（シアン固定）
        this._reclaimT = 0;                 // 実体化ランプ進捗 0→1
        this.mikuGlowSprite = null;         // 背後のシアン逆光グロー
        this.mikuGlowMat = null;
        this.mikuGlowTexture = null;

        this.boundOnResize = this.onResize.bind(this);
    }

    init() {
        this.initThree();
        this.initDebris();
        this.initMikuAnchor();
        this.initUI();
        this._initCrypto(); // async, completes well before first phrase
        window.addEventListener('resize', this.boundOnResize);
        this.isActive = true;

        // 歌詞カードの構築は update() 内で遅延実行する（buildLyricCard が
        // isTimerReady と video.firstPhrase の両方が揃うまで毎フレーム再試行）。
        // 旧実装は init 時に player.video の「存在」だけを見て一度だけ構築して
        // いたため、video はあってもフレーズ未ロード／前曲の stale video の瞬間に
        // 空のまま固定され、歌詞が一切出ないことがあった（ステージ選択へ戻って
        // 入り直すと表示される、という症状の原因）。
        super.init();

        // 初回誘導: 最初に出現した暗号ブロック(scrambled状態)の実位置にガイドを重ねる
        // (共通機構)。初回の復号成功で _revealTarget() 側が dismiss する。
        this.highlightFirstInteractable(() => {
            if (this.takenCount > 0) return null;
            const target = this.phraseTargets.find(t => t && t.state === 'scrambled' && t.el);
            if (!target) return null;
            const r = target.el.getBoundingClientRect();
            if (!r.width && !r.height) return null;
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, { label: 'タップして復号' });

        // ※ WARNING は init では出さない。ここで出すと選曲→曲ロードのカーテン裏で
        //   2.4秒が経過し、幕が開く頃には消えてしまう。実際にシーンが公開される
        //   タイミング（タイマー準備完了）で update() 側から一度だけ起動する。
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2a0008);
        this.scene.fog = new THREE.FogExp2(0x2a0008, 0.018);

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
        this.camera.position.set(0, 0, 10);

        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;z-index:1;';
        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initDebris() {
        const tmp = new THREE.TetrahedronGeometry(0.7, 0);
        this._debrisEdgesGeo = new THREE.EdgesGeometry(tmp);
        tmp.dispose();
        this._debrisMat = new THREE.LineBasicMaterial({ color: 0x8c1430, transparent: true, opacity: 0.55 });

        for (let i = 0; i < 18; i++) {
            const m = new THREE.LineSegments(this._debrisEdgesGeo, this._debrisMat);
            m.position.set((Math.random()-0.5)*45, (Math.random()-0.5)*28, -8 - Math.random()*32);
            m.rotation.set(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
            // 疾走感: 回転を速め＋カメラ手前へ流れる前進速度を持たせる
            m.userData.rot = new THREE.Vector3(
                (Math.random()-0.5)*0.018, (Math.random()-0.5)*0.018, (Math.random()-0.5)*0.018
            );
            m.userData.vz = 0.05 + Math.random()*0.09; // 奥→手前へ流れる速度
            this.scene.add(m);
            this.debris.push(m);
        }
    }

    // ── ミクの視覚アンカー: ツインテール風シルエットを canvas で描画し、
    //    中央奥に常設する軽量スプライト（VRM不使用で密度差を埋める） ──
    initMikuAnchor() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const cx = size / 2;

        // 白でシルエットを塗り、色付けはスプライトのcolorで行う（=色補間が軽い）
        ctx.fillStyle = 'rgba(255,255,255,1)';

        // 頭部
        ctx.beginPath();
        ctx.arc(cx, 96, 34, 0, Math.PI * 2);
        ctx.fill();

        // 肩〜体（台形）
        ctx.beginPath();
        ctx.moveTo(cx - 30, 124);
        ctx.lineTo(cx + 30, 124);
        ctx.lineTo(cx + 50, 220);
        ctx.lineTo(cx - 50, 220);
        ctx.closePath();
        ctx.fill();

        // 左右のツインテール（頭の左右から外へ大きく流れる曲線シルエット）
        const tail = (dir) => {
            ctx.beginPath();
            ctx.moveTo(cx + dir * 26, 80);
            ctx.quadraticCurveTo(cx + dir * 96, 96, cx + dir * 86, 188);
            ctx.quadraticCurveTo(cx + dir * 80, 224, cx + dir * 58, 220);
            ctx.quadraticCurveTo(cx + dir * 70, 150, cx + dir * 22, 104);
            ctx.closePath();
            ctx.fill();
        };
        tail(-1);
        tail(1);

        this.mikuAnchorTexture = new THREE.CanvasTexture(canvas);

        this.mikuAnchorMat = new THREE.SpriteMaterial({
            map: this.mikuAnchorTexture,
            color: this._mikuColorCyan.clone(),
            transparent: true,
            opacity: 0.16,                 // 主張しすぎない淡い存在感
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.mikuAnchorSprite = new THREE.Sprite(this.mikuAnchorMat);
        this.mikuAnchorSprite.scale.set(7, 7, 1);
        // 画面中央付近・デブリ層より少し手前の奥行き
        this.mikuAnchorSprite.position.set(0, 0.5, -4);
        this.scene.add(this.mikuAnchorSprite);

        // 背後のシアン逆光グロー（完走の実体化でだけ点灯。普段は不可視）
        const gsize = 256;
        const gcanvas = document.createElement('canvas');
        gcanvas.width = gsize;
        gcanvas.height = gsize;
        const gctx = gcanvas.getContext('2d');
        const grad = gctx.createRadialGradient(gsize / 2, gsize / 2, 0, gsize / 2, gsize / 2, gsize / 2);
        grad.addColorStop(0, 'rgba(0,255,170,0.9)');
        grad.addColorStop(0.4, 'rgba(0,255,170,0.35)');
        grad.addColorStop(1, 'rgba(0,255,170,0)');
        gctx.fillStyle = grad;
        gctx.fillRect(0, 0, gsize, gsize);

        this.mikuGlowTexture = new THREE.CanvasTexture(gcanvas);
        this.mikuGlowMat = new THREE.SpriteMaterial({
            map: this.mikuGlowTexture,
            color: this._mikuColorCyan.clone(),
            transparent: true,
            opacity: 0,                    // 完走まで消灯
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        this.mikuGlowSprite = new THREE.Sprite(this.mikuGlowMat);
        this.mikuGlowSprite.scale.set(7, 7, 1);
        this.mikuGlowSprite.position.set(0, 0.5, -4.2); // シルエットより少し奥
        this.scene.add(this.mikuGlowSprite);
    }

    initUI() {
        if (!document.getElementById('takeover-style')) {
            const style = document.createElement('style');
            style.id = 'takeover-style';
            style.textContent = `
                @keyframes toScramblePulse {
                    0%,100% { opacity:0.45; }
                    50%      { opacity:1;    }
                }
                @keyframes toDecodeFlash {
                    0%   { text-shadow:0 0 30px #00ffaa, 0 0 60px #00ffaa; letter-spacing:10px; }
                    100% { text-shadow:0 0 12px #00ffaa; letter-spacing:2px; }
                }
                @keyframes toFadeOut {
                    to { opacity:0; transform:translateY(-24px); }
                }
                .to-phrase {
                    position:absolute;
                    font-family:"Courier New",monospace;
                    font-weight:bold;
                    text-align:left;
                    padding:12px 28px;
                    background:#05000a; /* Solid black/purple background, no transparency */
                    border:1px solid rgba(255, 58, 58, 0.3);
                    letter-spacing:2px;
                    pointer-events:auto;
                    user-select:none;
                    white-space:nowrap;
                    z-index:15;
                    transition:all 0.15s cubic-bezier(0.25, 0.8, 0.25, 1);
                    font-size: var(--to-font-size, 14px);
                    border-radius: 6px;
                }
                @media (max-width: 768px) {
                    .to-phrase {
                        font-size: calc(var(--to-font-size, 14px) * 0.9) !important;
                        padding: 10px 20px; /* Easy-to-tap large padding on mobile */
                    }
                }
                /* 暗号化された歌詞 = 赤(敵に支配されたロック状態) */
                .to-phrase.scrambled {
                    color:#ff3a3a;
                    cursor:pointer;
                    border-color: rgba(255, 58, 58, 0.6);
                    text-shadow: 0 0 8px rgba(255, 58, 58, 0.6);
                    box-shadow: 0 0 12px rgba(255, 58, 58, 0.2), inset 0 0 8px rgba(255, 58, 58, 0.1);
                    animation:toScramblePulse .75s ease-in-out infinite;
                }
                .to-phrase.scrambled:hover {
                    color:#ffffff;
                    border-color:#ff3a3a;
                    box-shadow: 0 0 25px rgba(255, 58, 58, 0.8), inset 0 0 12px rgba(255, 58, 58, 0.3);
                    text-shadow: 0 0 12px #ff3a3a;
                    transform: scale(1.06);
                }
                .to-phrase.scrambled:active {
                    transform: scale(0.95);
                    box-shadow: 0 0 10px rgba(255, 58, 58, 0.5);
                }
                /* 解読された歌詞 = 緑(奪還) */
                .to-phrase.decoded {
                    color:#00ffaa;
                    border-color:#00ffaa;
                    cursor:default;
                    pointer-events:none;
                    animation:toDecodeFlash .35s ease-out forwards;
                }
                .to-phrase.expired {
                    pointer-events:none;
                    animation:toFadeOut .4s ease-out forwards;
                }
                .to-hint {
                    font-size:10px;
                    color:#333;
                    letter-spacing:3px;
                    margin-top:5px;
                    text-align:center;
                }
                @keyframes toMonitorFlicker {
                    0%, 100% { opacity: 0.99; }
                    50% { opacity: 0.96; }
                }
                .to-monitor {
                    position: absolute;
                    top: 12%;
                    left: 5%;
                    width: 90%;
                    height: 72%;
                    background: radial-gradient(circle, rgba(24, 3, 8, 0.88) 0%, rgba(8, 0, 2, 0.96) 100%);
                    border: 2px solid #8c1430;
                    border-radius: 8px;
                    box-shadow:
                        0 0 25px rgba(180, 24, 48, 0.55),
                        inset 0 0 40px rgba(150, 20, 48, 0.45);
                    z-index: 5;
                    pointer-events: none;
                    overflow: hidden;
                    animation: toMonitorFlicker 0.15s infinite;
                }
                .to-monitor-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    background: rgba(140, 16, 40, 0.16);
                    border-bottom: 1px solid rgba(160, 24, 48, 0.3);
                    font-family: "Courier New", monospace;
                    font-size: 11px;
                    color: #d05068;
                    letter-spacing: 1px;
                }
                .to-monitor-dot {
                    display: inline-block;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                }
                .to-monitor-dot.red { background: #ff5f56; }
                .to-monitor-dot.yellow { background: #ffbd2e; }
                .to-monitor-dot.green { background: #27c93f; }
                .to-monitor-title {
                    margin-left: 10px;
                    font-weight: bold;
                }
                .to-monitor-scanlines {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(
                        rgba(18, 10, 36, 0) 50%, 
                        rgba(0, 0, 0, 0.25) 50%
                    );
                    background-size: 100% 4px;
                    z-index: 2;
                    pointer-events: none;
                }
                .to-monitor-grid {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-image:
                        linear-gradient(rgba(180, 30, 46, 0.05) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(180, 30, 46, 0.05) 1px, transparent 1px);
                    background-size: 40px 40px;
                    background-position: center;
                    z-index: 1;
                    pointer-events: none;
                }
                .to-monitor-footer {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 16px;
                    background: rgba(140, 16, 40, 0.08);
                    border-top: 1px solid rgba(160, 24, 48, 0.2);
                    font-family: "Courier New", monospace;
                    font-size: 10px;
                    color: rgba(208, 80, 104, 0.7);
                    letter-spacing: 1px;
                    z-index: 3;
                }
                .to-monitor-status {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .to-monitor-status::before {
                    content: "";
                    display: inline-block;
                    width: 6px;
                    height: 6px;
                    background: #ff3a3a;
                    border-radius: 50%;
                    box-shadow: 0 0 8px #ff3a3a;
                }
                @media (max-width: 768px) {
                    .to-monitor-header {
                        padding: 6px 12px;
                        font-size: 9px;
                    }
                    .to-monitor-footer {
                        padding: 6px 12px;
                        font-size: 8px;
                    }
                }

                /* ── 陣取りオーバーレイ: 上から赤(敵)、下から緑(奪還)がせめぎ合う ── */
                /* 高さは JS が制圧率(greenCoverage)から毎フレーム制御する。 */
                .to-erosion-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 50%;   /* JSが (1 - greenCoverage) を反映 */
                    /* 境界(下端=0%)を濃い赤にして、緑が引いた帯が即・赤に戻るようにする。
                       上端へ向けては少しだけ薄める（敵領域は一様に赤い印象）。 */
                    background:
                        linear-gradient(to top,
                            rgba(255, 48, 54, 0.50) 0%,
                            rgba(190, 26, 44, 0.36) 55%,
                            rgba(255, 58, 58, 0.42) 100%);
                    border-bottom: 2px solid rgba(255, 64, 64, 0.92);
                    /* グローは境界を越えないよう内向き(inset)。赤領域の中だけを光らせる。 */
                    box-shadow: inset 0 -12px 24px rgba(255, 58, 58, 0.40);
                    mix-blend-mode: screen;
                    transition: height 0.22s linear;
                    pointer-events: none;
                    z-index: 6;
                }
                .to-territory-overlay {
                    position: absolute;
                    bottom: 0; left: 0;
                    width: 100%; height: 12%;   /* JSが greenCoverage を反映 */
                    /* 境界(上端=0%)を濃い緑に。グローは内向きで境界をまたいで滲ませない。 */
                    background:
                        linear-gradient(to bottom,
                            rgba(0, 255, 170, 0.50) 0%,
                            rgba(0, 210, 142, 0.32) 55%,
                            rgba(0, 255, 170, 0.46) 100%);
                    border-top: 2px solid rgba(0, 255, 170, 0.92);
                    box-shadow: inset 0 12px 26px rgba(0, 255, 170, 0.40);
                    mix-blend-mode: screen;
                    transition: height 0.22s linear, filter 0.4s ease;
                    pointer-events: none;
                    z-index: 6;
                }
                @keyframes toTerritoryPulse {
                    0%   { filter: brightness(2.4) saturate(1.5); }
                    100% { filter: brightness(1)   saturate(1);   }
                }
                .to-territory-overlay.pulse { animation: toTerritoryPulse 0.45s ease-out; }
                /* ── 奪還段階: ターミナル枠・ヘッダ・走査線が 赤(敵) → 緑(奪還) へ ── */
                .to-erode-1 .to-monitor { border-color: #b0562a; box-shadow: 0 0 25px rgba(190, 100, 40, 0.5), inset 0 0 40px rgba(170, 90, 40, 0.4); }
                .to-erode-1 .to-monitor-header { color: #e08a4a; border-bottom-color: rgba(190, 100, 40, 0.4); background: rgba(150, 80, 30, 0.16); }
                .to-erode-1 .to-monitor-status::before { background: #ff8a3a; box-shadow: 0 0 8px #ff8a3a; }
                .to-erode-2 .to-monitor { border-color: #8a9a2a; box-shadow: 0 0 28px rgba(150, 180, 50, 0.5), inset 0 0 45px rgba(130, 160, 50, 0.42); }
                .to-erode-2 .to-monitor-header { color: #c0d050; border-bottom-color: rgba(150, 180, 50, 0.4); background: rgba(110, 130, 30, 0.16); }
                .to-erode-2 .to-monitor-status::before { background: #d0e030; box-shadow: 0 0 8px #d0e030; }
                .to-erode-3 .to-monitor { border-color: #1c9e7e; box-shadow: 0 0 34px rgba(0, 255, 170, 0.5), inset 0 0 55px rgba(0, 200, 140, 0.42); }
                .to-erode-3 .to-monitor-header { color: #80ffd0; border-bottom-color: rgba(0, 255, 170, 0.4); background: rgba(0, 130, 90, 0.18); }
                .to-erode-3 .to-monitor-footer { color: rgba(128, 255, 208, 0.8); border-top-color: rgba(0, 255, 170, 0.3); background: rgba(0, 130, 90, 0.1); }
                .to-erode-3 .to-monitor-grid {
                    background-image:
                        linear-gradient(rgba(0, 255, 170, 0.07) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0, 255, 170, 0.07) 1px, transparent 1px);
                }
                .to-erode-3 .to-monitor-status::before { background: #00ffaa; box-shadow: 0 0 8px #00ffaa; }
                /* 100%: 世界が完全に赤一色 */
                .to-complete .to-monitor { border-color: #ff3a3a; box-shadow: 0 0 50px rgba(255, 58, 58, 0.8), inset 0 0 70px rgba(255, 58, 58, 0.45); }
                .to-complete .to-monitor-header { color: #ffb0b0; border-bottom-color: rgba(255, 58, 58, 0.6); background: rgba(255, 58, 58, 0.22); }
                .to-complete .to-monitor-footer { color: #ff9090; border-top-color: rgba(255, 58, 58, 0.5); background: rgba(255, 58, 58, 0.14); }
                .to-complete .to-monitor-status::before { background: #ff3a3a; box-shadow: 0 0 10px #ff3a3a; }
                .to-complete .to-monitor-dot.green,
                .to-complete .to-monitor-dot.yellow { background: #ff3a3a; }
                .to-complete .to-phrase.scrambled {
                    color: #ff8a8a;
                    border-color: rgba(255, 58, 58, 0.7);
                    text-shadow: 0 0 8px rgba(255, 58, 58, 0.7);
                    box-shadow: 0 0 12px rgba(255, 58, 58, 0.3), inset 0 0 8px rgba(255, 58, 58, 0.15);
                }
                /* 100%奪還: 世界がミクのシアンへ塗り替わる */
                .to-reclaim .to-monitor { border-color: #00ffaa; box-shadow: 0 0 50px rgba(0, 255, 170, 0.7), inset 0 0 70px rgba(0, 255, 170, 0.4); }
                .to-reclaim .to-monitor-header { color: #b0ffe6; border-bottom-color: rgba(0, 255, 170, 0.6); background: rgba(0, 255, 170, 0.18); }
                .to-reclaim .to-monitor-footer { color: #90ffd8; border-top-color: rgba(0, 255, 170, 0.5); background: rgba(0, 255, 170, 0.12); }
                .to-reclaim .to-monitor-status::before { background: #00ffaa; box-shadow: 0 0 10px #00ffaa; }
                .to-reclaim .to-monitor-dot.green,
                .to-reclaim .to-monitor-dot.yellow { background: #00ffaa; }
                .to-reclaim .to-monitor-grid {
                    background-image:
                        linear-gradient(rgba(0, 255, 170, 0.07) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0, 255, 170, 0.07) 1px, transparent 1px);
                }
                /* ── コンボ表示 ── */
                @keyframes toComboPop {
                    0%   { transform: translateX(-50%) scale(1.6); opacity: 0; }
                    35%  { transform: translateX(-50%) scale(1.0); opacity: 1; }
                    100% { transform: translateX(-50%) scale(1.0); opacity: 1; }
                }
                .to-combo {
                    position: absolute;
                    top: 40px;
                    left: 50%;
                    transform: translateX(-50%);
                    font-family: "Courier New", monospace;
                    font-size: 18px;
                    font-weight: bold;
                    letter-spacing: 5px;
                    color: #00ffaa;
                    text-shadow: 0 0 14px #00ffaa, 0 0 30px #00ffaa88;
                    pointer-events: none;
                    z-index: 21;
                    display: none;
                }
                .to-combo.show {
                    display: block;
                    animation: toComboPop 0.3s ease-out;
                }
                @media (max-width: 768px) {
                    .to-combo { font-size: 14px; top: 36px; letter-spacing: 3px; }
                }
                /* コンボ中の解読エフェクト強化 */
                @keyframes toComboDecodeFlash {
                    0%   { text-shadow: 0 0 45px #00ffaa, 0 0 90px #00ffaa, 0 0 120px #ffffff; letter-spacing: 14px; }
                    100% { text-shadow: 0 0 16px #00ffaa; letter-spacing: 2px; }
                }
                .to-phrase.decoded.to-combo-boost {
                    animation: toComboDecodeFlash 0.45s ease-out forwards;
                    box-shadow: 0 0 35px rgba(0, 255, 170, 0.9), inset 0 0 14px rgba(0, 255, 170, 0.4);
                }
                /* ── TAKEOVER COMPLETE: ブラックアウト→再起動シーケンス ── */
                .to-reboot-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    background: #000;
                    z-index: 60;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    pointer-events: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .to-reboot-overlay.on { opacity: 1; }
                .to-reboot-overlay.off { opacity: 0; transition: opacity 1.2s ease; }
                .to-reboot-lines {
                    font-family: "Courier New", monospace;
                    font-size: 15px;
                    color: #ff3a3a;
                    letter-spacing: 2px;
                    text-shadow: 0 0 10px #ff3a3a;
                    line-height: 2.1;
                    text-align: left;
                }
                @media (max-width: 768px) {
                    .to-reboot-lines { font-size: 11px; letter-spacing: 1px; padding: 0 14px; }
                }
                @keyframes toCursorBlink {
                    0%, 49% { opacity: 1; }
                    50%, 100% { opacity: 0; }
                }
                .to-reboot-line {
                    opacity: 0;
                    transform: translateY(4px);
                    transition: opacity 0.18s ease, transform 0.18s ease;
                }
                .to-reboot-line.shown { opacity: 1; transform: none; }
                .to-reboot-line.final {
                    font-size: 1.5em;
                    font-weight: bold;
                    letter-spacing: 6px;
                    margin-top: 10px;
                    text-shadow: 0 0 20px #ff3a3a, 0 0 50px #ff3a3a;
                }
                .to-reboot-line.shown::after {
                    content: "█";
                    margin-left: 4px;
                    animation: toCursorBlink 0.7s step-end infinite;
                }
                .to-reboot-line.shown:not(:last-child)::after { content: none; }
                /* 奪還版: ログをシアンに */
                .to-reboot-overlay.reclaim .to-reboot-lines { color: #00ffaa; text-shadow: 0 0 10px #00ffaa; }
                .to-reboot-overlay.reclaim .to-reboot-line.final { text-shadow: 0 0 20px #00ffaa, 0 0 50px #00ffaa; }
                /* 失敗版: ログは赤のまま、FAILED を強く光らせる */
                .to-reboot-overlay.failed .to-reboot-line.final {
                    color: #ff2a2a;
                    text-shadow: 0 0 20px #ff2a2a, 0 0 55px #ff2a2a;
                    animation: toWarnShake 0.32s steps(2) 3;
                }

                /* ── スタート時 WARNING（システム侵略アラート） ── */
                @keyframes toWarnFlash {
                    0%, 100% { opacity: 1; }
                    50%      { opacity: 0.45; }
                }
                @keyframes toWarnShake {
                    0%   { transform: translate(-50%, -50%) translate(0, 0); }
                    25%  { transform: translate(-50%, -50%) translate(-3px, 2px); }
                    50%  { transform: translate(-50%, -50%) translate(3px, -2px); }
                    75%  { transform: translate(-50%, -50%) translate(-2px, -3px); }
                    100% { transform: translate(-50%, -50%) translate(0, 0); }
                }
                @keyframes toWarnStripes {
                    0%   { background-position: 0 0; }
                    100% { background-position: 56px 0; }
                }
                .to-warning-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    z-index: 70;
                    pointer-events: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background:
                        repeating-linear-gradient(45deg,
                            rgba(255, 40, 40, 0.14) 0px, rgba(255, 40, 40, 0.14) 20px,
                            rgba(0, 0, 0, 0) 20px, rgba(0, 0, 0, 0) 40px),
                        radial-gradient(circle at 50% 50%, rgba(120, 0, 0, 0.5) 0%, rgba(20, 0, 0, 0.85) 100%);
                    animation: toWarnStripes 0.6s linear infinite, toWarnFlash 0.5s steps(2) infinite;
                    transition: opacity 0.5s ease;
                }
                .to-warning-overlay.out { opacity: 0; }
                .to-warning-core {
                    position: absolute;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    text-align: center;
                    font-family: "Courier New", monospace;
                    animation: toWarnShake 0.3s steps(2) infinite;
                }
                .to-warning-title {
                    font-size: clamp(34px, 11vw, 92px);
                    font-weight: bold;
                    letter-spacing: 10px;
                    color: #ff2a2a;
                    text-shadow: 0 0 18px #ff2a2a, 0 0 44px #ff0000, 4px 0 0 #00e0ff, -4px 0 0 #ff00a0;
                }
                .to-warning-sub {
                    margin-top: 14px;
                    font-size: clamp(11px, 3.4vw, 18px);
                    letter-spacing: 5px;
                    color: #ffd0d0;
                    text-shadow: 0 0 10px #ff3a3a;
                }
                .to-warning-bar {
                    margin-top: 10px;
                    font-size: clamp(9px, 2.6vw, 13px);
                    letter-spacing: 3px;
                    color: #ff7070;
                }
                @media (max-width: 768px) {
                    .to-warning-title { letter-spacing: 6px; }
                    .to-warning-sub { letter-spacing: 3px; }
                }
            `;
            document.head.appendChild(style);
        }

        this.bgContainer = document.createElement('div');
        this.bgContainer.className = 'to-bg-container';
        this.songWrapper.appendChild(this.bgContainer);

        // Reset card grid layout variables for fresh start
        this.allGroups = [];
        this.bgTiles = {};
        this.monitorEl = document.createElement('div');
        this.monitorEl.className = 'to-monitor';
        this.monitorEl.innerHTML = `
            <div class="to-monitor-header">
                <span class="to-monitor-dot red"></span>
                <span class="to-monitor-dot yellow"></span>
                <span class="to-monitor-dot green"></span>
                <span class="to-monitor-title">DECRYPTION_TERMINAL://SECURE_SESSION</span>
            </div>
            <div class="to-monitor-grid"></div>
            <div class="to-monitor-scanlines"></div>
            <div class="to-monitor-footer">
                <span>PORT: 5174 | AES-256-GCM</span>
                <span class="to-monitor-status">CONNECTION: SECURE</span>
            </div>
        `;
        this.songWrapper.appendChild(this.monitorEl);

        // 上から押し寄せる赤(敵)領域。高さ=制圧率の裏返し(1 - greenCoverage)。
        this.erosionEl = document.createElement('div');
        this.erosionEl.className = 'to-erosion-overlay';
        this.songWrapper.appendChild(this.erosionEl);

        // 下からせり上がる緑(奪還)領域。高さ=greenCoverage。タップで広がる。
        this.territoryEl = document.createElement('div');
        this.territoryEl.className = 'to-territory-overlay';
        this.songWrapper.appendChild(this.territoryEl);

        // コンボ表示
        this.comboEl = document.createElement('div');
        this.comboEl.className = 'to-combo';
        this.songWrapper.appendChild(this.comboEl);

        this.scoreEl = document.createElement('div');
        Object.assign(this.scoreEl.style, {
            position:'absolute', top:'14px', left:'50%',
            transform:'translateX(-50%)',
            fontFamily:'"Courier New",monospace',
            fontSize:'15px', fontWeight:'bold',
            letterSpacing:'4px', color:'#cc2244',
            textShadow:'0 0 12px #ff3a3a, 0 0 24px #ff3a3a88',
            pointerEvents:'none', zIndex:'20'
        });
        this.songWrapper.appendChild(this.scoreEl);
        this.updateScore();
    }

    updateScore() {
        // 主指標は制圧率(greenCoverage)。陣取りオーバーレイとゲージを同期する。
        this._applyTerritory();
        this._updateGauge();
    }

    // ── ゲージ表示: 制圧率(%)を上部に表示し、終了サマリーも更新する ────────
    _updateGauge() {
        if (!this.scoreEl) return;
        const cov = this.greenCoverage;
        const pct = Math.round(cov * 100);
        this.scoreEl.textContent = `RECLAIMED AREA: ${pct}%`;
        // 制圧率に応じて 赤(敵) → 緑(奪還) へ
        const cr = Math.round(255 - cov * 235);
        const cg = Math.round(40 + cov * 215);
        const cb = Math.round(40 + cov * 120);
        const shadow = cov < this._clearThreshold ? '#ff3a3a' : '#00ffaa';
        this.scoreEl.style.color = `rgb(${cr},${cg},${cb})`;
        this.scoreEl.style.textShadow = `0 0 ${5 + cov*18}px ${shadow}`;

        // 成果サマリー（曲終了オーバーレイ用、終局演出が出るまで何度でも上書き可）
        // 減衰で毎フレーム呼ばれるため ~250ms に間引く。
        if (!this._completeFired) {
            const now = performance.now();
            if (now - this._lastSummaryAt > 250) {
                this._lastSummaryAt = now;
                this.setResultSummary({
                    lines: [`制圧率 ${pct}% ・ 最大コンボ ${this.maxCombo}`],
                    accentColor: '#00FFAA',
                    swatch: '#00FFAA'
                });
            }
        }
    }

    // ── タップで緑領域を広げる（無操作減衰の対抗手段） ──────────────────
    _gainTerritory(comboBoost) {
        const gain = (this.isClimax ? this._coverageGainClimax : this._coverageGainBase)
                   + (comboBoost ? this._coverageComboBonus : 0);
        this.greenCoverage = Math.min(1, this.greenCoverage + gain);
        this._applyTerritory();
        this._updateGauge();
        // 緑領域が一気に広がる手応え（パルス）
        if (this.territoryEl) {
            this.territoryEl.classList.remove('pulse');
            void this.territoryEl.offsetWidth; // reflow でアニメ再トリガー
            this.territoryEl.classList.add('pulse');
        }
    }

    // ── 陣取り反映: 制圧率に応じて赤/緑の領域・端末枠・背景・デブリを染める ──
    _applyTerritory() {
        const cov = this.greenCoverage;
        // ミクのアンカー色補間用に制圧率を保持（実際の色付けは毎フレームのupdateで）
        this._mikuTakeRatio = cov;

        // 上=赤(敵) / 下=緑(奪還) の高さで綱引きを可視化する
        if (this.erosionEl)   this.erosionEl.style.height   = `${((1 - cov) * 100).toFixed(2)}%`;
        if (this.territoryEl) this.territoryEl.style.height = `${(cov * 100).toFixed(2)}%`;

        // 段階クラス切替（端末フレームの色: 赤い敵領域 → 緑に奪還）
        // 終局演出が出た後は固定（_triggerComplete/_triggerFailed 側で制御）
        const stage = this._completeFired ? this._erosionStage
            : cov >= 0.75 ? 3
            : cov >= 0.5  ? 2
            : cov >= 0.25 ? 1
            : 0;
        if (stage !== this._erosionStage) {
            this._erosionStage = stage;
            this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3');
            if (stage >= 1 && stage <= 3) {
                this.songWrapper.classList.add(`to-erode-${stage}`);
            }
        }

        // Three.js 背景・フォグ: 赤(敵) → シアン(奪還)へ補間
        if (this.scene && this.scene.background && this.scene.background.isColor) {
            this.scene.background.lerpColors(this._bgColorFrom, this._bgColorTo, cov);
            if (this.scene.fog) this.scene.fog.color.copy(this.scene.background);
        }
        // デブリのワイヤーフレームも 赤 → 緑 へ
        if (this._debrisMat) {
            this._debrisMat.color.setHex(0x8c1430).lerp(new THREE.Color(0x00ffaa), cov);
        }
    }

    // ── コンボ: 連続解読(4秒以内)を数え、表示・エフェクト強化 ───────────
    _registerDecode() {
        const now = performance.now();
        if (this._lastDecodeAt > 0 && (now - this._lastDecodeAt) <= 4000) {
            this.combo++;
        } else {
            this.combo = 1;
        }
        this._lastDecodeAt = now;
        sfx.play('takeover_decode');
        if (this.combo > this.maxCombo) this.maxCombo = this.combo;

        if (this.comboEl && this.combo >= 2) {
            this.comboEl.textContent = `COMBO x${this.combo}`;
            // アニメーション再トリガー
            this.comboEl.classList.remove('show');
            void this.comboEl.offsetWidth;
            this.comboEl.classList.add('show');

            clearTimeout(this._comboHideTimer);
            this._comboHideTimer = setTimeout(() => {
                if (this.comboEl) this.comboEl.classList.remove('show');
                this.combo = 0;
            }, 4000);
        }
        return this.combo >= 2; // コンボ中ならエフェクト強化
    }

    // ── Crypto helpers (AES-256-GCM via Web Crypto API) ─────────────────

    async _initCrypto() {
        this._cryptoKey = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,            // non-extractable: key never leaves the engine
            ['encrypt', 'decrypt']
        );
        this._cryptoReady = true;
    }

    async _encrypt(plaintext) {
        const iv   = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit random IV
        const data = new TextEncoder().encode(plaintext);
        const buf  = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this._cryptoKey,
            data
        );
        return { iv, ciphertext: new Uint8Array(buf) };
    }

    async _decrypt(iv, ciphertext) {
        const buf = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            this._cryptoKey,
            ciphertext
        );
        return new TextDecoder().decode(buf);
    }

    // Convert ciphertext bytes to a Base64 string for display.
    // Returns a string long enough to slide a window through.
    _ciphertextToBase64(ciphertext) {
        let binary = '';
        for (let i = 0; i < ciphertext.length; i++) {
            binary += String.fromCharCode(ciphertext[i]);
        }
        return btoa(binary);
    }

    // ── Spawn / decode targets ────────────────────────────────────────────

    async spawnGroupTarget(group) {
        if (!this._cryptoReady) return; // key not ready yet (extremely unlikely)

        // Encrypt before touching any state — if this throws or the scene is
        // already destroyed by the time it resolves, nothing gets miscounted.
        let iv, ciphertext;
        try {
            ({ iv, ciphertext } = await this._encrypt(group.text));
        } catch {
            return;
        }
        if (!this.isActive) return; // scene destroyed while awaiting

        this.updateScore();

        const b64 = this._ciphertextToBase64(ciphertext); // authentic encrypted bytes

        const baseFontSize = this.isClimax ? 20 : 14;
        const winLen = Math.min(Math.max(b64.length, 12), 18);
        const hasHint = this.takenCount <= 3; // Show click hint only for the first 3 decryptions

        // Estimate size for collision checking
        const isMobile = window.innerWidth <= 768;
        const fontSizeVal = isMobile ? baseFontSize * 0.75 : baseFontSize;
        const scrambledWidth = winLen * (fontSizeVal * 0.65 + (isMobile ? 2.5 : 3.5));
        const plainWidth = group.text.length * (fontSizeVal * (isMobile ? 0.9 : 1.1));
        const widthPx = Math.max(scrambledWidth, plainWidth) + (isMobile ? 16 : 48);
        let heightPx = fontSizeVal * 1.2 + (isMobile ? 8 : 20);
        if (hasHint) {
            heightPx += isMobile ? 18 : 25;
        }

        const W = Math.max(1, window.innerWidth);
        const H = Math.max(1, window.innerHeight);
        const widthPct = (widthPx / W) * 100;
        const heightPct = (heightPx / H) * 100;

        // Dynamic grid layout based on screen orientation
        const isLandscape = W > H;
        const rows = isLandscape ? 4 : 5;
        const cols = isLandscape ? 5 : 3;
        const totalCells = rows * cols;
        const cellW = 84 / cols;
        const cellH = 58 / rows;

        // Shuffled grid placement with jitter for random distribution
        const cellIndices = Array.from({ length: totalCells }, (_, i) => i);
        for (let i = cellIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cellIndices[i], cellIndices[j]] = [cellIndices[j], cellIndices[i]];
        }

        let leftPct, topPct, cellIndex;
        let attempts = 0;
        let placed = false;
        while (!placed && attempts < totalCells) {
            cellIndex = cellIndices[attempts];
            const row = Math.floor(cellIndex / cols);
            const col = (cols - 1) - (cellIndex % cols); // Reversed column order
            
            // Random offset jitter within 55% of cell dimensions to break horizontal alignment
            const jitterX = (Math.random() - 0.5) * cellW * 0.55;
            const jitterY = (Math.random() - 0.5) * cellH * 0.55;

            const cellLeft = 8 + col * cellW + jitterX;
            const cellTop = 17 + row * cellH + jitterY;
            leftPct = Math.max(6, Math.min(cellLeft, Math.max(6, 94 - widthPct)));
            topPct = Math.max(16, Math.min(cellTop, Math.max(16, 81 - heightPct)));

            placed = !this.phraseTargets.some(t => {
                return Math.abs(t.leftPct - leftPct) < widthPct && 
                       Math.abs(t.topPct - topPct) < heightPct;
            });
            attempts++;
        }

        const el = document.createElement('div');
        el.className = 'to-phrase scrambled';
        el.style.top      = `${topPct}%`;
        el.style.left     = `${leftPct}%`;
        el.style.setProperty('--to-font-size', `${baseFontSize}px`);

        // Show a sliding window of the real Base64 ciphertext
        const textNode = document.createTextNode(b64.slice(0, winLen));
        el.appendChild(textNode);

        if (hasHint) {
            const hint = document.createElement('div');
            hint.className = 'to-hint';
            hint.textContent = '[ CLICK TO DECRYPT ]';
            el.appendChild(hint);
        }

        const target = {
            el, textNode,
            iv, ciphertext,        // kept for decryption
            b64,                   // kept for display animation
            state: 'scrambled',
            scrambleTimer: null,
            leftPct,
            topPct,
            widthPct,
            heightPct,
            cellIndex,
            baseFontSize,
            groupIndex: group.index // Store its unique index
        };

        // Slide a window through the Base64 string to animate the ciphertext
        let offset = 0;
        const doubled = b64 + b64; // wrap-around source
        target.scrambleTimer = setInterval(() => {
            if (target.state !== 'scrambled') return;
            offset = (offset + 1) % b64.length;
            textNode.nodeValue = doubled.slice(offset, offset + winLen);
        }, 80);

        el.addEventListener('click', async () => {
            if (target.state !== 'scrambled') return;
            if (this._completeFired) return; // 終局演出後は操作を受け付けない
            target.state = 'decrypting'; // guard against double-click
            clearInterval(target.scrambleTimer);
            try {
                // Decrypt with AES-256-GCM using the stored IV + ciphertext
                const plaintext = await this._decrypt(target.iv, target.ciphertext);
                this._revealTarget(target, plaintext);
            } catch (e) {
                // Decryption failed – we do not update background tile, it remains empty
                if (target.el && target.el.parentNode) {
                    target.el.parentNode.removeChild(target.el);
                }
            }
        });

        this.songWrapper.appendChild(el);
        this.phraseTargets.push(target);
        return target;
    }

    _revealTarget(target, plaintext) {
        if (target.state !== 'decrypting') return; // expired between click and decrypt resolve
        target.state = 'decoded';
        this.dismissFirstInteractable(); // 初回復号成功で誘導ガイドを片付ける

        // Remove decryption hint from target element if it exists
        const hint = target.el.querySelector('.to-hint');
        if (hint && hint.parentNode) {
            hint.parentNode.removeChild(hint);
        }

        target.textNode.nodeValue = plaintext;
        target.el.className = 'to-phrase decoded';

        // コンボ判定（コンボ中は解読フラッシュを強化）
        const comboBoost = this._registerDecode();
        if (comboBoost) {
            target.el.classList.add('to-combo-boost');
        }

        // タップ成功 → 緑(奪還)領域を広げる。これが無操作減衰への対抗手段。
        this._gainTerritory(comboBoost);

        const tile = this.bgTiles[target.groupIndex];
        if (!tile) {
            // Fallback if background tile wasn't pre-built
            if (target.el && target.el.parentNode) {
                target.el.parentNode.removeChild(target.el);
            }
            this.takenCount++;
            this.updateScore();
            return;
        }

        // Animate fly to the background tile
        const wrapperRect = this.songWrapper.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const elRect = target.el.getBoundingClientRect();

        // Lock to pixel absolute positioning for seamless transition
        target.el.style.left = `${elRect.left - wrapperRect.left}px`;
        target.el.style.top = `${elRect.top - wrapperRect.top}px`;
        target.el.style.width = `${elRect.width}px`;
        target.el.style.height = `${elRect.height}px`;
        target.el.style.margin = '0';
        target.el.style.transform = 'none';

        // Force a layout reflow
        target.el.offsetHeight;

        // Apply transition and fly to final background tile dimensions
        target.el.style.transition = 'all 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
        target.el.style.left = `${tileRect.left - wrapperRect.left}px`;
        target.el.style.top = `${tileRect.top - wrapperRect.top}px`;
        target.el.style.width = `${tileRect.width}px`;
        target.el.style.height = `${tileRect.height}px`;
        target.el.style.fontSize = window.innerWidth <= 768 ? '10px' : '14px';
        target.el.style.padding = window.innerWidth <= 768 ? '2px 4px' : '4px 8px';
        target.el.style.borderColor = '#ff3a3a';
        target.el.style.boxShadow = '0 0 10px rgba(255, 58, 58, 0.5)';

        // Once the transition finishes, remove target element and light up the background tile
        setTimeout(() => {
            if (target.el && target.el.parentNode) {
                target.el.parentNode.removeChild(target.el);
            }
            tile.textContent = plaintext;
            tile.classList.add('decoded');
        }, 500);

        this.takenCount++;
        this.updateScore();
    }

    // ── スタート時 WARNING: 赤いグリッチ警告を数秒出して本編へ ───────────
    _showWarning() {
        if (this.warningEl) return;
        const overlay = document.createElement('div');
        overlay.className = 'to-warning-overlay';
        overlay.innerHTML = `
            <div class="to-warning-core">
                <div class="to-warning-title">⚠ WARNING ⚠</div>
                <div class="to-warning-sub">SYSTEM TAKEOVER DETECTED</div>
                <div class="to-warning-bar">[ DECRYPT THE LYRICS — RECLAIM THE SIGNAL ]</div>
            </div>
        `;
        this.songWrapper.appendChild(overlay);
        this.warningEl = overlay;
        sfx.play('takeover_warning');

        const schedule = (fn, ms) => {
            this._introTimers.push(setTimeout(() => { if (this.isActive) fn(); }, ms));
        };
        // 約2.4秒で退場し、本編へ（フェードアウト→DOM除去）
        schedule(() => { if (overlay.parentNode) overlay.classList.add('out'); }, 2400);
        schedule(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (this.warningEl === overlay) this.warningEl = null;
        }, 3000);
    }

    // ── TAKEOVER COMPLETE: ブラックアウト→再起動風シーケンス→赤一色 ────
    _triggerComplete() {
        if (this._completeFired) return;
        this._completeFired = true;
        this._outcome = 'clear';

        // 0) 静止/吸気: 解読済みの全タイルを一斉にシアンで満たす（タメ）
        Object.values(this.bgTiles).forEach(tile => {
            if (tile) tile.classList.add('to-charge');
        });

        const overlay = document.createElement('div');
        overlay.className = 'to-reboot-overlay reclaim';
        const linesWrap = document.createElement('div');
        linesWrap.className = 'to-reboot-lines';

        const bootLines = [
            '> SYSTEM HALT :: ALL SECTORS DECRYPTED',
            '> PURGING PALETTE #FF3A3A ... OK',
            '> RESTORING SIGNAL #00FFAA .. OK',
            '> OWNERSHIP RECLAIMED',
            'TAKEOVER COMPLETE'
        ];
        const lineEls = bootLines.map((text, i) => {
            const line = document.createElement('div');
            line.className = 'to-reboot-line' + (i === bootLines.length - 1 ? ' final' : '');
            line.textContent = text;
            linesWrap.appendChild(line);
            return line;
        });
        overlay.appendChild(linesWrap);
        this.songWrapper.appendChild(overlay);
        this.rebootEl = overlay;

        const schedule = (fn, ms) => {
            this._rebootTimers.push(setTimeout(() => { if (this.isActive) fn(); }, ms));
        };

        // 1) 歌詞の爆散: 各タイルを画面中心から外向きに吹き飛ばす（衝撃波）
        schedule(() => {
            const cxv = window.innerWidth / 2;
            const cyv = window.innerHeight / 2;
            const push = 0.9 * Math.max(window.innerWidth, window.innerHeight);
            Object.values(this.bgTiles).forEach(tile => {
                if (!tile) return;
                const rect = tile.getBoundingClientRect();
                const tcx = rect.left + rect.width / 2;
                const tcy = rect.top + rect.height / 2;
                let dx = tcx - cxv;
                let dy = tcy - cyv;
                const dist = Math.hypot(dx, dy) || 1;
                const tx = (dx / dist) * push + dx * 0.4;
                const ty = (dy / dist) * push + dy * 0.4;
                const rot = (Math.random() - 0.5) * 720;
                const sc = 0.3 + Math.random() * 0.5;
                tile.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${sc})`;
                tile.classList.remove('to-charge');
                tile.classList.add('to-burst');
            });
        }, 480);

        // 2) ブラックアウト（空になった盤面を覆う）
        schedule(() => {
            if (overlay.parentNode) overlay.classList.add('on');
        }, 980);

        // 3) 奪還ログを順次表示
        const lineBase = 1200;
        lineEls.forEach((line, i) => {
            schedule(() => line.classList.add('shown'), lineBase + i * 600);
        });

        // 4) 暗転から明けると、世界はミクのシアンに塗り替わり、奥からミクが実体化
        const totalMs = lineBase + bootLines.length * 600 + 700;
        schedule(() => {
            this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3');
            this.songWrapper.classList.add('to-reclaim');
            sfx.play('takeover_reclaim');
            this._erosionStage = 0;
            // シーンを深いシアンへ
            if (this.scene && this.scene.background && this.scene.background.isColor) {
                this.scene.background.setHex(0x001712);
                if (this.scene.fog) this.scene.fog.color.setHex(0x001712);
            }
            if (this._debrisMat) {
                this._debrisMat.color.setHex(0x00ffaa);
                this._debrisMat.opacity = 0.5;
            }
            // 赤い侵食オーバーレイを消す
            if (this.erosionEl) this.erosionEl.style.opacity = '0';
            // 敵の端末(CRTモニター)を溶かし、奥のミクを前面へ露わにする
            // ※稼働中のフリッカーanimationはopacityを上書きするので止めてからフェード
            if (this.monitorEl) {
                this.monitorEl.style.animation = 'none';
                this.monitorEl.style.transition = 'opacity 1.1s ease';
                this.monitorEl.style.opacity = '0';
            }
            if (this.scoreEl) {
                this.scoreEl.textContent = 'TAKEOVER: RECLAIMED';
                this.scoreEl.style.color = '#00ffaa';
                this.scoreEl.style.textShadow = '0 0 24px #00ffaa, 0 0 48px #00ffaa';
            }
            // ミクの実体化ランプ開始（update内でシアン固定・前進・発光）
            this._reclaimT = 0;
            this._mikuReclaim = true;
            // 暗転を明ける（1.2sフェードでシアンの世界とミクが現れる）
            overlay.classList.remove('on');
            overlay.classList.add('off');
        }, totalMs);

        // 5) オーバーレイ除去
        schedule(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (this.rebootEl === overlay) this.rebootEl = null;
        }, totalMs + 1600);

        // 最終成果を登録
        this.setResultSummary({
            lines: [`制圧率 ${Math.round(this.greenCoverage * 100)}% ・ 最大コンボ ${this.maxCombo}`, 'TAKEOVER CLEAR'],
            accentColor: '#00FFAA',
            swatch: '#00FFAA'
        });
    }

    // ── TAKEOVER FAILED: 制圧率が半分に届かず終局 → 赤い敗北シーケンス ────
    _triggerFailed() {
        if (this._completeFired) return;
        this._completeFired = true;
        this._outcome = 'failed';
        this._erosionStage = 0;
        sfx.play('takeover_fail');

        // 端末フレームを完全な赤(敵支配)に固定し、世界を赤一色へ寄せる
        this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3', 'to-reclaim');
        this.songWrapper.classList.add('to-complete');
        if (this.scene && this.scene.background && this.scene.background.isColor) {
            this.scene.background.setHex(0x2a0008);
            if (this.scene.fog) this.scene.fog.color.setHex(0x2a0008);
        }
        if (this._debrisMat) this._debrisMat.color.setHex(0xff3a3a);
        // 赤を画面いっぱいに、緑領域は潰す
        if (this.erosionEl)   this.erosionEl.style.height = '100%';
        if (this.territoryEl) this.territoryEl.style.height = '0%';

        const overlay = document.createElement('div');
        overlay.className = 'to-reboot-overlay failed';
        const linesWrap = document.createElement('div');
        linesWrap.className = 'to-reboot-lines';

        const lostPct = Math.round((1 - this.greenCoverage) * 100);
        const bootLines = [
            '> DECRYPTION INCOMPLETE',
            `> SECTORS LOST :: ${lostPct}%`,
            '> SIGNAL #00FFAA SUPPRESSED',
            '> OWNERSHIP RETAINED BY INTRUDER',
            'TAKEOVER FAILED'
        ];
        const lineEls = bootLines.map((text, i) => {
            const line = document.createElement('div');
            line.className = 'to-reboot-line' + (i === bootLines.length - 1 ? ' final' : '');
            line.textContent = text;
            linesWrap.appendChild(line);
            return line;
        });
        overlay.appendChild(linesWrap);
        this.songWrapper.appendChild(overlay);
        this.rebootEl = overlay;

        const schedule = (fn, ms) => {
            this._rebootTimers.push(setTimeout(() => { if (this.isActive) fn(); }, ms));
        };

        // 1) ブラックアウト
        schedule(() => { if (overlay.parentNode) overlay.classList.add('on'); }, 300);
        // 2) 敗北ログを順次表示
        const lineBase = 600;
        lineEls.forEach((line, i) => {
            schedule(() => line.classList.add('shown'), lineBase + i * 520);
        });
        // 3) 失敗ゲージ表示
        schedule(() => {
            if (this.scoreEl) {
                this.scoreEl.textContent = 'TAKEOVER: FAILED';
                this.scoreEl.style.color = '#ff3a3a';
                this.scoreEl.style.textShadow = '0 0 24px #ff3a3a, 0 0 48px #ff3a3a';
            }
        }, lineBase + bootLines.length * 520);

        this.setResultSummary({
            lines: [`制圧率 ${Math.round(this.greenCoverage * 100)}% ・ 最大コンボ ${this.maxCombo}`, 'TAKEOVER FAILED'],
            accentColor: '#FF3A3A',
            swatch: '#FF3A3A'
        });
    }

    buildLyricCard() {
        // 現在の曲のフレーズが完全に揃うまで構築しない（揃うまで update から再試行）。
        // video の存在だけでなく isTimerReady と firstPhrase を必須にすることで、
        // 別曲の stale video やフレーズ未ロード状態で空構築するのを防ぐ。
        if (!this.isActive || !playerManager.isTimerReady ||
            !playerManager.player || !playerManager.player.video ||
            !playerManager.player.video.firstPhrase) {
            return false;
        }

        const video = playerManager.player.video;
        this.allGroups = [];
        this.bgTiles = {};

        if (this.bgContainer) {
            this.bgContainer.innerHTML = '';
        }

        let phrase = video.firstPhrase;
        let index = 0;

        while (phrase) {
            const groups = groupPhraseWordsByMinLength(phrase, 4);
            for (const g of groups) {
                const groupObj = {
                    index: index,
                    text: g.text,
                    startTime: g.startTime,
                    endTime: g.endTime
                };
                this.allGroups.push(groupObj);

                // Create static background tile
                const tile = document.createElement('div');
                tile.className = 'to-tile';
                tile.textContent = g.text;
                tile.setAttribute('data-index', index);

                this.bgContainer.appendChild(tile);
                this.bgTiles[index] = tile;

                index++;
            }
            phrase = phrase.next;
        }

        this.totalCount = index;
        this.lyricCardBuilt = true;
        this.updateScore();
        return true;
    }

    // Called externally (phrase boundary expire)
    decodeTarget(target) {
        if (target.state !== 'scrambled') return;
        clearInterval(target.scrambleTimer);
        target.state = 'expired';
        target.el.className = 'to-phrase expired';
        setTimeout(() => {
            if (target.el.parentNode) target.el.parentNode.removeChild(target.el);
        }, 400);
    }

    expireTarget(target) {
        if (target.state === 'expired' || target.state === 'decrypting') return;
        target.state = 'expired';
        clearInterval(target.scrambleTimer);
        target.el.className = 'to-phrase expired';
        setTimeout(() => { if (target.el.parentNode) target.el.parentNode.removeChild(target.el); }, 400);
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    update() {
        if (!playerManager.player || !playerManager.player.video) return;

        // 歌詞カードがまだ構築できていなければ、フレーズが揃い次第ここで構築する。
        // （タイミング次第で init 時には video.firstPhrase が未ロードのことがあるため）
        if (!this.lyricCardBuilt) {
            this.buildLyricCard();
        }

        // 開幕の赤い WARNING（システム侵略アラート）。選曲→曲ロードのカーテンが
        // 開く＝タイマー準備完了の瞬間に一度だけ起動する（幕裏で消えるのを防ぐ）。
        if (!this._warningShown && playerManager.isTimerReady) {
            this._warningShown = true;
            this._showWarning();
        }

        // TextAlive公式タイマー(player.timer.position)に完全同期（先行調整を排除）
        const position = (playerManager.player && playerManager.player.timer)
                         ? playerManager.player.timer.position
                         : this.getSmoothedTime();
        const chorus = typeof playerManager.player.findChorus === 'function'
            ? playerManager.player.findChorus(position) : null;
        this.isClimax = !!chorus;

        // ── 終局演出の起動: 曲終わりの約8秒前に発火し、制圧率で勝敗を分ける ──
        // 演出(約6.5s)を songEnd の黒幕(通常 duration-50ms)より前に出し切るためのリード。
        // 画面の半分以上が緑(greenCoverage >= 0.5)なら CLEAR、届かなければ FAILED。
        if (!this._completeFired) {
            const duration = playerManager.player.video.duration;
            if (duration > 0 && position >= duration - this._completeLeadMs) {
                if (this.greenCoverage >= this._clearThreshold) {
                    this._triggerComplete();
                } else {
                    this._triggerFailed();
                }
            }
        }

        // Chorus: tighten contrast to signal intensity shift
        if (this.isClimax !== this.prevIsClimax) {
            this.songWrapper.style.filter = this.isClimax ? 'contrast(1.25) saturate(1.6)' : '';
            this.prevIsClimax = this.isClimax;
        }

        // ── 制圧率の時間減衰（無操作だと赤がじわじわ再侵食する綱引き） ──
        // 終局演出が出るまで、かつ歌詞カード構築後のみ進行させる。
        if (!this._completeFired && this.lyricCardBuilt) {
            const now = performance.now();
            const dt = this._lastFrameAt ? Math.min(0.1, (now - this._lastFrameAt) / 1000) : 0;
            this._lastFrameAt = now;
            if (dt > 0) {
                const decay = this.isClimax ? this._coverageDecayClimax : this._coverageDecayBase;
                const next = Math.max(0, this.greenCoverage - decay * dt);
                if (next !== this.greenCoverage) {
                    this.greenCoverage = next;
                    this._applyTerritory();
                    this._updateGauge();
                }
            }
        }

        // Background debris rotation ＋ 疾走感: 奥→手前へ流れ、近づいたら奥へ回帰
        const driftMul = this.isClimax ? 1.8 : 1;
        this.debris.forEach(m => {
            m.rotation.x += m.userData.rot.x;
            m.rotation.y += m.userData.rot.y;
            m.rotation.z += m.userData.rot.z;
            m.position.z += (m.userData.vz || 0) * driftMul;
            if (m.position.z > 12) {
                m.position.set((Math.random()-0.5)*45, (Math.random()-0.5)*28, -40);
            }
        });

        // 疾走感: カメラを微振動させる（サビで強く）
        if (this.camera) {
            const t = performance.now() * 0.001;
            const amp = this.isClimax ? 0.16 : 0.06;
            this.camera.position.x = Math.sin(t * 13.0) * amp + Math.sin(t * 7.3) * amp * 0.5;
            this.camera.position.y = Math.cos(t * 11.0) * amp * 0.7;
            this.camera.lookAt(0, 0.5, -4);
        }

        // ── ミクの視覚アンカー: リズムに合わせて淡く脈動 ──
        // サビ(isClimax)で少し速く・強く、解読率に応じてシアン→赤へ寄せる。
        if (this.mikuAnchorSprite && this.mikuAnchorMat) {
            if (this._mikuReclaim) {
                // ── 完走: ミクが奥から実体化（シアン固定・前進・逆光発光） ──
                this._reclaimT = Math.min(1, this._reclaimT + 0.012);
                const ease = 1 - Math.pow(1 - this._reclaimT, 3); // easeOutCubic
                this._mikuAnchorPhase += 0.04;
                const breathe = (Math.sin(this._mikuAnchorPhase) + 1) * 0.5; // 0〜1
                this.mikuAnchorMat.color.copy(this._mikuColorCyan); // シアン固定（赤寄せを上書き）
                this.mikuAnchorMat.opacity = Math.min(1, (0.16 + ease * 0.84) - breathe * 0.05 * ease);
                const s = 7 + ease * 6; // 7 → 13
                this.mikuAnchorSprite.scale.set(s, s, 1);
                this.mikuAnchorSprite.position.z = -4 + ease * 2;   // -4 → -2 前進
                this.mikuAnchorSprite.position.y = 0.5 + ease * 0.4;
                if (this.mikuGlowMat && this.mikuGlowSprite) {
                    this.mikuGlowMat.opacity = ease * (0.4 + breathe * 0.18);
                    const gs = 8 + ease * 11; // シルエットより一回り大きい逆光
                    this.mikuGlowSprite.scale.set(gs, gs, 1);
                    this.mikuGlowSprite.position.y = this.mikuAnchorSprite.position.y;
                    this.mikuGlowSprite.position.z = this.mikuAnchorSprite.position.z - 0.2;
                }
            } else {
                const speed = this.isClimax ? 0.085 : 0.05;
                this._mikuAnchorPhase += speed;
                const pulse = (Math.sin(this._mikuAnchorPhase) + 1) * 0.5; // 0〜1
                // 透明度は過剰にしない（サビでわずかに底上げ）
                const base = this.isClimax ? 0.18 : 0.13;
                const amp = this.isClimax ? 0.16 : 0.09;
                this.mikuAnchorMat.opacity = base + pulse * amp;
                // ごく僅かにスケールも呼吸させる
                const s = 7 + pulse * (this.isClimax ? 0.5 : 0.25);
                this.mikuAnchorSprite.scale.set(s, s, 1);
                // 奪還が進むほど 赤(敵) → 緑(ミク) へ
                this._mikuAnchorColor.lerpColors(
                    this._mikuColorRed, this._mikuColorCyan, this._mikuTakeRatio
                );
                this.mikuAnchorMat.color.copy(this._mikuAnchorColor);
            }
        }

        // At phrase boundary: expire remaining scrambled targets after a 2-second delay
        // to give the user more time to decrypt them.
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase.startTime !== this.lastPhraseStart) {
            this.phraseTargets.forEach(t => {
                if (t.state === 'scrambled') {
                    setTimeout(() => {
                        if (this.isActive && t.state === 'scrambled') {
                            this.expireTarget(t);
                        }
                    }, 2000);
                }
            });
            this.lastPhraseStart = phrase.startTime;
        }

        // Spawn one scrambled target per word-group
        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);
        if (word && word.parent) {
            const groups = groupPhraseWordsByMinLength(word.parent, 4);
            const group = findGroupForWord(groups, word);
            if (group && group.startTime !== this.lastGroupStartTime) {
                this.lastGroupStartTime = group.startTime;
                
                // Match with pre-built allGroups to get the indexed group
                const matchGroup = this.allGroups.find(g => g.startTime === group.startTime && g.text === group.text);
                if (matchGroup) {
                    const tile = this.bgTiles[matchGroup.index];
                    // Only spawn if the background tile is not already decoded
                    if (tile && !tile.classList.contains('decoded')) {
                        this.spawnGroupTarget(matchGroup);
                    }
                }
            }
        }
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);

        // コンボ・再起動シーケンス・WARNING のタイマーを全停止
        clearTimeout(this._comboHideTimer);
        this._rebootTimers.forEach(t => clearTimeout(t));
        this._rebootTimers = [];
        this._introTimers.forEach(t => clearTimeout(t));
        this._introTimers = [];

        if (this.warningEl && this.warningEl.parentNode) {
            this.warningEl.parentNode.removeChild(this.warningEl);
            this.warningEl = null;
        }
        if (this.territoryEl && this.territoryEl.parentNode) {
            this.territoryEl.parentNode.removeChild(this.territoryEl);
            this.territoryEl = null;
        }

        if (this.rebootEl && this.rebootEl.parentNode) {
            this.rebootEl.parentNode.removeChild(this.rebootEl);
            this.rebootEl = null;
        }
        if (this.erosionEl && this.erosionEl.parentNode) {
            this.erosionEl.parentNode.removeChild(this.erosionEl);
            this.erosionEl = null;
        }
        if (this.comboEl && this.comboEl.parentNode) {
            this.comboEl.parentNode.removeChild(this.comboEl);
            this.comboEl = null;
        }
        this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3', 'to-complete', 'to-reclaim');
        this._mikuReclaim = false;
        this._reclaimT = 0;

        this.phraseTargets.forEach(t => {
            clearInterval(t.scrambleTimer);
            if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
        });
        this.phraseTargets = [];

        if (this._debrisEdgesGeo) { this._debrisEdgesGeo.dispose(); this._debrisEdgesGeo = null; }
        if (this._debrisMat)      { this._debrisMat.dispose();      this._debrisMat = null; }

        // ミクの視覚アンカーを除去・解放
        if (this.mikuAnchorSprite) {
            this.scene.remove(this.mikuAnchorSprite);
            this.mikuAnchorSprite = null;
        }
        if (this.mikuAnchorMat)     { this.mikuAnchorMat.dispose();     this.mikuAnchorMat = null; }
        if (this.mikuAnchorTexture) { this.mikuAnchorTexture.dispose(); this.mikuAnchorTexture = null; }

        // 背後グローも除去・解放
        if (this.mikuGlowSprite) {
            this.scene.remove(this.mikuGlowSprite);
            this.mikuGlowSprite = null;
        }
        if (this.mikuGlowMat)     { this.mikuGlowMat.dispose();     this.mikuGlowMat = null; }
        if (this.mikuGlowTexture) { this.mikuGlowTexture.dispose(); this.mikuGlowTexture = null; }

        const styleEl = document.getElementById('takeover-style');
        if (styleEl) styleEl.parentNode.removeChild(styleEl);

        if (this.monitorEl && this.monitorEl.parentNode) {
            this.monitorEl.parentNode.removeChild(this.monitorEl);
            this.monitorEl = null;
        }

        this.allGroups = [];
        this.bgTiles = {};

        if (this.bgContainer && this.bgContainer.parentNode) {
            this.bgContainer.parentNode.removeChild(this.bgContainer);
            this.bgContainer = null;
        }

        this.songWrapper.style.filter = '';

        if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss?.(); this.renderer = null; }

        super.destroy();
    }
}
