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
            },

            // 読込/再生中の致命的エラー。読込中(またはタイマー未準備)なら
            // エラー画面でリトライ/戻るを案内する(無言の停止を防ぐ)。
            onError: (e) => {
                console.error('[Ripple Lyrics] TextAlive error:', e);
                if (appState.isLoading || !this.isTimerReady) {
                    if (this._loadTimeout) { clearTimeout(this._loadTimeout); this._loadTimeout = null; }
                    appState.setLoading(false);
                    eventBus.emit('songLoadError', { song: this._currentSong, reason: 'error', error: e });
                }
            }
        });
    }

    loadSong(song) {
        this.isTimerReady = false;
        this._userStop = false;
        this._songEndEmitted = false;
        this._currentSong = song;   // リトライ用に保持
        if (!this.managed && this.player) {
            appState.setLoading(true);

            // Fallback: TextAlive(歌詞データ)が一定時間で読込完了しない場合、
            // 「何も出ない」まま放置せず、原因とリトライ導線を示すエラー画面へ。
            // (評価レポート: 審査員が直URLで開いた際に何も見えないリスクの解消)
            if (this._loadTimeout) clearTimeout(this._loadTimeout);
            this._loadTimeout = setTimeout(() => {
                this._loadTimeout = null;
                if (appState.isLoading && !this.isTimerReady) {
                    console.warn('[Ripple Lyrics] TextAlive load timeout');
                    appState.setLoading(false);
                    eventBus.emit('songLoadError', { song: this._currentSong, reason: 'timeout' });
                }
            }, 15000);

            const options = {};
            if (song.video) {
                options.video = song.video;
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

    // ── 音量フェード(ユーザー設定値はlocalStorageが真実) ──
    _storedVolume() {
        if (localStorage.getItem('appMuted') === '1') return 0;
        const v = parseInt(localStorage.getItem('appVolume'), 10);
        return Number.isFinite(v) ? v : 80;
    }

    _clearFade() {
        if (this._fadeTimer) {
            clearInterval(this._fadeTimer);
            this._fadeTimer = null;
        }
    }

    /** 曲の頭出し用: 0 → 設定音量へなめらかに上げる */
    fadeIn(ms = 1200) {
        this._clearFade();
        const t0 = performance.now();
        this.setVolume(0);
        this._fadeTimer = setInterval(() => {
            const k = Math.min(1, (performance.now() - t0) / ms);
            this.setVolume(this._storedVolume() * k);
            if (k >= 1) this._clearFade();
        }, 50);
    }

    /** 停止前用: 設定音量 → 0 へ下げてからコールバック、その後設定値へ復帰 */
    fadeOutAnd(onDone, ms = 450) {
        this._clearFade();
        const t0 = performance.now();
        const start = this._storedVolume();
        this._fadeTimer = setInterval(() => {
            const k = Math.min(1, (performance.now() - t0) / ms);
            this.setVolume(start * (1 - k));
            if (k >= 1) {
                this._clearFade();
                if (onDone) onDone();
                this.setVolume(this._storedVolume());
            }
        }, 40);
    }
}

export const playerManager = new PlayerManager();
window.__playerManager = playerManager;
