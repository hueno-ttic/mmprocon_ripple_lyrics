import { Player } from 'textalive-app-api';
import { eventBus } from './eventBus.js';
import { appState } from './appState.js';
import { safeGet } from '../utils/storage.js';

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
        // 曲が自然終了したら、次の曲の読込(loadSong)か湖への復帰(releaseForLake)まで
        // play() を受け付けない(終了後の Space で再生が頭から走り songEnd が再発火するのを防ぐ)。
        this._songEndLocked = false;
        // 読込の世代管理。タイムアウト等で取り残された古い createFromSongUrl の
        // onVideoReady/onTimerReady が、後から新しい曲のシーンへ紛れ込むのを防ぐ。
        //   _expectedSongUrl: undefined=未使用(ゲートしない) / null=湖に戻った(全て無視) / 文字列=読込要求中の曲
        this._loadSeq = 0;
        this._expectedSongUrl = undefined;
        this._requestedSongUrls = []; // これまでに読込要求した曲URL(stale 判定の照合用)
        this._createPromise = null; // 実行中の createFromSongUrl(並列実行不可のため直列化に使う)
    }

    // URL表記ゆれ(プロトコル/末尾スラッシュ/大文字小文字)を吸収して比較する
    _normSongUrl(url) {
        return String(url || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    }

    // permalink 側が日付サフィックスを持たない等の表記差を許すため、前方一致でも同一とみなす
    _sameSong(a, b) {
        const x = this._normSongUrl(a), y = this._normSongUrl(b);
        return !!x && !!y && (x === y || x.startsWith(y + '/') || y.startsWith(x + '/'));
    }

    // いま届いた TextAlive イベントが「現在要求中の曲」以外のもの(古い読込の残骸)か。
    // 保守的に、読込済みの曲が「過去に要求した別の曲」だと確実に分かる場合だけ stale とする。
    // permalink が取れない/どの要求とも照合できない場合は従来どおり通す(正常な読込を止めない)。
    _isStaleLoadEvent() {
        if (this.managed || this._expectedSongUrl === undefined) return false;
        if (this._expectedSongUrl === null) return true; // 湖へ戻った後に届いた読込完了は捨てる
        const loaded = this.player?.data?.song?.permalink;
        if (!loaded || this._sameSong(loaded, this._expectedSongUrl)) return false;
        return this._requestedSongUrls.some(u => this._sameSong(loaded, u));
    }

    init(mediaElement) {
        // コンテスト提出用: 環境(.env)に依存せず常にこのトークンで動くよう直接埋め込む。
        const token = 'XrbFND6w6SNKZezs';
        const appConfig = { token: token };

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
                if (this._isStaleLoadEvent()) {
                    console.warn('[Ripple Lyrics] 古い読込の onVideoReady を無視しました');
                    return;
                }
                eventBus.emit('videoReady', video);
            },

            onTimerReady: () => {
                if (this._isStaleLoadEvent()) {
                    console.warn('[Ripple Lyrics] 古い読込の onTimerReady を無視しました');
                    return;
                }
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
                    this._songEndLocked = true;
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
                    this._songEndLocked = true;
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
                    this._songEndLocked = true;
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
                if (this._expectedSongUrl === null) return; // 湖へ戻った後の残骸エラーで湖にエラー画面を出さない
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
        this._songEndLocked = false;
        this._currentSong = song;   // リトライ用に保持
        const seq = ++this._loadSeq;
        this._expectedSongUrl = song.songUrl;
        if (!this._requestedSongUrls.includes(song.songUrl)) this._requestedSongUrls.push(song.songUrl);
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
            this._startCreate(song.songUrl, options, seq);
        }
    }

    // createFromSongUrl は並列実行できない(後発が "cannot run in parallel" で reject され、
    // 読込が始まらないまま先発=別の曲が届いてしまう)。直前の読込の完了を待ってから開始し、
    // それでも並列エラーになったら、この読込が最新である間だけ少し待って再試行する。
    // 直前の読込が固まっている場合に備え、待つのは最大 PREV_WAIT_MS まで。
    _startCreate(songUrl, options, seq) {
        const PREV_WAIT_MS = 3000;
        const RETRY_MS = 500;
        const prev = this._createPromise;
        const waitPrev = prev
            ? Promise.race([prev, new Promise(r => setTimeout(r, PREV_WAIT_MS))])
            : Promise.resolve();
        const attempt = () => {
            if (seq !== this._loadSeq || !this.player) return; // 新しい読込/湖への復帰で置き換わった
            let p;
            try {
                p = Promise.resolve(this.player.createFromSongUrl(songUrl, options));
            } catch (err) {
                p = Promise.reject(err);
            }
            const settled = p.then(() => {}, () => {});
            this._createPromise = settled;
            p.catch((err) => {
                const msg = (err && err.message) || String(err || '');
                if (msg.includes('cannot run in parallel')) {
                    if (this._createPromise === settled) this._createPromise = null;
                    // 読込待ち(タイムアウト前)で、まだ最新の要求なら再試行する
                    if (seq === this._loadSeq && appState.isLoading && !this.isTimerReady) {
                        setTimeout(attempt, RETRY_MS);
                    }
                    return;
                }
                console.warn('[Ripple Lyrics] createFromSongUrl failed:', err);
            });
        };
        waitPrev.then(attempt);
    }

    // 曲シーンから湖へ戻ったときの後始末。前曲の「再生準備完了」状態を落とし、
    // 湖での Space/Escape が前曲の音声再生や backToLake 再実行に化けないようにする。
    // 読込途中の古い TextAlive イベントも以後は無視する。
    releaseForLake() {
        // TextAlive ホスト管理下(managed)では曲の再読込が起きないため準備状態は保持する
        if (!this.managed) this.isTimerReady = false;
        this._songEndEmitted = false;
        this._songEndLocked = false;
        this._loadSeq++;
        this._expectedSongUrl = null;
        if (this._loadTimeout) { clearTimeout(this._loadTimeout); this._loadTimeout = null; }
    }

    play() {
        // 自然終了後は次の曲/湖へ戻るまで再生させない(songEnd 再発火の防止)
        if (this._songEndLocked) return;
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
        if (safeGet('appMuted') === '1') return 0;
        const v = parseInt(safeGet('appVolume'), 10);
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
