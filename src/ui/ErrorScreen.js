/**
 * 全画面エラーオーバーレイ。
 * 主用途: TextAlive(歌詞データ)の読込失敗時に「何も出ない」を防ぎ、
 * 原因とリトライ/戻る導線を明示する(評価レポート: 直URLで何も見えないリスクの解消)。
 *
 * index.html の #error-screen を再利用。カーテン(z3000)・ローディング(z3200)より
 * 前面に出すため z-index を上書きする。
 */
export class ErrorScreen {
    constructor() {
        this.el = document.getElementById('error-screen');
        this._built = false;
    }

    _build() {
        if (this._built || !this.el) return;
        this.el.style.zIndex = '3400';
        this.el.style.flexDirection = 'column';
        this.el.style.gap = '22px';
        this.el.style.textAlign = 'center';
        this.el.style.padding = '24px';
        this.el.style.transition = 'opacity 0.4s ease';

        this.icon = document.createElement('div');
        this.icon.style.cssText = 'font-size:34px;opacity:0.85;';
        this.icon.textContent = '⚠';

        this.titleEl = document.createElement('div');
        this.titleEl.style.cssText = 'font-size:clamp(18px,4vw,24px);font-weight:400;letter-spacing:0.12em;';

        this.msgEl = document.createElement('div');
        this.msgEl.style.cssText = 'font-size:clamp(12px,2.6vw,15px);font-weight:300;letter-spacing:0.06em;opacity:0.75;line-height:1.8;max-width:30em;';

        this.actions = document.createElement('div');
        this.actions.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-top:6px;';

        this.el.appendChild(this.icon);
        this.el.appendChild(this.titleEl);
        this.el.appendChild(this.msgEl);
        this.el.appendChild(this.actions);
        this._built = true;
    }

    /**
     * @param {object} o
     * @param {string} o.title 見出し
     * @param {string} o.message 本文
     * @param {Array<{label:string,onClick:Function,primary?:boolean}>} o.actions ボタン群
     */
    show({ title = 'エラーが発生しました', message = '', actions = [] } = {}) {
        if (!this.el) return;
        this._build();
        this.titleEl.textContent = title;
        this.msgEl.textContent = message;
        this.actions.textContent = '';
        actions.forEach((a) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = a.label;
            btn.style.cssText = `
                padding: 11px 26px;
                font-family: 'Noto Sans JP','Inter',sans-serif;
                font-size: 14px; letter-spacing: 0.12em; cursor: pointer;
                border-radius: 24px;
                -webkit-tap-highlight-color: transparent;
                transition: background 0.2s ease, border-color 0.2s ease, transform 0.1s ease;
                color: ${a.primary ? '#04122e' : 'rgba(255,255,255,0.9)'};
                background: ${a.primary ? 'rgba(150,210,255,0.95)' : 'rgba(255,255,255,0.08)'};
                border: 1px solid ${a.primary ? 'rgba(150,210,255,0.95)' : 'rgba(255,255,255,0.3)'};
            `;
            btn.addEventListener('pointerdown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hide();
                if (a.onClick) a.onClick();
            });
            this.actions.appendChild(btn);
        });

        this.el.style.display = 'flex';
        this.el.style.pointerEvents = 'auto';
        void this.el.offsetWidth;
        this.el.style.opacity = '1';
    }

    hide() {
        if (!this.el) return;
        this.el.style.opacity = '0';
        this.el.style.pointerEvents = 'none';
        setTimeout(() => { if (this.el.style.opacity === '0') this.el.style.display = 'none'; }, 420);
    }
}
