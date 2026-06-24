import { playerManager } from '../core/player.js';
import { eventBus } from '../core/eventBus.js';
import { stageRoot } from '../core/stage.js';

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
        stageRoot().appendChild(this.el);

        this.muteBtn = this.el.querySelector('.app-volume-mute');
        this.slider = this.el.querySelector('.app-volume-slider');

        this.slider.addEventListener('input', () => {
            this.volume = parseInt(this.slider.value, 10);
            if (this.volume > 0 && this.muted) this.muted = false;
            this._applyToPlayer();
            this._save();
            this._refresh();
            eventBus.emit('appVolumeChange', this._effectiveVolume());
        });

        this.muteBtn.addEventListener('click', () => {
            this.muted = !this.muted;
            this._applyToPlayer();
            this._save();
            this._refresh();
            eventBus.emit('appVolumeChange', this._effectiveVolume());
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
                position: absolute;
                right: calc(12px + env(safe-area-inset-right, 0px));
                top: 50%;
                transform: translateY(-50%);
                z-index: 1200;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                padding: 12px 8px;
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
                writing-mode: vertical-lr;
                direction: rtl;            /* 下=0, 上=100 */
                width: 5px;
                height: 130px;
                border-radius: 3px;
                background: linear-gradient(to top,
                    rgba(255,255,255,0.9) var(--vol, 80%),
                    rgba(255,255,255,0.22) var(--vol, 80%));
                outline: none;
                cursor: pointer;
            }
            .app-volume-control.muted .app-volume-slider {
                background: linear-gradient(to top,
                    rgba(255,255,255,0.35) var(--vol, 80%),
                    rgba(255,255,255,0.15) var(--vol, 80%));
            }
            .app-volume-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 15px;
                height: 15px;
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 0 6px rgba(0,0,0,0.5);
            }
            .app-volume-slider::-moz-range-thumb {
                width: 15px;
                height: 15px;
                border: none;
                border-radius: 50%;
                background: #fff;
            }
            @media (max-width: 600px) {
                /* モバイルでは中央右の本文・選曲ラベルに被るため、占有面積を小さくし
                   通常時は半透明にして背後の内容を読めるようにする(操作中は不透明に戻す) */
                .app-volume-control {
                    right: calc(6px + env(safe-area-inset-right, 0px));
                    padding: 8px 4px;
                    gap: 6px;
                    border-radius: 16px;
                    opacity: 0.5;
                    transition: opacity 0.25s ease;
                }
                .app-volume-control:active,
                .app-volume-control:focus-within {
                    opacity: 1;
                }
                .app-volume-mute { width: 24px; height: 24px; font-size: 14px; }
                .app-volume-slider { width: 4px; height: 78px; }
                .app-volume-slider::-webkit-slider-thumb { width: 13px; height: 13px; }
                .app-volume-slider::-moz-range-thumb { width: 13px; height: 13px; }
            }
        `;
        document.head.appendChild(style);
    }
}
