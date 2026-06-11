import { appState } from './core/appState.js';
import { eventBus } from './core/eventBus.js';
import { playerManager } from './core/player.js';
import { WorldUI } from './lake/WorldUI.js';
import { PlayerControls } from './ui/PlayerControls.js';
import { SONGS } from './config/songs.js';
import { BaseSong } from './songs/BaseSong.js';
import { SongKotaete } from './songs/song-kotaete.js';
import { SongAfter } from './songs/song-after.js';
import { SongShutter } from './songs/song-shutter.js';
import { SongOrchestra } from './songs/song-orchestra.js';
import { SongTricktology } from './songs/song-tricktology.js';
import { SongTakeover } from './songs/song-takeover.js';
import { CompletionScreen } from './ui/CompletionScreen.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { StoryIntro } from './ui/StoryIntro.js';
// Global resilience handlers for media interruptions & API loading races
window.addEventListener('unhandledrejection', (event) => {
    if (!event.reason) return;
    
    const reasonMessage = event.reason.message || '';
    const reasonName = event.reason.name || '';

    // Ignore harmless play/pause interruptions by Chrome/iOS media engine
    const isAbortError = reasonName === 'AbortError' || reasonMessage.includes('play() request was interrupted');
    
    // Ignore TextAlive parallel loading races caused by rapid selection clicks
    const isParallelLoadError = reasonMessage.includes('Player.createFrom') && reasonMessage.includes('cannot run in parallel');

    if (isAbortError || isParallelLoadError) {
        event.preventDefault(); // Prevent logging as a crash
        console.warn(`[Lake Sonare] Safely caught and ignored API warning: ${reasonMessage || event.reason}`);
    }
});

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
                // Intro finished, allow interaction & initialize LakeUI now!
                console.log("Intro finished. Initializing LakeUI...");
                this.lakeUI = new WorldUI(this.sceneContainer);
                
                if (uiContainer) uiContainer.style.pointerEvents = 'none'; // Keep none so clicks pass through to canvas
                this.lakeUI.container.style.pointerEvents = 'auto'; // allow canvas interaction
            });
            storyIntro.start();
        });
        titleScreen.start();

        // ── DEBUG MODE(?debug=1 で有効。提出前にこのブロックと src/debug/ を削除)──
        if (new URLSearchParams(location.search).get('debug') === '1') {
            import('./debug/DebugPanel.js').then(m => m.initDebugPanel());
        }
        // ──────────────────────────────────────────────────────────────
    }

    bindEvents() {
        eventBus.on('loadingStateChange', (isLoading) => {
            document.getElementById('loading-screen').style.display = isLoading ? 'flex' : 'none';
        });

        eventBus.on('loadSong', (song) => {
            playerManager.loadSong(song);
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

        eventBus.on('allSongsComplete', () => {
            setTimeout(() => new CompletionScreen().show(), 1200);
        });

        eventBus.on('songEnd', () => {
            this._showSongEndOverlay(() => {
                eventBus.emit('backToLake', { markComplete: true });
            });
        });

        eventBus.on('backToLake', ({ markComplete = false } = {}) => {
            if (markComplete && appState.currentSongId) {
                appState.markSongComplete(appState.currentSongId);
            }
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

    _showSongEndOverlay(onDone) {
        const songConfig = SONGS.find(s => s.id === appState.currentSongId);
        const color = songConfig ? songConfig.color : '#ffffff';

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            background: rgba(0,0,0,0);
            z-index: 2000; pointer-events: none;
            transition: background 0.8s ease, opacity 0.8s ease;
        `;

        const text = document.createElement('div');
        text.textContent = 'この問いと向き合いました';
        text.style.cssText = `
            color: rgba(255,255,255,0);
            font-size: clamp(14px, 3vw, 22px);
            letter-spacing: 0.4em;
            font-weight: 300;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            text-shadow: 0 0 30px ${color};
            transition: color 1s ease 0.3s;
        `;

        const phaseNames = ['晴れた空', '雲の下', '雨の中', '水たまりのそば', '小川のほとり', '川のほとり', '湖面'];
        const phaseName = phaseNames[appState.getPhase()] || '湖面';
        const hint = document.createElement('div');
        hint.textContent = `${phaseName}へ戻ります…`;
        hint.style.cssText = `
            margin-top: 16px;
            color: rgba(255,255,255,0);
            font-size: 11px;
            letter-spacing: 0.25em;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            transition: color 1s ease 0.6s;
        `;

        overlay.appendChild(text);
        overlay.appendChild(hint);
        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.background = 'rgba(0,0,0,0.7)';
            text.style.color = 'rgba(255,255,255,0.9)';
            hint.style.color = 'rgba(255,255,255,0.4)';
        });

        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                onDone();
            }, 800);
        }, 2800);
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
window.app = app;
window.appState = appState;
window.eventBus = eventBus;
app.init();
