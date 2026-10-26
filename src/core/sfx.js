/**
 * 効果音(SFX)システム — 全曲共通UI。
 *
 * 設計方針(Lane3): 曲やBaseSongを編集せず、eventBus の既存イベントと
 * グローバルなDOMジェスチャを購読するだけの「疎結合」実装。main.js では
 * 副作用 import 1行(`import './core/sfx.js';`)で読み込むだけで有効になる。
 *
 * 音量はユーザー設定(localStorage: appVolume / appMuted)に追従し、
 * 音楽の邪魔をしないよう全体を SFX_MASTER で控えめにする。
 * WebAudio で事前デコードしておき、低遅延・多重再生に対応。
 *
 * 共通UIの対応:
 *   hover      : ボタンのクリック音(押下時。マウスオーバーでは鳴らさない)
 *   confirm    : 曲の決定(songConfirm=押下の瞬間。loadSongだとフェード分遅れる)
 *   transition : 湖へ戻る遷移(backToLake)
 *   complete   : 1曲クリア / 全曲制覇(songEnd / allSongsComplete)
 *
 * 曲ごとの固有SEは別途(各曲レーンで)追加予定。欠損ファイルは無音で許容する。
 */
import { eventBus } from './eventBus.js';
import { safeGet } from '../utils/storage.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
const FILES = {
    // 全曲共通UI
    ripple: 'assets/sfx/ui_ripple.mp3',
    hover: 'assets/sfx/ui_hover.mp3',
    confirm: 'assets/sfx/ui_confirm.mp3',
    transition: 'assets/sfx/ui_transition.mp3',
    complete: 'assets/sfx/ui_complete.mp3',
    // 曲別(各曲シーンが sfx.play(key) で鳴らす。欠損は無音)
    kotaete_resonance: 'assets/sfx/kotaete_resonance.mp3',
    kotaete_choice: 'assets/sfx/kotaete_choice.mp3',
    after_ignite: 'assets/sfx/after_ignite.mp3',
    after_petal: 'assets/sfx/after_petal.mp3',
    orchestra_firework: 'assets/sfx/orchestra_firework.mp3',
    shutter_click: 'assets/sfx/shutter_click.mp3',
    shutter_star: 'assets/sfx/shutter_star.mp3',
    trick_flip: 'assets/sfx/trick_flip.mp3',
    trick_choose: 'assets/sfx/trick_choose.mp3',
    takeover_decode: 'assets/sfx/takeover_decode.mp3',
    takeover_reclaim: 'assets/sfx/takeover_reclaim.mp3',
    takeover_warning: 'assets/sfx/takeover_warning.mp3',
    takeover_fail: 'assets/sfx/takeover_fail.mp3',
};
const SFX_MASTER = 0.5; // 音楽より一段下げる

