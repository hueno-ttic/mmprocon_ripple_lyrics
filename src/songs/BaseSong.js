import { eventBus } from '../core/eventBus.js';
import { LyricRenderer } from '../ui/LyricRenderer.js';
import { SONGS } from '../config/songs.js';
import { appState } from '../core/appState.js';
import { playerManager } from '../core/player.js';
import { quality } from '../core/quality.js';

export class BaseSong {
    constructor(container, songId) {
        this.container = container;
        this.songId = songId;
        this.isActive = false;
        
        this.songWrapper = document.createElement('div');
        this.songWrapper.id = `song-wrapper-${songId}`;
        this.songWrapper.style.position = 'absolute';
        this.songWrapper.style.top = '0';
        this.songWrapper.style.left = '0';
        this.songWrapper.style.width = '100%';
        this.songWrapper.style.height = '100%';
        this.container.appendChild(this.songWrapper);

        // Initialize generic LyricRenderer
        this.lyricRenderer = new LyricRenderer(this.songWrapper);
        const songConfig = SONGS.find(s => s.id === songId);
        if (songConfig && songConfig.color) {
            this.lyricRenderer.setThemeColor(songConfig.color);
        }

        // References to clear up on destroy
        this.animationId = null;
        this.boundAnimate = this.animate.bind(this);
        this.boundOnTimeUpdate = this.onTimeUpdate.bind(this);
        this.boundOnClick = this.onClick.bind(this);
        this.boundOnMouseMove = this.onMouseMove.bind(this);
        
        this.currentTime = 0;
        this.lastTimeUpdateRealTime = 0; // 実時間記録用のプロパティを初期化
        this.mouseX = 0;
        this.mouseY = 0;
        this.targetCameraRotX = 0;
        this.targetCameraRotY = 0;
        
        // Add listeners for interaction
        this.songWrapper.addEventListener('click', this.boundOnClick);
        window.addEventListener('mousemove', this.boundOnMouseMove);
    }

    init() {
        this.isActive = true;
        eventBus.on('timeUpdate', this.boundOnTimeUpdate);
        this.animationId = requestAnimationFrame(this.boundAnimate);
        console.log(`Initialized song scene: ${this.songId}`);

        const showTutorialOrHint = () => {
            const songConfig = SONGS.find(s => s.id === this.songId);
            if (songConfig && songConfig.tutorial) {
                this.showTutorial(songConfig);
            } else if (songConfig && songConfig.hint) {
                this.showHintUI(songConfig.hint, songConfig.color);
            }
        };

        // Delay tutorial and hint displays until the loading screen is fully hidden and player is ready
        if (playerManager.isTimerReady) {
            showTutorialOrHint();
        } else {
            this.boundOnTimerReady = () => {
                showTutorialOrHint();
                eventBus.off('timerReady', this.boundOnTimerReady);
            };
            eventBus.on('timerReady', this.boundOnTimerReady);
        }
    }

    /**
     * チュートリアル「スタート」相当の頭出し再生処理。
     * Web Audio アンロック → seek(0) / fadeIn / play までを一括で行う。
     * 初回(オーバーレイのスタート押下)と2回目以降(オーバーレイ非表示)の
     * 両方から呼び出され、挙動を共通化する。
     */
    _autoStartPlayback() {
        if (!playerManager.isTimerReady) return;
        try {
            const audioCtx = window.AudioContext || window.webkitAudioContext;
            if (audioCtx) {
                const dummyCtx = new audioCtx();
                if (dummyCtx.state === 'suspended') {
                    dummyCtx.resume();
                }
            }
            if (playerManager.player && playerManager.player.audioContext) {
                const ctx = playerManager.player.audioContext;
                if (ctx.state === 'suspended') {
                    ctx.resume();
                }
            }
        } catch (err) {
            console.warn('[Lake Sonare] Web Audio unlock failed safely: ', err);
        }
        playerManager.seek(0);
        playerManager.fadeIn(1200); // 曲の頭出しをなめらかに
        playerManager.play();

        // 再生開始直後、各曲固有の操作ヒントを一瞬だけ再提示する(共通機構)。
        // チュートリアルを読み飛ばしたユーザーでも固有操作に気づけるようにする狙い。
        // 文言は各曲から showStartHint(text) で注入できるが、未指定でも汎用文言で動作する。
        this.showStartHint();
    }

