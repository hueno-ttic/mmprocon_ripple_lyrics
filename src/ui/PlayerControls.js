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
        this.songTitle = document.getElementById('song-title');
        this.songArtist = document.getElementById('song-artist');

        this.bindEvents();
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
            if (!playerManager.isTimerReady) return; // Guard clicks during loading
            unlockAudioContext();
            if (appState.isPlaying) {
                playerManager.pause();
            } else {
                playerManager.play();
            }
        });

        this.progressBarContainer.addEventListener('click', (e) => {
            if (!playerManager.isTimerReady) return; // Guard seeks during loading
            unlockAudioContext();
            const rect = this.progressBarContainer.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            if (playerManager.player && playerManager.player.video) {
                const position = ratio * playerManager.player.video.duration;
                playerManager.seek(position);
            }
        });

        this.backToLakeBtn.addEventListener('click', () => {
            if (playerManager.isTimerReady) {
                playerManager.stop();
            }
            eventBus.emit('backToLake');
        });

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
                unlockAudioContext();
                if (appState.isPlaying) {
                    playerManager.pause();
                } else {
                    playerManager.play();
                }
            } else if (e.code === 'Escape') {
                playerManager.stop();
                eventBus.emit('backToLake');
            }
        });

        eventBus.on('play', () => {
            this.playPauseBtn.innerHTML = '<span style="font-size:16px">⏸</span> Pause (Space)';
            this.playPauseBtn.removeAttribute('disabled');
            this.playPauseBtn.style.opacity = '1';
            this.playPauseBtn.style.cursor = 'pointer';
        });

        eventBus.on('pause', () => {
            this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play (Space)';
            this.playPauseBtn.removeAttribute('disabled');
            this.playPauseBtn.style.opacity = '1';
            this.playPauseBtn.style.cursor = 'pointer';
        });

        eventBus.on('stop', () => {
            this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play (Space)';
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
                const ratio = position / playerManager.player.video.duration;
                this.progressBar.style.width = `${ratio * 100}%`;
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
             this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play (Space)';
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
             this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play (Space)';
             this.playPauseBtn.style.opacity = '1';
             this.playPauseBtn.style.cursor = 'pointer';
        });
    }
}
