// Shared fade-to-ink curtain for screen transitions.
//
// A single full-screen overlay that every screen change can fade through, so
// transitions (title → world, world → song, song → world, …) cross-dissolve
// instead of cutting hard. Sits above all screens; only captures input while
// a fade is in progress.
class ScreenFade {
    constructor() {
        this.el = null;
        this._timer = null;
    }

    _ensure() {
        if (this.el) return;
        const d = document.createElement('div');
        d.id = 'screen-fade';
        d.style.cssText = `
            position: fixed; inset: 0; z-index: 3000;
            background: #05070d;
            opacity: 0; pointer-events: none;
            transition: opacity 0.5s ease;
        `;
        document.body.appendChild(d);
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
        clearTimeout(this._timer);
        return new Promise(resolve => { this._timer = setTimeout(resolve, ms); });
    }

    /** Fade the curtain back to transparent (reveal the new screen). */
    fadeIn(ms = 600) {
        this._ensure();
        const el = this.el;
        el.style.transition = `opacity ${ms}ms ease`;
        void el.offsetWidth;
        el.style.opacity = '0';
        clearTimeout(this._timer);
        return new Promise(resolve => {
            this._timer = setTimeout(() => { el.style.pointerEvents = 'none'; resolve(); }, ms);
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
