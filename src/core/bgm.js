/**
 * 選曲画面(湖の世界)のフェーズ別BGM。
 *
 * 設計方針(sfx.js と同様の疎結合): WorldUI/曲シーンを直接いじらず、eventBus の
 * イベントを購読するだけで成立する。main.js では副作用 import 1行で有効になる。
 *
 *   lakeEnter       : 選曲画面に入った/戻った → 現在フェーズのBGMをフェードイン
 *   songConfirm     : 曲を選んだ → BGMをフェードアウトして停止(曲本編へ譲る)
 *   phaseChange     : 水のフェーズが進んだ → 新フェーズのトラックへクロスフェード
 *   appVolumeChange : 音量/ミュート変更 → マスターゲインを即追従
 *
 * 音源は甘茶の音楽工房のフリーBGM(商用可・クレジット任意・ループ加工可)。
 * フェーズ(晴れ→雲→雨→水たまり→小川→川→湖)ごとに曲を割り当てる。
 * 固定尺のため loop=true でシームレスにループさせる。
 * 音量はユーザー設定(localStorage: appVolume / appMuted)に追従する。
 * 鳴っていない間は AudioContext を suspend してノイズフロアを残さない。
 */
import { eventBus } from './eventBus.js';
import { appState } from './appState.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';

// フェーズindex → 音源ファイル(src/config/constants.js の PHASES と対応)
const FILES = {
    0: 'assets/bgm/bgm_clear.mp3',   // 晴れ   — ラブリーフラワー
    1: 'assets/bgm/bgm_clouds.mp3',  // 雲     — 月明かりの庭園
    2: 'assets/bgm/bgm_rain.mp3',    // 雨     — 氷雨
    3: 'assets/bgm/bgm_puddles.mp3', // 水たまり — おもちゃのピアノ
    4: 'assets/bgm/bgm_stream.mp3',  // 小川   — 夏休みの探検
    5: 'assets/bgm/bgm_river.mp3',   // 川     — 6月の遠雷
    6: 'assets/bgm/bgm_lake.mp3',    // 湖     — プラネット・ナイン
};

const BGM_MASTER = 0.5; // 環境音として控えめに(曲本編より主張しすぎない)
const FADE_IN = 1.6;    // 入場時のフェードイン秒
const FADE_OUT = 0.9;   // 退場時のフェードアウト秒
const CROSSFADE = 1.6;  // フェーズ切替のクロスフェード秒

class Bgm {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.buffers = {};   // phaseIndex -> AudioBuffer
        this._loading = {};   // phaseIndex -> Promise(デコード中の重複fetch防止)
        this.current = null;  // { src, gain, phase }
        this.active = false;  // 選曲画面に居て BGM を鳴らしたい状態か
        this.phase = appState.getPhase();
    }

    _ensureCtx() {
        if (this.ctx) return this.ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = this._userVol() * BGM_MASTER;
            this.master.connect(this.ctx.destination);
        } catch (e) { return null; }
        return this.ctx;
    }

    // ユーザー設定音量(0..1)。VolumeControl と同じ localStorage キーを参照。
    _userVol() {
        if (localStorage.getItem('appMuted') === '1') return 0;
        const v = parseInt(localStorage.getItem('appVolume'), 10);
        return (Number.isFinite(v) ? v : 80) / 100;
    }

    // 指定フェーズの音源を取得(初回のみ fetch+decode、以降はキャッシュ)。
    _buffer(phase) {
        if (this.buffers[phase]) return Promise.resolve(this.buffers[phase]);
        const path = FILES[phase];
        if (!path || !this.ctx) return Promise.resolve(null);
        if (!this._loading[phase]) {
            this._loading[phase] = (async () => {
                try {
                    const res = await fetch(BASE + path);
                    if (!res.ok) return null;                 // 欠損は無音で許容
                    const ab = await res.arrayBuffer();
                    const buf = await this.ctx.decodeAudioData(ab);
                    this.buffers[phase] = buf;
                    return buf;
                } catch (e) { return null; }
            })();
        }
        return this._loading[phase];
    }

    // 音量/ミュート変更を即反映(マスターゲインを滑らかに追従)。
    setVolume() {
        if (!this.ctx || !this.master) return;
        const target = this._userVol() * BGM_MASTER;
        const now = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(target, now, 0.05);
    }

    // 選曲画面に入った/戻った: 現在フェーズのBGMを流す。
    async enter(phase = appState.getPhase()) {
        this.active = true;
        this.phase = phase;
        const c = this._ensureCtx();
        if (!c) return;
        if (c.state === 'suspended') { try { await c.resume(); } catch (e) { /* gesture待ち */ } }
        // 既に同フェーズが鳴っていれば何もしない(再入場での鳴り直し防止)
        if (this.current && this.current.phase === phase) return;
        const buf = await this._buffer(phase);
        // 待っている間に離脱/別フェーズへ切替済みなら破棄
        if (!buf || !this.active || this.phase !== phase) return;
        if (this.current && this.current.phase === phase) return;
        this._startTrack(buf, phase, this.current ? CROSSFADE : FADE_IN);
    }

    _startTrack(buf, phase, fade) {
        const c = this.ctx;
        if (this.current) this._stopTrack(this.current, fade); // 旧トラックをクロスフェードで退場
        const gain = c.createGain();
        gain.connect(this.master);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(gain);
        const now = c.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(1, now + fade);
        try { src.start(0); } catch (e) { /* noop */ }
        this.current = { src, gain, phase };
    }

    _stopTrack(track, fade) {
        const c = this.ctx;
        const now = c.currentTime;
        try {
            const g = track.gain.gain;
            g.cancelScheduledValues(now);
            g.setValueAtTime(Math.max(g.value, 0.0001), now);
            g.exponentialRampToValueAtTime(0.0001, now + fade);
            track.src.stop(now + fade + 0.05);
        } catch (e) { /* noop */ }
        setTimeout(() => {
            try { track.src.disconnect(); track.gain.disconnect(); } catch (e) { /* noop */ }
        }, (fade + 0.15) * 1000);
    }

    // 選曲画面から離れた(曲を選んだ等): フェードアウトして停止。
    leave() {
        this.active = false;
        if (this.current) {
            this._stopTrack(this.current, FADE_OUT);
            this.current = null;
        }
        // 無音になったら AudioContext を閉じてノイズフロアを残さない
        const c = this.ctx;
        if (c) {
            setTimeout(() => {
                if (!this.active && c.state === 'running') c.suspend().catch(() => {});
            }, (FADE_OUT + 0.4) * 1000);
        }
    }
}

const bgm = new Bgm();

// ── eventBus 購読(疎結合) ───────────────────────────────────────────────
eventBus.on('lakeEnter', () => bgm.enter());
eventBus.on('songConfirm', () => bgm.leave());
eventBus.on('appVolumeChange', () => bgm.setVolume());
// フェーズ進行: 在場中なら新トラックへクロスフェード、離脱中でも次回 enter 用に保持。
eventBus.on('phaseChange', ({ to } = {}) => {
    bgm.phase = (typeof to === 'number') ? to : appState.getPhase();
    if (bgm.active) bgm.enter(bgm.phase);
});

// 自動再生ポリシー対策: ユーザー操作後も suspended のままなら次のタップで resume。
window.addEventListener('pointerdown', () => {
    if (bgm.active && bgm.ctx && bgm.ctx.state === 'suspended') bgm.ctx.resume().catch(() => {});
}, { capture: true });

// デバッグ/検証用
window.__bgm = bgm;

export { bgm };
