import { eventBus } from './eventBus.js';

class AppState {
    constructor() {
        this.currentSongId = null;
        this.isLoading = true;
        this.completedSongs = JSON.parse(localStorage.getItem('completedSongs') || '[]');
        this.isPlaying = false;
        this.currentTime = 0;
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
            this.completedSongs.push(songId);
            localStorage.setItem('completedSongs', JSON.stringify(this.completedSongs));
            eventBus.emit('songComplete', songId);
        }
    }

    isSongComplete(songId) {
        return this.completedSongs.includes(songId);
    }
}

export const appState = new AppState();
