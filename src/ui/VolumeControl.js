import { playerManager } from '../core/player.js';
import { eventBus } from '../core/eventBus.js';

/**
 * 全楽曲共通の音量コントロール(画面右下に常設)。
 * - スライダーで音量 0-100
 * - ミュートボタン(再押下で元の音量に復帰)
 * - 設定は localStorage に保存され、曲をまたいで維持される
 */
export class VolumeControl {
    constructor() {
        this.volume = this._load('appVolume', 80);
        this.muted = this._load('appMuted', 0) === 1;

        this._injectStyles();
        this._build();
        this._applyToPlayer();
        this.hide(); // タイトル画面では非表示(タイトル通過後にshow()される)

        // 曲のロード完了ごとに保存値を適用(プレイヤーが作り直されても維持)
        this._boundApply = () => this._applyToPlayer();
        eventBus.on('timerReady', this._boundApply);
        eventBus.on('songChange', this._boundApply);
    }

    show() {
        if (this.el) this.el.style.display = 'flex';
    }

    hide() {
        if (this.el) this.el.style.display = 'none';
    }

    _load(key, fallback) {
        const v = parseInt(localStorage.getItem(key), 10);
        return Number.isFinite(v) ? v : fallback;
    }

    _effectiveVolume() {
        return this.muted ? 0 : this.volume;
    }

    _applyToPlayer() {
        playerManager.setVolume(this._effectiveVolume());
    }

    _save() {
        localStorage.setItem('appVolume', String(this.volume));
        localStorage.setItem('appMuted', this.muted ? '1' : '0');
    }

    _build() {
        this.el = document.createElement('div');
        this.el.className = 'app-volume-control';
        this.el.innerHTML = `
            <button class="app-volume-mute" aria-label="ミュート切り替え" title="ミュート"></button>
            <input class="app-volume-slider" type="range" min="0" max="100" step="1"
                   aria-label="音量" value="${this.volume}">
        `;
        document.body.appendChild(this.el);

        this.muteBtn = this.el.querySelector('.app-volume-mute');
        this.slider = this.el.querySelector('.app-volume-slider');

        this.slider.addEventListener('input', () => {
            this.volume = parseInt(this.slider.value, 10);
            if (this.volume > 0 && this.muted) this.muted = false;
            this._applyToPlayer();
            this._save();
            this._refresh();
        });

        this.muteBtn.addEventListener('click', () => {
            this.muted = !this.muted;
            this._applyToPlayer();
            this._save();
            this._refresh();
        });

        this._refresh();
    }

    _refresh() {
        const v = this._effectiveVolume();
        this.muteBtn.textContent = this.muted || v === 0 ? '🔇' : (v < 40 ? '🔉' : '🔊');
        this.slider.value = String(this.volume);
        this.slider.style.setProperty('--vol', `${this.volume}%`);
        this.el.classList.toggle('muted', this.muted);
    }

    _injectStyles() {
        const style = document.createElement('style');
        style.id = 'app-volume-style';
        style.textContent = `
            .app-volume-control {
                position: fixed;
                right: 14px;
                bottom: 64px;
                z-index: 1200;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 7px 12px 7px 8px;
                border-radius: 22px;
                background: rgba(8, 12, 24, 0.62);
                border: 1px solid rgba(255, 255, 255, 0.18);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                transition: opacity 0.3s ease;
            }
            .app-volume-mute {
                width: 30px;
                height: 30px;
                border: none;
                background: transparent;
                font-size: 17px;
                cursor: pointer;
                line-height: 1;
                padding: 0;
                -webkit-tap-highlight-color: transparent;
            }
            .app-volume-slider {
                -webkit-appearance: none;
                appearance: none;
                width: 110px;
                height: 4px;
                border-radius: 2px;
                background: linear-gradient(to right,
                    rgba(255,255,255,0.9) var(--vol, 80%),
                    rgba(255,255,255,0.22) var(--vol, 80%));
                outline: none;
                cursor: pointer;
            }
            .app-volume-control.muted .app-volume-slider {
                background: linear-gradient(to right,
                    rgba(255,255,255,0.35) var(--vol, 80%),
                    rgba(255,255,255,0.15) var(--vol, 80%));
            }
            .app-volume-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 0 6px rgba(0,0,0,0.5);
            }
            .app-volume-slider::-moz-range-thumb {
                width: 14px;
                height: 14px;
                border: none;
                border-radius: 50%;
                background: #fff;
            }
            @media (max-width: 600px) {
                .app-volume-control { bottom: 110px; right: 10px; }
                .app-volume-slider { width: 80px; }
            }
        `;
        document.head.appendChild(style);
    }
}
