/**
 * 【実験的機能】絵文字リアクション (Zoom風)
 * ---------------------------------------------------------------------------
 * 「こたえて」専用の実験的オーバーレイ。
 * 画面下のボタンを押すと、絵文字が画面下からふわふわ上昇し、
 * 画面上端に達したら消える(Zoomのリアクションと同じ挙動)。
 *
 * ■ 完全に自己完結:
 *   - 自前の <style> / DOM / イベントを持ち、destroy() で全て撤去する。
 *   - song-kotaete.js 側のフックは「import 1行 + init 1行 + destroy 1行」のみ。
 *   - 他機能には一切触れない(floatは pointer-events:none、
 *     ボタンの pointerdown/click は stopPropagation して歌詞レイキャストや
 *     汎用リップルを邪魔しない)。
 *
 * ■ すぐ外したいとき:
 *   1) 下の ENABLED を false にする(コード残したまま即無効化)、または
 *   2) song-kotaete.js の 3 箇所のフック行を消す、または
 *   3) このファイルごと削除する。
 * ---------------------------------------------------------------------------
 */

// ← これを false にするだけで機能ごと無効化できる(他に影響なし)
export const ENABLED = true;

// 表示する絵文字(自由に増減可)
const EMOJIS = ['❤️', '👍', '🎉', '👏', '✨', '😊'];

const STYLE_ID = 'kotaete-emoji-reactions-style';

const CSS = `
    .kotaete-emoji-bar {
        position: absolute;
        right: calc(16px + env(safe-area-inset-right, 0px));
        /* フッター(シークバー/再生コントロール)の帯と被らないよう一段上に置く */
        bottom: calc(124px + env(safe-area-inset-bottom, 0px));
        display: flex;
        flex-direction: row;
        gap: 6px;
        padding: 6px 8px;
        background: rgba(5, 5, 16, 0.5);
        border: 1px solid rgba(127, 119, 221, 0.45);
        border-radius: 22px;
        backdrop-filter: blur(4px);
        z-index: 26;
        pointer-events: auto;
        user-select: none;
    }
    /* グローバルの button スタイル(padding/box-shadow/letter-spacing 等)を打ち消し、
       絵文字を枠の中央へ正確に収める。flex 中央寄せで字形のズレも防ぐ。 */
    .kotaete-emoji-btn {
        box-sizing: border-box;
        width: 38px;
        height: 38px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        line-height: 1;
        letter-spacing: 0;
        font-weight: 400;
        border-radius: 50%;
        cursor: pointer;
        background: transparent;
        border: none;
        box-shadow: none;
        transition: transform 0.12s ease, background 0.12s ease;
        -webkit-tap-highlight-color: transparent;
    }
    .kotaete-emoji-btn:hover { background: rgba(255, 255, 255, 0.12); transform: none; box-shadow: none; }
    .kotaete-emoji-btn:active { transform: scale(0.85); }

    /* 上昇する絵文字。クリックを奪わないよう pointer-events:none */
    .kotaete-emoji-float {
        position: absolute;
        bottom: 150px;
        font-size: 30px;
        line-height: 1;
        pointer-events: none;
        z-index: 27;
        will-change: transform, opacity;
        animation: kotaete-emoji-rise var(--dur, 4s) ease-in forwards;
    }
    /* 横揺れ(ふわふわ)用の内側要素 */
    .kotaete-emoji-float > span {
        display: inline-block;
        animation: kotaete-emoji-sway var(--sway-dur, 1.6s) ease-in-out infinite alternate;
    }
    @keyframes kotaete-emoji-rise {
        0%   { transform: translateY(0) scale(0.6); opacity: 0; }
        12%  { opacity: 1; }
        70%  { opacity: 1; }
        100% { transform: translateY(var(--rise, -86vh)) scale(1); opacity: 0; }
    }
    @keyframes kotaete-emoji-sway {
        from { transform: translateX(calc(var(--sway, 18px) * -1)); }
        to   { transform: translateX(var(--sway, 18px)); }
    }

    @media (max-width: 768px) {
        .kotaete-emoji-bar {
            right: calc(8px + env(safe-area-inset-right, 0px));
            bottom: calc(84px + env(safe-area-inset-bottom, 0px));
            gap: 4px; padding: 4px 6px;
        }
        .kotaete-emoji-btn { width: 40px; height: 40px; font-size: 20px; }
        .kotaete-emoji-float { bottom: 110px; }
    }
`;

