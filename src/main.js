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
// こたえては現在ひまわり登攀版(song-kotaete.js)。true にすると水鏡版へいつでも戻せる
// (song-kotaete.mizukagami.js)。どちらも class SongKotaete を export する。
const KOTAETE_MIZUKAGAMI = false;
const SONG_LOADERS = {
    kotaete: () => (KOTAETE_MIZUKAGAMI
        ? import('./songs/song-kotaete.mizukagami.js')
        : import('./songs/song-kotaete.js')).then(m => m.SongKotaete),
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
        console.warn(`[Ripple Lyrics] Safely caught and ignored API warning: ${reasonMessage || event.reason}`);
    }
});

// 再デプロイで内容ハッシュが変わると、古い index.html/main.js が参照する曲チャンク
// (例: song-takeover-xxxx.js)はサーバーから消えており、その曲を選んだ瞬間に
// 動的 import() が 404 になる(= "Failed to fetch dynamically imported module")。
// 一度フルリロードすれば新しい index.html→新ハッシュを取り直して必ず復旧するので、
// stale chunk を検知したら自動リロードする。曲チャンクは曲選択時(load より遥か後)に
// 遅延ロードされるため、ガードは時刻ベースにする。直近に一度リロードしたばかりなら
// 再発を「別要因」とみなして再リロードせず諦める(=無限ループ防止)。
const RELOAD_GUARD_KEY = 'mm_chunk_reloaded_at';
const RELOAD_GUARD_WINDOW_MS = 30 * 1000;

function isStaleChunkError(err) {
    const msg = (err && (err.message || err.toString())) || '';
    return msg.includes('Failed to fetch dynamically imported module')
        || msg.includes('error loading dynamically imported module')
        || msg.includes('Importing a module script failed'); // Safari の同等メッセージ
}

function reloadOnceForStaleChunk() {
    try {
        const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
        if (last && (Date.now() - last) < RELOAD_GUARD_WINDOW_MS) {
            // ついさっきリロードしたのにまだ失敗する = 別要因。ループを避けて諦める。
            console.error('[Ripple Lyrics] チャンク再取得後も失敗。自動リロードを中止します。');
            return false;
        }
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch (_) { /* sessionStorage 不可環境でもリロードは試みる */ }
    console.warn('[Ripple Lyrics] 古い曲チャンクを検出。最新版を取り直すため再読み込みします。');
    location.reload();
    return true;
}

// Vite が dynamic import を変換した際の標準プリロード失敗イベント。
// 曲選択前にプリロードが走って失敗するケースもここで拾う。
window.addEventListener('vite:preloadError', (event) => {
    if (isStaleChunkError(event.payload)) {
        event.preventDefault(); // Vite 既定の throw を抑止して自前でリロード
        reloadOnceForStaleChunk();
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
            const toResult = () => this._showSongEndOverlay(() => {
                eventBus.emit('backToLake', { markComplete: true });
            });
            // 曲固有の「締めの間」（例: シャッターチャンスの写真選択コンタクトシート）を
            // 自然終了後に挟めるようにする。シーンが用意していればそれが終わってからリザルトへ。
            const scene = this.currentSongScene;
            if (scene && typeof scene.runEndInterlude === 'function') {
                scene.runEndInterlude(toResult);
            } else {
                toResult();
            }
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

        // 自動では戻らず、ユーザーが押して楽曲選択画面へ戻るためのボタン。
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.textContent = '楽曲選択画面へ';
        backBtn.style.cssText = `
            margin-top: 30px;
            padding: 12px 32px;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            font-size: clamp(13px, 2.4vw, 15px);
            letter-spacing: 0.2em; cursor: pointer;
            border-radius: 26px;
            -webkit-tap-highlight-color: transparent;
            pointer-events: auto;
            color: rgba(255,255,255,0.92);
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.35);
            opacity: 0;
            transition: opacity 0.9s ease 0.9s, background 0.2s ease, border-color 0.2s ease, transform 0.1s ease;
        `;
        backBtn.addEventListener('pointerenter', () => {
            backBtn.style.background = 'rgba(255,255,255,0.14)';
            backBtn.style.borderColor = 'rgba(255,255,255,0.6)';
        });
        backBtn.addEventListener('pointerleave', () => {
            backBtn.style.background = 'rgba(255,255,255,0.06)';
            backBtn.style.borderColor = 'rgba(255,255,255,0.35)';
        });

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

        overlay.appendChild(backBtn);
        stageRoot().appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.background = 'rgba(0,0,0,0.7)';
            text.style.color = 'rgba(255,255,255,0.9)';
            backBtn.style.opacity = '1';
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

        // 自動では戻らず、ボタンを押したときだけ楽曲選択画面へ戻る。
        backBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        backBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            backBtn.disabled = true;
            finish();
        });
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
                console.error(`[Ripple Lyrics] 曲チャンクのロードに失敗: ${songConfig.id}`, err);
                // 再デプロイでハッシュが切れた古いチャンクなら、一度リロードすれば復旧する。
                // (BaseSong フォールバックで無言に壊すより、最新版で正しく遊ばせる)
                if (isStaleChunkError(err) && reloadOnceForStaleChunk()) return;
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