    /**
     * 再生開始直後に短い操作ヒントを一瞬(約3.6秒)だけ表示してフェードアウトする共通機構。
     * 各曲は固有の文言を渡すだけで利用できる(例: this.showStartHint('歌詞をタップ'))。
     * 文言が無い場合は songConfig の startHint / hint、チュートリアル手順、
     * 最終的に汎用文言へとフォールバックするため、引数なしでも必ず何かを提示する。
     *
     * - pointer-events:none で操作の邪魔をしない
     * - 数秒で自動フェードアウト
     * - モバイルでも収まるよう横幅と折返しを許容
     *
     * @param {string} [text] 表示する操作ヒント文言(HTML可)。省略時はフォールバック。
     */
    showStartHint(text) {
        const songConfig = SONGS.find(s => s.id === this.songId);
        const color = (songConfig && songConfig.color) || '#7F77DD';

        const hintText = this._resolveStartHintText(text, songConfig);
        if (!hintText) return; // 念のため(基本は汎用文言で必ず埋まる)

        this._ensureStartHintStyles();

        // 連打や再呼び出しで重複表示されないよう、既存分は片付ける
        if (this._startHintEl && this._startHintEl.parentNode) {
            clearTimeout(this._startHintFadeTimer);
            clearTimeout(this._startHintRemoveTimer);
            this._startHintEl.parentNode.removeChild(this._startHintEl);
            this._startHintEl = null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'song-start-hint';
        overlay.style.setProperty('--start-hint-color', color);
        overlay.innerHTML = `
            <span class="song-start-hint-icon" aria-hidden="true">✦</span>
            <span class="song-start-hint-text">${hintText}</span>
        `;

        this.songWrapper.appendChild(overlay);
        this._startHintEl = overlay;

        // フェードイン
        requestAnimationFrame(() => {
            requestAnimationFrame(() => overlay.classList.add('visible'));
        });

        // 表示維持 → フェードアウト → 除去
        const HOLD_MS = 3600;
        const FADE_MS = 700;
        this._startHintFadeTimer = setTimeout(() => {
            overlay.classList.remove('visible');
            overlay.classList.add('fade-out');
            this._startHintRemoveTimer = setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                if (this._startHintEl === overlay) this._startHintEl = null;
            }, FADE_MS);
        }, HOLD_MS);
    }

    /**
     * showStartHint の文言フォールバック解決。
     * 優先順: 明示引数 → songConfig.startHint → songConfig.hint
     *          → チュートリアル手順から操作系の一行 → 汎用文言。
     */
    _resolveStartHintText(text, songConfig) {
        const explicit = typeof text === 'string' ? text.trim() : '';
        if (explicit) return explicit;

        if (songConfig) {
            if (typeof songConfig.startHint === 'string' && songConfig.startHint.trim()) {
                return songConfig.startHint.trim();
            }
            if (typeof songConfig.hint === 'string' && songConfig.hint.trim()) {
                return songConfig.hint.trim();
            }
            // チュートリアル手順から操作を示唆する一行を拾う(タップ/ドラッグ/タッチ/撮影など)
            const steps = songConfig.tutorial && Array.isArray(songConfig.tutorial.steps)
                ? songConfig.tutorial.steps
                : [];
            const actionKeywords = ['タッチ', 'タップ', 'ドラッグ', 'スワイプ', '撮影', '押', '触', '選', 'なぞ'];
            const actionStep = steps.find(s =>
                s && typeof s.text === 'string' &&
                actionKeywords.some(k => s.text.includes(k))
            );
            if (actionStep) return actionStep.text;
            if (steps.length && typeof steps[0].text === 'string') return steps[0].text;
        }

        // 汎用フォールバック文言
        return '画面や流れる歌詞にタッチして、演出を楽しもう';
    }

    /**
     * 開始ヒント用のスタイルを1度だけ注入する(CSS-in-JS)。
     * 既存のチュートリアル/ヒント CSS(theme.css)とは独立。
     */
    _ensureStartHintStyles() {
        if (document.getElementById('song-start-hint-styles')) return;
        const style = document.createElement('style');
        style.id = 'song-start-hint-styles';
        style.textContent = `
            .song-start-hint {
                position: absolute;
                top: 18%;
                left: 50%;
                transform: translate(-50%, -16px);
                display: flex;
                align-items: center;
                gap: 10px;
                max-width: min(86vw, 560px);
                padding: 11px 22px;
                border-radius: 999px;
                border: 1px solid color-mix(in srgb, var(--start-hint-color, #7F77DD) 55%, rgba(255,255,255,0.25));
                background: rgba(8, 10, 18, 0.5);
                backdrop-filter: blur(14px) saturate(150%);
                -webkit-backdrop-filter: blur(14px) saturate(150%);
                color: #ffffff;
                font-family: 'Inter', 'Noto Sans JP', sans-serif;
                font-size: 14px;
                font-weight: 600;
                line-height: 1.45;
                text-align: center;
                letter-spacing: 0.4px;
                pointer-events: none;
                opacity: 0;
                z-index: 1000;
                box-shadow: 0 10px 36px rgba(0,0,0,0.4),
                            0 0 18px color-mix(in srgb, var(--start-hint-color, #7F77DD) 40%, transparent);
                transition: transform 0.7s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.55s ease;
            }
            .song-start-hint.visible {
                transform: translate(-50%, 0);
                opacity: 1;
            }
            .song-start-hint.fade-out {
                transform: translate(-50%, -24px);
                opacity: 0;
            }
            .song-start-hint-icon {
                font-size: 16px;
                color: var(--start-hint-color, #7F77DD);
                filter: drop-shadow(0 0 6px var(--start-hint-color, #7F77DD));
                animation: songStartHintPulse 1.8s infinite ease-in-out;
            }
            .song-start-hint-text {
                text-shadow: 0 2px 6px rgba(0,0,0,0.55);
            }
            @keyframes songStartHintPulse {
                0%, 100% { transform: scale(1); opacity: 0.9; }
                50% { transform: scale(1.25); opacity: 1; }
            }
            @media (max-width: 600px) {
                .song-start-hint {
                    top: 14%;
                    font-size: 13px;
                    padding: 10px 18px;
                    max-width: 90vw;
                }
            }
            @media (prefers-reduced-motion: reduce) {
                .song-start-hint,
                .song-start-hint-icon {
                    transition-duration: 0.2s;
                    animation: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    showTutorial(songConfig) {
        const { tutorial, themeQuestion = '', color = '#7F77DD', bareQuestion = false } = songConfig;

        // 全楽曲で毎回チュートリアルを表示する(既読スキップは行わない)

        // チュートリアル表示フラグを有効化
        this.isTutorialActive = true;

        // 意図しない自動再生を防ぐため、ロード直後の場合は即座に一時停止を要求
        if (playerManager.player && playerManager.player.isPlaying) {
            playerManager.pause();
        }

        const overlay = document.createElement('div');
        overlay.className = 'song-tutorial-overlay';
        overlay.style.setProperty('--tutorial-color', color);

        const stepsHtml = tutorial.steps.map(s => `
            <div class="song-tutorial-step">
                <span class="step-icon">${s.icon}</span>
                <span>${s.text}</span>
            </div>
        `).join('');

        overlay.innerHTML = `
            <div class="song-tutorial-content">
                <div class="song-tutorial-label">問い</div>
                <p class="song-tutorial-question">${bareQuestion ? themeQuestion : `「${themeQuestion}」`}</p>
                <div class="song-tutorial-divider"></div>
                <div class="song-tutorial-steps">${stepsHtml}</div>
                <button class="song-tutorial-btn">スタート</button>
            </div>
        `;

        this.songWrapper.appendChild(overlay);
        setTimeout(() => overlay.classList.add('visible'), 100);

        const dismiss = () => {
            this.isTutorialActive = false; // フラグを解除
            clearTimeout(this._tutorialDismissTimer);
            overlay.classList.remove('visible');
            overlay.classList.add('fade-out');
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 700);
        };

        overlay.querySelector('.song-tutorial-btn').addEventListener('click', () => {
            dismiss();
            // Start song playback immediately upon tutorial dismiss (with Web Audio unlock)
            this._autoStartPlayback();
        });
        if (playerManager.managed) {
            this._tutorialDismissTimer = setTimeout(dismiss, 15000);
        }
    }

    /**
     * 曲のプレイ成果を登録する。曲終了オーバーレイ(main.js)に
     * 曲固有のサマリーとして表示される。何度呼んでも最新値で上書き。
     * @param {{lines: string[], accentColor?: string, swatch?: string}} summary
     */
    setResultSummary(summary) {
        eventBus.emit('songResult', { songId: this.songId, ...summary });
    }

    showHintUI(hintText, themeColor) {
        const hintOverlay = document.createElement('div');
        hintOverlay.className = 'song-hint-overlay';
        hintOverlay.innerHTML = `
            <div class="song-hint-icon">💡</div>
            <div class="song-hint-text">${hintText}</div>
        `;
        
        if (themeColor) {
            hintOverlay.style.setProperty('--theme-color', themeColor);
            hintOverlay.style.borderColor = themeColor;
            hintOverlay.style.boxShadow = `0 8px 32px 0 rgba(0, 0, 0, 0.3), 0 0 15px ${themeColor}`;
        }
        
        this.songWrapper.appendChild(hintOverlay);

        // Fade in smoothly
        setTimeout(() => {
            hintOverlay.classList.add('visible');
        }, 100);

        // Fade out and remove
        setTimeout(() => {
            hintOverlay.classList.remove('visible');
            hintOverlay.classList.add('fade-out');
            setTimeout(() => {
                if (hintOverlay.parentNode) {
                    hintOverlay.parentNode.removeChild(hintOverlay);
                }
            }, 800);
        }, 5000);
    }

    onTimeUpdate(position) {
        this.currentTime = position;
        this.lastTimeUpdateRealTime = performance.now(); // タイマー位置更新時の実時間を高精度に記録

        // チュートリアル表示中に勝手に自動再生が開始された場合の強制停止＆巻き戻しガード
        // 不要なAPIコールによる洪水（ポストメッセージ詰まり）を防ぐため、
        // プレイヤー側（player.js）の throttled guard に任せ、ここでは currentTime の同期のみ行う
        if (this.isTutorialActive) {
            this.currentTime = 0;
        }
    }

    /**
     * TextAlive の粗いタイマー更新（100ms〜1000msごと）を rAF 解像度に補間する。
     * 重要: elapsed が 350ms を超えても currentTime に戻さない。
     * 戻すと age = position - birth が負になり opacity=0（消える）バグが発生する。
     * 最大 2000ms まで補間を継続し、次の onTimeUpdate で自動リセットされる。
     */
    getSmoothedTime() {
        if (!this.lastTimeUpdateRealTime || !appState.isPlaying) {
            return this.currentTime;
        }
        const elapsed = Math.min(performance.now() - this.lastTimeUpdateRealTime, 2000);
        return elapsed > 0 ? this.currentTime + elapsed : this.currentTime;
    }

    onMouseMove(event) {
        if (!this.isActive) return;
        // Normalize mouse coordinates to -1 to +1
        this.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Set target rotation (subtle parallax)
        this.targetCameraRotY = -this.mouseX * 0.05;
        this.targetCameraRotX = this.mouseY * 0.05;
    }

    onClick(event) {
        if (!this.isActive) return;
        
        // Create interactive ripple effect
        const ripple = document.createElement('div');
        ripple.className = 'interactive-ripple';
        
        // Position at click
        const rect = this.songWrapper.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        
        // Apply theme color if available
        const songConfig = SONGS.find(s => s.id === this.songId);
        if (songConfig && songConfig.color) {
            ripple.style.borderColor = songConfig.color;
            ripple.style.boxShadow = `0 0 10px ${songConfig.color}`;
        }
        
        this.songWrapper.appendChild(ripple);
        
        // Clean up
        setTimeout(() => {
            if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
        }, 1000);
    }

    animate(time) {
        if (!this.isActive) return;
        this.animationId = requestAnimationFrame(this.boundAnimate);
        
        // Apply parallax to camera if it exists
        if (this.camera) {
            // Smoothly interpolate current rotation towards target rotation
            // We use a base rotation of 0 if not set
            const currentRotX = this.camera.rotation.x;
            const currentRotY = this.camera.rotation.y;
            this.camera.rotation.x += (this.targetCameraRotX - currentRotX) * 0.1;
            this.camera.rotation.y += (this.targetCameraRotY - currentRotY) * 0.1;
        }

        this.update(time);
        // 実FPSに応じて解像度を自動調整(全曲共通)。値が変わった時だけ反映。
        if (this.renderer) quality.maybeApply(this.renderer, this.composer);
        this.render();
    }

    update(time) {
        // チュートリアル表示中に勝手に自動再生が開始された場合の強制停止＆巻き戻しガード
        // 不要なAPIコールによる洪水（ポストメッセージ詰まり）を防ぐため、
        // プレイヤー側（player.js）の throttled guard に任せ、ここでは currentTime の同期のみ行う
        if (this.isTutorialActive) {
            this.currentTime = 0;
        }

        if (!this.lyricRenderer) return;

        if (playerManager.player && playerManager.player.video) {
            // TextAlive公式タイマー(player.timer.position)に完全同期（先行調整を排除）
            const position = (playerManager.player && playerManager.player.timer)
                             ? playerManager.player.timer.position
                             : this.currentTime;

            const word = playerManager.player.video.findWord(position)
                      || playerManager.player.video.findChar(position);
            
            // 語句の合間（数十msのギャップ）での不必要なちらつき・フェードアウト消去を防ぐため、
            // 同一フレーズ再生時間内であれば、wordがnullになっても直前の歌詞を保持し続ける
            const phrase = playerManager.player.video.findPhrase(position);
            if (word) {
                this.lyricRenderer.update(word);
            } else if (!phrase) {
                this.lyricRenderer.update(null);
            }
        }
    }

    // To be overridden by subclasses
    render() {
        // Drawing updates
    }

    destroy() {
        this.isActive = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        eventBus.off('timeUpdate', this.boundOnTimeUpdate);
        if (this.boundOnTimerReady) {
            eventBus.off('timerReady', this.boundOnTimerReady);
        }

        // 開始ヒントのタイマー/要素を後始末(曲切替時のリーク防止)
        clearTimeout(this._startHintFadeTimer);
        clearTimeout(this._startHintRemoveTimer);
        if (this._startHintEl && this._startHintEl.parentNode) {
            this._startHintEl.parentNode.removeChild(this._startHintEl);
        }
        this._startHintEl = null;
        
        if (this.lyricRenderer) {
            this.lyricRenderer.destroy();
        }
        
        // Subclasses should clear DOM elements, Three.js, PixiJS resources here
        if (this.songWrapper && this.songWrapper.parentNode) {
            this.songWrapper.removeEventListener('click', this.boundOnClick);
            window.removeEventListener('mousemove', this.boundOnMouseMove);
            this.songWrapper.parentNode.removeChild(this.songWrapper);
        }
        console.log(`Destroyed song scene: ${this.songId}`);
    }
}