export class EmojiReactions {
    /** @param {HTMLElement} host 親要素(song の songWrapper) */
    constructor(host) {
        this.host = host;
        this.styleEl = null;
        this.barEl = null;
        this.timers = new Set();
        this._onBtnDown = this._onBtnDown.bind(this);
        // BaseSong は songWrapper の 'click' で汎用リップルを出すため、
        // リアクション操作が他機能に波及しないよう click も握りつぶす。
        this._stopClick = (e) => e.stopPropagation();
    }

    mount() {
        if (!ENABLED || !this.host) return;

        // style 注入(専用IDで多重注入を防ぐ)
        if (!document.getElementById(STYLE_ID)) {
            this.styleEl = document.createElement('style');
            this.styleEl.id = STYLE_ID;
            this.styleEl.textContent = CSS;
            document.head.appendChild(this.styleEl);
        }

        // ボタンバー
        this.barEl = document.createElement('div');
        this.barEl.className = 'kotaete-emoji-bar';
        for (const emoji of EMOJIS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'kotaete-emoji-btn';
            btn.textContent = emoji;
            btn.dataset.emoji = emoji;
            this.barEl.appendChild(btn);
        }
        // pointerdown/click を握りつぶして、song側の歌詞レイキャスト/汎用リップルへ伝播させない
        this.barEl.addEventListener('pointerdown', this._onBtnDown);
        this.barEl.addEventListener('click', this._stopClick);
        this.host.appendChild(this.barEl);
    }

    _onBtnDown(e) {
        const btn = e.target.closest('.kotaete-emoji-btn');
        if (!btn) return;
        e.stopPropagation();
        e.preventDefault();
        this.spawn(btn.dataset.emoji, btn);
    }

    /** 絵文字を1つ、下から上へふわふわ飛ばす */
    spawn(emoji, anchorBtn) {
        if (!this.host) return;

        const floatEl = document.createElement('div');
        floatEl.className = 'kotaete-emoji-float';

        // 横位置: 押されたボタンの中央付近 + ランダムな散らし
        let centerX = this.host.clientWidth - 60;
        if (anchorBtn) {
            const hostRect = this.host.getBoundingClientRect();
            const btnRect = anchorBtn.getBoundingClientRect();
            centerX = btnRect.left - hostRect.left + btnRect.width / 2;
        }
        const jitter = (Math.random() - 0.5) * 40;
        floatEl.style.left = `${centerX + jitter - 15}px`;

        // 上昇量・揺れ・速度・サイズをランダムに変化させて自然に
        const rise = -(78 + Math.random() * 16);      // vh
        const sway = 10 + Math.random() * 18;          // px
        const dur = 3.4 + Math.random() * 1.6;         // s
        const swayDur = 1.1 + Math.random() * 1.0;     // s
        const size = 26 + Math.random() * 12;          // px
        floatEl.style.setProperty('--rise', `${rise}vh`);
        floatEl.style.setProperty('--sway', `${sway}px`);
        floatEl.style.setProperty('--dur', `${dur}s`);
        floatEl.style.setProperty('--sway-dur', `${swayDur}s`);
        floatEl.style.fontSize = `${size}px`;

        const inner = document.createElement('span');
        inner.textContent = emoji;
        floatEl.appendChild(inner);

        // 上端に達したら(=アニメ終了で)消す
        const remove = () => {
            if (floatEl.parentNode) floatEl.parentNode.removeChild(floatEl);
        };
        floatEl.addEventListener('animationend', remove, { once: true });
        // animationend が来ない環境向けの保険タイマー
        const t = setTimeout(() => { remove(); this.timers.delete(t); }, (dur + 0.3) * 1000);
        this.timers.add(t);

        this.host.appendChild(floatEl);
    }

    destroy() {
        this.timers.forEach(t => clearTimeout(t));
        this.timers.clear();
        if (this.barEl) {
            this.barEl.removeEventListener('pointerdown', this._onBtnDown);
            this.barEl.removeEventListener('click', this._stopClick);
            if (this.barEl.parentNode) this.barEl.parentNode.removeChild(this.barEl);
            this.barEl = null;
        }
        // 飛行中の絵文字も撤去
        if (this.host) {
            this.host.querySelectorAll('.kotaete-emoji-float').forEach(el => {
                if (el.parentNode) el.parentNode.removeChild(el);
            });
        }
        if (this.styleEl && this.styleEl.parentNode) {
            this.styleEl.parentNode.removeChild(this.styleEl);
            this.styleEl = null;
        }
        this.host = null;
    }
}
