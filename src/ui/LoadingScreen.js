/**
 * ローディング画面(進捗リング付き)。
 * TextAlive は読込%を返さないため、体感的な進捗を「擬似進捗リング」で見せる:
 *   show() で 0 → 0.9 まで滑らかに自走し、hide() で 1.0 まで満たして「準備完了」感を出す。
 * index.html の #loading-screen を再利用(z-index はカーテンより前面=base.cssで3200)。
 */
export class LoadingScreen {
    constructor() {
        this.el = document.getElementById('loading-screen');
        this._built = false;
        this._raf = null;
        this._p = 0;          // 表示中の進捗 0..1
        this._target = 0;     // 目標進捗
        this._C = 2 * Math.PI * 26; // リングの円周(r=26)
        this._hideTimer = null;
    }

    _build() {
        if (this._built || !this.el) return;
        this.el.textContent = '';
        this.el.style.flexDirection = 'column';
        this.el.style.gap = '20px';

        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:64px;height:64px;';
        wrap.innerHTML = `
            <svg width="64" height="64" viewBox="0 0 64 64" style="transform:rotate(-90deg)">
              <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3"/>
              <circle class="ls-arc" cx="32" cy="32" r="26" fill="none" stroke="rgba(150,210,255,0.95)"
                      stroke-width="3" stroke-linecap="round"
                      stroke-dasharray="${this._C}" stroke-dashoffset="${this._C}"
                      style="filter:drop-shadow(0 0 6px rgba(150,210,255,0.7))"/>
            </svg>`;
        this.arc = wrap.querySelector('.ls-arc');

        this.label = document.createElement('div');
        this.label.textContent = '波紋を読み込んでいます…';
        this.label.style.cssText = 'font-size:16px;font-weight:300;letter-spacing:0.18em;';

        this.el.appendChild(wrap);
        this.el.appendChild(this.label);
        this._built = true;
    }

    _apply() {
        if (this.arc) this.arc.setAttribute('stroke-dashoffset', String(this._C * (1 - this._p)));
    }

    _loop() {
        this._p += (this._target - this._p) * 0.05;
        this._apply();
        this._raf = requestAnimationFrame(() => this._loop());
    }

    show() {
        if (!this.el) return;
        this._build();
        if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
        this._p = 0; this._target = 0.9;
        this._apply();
        this.el.style.display = 'flex';
        void this.el.offsetWidth;
        this.el.style.opacity = '1';
        if (this._raf) cancelAnimationFrame(this._raf);
        this._loop();
    }

    hide() {
        if (!this.el) return;
        // 100%まで満たして「準備完了」を一瞬見せてからフェードアウト
        this._target = 1;
        this._hideTimer = setTimeout(() => {
            if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
            this._p = 1; this._apply();
            this.el.style.opacity = '0';
            setTimeout(() => { if (this.el.style.opacity === '0') this.el.style.display = 'none'; }, 480);
        }, 280);
    }
}
