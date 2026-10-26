import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { eventBus } from '../core/eventBus.js';
import { NORMAL_SONGS, getSelectableSongs } from '../config/songs.js';
import { PHASES } from '../config/constants.js';
import { appState } from '../core/appState.js';
import { PHASE_CLASSES } from './phases/index.js';
import { screenFade } from '../ui/ScreenFade.js';
import { quality } from '../core/quality.js';
import { safeGet } from '../utils/storage.js';

// 全曲解放後に背景セレクタで選んだ過去フェーズを保持する localStorage キー。
const BG_OVERRIDE_KEY = 'bgPhaseOverride';

export class WorldUI {
    constructor(container) {
        this.container = container;
        // 選曲ハブは滞在時間が最も長い画面なので、各曲シーンと同じ基準で
        // モバイル時は重い表現(MSAA・影・bloom)を落として持続フレームレートを優先する。
        this.isMobile = quality.isMobile;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        // 解像度は品質マネージャ(端末性能+実FPSで自動調整)に委ねる。
        // Retina/高DPIでは塗りピクセルがdpr²倍になりfillrate律速になるため上限を抑える。
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        // Cinematic grading to match the redesign (Ripple Lyrics scene art direction)
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
        // PCF影はGPUのfillrateを大きく消費するため品質ティアで制御(低スペックは無効)
        this.renderer.shadowMap.enabled = quality.useShadows;
        // PCFSoftShadowMap is deprecated in this three build (falls back to PCF)
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // Post-processing: subtle bloom for luminous water/sun/song-node highlights.
        // フルスクリーンのbloomは重いので品質ティアで制御。無効時は composer を
        // 介さず renderer で直接描画する(animate参照)。
        this.useBloom = quality.useBloom;
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        if (this.useBloom) {
            this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.5, 0.85);
            this.composer.addPass(this.bloomPass);
        }
        this.composer.setSize(window.innerWidth, window.innerHeight);

        // 選曲画面に並べる曲。通常曲5曲は常時表示し、シークレット曲(こたえて)は
        // 通常曲を全クリアした後にのみ末尾へ加わる。表示数が変わったら show() で作り直す。
        this.songs = getSelectableSongs(appState.completedSongs);
        this.selectedIndex = 0;
        this.currentPhase = null;
        // 全曲解放後は、左上の背景セレクタで過去フェーズ(晴れ〜湖)の背景を自由に選べる。
        // その選択(=自動進行のオーバーライド)を localStorage に保持し、起動時に復元する。
        this.bgPhaseOverride = this._loadBgOverride();
        this.currentPhaseIndex = this._desiredPhase();
        this.isTransitioning = false;
        this.hoveredIndex = -1;

        // DOM labels
        this.labelsContainer = document.createElement('div');
        this.labelsContainer.className = 'lake-labels-container';
        this.container.appendChild(this.labelsContainer);
        this.labels = [];

        // Progress counter with phase name
        this.progressCounter = document.createElement('div');
        this.progressCounter.className = 'lake-progress-counter';
        this.labelsContainer.appendChild(this.progressCounter);

        // Phase name indicator
        this.phaseIndicator = document.createElement('div');
        this.phaseIndicator.className = 'world-phase-indicator';
        this.labelsContainer.appendChild(this.phaseIndicator);

        this._injectAffordanceStyles();
        this._initPhase(this.currentPhaseIndex);
        // 背景(湖面)に浮かぶ曲名ラベルは廃止。選曲は中央の選択パネルに一本化したので
        // _createLabels() は呼ばない(this.labels は空のまま=投影/更新処理は自然に no-op)。
        this._createSelectionPanel();
        this._createBackgroundSelector();
        this._updateProgressCounter();
        this._setSelected(0);
        this._maybeShowEnding();

        this.bindEvents();
        // Relative clock: Date.now()*0.001 (~1.8e9) exceeds float32
        // precision in shader uniforms and freezes all GPU animation
        this._clockStart = Date.now();
        this.animate = this.animate.bind(this);
        this.animationId = requestAnimationFrame(this.animate);

