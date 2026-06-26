import { appState } from './core/appState.js';
import { eventBus } from './core/eventBus.js';
import { playerManager } from './core/player.js';
import { WorldUI } from './lake/WorldUI.js';
import { PlayerControls } from './ui/PlayerControls.js';
import { VolumeControl } from './ui/VolumeControl.js';
import { SONGS } from './config/songs.js';
import { BaseSong } from './songs/BaseSong.js';
import { CompletionScreen } from './ui/CompletionScreen.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { ErrorScreen } from './ui/ErrorScreen.js';
import './core/sfx.js'; // 全曲共通UIの効果音(eventBus/DOM購読で自己登録)
import './core/bgm.js'; // 選曲画面のフェーズ別BGM(eventBus購読で自己登録)

// 曲シーンは1曲ずつしか遊ばないので、静的importで全曲(+pixi/three-vrm)を
// 初回バンドルに同梱するのは無駄。曲ごとに dynamic import() し、選んだ曲の
// チャンクだけを遅延ロードする(初回ロードを大幅に軽量化)。
// 遷移はカーテン(ScreenFade)で覆われているため、このロード待ちは隠れる。
// issue #30 改修版トリツクロジー。true にすると改修前のリズムゲーム版へ即座に戻せる。
const TRICKTOLOGY_LEGACY = false;
const SONG_LOADERS = {
    kotaete: () => import('./songs/song-kotaete.js').then(m => m.SongKotaete),
    after: () => import('./songs/song-after.js').then(m => m.SongAfter),
    shutter: () => import('./songs/song-shutter.js').then(m => m.SongShutter),
    orchestra: () => import('./songs/song-orchestra.js').then(m => m.SongOrchestra),
    tricktology: () => (TRICKTOLOGY_LEGACY
        ? import('./songs/song-tricktology.legacy.js')
        : import('./songs/song-tricktology.js')).then(m => m.SongTricktology),
    takeover: () => import('./songs/song-takeover.js').then(m => m.SongTakeover),
};
import { TitleScreen } from './ui/TitleScreen.js';
import { StoryIntro } from './ui/StoryIntro.js';
import { screenFade } from './ui/ScreenFade.js';
import { initStage, stageRoot } from './core/stage.js';
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
        console.warn(`[Ripple Lyric] Safely caught and ignored API warning: ${reasonMessage || event.reason}`);
    }
});

// スマホ向けレターボックス/ピラーボックスの座標系シムを最優先で仕込む
// (シーンのカメラ aspect やポインタ計算より前に有効化する必要がある)
initStage();

class Application {
    constructor() {
        this.lakeUI = null;
        this.currentSongScene = null;
        this.playerControls = null;
        this.sceneContainer = document.getElementById('scene-container');
    }

    async init() {
        // フォント先読みを開始(歌詞テクスチャが代替フォントで焼き付くのを防ぐ)
        this.ensureFonts();

        // ローディング/エラー画面(index.html の #loading-screen / #error-screen を管理)
        this.loadingScreen = new LoadingScreen();
        this.errorScreen = new ErrorScreen();

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

    // フォント先読み: 主要4ウェイトを明示ロードし、完了Promiseを保持。
    // 取得が詰まってもゲーム開始を妨げないよう最大3.5秒で打ち切る(フォールバック)。
    ensureFonts() {
        const specs = [
            '400 16px "Noto Sans JP"', '700 16px "Noto Sans JP"',
            '400 16px "Noto Serif JP"', '700 16px "Noto Serif JP"',
        ];
        let load;
        try {
            load = (document.fonts && document.fonts.load)
                ? Promise.all(specs.map(s => document.fonts.load(s))).then(() => document.fonts.ready)
                : Promise.resolve();
        } catch (e) { load = Promise.resolve(); }
        this.fontsReady = Promise.race([load, new Promise(r => setTimeout(r, 3500))]);
    }

    bindEvents() {
        eventBus.on('loadingStateChange', (isLoading) => {
            if (isLoading) {
                this.loadingScreen.show();
            } else {
                this.loadingScreen.hide();
                // 曲がカーテン裏で読込完了 — フォント準備を待ってからシーンを現す。
                // (歌詞テクスチャが代替フォントで焼き付くのを防ぐ。最大3.5秒で打ち切り)
                if (this._revealOnLoad) {
                    this._revealOnLoad = false;
                    (this.fontsReady || Promise.resolve()).then(() => screenFade.fadeIn(550));
                }
            }
        });

        // 歌詞データの読込失敗 — 無言の停止を避け、原因とリトライ/戻る導線を示す
        eventBus.on('songLoadError', ({ song } = {}) => {
            this._revealOnLoad = false;
            screenFade.fadeIn(400); // カーテンを開けてエラーを見せる
            const target = song || SONGS.find(s => s.id === appState.currentSongId);
            this.errorScreen.show({
                title: '歌詞データを読み込めませんでした',
                message: '通信状況をご確認のうえ、もう一度お試しください。',
                actions: [
                    { label: 'もう一度試す', primary: true, onClick: () => {
                        if (target) { this._revealOnLoad = true; playerManager.loadSong(target); }
                    } },
                    { label: '湖へ戻る', onClick: () => eventBus.emit('backToLake', { markComplete: false }) },
                ],
            });
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
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
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

        // 一部の曲はリザルトをユーザーのタップまで維持する(issue #30: トリツクロジー)
        const holdUntilTap = !!(songConfig && songConfig.holdResultUntilTap);

        overlay.appendChild(hint);
        stageRoot().appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.background = 'rgba(0,0,0,0.7)';
            text.style.color = 'rgba(255,255,255,0.9)';
            hint.style.color = 'rgba(255,255,255,0.4)';
            if (resultEl) resultEl.style.color = 'rgba(255,255,255,0.85)';
        });

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            // Hand off to backToLake, whose curtain fades over this overlay;
            // remove the overlay once it's hidden behind the curtain.
            onDone();
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 500);
        };

        if (holdUntilTap) {
            // タップするまで表示を維持。少し遅れて誘導を出し、誤操作での即離脱を防ぐ。
            hint.textContent = '';
            overlay.style.pointerEvents = 'auto';
            overlay.style.cursor = 'pointer';
            setTimeout(() => {
                hint.textContent = `タップして${phaseName}へ戻る`;
                hint.style.color = 'rgba(255,255,255,0.5)';
                overlay.addEventListener('pointerdown', finish, { once: true });
            }, 1600);
        } else {
            setTimeout(finish, 2800);
        }
    }

    async switchToSongScene(songConfig) {
        if (this.currentSongScene) {
            this.currentSongScene.destroy();
            this.currentSongScene = null;
        }

        document.body.style.backgroundImage = 'none';
        document.body.style.backgroundColor = '#000000';

        // 最新の遷移だけを反映するためのトークン(チャンク待ちの間に別曲へ
        // 切り替わったら、古いロードの結果は破棄する)
        const token = (this._sceneToken = (this._sceneToken || 0) + 1);

        let SongClass = BaseSong;
        const loader = SONG_LOADERS[songConfig.id];
        if (loader) {
            try {
                SongClass = await loader();
            } catch (err) {
                console.error(`[Ripple Lyric] 曲チャンクのロードに失敗: ${songConfig.id}`, err);
                SongClass = BaseSong;
            }
        }
        // ロード中に別の曲へ切り替わっていたら、この結果は捨てる
        if (token !== this._sceneToken) return;

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
