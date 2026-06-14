import { appState } from './core/appState.js';
import { eventBus } from './core/eventBus.js';
import { playerManager } from './core/player.js';
import { WorldUI } from './lake/WorldUI.js';
import { PlayerControls } from './ui/PlayerControls.js';
import { VolumeControl } from './ui/VolumeControl.js';
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
import { screenFade } from './ui/ScreenFade.js';
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

        // 全曲共通の音量コントロール(右下常設・localStorageで永続化)
        this.volumeControl = new VolumeControl();

        // Prevent interaction during intro
        const uiContainer = document.getElementById('ui-container');
        if (uiContainer) uiContainer.style.pointerEvents = 'none';

        // Bind events
        this.bindEvents();

        // Initialize TextAlive Player
        const mediaElement = document.getElementById('media');
        playerManager.init(mediaElement);

        // プロローグ完了後に湖の世界(WorldUI)を生成する共通処理。
        // 初回・スキップどちらの経路からも呼ばれる。
        const initWorld = () => {
            // Intro finished — fade through the curtain into the lake world
            // so the 3D scene cross-dissolves in instead of popping.
            console.log("Intro finished. Initializing LakeUI...");
            screenFade.cover(() => {
                this.lakeUI = new WorldUI(this.sceneContainer);
                if (uiContainer) uiContainer.style.pointerEvents = 'none'; // Keep none so clicks pass through to canvas
                this.lakeUI.container.style.pointerEvents = 'auto'; // allow canvas interaction
            }, { out: 500, in: 800 });
        };

        // 再訪(視聴済み)または ?skipIntro=1 のときはプロローグを丸ごと飛ばす。
        const seenIntro = localStorage.getItem('mm_seen_intro') === '1';
        const skipParam = new URLSearchParams(location.search).get('skipIntro') === '1';

        // Start Entry Sequence
        const titleScreen = new TitleScreen(() => {
            // タイトル通過後から音量コントロールを表示
            this.volumeControl.show();

            if (seenIntro || skipParam) {
                // プロローグをスキップして即・選曲画面へ
                initWorld();
                return;
            }

            // 初回はプロローグを流し、完了時に視聴済みフラグを立てる
            const storyIntro = new StoryIntro(() => {
                try {
                    localStorage.setItem('mm_seen_intro', '1');
                } catch (e) { /* storage失敗は致命的でない */ }
                initWorld();
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
            const ls = document.getElementById('loading-screen');
            if (!ls) return;
            if (isLoading) {
                ls.style.display = 'flex';
                void ls.offsetWidth; // commit display/opacity:0 so the fade animates
                ls.style.opacity = '1';
            } else {
                ls.style.opacity = '0';
                setTimeout(() => { if (!appState.isLoading) ls.style.display = 'none'; }, 450);
                // A song finished loading behind the curtain — reveal the scene.
                if (this._revealOnLoad) {
                    this._revealOnLoad = false;
                    screenFade.fadeIn(550);
                }
            }
        });

        eventBus.on('loadSong', (song) => {
            // The world has already faded to the curtain (see WorldUI.selectSong);
            // reveal the scene once loading completes.
            this._revealOnLoad = true;
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

        // 各曲のプレイ成果(エンドカード用)。最新値で上書きし、湖への還元用に永続化
        eventBus.on('songResult', (result) => {
            this._lastSongResult = result;
            try {
                const all = JSON.parse(localStorage.getItem('songResults') || '{}');
                all[result.songId] = result;
                localStorage.setItem('songResults', JSON.stringify(all));
            } catch (e) { /* storage失敗は致命的でない */ }
        });

        eventBus.on('songEnd', () => {
            this._showSongEndOverlay(() => {
                eventBus.emit('backToLake', { markComplete: true });
            });
        });

        eventBus.on('backToLake', ({ markComplete = false } = {}) => {
            // Fade to the curtain, swap the song scene out for the world, fade back.
            screenFade.cover(() => {
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
            }, { out: 450, in: 650 });
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

        // 曲固有の成果サマリー(エンドカード) — setResultSummary登録曲のみ
        let resultEl = null;
        const result = this._lastSongResult;
        if (result && result.songId === appState.currentSongId && Array.isArray(result.lines)) {
            const accent = result.accentColor || color;
            resultEl = document.createElement('div');
            resultEl.style.cssText = `
                margin-top: 22px; display: flex; flex-direction: column;
                align-items: center; gap: 7px;
                color: rgba(255,255,255,0);
                font-size: clamp(12px, 2.2vw, 15px);
                letter-spacing: 0.2em; font-weight: 300;
                font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
                transition: color 1.2s ease 0.8s;
            `;
            result.lines.forEach((line) => {
                const row = document.createElement('div');
                row.textContent = line;
                row.style.textShadow = `0 0 14px ${accent}`;
                resultEl.appendChild(row);
            });
            if (result.swatch) {
                const sw = document.createElement('div');
                sw.style.cssText = `
                    width: 30px; height: 30px; border-radius: 50%;
                    background: ${result.swatch};
                    box-shadow: 0 0 18px ${result.swatch};
                    margin-top: 4px;
                `;
                resultEl.appendChild(sw);
            }
            overlay.appendChild(resultEl);
        }
        this._lastSongResult = null;

        overlay.appendChild(hint);
        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.background = 'rgba(0,0,0,0.7)';
            text.style.color = 'rgba(255,255,255,0.9)';
            hint.style.color = 'rgba(255,255,255,0.4)';
            if (resultEl) resultEl.style.color = 'rgba(255,255,255,0.85)';
        });

        setTimeout(() => {
            // Hand off to backToLake, whose curtain fades over this overlay;
            // remove the overlay once it's hidden behind the curtain.
            onDone();
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 500);
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
window.playerManager = playerManager; // 計測/デバッグ用にプレイヤーを公開
app.init();
