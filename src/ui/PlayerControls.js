import { playerManager } from '../core/player.js';
import { appState } from '../core/appState.js';
import { eventBus } from '../core/eventBus.js';

export class PlayerControls {
    constructor() {
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.progressBar = document.getElementById('progress-bar');
        this.progressBarContainer = document.getElementById('progress-bar-container');
        this.playerControls = document.getElementById('player-controls');
        this.backToLakeBtn = document.getElementById('back-to-lake');

        // 再生時間表示 (1:23 / 3:45)
        this.timeLabel = document.createElement('span');
        this.timeLabel.id = 'time-label';
        this.timeLabel.style.cssText = `
            color: rgba(255,255,255,0.7); font-size: 12px;
            font-family: 'Inter', monospace; letter-spacing: 0.06em;
            margin-left: 12px; min-width: 92px; text-align: right;
            flex-shrink: 0; user-select: none;
        `;
        this.timeLabel.textContent = '0:00 / 0:00';
        if (this.playerControls) this.playerControls.appendChild(this.timeLabel);
        this.songTitle = document.getElementById('song-title');
        this.songArtist = document.getElementById('song-artist');

        this.bindEvents();
    }

    _duration() {
        return (playerManager.player && playerManager.player.video)
            ? playerManager.player.video.duration : 0;
    }

    _fmt(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    _updateTimeLabel(position) {
        if (this.timeLabel) {
            this.timeLabel.textContent = `${this._fmt(position)} / ${this._fmt(this._duration())}`;
        }
    }

    bindEvents() {
        const unlockAudioContext = () => {
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
        };

        this.playPauseBtn.addEventListener('click', () => {
            if (window.app?.currentSongScene?.isSelectingCast) return; // 被写体選択中は再生させない(shutter)
            if (!playerManager.isTimerReady) return; // Guard clicks during loading
            unlockAudioContext();
            if (appState.isPlaying) {
                playerManager.pause();
            } else {
                playerManager.play();
            }
        });

        // シークバー: ドラッグでスクラブ(クリック一発も同じ経路で処理)
        this._scrubbing = false;
        this._scrubRatio = 0;
        this.progressBarContainer.style.touchAction = 'none';
        const ratioFromEvent = (e) => {
            const rect = this.progressBarContainer.getBoundingClientRect();
            return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        };
        this.progressBarContainer.addEventListener('pointerdown', (e) => {
            if (!playerManager.isTimerReady) return;
            unlockAudioContext();
            this._scrubbing = true;
            this._scrubRatio = ratioFromEvent(e);
            this.progressBar.style.width = `${this._scrubRatio * 100}%`;
            this._updateTimeLabel(this._scrubRatio * this._duration());
            e.preventDefault();
        });
        window.addEventListener('pointermove', (e) => {
            if (!this._scrubbing) return;
            this._scrubRatio = ratioFromEvent(e);
            this.progressBar.style.width = `${this._scrubRatio * 100}%`;
            this._updateTimeLabel(this._scrubRatio * this._duration());
        });
        const endScrub = () => {
            if (!this._scrubbing) return;
            this._scrubbing = false;
            const dur = this._duration();
            if (dur > 0) playerManager.seek(this._scrubRatio * dur);
        };
        window.addEventListener('pointerup', endScrub);
        window.addEventListener('pointercancel', endScrub);

        const backWithFade = () => {
            // 押下と同時に遷移(カーテン+transition SE)を起動し、押下フィードバックを即返す。
            // 音楽はカーテンの裏で並行フェードアウトしてから停止する(ブツ切り防止)。
            // 以前は「フェード→その後 backToLake」と直列化していたため、SE/カーテンが約450ms遅れていた。
            eventBus.emit('backToLake');
            if (playerManager.isTimerReady && appState.isPlaying) {
                playerManager.fadeOutAnd(() => playerManager.stop());
            } else if (playerManager.isTimerReady) {
                playerManager.stop();
            }
        };
        this.backToLakeBtn.addEventListener('click', backWithFade);
        this._backWithFade = backWithFade;

        window.addEventListener('keydown', (e) => {
            if (!playerManager.isTimerReady) {
                // Guard keyboard inputs during load
                if (e.code === 'Space' || e.code === 'Escape') {
                    e.preventDefault();
                }
                return;
            }
            if (e.code === 'Space') {
                e.preventDefault();
                if (window.app?.currentSongScene?.isSelectingCast) return; // 被写体選択中はSpaceで再生させない(shutter)
                unlockAudioContext();
                if (appState.isPlaying) {
                    playerManager.pause();
                } else {
                    playerManager.play();
                }
            } else if (e.code === 'Escape') {
                this._backWithFade();
            }
        });

        eventBus.on('play', () => {
            this.playPauseBtn.innerHTML = '<span style="font-size:16px">⏸</span> Pause<span class="kbd-hint"> (Space)</span>';
            this.playPauseBtn.removeAttribute('disabled');
            this.playPauseBtn.style.opacity = '1';
            this.playPauseBtn.style.cursor = 'pointer';
        });

        eventBus.on('pause', () => {
            this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play<span class="kbd-hint"> (Space)</span>';
            this.playPauseBtn.removeAttribute('disabled');
            this.playPauseBtn.style.opacity = '1';
            this.playPauseBtn.style.cursor = 'pointer';
        });

        eventBus.on('stop', () => {
            this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play<span class="kbd-hint"> (Space)</span>';
            this.progressBar.style.width = '0%';
        });

        eventBus.on('songEnd', () => {
            this.progressBar.style.width = '100%';
            this.playPauseBtn.setAttribute('disabled', 'true');
            this.playPauseBtn.innerHTML = '✓ 完了';
            this.playPauseBtn.style.opacity = '0.5';
            this.playPauseBtn.style.cursor = 'default';
        });

        eventBus.on('timeUpdate', (position) => {
            if (playerManager.player && playerManager.player.video) {
                if (!this._scrubbing) {
                    const ratio = position / this._duration();
                    this.progressBar.style.width = `${ratio * 100}%`;
                    this._updateTimeLabel(position);
                }
            }
        });
        
        eventBus.on('songChange', (songId) => {
             this.playerControls.style.display = 'flex';
             this.backToLakeBtn.style.display = 'block';
             // Disable controls visually and functionally during loading
             this.playPauseBtn.setAttribute('disabled', 'true');
             this.playPauseBtn.innerHTML = '<span style="font-size:16px">⏳</span> Loading...';
             this.playPauseBtn.style.opacity = '0.5';
             this.playPauseBtn.style.cursor = 'not-allowed';
        });

        eventBus.on('timerReady', () => {
             // Activate player controls
             this.playPauseBtn.removeAttribute('disabled');
             this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play<span class="kbd-hint"> (Space)</span>';
             this.playPauseBtn.style.opacity = '1';
             this.playPauseBtn.style.cursor = 'pointer';
        });
        
        eventBus.on('backToLake', () => {
             this.playerControls.style.display = 'none';
             this.backToLakeBtn.style.display = 'none';
             this.songTitle.innerText = '';
             this.songArtist.innerText = '';
             this.progressBar.style.width = '0%';
             // Reset controls
             this.playPauseBtn.removeAttribute('disabled');
             this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play<span class="kbd-hint"> (Space)</span>';
             this.playPauseBtn.style.opacity = '1';
             this.playPauseBtn.style.cursor = 'pointer';
        });
    }
}
