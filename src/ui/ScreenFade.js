// Shared fade-to-ink curtain for screen transitions.
//
// A single full-screen overlay that every screen change can fade through, so
// transitions (title → world, world → song, song → world, …) cross-dissolve
// instead of cutting hard. Sits above all screens; only captures input while
// a fade is in progress.
import { stageRoot } from '../core/stage.js';

class ScreenFade {
    constructor() {
        this.el = null;
        // フェードの世代番号。フェードが重なったとき、後発が古いタイマーを clearTimeout して
        // 先発の Promise が永遠に resolve されない(=待っている側が固まる)事故を防ぐため、
        // 各フェードは自分のタイマーで必ず resolve し、副作用(入力ブロック解除)だけを
        // 最新のフェードに限定する。
        this._seq = 0;
    }

    _ensure() {
        if (this.el) return;
        const d = document.createElement('div');
        d.id = 'screen-fade';
        d.style.cssText = `
            position: absolute; inset: 0; z-index: 3000;
            background: #05070d;
            opacity: 0; pointer-events: none;
            transition: opacity 0.5s ease;
        `;
        stageRoot().appendChild(d);
        this.el = d;
    }

    /** Fade the curtain to opaque (cover the current screen). */
    fadeOut(ms = 500) {
        this._ensure();
        const el = this.el;
        el.style.transition = `opacity ${ms}ms ease`;
        el.style.pointerEvents = 'auto'; // block interaction mid-transition
        void el.offsetWidth;             // commit current opacity so the change animates
        el.style.opacity = '1';
        ++this._seq;
        return new Promise(resolve => { setTimeout(resolve, ms); });
    }

    /** Fade the curtain back to transparent (reveal the new screen). */
    fadeIn(ms = 600) {
        this._ensure();
        const el = this.el;
        el.style.transition = `opacity ${ms}ms ease`;
        void el.offsetWidth;
        el.style.opacity = '0';
        const seq = ++this._seq;
        return new Promise(resolve => {
            setTimeout(() => {
                // 途中で別のフェードに置き換わっていたら入力ブロックはそちらに任せる
                if (seq === this._seq) el.style.pointerEvents = 'none';
                resolve();
            }, ms);
        });
    }

    /** Cover → run swapFn (swap screens behind the curtain) → reveal. */
    async cover(swapFn, { out = 500, in: inMs = 600, hold = 0 } = {}) {
        await this.fadeOut(out);
        if (swapFn) await swapFn();
        if (hold) await new Promise(r => setTimeout(r, hold));
        await this.fadeIn(inMs);
    }
}

export const screenFade = new ScreenFade();
