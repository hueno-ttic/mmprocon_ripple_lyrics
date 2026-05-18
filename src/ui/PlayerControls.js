import { playerManager } from '../core/player.js';
import { appState } from '../core/appState.js';
import { eventBus } from '../core/eventBus.js';

export class PlayerControls {
    constructor() {
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.progressBar = document.getElementById('progress-bar');
        this.progressBarContainer = document.getElementById('progress-bar-container');
        this.backToLakeBtn = document.getElementById('back-to-lake');
        this.songTitle = document.getElementById('song-title');
        this.songArtist = document.getElementById('song-artist');

        this.bindEvents();
    }

    bindEvents() {
        this.playPauseBtn.addEventListener('click', () => {
            if (appState.isPlaying) {
                playerManager.pause();
            } else {
                playerManager.play();
            }
        });

        this.progressBarContainer.addEventListener('click', (e) => {
            const rect = this.progressBarContainer.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            if (playerManager.player && playerManager.player.video) {
                const position = ratio * playerManager.player.video.duration;
                playerManager.seek(position);
            }
        });

        this.backToLakeBtn.addEventListener('click', () => {
            playerManager.stop();
            eventBus.emit('backToLake');
        });

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
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
        });

        eventBus.on('pause', () => {
            this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play (Space)';
        });

        eventBus.on('stop', () => {
            this.playPauseBtn.innerHTML = '<span style="font-size:16px">▶</span> Play (Space)';
            this.progressBar.style.width = '0%';
        });

        eventBus.on('timeUpdate', (position) => {
            if (playerManager.player && playerManager.player.video) {
                const ratio = position / playerManager.player.video.duration;
                this.progressBar.style.width = `${ratio * 100}%`;
            }
        });
        
        eventBus.on('songChange', (songId) => {
             // Will update title/artist in main.js or here based on SONGS config
             this.backToLakeBtn.style.display = 'block';
        });
        
        eventBus.on('backToLake', () => {
             this.backToLakeBtn.style.display = 'none';
             this.songTitle.innerText = '';
             this.songArtist.innerText = '';
             this.progressBar.style.width = '0%';
        });
    }
}
