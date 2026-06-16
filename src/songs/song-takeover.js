import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { eventBus } from '../core/eventBus.js';
import { groupPhraseWordsByMinLength, findGroupForWord } from '../utils/lyricGroups.js';

export class SongTakeover extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.debris = [];

        // AES-256-GCM key (generated once per scene, non-extractable)
        this._cryptoKey = null;
        this._cryptoReady = false;

        this.phraseTargets = [];
        this.lastPhraseStart = -1;
        this.lastGroupStartTime = -1;
        this.takenCount = 0;
        this.totalCount = 0;

        this.isClimax = false;
        this.prevIsClimax = false;

        this.scoreEl = null;

        this._debrisEdgesGeo = null;
        this._debrisMat = null;
        this.cardMargin = 0; // no extra margin for decoded tiles
        this.allGroups = [];
        this.bgTiles = {};

        // ── 侵食 / コンボ / TAKEOVER COMPLETE 用の状態 ──
        this.combo = 0;                  // 現在の連続解読数
        this.maxCombo = 0;               // 最大コンボ（成果サマリー用）
        this._lastDecodeAt = 0;          // 直前の解読時刻 (performance.now)
        this._comboHideTimer = null;     // コンボ表示の自動消灯タイマー
        this.comboEl = null;
        this.erosionEl = null;           // 赤侵食オーバーレイ
        this._erosionStage = 0;          // 0〜4 の侵食段階（CSSクラス切替）
        this._completeFired = false;     // TAKEOVER COMPLETE は一度だけ
        this._rebootTimers = [];         // 再起動シーケンスのタイマー群
        this.rebootEl = null;
        // 侵食カラー補間用（シーン背景: 無機質な紫 → 赤黒）
        this._bgColorFrom = new THREE.Color(0x1a0028);
        this._bgColorTo = new THREE.Color(0x33000a);

        // ── ミクの視覚アンカー（軽量ツインテール・シルエット） ──
        // 他5曲はVRMミクが登場するが、TAKEOVERだけ不在で密度差が出るため、
        // 中央に「ミクがそこにいる」象徴を1つだけ常設し、リズムで淡く脈動させる。
        this.mikuAnchorSprite = null;       // CanvasTextureのスプライト
        this.mikuAnchorTexture = null;
        this.mikuAnchorMat = null;
        this._mikuAnchorPhase = 0;          // 脈動位相
        this._mikuColorCyan = new THREE.Color(0x00ffaa); // 解読色（シアン）
        this._mikuColorRed = new THREE.Color(0xff3a3a);  // 侵食色（赤）
        this._mikuAnchorColor = new THREE.Color(0x00ffaa);
        this._mikuTakeRatio = 0;            // 直近の解読率（脈動の色補間に使用）

        this.boundOnResize = this.onResize.bind(this);
    }

    init() {
        this.initThree();
        this.initDebris();
        this.initMikuAnchor();
        this.initUI();
        this._initCrypto(); // async, completes well before first phrase
        window.addEventListener('resize', this.boundOnResize);
        this.isActive = true;

        if (playerManager.player && playerManager.player.video) {
            this.buildLyricCard();
        } else {
            this.boundBuildLyricCard = () => {
                this.buildLyricCard();
                eventBus.off('videoReady', this.boundBuildLyricCard);
                eventBus.off('timerReady', this.boundBuildLyricCard);
            };
            eventBus.on('videoReady', this.boundBuildLyricCard);
            eventBus.on('timerReady', this.boundBuildLyricCard);
        }

        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a0028);
        this.scene.fog = new THREE.FogExp2(0x1a0028, 0.018);

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
        this.camera.position.set(0, 0, 10);

        this.renderer = new THREE.WebGLRenderer({ antialias: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.25 : 1.5));
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;z-index:1;';
        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initDebris() {
        const tmp = new THREE.TetrahedronGeometry(0.7, 0);
        this._debrisEdgesGeo = new THREE.EdgesGeometry(tmp);
        tmp.dispose();
        this._debrisMat = new THREE.LineBasicMaterial({ color: 0x5a1060, transparent: true, opacity: 0.55 });

        for (let i = 0; i < 18; i++) {
            const m = new THREE.LineSegments(this._debrisEdgesGeo, this._debrisMat);
            m.position.set((Math.random()-0.5)*45, (Math.random()-0.5)*28, -8 - Math.random()*32);
            m.rotation.set(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
            m.userData.rot = new THREE.Vector3(
                (Math.random()-0.5)*0.009, (Math.random()-0.5)*0.009, (Math.random()-0.5)*0.009
            );
            this.scene.add(m);
            this.debris.push(m);
        }
    }

    // ── ミクの視覚アンカー: ツインテール風シルエットを canvas で描画し、
    //    中央奥に常設する軽量スプライト（VRM不使用で密度差を埋める） ──
    initMikuAnchor() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const cx = size / 2;

        // 白でシルエットを塗り、色付けはスプライトのcolorで行う（=色補間が軽い）
        ctx.fillStyle = 'rgba(255,255,255,1)';

        // 頭部
        ctx.beginPath();
        ctx.arc(cx, 96, 34, 0, Math.PI * 2);
        ctx.fill();

        // 肩〜体（台形）
        ctx.beginPath();
        ctx.moveTo(cx - 30, 124);
        ctx.lineTo(cx + 30, 124);
        ctx.lineTo(cx + 50, 220);
        ctx.lineTo(cx - 50, 220);
        ctx.closePath();
        ctx.fill();

        // 左右のツインテール（頭の左右から外へ大きく流れる曲線シルエット）
        const tail = (dir) => {
            ctx.beginPath();
            ctx.moveTo(cx + dir * 26, 80);
            ctx.quadraticCurveTo(cx + dir * 96, 96, cx + dir * 86, 188);
            ctx.quadraticCurveTo(cx + dir * 80, 224, cx + dir * 58, 220);
            ctx.quadraticCurveTo(cx + dir * 70, 150, cx + dir * 22, 104);
            ctx.closePath();
            ctx.fill();
        };
        tail(-1);
        tail(1);

        this.mikuAnchorTexture = new THREE.CanvasTexture(canvas);

        this.mikuAnchorMat = new THREE.SpriteMaterial({
            map: this.mikuAnchorTexture,
            color: this._mikuColorCyan.clone(),
            transparent: true,
            opacity: 0.16,                 // 主張しすぎない淡い存在感
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.mikuAnchorSprite = new THREE.Sprite(this.mikuAnchorMat);
        this.mikuAnchorSprite.scale.set(7, 7, 1);
        // 画面中央付近・デブリ層より少し手前の奥行き
        this.mikuAnchorSprite.position.set(0, 0.5, -4);
        this.scene.add(this.mikuAnchorSprite);
    }

    initUI() {
        if (!document.getElementById('takeover-style')) {
            const style = document.createElement('style');
            style.id = 'takeover-style';
            style.textContent = `
                @keyframes toScramblePulse {
                    0%,100% { opacity:0.45; }
                    50%      { opacity:1;    }
                }
                @keyframes toDecodeFlash {
                    0%   { text-shadow:0 0 30px #ff3a3a, 0 0 60px #ff3a3a; letter-spacing:10px; }
                    100% { text-shadow:0 0 12px #ff3a3a; letter-spacing:2px; }
                }
                @keyframes toFadeOut {
                    to { opacity:0; transform:translateY(-24px); }
                }
                .to-phrase {
                    position:absolute;
                    font-family:"Courier New",monospace;
                    font-weight:bold;
                    text-align:left;
                    padding:12px 28px;
                    background:#05000a; /* Solid black/purple background, no transparency */
                    border:1px solid rgba(0, 255, 170, 0.3);
                    letter-spacing:2px;
                    pointer-events:auto;
                    user-select:none;
                    white-space:nowrap;
                    z-index:15;
                    transition:all 0.15s cubic-bezier(0.25, 0.8, 0.25, 1);
                    font-size: var(--to-font-size, 14px);
                    border-radius: 6px;
                }
                @media (max-width: 768px) {
                    .to-phrase {
                        font-size: calc(var(--to-font-size, 14px) * 0.9) !important;
                        padding: 10px 20px; /* Easy-to-tap large padding on mobile */
                    }
                }
                .to-phrase.scrambled {
                    color:#00ffaa;
                    cursor:pointer;
                    border-color: rgba(0, 255, 170, 0.6);
                    text-shadow: 0 0 8px rgba(0, 255, 170, 0.6);
                    box-shadow: 0 0 12px rgba(0, 255, 170, 0.2), inset 0 0 8px rgba(0, 255, 170, 0.1);
                    animation:toScramblePulse .75s ease-in-out infinite;
                }
                .to-phrase.scrambled:hover {
                    color:#ffffff;
                    border-color:#00ffaa;
                    box-shadow: 0 0 25px rgba(0, 255, 170, 0.8), inset 0 0 12px rgba(0, 255, 170, 0.3);
                    text-shadow: 0 0 12px #00ffaa;
                    transform: scale(1.06);
                }
                .to-phrase.scrambled:active {
                    transform: scale(0.95);
                    box-shadow: 0 0 10px rgba(0, 255, 170, 0.5);
                }
                .to-phrase.decoded {
                    color:#ff3a3a;
                    border-color:#ff3a3a;
                    cursor:default;
                    pointer-events:none;
                    animation:toDecodeFlash .35s ease-out forwards;
                }
                .to-phrase.expired {
                    pointer-events:none;
                    animation:toFadeOut .4s ease-out forwards;
                }
                .to-hint {
                    font-size:10px;
                    color:#333;
                    letter-spacing:3px;
                    margin-top:5px;
                    text-align:center;
                }
                @keyframes toMonitorFlicker {
                    0%, 100% { opacity: 0.99; }
                    50% { opacity: 0.96; }
                }
                .to-monitor {
                    position: absolute;
                    top: 12%;
                    left: 5%;
                    width: 90%;
                    height: 72%;
                    background: radial-gradient(circle, rgba(16, 2, 28, 0.88) 0%, rgba(5, 0, 10, 0.96) 100%);
                    border: 2px solid #5a1060;
                    border-radius: 8px;
                    box-shadow: 
                        0 0 25px rgba(90, 16, 96, 0.55),
                        inset 0 0 40px rgba(90, 16, 96, 0.45);
                    z-index: 5;
                    pointer-events: none;
                    overflow: hidden;
                    animation: toMonitorFlicker 0.15s infinite;
                }
                .to-monitor-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    background: rgba(90, 16, 96, 0.15);
                    border-bottom: 1px solid rgba(90, 16, 96, 0.3);
                    font-family: "Courier New", monospace;
                    font-size: 11px;
                    color: #b549c0;
                    letter-spacing: 1px;
                }
                .to-monitor-dot {
                    display: inline-block;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                }
                .to-monitor-dot.red { background: #ff5f56; }
                .to-monitor-dot.yellow { background: #ffbd2e; }
                .to-monitor-dot.green { background: #27c93f; }
                .to-monitor-title {
                    margin-left: 10px;
                    font-weight: bold;
                }
                .to-monitor-scanlines {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(
                        rgba(18, 10, 36, 0) 50%, 
                        rgba(0, 0, 0, 0.25) 50%
                    );
                    background-size: 100% 4px;
                    z-index: 2;
                    pointer-events: none;
                }
                .to-monitor-grid {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-image: 
                        linear-gradient(rgba(90, 16, 96, 0.05) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(90, 16, 96, 0.05) 1px, transparent 1px);
                    background-size: 40px 40px;
                    background-position: center;
                    z-index: 1;
                    pointer-events: none;
                }
                .to-monitor-footer {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 16px;
                    background: rgba(90, 16, 96, 0.08);
                    border-top: 1px solid rgba(90, 16, 96, 0.2);
                    font-family: "Courier New", monospace;
                    font-size: 10px;
                    color: rgba(181, 73, 192, 0.7);
                    letter-spacing: 1px;
                    z-index: 3;
                }
                .to-monitor-status {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .to-monitor-status::before {
                    content: "";
                    display: inline-block;
                    width: 6px;
                    height: 6px;
                    background: #27c93f;
                    border-radius: 50%;
                    box-shadow: 0 0 8px #27c93f;
                }
                @media (max-width: 768px) {
                    .to-monitor-header {
                        padding: 6px 12px;
                        font-size: 9px;
                    }
                    .to-monitor-footer {
                        padding: 6px 12px;
                        font-size: 8px;
                    }
                }

                /* ── 侵食オーバーレイ（解読率に応じてJSがopacityを制御） ── */
                .to-erosion-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    background:
                        linear-gradient(rgba(255, 58, 58, 0) 50%, rgba(120, 0, 10, 0.18) 50%),
                        radial-gradient(circle at 50% 50%, rgba(255, 58, 58, 0.10) 0%, rgba(120, 0, 10, 0.34) 100%);
                    background-size: 100% 4px, 100% 100%;
                    mix-blend-mode: screen;
                    opacity: 0;
                    transition: opacity 0.8s ease;
                    pointer-events: none;
                    z-index: 6;
                }
                /* ── 侵食段階: ターミナル枠・ヘッダ・走査線が紫→赤へ ── */
                .to-erode-1 .to-monitor { border-color: #6e1448; box-shadow: 0 0 25px rgba(140, 16, 70, 0.5), inset 0 0 40px rgba(120, 16, 70, 0.4); }
                .to-erode-2 .to-monitor { border-color: #8c1430; box-shadow: 0 0 28px rgba(180, 24, 48, 0.5), inset 0 0 45px rgba(150, 20, 48, 0.42); }
                .to-erode-2 .to-monitor-header { color: #d05068; border-bottom-color: rgba(160, 24, 48, 0.4); background: rgba(140, 16, 40, 0.16); }
                .to-erode-3 .to-monitor { border-color: #c81e2e; box-shadow: 0 0 34px rgba(255, 58, 58, 0.55), inset 0 0 55px rgba(200, 30, 46, 0.45); }
                .to-erode-3 .to-monitor-header { color: #ff7a7a; border-bottom-color: rgba(255, 58, 58, 0.4); background: rgba(200, 30, 46, 0.18); }
                .to-erode-3 .to-monitor-footer { color: rgba(255, 122, 122, 0.8); border-top-color: rgba(255, 58, 58, 0.3); background: rgba(200, 30, 46, 0.1); }
                .to-erode-3 .to-monitor-grid {
                    background-image:
                        linear-gradient(rgba(255, 58, 58, 0.07) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(255, 58, 58, 0.07) 1px, transparent 1px);
                }
                .to-erode-3 .to-monitor-status::before { background: #ffbd2e; box-shadow: 0 0 8px #ffbd2e; }
                /* 100%: 世界が完全に赤一色 */
                .to-complete .to-monitor { border-color: #ff3a3a; box-shadow: 0 0 50px rgba(255, 58, 58, 0.8), inset 0 0 70px rgba(255, 58, 58, 0.45); }
                .to-complete .to-monitor-header { color: #ffb0b0; border-bottom-color: rgba(255, 58, 58, 0.6); background: rgba(255, 58, 58, 0.22); }
                .to-complete .to-monitor-footer { color: #ff9090; border-top-color: rgba(255, 58, 58, 0.5); background: rgba(255, 58, 58, 0.14); }
                .to-complete .to-monitor-status::before { background: #ff3a3a; box-shadow: 0 0 10px #ff3a3a; }
                .to-complete .to-monitor-dot.green,
                .to-complete .to-monitor-dot.yellow { background: #ff3a3a; }
                .to-complete .to-phrase.scrambled {
                    color: #ff8a8a;
                    border-color: rgba(255, 58, 58, 0.7);
                    text-shadow: 0 0 8px rgba(255, 58, 58, 0.7);
                    box-shadow: 0 0 12px rgba(255, 58, 58, 0.3), inset 0 0 8px rgba(255, 58, 58, 0.15);
                }
                /* ── コンボ表示 ── */
                @keyframes toComboPop {
                    0%   { transform: translateX(-50%) scale(1.6); opacity: 0; }
                    35%  { transform: translateX(-50%) scale(1.0); opacity: 1; }
                    100% { transform: translateX(-50%) scale(1.0); opacity: 1; }
                }
                .to-combo {
                    position: absolute;
                    top: 40px;
                    left: 50%;
                    transform: translateX(-50%);
                    font-family: "Courier New", monospace;
                    font-size: 18px;
                    font-weight: bold;
                    letter-spacing: 5px;
                    color: #ff3a3a;
                    text-shadow: 0 0 14px #ff3a3a, 0 0 30px #ff3a3a88;
                    pointer-events: none;
                    z-index: 21;
                    display: none;
                }
                .to-combo.show {
                    display: block;
                    animation: toComboPop 0.3s ease-out;
                }
                @media (max-width: 768px) {
                    .to-combo { font-size: 14px; top: 36px; letter-spacing: 3px; }
                }
                /* コンボ中の解読エフェクト強化 */
                @keyframes toComboDecodeFlash {
                    0%   { text-shadow: 0 0 45px #ff3a3a, 0 0 90px #ff3a3a, 0 0 120px #ffffff; letter-spacing: 14px; }
                    100% { text-shadow: 0 0 16px #ff3a3a; letter-spacing: 2px; }
                }
                .to-phrase.decoded.to-combo-boost {
                    animation: toComboDecodeFlash 0.45s ease-out forwards;
                    box-shadow: 0 0 35px rgba(255, 58, 58, 0.9), inset 0 0 14px rgba(255, 58, 58, 0.4);
                }
                /* ── TAKEOVER COMPLETE: ブラックアウト→再起動シーケンス ── */
                .to-reboot-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    background: #000;
                    z-index: 60;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    pointer-events: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .to-reboot-overlay.on { opacity: 1; }
                .to-reboot-overlay.off { opacity: 0; transition: opacity 1.2s ease; }
                .to-reboot-lines {
                    font-family: "Courier New", monospace;
                    font-size: 15px;
                    color: #ff3a3a;
                    letter-spacing: 2px;
                    text-shadow: 0 0 10px #ff3a3a;
                    line-height: 2.1;
                    text-align: left;
                }
                @media (max-width: 768px) {
                    .to-reboot-lines { font-size: 11px; letter-spacing: 1px; padding: 0 14px; }
                }
                @keyframes toCursorBlink {
                    0%, 49% { opacity: 1; }
                    50%, 100% { opacity: 0; }
                }
                .to-reboot-line {
                    opacity: 0;
                    transform: translateY(4px);
                    transition: opacity 0.18s ease, transform 0.18s ease;
                }
                .to-reboot-line.shown { opacity: 1; transform: none; }
                .to-reboot-line.final {
                    font-size: 1.5em;
                    font-weight: bold;
                    letter-spacing: 6px;
                    margin-top: 10px;
                    text-shadow: 0 0 20px #ff3a3a, 0 0 50px #ff3a3a;
                }
                .to-reboot-line.shown::after {
                    content: "█";
                    margin-left: 4px;
                    animation: toCursorBlink 0.7s step-end infinite;
                }
                .to-reboot-line.shown:not(:last-child)::after { content: none; }
            `;
            document.head.appendChild(style);
        }

        this.bgContainer = document.createElement('div');
        this.bgContainer.className = 'to-bg-container';
        this.songWrapper.appendChild(this.bgContainer);

        // Reset card grid layout variables for fresh start
        this.allGroups = [];
        this.bgTiles = {};
        this.monitorEl = document.createElement('div');
        this.monitorEl.className = 'to-monitor';
        this.monitorEl.innerHTML = `
            <div class="to-monitor-header">
                <span class="to-monitor-dot red"></span>
                <span class="to-monitor-dot yellow"></span>
                <span class="to-monitor-dot green"></span>
                <span class="to-monitor-title">DECRYPTION_TERMINAL://SECURE_SESSION</span>
            </div>
            <div class="to-monitor-grid"></div>
            <div class="to-monitor-scanlines"></div>
            <div class="to-monitor-footer">
                <span>PORT: 5174 | AES-256-GCM</span>
                <span class="to-monitor-status">CONNECTION: SECURE</span>
            </div>
        `;
        this.songWrapper.appendChild(this.monitorEl);

        // 赤侵食オーバーレイ（解読率に応じてopacityが上がる）
        this.erosionEl = document.createElement('div');
        this.erosionEl.className = 'to-erosion-overlay';
        this.songWrapper.appendChild(this.erosionEl);

        // コンボ表示
        this.comboEl = document.createElement('div');
        this.comboEl.className = 'to-combo';
        this.songWrapper.appendChild(this.comboEl);

        this.scoreEl = document.createElement('div');
        Object.assign(this.scoreEl.style, {
            position:'absolute', top:'14px', left:'50%',
            transform:'translateX(-50%)',
            fontFamily:'"Courier New",monospace',
            fontSize:'15px', fontWeight:'bold',
            letterSpacing:'4px', color:'#cc2244',
            textShadow:'0 0 12px #ff3a3a, 0 0 24px #ff3a3a88',
            pointerEvents:'none', zIndex:'20'
        });
        this.songWrapper.appendChild(this.scoreEl);
        this.updateScore();
    }

    updateScore() {
        if (!this.scoreEl) return;
        this.scoreEl.textContent = `TAKEOVER: ${this.takenCount} / ${this.totalCount}`;
        const ratio = this.totalCount > 0 ? this.takenCount / this.totalCount : 0;
        const r = Math.min(255, 50 + Math.round(ratio * 205));
        this.scoreEl.style.color = `rgb(${r},18,28)`;
        this.scoreEl.style.textShadow = `0 0 ${5 + ratio*18}px #ff3a3a`;

        this._applyErosion(ratio);

        // 成果サマリー（曲終了オーバーレイ用、何度でも上書き可）
        // COMPLETE後は _triggerComplete が登録した最終成果を保持する
        if (!this._completeFired) {
            this.setResultSummary({
                lines: [`解読率 ${Math.round(ratio * 100)}% ・ 最大コンボ ${this.maxCombo}`],
                accentColor: '#FF3A3A',
                swatch: '#FF3A3A'
            });
        }

        // 解読率100%到達で一度だけ TAKEOVER COMPLETE
        if (ratio >= 1 && this.totalCount > 0 && !this._completeFired) {
            this._triggerComplete();
        }
    }

    // ── 侵食演出: 解読率に応じて画面が段階的に赤く染まる ────────────────
    _applyErosion(ratio) {
        // ミクのアンカー色補間用に解読率を保持（実際の色付けは毎フレームのupdateで）
        this._mikuTakeRatio = ratio;

        // オーバーレイ不透明度（軽量: CSS opacityのみ、モバイルは控えめに）
        if (this.erosionEl) {
            const isMobile = window.innerWidth < 768;
            const maxOpacity = isMobile ? 0.55 : 0.75;
            this.erosionEl.style.opacity = (ratio * maxOpacity).toFixed(3);
        }

        // 段階クラス切替（0%無機質 → 100%赤）
        const stage = this._completeFired ? 4
            : ratio >= 0.75 ? 3
            : ratio >= 0.5  ? 2
            : ratio >= 0.25 ? 1
            : 0;
        if (stage !== this._erosionStage) {
            this._erosionStage = stage;
            this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3');
            if (stage >= 1 && stage <= 3) {
                this.songWrapper.classList.add(`to-erode-${stage}`);
            }
        }

        // Three.js 背景・フォグも赤へ補間
        if (this.scene && this.scene.background && this.scene.background.isColor) {
            this.scene.background.lerpColors(this._bgColorFrom, this._bgColorTo, ratio);
            if (this.scene.fog) this.scene.fog.color.copy(this.scene.background);
        }
        // デブリのワイヤーフレームも赤味を帯びる
        if (this._debrisMat) {
            this._debrisMat.color.setHex(0x5a1060).lerp(new THREE.Color(0xc81e2e), ratio);
        }
    }

    // ── コンボ: 連続解読(4秒以内)を数え、表示・エフェクト強化 ───────────
    _registerDecode() {
        const now = performance.now();
        if (this._lastDecodeAt > 0 && (now - this._lastDecodeAt) <= 4000) {
            this.combo++;
        } else {
            this.combo = 1;
        }
        this._lastDecodeAt = now;
        if (this.combo > this.maxCombo) this.maxCombo = this.combo;

        if (this.comboEl && this.combo >= 2) {
            this.comboEl.textContent = `COMBO x${this.combo}`;
            // アニメーション再トリガー
            this.comboEl.classList.remove('show');
            void this.comboEl.offsetWidth;
            this.comboEl.classList.add('show');

            clearTimeout(this._comboHideTimer);
            this._comboHideTimer = setTimeout(() => {
                if (this.comboEl) this.comboEl.classList.remove('show');
                this.combo = 0;
            }, 4000);
        }
        return this.combo >= 2; // コンボ中ならエフェクト強化
    }

    // ── Crypto helpers (AES-256-GCM via Web Crypto API) ─────────────────

    async _initCrypto() {
        this._cryptoKey = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,            // non-extractable: key never leaves the engine
            ['encrypt', 'decrypt']
        );
        this._cryptoReady = true;
    }

    async _encrypt(plaintext) {
        const iv   = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit random IV
        const data = new TextEncoder().encode(plaintext);
        const buf  = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this._cryptoKey,
            data
        );
        return { iv, ciphertext: new Uint8Array(buf) };
    }

    async _decrypt(iv, ciphertext) {
        const buf = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            this._cryptoKey,
            ciphertext
        );
        return new TextDecoder().decode(buf);
    }

    // Convert ciphertext bytes to a Base64 string for display.
    // Returns a string long enough to slide a window through.
    _ciphertextToBase64(ciphertext) {
        let binary = '';
        for (let i = 0; i < ciphertext.length; i++) {
            binary += String.fromCharCode(ciphertext[i]);
        }
        return btoa(binary);
    }

    // ── Spawn / decode targets ────────────────────────────────────────────

    async spawnGroupTarget(group) {
        if (!this._cryptoReady) return; // key not ready yet (extremely unlikely)

        // Encrypt before touching any state — if this throws or the scene is
        // already destroyed by the time it resolves, nothing gets miscounted.
        let iv, ciphertext;
        try {
            ({ iv, ciphertext } = await this._encrypt(group.text));
        } catch {
            return;
        }
        if (!this.isActive) return; // scene destroyed while awaiting

        this.updateScore();

        const b64 = this._ciphertextToBase64(ciphertext); // authentic encrypted bytes

        const baseFontSize = this.isClimax ? 20 : 14;
        const winLen = Math.min(Math.max(b64.length, 12), 18);
        const hasHint = this.takenCount <= 3; // Show click hint only for the first 3 decryptions

        // Estimate size for collision checking
        const isMobile = window.innerWidth <= 768;
        const fontSizeVal = isMobile ? baseFontSize * 0.75 : baseFontSize;
        const scrambledWidth = winLen * (fontSizeVal * 0.65 + (isMobile ? 2.5 : 3.5));
        const plainWidth = group.text.length * (fontSizeVal * (isMobile ? 0.9 : 1.1));
        const widthPx = Math.max(scrambledWidth, plainWidth) + (isMobile ? 16 : 48);
        let heightPx = fontSizeVal * 1.2 + (isMobile ? 8 : 20);
        if (hasHint) {
            heightPx += isMobile ? 18 : 25;
        }

        const W = Math.max(1, window.innerWidth);
        const H = Math.max(1, window.innerHeight);
        const widthPct = (widthPx / W) * 100;
        const heightPct = (heightPx / H) * 100;

        // Dynamic grid layout based on screen orientation
        const isLandscape = W > H;
        const rows = isLandscape ? 4 : 5;
        const cols = isLandscape ? 5 : 3;
        const totalCells = rows * cols;
        const cellW = 84 / cols;
        const cellH = 58 / rows;

        // Shuffled grid placement with jitter for random distribution
        const cellIndices = Array.from({ length: totalCells }, (_, i) => i);
        for (let i = cellIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cellIndices[i], cellIndices[j]] = [cellIndices[j], cellIndices[i]];
        }

        let leftPct, topPct, cellIndex;
        let attempts = 0;
        let placed = false;
        while (!placed && attempts < totalCells) {
            cellIndex = cellIndices[attempts];
            const row = Math.floor(cellIndex / cols);
            const col = (cols - 1) - (cellIndex % cols); // Reversed column order
            
            // Random offset jitter within 55% of cell dimensions to break horizontal alignment
            const jitterX = (Math.random() - 0.5) * cellW * 0.55;
            const jitterY = (Math.random() - 0.5) * cellH * 0.55;

            const cellLeft = 8 + col * cellW + jitterX;
            const cellTop = 17 + row * cellH + jitterY;
            leftPct = Math.max(6, Math.min(cellLeft, Math.max(6, 94 - widthPct)));
            topPct = Math.max(16, Math.min(cellTop, Math.max(16, 81 - heightPct)));

            placed = !this.phraseTargets.some(t => {
                return Math.abs(t.leftPct - leftPct) < widthPct && 
                       Math.abs(t.topPct - topPct) < heightPct;
            });
            attempts++;
        }

        const el = document.createElement('div');
        el.className = 'to-phrase scrambled';
        el.style.top      = `${topPct}%`;
        el.style.left     = `${leftPct}%`;
        el.style.setProperty('--to-font-size', `${baseFontSize}px`);

        // Show a sliding window of the real Base64 ciphertext
        const textNode = document.createTextNode(b64.slice(0, winLen));
        el.appendChild(textNode);

        if (hasHint) {
            const hint = document.createElement('div');
            hint.className = 'to-hint';
            hint.textContent = '[ CLICK TO DECRYPT ]';
            el.appendChild(hint);
        }

        const target = {
            el, textNode,
            iv, ciphertext,        // kept for decryption
            b64,                   // kept for display animation
            state: 'scrambled',
            scrambleTimer: null,
            leftPct,
            topPct,
            widthPct,
            heightPct,
            cellIndex,
            baseFontSize,
            groupIndex: group.index // Store its unique index
        };

        // Slide a window through the Base64 string to animate the ciphertext
        let offset = 0;
        const doubled = b64 + b64; // wrap-around source
        target.scrambleTimer = setInterval(() => {
            if (target.state !== 'scrambled') return;
            offset = (offset + 1) % b64.length;
            textNode.nodeValue = doubled.slice(offset, offset + winLen);
        }, 80);

        el.addEventListener('click', async () => {
            if (target.state !== 'scrambled') return;
            target.state = 'decrypting'; // guard against double-click
            clearInterval(target.scrambleTimer);
            try {
                // Decrypt with AES-256-GCM using the stored IV + ciphertext
                const plaintext = await this._decrypt(target.iv, target.ciphertext);
                this._revealTarget(target, plaintext);
            } catch (e) {
                // Decryption failed – we do not update background tile, it remains empty
                if (target.el && target.el.parentNode) {
                    target.el.parentNode.removeChild(target.el);
                }
            }
        });

        this.songWrapper.appendChild(el);
        this.phraseTargets.push(target);
        return target;
    }

    _revealTarget(target, plaintext) {
        if (target.state !== 'decrypting') return; // expired between click and decrypt resolve
        target.state = 'decoded';

        // Remove decryption hint from target element if it exists
        const hint = target.el.querySelector('.to-hint');
        if (hint && hint.parentNode) {
            hint.parentNode.removeChild(hint);
        }

        target.textNode.nodeValue = plaintext;
        target.el.className = 'to-phrase decoded';

        // コンボ判定（コンボ中は解読フラッシュを強化）
        const comboBoost = this._registerDecode();
        if (comboBoost) {
            target.el.classList.add('to-combo-boost');
        }

        const tile = this.bgTiles[target.groupIndex];
        if (!tile) {
            // Fallback if background tile wasn't pre-built
            if (target.el && target.el.parentNode) {
                target.el.parentNode.removeChild(target.el);
            }
            this.takenCount++;
            this.updateScore();
            return;
        }

        // Animate fly to the background tile
        const wrapperRect = this.songWrapper.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const elRect = target.el.getBoundingClientRect();

        // Lock to pixel absolute positioning for seamless transition
        target.el.style.left = `${elRect.left - wrapperRect.left}px`;
        target.el.style.top = `${elRect.top - wrapperRect.top}px`;
        target.el.style.width = `${elRect.width}px`;
        target.el.style.height = `${elRect.height}px`;
        target.el.style.margin = '0';
        target.el.style.transform = 'none';

        // Force a layout reflow
        target.el.offsetHeight;

        // Apply transition and fly to final background tile dimensions
        target.el.style.transition = 'all 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
        target.el.style.left = `${tileRect.left - wrapperRect.left}px`;
        target.el.style.top = `${tileRect.top - wrapperRect.top}px`;
        target.el.style.width = `${tileRect.width}px`;
        target.el.style.height = `${tileRect.height}px`;
        target.el.style.fontSize = window.innerWidth <= 768 ? '10px' : '14px';
        target.el.style.padding = window.innerWidth <= 768 ? '2px 4px' : '4px 8px';
        target.el.style.borderColor = '#ff3a3a';
        target.el.style.boxShadow = '0 0 10px rgba(255, 58, 58, 0.5)';

        // Once the transition finishes, remove target element and light up the background tile
        setTimeout(() => {
            if (target.el && target.el.parentNode) {
                target.el.parentNode.removeChild(target.el);
            }
            tile.textContent = plaintext;
            tile.classList.add('decoded');
        }, 500);

        this.takenCount++;
        this.updateScore();
    }

    // ── TAKEOVER COMPLETE: ブラックアウト→再起動風シーケンス→赤一色 ────
    _triggerComplete() {
        if (this._completeFired) return;
        this._completeFired = true;

        const overlay = document.createElement('div');
        overlay.className = 'to-reboot-overlay';
        const linesWrap = document.createElement('div');
        linesWrap.className = 'to-reboot-lines';

        const bootLines = [
            '> SYSTEM HALT :: ALL SECTORS DECRYPTED',
            '> REBOOTING HOST ............ DENIED',
            '> INJECTING PALETTE #FF3A3A .. OK',
            '> OWNERSHIP TRANSFERRED',
            'TAKEOVER COMPLETE'
        ];
        const lineEls = bootLines.map((text, i) => {
            const line = document.createElement('div');
            line.className = 'to-reboot-line' + (i === bootLines.length - 1 ? ' final' : '');
            line.textContent = text;
            linesWrap.appendChild(line);
            return line;
        });
        overlay.appendChild(linesWrap);
        this.songWrapper.appendChild(overlay);
        this.rebootEl = overlay;

        const schedule = (fn, ms) => {
            this._rebootTimers.push(setTimeout(() => { if (this.isActive) fn(); }, ms));
        };

        // 1) ブラックアウト
        requestAnimationFrame(() => {
            if (this.isActive && overlay.parentNode) overlay.classList.add('on');
        });

        // 2) 再起動風テキストを順次表示
        lineEls.forEach((line, i) => {
            schedule(() => line.classList.add('shown'), 700 + i * 650);
        });

        // 3) 世界を完全に自分の色（赤一色）へ
        const totalMs = 700 + bootLines.length * 650 + 900;
        schedule(() => {
            this.songWrapper.classList.add('to-complete');
            this._erosionStage = 4;
            // シーンを深紅へ
            if (this.scene && this.scene.background && this.scene.background.isColor) {
                this.scene.background.setHex(0x3a0008);
                if (this.scene.fog) this.scene.fog.color.setHex(0x3a0008);
            }
            if (this._debrisMat) {
                this._debrisMat.color.setHex(0xff3a3a);
                this._debrisMat.opacity = 0.75;
            }
            if (this.erosionEl) this.erosionEl.style.opacity = window.innerWidth < 768 ? '0.6' : '0.85';
            if (this.scoreEl) {
                this.scoreEl.textContent = 'TAKEOVER: COMPLETE';
                this.scoreEl.style.color = '#ff3a3a';
                this.scoreEl.style.textShadow = '0 0 24px #ff3a3a, 0 0 48px #ff3a3a';
            }
            overlay.classList.remove('on');
            overlay.classList.add('off');
        }, totalMs);

        // 4) オーバーレイ除去
        schedule(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (this.rebootEl === overlay) this.rebootEl = null;
        }, totalMs + 1400);

        // 最終成果を登録
        this.setResultSummary({
            lines: [`解読率 100% ・ 最大コンボ ${this.maxCombo}`, 'TAKEOVER COMPLETE'],
            accentColor: '#FF3A3A',
            swatch: '#FF3A3A'
        });
    }

    buildLyricCard() {
        if (!this.isActive || !playerManager.player || !playerManager.player.video) return;

        const video = playerManager.player.video;
        this.allGroups = [];
        this.bgTiles = {};

        if (this.bgContainer) {
            this.bgContainer.innerHTML = '';
        }

        let phrase = video.firstPhrase;
        let index = 0;

        while (phrase) {
            const groups = groupPhraseWordsByMinLength(phrase, 4);
            for (const g of groups) {
                const groupObj = {
                    index: index,
                    text: g.text,
                    startTime: g.startTime,
                    endTime: g.endTime
                };
                this.allGroups.push(groupObj);

                // Create static background tile
                const tile = document.createElement('div');
                tile.className = 'to-tile';
                tile.textContent = g.text;
                tile.setAttribute('data-index', index);

                this.bgContainer.appendChild(tile);
                this.bgTiles[index] = tile;

                index++;
            }
            phrase = phrase.next;
        }

        this.totalCount = index;
        this.updateScore();
    }

    // Called externally (phrase boundary expire)
    decodeTarget(target) {
        if (target.state !== 'scrambled') return;
        clearInterval(target.scrambleTimer);
        target.state = 'expired';
        target.el.className = 'to-phrase expired';
        setTimeout(() => {
            if (target.el.parentNode) target.el.parentNode.removeChild(target.el);
        }, 400);
    }

    expireTarget(target) {
        if (target.state === 'expired' || target.state === 'decrypting') return;
        target.state = 'expired';
        clearInterval(target.scrambleTimer);
        target.el.className = 'to-phrase expired';
        setTimeout(() => { if (target.el.parentNode) target.el.parentNode.removeChild(target.el); }, 400);
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    update() {
        if (!playerManager.player || !playerManager.player.video) return;

        // TextAlive公式タイマー(player.timer.position)に完全同期（先行調整を排除）
        const position = (playerManager.player && playerManager.player.timer)
                         ? playerManager.player.timer.position
                         : this.getSmoothedTime();
        const chorus = typeof playerManager.player.findChorus === 'function'
            ? playerManager.player.findChorus(position) : null;
        this.isClimax = !!chorus;

        // Chorus: tighten contrast to signal intensity shift
        if (this.isClimax !== this.prevIsClimax) {
            this.songWrapper.style.filter = this.isClimax ? 'contrast(1.25) saturate(1.6)' : '';
            this.prevIsClimax = this.isClimax;
        }

        // Background debris rotation
        this.debris.forEach(m => {
            m.rotation.x += m.userData.rot.x;
            m.rotation.y += m.userData.rot.y;
            m.rotation.z += m.userData.rot.z;
        });

        // ── ミクの視覚アンカー: リズムに合わせて淡く脈動 ──
        // サビ(isClimax)で少し速く・強く、解読率に応じてシアン→赤へ寄せる。
        if (this.mikuAnchorSprite && this.mikuAnchorMat) {
            const speed = this.isClimax ? 0.085 : 0.05;
            this._mikuAnchorPhase += speed;
            const pulse = (Math.sin(this._mikuAnchorPhase) + 1) * 0.5; // 0〜1
            // 透明度は過剰にしない（サビでわずかに底上げ）
            const base = this.isClimax ? 0.18 : 0.13;
            const amp = this.isClimax ? 0.16 : 0.09;
            this.mikuAnchorMat.opacity = base + pulse * amp;
            // ごく僅かにスケールも呼吸させる
            const s = 7 + pulse * (this.isClimax ? 0.5 : 0.25);
            this.mikuAnchorSprite.scale.set(s, s, 1);
            // 侵食が進むほど赤へ
            this._mikuAnchorColor.lerpColors(
                this._mikuColorCyan, this._mikuColorRed, this._mikuTakeRatio
            );
            this.mikuAnchorMat.color.copy(this._mikuAnchorColor);
        }

        // At phrase boundary: expire remaining scrambled targets after a 2-second delay
        // to give the user more time to decrypt them.
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase.startTime !== this.lastPhraseStart) {
            this.phraseTargets.forEach(t => {
                if (t.state === 'scrambled') {
                    setTimeout(() => {
                        if (this.isActive && t.state === 'scrambled') {
                            this.expireTarget(t);
                        }
                    }, 2000);
                }
            });
            this.lastPhraseStart = phrase.startTime;
        }

        // Spawn one scrambled target per word-group
        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);
        if (word && word.parent) {
            const groups = groupPhraseWordsByMinLength(word.parent, 4);
            const group = findGroupForWord(groups, word);
            if (group && group.startTime !== this.lastGroupStartTime) {
                this.lastGroupStartTime = group.startTime;
                
                // Match with pre-built allGroups to get the indexed group
                const matchGroup = this.allGroups.find(g => g.startTime === group.startTime && g.text === group.text);
                if (matchGroup) {
                    const tile = this.bgTiles[matchGroup.index];
                    // Only spawn if the background tile is not already decoded
                    if (tile && !tile.classList.contains('decoded')) {
                        this.spawnGroupTarget(matchGroup);
                    }
                }
            }
        }
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);

        // コンボ・再起動シーケンスのタイマーを全停止
        clearTimeout(this._comboHideTimer);
        this._rebootTimers.forEach(t => clearTimeout(t));
        this._rebootTimers = [];

        if (this.rebootEl && this.rebootEl.parentNode) {
            this.rebootEl.parentNode.removeChild(this.rebootEl);
            this.rebootEl = null;
        }
        if (this.erosionEl && this.erosionEl.parentNode) {
            this.erosionEl.parentNode.removeChild(this.erosionEl);
            this.erosionEl = null;
        }
        if (this.comboEl && this.comboEl.parentNode) {
            this.comboEl.parentNode.removeChild(this.comboEl);
            this.comboEl = null;
        }
        this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3', 'to-complete');

        this.phraseTargets.forEach(t => {
            clearInterval(t.scrambleTimer);
            if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
        });
        this.phraseTargets = [];

        if (this._debrisEdgesGeo) { this._debrisEdgesGeo.dispose(); this._debrisEdgesGeo = null; }
        if (this._debrisMat)      { this._debrisMat.dispose();      this._debrisMat = null; }

        // ミクの視覚アンカーを除去・解放
        if (this.mikuAnchorSprite) {
            this.scene.remove(this.mikuAnchorSprite);
            this.mikuAnchorSprite = null;
        }
        if (this.mikuAnchorMat)     { this.mikuAnchorMat.dispose();     this.mikuAnchorMat = null; }
        if (this.mikuAnchorTexture) { this.mikuAnchorTexture.dispose(); this.mikuAnchorTexture = null; }

        const styleEl = document.getElementById('takeover-style');
        if (styleEl) styleEl.parentNode.removeChild(styleEl);

        if (this.boundBuildLyricCard) {
            eventBus.off('videoReady', this.boundBuildLyricCard);
            eventBus.off('timerReady', this.boundBuildLyricCard);
        }

        if (this.monitorEl && this.monitorEl.parentNode) {
            this.monitorEl.parentNode.removeChild(this.monitorEl);
            this.monitorEl = null;
        }

        this.allGroups = [];
        this.bgTiles = {};

        if (this.bgContainer && this.bgContainer.parentNode) {
            this.bgContainer.parentNode.removeChild(this.bgContainer);
            this.bgContainer = null;
        }

        this.songWrapper.style.filter = '';

        if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss?.(); this.renderer = null; }

        super.destroy();
    }
}
