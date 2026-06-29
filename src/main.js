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
import { DEV_TOOLS_ENABLED } from './core/featureFlags.js'; // デプロイ単位で開発者向け機能を出し分け

// 曲シーンは1曲ずつしか遊ばないので、静的importで全曲(+pixi/three-vrm)を
// 初回バンドルに同梱するのは無駄。曲ごとに dynamic import() し、選んだ曲の
// チャンクだけを遅延ロードする(初回ロードを大幅に軽量化)。
// 遷移はカーテン(ScreenFade)で覆われているため、このロード待ちは隠れる。
// issue #30 改修版トリツクロジー。true にすると改修前のリズムゲーム版へ即座に戻せる。
const TRICKTOLOGY_LEGACY = false;
// こたえては現在ひまわり登攀版(song-kotaete.js)。true にすると水鏡版へいつでも戻せる
// (song-kotaete.mizukagami.js)。どちらも class SongKotaete を export する。
const KOTAETE_MIZUKAGAMI = false;
// 各曲: チャンクを動的 import する load() と、その中から取り出す class 名。
// あえてモジュール名前空間ごと受け取り、_loadSongClass 側で class を取り出す。
// 本番ビルドでは Vite が vite:preloadError を握り潰してモジュールを undefined で
// 解決することがある(主に再デプロイで消えた stale chunk)。.then(m => m.SongX) と
// 即時に取り出すと undefined への参照で TypeError 化し、stale と判別できないまま
// BaseSong(黒画面+白歌詞)へ落ちてしまう。モジュールを丸ごと受け取れば、
// 「解決したが class が無い = 実質ロード失敗」を確実に検知してリトライ/案内できる。
const SONG_LOADERS = {
    kotaete: { load: () => (KOTAETE_MIZUKAGAMI
        ? import('./songs/song-kotaete.mizukagami.js')
        : import('./songs/song-kotaete.js')), cls: 'SongKotaete' },
    after: { load: () => import('./songs/song-after.js'), cls: 'SongAfter' },
    shutter: { load: () => import('./songs/song-shutter.js'), cls: 'SongShutter' },
    orchestra: { load: () => import('./songs/song-orchestra.js'), cls: 'SongOrchestra' },
    tricktology: { load: () => (TRICKTOLOGY_LEGACY
        ? import('./songs/song-tricktology.legacy.js')
        : import('./songs/song-tricktology.js')), cls: 'SongTricktology' },
    takeover: { load: () => import('./songs/song-takeover.js'), cls: 'SongTakeover' },
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
// 復旧にはフルリロードで新しい index.html→新ハッシュを取り直す必要がある。
// 「勝手にリロード」が問題になるのは没入中(ポーズ作成中など)に走る場合だが、
// チャンク取得失敗は必ず「曲を選んだロード時=カーテンが閉じている瞬間」にしか起きず、
// 没入中には発生しない。そこで自動リロードは _onSongChunkUnavailable に一本化し、
// 曲選択時のチャンク失敗に限って即リロード→復帰させる(没入中には決して走らない)。
// 復旧後はタイトル/プロローグを飛ばして選曲画面へ直帰し、さらに失敗した曲そのものを
// 自動で読み直すため、ユーザーから見れば「一瞬の再読込のあとそのまま曲が始まる」。
// 一方でバックグラウンドのプリロード失敗(vite:preloadError)はユーザー操作と無関係に
// 走るため自動リロードせず、任意で押せる「更新」バナー(showManualUpdatePrompt)に委ねる。
const RELOAD_RECOVER_KEY = 'mm_chunk_recovering';   // 立っていればリロード後にタイトルを飛ばす
const RECOVER_SONG_KEY = 'mm_chunk_recover_song';   // 復帰後に自動で読み直す曲ID
// 自動リロードのループ防止。直近にこの猶予内で一度リロード済みなら、再失敗しても
// 「別要因」とみなしてもう自動リロードせず、エラー画面に切り替える。
const RELOAD_RETRY_AT_KEY = 'mm_chunk_reload_at';
const RELOAD_RETRY_WINDOW_MS = 30 * 1000;

// 曲を次々に遊ぶと three.js/VRM/MMD/TextAlive のリソースが少しずつ積み上がり、
// やがて描画が重くなる(特にスマホ)。確実なリセットはフルリロードだけなので、
// 「湖へ戻る」瞬間(=カーテンが黒く覆っていてユーザーが何も操作していない間)に限り、
// この曲数ごとに一度だけ裏でリロードしてリソースを解放する。0 にすると無効。
// リロード後は復帰フラグでタイトルを飛ばし湖へ直帰するので、体感は黒い間の一瞬の間だけ。
const RELOAD_AFTER_SONGS = 3;

// 注: 裏リロード/チャンク復帰直後に body 既定の空色(base.css)が最初の1フレーム覗くのを
// 防ぐ処理は index.html 先頭の同期スクリプト(<html>に boot-recover を付与)＋ base.css の
// `html.boot-recover` ルールで、body が描画される前に暗色固定している。module スクリプトは
// 最初のペイント後に実行されるためここでは塗らない(間に合わない)。

function isStaleChunkError(err) {
    const msg = (err && (err.message || err.toString())) || '';
    return msg.includes('Failed to fetch dynamically imported module')
        || msg.includes('error loading dynamically imported module')
        || msg.includes('Importing a module script failed'); // Safari の同等メッセージ
}

// stale chunk を検知したときに一度だけ出す「更新」バナー。リロードは決して自動では
// 行わず、ユーザーがこのバナーをタップした瞬間にだけ走る(=任意のタイミングで更新)。
let manualUpdatePromptShown = false;
function showManualUpdatePrompt() {
    if (manualUpdatePromptShown) return;
    manualUpdatePromptShown = true;
    console.warn('[Ripple Lyrics] 古い曲チャンクを検出。更新バナーを表示します(自動リロードはしません)。');
    try {
        const bar = document.createElement('div');
        bar.style.cssText = `
            position: fixed; left: 50%;
            bottom: calc(28px + env(safe-area-inset-bottom, 0px));
            transform: translateX(-50%) translateY(8px);
            display: flex; align-items: center; gap: 14px;
            padding: 10px 14px 10px 22px; border-radius: 24px;
            font-family: 'Noto Sans JP', 'Inter', sans-serif;
            font-size: 13px; letter-spacing: 0.06em; white-space: nowrap;
            color: rgba(255,255,255,0.92); background: rgba(20,40,60,0.78);
            border: 1px solid rgba(255,255,255,0.22);
            -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
            z-index: 3000; opacity: 0;
            transition: opacity 0.5s ease, transform 0.5s ease;
        `;
        const msg = document.createElement('span');
        msg.textContent = '新しいバージョンがあります';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '更新';
        btn.style.cssText = `
            font-family: inherit; font-size: 13px; font-weight: 700;
            letter-spacing: 0.08em; color: #0b1a26;
            padding: 7px 18px; border-radius: 18px; border: none;
            background: rgba(255,255,255,0.92); cursor: pointer;
            touch-action: manipulation;
        `;
        // ここだけがアプリ内で location.reload() を呼ぶ唯一の経路。必ずユーザー操作起点。
        btn.addEventListener('click', () => {
            try { sessionStorage.setItem(RELOAD_RECOVER_KEY, '1'); } catch (_) { /* storage不可でもリロードは試みる */ }
            location.reload();
        });
        bar.appendChild(msg);
        bar.appendChild(btn);
        document.body.appendChild(bar);
        requestAnimationFrame(() => {
            bar.style.opacity = '1';
            bar.style.transform = 'translateX(-50%) translateY(0)';
        });
    } catch (_) { /* バナー生成失敗は致命的でない */ }
}

// Vite が dynamic import を変換した際の標準プリロード失敗イベント。
// プリロードはユーザーが曲を選ぶ前にバックグラウンドで走るため、ここで何かすると
// 「選曲画面を眺めているだけ」で勝手に挙動が変わって見える。ここでは Vite 既定の
// throw を抑止するだけに留め、実際の対応は曲を選んだ瞬間の import() 失敗
// (switchToSongScene)側でリトライ→必要時のみ「更新」バナー、に集約する。
window.addEventListener('vite:preloadError', (event) => {
    if (isStaleChunkError(event.payload)) {
        event.preventDefault();
    }
});

// スマホ向けレターボックス/ピラーボックスの座標系シムを最優先で仕込む
// (シーンのカメラ aspect やポインタ計算より前に有効化する必要がある)
initStage();

class Application {
    constructor() {
        this.lakeUI = null;
        this.currentSongScene = null;
        // このページ読み込み以降に開いた曲数。RELOAD_AFTER_SONGS に達したら
        // 「湖へ戻る」瞬間に裏リロードしてリソースをリセットする(リロードで0に戻る)。
        this._songsSinceLoad = 0;
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

        // 「更新」バナーのタップ、または曲選択時のチャンク失敗による自動リロードで
        // 戻ってきた直後か?(復帰フラグが立っている)。その場合はタイトル/プロローグを
        // 一切挟まず選曲画面へ直帰し、さらに失敗していた曲があればそのまま自動で開き直す
        // (=「選曲したらタイトルに飛ばされた/選び直し」という断絶を感じさせない)。
        let recovering = false;
        let recoverSongId = null;
        try {
            recovering = sessionStorage.getItem(RELOAD_RECOVER_KEY) === '1';
            if (recovering) sessionStorage.removeItem(RELOAD_RECOVER_KEY);
            recoverSongId = sessionStorage.getItem(RECOVER_SONG_KEY);
            if (recoverSongId) sessionStorage.removeItem(RECOVER_SONG_KEY);
        } catch (_) { /* sessionStorage 不可環境では通常フローへ */ }

        if (recovering) {
            // 音量コントロールを表示して即・選曲画面へ。リロードの理由をさりげなく伝える。
            this.volumeControl.show();
            initWorld();
            this.showRecoveryToast();
            // 自動リロード前に開こうとしていた曲があれば、選び直さず自動で開き直す。
            if (recoverSongId) this._resumeSongAfterRecover(recoverSongId);
        } else {
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
        }

        // ── DEBUG MODE ──
        // デプロイで開発者向け機能が有効(DEV_TOOLS_ENABLED)なビルドに限り、?debug=1 で起動。
        // 公開・提出用ビルド(VITE_DEV_TOOLS 未設定)では ?debug=1 を付けても無効。
        if (DEV_TOOLS_ENABLED && new URLSearchParams(location.search).get('debug') === '1') {
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
                const wasAllComplete = appState.areAllSongsComplete();
                if (markComplete && appState.currentSongId) {
                    appState.markSongComplete(appState.currentSongId);
                }
                // この復帰で通常曲を全クリアした瞬間だけは、全曲制覇の祝福
                // (CompletionScreen)を潰さないよう裏リロードを見送る。
                const justCompletedAll = !wasAllComplete && appState.areAllSongsComplete();

                appState.setCurrentSong(null);
                appState.setLoading(false);

                if (this.currentSongScene) {
                    this.currentSongScene.destroy();
                    this.currentSongScene = null;
                }

                document.body.style.backgroundImage = '';
                document.body.style.backgroundColor = '';

                // 累積で重くなる前に、カーテンが覆っている黒い間に裏リロードして
                // 全リソース(three.js/VRM/MMD/TextAlive)を一掃する。リロード後は
                // 復帰フラグでタイトルを飛ばし湖へ直帰するので、体感は黒い間の一瞬だけ。
                if (!justCompletedAll && this._shouldBackgroundReload()) {
                    console.warn('[Ripple Lyrics] 区切りで裏リロードしてリソースをリセットします');
                    location.reload();
                    return; // この後の lakeUI.show() は不要(リロードする)
                }

                this.lakeUI.show();
            }, { out: 450, in: 650 });
        });
    }

    _showSongEndOverlay(onDone) {
        const songConfig = SONGS.find(s => s.id === appState.currentSongId);
        const color = songConfig ? songConfig.color : '#ffffff';
        // こたえて(ひまわり登攀)のフィナーレは暗転させず、満開の大輪を見せ続ける。
        // 出すのは「楽曲選択画面へ」のボタンだけ(締めの一文・成果カードは出さない)。
        const isKotaete = appState.currentSongId === 'kotaete';

        const overlay = document.createElement('div');
        // 背景は半透明(0.7)止まりなので、下端フッターの再生シークバー(z-index:10)は
        // この上に重ねたリザルトの背後で透けて見える。中央寄せのままだと画面の低い
        // スマホ(特に横持ち)で「楽曲選択画面へ」ボタンや成果サマリーがシークバー帯と
        // 重なってしまうため、上下にフッター/ヘッダー帯ぶんのパディングを確保して
        // 中央寄せ領域そのものを安全域へ押し込み、ボタンが絶対にシークバーへ被らないようにする。
        overlay.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            box-sizing: border-box;
            padding-top: calc(96px + env(safe-area-inset-top, 0px));
            padding-bottom: calc(112px + env(safe-area-inset-bottom, 0px));
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            background: rgba(0,0,0,0);
            z-index: 2000; pointer-events: none;
            transition: background 0.8s ease, opacity 0.8s ease;
        `;

        const text = document.createElement('div');
        text.textContent = 'この問いと、向き合えた';
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

        if (!isKotaete) overlay.appendChild(text);

        // 曲固有の成果サマリー(エンドカード) — setResultSummary登録曲のみ
        let resultEl = null;
        const result = this._lastSongResult;
        if (!isKotaete && result && result.songId === appState.currentSongId && Array.isArray(result.lines)) {
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
            if (!isKotaete) {
                overlay.style.background = 'rgba(0,0,0,0.7)'; // こたえては暗転しない
                text.style.color = 'rgba(255,255,255,0.9)';
            }
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
        const entry = SONG_LOADERS[songConfig.id];
        if (entry) {
            const Loaded = await this._loadSongClass(entry, songConfig.id);
            // ロード中に別の曲へ切り替わっていたら、この結果は捨てる
            if (token !== this._sceneToken) return;
            if (!Loaded) {
                // 実曲のシーンチャンクをどうしても取得できなかった。BaseSong の
                // 「黒画面+白い歌詞だけ」という壊れて見える状態は絶対に見せず、
                // カーテンを開けて明示的な復帰導線(再読み込み/湖へ戻る)を出す。
                this._onSongChunkUnavailable(songConfig);
                return;
            }
            SongClass = Loaded;
        } else if (token !== this._sceneToken) {
            return;
        }

        // 曲のロードに成功した = 自動リロードのループ防止ガードはもう不要。解除して、
        // 以後また別の曲が stale で失敗したら改めて自動リロードで復帰できるようにする。
        try { sessionStorage.removeItem(RELOAD_RETRY_AT_KEY); } catch (_) { /* 解除失敗は無害 */ }

        this._songsSinceLoad++; // 累積リソースの目安(裏リロード判定に使う)
        this.currentSongScene = new SongClass(this.sceneContainer, songConfig.id);
        this.currentSongScene.init();
    }

    // 自動リロード復帰後、失敗した曲を「選曲し直さなくても」そのまま開き直す。
    // 湖(WorldUI)の生成完了をポーリングで待ってから、通常の選曲導線に乗せる。
    _resumeSongAfterRecover(songId) {
        const song = SONGS.find(s => s.id === songId);
        if (!song) return;
        let tries = 0;
        const tick = () => {
            tries++;
            const lake = this.lakeUI;
            if (lake && Array.isArray(lake.songs)) {
                const idx = lake.songs.findIndex(s => s.id === songId);
                if (idx >= 0 && typeof lake.selectSong === 'function') {
                    lake.selectSong(lake.songs[idx], idx); // 通常と同じ導線で開く
                    return;
                }
                // 解放状態の都合でリスト未掲載なら、湖に留めておく(無理に開かない)
                if (idx < 0) return;
            }
            if (tries < 60) setTimeout(tick, 200); // 最大~12秒待って諦める
        };
        setTimeout(tick, 300);
    }

    // 「湖へ戻る」瞬間に裏リロードすべきか。曲数が閾値に達していて、かつ復帰フラグを
    // 残せる(sessionStorage が使える)ときだけ true。フラグを残せない環境でリロードすると
    // タイトルへ送られてしまうため、その場合はリロードしない(安全側)。判定が true のときは
    // 復帰フラグもこの中で立てる(呼び出し側はそのまま location.reload() するだけでよい)。
    _shouldBackgroundReload() {
        if (!RELOAD_AFTER_SONGS || (this._songsSinceLoad || 0) < RELOAD_AFTER_SONGS) return false;
        try {
            sessionStorage.setItem(RELOAD_RECOVER_KEY, '1'); // 復帰後タイトル/プロローグを飛ばす
        } catch (_) {
            return false; // 復帰フラグを残せない=リロードするとタイトル送りになるので諦める
        }
        // RECOVER_SONG_KEY は立てない=曲ではなく湖(選曲画面)に留まる。
        return true;
    }

    // 曲シーンチャンクが取得できなかったときの復帰導線。BaseSong フォールバックの
    // 黒画面+白歌詞は絶対に出さない。チャンク失敗は曲選択時(カーテンが閉じている=
    // 没入していない瞬間)にしか起きないので、ここでは即・自動リロードして最新の
    // index.html→新ハッシュを取り直す。復帰フラグと対象曲IDを残し、リロード後は
    // タイトルを飛ばして「失敗した曲」へそのまま自動復帰する(タイトルに戻らない)。
    // ただし直近にこの猶予内で一度リロード済みなら、再失敗は別要因とみなしてループを
    // 避け、自動リロードせずエラー画面(再読み込み/湖へ戻る)に切り替える。
    _onSongChunkUnavailable(songConfig) {
        this._revealOnLoad = false; // TextAlive 側のロード完了で勝手にカーテンを開けない

        let recentlyReloaded = false;
        try {
            const last = Number(sessionStorage.getItem(RELOAD_RETRY_AT_KEY) || 0);
            recentlyReloaded = last > 0 && (Date.now() - last) < RELOAD_RETRY_WINDOW_MS;
        } catch (_) { /* sessionStorage 不可環境ではエラー画面側へ倒す */ }

        if (!recentlyReloaded) {
            // 曲選択時の stale chunk → シームレスに自動リロードして同じ曲へ復帰。
            try {
                sessionStorage.setItem(RELOAD_RETRY_AT_KEY, String(Date.now()));
                sessionStorage.setItem(RELOAD_RECOVER_KEY, '1');
                sessionStorage.setItem(RECOVER_SONG_KEY, songConfig.id);
            } catch (_) { /* storage不可でもリロードは試みる */ }
            console.warn(`[Ripple Lyrics] 曲チャンク失敗→自動リロードで復帰します: ${songConfig.id}`);
            location.reload();
            return;
        }

        // リロード後もまだ失敗 = 別要因。黒画面は出さずエラー画面で導く。
        console.error(`[Ripple Lyrics] 再読み込み後も曲チャンクを取得できませんでした: ${songConfig.id}`);
        screenFade.fadeIn(400);     // カーテンを開けてエラー画面(z3400)を見せる
        this.errorScreen.show({
            title: '曲を読み込めませんでした',
            message: '通信環境をご確認のうえ、再読み込みしてもう一度お試しください。',
            actions: [
                { label: '再読み込み', primary: true, onClick: () => {
                    try {
                        sessionStorage.setItem(RELOAD_RECOVER_KEY, '1');
                        sessionStorage.setItem(RECOVER_SONG_KEY, songConfig.id);
                        sessionStorage.removeItem(RELOAD_RETRY_AT_KEY); // 手動操作なのでガードは解除
                    } catch (_) { /* storage不可でもリロードは試みる */ }
                    location.reload();
                } },
                { label: '湖へ戻る', onClick: () => eventBus.emit('backToLake', { markComplete: false }) },
            ],
        });
    }

    // 曲チャンクを動的ロードして class を返す。電波の瞬断・プリロード競合など一過性の
    // 失敗は数回リトライすれば回復するため、stale 判定に関わらず毎回リトライする
    // (以前は stale 以外を即諦めて BaseSong に落とし、黒画面+白歌詞を招いていた)。
    // 本番ビルドでは Vite が vite:preloadError を握り潰してモジュールを undefined で
    // 解決することがある(主に stale chunk)。その場合 mod から class を取り出せない
    // ので、これも「実質ロード失敗」として扱う。最終的に取得できなければ null を返し、
    // 呼び出し側で BaseSong を見せずエラー画面へ導く。
    async _loadSongClass(entry, songId) {
        const MAX_ATTEMPTS = 3;
        const RETRY_BASE_MS = 500;
        let lastErr = null;
        let sawStale = false;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const mod = await entry.load();
                const SongClass = mod ? mod[entry.cls] : undefined;
                if (typeof SongClass === 'function') return SongClass;
                // モジュールは解決したが class が取れない = Vite が握り潰した stale chunk の疑い。
                sawStale = true;
                lastErr = new Error(`song module resolved without "${entry.cls}": ${songId}`);
                console.warn(`[Ripple Lyrics] 曲チャンクの内容が空でした (${attempt}/${MAX_ATTEMPTS}): ${songId}`);
            } catch (err) {
                lastErr = err;
                if (isStaleChunkError(err)) sawStale = true;
                console.warn(`[Ripple Lyrics] 曲チャンク取得に失敗 (${attempt}/${MAX_ATTEMPTS}): ${songId}`, err);
            }
            if (attempt < MAX_ATTEMPTS) {
                await new Promise(r => setTimeout(r, RETRY_BASE_MS * attempt));
            }
        }
        console.error(`[Ripple Lyrics] 曲チャンクのロードに失敗: ${songId}`, lastErr);
        // 再デプロイでハッシュが切れた古いチャンクなら、フルリロードで最新版を取り直せば
        // 復旧する。「更新」バナーも併せて出し、リロードのタイミングをユーザーに委ねる
        // (自動リロードは没入を壊すのでしない)。実体の復帰導線は呼び出し側のエラー画面。
        if (sawStale) showManualUpdatePrompt();
        return null;
    }

    // 復旧リロード後に「なぜ一瞬再読み込みされたか」をさりげなく伝える控えめなトースト。
    // 数秒で自動的に消える。失敗しても致命的でないため握り潰す。
    showRecoveryToast() {
        try {
            const toast = document.createElement('div');
            toast.textContent = '最新版に更新しました';
            toast.style.cssText = `
                position: fixed; left: 50%;
                bottom: calc(28px + env(safe-area-inset-bottom, 0px));
                transform: translateX(-50%) translateY(8px);
                padding: 10px 22px; border-radius: 22px;
                font-family: 'Noto Sans JP', 'Inter', sans-serif;
                font-size: 13px; letter-spacing: 0.08em; white-space: nowrap;
                color: rgba(255,255,255,0.92); background: rgba(20,40,60,0.72);
                border: 1px solid rgba(255,255,255,0.22);
                -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
                z-index: 3000; opacity: 0; pointer-events: none;
                transition: opacity 0.5s ease, transform 0.5s ease;
            `;
            document.body.appendChild(toast);
            requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(-50%) translateY(0)';
            });
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(8px)';
                setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 600);
            }, 2600);
        } catch (_) { /* トースト失敗は無視 */ }
    }
}

// Start application
const app = new Application();
window.app = app;
window.appState = appState;
window.eventBus = eventBus;
window.playerManager = playerManager; // 計測/デバッグ用にプレイヤーを公開
app.init();
