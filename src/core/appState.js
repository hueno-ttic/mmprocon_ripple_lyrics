import { eventBus } from './eventBus.js';
import { SONGS } from '../config/songs.js';
import { PHASES } from '../config/constants.js';

class AppState {
    constructor() {
        this.currentSongId = null;
        this.isLoading = true;
        this.completedSongs = JSON.parse(localStorage.getItem('completedSongs') || '[]');
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
            localStorage.setItem('completedSongs', JSON.stringify(this.completedSongs));
            eventBus.emit('songComplete', songId);
            eventBus.emit('phaseChange', { from: this._previousPhase, to: this.getPhase() });
            if (this.completedSongs.length >= SONGS.length) {
                setTimeout(() => eventBus.emit('allSongsComplete'), 1000);
            }
        }
    }

    isSongComplete(songId) {
        return this.completedSongs.includes(songId);
    }

    getPhase() {
        return Math.min(this.completedSongs.length, PHASES.length - 1);
    }

    getPhaseName() {
        return PHASES[this.getPhase()].name;
    }

    getPreviousPhase() {
        return this._previousPhase;
    }
}

export const appState = new AppState();