        // 選曲画面に入った合図 — フェーズ別BGM(bgm.js)が現在フェーズの曲を流す。
        eventBus.emit('lakeEnter');
        // 背景オーバーライド中は、進行フェーズではなく表示中フェーズのBGMに合わせる。
        this._syncBgmToDisplayedPhase();
    }

    // 「ここを押せる」と一目で分かるアフォーダンスをまとめて注入する。
    // 評価レポート(20260617_224647)で「湖上のどこを押せるか分からない」が
    // 離脱要因として複数挙がっていたため、ホバー/フォーカス時のリング・発光・
    // ラベルを強化し、ホバーが無いタッチ環境でも常時うっすら手がかりが
    // 見えるようにする(coarse pointer 向けの控えめな常時パルス)。
    // 制約上 WorldUI.js のみ編集可のため、スタイルは <style> として自前注入する。
    _injectAffordanceStyles() {
        if (document.getElementById('world-affordance-styles')) return;
        const style = document.createElement('style');
        style.id = 'world-affordance-styles';
        style.textContent = `
        /* ── 選曲UIの「押せる」アフォーダンス強化 ───────────────── */

        /* 共通: フォーカスリング(キーボード/スクリーンリーダ操作で押せる事を明示) */
        .world-nav-btn:focus-visible,
        .world-selection-start:focus-visible,
        .song-label:focus-visible {
            outline: none;
            box-shadow: 0 0 0 3px rgba(255,255,255,0.85),
                        0 0 18px color-mix(in srgb, var(--selection-color, #7F77DD) 70%, transparent);
        }

        /* ◀▶ ナビ: ホバー/フォーカスで明るいリングと拡大、押せる感を強調 */
        .world-nav-btn {
            position: relative;
            transition: background 0.18s, border-color 0.18s, transform 0.12s, box-shadow 0.18s;
        }
        .world-nav-btn:hover,
        .world-nav-btn:focus-visible {
            transform: scale(1.08);
            border-color: rgba(255,255,255,0.85);
            box-shadow: 0 0 16px color-mix(in srgb, var(--selection-color, #7F77DD) 55%, transparent);
        }

        /* 「この曲をはじめる」: ホバー/フォーカスでわずかに浮き上がり発光を強める */
        .world-selection-start {
            position: relative;
            overflow: hidden;
        }
        .world-selection-start:hover,
        .world-selection-start:focus-visible {
            transform: translateY(-1px);
            box-shadow: 0 6px 24px color-mix(in srgb, var(--selection-color, #7F77DD) 55%, transparent),
                        0 0 0 1px color-mix(in srgb, var(--selection-color, #7F77DD) 80%, transparent);
        }
        /* ボタン上を一度だけ光が走り、主要導線である事を示す */
        .world-selection-start::after {
            content: '';
            position: absolute;
            top: 0;
            left: -60%;
            width: 40%;
            height: 100%;
            background: linear-gradient(100deg, transparent, rgba(255,255,255,0.28), transparent);
            transform: skewX(-18deg);
            pointer-events: none;
            opacity: 0;
        }
        .world-selection-start--attention::after {
            animation: world-start-sheen 1.1s ease;
        }
        @keyframes world-start-sheen {
            0%   { left: -60%; opacity: 0; }
            20%  { opacity: 1; }
            80%  { opacity: 1; }
            100% { left: 140%; opacity: 0; }
        }

        /* 曲名ラベル: ホバー/フォーカスで光輪のリングを敷き、押せる範囲を可視化 */
        .song-label {
            border-radius: 12px;
            transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.12s ease;
        }
        .song-label--hovered,
        .song-label:hover,
        .song-label:focus-visible {
            background: radial-gradient(closest-side,
                        rgba(255,255,255,0.10), rgba(255,255,255,0) 78%);
            box-shadow: 0 0 0 1px rgba(255,255,255,0.22) inset,
                        0 0 20px color-mix(in srgb, var(--selection-color, #7F77DD) 35%, transparent);
        }

        /* タッチ(coarse pointer)環境ではホバーが効かないため、
           主要導線に常時うっすら「触れる」サインを灯し続ける。 */
        @media (hover: none), (pointer: coarse) {
            .world-selection-start {
                animation: world-start-breathe 2.6s ease-in-out infinite;
            }
            .world-nav-btn {
                border-color: rgba(255,255,255,0.5);
                background: rgba(255,255,255,0.12);
            }
            /* 選択中の曲名は常に光輪を薄く出して「触れる対象」と示す */
            .song-label.song-label--front {
                box-shadow: 0 0 0 1px rgba(255,255,255,0.16) inset,
                            0 0 16px color-mix(in srgb, var(--selection-color, #7F77DD) 28%, transparent);
                border-radius: 12px;
            }
        }
        @keyframes world-start-breathe {
            0%, 100% { box-shadow: 0 0 0 color-mix(in srgb, var(--selection-color, #7F77DD) 0%, transparent); }
            50%      { box-shadow: 0 0 18px color-mix(in srgb, var(--selection-color, #7F77DD) 45%, transparent); }
        }

        /* 「タップで選ぶ」ヒント: サムネイル横に小さく出す押下案内 */
        .world-tap-hint {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            bottom: calc(150px + env(safe-area-inset-bottom, 0px));
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            border-radius: 999px;
            background: rgba(6,10,22,0.5);
            border: 1px solid rgba(255,255,255,0.22);
            color: rgba(255,255,255,0.82);
            font-size: 11.5px;
            letter-spacing: 0.12em;
            font-family: 'Noto Sans JP', 'Inter', sans-serif;
            white-space: nowrap;
            pointer-events: none;
            z-index: 99;
            text-shadow: 0 1px 3px rgba(0,0,0,0.8);
            animation: world-tap-hint-pulse 2.4s ease-in-out infinite;
        }
        .world-tap-hint .world-tap-hint-dot {
            width: 7px; height: 7px; border-radius: 50%;
            background: color-mix(in srgb, var(--selection-color, #7F77DD) 70%, #fff);
            box-shadow: 0 0 8px color-mix(in srgb, var(--selection-color, #7F77DD) 80%, transparent);
        }
        @keyframes world-tap-hint-pulse {
            0%, 100% { opacity: 0.55; }
            50%      { opacity: 1; }
        }
        .world-tap-hint--hide { opacity: 0; transition: opacity 0.5s ease; }

        @media (prefers-reduced-motion: reduce) {
            .world-selection-start,
            .world-tap-hint,
            .world-selection-start--attention::after {
                animation: none !important;
            }
        }
        `;
        document.head.appendChild(style);
        this._affordanceStyleEl = style;
    }

    _initPhase(phaseIndex) {
        if (this.currentPhase) {
            this.currentPhase.dispose();
        }

        const PhaseClass = PHASE_CLASSES[phaseIndex] || PHASE_CLASSES[0];
        this.currentPhase = new PhaseClass(this.scene, this.camera, this.renderer);
        this.currentPhase.enter(null);
        this._applyPhaseGrading(this.currentPhase);
        this.currentPhase.createSongMarkers(this.songs);
        // 選曲は中央パネル(左右矢印＋決定ボタン)だけで完結させる方針のため、
        // 湖面に浮かぶ曲オーブは描画しない(位置計算/ピッキングの仕組みは残す)。
        this._hideSongMarkers();
        this.currentPhaseIndex = phaseIndex;
    }

    // Apply the phase's tone-mapping exposure + bloom grading to the shared
    // renderer/composer. Each phase tunes these to its mood (bright meadow,
    // brooding rain, luminous lake).
    _applyPhaseGrading(phase) {
        if (phase.exposure !== undefined) this.renderer.toneMappingExposure = phase.exposure;
        const b = phase.bloomParams;
        if (b && this.bloomPass) {
            this.bloomPass.strength = b.strength;
            this.bloomPass.radius = b.radius;
            this.bloomPass.threshold = b.threshold;
        }
    }

    // 背景(湖面)に浮かぶ曲名ラベルは廃止。選曲は中央パネル(左右矢印＋決定ボタン)に
    // 一本化したため、ここでは既存ラベルの撤去だけを行い新規生成はしない。
    // 呼び出し側(初期化/曲数変化時)の構造を変えずに「ラベルなし」を実現する。
    _createLabels() {
        this.labels.forEach(l => {
            if (l.element.parentNode) l.element.parentNode.removeChild(l.element);
        });
        this.labels = [];
    }

    // 湖面に浮かぶ曲オーブ(リング/グロー/球)を非表示にする。位置計算やピッキングの
    // 仕組みは残したまま見た目だけ隠す。マーカー再生成のたびに呼ぶ。
    _hideSongMarkers() {
        (this.currentPhase?.songMarkers || []).forEach(m => { m.visible = false; });
    }

    // Central selection state: highlights the marker, focuses the label,
    // and updates the confirmation panel. Starting a song always goes
    // through an explicit second action (panel button / repeat tap / Enter).
    _setSelected(index) {
        const prev = this.selectedIndex;
        if (this.currentPhase) {
            if (prev !== index) this.currentPhase.onUnhover(prev);
            this.currentPhase.onHover(index);
        }
        this.selectedIndex = index;
        // 実際に選択が動いた=ユーザーが操作した時だけ手がかりヒントを引っ込める
        // (構築時の初期 _setSelected(0) では prev===index なので残す)
        if (prev !== index) this._dismissTapHint?.();
        this._updateSelectionPanel();
    }

    // 全曲のサムネイルを先読み＆デコードしてキャッシュに常駐させる。
    // これをやらないと、曲を切り替えて初めて img.src へそのURLを入れた瞬間に
    // 取得+デコードが走り、矢印を押してから絵が出るまで明確なラグになる。
    _preloadThumbnails() {
        // シークレット曲(こたえて)解放で曲が増えると再度呼ばれる。Map のキー(src)で
        // 重複を弾くので、新しく増えたサムネだけが追加で先読みされる。
        if (!this._thumbPreload) this._thumbPreload = new Map();   // src -> Image (GC されないよう参照を保持)
        this.songs.forEach((song) => {
            if (!song.thumbnail) return;
            const src = import.meta.env.BASE_URL + song.thumbnail;
            if (this._thumbPreload.has(src)) return;
            const img = new Image();
            img.src = src;
            // 取得後にデコードまで済ませておくと差し替えが完全に即時になる
            img.decode?.().catch(() => {});
            this._thumbPreload.set(src, img);
        });
    }

    _createSelectionPanel() {
        // サムネイルは曲ごとに差し替えるので、最初に全部先読みしておく
        this._preloadThumbnails();

        // 選択中の曲のサムネイル(課題曲の公式MVサムネイル)を大きく表示
        this.thumbCard = document.createElement('div');
        this.thumbCard.className = 'world-thumb-card';
        this.thumbCard.innerHTML = `<img class="world-thumb-img" alt="" />`;
        this.container.appendChild(this.thumbCard);
        this.thumbImg = this.thumbCard.querySelector('.world-thumb-img');

        this.selectionPanel = document.createElement('div');
        this.selectionPanel.className = 'world-selection-panel';
        this.selectionPanel.innerHTML = `
            <div class="world-selection-nav">
                <button class="world-nav-btn world-nav-prev" aria-label="前の曲">&#9664;</button>
                <div class="world-selection-info">
                    <div class="world-selection-title"></div>
                    <div class="world-selection-artist"></div>
                </div>
                <button class="world-nav-btn world-nav-next" aria-label="次の曲">&#9654;</button>
            </div>
            <button class="world-selection-start">この曲をはじめる&nbsp;▶</button>
        `;
        this.container.appendChild(this.selectionPanel);

        // 表示曲数(this.songs.length)はシークレット解放で変わりうるので、
        // 巡回は固定値ではなくハンドラ実行時の現在の曲数を参照する。
        this.selectionPanel.querySelector('.world-nav-prev').addEventListener('click', (e) => {
            e.stopPropagation();
            const N = this.songs.length;
            this._setSelected((this.selectedIndex - 1 + N) % N);
        });
        this.selectionPanel.querySelector('.world-nav-next').addEventListener('click', (e) => {
            e.stopPropagation();
            const N = this.songs.length;
            this._setSelected((this.selectedIndex + 1) % N);
        });
        this.selectionPanel.querySelector('.world-selection-start').addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectSong(this.songs[this.selectedIndex], this.selectedIndex);
        });

        // 旧: 湖面オーブをタップする手がかりヒント。オーブ廃止＋選択を中央パネルに
        // 一本化したため不要になった(矢印と決定ボタンで操作が自明)。

        // Lock the panel width to the longest title (incl. the ✓ mark)
        // so it doesn't resize every time the selection changes
        const titleEl = this.selectionPanel.querySelector('.world-selection-title');
        const artistEl = this.selectionPanel.querySelector('.world-selection-artist');
        let maxWidth = 0;
        this.songs.forEach((song) => {
            titleEl.innerHTML = `${song.title} <span>✓</span>`;
            artistEl.textContent = song.artist;
            maxWidth = Math.max(maxWidth, this.selectionPanel.offsetWidth);
        });
        if (maxWidth > 0) this.selectionPanel.style.width = `${Math.ceil(maxWidth)}px`;
    }

    _updateSelectionPanel() {
        if (!this.selectionPanel) return;
        const song = this.songs[this.selectedIndex];
        if (!song) return;
        const titleEl = this.selectionPanel.querySelector('.world-selection-title');
        const artistEl = this.selectionPanel.querySelector('.world-selection-artist');
        const isCompleted = appState.isSongComplete(song.id);
        titleEl.innerHTML = `${song.title}${isCompleted ? ' <span style="color:#D4AF37">✓</span>' : ''}`;
        artistEl.textContent = song.artist;
        this.selectionPanel.style.setProperty('--selection-color', song.color);

        // 選択中の曲のサムネイルを更新(曲のテーマ色の縁取り付き)
        if (this.thumbCard && this.thumbImg && song.thumbnail) {
            const src = import.meta.env.BASE_URL + song.thumbnail;
            if (this.thumbImg.getAttribute('src') !== src) {
                this.thumbImg.src = src;
                this.thumbImg.alt = `${song.title} ジャケット`;
                // 切り替え時にふわっと差し替え
                this.thumbCard.classList.remove('swap');
                void this.thumbCard.offsetWidth;
                this.thumbCard.classList.add('swap');
            }
            this.thumbCard.style.setProperty('--selection-color', song.color);
        }

        // Draw the eye to the start button right after a new song is focused
        const startBtn = this.selectionPanel.querySelector('.world-selection-start');
        startBtn.classList.remove('world-selection-start--attention');
        // Force reflow so the animation can restart
        void startBtn.offsetWidth;
        startBtn.classList.add('world-selection-start--attention');
    }

    // 全曲(6/6)制覇したときの控えめな達成テキスト。湖面UIに一度だけ表示する。
    // 既に出していれば何もしない(冪等)。過剰演出はせず、静かな完成の合図のみ。
    _maybeShowEnding() {
        if (!appState.areAllSongsComplete()) {
            if (this._endingTimeout) clearTimeout(this._endingTimeout);
            if (this._endingRemoveTimeout) clearTimeout(this._endingRemoveTimeout);
            if (this.ending?.parentNode) {
                this.ending.parentNode.removeChild(this.ending);
                this.ending = null;
            }
            this._endingShown = false;
            return;
        }
        if (this._endingShown) return;
        this._endingShown = true;

        const ending = document.createElement('div');
        ending.className = 'world-ending';
        ending.style.cssText = `
            position: absolute; left: 50%; top: 64px; transform: translateX(-50%);
            color: rgba(255,255,255,0.92); z-index: 480; pointer-events: none;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            font-size: clamp(13px, 1.5cqw, 18px); font-weight: 300; letter-spacing: 0.18em;
            text-align: center; white-space: nowrap;
            text-shadow: 0 0 6px rgba(0,0,0,0.85), 0 0 18px rgba(212,175,55,0.5);
            opacity: 0; transition: opacity 1.4s ease;
        `;
        ending.textContent = '水の循環、完成 — すべての水をめぐった';
        this.container.appendChild(ending);
        this.ending = ending;
        
        // ふわっと浮かび上がらせる
        requestAnimationFrame(() => { ending.style.opacity = '1'; });

        // 5秒後に自動的にフェードアウトし、DOMから完全に削除する(残りっぱなしを防止)
        this._endingTimeout = setTimeout(() => {
            ending.style.opacity = '0';
            this._endingRemoveTimeout = setTimeout(() => {
                if (ending.parentNode) {
                    ending.parentNode.removeChild(ending);
                }
                if (this.ending === ending) this.ending = null;
            }, 1400);
        }, 5000);
    }

    _updateProgressCounter() {
        if (!this.progressCounter) return;
        // 進捗カウンタは「水の循環」の旅=通常曲5曲を対象にする。
        // シークレット曲(こたえて)はエンディング後の隠し体験なので数えない。
        const completed = NORMAL_SONGS.filter(s => appState.isSongComplete(s.id)).length;
        const total = NORMAL_SONGS.length;
        this.progressCounter.textContent = `クリア ${completed} / ${total}`;

        if (this.phaseIndicator) {
            const phase = PHASES[this.currentPhaseIndex];
            const hint = completed < total
                ? '<span class="world-phase-hint">曲をクリアすると、水は次の姿へ</span>'
                : '';
            this.phaseIndicator.innerHTML = phase
                ? `<span class="world-phase-name">${phase.name}</span>${hint}`
                : '';
        }
    }

    // ── 背景セレクタ(全曲解放後のみ) ──────────────────────────────
    // 選曲画面の背景は通常、通常曲のクリア数で「晴れ→雲→雨→水たまり→小川→湖」と
    // 一方向に進む(appState.getPhase)。全曲解放後はこのセレクタで過去フェーズの背景を
    // 自由に選び直せる。選んだ背景(=自動進行のオーバーライド)は localStorage に保持する。

    _loadBgOverride() {
        try {
            const v = localStorage.getItem(BG_OVERRIDE_KEY);
            if (v === null) return null;
            const n = parseInt(v, 10);
            return Number.isInteger(n) && n >= 0 && n < PHASE_CLASSES.length ? n : null;
        } catch (e) { return null; }
    }

    _saveBgOverride(index) {
        try { localStorage.setItem(BG_OVERRIDE_KEY, String(index)); } catch (e) { /* storage失敗は致命的でない */ }
    }

    // 今表示すべきフェーズ。全曲解放後に手動選択(override)があればそれを、無ければ進行通りの現在フェーズ。
    _desiredPhase() {
        if (appState.areAllSongsComplete() && this.bgPhaseOverride != null) return this.bgPhaseOverride;
        return appState.getPhase();
    }

    // BGMを表示中フェーズに合わせる。lakeEnter は進行フェーズ(appState.getPhase)で鳴るため、
    // 背景オーバーライドで別フェーズを表示している時だけ phaseChange でBGMを寄せ直す。
    _syncBgmToDisplayedPhase(phase = this.currentPhaseIndex) {
        if (phase !== appState.getPhase()) eventBus.emit('phaseChange', { to: phase });
    }

    _createBackgroundSelector() {
        const wrap = document.createElement('div');
        wrap.className = 'world-bg-select';
        wrap.innerHTML = `
            <button class="world-bg-toggle" type="button" aria-haspopup="true" aria-expanded="false" aria-label="背景を選ぶ">
                <span class="world-bg-toggle-ico" aria-hidden="true">❖</span>
                <span class="world-bg-toggle-label">背景</span>
                <span class="world-bg-toggle-caret" aria-hidden="true">▾</span>
            </button>
            <div class="world-bg-menu" role="menu" hidden></div>
        `;
        this.container.appendChild(wrap);
        this.bgSelectWrap = wrap;
        this.bgToggleBtn = wrap.querySelector('.world-bg-toggle');
        this.bgMenu = wrap.querySelector('.world-bg-menu');

        // 6フェーズ分の選択肢をスウォッチ＋名前で並べる。
        PHASES.forEach((phase, i) => {
            const item = document.createElement('button');
            item.className = 'world-bg-item';
            item.type = 'button';
            item.setAttribute('role', 'menuitemradio');
            item.dataset.index = String(i);
            item.innerHTML = `<span class="world-bg-swatch" style="background:${phase.color}"></span><span class="world-bg-item-name">${phase.name}</span>`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this._switchBackground(i);
            });
            this.bgMenu.appendChild(item);
        });

        this.bgToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleBgMenu();
        });

        // メニュー外のクリック/タップで閉じる。
        this._boundCloseBgMenu = (e) => {
            if (this.bgSelectWrap && !this.bgSelectWrap.contains(e.target)) this._closeBgMenu();
        };
        document.addEventListener('click', this._boundCloseBgMenu);

        this._updateBackgroundSelector();
    }

    // 解放状況に応じて表示/非表示、トグルのラベル、選択中フェーズのハイライトを同期する。
    _updateBackgroundSelector() {
        if (!this.bgSelectWrap) return;
        const unlocked = appState.areAllSongsComplete();
        this.bgSelectWrap.style.display = unlocked ? 'block' : 'none';
        if (!unlocked) { this._closeBgMenu(); return; }

        const cur = PHASES[this.currentPhaseIndex];
        const label = this.bgToggleBtn?.querySelector('.world-bg-toggle-label');
        if (label && cur) label.textContent = cur.name;
        this.bgMenu.querySelectorAll('.world-bg-item').forEach((el) => {
            const active = Number(el.dataset.index) === this.currentPhaseIndex;
            el.classList.toggle('world-bg-item--active', active);
            el.setAttribute('aria-checked', active ? 'true' : 'false');
        });
    }

    _toggleBgMenu() {
        if (!this.bgMenu) return;
        if (this.bgMenu.hasAttribute('hidden')) this._openBgMenu();
        else this._closeBgMenu();
    }

    _openBgMenu() {
        if (!this.bgMenu || this.isTransitioning) return;
        this.bgMenu.removeAttribute('hidden');
        this.bgToggleBtn?.setAttribute('aria-expanded', 'true');
        this.bgSelectWrap?.classList.add('world-bg-select--open');
    }

    _closeBgMenu() {
        if (!this.bgMenu) return;
        this.bgMenu.setAttribute('hidden', '');
        this.bgToggleBtn?.setAttribute('aria-expanded', 'false');
        this.bgSelectWrap?.classList.remove('world-bg-select--open');
    }

    // 選んだ過去フェーズの背景へ静かにクロスフェードで切り替える。
    // 進行(クリア数)は変えず、見た目だけをオーバーライドする。
    async _switchBackground(index) {
        this._closeBgMenu();
        if (this.isTransitioning || index === this.currentPhaseIndex) return;
        this.isTransitioning = true;

        this.bgPhaseOverride = index;
        this._saveBgOverride(index);

        const overlay = document.createElement('div');
        overlay.className = 'world-bg-switch-overlay';
        overlay.style.cssText = `
            position: absolute; inset: 0; background: rgba(0,0,0,0);
            z-index: 500; pointer-events: none; transition: background 0.5s ease;
        `;
        this.container.appendChild(overlay);

        requestAnimationFrame(() => { overlay.style.background = 'rgba(0,0,0,0.92)'; });
        await new Promise(r => setTimeout(r, 520));

        this._initPhase(index);
        // 背景に合わせてBGMも選んだフェーズへクロスフェードさせる(bgm.jsがphaseChangeを購読)。
        eventBus.emit('phaseChange', { to: index });

        overlay.style.background = 'rgba(0,0,0,0)';
        await new Promise(r => setTimeout(r, 520));

        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        this.isTransitioning = false;
        this._updateProgressCounter();
        this._updateBackgroundSelector();
    }

    selectSong(song, index) {
        if (this.isTransitioning) return;
        this.isTransitioning = true;

        // 決定音は押下フィードバックなので、フェードを待たずこの瞬間に鳴らす。
        // (実際の曲ロードは下の fadeOut 完了後に loadSong で行う)
        eventBus.emit('songConfirm', song);

        if (this.currentPhase) {
            this.currentPhase.onSelect(index);
        }

        // Fade the world out to the curtain, then hand off to the song scene.
        // main.js reveals the scene (fadeIn) once it finishes loading.
        screenFade.fadeOut(450).then(() => {
            appState.setCurrentSong(song.id);
            this.renderer.domElement.style.display = 'none';
            this.labelsContainer.style.display = 'none';
            if (this.selectionPanel) this.selectionPanel.style.display = 'none';
            if (this.thumbCard) this.thumbCard.style.display = 'none';
            // 背景セレクタは選曲画面専用。曲本編に入る間は隠す(show()で再表示)。
            if (this.bgSelectWrap) { this._closeBgMenu(); this.bgSelectWrap.style.display = 'none'; }
            if (this._endingTimeout) clearTimeout(this._endingTimeout);
            if (this._endingRemoveTimeout) clearTimeout(this._endingRemoveTimeout);
            if (this.ending?.parentNode) {
                this.ending.parentNode.removeChild(this.ending);
                this.ending = null;
            }
            eventBus.emit('loadSong', song);
            this.isTransitioning = false;
        });
    }

    show() {
        // 曲本編から選曲画面へ戻った合図 — BGMを(進行後の)現在フェーズで鳴らし直す。
        eventBus.emit('lakeEnter');

        this.renderer.domElement.style.display = 'block';
        this.labelsContainer.style.display = 'block';
        if (this.selectionPanel) this.selectionPanel.style.display = 'flex';
        if (this.thumbCard) this.thumbCard.style.display = 'block';

        const playerControls = document.getElementById('player-controls');
        const backBtn = document.getElementById('back-to-lake');
        if (playerControls) playerControls.style.display = 'none';
        if (backBtn) backBtn.style.display = 'none';

        // シークレット曲(こたえて)の解放など、表示する曲が変わっていたら作り直す。
        const listChanged = this._refreshSongList();

        // 全曲解放後に背景を手動選択している場合はそのフェーズを維持する
        // (未解放時は通常どおりクリア数で決まる現在フェーズへ進む)。
        const newPhase = this._desiredPhase();
        if (newPhase !== this.currentPhaseIndex) {
            // フェーズ遷移側で this.songs を使ってマーカーを作り直すので、ここでは何もしない。
            this._transitionToPhase(newPhase);
        } else if (listChanged && this.currentPhase) {
            // フェーズは据え置きだが曲数が変わった場合はマーカーだけ作り直す。
            this.currentPhase.createSongMarkers(this.songs);
            this._hideSongMarkers();
        }

        this._refreshLabels();
        this._updateProgressCounter();
        this._updateSelectionPanel();
        this._updateBackgroundSelector();
        // lakeEnter は進行フェーズでBGMを鳴らすため、背景オーバーライド中は表示フェーズへ寄せ直す。
        this._syncBgmToDisplayedPhase(newPhase);
        this._maybeShowEnding();
    }

    // 選曲リストを現在の解放状況に同期する。表示曲数が変わったらラベルを作り直し、
    // 選択位置を補正する(マーカーの再生成は呼び出し側 show() に委ねる)。
    // 表示曲数が変化したとき true を返す。
    _refreshSongList() {
        const next = getSelectableSongs(appState.completedSongs);
        if (next.length === this.songs.length) return false;

        const hadSecret = this.songs.some(s => s.secret);
        this.songs = next;
        if (this.selectedIndex >= this.songs.length) this.selectedIndex = 0;
        this._createLabels();

        // 今まさにシークレット曲が加わったなら、湖に静かに告知する(一度だけ)。
        const hasSecret = this.songs.some(s => s.secret);
        if (hasSecret && !hadSecret) this._maybeRevealSecret();

        return true;
    }

    // 通常曲5曲を全てクリアし、湖にシークレット曲(こたえて)が現れた時の静かな告知。
    // エンディング(CompletionScreen)の後ろにそっと残る控えめなテキスト。一度だけ表示。
    _maybeRevealSecret() {
        if (safeGet('kotaeteRevealed')) return;
        try { localStorage.setItem('kotaeteRevealed', '1'); } catch (e) { /* storage失敗は致命的でない */ }

        const toast = document.createElement('div');
        toast.className = 'world-secret-reveal';
        toast.style.cssText = `
            position: absolute; left: 50%; top: 108px; transform: translateX(-50%);
            color: rgba(255,255,255,0.92); z-index: 470; pointer-events: none;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            font-size: clamp(12px, 1.4cqw, 16px); font-weight: 300; letter-spacing: 0.16em;
            text-align: center; white-space: nowrap;
            text-shadow: 0 0 6px rgba(0,0,0,0.85), 0 0 18px rgba(127,119,221,0.6);
            opacity: 0; transition: opacity 1.4s ease;
        `;
        toast.textContent = 'ひとつ、こたえを待つ歌が湖に浮かんでいる──';
        this.container.appendChild(toast);
        this._secretToast = toast;

        // エンディング演出と重ならないよう、少し遅れて静かに浮かび上がらせる。
        this._secretRevealTimeout = setTimeout(() => {
            toast.style.opacity = '1';
            this._secretRevealHideTimeout = setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => {
                    if (toast.parentNode) toast.parentNode.removeChild(toast);
                    if (this._secretToast === toast) this._secretToast = null;
                }, 1400);
            }, 6000);
        }, 2600);
    }

    _refreshLabels() {
        // 背景の曲名ラベルは廃止済み(this.labels は空)。残っている場合のみ更新する。
        if (!this.labels.length) return;
        this.songs.forEach((song, i) => {
            const isCompleted = appState.isSongComplete(song.id);
            const titleEl = this.labels[i].element.querySelector('.song-title');
            if (isCompleted && titleEl && !titleEl.querySelector('.complete-mark')) {
                const mark = document.createElement('span');
                mark.className = 'complete-mark';
                mark.textContent = '✓';
                mark.style.cssText = 'color:#D4AF37; margin-left:5px; filter:drop-shadow(0 0 4px #D4AF37);';
                titleEl.appendChild(mark);
            }
        });
    }

    async _transitionToPhase(newPhaseIndex) {
        if (this.isTransitioning) return;
        this.isTransitioning = true;

        // Create transition overlay
        const overlay = document.createElement('div');
        overlay.className = 'world-phase-transition';
        overlay.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0); z-index: 500;
            transition: background 1.2s ease;
            display: flex; align-items: center; justify-content: center;
            pointer-events: none;
        `;
        const phaseText = document.createElement('div');
        phaseText.style.cssText = `
            color: rgba(255,255,255,0); font-size: clamp(16px, 4vw, 28px);
            letter-spacing: 0.5em; font-weight: 300;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            transition: color 1s ease 0.5s;
        `;
        const phaseName = PHASES[newPhaseIndex]?.name || '';
        phaseText.textContent = `水は ${phaseName} になった`;
        overlay.appendChild(phaseText);
        this.container.appendChild(overlay);

        // Fade in
        requestAnimationFrame(() => {
            overlay.style.background = 'rgba(0,0,0,0.85)';
            phaseText.style.color = 'rgba(255,255,255,0.9)';
        });

        await new Promise(r => setTimeout(r, 2000));

        // Switch phase
        this._initPhase(newPhaseIndex);

        // Fade out
        overlay.style.transition = 'background 1s ease, opacity 1s ease';
        phaseText.style.transition = 'color 0.5s ease';
        phaseText.style.color = 'rgba(255,255,255,0)';
        overlay.style.background = 'rgba(0,0,0,0)';

        await new Promise(r => setTimeout(r, 1200));

        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        this.isTransitioning = false;
        this._updateProgressCounter();
        this._updateBackgroundSelector();
    }

    bindEvents() {
        this.boundOnWindowResize = this.onWindowResize.bind(this);
        this.boundOnKeyDown = this.onKeyDown.bind(this);
        this.boundOnClick = this.onClick.bind(this);
        this.boundOnMouseMove = this.onMouseMove.bind(this);
        this.boundOnSongComplete = this.onSongComplete.bind(this);

        window.addEventListener('resize', this.boundOnWindowResize);
        window.addEventListener('keydown', this.boundOnKeyDown);
        this.container.addEventListener('click', this.boundOnClick);
        this.container.addEventListener('mousemove', this.boundOnMouseMove);
        eventBus.on('songComplete', this.boundOnSongComplete);
    }

    onMouseMove(event) {
        if (appState.currentSongId !== null || this.renderer.domElement.style.display === 'none') return;
        const picked = this._pickMarker(event.clientX, event.clientY);
        this.renderer.domElement.style.cursor = picked !== -1 ? 'pointer' : 'default';

        if (picked === this.markerHoverIndex) return;
        // Selected marker keeps its highlight; only transient hovers toggle
        if (this.markerHoverIndex !== undefined && this.markerHoverIndex !== -1
            && this.markerHoverIndex !== this.selectedIndex && this.currentPhase) {
            this.currentPhase.onUnhover(this.markerHoverIndex);
        }
        if (picked !== -1 && picked !== this.selectedIndex && this.currentPhase) {
            this.currentPhase.onHover(picked);
        }
        this.markerHoverIndex = picked;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    onClick(event) {
        if (appState.currentSongId !== null || this.renderer.domElement.style.display === 'none') return;
        if (event.target.closest('.song-label')) return;
        if (event.target.closest('.world-selection-panel')) return;

        // Screen-space pick: find the marker nearest to the tap point.
        // Tapping empty space does nothing — songs never start by accident.
        const picked = this._pickMarker(event.clientX, event.clientY);
        if (picked === -1) return;

        if (picked === this.selectedIndex) {
            this.selectSong(this.songs[picked], picked);
        } else {
            this._setSelected(picked);
        }
    }

    _pickMarker(clientX, clientY) {
        // 曲オーブを廃止し選択を中央パネルに一本化したため、シーン上のタップ選択は無効。
        // (見えない湖面をタップして選曲が変わる紛らわしい挙動を防ぐ)
        return -1;
        // eslint-disable-next-line no-unreachable
        if (!this.currentPhase) return -1;
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        // Generous tap target (~64px radius) for mobile friendliness
        const threshold = Math.max(64, window.innerWidth * 0.06);

        let best = -1;
        let bestDist = Infinity;
        this.songs.forEach((song, i) => {
            const worldPos = this.currentPhase.getSongPosition(i);
            const projected = worldPos.clone().project(this.camera);
            if (projected.z >= 1) return;
            const x = (projected.x * widthHalf) + widthHalf;
            const y = -(projected.y * heightHalf) + heightHalf;
            const dist = Math.hypot(clientX - x, clientY - y);
            if (dist < threshold && dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        });
        return best;
    }

    onKeyDown(e) {
        if (appState.currentSongId !== null || this.renderer.domElement.style.display === 'none') return;
        const N = this.songs.length;
        if (e.code === 'ArrowRight') {
            e.preventDefault();
            this._setSelected((this.selectedIndex + 1) % N);
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            this._setSelected((this.selectedIndex - 1 + N) % N);
        } else if (e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            this.selectSong(this.songs[this.selectedIndex], this.selectedIndex);
        }
    }

    onSongComplete(songId) {
        this._refreshLabels();
        this._updateProgressCounter();
    }

    animate() {
        this.animationId = requestAnimationFrame(this.animate);
        if (this.renderer.domElement.style.display === 'none') return;

        const time = (Date.now() - this._clockStart) * 0.001;

        // Phase-driven camera parallax: drift around a base position and keep
        // looking at the phase's focus point (recreates the redesign's gentle
        // sweep). Falls back gracefully if a phase omits cameraRig.
        const rig = this.currentPhase?.cameraRig;
        if (rig) {
            const d = rig.drift || {};
            this.camera.position.set(
                rig.pos[0] + Math.sin(time * (d.fx ?? 0.10)) * (d.ax ?? 2.0),
                rig.pos[1] + Math.sin(time * (d.fy ?? 0.16) + 1.3) * (d.ay ?? 0.25),
                rig.pos[2]
            );
            this.camera.lookAt(rig.lookAt[0], rig.lookAt[1], rig.lookAt[2]);
            // Refresh matrices now so label projection / picking this frame are accurate
            this.camera.updateMatrixWorld();
        }

        if (this.currentPhase) {
            this.currentPhase.update(time);

            // For PhaseLake, handle carousel rotation
            if (this.currentPhase.targetRotation !== undefined) {
                const N = this.songs.length;
                this.currentPhase.targetRotation = Math.PI / 2 - this.selectedIndex * (2 * Math.PI / N);
            }
        }

        // Update label positions from phase
        this._updateLabelPositions();

        // 実FPSに応じて解像度を自動調整(値が変わった時だけ反映されるので軽い)
        quality.maybeApply(this.renderer, this.useBloom ? this.composer : null);

        // bloom 無効時は composer を介さず直接描画(余計なフルスクリーンパスを省く)
        if (this.useBloom) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    _updateLabelPositions() {
        if (!this.currentPhase) return;

        const W = window.innerWidth, H = window.innerHeight;
        const widthHalf = W / 2, heightHalf = H / 2;
        const padTop = 70;
        const padBot = 200; // keep labels clear of the selection panel

        // モバイルは画面が狭く、6曲ぶんの文字を背景に散らすと潰れ合うので、
        // 背景には選択中の曲名だけを残し、他は3Dの光(マーカー)に名前付けを委ねる。
        const mobile = W < 768;
        // 各フェーズが scene.fog / scene.background に設定している大気色。
        // これを「奥行きで溶け込む先の色」として遠いラベルに馴染ませる(空気遠近法)。
        const atmCol = this.scene.fog?.color || this.scene.background;
        const atmStyle = (atmCol && atmCol.getStyle) ? atmCol.getStyle() : 'rgb(205,215,225)';

        // Thumbnail card box (centered, foreground) that labels must avoid.
        const tc = this.thumbCard;
        let card = null;
        if (tc && tc.style.display !== 'none' && tc.offsetWidth) {
            const margin = 18;
            card = {
                cx: W / 2,
                cy: H - (W <= 480 ? 196 : 184) - tc.offsetHeight / 2, // matches CSS bottom
                hw: tc.offsetWidth / 2 + margin,
                hh: tc.offsetHeight / 2 + margin,
            };
        }

        const clampX = (v, hw) => Math.max(hw + 8, Math.min(W - hw - 8, v));
        const clampY = (v) => Math.max(padTop, Math.min(H - padBot, v));

        // Push a label box out of the card (least-penetration axis; never
        // downward, where the selection panel lives).
        const avoidCard = (p) => {
            if (!card) return;
            const dx = p.cx - card.cx, dy = p.cy - card.cy;
            const exX = card.hw + p.hw, exY = card.hh + p.hh;
            const ox = exX - Math.abs(dx), oy = exY - Math.abs(dy);
            if (ox > 0 && oy > 0) {
                if (ox <= oy) p.cx += dx >= 0 ? ox : -ox;
                else if (dy < 0) p.cy -= oy;
                else p.cy = card.cy - exY;
            }
        };

        // Pass 1 — project each visible label to its node and seed a position.
        const items = [];
        this.labels.forEach((labelData, i) => {
            const isSelected = i === this.selectedIndex;
            // モバイル: 選択中以外の曲名は背景から消す(光だけ残す)
            if (mobile && !isSelected) {
                labelData.element.style.opacity = '0';
                labelData.element.style.pointerEvents = 'none';
                labelData.element.classList.remove('song-label--front');
                return;
            }
            const projected = this.currentPhase.getSongPosition(i).project(this.camera);
            if (projected.z >= 1) { labelData.element.style.opacity = '0'; return; }
            labelData.element.style.pointerEvents = 'auto';
            const lw = labelData.element.offsetWidth, lh = labelData.element.offsetHeight;
            const depth = projected.z;
            items.push({
                labelData, i, lw, lh, hw: lw / 2, hh: lh / 2,
                depth,
                cx: clampX((projected.x * widthHalf) + widthHalf, lw / 2),
                cy: clampY(-(projected.y * heightHalf) + heightHalf),
                depthScale: 0.6 + (1 - depth) * 0.5,
                depthOpacity: 0.55 + (1 - depth) * 0.45,
                isSelected,
                isHovered: labelData._hovered,
            });
        });

        // Pass 2 — relax: separate labels from each other and from the card so
        // names stay legible and never sit over the jacket art.
        for (let iter = 0; iter < 6; iter++) {
            for (let a = 0; a < items.length; a++) {
                for (let b = a + 1; b < items.length; b++) {
                    const A = items[a], B = items[b];
                    let dx = B.cx - A.cx, dy = B.cy - A.cy;
                    if (dx === 0 && dy === 0) { dy = 1; }
                    const minX = A.hw + B.hw + 14, minY = A.hh + B.hh + 8;
                    const ox = minX - Math.abs(dx), oy = minY - Math.abs(dy);
                    if (ox > 0 && oy > 0) {
                        if (oy <= ox) { const s = oy / 2; if (dy >= 0) { A.cy -= s; B.cy += s; } else { A.cy += s; B.cy -= s; } }
                        else { const s = ox / 2; if (dx >= 0) { A.cx -= s; B.cx += s; } else { A.cx += s; B.cx -= s; } }
                    }
                }
            }
            for (const p of items) { avoidCard(p); p.cx = clampX(p.cx, p.hw); p.cy = clampY(p.cy); }
        }

        // Normalize depth across the currently-visible labels so the nearest
        // reads as crisp/present and the farthest recedes into the haze —
        // relative aerial perspective that holds regardless of camera distance.
        let minD = Infinity, maxD = -Infinity;
        for (const p of items) { if (p.depth < minD) minD = p.depth; if (p.depth > maxD) maxD = p.depth; }
        const dRange = maxD - minD;

        // Pass 3 — commit styles.
        for (const p of items) {
            const scale = p.depthScale * (p.isHovered ? 1.12 : 1.0) * (p.isSelected ? 1.1 : 1.0);
            const el = p.labelData.element;
            el.style.left = `${p.cx}px`;
            el.style.top = `${p.cy}px`;
            el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
            // 選択中は奥行きに関わらず前面へ引き出す(特にモバイルは唯一の見出し)
            const opacity = p.isSelected ? Math.max(0.94, p.depthOpacity) : p.depthOpacity;
            el.style.opacity = Math.min(1, opacity).toFixed(3);
            el.classList.toggle('song-label--front', p.isSelected);
            const haze = dRange > 0 ? (p.depth - minD) / dRange : 0;
            this._blendLabelWithBackground(p, haze, atmStyle);
        }
    }

    // Tone-blend a label into the phase's atmosphere color by its normalized
    // depth (haze: 0 = nearest/crisp, 1 = farthest). Distant names lighten
    // toward the background, lose their dark halo and pick up a soft haze glow
    // so they sit *in* the scene instead of floating over it. The selected
    // label is always pulled fully forward (crisp white + readable halo).
    // Cached by a coarse style key so we only repaint when the look changes.
    _blendLabelWithBackground(p, haze, atmStyle) {
        const titleEl = p.labelData.titleEl;
        if (!titleEl) return;
        const song = this.songs[p.i];

        if (p.isSelected) {
            if (p.labelData._styleKey === 'sel') return;
            p.labelData._styleKey = 'sel';
            titleEl.style.color = '#ffffff';
            titleEl.style.removeProperty('filter');
            titleEl.style.setProperty('text-shadow',
                `0 0 4px rgba(0,0,0,0.82), 0 1px 4px rgba(0,0,0,0.9), `
                + `0 0 20px rgba(255,255,255,0.6), 0 0 30px ${song.color}aa`,
                'important');
            return;
        }

        // Hover lifts a label partway out of the haze toward the foreground.
        const h = p.isHovered ? haze * 0.35 : haze;
        const bucket = Math.round(h * 10);
        const key = `${atmStyle}|${bucket}`;
        if (p.labelData._styleKey === key) return;
        p.labelData._styleKey = key;

        const tint = Math.round(h * 42);          // % blended toward atmosphere
        const darkA = (0.9 * (1 - h * 0.72)).toFixed(2);
        const darkB = (0.95 * (1 - h * 0.72)).toFixed(2);
        const atmGlow = (10 + h * 16).toFixed(0);  // haze halo grows with distance
        titleEl.style.color = `color-mix(in srgb, ${atmStyle} ${tint}%, #ffffff)`;
        titleEl.style.setProperty('text-shadow',
            `0 0 4px rgba(0,0,0,${darkA}), 0 1px 3px rgba(0,0,0,${darkB}), `
            + `0 0 14px ${song.color}99, 0 0 ${atmGlow}px ${atmStyle}`,
            '');
        titleEl.style.filter = h > 0.04 ? `blur(${(h * 0.9).toFixed(2)}px)` : '';
    }

    destroy() {
        cancelAnimationFrame(this.animationId);
        window.removeEventListener('resize', this.boundOnWindowResize);
        window.removeEventListener('keydown', this.boundOnKeyDown);
        this.container.removeEventListener('click', this.boundOnClick);
        this.container.removeEventListener('mousemove', this.boundOnMouseMove);
        eventBus.off('songComplete', this.boundOnSongComplete);

        if (this.currentPhase) {
            this.currentPhase.dispose();
        }

        this.composer?.dispose?.();
        this.bloomPass?.dispose?.();
        this.renderer.dispose();
        // ハブ+6曲で最大7つのWebGLコンテキストが生成されうる。曲↔湖の往復を繰り返しても
        // ブラウザのコンテキスト上限に達しないよう、明示的に解放する。
        this.renderer.forceContextLoss?.();

        if (this.labelsContainer?.parentNode) {
            this.labelsContainer.parentNode.removeChild(this.labelsContainer);
        }
        if (this.selectionPanel?.parentNode) {
            this.selectionPanel.parentNode.removeChild(this.selectionPanel);
        }
        if (this.thumbCard?.parentNode) {
            this.thumbCard.parentNode.removeChild(this.thumbCard);
        }
        if (this._tapHintTimer) clearTimeout(this._tapHintTimer);
        if (this.tapHint?.parentNode) {
            this.tapHint.parentNode.removeChild(this.tapHint);
        }
        if (this._affordanceStyleEl?.parentNode) {
            this._affordanceStyleEl.parentNode.removeChild(this._affordanceStyleEl);
        }
        if (this._boundCloseBgMenu) document.removeEventListener('click', this._boundCloseBgMenu);
        if (this.bgSelectWrap?.parentNode) {
            this.bgSelectWrap.parentNode.removeChild(this.bgSelectWrap);
        }
        if (this._endingTimeout) clearTimeout(this._endingTimeout);
        if (this._endingRemoveTimeout) clearTimeout(this._endingRemoveTimeout);
        if (this.ending?.parentNode) {
            this.ending.parentNode.removeChild(this.ending);
        }
        if (this._secretRevealTimeout) clearTimeout(this._secretRevealTimeout);
        if (this._secretRevealHideTimeout) clearTimeout(this._secretRevealHideTimeout);
        if (this._secretToast?.parentNode) {
            this._secretToast.parentNode.removeChild(this._secretToast);
        }
    }
}
