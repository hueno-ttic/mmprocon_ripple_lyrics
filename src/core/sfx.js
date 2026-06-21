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
 *   ripple     : タップのさざ波(タイトル/湖など 曲再生中以外のタップ)
 *   hover      : ボタンのホバー(スロットル)
 *   confirm    : 曲の決定(loadSong)
 *   transition : 湖へ戻る遷移(backToLake)
 *   complete   : 1曲クリア / 全曲制覇(songEnd / allSongsComplete)
 *
 * 曲ごとの固有SEは別途(各曲レーンで)追加予定。欠損ファイルは無音で許容する。
 */
import { eventBus } from './eventBus.js';
import { appState } from './appState.js';

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
};
const SFX_MASTER = 0.5; // 音楽より一段下げる

class Sfx {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.buffers = {};
        this._loadStarted = false;
        this._lastHover = 0;
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
        return this.ctx;
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
        if (localStorage.getItem('appMuted') === '1') return 0;
        const v = parseInt(localStorage.getItem('appVolume'), 10);
        return (Number.isFinite(v) ? v : 80) / 100;
    }

    // 初回ユーザージェスチャで AudioContext を起こす(自動再生ポリシー対応)
    unlock() {
        const c = this._ensureCtx();
        if (c && c.state === 'suspended') c.resume().catch(() => {});
    }

    play(key, gain = 1) {
        const c = this._ensureCtx();
        if (!c) return;
        if (c.state === 'suspended') c.resume().catch(() => {});
        const buf = this.buffers[key];
        if (!buf) return;
        const vol = this._userVol();
        if (vol <= 0) return;
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = vol * SFX_MASTER * gain;
        src.connect(g);
        g.connect(this.master || c.destination);
        try { src.start(0); } catch (e) { /* noop */ }
    }
}

const sfx = new Sfx();

// 初回ジェスチャで解錠(capture で最優先に起こす)
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

// タップのさざ波: 曲再生中は各曲の固有SEに譲るため鳴らさない。
// ボタンは confirm/hover が担当するので除外する。
window.addEventListener('pointerdown', (e) => {
    if (appState.currentSongId) return;
    const t = e.target;
    if (t && t.closest && t.closest('button')) return;
    sfx.play('ripple', 0.9);
}, { capture: true });

// ボタンホバー(短間隔のスロットルで鳴り過ぎを防ぐ)
window.addEventListener('pointerover', (e) => {
    const t = e.target;
    if (!(t && t.closest && t.closest('button'))) return;
    const now = (performance && performance.now) ? performance.now() : Date.now();
    if (now - sfx._lastHover < 90) return;
    sfx._lastHover = now;
    sfx.play('hover', 0.7);
}, { capture: true });

// 決定 / 遷移 / 達成
eventBus.on('loadSong', () => sfx.play('confirm'));
eventBus.on('backToLake', () => sfx.play('transition'));
eventBus.on('songEnd', () => sfx.play('complete'));
eventBus.on('allSongsComplete', () => sfx.play('complete', 1.1));

// デコードを早めに開始(suspended のまま事前ロード)
sfx._ensureCtx();

// デバッグ/検証用
window.__sfx = sfx;

export { sfx };
