import { Player } from 'textalive-app-api';
import { eventBus } from './eventBus.js';
import { appState } from './appState.js';

class PlayerManager {
    constructor() {
        this.player = null;
        this.isReady = false;
        this.managed = false; // Set to true if running in TextAlive host
    }

    init(mediaElement) {
        const token = import.meta.env.VITE_TEXTALIVE_TOKEN;
        const appConfig = token ? { token: token } : true;

        this.player = new Player({
            app: appConfig,
            mediaElement: mediaElement
        });

        this.player.addListener({
            onAppReady: (app) => {
                if (app.managed) {
                    this.managed = true;
                }
                this.isReady = true;
                eventBus.emit('appReady', app);
                appState.setLoading(false);
            },

            onVideoReady: (video) => {
                eventBus.emit('videoReady', video);
                appState.setLoading(false);
            },

            onTimerReady: () => {
                eventBus.emit('timerReady');
            },

            onPlay: () => {
                appState.isPlaying = true;
                eventBus.emit('play');
            },

            onPause: () => {
                appState.isPlaying = false;
                eventBus.emit('pause');
            },

            onStop: () => {
                appState.isPlaying = false;
                eventBus.emit('stop');
            },

            onTimeUpdate: (position) => {
                appState.currentTime = position;
                // Emit timeUpdate but avoid heavy operations here; rendering should be in requestAnimationFrame
                eventBus.emit('timeUpdate', position);
            },
            
            onThrottledTimeUpdate: (position) => {
                eventBus.emit('throttledTimeUpdate', position);
            }
        });
    }

    loadSong(songUrl) {
        if (!this.managed && this.player) {
            appState.setLoading(true);
            this.player.createFromSongUrl(songUrl);
        }
    }

    play() {
        if (this.player && this.player.isPlaying === false) {
            this.player.requestPlay();
        }
    }

    pause() {
        if (this.player && this.player.isPlaying) {
            this.player.requestPause();
        }
    }
    
    stop() {
        if (this.player) {
            this.player.requestStop();
        }
    }

    seek(position) {
        if (this.player) {
            this.player.requestMediaSeek(position);
        }
    }
}

export const playerManager = new PlayerManager();
