import { Player } from 'textalive-app-api';
import { eventBus } from './eventBus.js';
import { appState } from './appState.js';

class PlayerManager {
    constructor() {
        this.player = null;
        this.isReady = false;
        this.isTimerReady = false;
        this.managed = false; // Set to true if running in TextAlive host
        this._loadTimeout = null;
        this._userStop = false;    // true when stop() is called explicitly by user action
        this._songEndEmitted = false; // guard against double-emit from onEnd + onStop
        this._lastTutorialResetTime = 0; // throttle requests to prevent iframe API postMessage flooding
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
            },

            onTimerReady: () => {
                if (this._loadTimeout) { clearTimeout(this._loadTimeout); this._loadTimeout = null; }
                this.isTimerReady = true;
                eventBus.emit('timerReady');
                appState.setLoading(false);
            },

            onPlay: () => {
                this._songEndEmitted = false;
                
                // チュートリアル表示中の勝手な自動再生を検知して即座に停止＆巻き戻し（流量制御付き）
                if (window.app && window.app.currentSongScene && window.app.currentSongScene.isTutorialActive) {
                    appState.isPlaying = false;
                    const now = Date.now();
                    if (now - this._lastTutorialResetTime > 1000) {
                        this._lastTutorialResetTime = now;
                        this.player.requestPause();
                        this.player.requestMediaSeek(0);
                    }
                    return;
                }

                appState.isPlaying = true;
                eventBus.emit('play');
            },

            onPause: () => {
                appState.isPlaying = false;
                eventBus.emit('pause');
            },

            onStop: () => {
                // チュートリアル表示中の勝手な終了イベントをガード
                if (window.app && window.app.currentSongScene && window.app.currentSongScene.isTutorialActive) {
                    appState.isPlaying = false;
                    this._userStop = false;
                    eventBus.emit('stop');
                    return;
                }

                const video = this.player?.video;
                appState.isPlaying = false;
                // Fallback for environments where onEnd fires onStop at natural end instead
                const isNaturalEnd = !this._userStop &&
                                     video?.duration > 0 &&
                                     appState.currentTime >= video.duration - 1000;
                this._userStop = false;
                eventBus.emit('stop');
                if (isNaturalEnd && !this._songEndEmitted) {
                    this._songEndEmitted = true;
                    eventBus.emit('songEnd');
                }
            },

            onEnd: () => {
                // チュートリアル表示中の勝手な終了イベントをガード
                if (window.app && window.app.currentSongScene && window.app.currentSongScene.isTutorialActive) {
                    appState.isPlaying = false;
                    return;
                }

                appState.isPlaying = false;
                if (!this._songEndEmitted) {
                    this._songEndEmitted = true;
                    eventBus.emit('songEnd');
                }
            },

            onTimeUpdate: (position) => {
                // チュートリアル表示中の勝手な自動再生を検知して即座に停止＆巻き戻し（流量制御付き）
                if (window.app && window.app.currentSongScene && window.app.currentSongScene.isTutorialActive) {
                    appState.currentTime = 0;
                    if (position > 0) {
                        const now = Date.now();
                        if (now - this._lastTutorialResetTime > 1000) {
                            this._lastTutorialResetTime = now;
                            this.player.requestPause();
                            this.player.requestMediaSeek(0);
                        }
                    }
                    return;
                }

                appState.currentTime = position;
                const dur = this.player?.video?.duration;
                // TextAlive v0.4.x stops the timer at song end without firing onEnd or onStop.
                // Detect end by checking if position reaches within 50ms of duration.
                if (!this._songEndEmitted && dur > 0 && position >= dur - 50) {
                    this._songEndEmitted = true;
                    eventBus.emit('songEnd');
                }
                // Emit timeUpdate but avoid heavy operations here; rendering should be in requestAnimationFrame
                eventBus.emit('timeUpdate', position);
            },
            
            onThrottledTimeUpdate: (position) => {
                eventBus.emit('throttledTimeUpdate', position);
            }
        });
    }

    loadSong(song) {
        this.isTimerReady = false;
        this._userStop = false;
        this._songEndEmitted = false;
        if (!this.managed && this.player) {
            appState.setLoading(true);

            // Fallback: if TextAlive never fires onTimerReady (no token / offline),
            // unlock the UI after 10 s so the 3D scene is never permanently hidden.
            if (this._loadTimeout) clearTimeout(this._loadTimeout);
            this._loadTimeout = setTimeout(() => {
                this._loadTimeout = null;
                if (appState.isLoading) {
                    console.warn('[Lake Sonare] TextAlive load timeout — showing scene anyway');
                    this.isTimerReady = true;
                    eventBus.emit('timerReady');
                    appState.setLoading(false);
                }
            }, 10000);

            const options = {};
            if (song.video) {
                options.video = song.video;
            }
            if (song.altLyricsUrl && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                options.altLyricsUrl = new URL(song.altLyricsUrl, window.location.href).href;
            }
            this.player.createFromSongUrl(song.songUrl, options);
        }
    }

    play() {
        this._songEndEmitted = false;
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
            this._userStop = true;
            this.player.requestStop();
        }
    }

    seek(position) {
        if (this.player) {
            this.player.requestMediaSeek(position);
        }
    }

    setVolume(value) {
        // value: 0-100
        if (this.player) {
            this.player.volume = value;
        }
    }
}

export const playerManager = new PlayerManager();
window.__playerManager = playerManager;
