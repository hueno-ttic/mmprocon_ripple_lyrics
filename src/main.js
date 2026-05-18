import { appState } from './core/appState.js';
import { eventBus } from './core/eventBus.js';
import { playerManager } from './core/player.js';
import { LakeUI } from './lake/LakeUI.js';
import { PlayerControls } from './ui/PlayerControls.js';
import { SONGS } from './config/songs.js';
import { BaseSong } from './songs/BaseSong.js';
import { SongKotaete } from './songs/song-kotaete.js';
import { SongAfter } from './songs/song-after.js';
import { SongShutter } from './songs/song-shutter.js';
import { SongOrchestra } from './songs/song-orchestra.js';
import { SongTricktology } from './songs/song-tricktology.js';
import { SongTakeover } from './songs/song-takeover.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { StoryIntro } from './ui/StoryIntro.js';

class Application {
    constructor() {
        this.lakeUI = null;
        this.currentSongScene = null;
        this.playerControls = null;
        this.sceneContainer = document.getElementById('scene-container');
    }

    async init() {
        // Initialize PlayerControls
        this.playerControls = new PlayerControls();

        // Initialize LakeUI (it will render behind the TitleScreen)
        this.lakeUI = new LakeUI(this.sceneContainer);
        
        // Prevent interaction during intro
        const uiContainer = document.getElementById('ui-container');
        if (uiContainer) uiContainer.style.pointerEvents = 'none';

        // Bind events
        this.bindEvents();

        // Initialize TextAlive Player
        const mediaElement = document.getElementById('media');
        playerManager.init(mediaElement);

        // Start Entry Sequence
        const titleScreen = new TitleScreen(() => {
            const storyIntro = new StoryIntro(() => {
                // Intro finished, allow interaction
                if (uiContainer) uiContainer.style.pointerEvents = 'none'; // Keep none so clicks pass through to canvas
                this.lakeUI.container.style.pointerEvents = 'auto'; // allow canvas interaction
            });
            storyIntro.start();
        });
        titleScreen.start();
    }

    bindEvents() {
        eventBus.on('loadingStateChange', (isLoading) => {
            document.getElementById('loading-screen').style.display = isLoading ? 'flex' : 'none';
        });

        eventBus.on('loadSong', (songUrl) => {
            playerManager.loadSong(songUrl);
        });

        eventBus.on('songChange', (songId) => {
            const song = SONGS.find(s => s.id === songId);
            if (song) {
                document.getElementById('song-title').innerText = song.title;
                document.getElementById('song-artist').innerText = song.artist;
                
                // Switch scene
                this.switchToSongScene(song);
            }
        });

        eventBus.on('backToLake', () => {
            appState.setCurrentSong(null);
            appState.setLoading(false);
            
            if (this.currentSongScene) {
                this.currentSongScene.destroy();
                this.currentSongScene = null;
            }
            
            document.body.style.backgroundImage = '';
            document.body.style.backgroundColor = '';
            this.lakeUI.show();
        });
    }

    switchToSongScene(songConfig) {
        if (this.currentSongScene) {
            this.currentSongScene.destroy();
        }

        document.body.style.backgroundImage = 'none';
        document.body.style.backgroundColor = '#000000';

        let SongClass;
        switch(songConfig.id) {
            case 'kotaete': SongClass = SongKotaete; break;
            case 'after': SongClass = SongAfter; break;
            case 'shutter': SongClass = SongShutter; break;
            case 'orchestra': SongClass = SongOrchestra; break;
            case 'tricktology': SongClass = SongTricktology; break;
            case 'takeover': SongClass = SongTakeover; break;
            default: SongClass = BaseSong; break;
        }
        
        this.currentSongScene = new SongClass(this.sceneContainer, songConfig.id);
        this.currentSongScene.init();
    }
}

// Start application
const app = new Application();
app.init();