class Sfx {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.buffers = {};
        this._loadStarted = false;
        this._lastBtnClick = 0;
        this._active = 0;          // 現在鳴っているソース数
        this._suspendTimer = null; // アイドル時の自動suspend用
    }

    _ensureCtx() {
        if (this.ctx) return this.ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.connect(this.ctx.destination);
        } catch (e) { return null; }
        this._load();
        // 生成直後に何も鳴っていなければ即 suspend する。AudioContext を running の
        // まま放置するとOSのオーディオ出力が開きっぱなしになり、無音でも環境によって
        // 常時「サー」というノイズフロア(ヒス/ハム)が出る。鳴らす瞬間だけ resume する。
        this._scheduleIdleSuspend(0);
        return this.ctx;
    }

    // 一定時間 SFX が鳴っていなければ AudioContext を suspend してデバイスを閉じる
    _scheduleIdleSuspend(delay = 600) {
        if (this._suspendTimer) { clearTimeout(this._suspendTimer); this._suspendTimer = null; }
        this._suspendTimer = setTimeout(() => {
            this._suspendTimer = null;
            if (this._active <= 0 && this.ctx && this.ctx.state === 'running') {
                this.ctx.suspend().catch(() => {});
            }
        }, delay);
    }

    // 事前デコード。AudioContext は suspended のままでも decodeAudioData は可能。
    async _load() {
        if (this._loadStarted || !this.ctx) return;
        this._loadStarted = true;
        await Promise.all(Object.entries(FILES).map(async ([key, path]) => {
            try {
                const res = await fetch(BASE + path);
                if (!res.ok) return;                       // 欠損(例: 未展開のzip)は無音
                const ab = await res.arrayBuffer();
                this.buffers[key] = await this.ctx.decodeAudioData(ab);
            } catch (e) { /* デコード失敗も無音で許容 */ }
        }));
    }

    // ユーザー設定音量(0..1)。VolumeControl と同じ localStorage キーを参照。
    _userVol() {
        if (safeGet('appMuted') === '1') return 0;
        const v = parseInt(safeGet('appVolume'), 10);
        return (Number.isFinite(v) ? v : 80) / 100;
    }

    // 初回ユーザージェスチャで AudioContext を解錠(自動再生ポリシー対応)。
    // ここでは running のまま放置せず、すぐ resume できる状態を作るだけにとどめ、
    // アイドルになれば再び suspend してノイズフロアを残さない。
    unlock() {
        const c = this._ensureCtx();
        if (!c) return;
        if (c.state === 'suspended') {
            c.resume().then(() => this._scheduleIdleSuspend()).catch(() => {});
        } else {
            this._scheduleIdleSuspend();
        }
    }

    play(key, gain = 1) {
        const c = this._ensureCtx();
        if (!c) return;
        const buf = this.buffers[key];
        if (!buf) return;
        const vol = this._userVol();
        if (vol <= 0) return;
        // 鳴らす瞬間だけ resume。アイドル自動suspendの予約は取り消す。
        if (this._suspendTimer) { clearTimeout(this._suspendTimer); this._suspendTimer = null; }
        if (c.state === 'suspended') c.resume().catch(() => {});
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = vol * SFX_MASTER * gain;
        src.connect(g);
        g.connect(this.master || c.destination);
        this._active++;
        src.onended = () => {
            this._active = Math.max(0, this._active - 1);
            try { src.disconnect(); g.disconnect(); } catch (e) { /* noop */ }
            // 最後の音が鳴り終わったらデバイスを閉じてノイズフロアを残さない
            if (this._active <= 0) this._scheduleIdleSuspend();
        };
        try { src.start(0); } catch (e) { /* noop */ }
    }
}

const sfx = new Sfx();

// 初回ジェスチャで解錠(capture で最優先に起こす)
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

// UIのSEは「実際にタップ前提のコントロール(<button>)」を押したときだけ鳴らす。
// タイトル/湖の水面・装飾・選曲マーカーなど、背景の素通りタップでは一切鳴らさない。
// (以前は曲再生中以外の全タップで ripple を鳴らしていたが、誤発火が多いため廃止)

// ボタンのクリック音。マウスオーバーでは鳴らさず、押下(pointerdown)時にだけ鳴らす。
// (短間隔のスロットルで連打時の鳴り過ぎを防ぐ)
window.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (!(t && t.closest && t.closest('button'))) return;
    const now = (performance && performance.now) ? performance.now() : Date.now();
    if (now - sfx._lastBtnClick < 90) return;
    sfx._lastBtnClick = now;
    sfx.play('hover', 0.7);
}, { capture: true });

// 決定 / 遷移 / 達成
// 決定音は曲ロード(loadSong=画面フェード完了後)ではなく、押下の瞬間に発火する
// songConfirm で鳴らす。loadSong に紐付けると約450ms遅れて聞こえてしまうため。
eventBus.on('songConfirm', () => sfx.play('confirm'));
eventBus.on('backToLake', () => sfx.play('transition'));
eventBus.on('songEnd', () => sfx.play('complete'));
eventBus.on('allSongsComplete', () => sfx.play('complete', 1.1));

// デコードを早めに開始(suspended のまま事前ロード)
sfx._ensureCtx();

// デバッグ/検証用
window.__sfx = sfx;

export { sfx };
