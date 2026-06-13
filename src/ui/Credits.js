import { SONGS } from '../config/songs.js';

/**
 * クレジット表示オーバーレイ。
 * - 楽曲名 / 作詞・作曲者 / 歌唱の一覧
 * - 開発メンバー欄(後から名前を追記できるよう枠を確保)
 *
 * タイトル画面の右下ボタンからのみ開かれる。
 */

// 開発メンバーは後から追記する。空配列のままだと "（準備中）" と表示される。
// 例: const DEV_MEMBERS = [{ role: '企画・実装', name: '山田太郎' }];
const DEV_MEMBERS = [];

export class Credits {
    constructor() {
        this.el = null;
        this._boundKeydown = null;
    }

    open() {
        if (this.el) return;
        this._injectStyles();

        this.el = document.createElement('div');
        this.el.className = 'credits-overlay';

        const songRows = SONGS.map((s) => `
            <div class="credits-song">
                <div class="credits-song-title">${s.title}</div>
                <div class="credits-song-meta">
                    <span class="credits-label">作詞・作曲</span>${s.artist}
                    <span class="credits-dot">・</span>
                    <span class="credits-label">歌</span>${s.vocal}
                </div>
            </div>
        `).join('');

        const devRows = DEV_MEMBERS.length
            ? DEV_MEMBERS.map((m) => `
                <div class="credits-dev-row">
                    <span class="credits-label">${m.role}</span>${m.name}
                </div>`).join('')
            : `<div class="credits-dev-placeholder">（開発メンバーは後日掲載）</div>`;

        this.el.innerHTML = `
            <div class="credits-panel" role="dialog" aria-label="クレジット">
                <button class="credits-close" aria-label="閉じる">×</button>
                <h2 class="credits-heading">Lake Sonare</h2>
                <p class="credits-subheading">湖のソナーレ — クレジット</p>

                <section class="credits-section">
                    <h3 class="credits-section-title">楽曲</h3>
                    <div class="credits-song-list">${songRows}</div>
                </section>

                <section class="credits-section">
                    <h3 class="credits-section-title">開発</h3>
                    <div class="credits-dev-list">${devRows}</div>
                </section>

                <p class="credits-note">
                    楽曲はマジカルミライ2026 プログラミングコンテスト課題曲を使用しています。<br>
                    歌詞・タイミングは TextAlive App API を通じて取得しています。<br>
                    楽曲・キャラクターは piapro キャラクター・ライセンスに基づいて利用しています。
                </p>
            </div>
        `;

        document.body.appendChild(this.el);

        // 閉じる: ×ボタン / 背景クリック / Escape
        this.el.querySelector('.credits-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        this.el.addEventListener('click', (e) => {
            if (e.target === this.el) this.close();
        });
        this._boundKeydown = (e) => {
            if (e.code === 'Escape') {
                e.stopPropagation();
                this.close();
            }
        };
        // capture段階で握り、タイトル側のEscape等に伝播させない
        window.addEventListener('keydown', this._boundKeydown, true);

        requestAnimationFrame(() => this.el.classList.add('visible'));
    }

    close() {
        if (!this.el) return;
        if (this._boundKeydown) {
            window.removeEventListener('keydown', this._boundKeydown, true);
            this._boundKeydown = null;
        }
        this.el.classList.remove('visible');
        const el = this.el;
        this.el = null;
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    }

    _injectStyles() {
        if (document.getElementById('credits-style')) return;
        const style = document.createElement('style');
        style.id = 'credits-style';
        style.textContent = `
            .credits-overlay {
                position: fixed; inset: 0; z-index: 3000;
                display: flex; align-items: center; justify-content: center;
                background: rgba(2, 6, 14, 0.72);
                backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
                opacity: 0; transition: opacity 0.4s ease;
                padding: 24px; box-sizing: border-box;
            }
            .credits-overlay.visible { opacity: 1; }
            .credits-panel {
                position: relative;
                width: min(560px, 92vw);
                max-height: 86vh; overflow-y: auto;
                padding: 36px 34px 30px;
                border-radius: 18px;
                background: rgba(10, 16, 30, 0.92);
                border: 1px solid rgba(255, 255, 255, 0.14);
                box-shadow: 0 20px 70px rgba(0, 0, 0, 0.55);
                color: #fff;
                font-family: 'Noto Sans JP', 'Inter', sans-serif;
                transform: translateY(14px); transition: transform 0.4s ease;
            }
            .credits-overlay.visible .credits-panel { transform: translateY(0); }
            .credits-close {
                position: absolute; top: 14px; right: 16px;
                width: 34px; height: 34px;
                border: none; border-radius: 50%;
                background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8);
                font-size: 20px; line-height: 1; cursor: pointer;
                transition: background 0.2s ease;
            }
            .credits-close:hover { background: rgba(255,255,255,0.2); }
            .credits-heading {
                margin: 0; font-size: 26px; font-weight: 300;
                letter-spacing: 0.18em; font-family: 'Inter', sans-serif;
            }
            .credits-subheading {
                margin: 4px 0 26px; font-size: 12px;
                letter-spacing: 0.2em; color: rgba(255,255,255,0.5);
            }
            .credits-section { margin-bottom: 26px; }
            .credits-section-title {
                margin: 0 0 14px; font-size: 13px; font-weight: 500;
                letter-spacing: 0.28em; color: rgba(160, 200, 255, 0.85);
                border-bottom: 1px solid rgba(255,255,255,0.12);
                padding-bottom: 7px;
            }
            .credits-song { padding: 9px 0; }
            .credits-song + .credits-song { border-top: 1px solid rgba(255,255,255,0.06); }
            .credits-song-title {
                font-size: 16px; font-weight: 500; letter-spacing: 0.04em;
            }
            .credits-song-meta {
                margin-top: 3px; font-size: 12.5px;
                color: rgba(255,255,255,0.72); letter-spacing: 0.03em;
            }
            .credits-label {
                display: inline-block; margin-right: 6px;
                font-size: 10.5px; color: rgba(255,255,255,0.4);
            }
            .credits-dot { margin: 0 8px; color: rgba(255,255,255,0.3); }
            .credits-dev-row { padding: 7px 0; font-size: 14px; }
            .credits-dev-placeholder {
                padding: 14px 0; font-size: 13px;
                color: rgba(255,255,255,0.4); font-style: italic;
            }
            .credits-note {
                margin: 22px 0 0; font-size: 11px; line-height: 1.8;
                color: rgba(255,255,255,0.42); letter-spacing: 0.04em;
            }
            @media (max-width: 600px) {
                .credits-panel { padding: 28px 20px 24px; }
                .credits-heading { font-size: 22px; }
            }
        `;
        document.head.appendChild(style);
    }
}
