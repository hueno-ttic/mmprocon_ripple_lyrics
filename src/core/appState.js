import { eventBus } from './eventBus.js';
import { NORMAL_SONGS, areNormalSongsComplete, isSecretSong } from '../config/songs.js';
import { PHASES } from '../config/constants.js';
import { safeGetJSON, safeSetJSON } from '../utils/storage.js';

class AppState {
    constructor() {
        this.currentSongId = null;
        this.isLoading = true;
        // ストレージ不可・壊れたJSONでも起動を止めない(モジュール評価時に投げると画面が真っ白になる)。
        // 文字列ID以外が混じっていたら除外する。
        this.completedSongs = safeGetJSON('completedSongs', [], Array.isArray)
            .filter(id => typeof id === 'string');
        this.isPlaying = false;
        this.currentTime = 0;
        this._previousPhase = this.getPhase();
    }

    setLoading(isLoading) {
        this.isLoading = isLoading;
        eventBus.emit('loadingStateChange', isLoading);
    }

    setCurrentSong(songId) {
        this.currentSongId = songId;
        eventBus.emit('songChange', songId);
    }

    markSongComplete(songId) {
        if (!this.completedSongs.includes(songId)) {
            this._previousPhase = this.getPhase();
            this.completedSongs.push(songId);
            // 保存失敗(プライベートブラウズ等)でも例外を投げない。screenFade の暗転中に
            // 呼ばれるため、ここで投げるとカーテンが上がらなくなる。
            safeSetJSON('completedSongs', this.completedSongs);
            eventBus.emit('songComplete', songId);
            eventBus.emit('phaseChange', { from: this._previousPhase, to: this.getPhase() });
            // 通常曲(5曲)を全て終えた瞬間に「水の循環、完成」エンディングを流す。
            // シークレット曲(こたえて)はエンディング後の隠し体験なので再発火させない。
            if (!isSecretSong(songId) && areNormalSongsComplete(this.completedSongs)) {
                setTimeout(() => eventBus.emit('allSongsComplete'), 1000);
            }
        }
    }

    isSongComplete(songId) {
        return this.completedSongs.includes(songId);
    }

    // 通常曲(5曲)を全てクリア済みかどうか。エンディング誘導とシークレット解放の判定に使う。
    // シークレット曲(こたえて)はこの判定に含めない。
    areAllSongsComplete() {
        return areNormalSongsComplete(this.completedSongs);
    }

    getPhase() {
        // 天候フェーズは通常曲(5曲)のクリア数で進む。シークレット曲は進行に影響しない。
        const normalDone = NORMAL_SONGS.filter(s => this.completedSongs.includes(s.id)).length;
        return Math.min(normalDone, PHASES.length - 1);
    }

    getPhaseName() {
        return PHASES[this.getPhase()].name;
    }

    getPreviousPhase() {
        return this._previousPhase;
    }
}

export const appState = new AppState();
