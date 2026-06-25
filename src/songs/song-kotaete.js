import * as THREE from 'three';
import { sfx } from '../core/sfx.js';
import { quality } from '../core/quality.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { settleSpringBones } from '../utils/vrm.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { addRipple, getRipples } from '../lake/lakeMemory.js';
import { buildBrightLake, buildNightLake } from '../lake/kotaeteLakes.js';

/**
 * こたえて (imie / 初音ミク) — 「問いの回廊」
 *
 * 無限グリッドの回廊をミクが先導して飛行する。
 * - 歌詞スプライトをタップ/クリックすると「共鳴」し、光の粒がミクへ飛ぶ
 * - サビ区間に入るたび(最大3回)「問い」が届き、二択の答えを選ぶ
 * - 選んだ答えの色が世界(フォグ/グリッド/ライト)に混色されていく
 * - 画面端の「答えのパレット」に選択が層として積もり、
 *   3回終えると混色された「あなたの答えの色」が確定、ラストで世界を満たす
 */
export class SongKotaete extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        this.isMobile = window.innerWidth < 768;

        // ---- world / grid ----
        this.paths = [];
        this.gridMaterial = null;
        this.starField = null;
        this.keyLight = null;
        this.ambientLight = null;
        this.mikuLight = null;

        // ---- lyrics ----
        this.activeSprites = [];
        this.lastPhrase = null;

        // ---- VRM ----
        this.currentVRM = null;
        this.mikuGlowSprite = null;
        this.mikuLoaded = false;
        this.mikuFacingTarget = Math.PI;  // PI = 背中向き(進行方向) / 0 = カメラの方を向く
        this.mikuRotY = Math.PI;
        this.mikuDepth = 11;              // カメラからの奥行き(曲展開で前後に動かす)
        this._mikuRise = 0;               // サビでの上昇量(補間)
        this.reachBlend = 0;              // 0=脱力 1=手を差し伸べる
        this.reachBlendTarget = 0;
        this.mikuGlowPulse = 0;
        // 歌詞「手を振る/手を降る」のときだけ振り返って手を振る演出
        this.greetActive = false;
        this.greetElapsed = 0;
        this.greetWave = 0;               // 0..1 手を振る強さ
        this._lastGreetPhraseStart = -1;  // 同じフレーズで多重発火しないための記録
        this._lastFrameReal = performance.now();
        this._sceneStartReal = performance.now(); // シェーダー/アニメ用の相対時刻基準

        // ---- 共鳴 ----
        this.resonanceCount = 0;
        this.flyingParticles = [];
        this.raycaster = new THREE.Raycaster();
        this.pointerVec = new THREE.Vector2();

        // ---- 選択(問い) ----
        this.themeColor = '#7F77DD';
        this.choiceRounds = [
            {
                left:  { main: 'あなたの答え', sub: '心が先に動くほうへ', color: '#FF7A9E' },
                right: { main: '僕の答え',     sub: '歌の主人公と同じ道へ', color: '#5FC8FF' },
            },
            {
                left:  { main: 'あなたの答え', sub: '声に出して確かめる', color: '#FFD466' },
                right: { main: '僕の答え',     sub: '静かに抱きしめておく', color: '#7BEAC2' },
            },
            {
                left:  { main: 'あなたの答え', sub: '夜明けのほうへ進む', color: '#FF9E5E' },
                right: { main: '僕の答え',     sub: '宵の中で輝き続ける', color: '#8E7BFF' },
            },
        ];
        this.maxChoices = 3;
        this.choicesMade = 0;
        this.chosenColors = [];
        this.consumedChoruses = new Set();
        this.choiceActive = false;
        this.choiceContainer = null;
        this._choiceKeyHandler = null;
        this._choiceTimers = [];

        // ---- 二股分岐(決定木) ----
        // 回廊が二股に分かれ、進む世界を「画面の半分タップ」または矢印キーで直感的に選ぶ。
        // 選んだ世界のプリセット(色/フォグ/明るさ)が世界全体に流れ込み、世界観が変わる。
        // 決定木: 第1問=天/地 → 天なら第2問=昼/夜。地はそのまま地底へ。
        //   ['up','day']   → 晴天の湖
        //   ['up','night'] → 夜空の湖
        //   ['down', ...]  → 地底湖
        this.forkActive = false;
        this.fork = null;             // { pos:{...}, neg:{...}, axis }
        this.path = [];               // 通ってきた世界 ['up'|'down', 'day'|'night']
        this._forkConfig = null;
        this._forkKeyHandler = null;
        this._descentDeepened = false; // 地ルートの第2サビ「さらに地の底へ」を一度だけ発火
        this.camPitch = 0;            // カメラのピッチ(見上げ/見下ろし)
        this.camPitchTarget = 0;
        this.camYaw = 0;              // カメラのヨー(左右の振り)
        this.camYawTarget = 0;
        // 世界プリセット: 色だけでなくフォグ密度・背景の明るさも束ねる
        this.worldPresets = {
            // 概念語は曲(こたえて)の語彙に寄せる: 光/色を放つ・静かに耳を傾けて・夜明け/宵
            base:  { color: '#7F77DD', fog: 0.016, bgMul: 0.07, label: '回廊' },
            sky:   { color: '#8FD0FF', fog: 0.009, bgMul: 0.18, label: '光のほうへ' },
            earth: { color: '#C9772F', fog: 0.030, bgMul: 0.05, label: 'しずけさへ' },
            day:   { color: '#FFBE3D', fog: 0.007, bgMul: 0.22, label: '夜明けへ' },
            night: { color: '#4036C4', fog: 0.013, bgMul: 0.10, label: '宵の中へ' },
        };
        // ラスト3湖のプリセット(到達する結末)
        // 湖はフォグを薄くして水面・水際・反射が見えるようにする(色だけの湖にしない)
        this.lakePresets = {
            clear:  { color: '#9FD8FF', fog: 0.0035, bgMul: 0.26, name: '晴天の湖', env: 'day' },
            starry: { color: '#5560C4', fog: 0.0045, bgMul: 0.13, name: '夜空の湖', env: 'night' },
            cavern: { color: '#2FA6B0', fog: 0.010,  bgMul: 0.06, name: '地底湖', env: 'cavern' },
        };
        this.endingLake = null;
        this.lakePlane = null;
        this.lake = null;   // 湖の3Dオブジェクト群(水面・反射・地平線・岸)
        // ---- 選択後の3D空間背景(環境) ----
        // 選ぶたびに雲/太陽/月/洞窟などの実体が出現し、世界そのものが変わる。
        this.environments = [];   // 現在表示中(フェード中含む)の環境リスト
        this.activeEnvKey = null;
        this.cloudTexture = null;
        // 決定木の各分岐定義。pos=正方向(上/右), neg=負方向(下/左)。
        this.forkDefs = {
            root: {
                axis: 'vertical',
                prompt: '— 問いが、ふたつに分かれる —',  // 曲の「僕の問いの答え」に呼応
                pos: { key: 'up',   preset: this.worldPresets.sky,   env: 'sky' },     // 上半分タップ/↑
                neg: { key: 'down', preset: this.worldPresets.earth, env: 'cavern' },  // 下半分タップ/↓
            },
            sky: {
                axis: 'horizontal',
                prompt: '— 光が、ふたつに分かれる —',
                pos: { key: 'night', preset: this.worldPresets.night, env: 'night' }, // 右半分タップ/→
                neg: { key: 'day',   preset: this.worldPresets.day,   env: 'day' },   // 左半分タップ/←
            },
        };
        this.fogDensityTarget = 0.016;
        this.bgMul = 0.07;
        this.bgMulTarget = 0.07;

        // ---- 世界の色 ----
        this.worldColor = new THREE.Color(this.themeColor);        // 現在表示中の色(毎フレーム補間)
        this.worldColorTarget = new THREE.Color(this.themeColor);  // 目標色(選択で更新)
        // 毎フレームの色計算で使い回すスクラッチ(GC削減・clone回避)
        this._scratchColBg = new THREE.Color();    // 背景/フォグ用
        this._scratchColKey = new THREE.Color();   // キーライト用
        this._scratchColAmb = new THREE.Color();   // 環境光用
        this.finalAnswerColor = null;                              // 3回選び終えた混色
        this.finaleActive = false;
        this.finaleOverlay = null;

        // ---- 湖の循環: 過去に流した「問い」の波紋(エコー) ----
        // 自分が以前フィナーレで綴った問いが、回廊に淡い波紋として再来する。
        // 触れると「過去の問いに応える」= 自分の創作が次の体験の入力になる。
        this.pastRipples = [];        // localStorageから読み込んだ過去の問い
        this.echoRipples = [];        // いま漂っているエコー(スプライト群)
        this._echoCursor = 0;         // 次に出す過去問いのインデックス
        this._echoTimer = 6000;       // 最初のエコーまでの待ち(ms相当, 実時間で減算)
        this.answeredEchoes = 0;      // 過去の問いに応えた回数
        this.askActive = false;       // フィナーレの「問いを書く」UI表示中
        this.askEl = null;
        this.savedRipple = null;      // 今回フィナーレで湖に流した波紋

        // ---- DOM ----
        this.customStyleElement = null;
        this.paletteEl = null;
        this.paletteSlots = [];
        this.paletteSwatch = null;
        this.paletteResonanceEl = null;
        this._domTimers = [];

        this.boundOnResize = this.onResize.bind(this);
        this.boundOnPointerDown = this.onPointerDown.bind(this);
    }

    // =====================================================================
    // init
    // =====================================================================
    init() {
        this.injectCustomStyles();
        this.initThree();
        this.initGrid();
        this.initStars();
        this.createGlowTexture();
        this.createCloudTexture();
        this.loadMiku();
        this.createPaletteUI();

        // 過去に湖へ流した「問い」を読み込む(古い順)。回廊にエコーとして再来させる。
        this.pastRipples = getRipples({ songId: 'kotaete', type: 'question' });
        this._echoCursor = 0;
        this.updateLakeCount();

        window.addEventListener('resize', this.boundOnResize);
        // click はBaseSongの汎用リップル用に残し、レイキャストはpointerdownで両対応
        this.songWrapper.addEventListener('pointerdown', this.boundOnPointerDown);

        super.init();

        // 初回誘導: 最初に流れてきた歌詞スプライトの実位置にガイドを重ねる(共通機構)。
        // 一度でも共鳴したら resonate() 側で dismiss する。
        this.highlightFirstInteractable(() => {
            if (this.resonanceCount > 0) return null;
            const target = this.activeSprites.find(s => s && !s.userData.resonated);
            if (!target) return null;
            return this.worldToScreen(target.position.clone());
        }, { label: '歌詞をタップ' });
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050510, 0.016);
        this.scene.background = new THREE.Color(0x050510);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 2, 10);

        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        this.songWrapper.appendChild(this.renderer.domElement);

        // ミクと回廊を照らすライト群(色は世界の色に追従)
        this.ambientLight = new THREE.AmbientLight(0x404070, 1.6);
        this.scene.add(this.ambientLight);

        this.keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
        this.keyLight.position.set(2, 6, 8);
        this.scene.add(this.keyLight);

        this.mikuLight = new THREE.PointLight(new THREE.Color(this.themeColor), 1.4, 40);
        this.scene.add(this.mikuLight);
    }

    initGrid() {
        this.gridMaterial = new THREE.LineBasicMaterial({
            color: new THREE.Color(this.themeColor),
            transparent: true,
            opacity: 0.8,
        });

        // 縦のレーン
        for (let i = -10; i <= 10; i++) {
            const points = [
                new THREE.Vector3(i * 2, -2, -50),
                new THREE.Vector3(i * 2, -2, 50),
            ];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, this.gridMaterial);
            this.scene.add(line);
            this.paths.push(line);
        }

        // 横線(手前ほど密)
        const zPositions = [];
        for (let i = 0; i <= 30; i++) {
            zPositions.push(-50 + i * i * 0.055);
        }
        zPositions.forEach(z => {
            const points = [
                new THREE.Vector3(-20, -2, z),
                new THREE.Vector3(20, -2, z),
            ];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, this.gridMaterial);
            this.scene.add(line);
            this.paths.push(line);
        });
    }

    initStars() {
        const count = this.isMobile ? 600 : 1400;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 90;
            positions[i * 3 + 1] = Math.random() * 35 - 4;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 140;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: new THREE.Color(this.themeColor),
            size: 0.12,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.starField = new THREE.Points(geo, mat);
        this.scene.add(this.starField);
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
        this.glowTexture = new THREE.CanvasTexture(canvas);

        // リング(輪郭)テクスチャ — 「タップできる」合図と衝撃波に使う
        const rc = document.createElement('canvas');
        rc.width = 128; rc.height = 128;
        const rx = rc.getContext('2d');
        rx.strokeStyle = 'rgba(255,255,255,1)';
        rx.lineWidth = 9;
        rx.beginPath();
        rx.arc(64, 64, 50, 0, Math.PI * 2);
        rx.stroke();
        rx.strokeStyle = 'rgba(255,255,255,0.35)';
        rx.lineWidth = 18;
        rx.beginPath();
        rx.arc(64, 64, 50, 0, Math.PI * 2);
        rx.stroke();
        this.ringTexture = new THREE.CanvasTexture(rc);
    }

    // ふわっとした雲のテクスチャ(柔らかい円を重ねたもの)
    createCloudTexture() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        const x = c.getContext('2d');
        for (let i = 0; i < 9; i++) {
            const r = 26 + Math.random() * 38;
            const cx = 40 + Math.random() * 176;
            const cy = 52 + Math.random() * 40;
            const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, 'rgba(255,255,255,0.85)');
            g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g;
            x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
        }
        this.cloudTexture = new THREE.CanvasTexture(c);
    }

    // =====================================================================
    // VRM: 先導するミク
    // =====================================================================
    loadMiku() {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        loader.load(
            import.meta.env.BASE_URL + 'assets/models/model_miku.vrm',
            (gltf) => {
                if (!this.isActive) {
                    this.disposeVRM(gltf.userData.vrm);
                    return;
                }
                const vrm = gltf.userData.vrm;
                this.currentVRM = vrm;
                this.scene.add(vrm.scene);
                vrm.scene.scale.setScalar(3.1);
                vrm.scene.position.set(0, 1.5, this.camera.position.z - 11);
                vrm.scene.rotation.y = Math.PI; // 背中向きで先導
                this.mikuRotY = Math.PI;
                this.setupGlidePose(vrm);
                settleSpringBones(vrm); // 開幕時にツインテールが逆立たないよう静止状態へ
                this.mikuLoaded = true;

                // ミクの背後にほのかな光輪
                const glowMat = new THREE.SpriteMaterial({
                    map: this.glowTexture,
                    color: new THREE.Color(this.themeColor),
                    transparent: true,
                    opacity: 0.35,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
                this.mikuGlowSprite = new THREE.Sprite(glowMat);
                this.mikuGlowSprite.scale.set(6, 6, 1);
                this.scene.add(this.mikuGlowSprite);

                console.log('[KOTAETE] Miku VRM loaded.');
            },
            undefined,
            (error) => {
                console.error('[KOTAETE] Failed to load VRM:', error);
            }
        );
    }

    setupGlidePose(vrm) {
        if (!vrm || !vrm.humanoid) return;
        const get = (name) => vrm.humanoid.getNormalizedBoneNode(name);

        const leftUpperArm = get('leftUpperArm');
        const rightUpperArm = get('rightUpperArm');
        const leftLowerArm = get('leftLowerArm');
        const rightLowerArm = get('rightLowerArm');
        // 新VRMモデルは上腕ロール軸が逆: 左+/右- で腕が下がる
        if (leftUpperArm) leftUpperArm.rotation.z = Math.PI / 2.8;
        if (rightUpperArm) rightUpperArm.rotation.z = -Math.PI / 2.8;
        if (leftLowerArm) leftLowerArm.rotation.y = Math.PI / 12;
        if (rightLowerArm) rightLowerArm.rotation.y = -Math.PI / 12;

        // 滑空らしく脚をわずかに後ろへ流す
        const leftUpperLeg = get('leftUpperLeg');
        const rightUpperLeg = get('rightUpperLeg');
        const leftLowerLeg = get('leftLowerLeg');
        const rightLowerLeg = get('rightLowerLeg');
        if (leftUpperLeg) { leftUpperLeg.rotation.z = Math.PI / 26; leftUpperLeg.rotation.x = Math.PI / 14; }
        if (rightUpperLeg) { rightUpperLeg.rotation.z = -Math.PI / 26; rightUpperLeg.rotation.x = Math.PI / 18; }
        if (leftLowerLeg) leftLowerLeg.rotation.x = -Math.PI / 10;
        if (rightLowerLeg) rightLowerLeg.rotation.x = -Math.PI / 12;
    }

    updateMiku(positionMs, beatPulse) {
        if (!this.currentVRM) return;

        const now = performance.now();
        const deltaSec = Math.min(0.1, (now - this._lastFrameReal) / 1000);
        const t = (now - this._sceneStartReal) / 1000; // 相対秒(エポック秒の精度凍結回避)

        const vs = this.currentVRM.scene;

        // 曲の進行に応じてミクが前後左右・上下へダイナミックに動く(単調さ回避)
        // --- 奥行き: 長短周期のうねり + サビで前進 + ビートで弾む + 振り返りで接近 ---
        let depthTarget = 11
            + Math.sin(t * 0.13) * 3.2      // 長周期: ゆっくり奥へ/手前へ
            + Math.sin(t * 0.31) * 1.8;     // 中周期のうねり
        if (this.isClimax) depthTarget -= 4.5;        // サビは前へ出てくる
        if (this.greetActive) depthTarget -= 2.2;     // 振り返るとき少し近づく
        depthTarget -= beatPulse * 1.4;               // ビート頭で前へ弾む
        depthTarget = Math.max(6.5, Math.min(16.5, depthTarget));
        this.mikuDepth += (depthTarget - this.mikuDepth) * Math.min(1, deltaSec * 1.4);
        vs.position.z = this.camera.position.z - this.mikuDepth;

        // --- 左右: 8の字に weaving(近いほど振り幅を抑えて枠外に出さない) ---
        const nearK = Math.max(0.4, Math.min(1, (this.mikuDepth - 5) / 8));
        const swayX = (Math.sin(t * 0.37) * 1.7 + Math.sin(t * 0.83) * 0.6) * nearK;
        vs.position.x += (swayX - vs.position.x) * 0.04;

        // --- グルーヴ用パルス: 拍頭で素早く立ち上がり、ゆっくり減衰(キレ+余韻) ---
        // 立ち上がりを速くして拍との遅れ(後手)を詰める。bounce/applyGrooveで再利用。
        this._groove = (this._groove || 0);
        {
            const atk = beatPulse > this._groove ? deltaSec * 45 : deltaSec * 9;
            this._groove += (beatPulse - this._groove) * Math.min(1, atk);
        }
        // 縦ノリ: 拍内位相のレイズドコサインで「拍の瞬間に底」を作る。
        // 0.5(1+cos2πp) は p=0(拍頭)で1=最も沈み、拍間で滑らかに戻る → 遅延ゼロ・段差なし。
        const phase = (this._beatFrac != null) ? this._beatFrac : 0.5;
        const bounceEnv = 0.5 * (1 + Math.cos(2 * Math.PI * phase));
        // 微小ジッタ除去に軽く平滑化(位相ベースなので遅れはほぼ出ない)
        this._bounce = (this._bounce || 0);
        this._bounce += (bounceEnv - this._bounce) * Math.min(1, deltaSec * 40);

        // --- 上下: 拍で沈んで跳ね返る「縦ノリ」を主役に + 浮遊bob + サビで上昇 ---
        // 従来は時間sineのみで拍と無相関だった。拍位相エンベロープで縦バウンスを作る。
        const bobY = Math.sin(t * 1.25) * 0.07 + Math.sin(t * 0.47) * 0.04; // 浮遊は控えめに
        const bounce = this._bounce * (this.isClimax ? 0.60 : 0.44);        // 拍頭で下へ沈む
        const riseTarget = this.isClimax ? 0.7 : 0.0;
        this._mikuRise += (riseTarget - this._mikuRise) * Math.min(1, deltaSec * 1.2);
        vs.position.y = 1.5 + bobY + this._mikuRise - bounce;

        // ちょくちょく振り返って手を振る挨拶(選択・フィナーレ中は本来の演出を優先)
        this.updateGreet(deltaSec);

        // サビは正面寄り(3/4)を向いて主役化。挨拶・フィナーレ中は専用演出を優先。
        // 通常時は背中向きで先導(選択中は選択側の向き指定に任せる)。
        // 分岐中は beginFork/commitFork の向き指定(正面で差し伸べる)を優先する
        if (!this.greetActive && !this.finaleActive && !this.forkActive) {
            if (this.isClimax) this.mikuFacingTarget = Math.PI * 0.26;
            else if (!this.choiceActive) this.mikuFacingTarget = Math.PI;
        }

        // 向きの補間(問いが届くと振り返る)
        this.mikuRotY += (this.mikuFacingTarget - this.mikuRotY) * Math.min(1, deltaSec * 2.6);
        vs.rotation.y = this.mikuRotY;
        // 滑空の傾き(背中向きの時だけ前傾+ロール)
        const leadAmount = Math.abs(Math.sin(this.mikuRotY / 2)); // 1=背中向き 0=カメラ向き
        vs.rotation.z = Math.sin(t * 0.6) * 0.06 * leadAmount;
        vs.rotation.x = 0.12 * leadAmount;

        // 手を差し伸べるブレンド
        this.reachBlend += (this.reachBlendTarget - this.reachBlend) * Math.min(1, deltaSec * 3.0);
        const b = this.reachBlend;
        if (this.currentVRM.humanoid) {
            const lerp = (a, c) => a + (c - a) * b;
            const lu = this.currentVRM.humanoid.getNormalizedBoneNode('leftUpperArm');
            const ru = this.currentVRM.humanoid.getNormalizedBoneNode('rightUpperArm');
            const ll = this.currentVRM.humanoid.getNormalizedBoneNode('leftLowerArm');
            const rl = this.currentVRM.humanoid.getNormalizedBoneNode('rightLowerArm');
            const neck = this.currentVRM.humanoid.getNormalizedBoneNode('neck');
            // 新VRMは上腕ロール軸が逆: 左+/右- が「下げる」。脱力(下げる)→差し伸べ(やや上げ前方)
            if (lu) { lu.rotation.z = lerp(Math.PI / 2.8, Math.PI / 9); lu.rotation.x = lerp(0, -Math.PI / 2.4); }
            if (ru) { ru.rotation.z = lerp(-Math.PI / 2.8, -Math.PI / 9); ru.rotation.x = lerp(0, -Math.PI / 2.4); }
            if (ll) { ll.rotation.y = lerp(Math.PI / 12, Math.PI / 18); }
            if (rl) { rl.rotation.y = lerp(-Math.PI / 12, -Math.PI / 18); }
            // neck は x/y とも毎フレーム基準値へリセット(加算による首の回転暴走を防ぐ)
            if (neck) { neck.rotation.x = lerp(0, 0.12); neck.rotation.y = 0; }

            // 振り返ったときに右手を上げて振る(脱力ポーズに重ねる)
            // 右腕は z+ で上がる。頭の高さ程度に留め(万歳にしない)、左右にゆらす
            if (this.greetWave > 0 && ru) {
                const wv = this.greetWave;
                const swing = Math.sin(t * 9) * 0.28; // 手を左右に振る(穏やかに)
                ru.rotation.z += (0.5 - ru.rotation.z) * wv + swing * wv; // 肩〜頭の高さへ
                ru.rotation.x += (-0.5 - ru.rotation.x) * wv;            // 前方(こちら)へ
                // 肘を曲げ手を顔の横へ(右前腕は y- で前方へ屈曲)
                if (rl) { rl.rotation.y += (-1.2 - rl.rotation.y) * wv; }
                // 顔を少しだけこちらへ(絶対値・基準0からのオフセットなので累積しない)
                if (neck) { neck.rotation.y = -0.1 * wv; }
                this.mikuGlowPulse = Math.max(this.mikuGlowPulse, wv * 0.4);
            }
        }

        // ミクの光輪と専用ライト
        if (this.mikuGlowSprite) {
            this.mikuGlowSprite.position.copy(vs.position);
            this.mikuGlowSprite.position.y += 1.6;
            const glow = 0.3 + beatPulse * 0.18 + this.mikuGlowPulse * 0.55;
            this.mikuGlowSprite.material.opacity = Math.min(1, glow);
            const gs = 6 + this.mikuGlowPulse * 3 + beatPulse * 0.6;
            this.mikuGlowSprite.scale.set(gs, gs, 1);
            this.mikuGlowSprite.material.color.copy(this.worldColor);
        }
        if (this.mikuLight) {
            this.mikuLight.position.copy(vs.position);
            this.mikuLight.position.y += 2;
            this.mikuLight.intensity = 1.2 + beatPulse * 0.8 + this.mikuGlowPulse * 2.2;
            this.mikuLight.color.copy(this.worldColor);
        }
        this.mikuGlowPulse = Math.max(0, this.mikuGlowPulse - deltaSec * 1.8);

        // ビートに乗って腰・背骨・頭で踊る(移動ではなくボーンの律動)
        this.applyGroove(t, beatPulse, deltaSec);

        // 表情(まばたき・リップシンク・感情)を毎フレーム更新
        this.updateMikuFace(positionMs, beatPulse);

        this.currentVRM.update(deltaSec);
    }

    // ビート同期のグルーヴ: モデル全体を動かすのではなく、胴体ボーンに
    // 拍のアクセント(沈み込み)と2拍周期の体重移動を与えて「踊っている」感を出す。
    // 強度は this.grooveConfig で曲ごとに調整可能。毎フレーム絶対値で代入し累積を防ぐ。
    applyGroove(t, beatPulse, deltaSec) {
        const vrm = this.currentVRM;
        if (!vrm || !vrm.humanoid) return;
        const cfg = this.grooveConfig || (this.grooveConfig = {
            gain: 1.0,       // 全体の効き
            climaxGain: 1.0, // サビでの追加倍率(gainに乗算)
            punch: 0.18,     // 拍頭で胴を前に沈める量(rad)
            sway: 0.12,      // 体重移動の振り幅(rad)
            headNod: 0.14,   // 頭の頷き量(rad)
            armSwing: 0.30,  // サビで腕を振る量(rad)
            kneeBeat: 0.45,  // 拍ごとに膝を抱える量(rad)
            legLift: 0.40,   // 体重移動に合わせた脚の上げ量(rad)
        });
        const get = (n) => vrm.humanoid.getNormalizedBoneNode(n);
        const hips  = get('hips');
        const spine = get('spine');
        const chest = get('upperChest') || get('chest');
        const head  = get('head');
        if (!spine && !hips) return;

        const gain = cfg.gain * (this.isClimax ? cfg.climaxGain * 1.6 : 1.0);

        // グルーヴ用パルスは updateMiku で更新済み(拍頭で素早く立ち上がる版)を再利用
        const g = this._groove || 0;

        // 拍頭で胴を前に沈めて跳ね返す(スクワッシュ&ストレッチ)。
        // 小節頭は_barAccentを上乗せして「踏み込み」を強調(縦ノリには触れない)。
        const punch = (g + (this._barAccent || 0) * 0.5) * cfg.punch * gain;
        if (spine) spine.rotation.x = punch;
        if (chest) chest.rotation.x = -punch * 0.5;

        // 体重移動: 拍ごとに左右へ振る振り子(_beatStepで向き反転)
        const swayTarget = (this._beatStep || 1) * cfg.sway * gain;
        this._swayCur = (this._swayCur || 0);
        this._swayCur += (swayTarget - this._swayCur) * Math.min(1, deltaSec * 6);
        const s = this._swayCur;
        if (hips)  hips.rotation.z  = s;
        if (spine) spine.rotation.z = -s * 0.6; // 上半身を逆に=自然なSカーブ

        // 頭: 拍で頷き＋ゆっくりした揺れ＋体重移動に追従
        if (head) {
            head.rotation.x = g * cfg.headNod * gain + Math.sin(t * 1.2) * 0.03;
            head.rotation.z = s * 0.5;
        }

        // 脚: 拍ごとに膝を抱え、体重移動に合わせて片脚を上げる(置物感の解消)。
        // setupGlidePoseの基準ポーズ(滑空)に拍の動きを重ねて毎フレーム絶対値で代入。
        const lUL = get('leftUpperLeg'), rUL = get('rightUpperLeg');
        const lLL = get('leftLowerLeg'), rLL = get('rightLowerLeg');
        const swayN = Math.max(-1, Math.min(1, s / Math.max(0.001, cfg.sway * gain))); // -1..1
        const knee = g * cfg.kneeBeat * gain;
        // 体重が乗る側(swayの向き)の逆脚を持ち上げる=マーチ/ステップ感
        const liftL = Math.max(0, -swayN) * cfg.legLift * gain;
        const liftR = Math.max(0,  swayN) * cfg.legLift * gain;
        if (lUL) { lUL.rotation.z = Math.PI / 26;  lUL.rotation.x = Math.PI / 14 + liftL; }
        if (rUL) { rUL.rotation.z = -Math.PI / 26; rUL.rotation.x = Math.PI / 18 + liftR; }
        if (lLL) lLL.rotation.x = -Math.PI / 10 - knee - liftL * 0.6;
        if (rLL) rLL.rotation.x = -Math.PI / 12 - knee - liftR * 0.6;

        // 小節頭アクセント: 1拍目で発火→減衰。光輪を一押しして拍節感を可視化
        this._barAccent = Math.max(0, (this._barAccent || 0) - deltaSec * 2.2);
        if (this._barAccent > 0) {
            this.mikuGlowPulse = Math.max(this.mikuGlowPulse, this._barAccent * 0.45 * gain);
        }

        // サビの腕は「コード進行で切替わる振付けの型」に従う(reach/greet中は触らない)。
        // 縦ノリ・脚・同期には一切触れず、腕/肘の型だけを変えて単調さを解消する。
        if (this.isClimax && this.reachBlend < 0.05 && this.greetWave <= 0) {
            const lu = get('leftUpperArm'),  ru = get('rightUpperArm');
            const ll = get('leftLowerArm'),  rl = get('rightLowerArm');
            const beat = (g + (this._barAccent || 0) * 0.6) * gain; // 拍/小節頭の押し出し
            const side = this._danceSide || 1;
            const mv = this._danceMove || 0;
            // 型ごとの腕ターゲット(肩z=上下, 肩x=前後, 肘y=曲げ, 前腕x=拍スイング)
            let luZ, ruZ, luX, ruX, llY, rlY, swing = 0;
            if (mv === 1) {            // アップ・スウェイ: 両腕を上げて体重移動で左右に振る
                luZ = Math.PI / 9 + s * 0.5;  ruZ = -Math.PI / 9 + s * 0.5;
                luX = -0.35 - beat * 0.25;    ruX = -0.35 - beat * 0.25;
                llY = Math.PI / 9;            rlY = -Math.PI / 9;
            } else if (mv === 2) {     // リーチ: 片手を前へ差し出す(コードごとに左右交替)
                luZ = Math.PI / 4;  ruZ = -Math.PI / 4;  luX = 0;  ruX = 0;
                llY = Math.PI / 12; rlY = -Math.PI / 12;
                if (side > 0) { ruZ = -Math.PI / 10; ruX = -0.55 - beat * 0.2; }
                else          { luZ =  Math.PI / 10; luX = -0.55 - beat * 0.2; }
            } else if (mv === 3) {     // 内省(短調): 手を胸元へ小さくたたむ
                luZ = Math.PI / 3.0; ruZ = -Math.PI / 3.0; luX = -0.15; ruX = -0.15;
                llY = Math.PI / 3;   rlY = -Math.PI / 3;
            } else {                   // 0: サイド・スウィング(控えめ・前腕を拍で振る)
                luZ = Math.PI / 4.2; ruZ = -Math.PI / 4.2; luX = 0; ruX = 0;
                llY = Math.PI / 14;  rlY = -Math.PI / 14;  swing = beat * 0.5;
            }
            // 型の切替を滑らかに(腕状態を保持してターゲットへ補間)
            const k = Math.min(1, deltaSec * 4);
            const A = this._armS || (this._armS = {});
            const L = (key, val) => (A[key] = (A[key] == null ? val : A[key] + (val - A[key]) * k));
            if (lu) { lu.rotation.z = L('luZ', luZ); lu.rotation.x = L('luX', luX); }
            if (ru) { ru.rotation.z = L('ruZ', ruZ); ru.rotation.x = L('ruX', ruX); }
            if (ll) { ll.rotation.y = L('llY', llY); ll.rotation.x = L('llX', -swing); }
            if (rl) { rl.rotation.y = L('rlY', rlY); rl.rotation.x = L('rlX',  swing); }
        }
    }

    // ミクの表情を細かく動かす: まばたき・歌唱に合わせた口形(母音)・感情の補間。
    updateMikuFace(positionMs, beatPulse) {
        const em = this.currentVRM.expressionManager;
        if (!em) return;
        const now = performance.now();
        const dt = Math.min(0.1, (now - (this._lastFaceReal || now)) / 1000);
        this._lastFaceReal = now;

        // --- まばたき(時々パチッと) ---
        if (this._blinkTimer === undefined) this._blinkTimer = 1 + Math.random() * 3;
        this._blinkTimer -= dt;
        let blink = 0;
        const BLINK_DUR = 0.16;
        if (this._blinkTimer <= 0) {
            const bp = (this._blinkTimer + BLINK_DUR) / BLINK_DUR; // 1→0
            blink = Math.sin(Math.max(0, Math.min(1, bp)) * Math.PI);
            if (this._blinkTimer <= -BLINK_DUR) this._blinkTimer = 1.6 + Math.random() * 3.4;
        }
        em.setValue('blink', Math.min(1, blink));

        // --- リップシンク(歌っている文字の母音で口形を変える) ---
        const v = playerManager.player.video;
        const char = (v && v.findChar) ? v.findChar(positionMs) : null;
        const vowels = ['aa', 'ih', 'ou', 'ee', 'oh'];
        let mouthOpen = 0, vowel = 'aa';
        if (char && char.text && positionMs >= char.startTime && positionMs <= char.endTime) {
            vowel = this._vowelOf(char.text);
            const span = Math.max(1, char.endTime - char.startTime);
            const cp = (positionMs - char.startTime) / span;
            mouthOpen = Math.sin(Math.min(1, cp) * Math.PI) * 0.85 + 0.12; // 開いて閉じる
        }
        for (const vw of vowels) em.setValue(vw, vw === vowel ? mouthOpen : 0);

        // --- 感情(なめらかに補間) ---
        // 振り返って手を振るとき・歌詞が触れたとき・ビートの高揚で笑顔に、
        // それ以外は穏やか(relaxed)を基調にする。
        this._contactJoy = Math.max(0, (this._contactJoy || 0) - dt * 1.4);
        const happyTarget = Math.min(1, Math.max(this.greetWave, this._contactJoy, this.mikuGlowPulse * 0.4, beatPulse * 0.25));
        this._faceHappy = (this._faceHappy || 0) + (happyTarget - (this._faceHappy || 0)) * Math.min(1, dt * 4);
        em.setValue('happy', Math.min(1, this._faceHappy));
        em.setValue('relaxed', Math.max(0, 0.4 - this._faceHappy * 0.8));
    }

    // 文字の母音を判定してVRMの口形プリセット名を返す
    _vowelOf(ch) {
        if (/[いぃきぎしじちぢにひびぴみりゐイィキギシジチヂニヒビピミリ]/.test(ch)) return 'ih';
        if (/[うぅくぐすずつづぬふぶぷむゆるゔウゥクグスズツヅヌフブプムユルヴ]/.test(ch)) return 'ou';
        if (/[えぇけげせぜてでねへべぺめれゑエェケゲセゼテデネヘベペメレ]/.test(ch)) return 'ee';
        if (/[おぉこごそぞとどのほぼぽもよろをオォコゴソゾトドノホボポモヨロヲ]/.test(ch)) return 'oh';
        if (/[んンっッ]/.test(ch)) return 'aa';
        return 'aa';
    }

    // 振り返って手を振る演出の進行管理。
    // 開始は歌詞「手を振る/手を降る」検知時のみ(update内でgreetActiveをtrueにする)。
    // それ以外は背中向き(向こう側)で先導し、手も振らない。
    // 選択・フィナーレ中は本来の振り返り演出を優先するため挨拶は引っ込める。
    updateGreet(deltaSec) {
        if (this.choiceActive || this.finaleActive) {
            if (this.greetActive) { this.greetActive = false; this.greetWave = 0; }
            return;
        }
        if (!this.greetActive) return; // 歌詞トリガーが来るまで何もしない(背中向きのまま)
        // 背中向き → 振り返り → 手を振る → 背中向きへ戻る
        const DUR = 3.4;
        this.greetElapsed += deltaSec;
        const p = Math.min(1, this.greetElapsed / DUR);
        const turn = Math.sin(p * Math.PI);                       // 0→1→0(振り返り量)
        this.mikuFacingTarget = Math.PI * (1 - turn * 0.96);      // ほぼ正面まで振り返る
        this.greetWave = Math.max(0, (turn - 0.35) / 0.65);       // ピーク付近だけ手を振る
        if (this.greetElapsed >= DUR) {
            this.greetActive = false;
            this.greetWave = 0;
            this.mikuFacingTarget = Math.PI;                      // 背中向きへ戻る
        }
    }

    // =====================================================================
    // 歌詞スプライト
    // =====================================================================
    // 実測してテクスチャを可変サイズにし、長文は2行に折り返す。
    // 戻り値の aspect でスプライト比率を決めるため、テクスチャ内・画面内
    // どちらでも歌詞が見切れない。
    createTextTexture(text, colorStr) {
        const FONT = 'bold 80px "Inter", "Noto Sans JP", "Hiragino Kaku Gothic Pro", sans-serif';
        const PAD = 56;
        const LINE_H = 116;
        const MAX_LINE = 1100; // この幅を超えたら2行に折り返す

        const meas = document.createElement('canvas').getContext('2d');
        meas.font = FONT;
        const fullW = meas.measureText(text).width;

        // 行分割: 1行で収まればそのまま、収まらなければ中央付近で2分割
        let lines = [text];
        if (fullW > MAX_LINE && text.length >= 4) {
            let best = Math.ceil(text.length / 2);
            // 句読点や助詞の近くで割れるよう微調整
            for (let off = 0; off <= 3; off++) {
                const c = text[best + off];
                if (c && '、。　 はがにをのとへもや'.includes(c)) { best = best + off + 1; break; }
            }
            lines = [text.slice(0, best), text.slice(best)];
        }

        const lineWidths = lines.map(l => meas.measureText(l).width);
        const w = Math.ceil(Math.min(MAX_LINE, Math.max(...lineWidths)) + PAD);
        const h = LINE_H * lines.length + PAD;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.font = FONT;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = colorStr;
        ctx.shadowBlur = 22;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 長すぎる行は最大幅へスケール(切れさせない最後の保険)
        lines.forEach((line, i) => {
            const lw = lineWidths[i];
            const y = (h / 2) - (LINE_H * (lines.length - 1)) / 2 + i * LINE_H;
            if (lw > MAX_LINE) {
                ctx.save();
                ctx.translate(w / 2, y);
                ctx.scale(MAX_LINE / lw, 1);
                ctx.fillText(line, 0, 0);
                ctx.restore();
            } else {
                ctx.fillText(line, w / 2, y);
            }
        });

        const tex = new THREE.CanvasTexture(canvas);
        return { texture: tex, aspect: w / h };
    }

    // カメラの視錐台から、指定zでの可視幅(ワールド単位)を返す
    _visibleWidthAt(z) {
        const dist = Math.abs(this.camera.position.z - z);
        const vH = 2 * dist * Math.tan((this.camera.fov * Math.PI / 180) / 2);
        return vH * this.camera.aspect;
    }

    spawnText(phrase, spawnTime) {
        const colorStr = `#${this.worldColor.getHexString()}`;
        const { texture, aspect } = this.createTextTexture(phrase.text, colorStr);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0,
        });
        const sprite = new THREE.Sprite(material);

        // 中央を流れる読みやすい配置(横は控えめ、縦は重ならないよう散らす)
        const z = this.camera.position.z - 17 - Math.random() * 5;
        let x = (Math.random() - 0.5) * 3.0;
        // サビはミクが正面・手前で主役になるので、歌詞は下方へ退避させ顔/体を隠さない
        let y = this.isClimax
            ? -2.5 + (Math.random() - 0.5) * 1.0
            : 1.4 + (Math.random() - 0.5) * 3.2;
        // 二股分岐中は、歌詞を選択肢の側へ交互に振り分けて流す。
        // 追った言葉の側がそのまま選択につながる = 「歌詞が誘導路」になる。
        // 縦分割は上(pos)/下(neg)へ、横分割は右(pos)/左(neg)へ流す。
        let forkDir = 0, forkDirX = 0;
        if (this.forkActive && this.fork && this._forkConfig) {
            this._forkLyricSide = -(this._forkLyricSide || -1);
            const sgn = this._forkLyricSide > 0 ? 1 : -1;     // +1=pos / -1=neg
            const opt = sgn > 0 ? this._forkConfig.pos : this._forkConfig.neg;
            const tint = opt.preset.color;
            material.color.copy(new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.5));
            if (this._forkConfig.axis === 'vertical') {
                forkDir = sgn;
                x = (Math.random() - 0.5) * 2.2;
                y = sgn > 0 ? (2.2 + Math.random() * 0.8) : (-2.2 - Math.random() * 0.8);
            } else {
                forkDirX = sgn;                               // +1=右(pos) / -1=左(neg)
                x = sgn > 0 ? (2.4 + Math.random() * 0.8) : (-2.4 - Math.random() * 0.8);
                y = 1.0 + (Math.random() - 0.5) * 1.2;
            }
        }
        sprite.position.set(x, y, z);

        // 画面内に必ず収める: 可視幅の82%を上限に、近づいて大きく見える分も考慮
        const fitW = this._visibleWidthAt(z) * 0.82;
        let height = 2.4 + Math.random() * 0.5;
        if (this.isClimax) height *= 1.18; // サビは少し大きく
        let width = height * aspect;
        if (Math.abs(x) + width / 2 > fitW / 2) {
            // 端に寄った分も含めて収まるよう縮小
            width = Math.max(1.2, fitW - Math.abs(x) * 2);
            height = width / aspect;
        }
        const maxHeight = this.isClimax ? 3.4 : 3.0;
        if (height > maxHeight) { height = maxHeight; width = height * aspect; }

        sprite.scale.set(width, height, 1);
        sprite.userData = {
            birth: spawnTime,
            life: 5000,
            text: phrase.text,
            baseW: width,
            baseH: height,
            pulseProgress: 0,
            resonated: false,
            resonateFlash: 0,
            haloPulse: Math.random() * Math.PI * 2,
            forkDir,   // 縦分割の誘導歌詞: 0=通常 / +1=上(pos) / -1=下(neg)
            forkDirX,  // 横分割の誘導歌詞: 0=通常 / +1=右(pos) / -1=左(neg)
        };

        // タップできる合図: 言葉の後ろに淡く脈動する光のハロー
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.glowTexture,
            color: new THREE.Color(this.themeColor).lerp(new THREE.Color(0xffffff), 0.4),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }));
        halo.scale.set(width * 1.25, height * 2.0, 1);
        halo.position.copy(sprite.position);
        halo.renderOrder = -1;
        sprite.userData.halo = halo;
        this.scene.add(halo);

        // タップ対象を明示する光るアンダーライン(歌唱中の言葉ほど強く光る = 主目標)
        const ring = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.glowTexture,
            color: new THREE.Color(this.themeColor).lerp(new THREE.Color(0xffffff), 0.6),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }));
        ring.scale.set(width * 0.92, height * 0.34, 1);
        ring.position.set(sprite.position.x, sprite.position.y - height * 0.52, sprite.position.z - 0.04);
        ring.renderOrder = -1;
        sprite.userData.ring = ring;
        this.scene.add(ring);

        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    // =====================================================================
    // 共鳴インタラクション(クリック/タップ → レイキャスト)
    // =====================================================================
    onPointerDown(event) {
        if (!this.isActive || !this.camera || this.isTutorialActive) return;
        // 選択UIなどのボタン操作は素通しする
        if (event.target && event.target.closest &&
            event.target.closest('.kotaete-choice-container, .song-tutorial-overlay, .kotaete-ask')) {
            return;
        }

        // 二股分岐中は画面の半分を直感的にタップして選ぶ(読まない)。
        //   縦分割: 上半分=pos(天) / 下半分=neg(地)
        //   横分割: 右半分=pos(夜) / 左半分=neg(昼)
        if (this.forkActive && this.fork && this._forkConfig) {
            let side;
            if (this._forkConfig.axis === 'vertical') {
                side = event.clientY < window.innerHeight / 2 ? 'pos' : 'neg';
            } else {
                side = event.clientX < window.innerWidth / 2 ? 'neg' : 'pos';
            }
            this.commitFork(side);
            return;
        }

        // 選択中はオーブのタップを最優先
        if (this.choiceActive && this.choiceOrbs) {
            const orb = this._pickChoiceOrb(event.clientX, event.clientY);
            if (orb) { this.applyChoice(orb.opt.color); return; }
        }

        // 指でも当てやすいよう、画面投影での最近傍ピック(判定マージン付き)
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        const threshold = Math.max(96, window.innerWidth * 0.09);
        let best = null;
        let bestDist = Infinity;
        const v = new THREE.Vector3();
        for (const s of this.activeSprites) {
            if (s.userData.resonated) continue;
            v.copy(s.position).project(this.camera);
            if (v.z >= 1) continue;
            const sx = v.x * widthHalf + widthHalf;
            const sy = -v.y * heightHalf + heightHalf;
            const d = Math.hypot(event.clientX - sx, event.clientY - sy);
            if (d < threshold && d < bestDist) { bestDist = d; best = s; }
        }
        if (best) { this.resonate(best, event.clientX, event.clientY); return; }

        // 現在の歌詞に当たらなければ、過去の問い(エコー)への応答を判定
        const echo = this._pickEcho(event.clientX, event.clientY);
        if (echo) this.resonateEcho(echo, event.clientX, event.clientY);
    }

    resonate(sprite, clientX, clientY) {
        this.dismissFirstInteractable(); // 初回共鳴で誘導ガイドを片付ける
        sfx.play('kotaete_resonance');
        sprite.userData.resonated = true;
        sprite.userData.resonateFlash = 1.4; // 強めにポップ
        sprite.userData.settle = 0;          // 0→1: 応答済みの「落ち着いた軌跡」へ変化
        // 共鳴の還元①: 共鳴したフレーズは輝く軌跡として長く回廊に残る
        sprite.userData.life += 2800;
        this.resonanceCount++;
        this.updatePaletteResonance();

        // タップした言葉から弾ける3D衝撃波リング(はっきりした手応え)
        this.spawnShockwave(sprite.position.clone(), Math.max(sprite.scale.x, sprite.scale.y));

        // 波紋(DOM)
        const ripple = document.createElement('div');
        ripple.className = 'kotaete-resonance-ripple';
        ripple.style.left = `${clientX}px`;
        ripple.style.top = `${clientY}px`;
        ripple.style.borderColor = `#${this.worldColor.getHexString()}`;
        this.songWrapper.appendChild(ripple);
        this._domTimers.push(setTimeout(() => {
            if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
        }, 900));

        // 光の粒がミクへ飛ぶ
        this.spawnFlyingParticles(sprite.position.clone());

        // 絆ゲージを脈打たせて「増えた」と分かるように
        if (this.gaugeFillEl) {
            this.gaugeFillEl.classList.remove('bump');
            void this.gaugeFillEl.offsetWidth;
            this.gaugeFillEl.classList.add('bump');
        }
    }

    // タップ位置から広がって消える発光リング(複数枚で奥行きを出す)
    spawnShockwave(pos, baseSize) {
        if (!this.shockwaves) this.shockwaves = [];
        const color = new THREE.Color(this.worldColor).lerp(new THREE.Color(0xffffff), 0.5);
        for (let k = 0; k < 2; k++) {
            const ring = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this.ringTexture,
                color,
                transparent: true,
                opacity: 0.9,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            }));
            ring.position.copy(pos);
            ring.position.z -= 0.02;
            const start = baseSize * (0.5 + k * 0.2);
            ring.scale.set(start, start, 1);
            ring.userData = { t: -k * 0.12, start, end: baseSize * (2.8 + k * 0.6) };
            this.scene.add(ring);
            this.shockwaves.push(ring);
        }
    }

    updateShockwaves(deltaSec) {
        if (!this.shockwaves) return;
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const r = this.shockwaves[i];
            r.userData.t += deltaSec * 2.4;
            const t = r.userData.t;
            if (t < 0) continue;
            if (t >= 1) {
                this.scene.remove(r);
                r.material.dispose();
                this.shockwaves.splice(i, 1);
                continue;
            }
            const ease = 1 - Math.pow(1 - t, 2);
            const sz = r.userData.start + (r.userData.end - r.userData.start) * ease;
            r.scale.set(sz, sz, 1);
            r.material.opacity = 0.9 * (1 - t);
        }
    }

    spawnFlyingParticles(fromPos) {
        const count = this.isMobile ? 8 : 14;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const offsets = [];
        for (let i = 0; i < count; i++) {
            const off = new THREE.Vector3(
                (Math.random() - 0.5) * 1.6,
                (Math.random() - 0.5) * 1.6,
                (Math.random() - 0.5) * 1.6
            );
            offsets.push(off);
            positions[i * 3] = fromPos.x + off.x;
            positions[i * 3 + 1] = fromPos.y + off.y;
            positions[i * 3 + 2] = fromPos.z + off.z;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: this.worldColor.clone(),
            size: 0.28,
            map: this.glowTexture,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const points = new THREE.Points(geo, mat);
        points.userData = { from: fromPos, offsets, progress: 0 };
        this.scene.add(points);
        this.flyingParticles.push(points);
    }

    updateFlyingParticles(deltaSec) {
        if (this.flyingParticles.length === 0) return;
        const target = this.currentVRM
            ? this.currentVRM.scene.position.clone().add(new THREE.Vector3(0, 1.6, 0))
            : new THREE.Vector3(0, 1.5, this.camera.position.z - 11);

        for (let i = this.flyingParticles.length - 1; i >= 0; i--) {
            const p = this.flyingParticles[i];
            p.userData.progress += deltaSec * 0.85;
            const prog = Math.min(1, p.userData.progress);
            const ease = prog * prog * (3 - 2 * prog); // smoothstep
            const posAttr = p.geometry.getAttribute('position');
            const { from, offsets } = p.userData;
            for (let j = 0; j < offsets.length; j++) {
                const off = offsets[j];
                const curl = Math.sin((prog + j * 0.13) * Math.PI * 2) * (1 - ease) * 0.5;
                posAttr.setXYZ(
                    j,
                    from.x + off.x * (1 - ease) + (target.x - from.x) * ease + curl,
                    from.y + off.y * (1 - ease) + (target.y - from.y) * ease + curl * 0.6,
                    from.z + off.z * (1 - ease) + (target.z - from.z) * ease
                );
            }
            posAttr.needsUpdate = true;
            p.material.opacity = prog < 0.85 ? 1 : (1 - prog) / 0.15;

            if (prog >= 1) {
                this.mikuGlowPulse = Math.min(1.5, this.mikuGlowPulse + 0.7); // ミクが受け取って輝く
                this.scene.remove(p);
                p.geometry.dispose();
                p.material.dispose();
                this.flyingParticles.splice(i, 1);
            }
        }
    }

    // =====================================================================
    // 湖の循環: 過去の問い(エコー)
    // =====================================================================
    // 過去にフィナーレで綴った問いを、淡い波紋テキストとして回廊奥から流す。
    // 自分の創作が次のプレイの入力として戻ってくる(ローカル完結の擬似循環)。
    spawnEchoRipple(ripple) {
        if (!ripple || !ripple.text) return;
        const colorStr = ripple.color || this.themeColor;
        const { texture, aspect } = this.createTextTexture(ripple.text, colorStr);
        const material = new THREE.SpriteMaterial({
            map: texture, transparent: true, opacity: 0, depthWrite: false,
            color: new THREE.Color(colorStr).lerp(new THREE.Color(0xffffff), 0.25),
        });
        const sprite = new THREE.Sprite(material);
        const side = (this._echoCursor % 2 === 0) ? -1 : 1;
        const z = this.camera.position.z - 26 - Math.random() * 6;
        const x = side * (3.4 + Math.random() * 1.4);
        const y = 0.4 + Math.random() * 3.4;
        sprite.position.set(x, y, z);
        const height = 1.5 + Math.random() * 0.3;
        sprite.scale.set(height * aspect, height, 1);

        // 「過去の問い」を象徴する淡い光輪
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.glowTexture, color: new THREE.Color(colorStr),
            transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        halo.scale.set(height * aspect * 1.5, height * 2.4, 1);
        halo.position.copy(sprite.position);
        halo.renderOrder = -1;
        this.scene.add(halo);
        this.scene.add(sprite);

        this.echoRipples.push({
            sprite, halo, color: colorStr,
            baseW: height * aspect, baseH: height,
            ph: Math.random() * 6.28, resonated: false, life: 0, text: ripple.text,
        });
    }

    updateEchoes(deltaSec, now) {
        // 出すタイミング: 選択/フィナーレ/チュートリアル中は出さない。
        // 過去の問いがあれば一定間隔で1つずつ、画面に最大3つまで。
        if (!this.choiceActive && !this.finaleActive && !this.isTutorialActive
            && this.pastRipples.length > 0 && this.echoRipples.length < 3) {
            this._echoTimer -= deltaSec * 1000;
            if (this._echoTimer <= 0) {
                const r = this.pastRipples[this._echoCursor % this.pastRipples.length];
                this._echoCursor++;
                this.spawnEchoRipple(r);
                this._echoTimer = 9000 + Math.random() * 6000;
            }
        }

        for (let i = this.echoRipples.length - 1; i >= 0; i--) {
            const e = this.echoRipples[i];
            e.life += deltaSec;
            // ゆっくり手前へ漂い、上下に揺れる
            e.sprite.position.z += deltaSec * 1.1;
            e.sprite.position.y += Math.sin(now * 0.0012 + e.ph) * 0.004;
            e.halo.position.copy(e.sprite.position);

            const breathe = 0.5 + 0.5 * Math.sin(now * 0.0025 + e.ph);
            const baseOp = e.resonated ? 0.85 : 0.42;       // 応えると明るく
            const fadeIn = Math.min(1, e.life / 1.2);
            let op = baseOp * fadeIn;
            const distToCam = e.sprite.position.z - this.camera.position.z;
            if (distToCam > -5) op *= Math.max(0, (-distToCam) / 5); // 近づくと消える
            e.sprite.material.opacity = op;
            e.halo.material.opacity = (e.resonated ? 0.35 : 0.16) * fadeIn * (0.7 + breathe * 0.3);

            if (e.sprite.position.z > this.camera.position.z - 2) {
                this.scene.remove(e.sprite);
                if (e.sprite.material.map) e.sprite.material.map.dispose();
                e.sprite.material.dispose();
                this.scene.remove(e.halo); e.halo.material.dispose();
                this.echoRipples.splice(i, 1);
            }
        }
    }

    _pickEcho(clientX, clientY) {
        if (this.echoRipples.length === 0) return null;
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        const v = new THREE.Vector3();
        let best = null, bestD = Infinity;
        const threshold = Math.max(90, window.innerWidth * 0.09);
        for (const e of this.echoRipples) {
            if (e.resonated) continue;
            v.copy(e.sprite.position).project(this.camera);
            if (v.z >= 1) continue;
            const x = v.x * widthHalf + widthHalf;
            const y = -v.y * heightHalf + heightHalf;
            const d = Math.hypot(clientX - x, clientY - y);
            if (d < threshold && d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    resonateEcho(echo, clientX, clientY) {
        echo.resonated = true;
        echo.life = Math.min(echo.life, 0.3);
        this.answeredEchoes++;
        // 手応え: 衝撃波 + ミクへ光の粒 + 表情がほころぶ
        this.spawnShockwave(echo.sprite.position.clone(), Math.max(echo.baseW, echo.baseH) * 1.4);
        this.spawnFlyingParticles(echo.sprite.position.clone());
        this._contactJoy = 0.9;
        // 「過去の問いに応えた」ことを伝える小さな浮遊ラベル
        const tag = document.createElement('div');
        tag.className = 'kotaete-echo-tag';
        tag.textContent = '過去の問いに、応えた';
        tag.style.left = `${clientX}px`;
        tag.style.top = `${clientY}px`;
        tag.style.color = echo.color;
        this.songWrapper.appendChild(tag);
        this._domTimers.push(setTimeout(() => { if (tag.parentNode) tag.parentNode.removeChild(tag); }, 1600));
    }

    // 湖に積もった問いの数を再集計してUIへ反映
    updateLakeCount() {
        this.lakeCount = getRipples({ songId: 'kotaete', type: 'question' }).length;
        if (this.lakeCountEl) {
            this.lakeCountEl.textContent = this.lakeCount > 0 ? `湖の問い ${this.lakeCount}` : '';
            this.lakeCountEl.style.opacity = this.lakeCount > 0 ? '1' : '0';
        }
    }

    // =====================================================================
    // フィナーレの「問いを書く」 — 創作を湖へ流す
    // =====================================================================
    showAskPanel(answerHex) {
        if (this.askEl) return;
        this.askActive = true;
        const el = document.createElement('div');
        el.className = 'kotaete-ask';
        el.style.setProperty('--kotaete-answer-color', answerHex);
        el.innerHTML = `
            <div class="kotaete-ask-title">この色は、どんな問いへの答え？</div>
            <div class="kotaete-ask-hint">あなたの問いを綴ると、湖に波紋として残る</div>
            <input class="kotaete-ask-input" type="text" maxlength="40" placeholder="あなたの問いを書く…" />
            <div class="kotaete-ask-actions">
                <button class="kotaete-ask-submit">湖に流す</button>
                <button class="kotaete-ask-skip">いまはしない</button>
            </div>
        `;
        this.songWrapper.appendChild(el);
        this.askEl = el;
        const input = el.querySelector('.kotaete-ask-input');
        const doSubmit = () => {
            const text = (input.value || '').trim();
            if (!text) { try { input.focus(); } catch (e) {} return; }
            this.saveUserQuestion(text, answerHex);
            this.closeAskPanel('湖に、あなたの問いが積もった');
        };
        // 入力中のキーがプレイヤー操作(スペース=一時停止等)へ漏れないようにする
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); doSubmit(); }
        });
        el.querySelector('.kotaete-ask-submit').addEventListener('click', doSubmit);
        el.querySelector('.kotaete-ask-skip').addEventListener('click', () => this.closeAskPanel(null));
        this._domTimers.push(setTimeout(() => el.classList.add('visible'), 200));
        this._domTimers.push(setTimeout(() => { try { input.focus(); } catch (e) {} }, 700));
    }

    saveUserQuestion(text, answerHex) {
        this.savedRipple = addRipple({
            songId: 'kotaete', type: 'question', text, color: answerHex,
            meta: { resonance: this.resonanceCount, answeredEchoes: this.answeredEchoes },
        });
        this.updateLakeCount();
        // エンドカードに反映(自分の問いと、湖の堆積数)
        this.setResultSummary({
            accentColor: answerHex,
            swatch: this.finalAnswerColor ? answerHex : null,
            lines: [
                `あなたの問い: 「${text}」`,
                `湖に積もった問い ${this.lakeCount}`,
            ],
        });
    }

    closeAskPanel(message) {
        if (this.askEl) {
            this.askEl.classList.remove('visible');
            const el = this.askEl;
            this.askEl = null;
            this._domTimers.push(setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 600));
        }
        this.askActive = false;
        if (message) {
            const note = document.createElement('div');
            note.className = 'kotaete-ask-note';
            note.textContent = message;
            this.songWrapper.appendChild(note);
            this._domTimers.push(setTimeout(() => note.classList.add('visible'), 60));
            this._domTimers.push(setTimeout(() => note.classList.remove('visible'), 4000));
            this._domTimers.push(setTimeout(() => { if (note.parentNode) note.parentNode.removeChild(note); }, 4800));
        }
    }

    // =====================================================================
    // update ループ
    // =====================================================================
    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;
        if (this.isTutorialActive) { this.currentTime = 0; }

        const position = (playerManager.player && playerManager.player.timer)
            ? playerManager.player.timer.position
            : this.getSmoothedTime();

        const now = performance.now();
        const deltaSec = Math.min(0.1, (now - this._lastFrameReal) / 1000);

        // ---- サビ判定 & 問い ----
        let chorus = null;
        if (typeof playerManager.player.findChorus === 'function') {
            chorus = playerManager.player.findChorus(position);
        }
        const isClimax = !!chorus;
        this.isClimax = isClimax; // updateMiku / spawnText から参照(サビ演出)

        // ---- コード進行で振付け(腕の型)を切替える ----
        // コードが変わるたびに踊りの型を進める。短調(minor)は内省的な型へ寄せる音楽的対応。
        if (typeof playerManager.player.findChord === 'function') {
            const chord = playerManager.player.findChord(position);
            if (chord && chord.index !== this._chordIndex) {
                this._chordIndex = chord.index;
                const minor = /m(?!aj)/i.test(chord.name || '');
                this._danceMove = minor ? 3 : (((this._danceMove || 0) % 3) + 1) % 3;
                this._danceSide = -(this._danceSide || -1); // 片手系の左右交替
            }
            this._chordName = chord ? chord.name : null;
        }

        if (chorus && !this.choiceActive && !this.finaleActive
            && !this.consumedChoruses.has(chorus.startTime)) {
            // 決定木に沿って分岐を提示する。
            //  1回目: 天/地 / 天を選んだら2回目: 昼/夜 / 地ルートはこれ以上分岐しない。
            if (this.path.length === 0) {
                this.consumedChoruses.add(chorus.startTime);
                this.beginFork(this.forkDefs.root);
            } else if (this.path.length === 1 && this.path[0] === 'up') {
                this.consumedChoruses.add(chorus.startTime);
                this.beginFork(this.forkDefs.sky);
            } else if (this.path.length === 1 && this.path[0] === 'down' && !this._descentDeepened) {
                // 地ルートは分岐せず、地底へ向かう降下を一押しする
                this.consumedChoruses.add(chorus.startTime);
                this._descentDeepened = true;
                this.deepenDescent();
            }
        }
        if (chorus) this._lastChorusMs = position;
        // サビが終わって1.5秒以上経っても未選択なら静かに引っ込める(回数は消費)。
        // 分岐中(forkActive)は読まずに選べる演出なので引っ込めず、選ぶまで待つ。
        if (!chorus && this.choiceActive && !this.forkActive
            && this._lastChorusMs !== undefined && position - this._lastChorusMs > 1500) {
            this.dismissChoice(false);
        }

        // ---- ビート脈動 & 小節構造 ----
        let beatPulse = 0;
        if (typeof playerManager.player.findBeat === 'function') {
            const beat = playerManager.player.findBeat(position);
            if (beat && beat.duration > 0) {
                const p = Math.min(1, Math.max(0, (position - beat.startTime) / beat.duration));
                beatPulse = Math.pow(1 - p, 2.2); // 拍頭で跳ねて減衰
                this._beatFrac = p;               // 拍内位相(0=拍頭) 縦バウンス用
                // ダンス用: 小節内の拍位置(1始まり)・拍子・通し拍番号を保持
                this._beatInBar = beat.position || 1;
                this._barLen = beat.length || 4;
                if (beat.index !== this._beatIndex) {
                    this._beatIndex = beat.index;      // 拍が進んだ瞬間
                    this._beatStep = -(this._beatStep || -1); // 体重移動の向きを反転
                    if (this._beatInBar === 1) this._barAccent = 1; // 小節頭でアクセント発火
                }
            }
        }

        // ---- 終盤(ラスト)検出 ----
        const duration = playerManager.player.video.duration || 0;
        if (!this.finaleActive && duration > 0 && position > duration - 16000 && position < duration) {
            this.startFinale();
        }

        // ---- 世界の色を補間して全体へ適用 ----
        // 背景の明るさ・フォグ密度は選んだ世界/到達した湖のプリセットへ補間
        // (色相だけでなく世界観そのものが変わる)。フィナーレも lake プリセットを使う。
        this.worldColor.lerp(this.worldColorTarget, Math.min(1, deltaSec * 1.2));
        this.bgMul += (this.bgMulTarget - this.bgMul) * Math.min(1, deltaSec * 1.2);
        const darkBg = this._scratchColBg.copy(this.worldColor).multiplyScalar(this.bgMul);
        this.scene.background.copy(darkBg);
        this.scene.fog.color.copy(darkBg);
        this.scene.fog.density += (this.fogDensityTarget - this.scene.fog.density) * Math.min(1, deltaSec * 1.2);

        // 湖: フィナーレ中はさざ波立つ水面を更新(カメラ前方へ追従)
        this._updateLake(now);
        this.gridMaterial.color.copy(this.worldColor);
        // フィナーレ／地底ケイブ中は床グリッドを隠し、水面を主役にする
        this.gridMaterial.opacity = (this.finaleActive || this.activeEnvKey === 'cavern')
            ? 0
            : 0.45 + beatPulse * 0.45;
        if (this.starField) {
            this.starField.material.color.copy(this.worldColor);
            this.starField.material.opacity = 0.5 + beatPulse * 0.35;
        }
        if (this.keyLight) {
            this.keyLight.color.copy(this._scratchColKey.set('#ffffff').lerp(this.worldColor, 0.35));
            this.keyLight.intensity = 2.0 + beatPulse * 0.5 + (this.finaleActive ? 1.2 : 0);
        }
        if (this.ambientLight) {
            this.ambientLight.color.copy(this._scratchColAmb.copy(this.worldColor).multiplyScalar(0.5));
        }

        // ---- カメラ前進 + グリッドループ ----
        let speed = isClimax ? 0.15 : 0.05;
        if (this.finaleActive) speed = 0.20;
        this.camera.position.z -= speed;
        // サビは少し見上げる構図(主役を大きく)+ ビートの微かな脈動
        const camYTarget = (isClimax ? 1.65 : 2) + beatPulse * 0.05;
        this.camera.position.y += (camYTarget - this.camera.position.y) * Math.min(1, deltaSec * 2);
        // 分岐で選んだ方向へ一瞬振り向き(縦=見上げ/見下ろし, 横=左右)、その後水平へ戻る
        this.camPitch += (this.camPitchTarget - this.camPitch) * Math.min(1, deltaSec * 2.4);
        this.camYaw += (this.camYawTarget - this.camYaw) * Math.min(1, deltaSec * 2.4);
        this.camera.rotation.x = this.camPitch;
        this.camera.rotation.y = this.camYaw;
        // サビ: 拍でFOVをわずかに詰めるズームパンチ(高揚感)。基準75へ戻る。
        const fovTarget = 75 - (isClimax ? beatPulse * 2.2 : 0);
        if (Math.abs(this.camera.fov - fovTarget) > 0.01) {
            this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, deltaSec * 12);
            this.camera.updateProjectionMatrix();
        }
        this.paths.forEach(line => {
            if (this.camera.position.z - line.position.z < -25) {
                line.position.z -= 50;
            }
        });
        if (this.starField && this.camera.position.z - this.starField.position.z < -70) {
            this.starField.position.z -= 140;
        }

        // ---- 歌詞 ----
        // 歌詞表示は「触れて応える」フレーズ3Dスプライトに一本化。
        // 単語DOM(汎用lyricRenderer)は二重表示で紛らわしいため使わない。
        // 「今どこを歌っているか」は各フレーズ内の歌唱パルス(該当文字の発光)で表現する。
        // 演出ラグ相殺の先読み: フェードイン+奥からの流れ込みで視認が遅れる分、
        // フレーズを startTime より早め(LEAD ms 前)に生成して歌唱と合わせる。
        // サビはカメラが速く流れ込みが短いので先読みを減らす。
        const LEAD = isClimax ? 350 : 750;
        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);
        if (this.lyricRenderer) this.lyricRenderer.update(null);
        const spawnPhrase = playerManager.player.video.findPhrase(position + LEAD);
        if (spawnPhrase && spawnPhrase !== this.lastPhrase && !this.isTutorialActive) {
            this.lastPhrase = spawnPhrase;
            this.spawnText(spawnPhrase, position);
        }

        // 歌詞が「手を振る/手を降る」のフレーズに差し掛かったときだけ振り返って手を振る。
        // 先読みフレーズ(約LEADms先)で検知して、歌唱の瞬間に振り返り動作が合うようにする。
        if (spawnPhrase && spawnPhrase.text && spawnPhrase.startTime !== this._lastGreetPhraseStart
            && !this.choiceActive && !this.finaleActive) {
            const tx = spawnPhrase.text;
            if (tx.includes('手を振') || tx.includes('手を降') || tx.includes('手をふ') || tx.includes('てをふ')) {
                this._lastGreetPhraseStart = spawnPhrase.startTime;
                this.greetActive = true;
                this.greetElapsed = 0;
            }
        }

        // ---- スプライト更新 ----
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const s = this.activeSprites[i];
            const ud = s.userData;

            // 歌唱中の単語パルス
            const isWordActive = word && ud.text && ud.text.includes(word.text)
                              && position >= word.startTime && position <= word.endTime;
            const targetPulse = isWordActive ? 1.0 : 0.0;
            ud.pulseProgress += (targetPulse - ud.pulseProgress) * 0.2;

            // 共鳴フラッシュ(タップ直後の発光・拡大) + ミク接触のきらめき
            ud.resonateFlash = Math.max(0, ud.resonateFlash - deltaSec * 2.2);
            ud.contactFlash = Math.max(0, (ud.contactFlash || 0) - deltaSec * 2.6);
            const flash = ud.resonateFlash + ud.contactFlash;

            // 歌詞がミクを通り抜ける瞬間の反応(1フレーズにつき一度だけ)
            if (this.currentVRM && !ud.passedMiku) {
                const mp = this.currentVRM.scene.position;
                if (Math.abs(s.position.z - mp.z) < 1.3) {
                    const dx = s.position.x - mp.x;
                    const dy = s.position.y - (mp.y + 1.1); // 胸〜頭のあたり
                    if (dx * dx + dy * dy < 1.9 * 1.9) {
                        ud.passedMiku = true;
                        ud.contactFlash = 1.0;                 // 言葉が一瞬きらめく
                        this.mikuGlowPulse = Math.min(1.5, this.mikuGlowPulse + 0.5); // ミクが受け取って輝く
                        this._contactJoy = 0.8;                // 表情がふっとほころぶ
                        // 接触点に小さな波紋ときらめき
                        const cp = new THREE.Vector3(s.position.x, s.position.y, mp.z);
                        this.spawnShockwave(cp, 1.2);
                        this.spawnFlyingParticles(cp);
                    }
                }
            }

            // 応答済みの言葉は「ポップ → 縮んで落ち着いた軌跡」へ変化させ、
            // タップ済みと未タップを一目で区別できるようにする(再タップ防止)
            if (ud.resonated) {
                ud.settle = Math.min(1, (ud.settle || 0) + deltaSec * 1.8);
            }
            const settle = ud.settle || 0;
            const settleScale = 1 - settle * 0.42;            // 1 → 0.58 へ縮む
            const pulseScale = (1.0 + ud.pulseProgress * 0.25 + flash * 0.45) * settleScale;
            let dispW = ud.baseW * pulseScale;
            let dispH = ud.baseH * pulseScale;
            // 毎フレーム、現在の距離での可視幅にクランプ(接近して巨大化→
            // 見切れるのを完全に防ぐ)。横位置も中央へ寄せて枠内に保つ
            const visW = this._visibleWidthAt(s.position.z);
            // 横分割の誘導歌詞は左右へ流すので中央寄せしない
            if (!ud.forkDirX) s.position.x += (0 - s.position.x) * 0.012; // ゆっくり中央寄せ
            const maxW = visW * 0.9 - Math.abs(s.position.x) * 2;
            if (dispW > maxW && maxW > 0.5) {
                const f = maxW / dispW;
                dispW *= f; dispH *= f;
            }
            s.scale.set(dispW, dispH, 1);

            // タップできる合図(未共鳴のみ脈動、共鳴で消える)
            if (ud.halo) {
                ud.halo.position.set(s.position.x, s.position.y, s.position.z - 0.05);
                if (ud.resonated) {
                    ud.halo.material.opacity = Math.max(0, ud.halo.material.opacity - deltaSec * 2.5);
                } else {
                    const breathe = 0.5 + 0.5 * Math.sin(now * 0.004 + ud.haloPulse);
                    ud.halo.material.opacity = (0.18 + breathe * 0.22) * s.material.opacity;
                    const hs = 1.0 + breathe * 0.08;
                    ud.halo.scale.set(dispW * 1.25 * hs, dispH * 2.0 * hs, 1);
                }
            }
            if (ud.ring) {
                ud.ring.position.set(s.position.x, s.position.y - dispH * 0.52, s.position.z - 0.04);
                if (ud.resonated) {
                    ud.ring.material.opacity = Math.max(0, ud.ring.material.opacity - deltaSec * 3.0);
                } else {
                    // 歌唱中の言葉ほど強く速く脈動 = 「今これに触れて」と分かる
                    const sungBoost = ud.pulseProgress;
                    const speed = 0.005 + sungBoost * 0.004;
                    const pulse = 0.5 + 0.5 * Math.sin(now * speed + ud.haloPulse);
                    ud.ring.material.opacity = (0.3 + sungBoost * 0.55 + pulse * 0.2) * s.material.opacity;
                    const grow = 1.0 + pulse * 0.08 + sungBoost * 0.12;
                    ud.ring.scale.set(dispW * 0.92 * grow, dispH * 0.34, 1);
                }
            }

            // 発光色: 歌唱パルスで暖色、共鳴で世界の色に染まる。
            // 分岐の誘導歌詞(forkDir/forkDirX≠0)は枝の色を保つので毎フレームの白寄せはしない。
            const isForkLyric = ud.forkDir || ud.forkDirX;
            if (!isForkLyric) {
                const r = 1.0;
                const g = 1.0 - ud.pulseProgress * 0.4 + flash * 0.2;
                const bch = 1.0 - ud.pulseProgress * 0.2 + flash * 0.3;
                s.material.color.setRGB(r, Math.min(1, g), Math.min(1, bch));
            }
            if (ud.resonated && flash <= 0.01 && !isForkLyric) {
                // 応答済みは世界の色の落ち着いた発光(白寄せを弱め、彩度を残す)
                s.material.color.copy(this.worldColor).lerp(new THREE.Color(0xffffff), 0.3 - settle * 0.1);
            }

            const age = Math.max(0, position - ud.birth);
            // 分岐の誘導歌詞は選択肢の側(上下/左右)へ流れ続ける。
            // それ以外は、応答済みはふわっと上へ昇る軌跡に、未応答はその場で微かに揺れる。
            if (ud.forkDir) {
                s.position.y += deltaSec * ud.forkDir * (1.0 + (ud.resonated ? 0.8 : 0));
            } else if (ud.forkDirX) {
                s.position.x += deltaSec * ud.forkDirX * (1.2 + (ud.resonated ? 0.8 : 0));
            } else if (ud.resonated) {
                s.position.y += deltaSec * (0.6 + settle * 0.8);
            } else {
                s.position.y += Math.sin(position * 0.002) * 0.01;
            }

            if (age < 150) {
                s.material.opacity = age / 150;
            } else if (age > ud.life - 200) {
                s.material.opacity = Math.max(0, (ud.life - age) / 200);
            } else {
                // 応答済みは落ち着いた半透明の軌跡(0.92 → 約0.5)、未応答ははっきり
                s.material.opacity = ud.resonated ? (0.92 - settle * 0.42) : 0.92;
            }

            // カメラに近づきすぎる前に少し早めに撤収(顔面で巨大化するのを防ぐ)
            if (age > ud.life || s.position.z > this.camera.position.z - 3) {
                this.scene.remove(s);
                if (s.material.map) s.material.map.dispose();
                s.material.dispose();
                if (ud.halo) {
                    this.scene.remove(ud.halo);
                    ud.halo.material.dispose();
                }
                if (ud.ring) {
                    this.scene.remove(ud.ring);
                    ud.ring.material.dispose();
                }
                this.activeSprites.splice(i, 1);
            }
        }

        // ---- ミク & 光の粒 ----
        this.updateMiku(position, beatPulse);
        this.updateFlyingParticles(deltaSec);
        this.updateShockwaves(deltaSec);
        this.updateChoiceOrbs(now);
        this.updateFork(now);
        this.updateEnvironment(now, deltaSec);
        this.updateEchoes(deltaSec, now);

        this._lastFrameReal = now;
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // =====================================================================
    // 二股分岐(決定木) — 回廊が二股に分かれ、進む世界を直感で選ぶ
    // config: { axis:'vertical'|'horizontal', pos:{key,preset}, neg:{key,preset} }
    //   vertical:   pos=上(↑) / neg=下(↓)
    //   horizontal: pos=右(→) / neg=左(←)
    // =====================================================================
    beginFork(config) {
        this._forkConfig = config;
        this.forkActive = true;
        this.choiceActive = true; // エコー/挨拶など他演出を抑制(オーブ二択と同じ扱い)
        // ミクが振り返って差し伸べ、「どちらへ?」と問いかける
        this.mikuFacingTarget = 0;
        this.reachBlendTarget = 1;
        if (this.currentVRM && this.currentVRM.springBoneManager) {
            this.currentVRM.springBoneManager.reset();
        }

        const announcement = document.createElement('div');
        announcement.className = 'kotaete-choice-announcement';
        announcement.textContent = config.prompt || '— 道が、ふたつに分かれる —';
        this.songWrapper.appendChild(announcement);
        this._choiceTimers.push(setTimeout(() => { announcement.style.opacity = '1'; }, 80));
        this._choiceTimers.push(setTimeout(() => { announcement.style.opacity = '0'; }, 1700));
        this._choiceTimers.push(setTimeout(() => {
            if (announcement.parentNode) announcement.parentNode.removeChild(announcement);
            if (this.forkActive && this.isActive) this.showForkBranches();
        }, 2300));
    }

    showForkBranches() {
        if (this.fork) this._clearFork();
        const cfg = this._forkConfig;

        // 枝は常に「上向き(+Y)」に組み、軸と方向に応じてZ回転で向きを変える。
        //   vertical pos=上(0) / neg=下(π) , horizontal pos=右(-π/2) / neg=左(+π/2)
        // こうすると上下分割でも左右分割でも同じジオメトリを使い回せる。
        const makeBranch = (side, opt, axis) => {
            const preset = opt.preset;
            const group = new THREE.Group();
            const col = new THREE.Color(preset.color);
            const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0 });

            const enclose = opt.key === 'down';  // 地だけ奥で狭まり閉じていく
            const reach = enclose ? 7.5 : 9.5;
            const open  = enclose ? 0.55 : 1.5;

            const LANES = 5;
            for (let i = -LANES; i <= LANES; i++) {
                const pts = [
                    new THREE.Vector3(i * 1.0, 0.4, -2),
                    new THREE.Vector3(i * 2.4 * open, reach, -26),
                ];
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
            }
            for (let k = 1; k <= 5; k++) {
                const z = -2 - k * 5.0;
                const y = 0.4 + k * (reach / 5);
                const w = (4 + k * 1.4) * (enclose ? Math.max(0.4, 1 - k * 0.13) : 1);
                const pts = [new THREE.Vector3(-w, y, z), new THREE.Vector3(w, y, z)];
                group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
            }
            // 末端の「向こう側」を示す光の帯。スプライト(ビルボード)なので
            // 枝をZ回転(横分割)しても向きが歪まず、常に柔らかな光の帯として見える。
            const horiz = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this.glowTexture,
                color: col.clone().lerp(new THREE.Color(0xffffff), 0.5),
                transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
            }));
            horiz.scale.set(enclose ? 14 : 32, 3.4, 1);
            horiz.position.set(0, reach, -26);
            group.add(horiz);

            // 世界のかたまりを表す大きなグロー
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this.glowTexture, color: col, transparent: true, opacity: 0,
                depthWrite: false, blending: THREE.AdditiveBlending,
            }));
            glow.scale.set(enclose ? 16 : 26, enclose ? 12 : 15, 1);
            glow.position.set(0, 7, -18);
            group.add(glow);

            // 誘導の言葉(概念語を選択肢側へ置く)。スプライトはビルボードなので回転後も正立。
            const { texture, aspect } = this.createTextTexture(preset.label, preset.color);
            const word = new THREE.Sprite(new THREE.SpriteMaterial({
                map: texture, transparent: true, opacity: 0, depthWrite: false,
            }));
            const h = 2.4;
            word.scale.set(h * aspect, h, 1);
            word.position.set(0, 5.8, -13);
            group.add(word);

            // 軸と方向に応じて枝全体をZ回転(上向き→上/下/右/左)
            group.rotation.z = axis === 'vertical'
                ? (side === 'pos' ? 0 : Math.PI)
                : (side === 'pos' ? -Math.PI / 2 : Math.PI / 2);

            this.scene.add(group);
            return { group, mat, glow, horiz, word, side, opt, preset, born: performance.now() };
        };

        this.fork = {
            pos: makeBranch('pos', cfg.pos, cfg.axis),
            neg: makeBranch('neg', cfg.neg, cfg.axis),
            axis: cfg.axis,
        };

        // キーボード対応(縦=↑/↓, 横=→/←)
        this._forkKeyHandler = (e) => {
            if (!this.forkActive || !this.fork) return;
            const ax = this._forkConfig.axis;
            if (ax === 'vertical') {
                if (e.code === 'ArrowUp')   { e.preventDefault(); this.commitFork('pos'); }
                else if (e.code === 'ArrowDown') { e.preventDefault(); this.commitFork('neg'); }
            } else {
                if (e.code === 'ArrowRight') { e.preventDefault(); this.commitFork('pos'); }
                else if (e.code === 'ArrowLeft') { e.preventDefault(); this.commitFork('neg'); }
            }
        };
        document.addEventListener('keydown', this._forkKeyHandler);
    }

    updateFork(now) {
        if (!this.fork) return;
        for (const key of ['pos', 'neg']) {
            const b = this.fork[key];
            if (!b) continue;
            const appear = Math.min(1, (now - b.born) / 600);
            const breathe = 0.5 + 0.5 * Math.sin(now * 0.003 + (key === 'pos' ? 0 : 3.1));
            // カメラは前進し続けるので毎フレーム前方へ追従(回転は維持)
            b.group.position.z = this.camera.position.z;
            b.mat.opacity = 0.9 * appear;
            b.glow.material.opacity = (0.26 + breathe * 0.16) * appear;
            if (b.horiz) b.horiz.material.opacity = (0.5 + breathe * 0.25) * appear;
            b.word.material.opacity = 0.95 * appear;
        }
    }

    commitFork(side) {
        if (!this.forkActive || !this.fork) return;
        sfx.play('kotaete_choice');
        const b = this.fork[side];
        const cfg = this._forkConfig;
        const preset = b.preset;
        this.path.push(b.opt.key);

        // 選んだ世界が世界全体へ流れ込む(色・フォグ密度・背景の明るさ)
        this.worldColorTarget.set(preset.color);
        this.fogDensityTarget = preset.fog;
        this.bgMulTarget = preset.bgMul;

        // 選んだ世界の3D空間背景(雲/太陽/月/洞窟)を出現させる
        if (b.opt.env) this.activateEnvironment(b.opt.env);

        // 選んだ方向へカメラを一瞬振り、900ms後に戻す(=その世界へ進む)
        if (cfg.axis === 'vertical') {
            this.camPitchTarget = side === 'pos' ? 0.20 : -0.20;  // 見上げ/見下ろし
            this._choiceTimers.push(setTimeout(() => { this.camPitchTarget = 0; }, 900));
        } else {
            this.camYawTarget = side === 'pos' ? -0.20 : 0.20;    // 右/左へ振る
            this._choiceTimers.push(setTimeout(() => { this.camYawTarget = 0; }, 900));
        }

        // 手応え: 選んだ枝で弾ける衝撃波 + ミクへ光の粒 + 画面フラッシュ
        const burst = b.glow.getWorldPosition(new THREE.Vector3());
        this.spawnShockwave(burst, 5.0);
        this.spawnFlyingParticles(burst.clone());
        const flash = document.createElement('div');
        flash.className = 'kotaete-choice-flash';
        flash.style.background = preset.color;
        this.songWrapper.appendChild(flash);
        void flash.offsetWidth;
        flash.style.opacity = '0';
        this._domTimers.push(setTimeout(() => { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 1100));

        // パレットに「通った世界」を層として積む(色だけでも記録)
        this.chosenColors.push(preset.color);
        this.addPaletteLayer(preset.color);

        this.choicesMade++;
        this.forkActive = false;
        this.choiceActive = false;

        // ミクは前を向いて再び先導
        this.mikuFacingTarget = Math.PI;
        this.reachBlendTarget = 0;
        if (this.currentVRM && this.currentVRM.springBoneManager) {
            this.currentVRM.springBoneManager.reset();
        }

        if (this._forkKeyHandler) {
            document.removeEventListener('keydown', this._forkKeyHandler);
            this._forkKeyHandler = null;
        }
        this._clearFork();
    }

    _clearFork() {
        if (!this.fork) return;
        for (const key of ['pos', 'neg']) {
            const b = this.fork[key];
            if (!b) continue;
            this.scene.remove(b.group);
            b.group.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (o.material.map) o.material.map.dispose();
                    o.material.dispose();
                }
            });
        }
        this.fork = null;
    }

    // =====================================================================
    // 選択後の3D空間背景(環境) — 選ぶたびに世界そのものが変わる
    // =====================================================================
    activateEnvironment(key) {
        if (this.activeEnvKey === key) return;
        this.activeEnvKey = key;
        // 既存環境はフェードアウトへ
        for (const e of this.environments) e.fadingOut = true;
        const env = this._buildEnvironment(key);
        if (env) this.environments.push(env);
    }

    _buildEnvironment(key) {
        const group = new THREE.Group();
        group.position.z = this.camera.position.z;
        this.scene.add(group);
        const items = [];

        // 雲(ビルボード) — カメラ前方にとどまり、横にゆっくり漂う
        const addCloud = (x, y, zOff, scl, colHex, op, spd) => {
            const m = new THREE.SpriteMaterial({
                map: this.cloudTexture, color: new THREE.Color(colHex),
                transparent: true, opacity: 0, depthWrite: false,
            });
            const s = new THREE.Sprite(m);
            s.scale.set(scl, scl * 0.55, 1);
            s.position.set(x, y, -zOff);
            group.add(s);
            const baseX = x, ph = Math.random() * 6.28;
            items.push({ update: (now, dt, fade) => {
                m.opacity = op * fade;
                s.position.x = baseX + Math.sin(now * 0.00008 * spd + ph) * 5;
            }});
        };
        // 太陽/月などの発光円盤
        const addDisc = (x, y, zOff, scl, colHex, op) => {
            const m = new THREE.SpriteMaterial({
                map: this.glowTexture, color: new THREE.Color(colHex),
                transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const s = new THREE.Sprite(m);
            s.scale.set(scl, scl, 1);
            s.position.set(x, y, -zOff);
            group.add(s);
            items.push({ update: (now, dt, fade) => { m.opacity = op * fade; } });
        };

        if (key === 'sky') {
            for (let i = 0; i < 8; i++) {
                addCloud((Math.random() - 0.5) * 42, 4 + Math.random() * 11, 22 + i * 5,
                    13 + Math.random() * 8, '#eaf6ff', 0.75, 1 + Math.random());
            }
        } else if (key === 'day') {
            // 晴天の湖(光の森): design_drafts「明るい湖」を回廊カメラ枠へ移植
            buildBrightLake(THREE, this, group, items);
        } else if (key === 'night') {
            // 夜空の湖: design_drafts「夜の湖をThree.jsで表現」を移植
            buildNightLake(THREE, this, group, items);
        } else if (key === 'cavern') {
            this._makeCaveScene(group, items);
        } else {
            this.scene.remove(group);
            return null;
        }
        return { group, key, items, fade: 0, fadingOut: false };
    }

    // 夜空: 無数の星の瞬き
    _makeStarBurst(group) {
        const n = this.isMobile ? 140 : 260;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 90;
            pos[i * 3 + 1] = Math.random() * 32;
            pos[i * 3 + 2] = -(10 + Math.random() * 80);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const m = new THREE.PointsMaterial({
            color: 0xffffff, size: 0.22, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const p = new THREE.Points(geo, m);
        group.add(p);
        return { update: (now, dt, fade) => { m.opacity = (0.6 + 0.4 * Math.sin(now * 0.002)) * 0.9 * fade; } };
    }

    // GLSL: 水面のさざ波(高さ場)。design_drafts/こたえての素材 の Cave Water より移植。
    _caveRippleGLSL() {
        return `
          uniform float uTime; uniform float uSpeed; uniform float uActivity;
          float ripple(vec2 p, vec2 c, float wl, float decay, float ph0){
            float d = length(p - c);
            float ph = d / wl - uTime * uSpeed + ph0;
            return sin(ph * 6.28318) * exp(-d * decay);
          }
          float heightFn(vec2 p){
            float h = 0.0;
            h += ripple(p, vec2(-1.0, 2.0), 0.90, 0.07, 0.0) * 0.035;
            h += ripple(p, vec2( 3.0,-1.0), 1.10, 0.06, 1.7) * 0.030;
            h += ripple(p, vec2(-4.0,-3.0), 0.80, 0.08, 3.1) * 0.025;
            h += ripple(p, vec2( 1.0,-5.0), 1.30, 0.05, 0.6) * 0.030;
            h += sin(p.x * 0.70 + uTime * 0.7) * 0.018;
            h += sin(p.y * 0.60 - uTime * 0.6) * 0.018;
            h += sin((p.x + p.y) * 1.60 + uTime * 1.1) * 0.010;
            return h * uActivity;
          }
        `;
    }

    // 地底湖: design_drafts のケイブ・ウォーター背景を移植。
    // 水面(シェーダ)+岩柱+鍾乳石+天井+発光ライティングを、カメラに追従するgroupに構築。
    // ※元コードは固定カメラ(z=9)前提のため、奥行き判定は world.z でなく
    //   ローカルz(プール基準)で行い、進行で破綻しないようにしている。
    _makeCaveScene(group, items) {
        const tint = { shallow: [0.13, 0.62, 0.66], mid: [0.02, 0.26, 0.34], deep: [0.01, 0.05, 0.09], glow: [0.30, 0.88, 0.92] };
        const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
        const uniforms = {
            uTime: { value: 0 }, uSpeed: { value: 0.9 }, uActivity: { value: 1.0 },
            uAmp: { value: 0.05 }, uIntensity: { value: 1.0 }, uOpacity: { value: 0 },
            uShallow: { value: V(tint.shallow) }, uMid: { value: V(tint.mid) },
            uDeep: { value: V(tint.deep) }, uGlow: { value: V(tint.glow) },
        };
        const ripple = this._caveRippleGLSL();
        const waterMat = new THREE.ShaderMaterial({
            uniforms, side: THREE.DoubleSide, transparent: true, depthWrite: false,
            vertexShader: ripple + `
                uniform float uAmp;
                varying vec3 vWorld; varying vec2 vLoc;
                void main(){
                    vLoc = position.xz;
                    vec3 p = position; p.y += heightFn(position.xz) * uAmp;
                    vec4 wp = modelMatrix * vec4(p, 1.0);
                    vWorld = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: ripple + `
                uniform vec3 uShallow; uniform vec3 uMid; uniform vec3 uDeep; uniform vec3 uGlow;
                uniform float uIntensity; uniform float uOpacity;
                varying vec3 vWorld; varying vec2 vLoc;
                float caustic(vec2 uv, float t){
                    vec2 q = uv * 1.35;
                    for(int i=0;i<4;i++){
                        q += vec2(sin(q.y*1.5 + t*0.8 + float(i)), cos(q.x*1.4 - t*0.7 + float(i))) * 0.40;
                    }
                    float a = sin(q.x*2.0) * sin(q.y*2.0);
                    float b = sin(q.x*1.1 + q.y*1.3);
                    float c = abs(a)*0.7 + abs(b)*0.3;
                    float net = clamp(pow(1.0 - c, 4.0), 0.0, 1.0);
                    float d = length(uv - vec2(0.0, -1.5));
                    float rings = (0.5 + 0.5 * sin(d * 5.0 - t * 2.0)) * exp(-d * 0.13);
                    return clamp(net * (0.55 + 0.7 * rings) + rings * 0.22, 0.0, 1.0);
                }
                void main(){
                    vec2 p = vLoc;
                    float e = 0.18;
                    float hx = heightFn(p + vec2(e,0.0)) - heightFn(p - vec2(e,0.0));
                    float hz = heightFn(p + vec2(0.0,e)) - heightFn(p - vec2(0.0,e));
                    vec3 N = normalize(vec3(-hx, 2.0*e, -hz));
                    float near = smoothstep(-9.0, 7.0, vLoc.y);
                    float edge = smoothstep(2.0, 8.5, abs(vLoc.x));
                    float lit = clamp(near * 0.82 + edge * 0.34, 0.0, 1.0);
                    vec2 cuv = p + N.xz * 2.2;
                    float ca = caustic(cuv, uTime * 0.9) * (0.18 + lit);
                    vec3 base = mix(uDeep, uMid, smoothstep(0.0, 0.5, lit));
                    base = mix(base, uShallow, smoothstep(0.45, 1.0, lit));
                    vec3 col = base + uGlow * ca * uIntensity;
                    vec3 Vd = normalize(cameraPosition - vWorld);
                    float fres = pow(1.0 - max(dot(N, Vd), 0.0), 3.0);
                    col = mix(col, vec3(0.05,0.045,0.035), fres * 0.6);
                    vec3 L = normalize(vec3(0.25, 1.0, 0.15));
                    vec3 Hh = normalize(L + Vd);
                    float spec = pow(max(dot(N, Hh), 0.0), 110.0);
                    col += vec3(0.7,0.95,0.85) * spec * 0.35;
                    col = mix(vec3(0.03,0.03,0.035), col, smoothstep(-22.0, -4.0, vLoc.y));
                    gl_FragColor = vec4(col, uOpacity);
                }
            `,
        });
        const seg = this.isMobile ? 110 : 190;
        const waterGeo = new THREE.PlaneGeometry(70, 70, seg, seg);
        waterGeo.rotateX(-Math.PI / 2);
        const water = new THREE.Mesh(waterGeo, waterMat);
        group.add(water);

        // フェード対象(不透明素材・ライト)を集めて1つのupdaterで制御
        const mats = [];   // { mat, base }
        const lights = []; // { light, base }

        const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f5d42, roughness: 1.0, metalness: 0.0, transparent: true, opacity: 0 });
        const ceilMat = new THREE.MeshStandardMaterial({ color: 0x241b12, roughness: 1.0, transparent: true, opacity: 0 });
        const stalMat = new THREE.MeshStandardMaterial({ color: 0x82704f, roughness: 0.95, transparent: true, opacity: 0 });
        mats.push({ mat: rockMat, base: 1 }, { mat: ceilMat, base: 1 }, { mat: stalMat, base: 1 });

        const jitter = (geo, amp) => {
            const pos = geo.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
                const n = Math.sin(x * 3.1 + y * 2.3) * Math.cos(z * 2.7 + y * 1.7);
                const r = 1 + n * amp * 0.5 + (Math.random() - 0.5) * amp;
                pos.setXYZ(i, x * r, y, z * r);
            }
            pos.needsUpdate = true;
            geo.computeVertexNormals();
        };
        const makeMound = (x, z, r, ht) => {
            const g = new THREE.ConeGeometry(r, ht, 26, 6);
            jitter(g, 0.22);
            const m = new THREE.Mesh(g, rockMat);
            m.position.set(x, ht / 2 - 0.15, z);
            group.add(m);
        };
        const makeColumn = (x, z, baseR, baseH, shaftR, topY) => {
            makeMound(x, z, baseR, baseH);
            const sh = topY - (baseH - 0.15);
            const g = new THREE.CylinderGeometry(shaftR, baseR * 0.5, sh, 22, 8);
            jitter(g, 0.16);
            const m = new THREE.Mesh(g, rockMat);
            m.position.set(x, (baseH - 0.15) + sh / 2, z);
            group.add(m);
        };
        makeColumn(4.7, -1.6, 1.75, 1.7, 0.6, 5.4);
        makeColumn(-5.0, 0.4, 1.55, 1.6, 0.5, 5.4);
        makeMound(-2.4, -0.6, 0.95, 1.15);
        makeMound(-3.6, -2.1, 0.70, 0.9);
        makeMound(5.6, -4.0, 0.9, 1.0);

        const ceil = new THREE.Mesh(new THREE.BoxGeometry(60, 1.4, 40), ceilMat);
        ceil.position.set(0, 5.9, -8);
        group.add(ceil);

        const makeStalactite = (x, z, topR, len, seed) => {
            const g = new THREE.CylinderGeometry(topR, topR * 0.04, len, 14, 30, false);
            const pos = g.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
                const ty = (py + len / 2) / len;
                const rr = Math.sqrt(px * px + pz * pz);
                const ang = Math.atan2(pz, px);
                let profile = Math.pow(Math.max(ty, 0.0), 0.55);
                profile *= 1.0
                    + 0.22 * Math.sin(ty * Math.PI * 4.5 + seed)
                    + 0.10 * Math.sin(ang * 5.0 + seed * 1.7)
                    + 0.06 * Math.sin(ty * Math.PI * 13.0 + seed);
                const desired = topR * Math.max(profile, 0.0);
                const f = rr > 1e-4 ? desired / rr : 0.0;
                pos.setXYZ(i, px * f, py, pz * f);
            }
            pos.needsUpdate = true;
            jitter(g, 0.05);
            g.computeVertexNormals();
            const m = new THREE.Mesh(g, stalMat);
            m.position.set(x, 5.4 - len / 2, z);
            m.rotation.y = seed;
            group.add(m);
        };
        const ceilN = this.isMobile ? 24 : 46;
        for (let i = 0; i < ceilN; i++) {
            makeStalactite(-11 + Math.random() * 22, -11 + Math.random() * 8,
                0.12 + Math.random() * 0.30, 0.8 + Math.random() * 2.7, Math.random() * 6.28);
        }
        const curtainN = this.isMobile ? 12 : 22;
        for (let i = 0; i < curtainN; i++) {
            makeStalactite(-10 + Math.random() * 20, -3.6 + Math.random() * 1.4,
                0.10 + Math.random() * 0.18, 0.6 + Math.random() * 1.8, Math.random() * 6.28);
        }

        const amb = new THREE.AmbientLight(0x1a221f, 0); group.add(amb); lights.push({ light: amb, base: 1.1 });
        const key = new THREE.DirectionalLight(0xffe7c4, 0); key.position.set(4, 9, 5); group.add(key); lights.push({ light: key, base: 0.7 });
        const rim = new THREE.DirectionalLight(0x6a7a9a, 0); rim.position.set(-6, 5, -4); group.add(rim); lights.push({ light: rim, base: 0.4 });
        const glow = new THREE.PointLight(0x1ec88a, 0, 16, 1.6); glow.position.set(0, 0.5, 1.5); group.add(glow); lights.push({ light: glow, base: 2.0 });
        const glow2 = new THREE.PointLight(0x16b8c8, 0, 14, 1.8); glow2.position.set(-3, 0.4, -1); group.add(glow2); lights.push({ light: glow2, base: 1.2 });

        // カメラに追従しつつ、水面が床に来るようY=-0.3・前方9へ。元シーンの構図を再現。
        items.push({
            update: (now, dt, fade) => {
                group.position.set(0, -0.3, this.camera.position.z - 9);
                uniforms.uTime.value = now * 0.001;
                uniforms.uOpacity.value = fade;
                for (const m of mats) m.mat.opacity = m.base * fade;
                for (const l of lights) l.light.intensity = l.base * fade;
            },
        });
    }

    updateEnvironment(now, deltaSec) {
        for (let i = this.environments.length - 1; i >= 0; i--) {
            const e = this.environments[i];
            const target = e.fadingOut ? 0 : 1;
            e.fade += (target - e.fade) * Math.min(1, deltaSec * 1.4);
            e.group.position.z = this.camera.position.z;  // 常にカメラ前方へ追従
            for (const it of e.items) it.update(now, deltaSec, e.fade);
            if (e.fadingOut && e.fade < 0.02) {
                this._disposeEnv(e);
                this.environments.splice(i, 1);
            }
        }
    }

    _disposeEnv(e) {
        // item 固有の後始末(シェーダ uniform 内テクスチャ等。traverse では拾えない)
        if (e.items) { for (const it of e.items) { if (it && it.dispose) it.dispose(); } }
        this.scene.remove(e.group);
        e.group.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                // 共有テクスチャ(glow/cloud)は破棄しない
                if (o.material.map && o.material.map !== this.glowTexture && o.material.map !== this.cloudTexture) {
                    o.material.map.dispose();
                }
                o.material.dispose();
            }
        });
    }

    _clearEnvironments() {
        for (const e of this.environments) this._disposeEnv(e);
        this.environments = [];
        this.activeEnvKey = null;
    }

    // 地ルートの第2サビ: 分岐させず、地底湖へ向かう降下を一押しする。
    // カメラを下へ伏せ、世界の色を地底湖(水の藍緑)へ寄せ、フォグを深めて閉塞感を強める。
    deepenDescent() {
        const cav = this.lakePresets.cavern;
        // 地底湖の水の色へ寄せ、奥へ閉じていく(色相だけでなく密度も深まる)
        this.worldColorTarget.lerp(new THREE.Color(cav.color), 0.6);
        this.fogDensityTarget = Math.max(this.fogDensityTarget, cav.fog);
        this.bgMulTarget = Math.min(this.bgMulTarget, cav.bgMul + 0.01);

        // 見下ろす視線(900ms後に水平へ戻す)
        this.camPitchTarget = -0.16;
        this._choiceTimers.push(setTimeout(() => { this.camPitchTarget = 0; }, 1200));

        // ミクが少しこちらを振り返り、下(地底)へ誘う仕草
        this.mikuFacingTarget = Math.PI * 0.5;
        this._choiceTimers.push(setTimeout(() => { this.mikuFacingTarget = Math.PI; }, 1600));

        // 「さらに、地の底へ」の小さな字幕
        const announcement = document.createElement('div');
        announcement.className = 'kotaete-choice-announcement';
        announcement.textContent = '— さらに、地の底へ —';
        this.songWrapper.appendChild(announcement);
        this._choiceTimers.push(setTimeout(() => { announcement.style.opacity = '1'; }, 80));
        this._choiceTimers.push(setTimeout(() => { announcement.style.opacity = '0'; }, 2000));
        this._choiceTimers.push(setTimeout(() => {
            if (announcement.parentNode) announcement.parentNode.removeChild(announcement);
        }, 2600));
    }

    // =====================================================================
    // 問い(選択) — 最大3回
    // =====================================================================
    beginChoice() {
        this.choiceActive = true;
        // ミクが振り返って手を差し伸べる
        this.mikuFacingTarget = 0;
        this.reachBlendTarget = 1;
        if (this.currentVRM && this.currentVRM.springBoneManager) {
            this.currentVRM.springBoneManager.reset();
        }

        const announcement = document.createElement('div');
        announcement.className = 'kotaete-choice-announcement';
        announcement.textContent = `— ${this.choicesMade + 1}つめの問いが届きます —`;
        this.songWrapper.appendChild(announcement);
        this._choiceTimers.push(setTimeout(() => { announcement.style.opacity = '1'; }, 80));
        this._choiceTimers.push(setTimeout(() => { announcement.style.opacity = '0'; }, 1500));
        this._choiceTimers.push(setTimeout(() => {
            if (announcement.parentNode) announcement.parentNode.removeChild(announcement);
            if (this.choiceActive && this.isActive) this.showChoiceButtons();
        }, 2100));
    }

    showChoiceButtons() {
        const round = this.choiceRounds[Math.min(this.choicesMade, this.choiceRounds.length - 1)];

        // 念のため既存オーブ・残ラベルを掃除(シーク等での残留防止)
        if (this.choiceOrbs) this._clearChoiceOrbs();
        this.songWrapper.querySelectorAll('.kotaete-orb-label').forEach(el => el.remove());

        // ミクが左右に差し出す、ワールド内の光るオーブ。これをタップして答える
        this.choiceOrbs = [];
        const baseZ = this.camera.position.z - 9.5;
        const makeOrb = (opt, side) => {
            const color = new THREE.Color(opt.color);
            const group = new THREE.Group();
            group.position.set(side * 3.4, 1.0, baseZ);

            const glow = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this.glowTexture, color, transparent: true, opacity: 0,
                depthWrite: false, blending: THREE.AdditiveBlending,
            }));
            glow.scale.set(4.4, 4.4, 1);
            group.add(glow);

            const core = new THREE.Mesh(
                new THREE.SphereGeometry(0.62, 24, 18),
                new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.35) })
            );
            group.add(core);

            const ring = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this.ringTexture, color: color.clone().lerp(new THREE.Color(0xffffff), 0.5),
                transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
            }));
            ring.scale.set(2.6, 2.6, 1);
            group.add(ring);

            this.scene.add(group);

            // 浮遊ラベル(DOM) — 毎フレーム投影で追従
            const label = document.createElement('div');
            label.className = 'kotaete-orb-label';
            label.style.borderColor = opt.color;
            label.innerHTML = `<span class="orb-main">${opt.main}</span><span class="orb-sub">${opt.sub}</span>`;
            this.songWrapper.appendChild(label);
            this._choiceTimers.push(setTimeout(() => label.classList.add('visible'), 60));

            return { group, glow, core, ring, label, color, opt, side, ph: Math.random() * 6.28, born: performance.now() };
        };
        this.choiceOrbs.push(makeOrb(round.left, -1));
        this.choiceOrbs.push(makeOrb(round.right, 1));

        // キーボード対応(←/→で選ぶ)
        this._choiceKeyHandler = (e) => {
            if (!this.choiceOrbs) return;
            if (e.code === 'ArrowLeft') { e.preventDefault(); this.applyChoice(round.left.color); }
            else if (e.code === 'ArrowRight') { e.preventDefault(); this.applyChoice(round.right.color); }
        };
        document.addEventListener('keydown', this._choiceKeyHandler);
    }

    updateChoiceOrbs(now) {
        if (!this.choiceOrbs) return;
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        const v = new THREE.Vector3();
        for (const orb of this.choiceOrbs) {
            const appear = Math.min(1, (now - orb.born) / 500);
            const breathe = 0.5 + 0.5 * Math.sin(now * 0.004 + orb.ph);
            // カメラは前進し続けるので、毎フレーム前方に追従させ続ける
            orb.group.position.x = orb.side * 3.4;
            orb.group.position.z = this.camera.position.z - 9.5;
            orb.group.position.y = 1.0 + Math.sin(now * 0.002 + orb.ph) * 0.15;
            orb.glow.material.opacity = (0.55 + breathe * 0.3) * appear;
            orb.ring.material.opacity = (0.4 + breathe * 0.35) * appear;
            const rs = 2.6 * (1.0 + breathe * 0.12);
            orb.ring.scale.set(rs, rs, 1);
            const cs = 0.62 * (1.0 + breathe * 0.06) * appear;
            orb.core.scale.set(cs / 0.62, cs / 0.62, cs / 0.62);

            // ラベルをオーブ上に追従
            v.copy(orb.group.position).project(this.camera);
            if (v.z < 1) {
                const x = v.x * widthHalf + widthHalf;
                const y = -v.y * heightHalf + heightHalf;
                orb.label.style.left = `${x}px`;
                orb.label.style.top = `${y + 70}px`;
                orb.label.style.opacity = String(appear);
            }
        }
    }

    // 選択オーブのタップ判定(onPointerDownから優先的に呼ぶ)
    _pickChoiceOrb(clientX, clientY) {
        if (!this.choiceOrbs) return null;
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        const v = new THREE.Vector3();
        let best = null, bestD = Infinity;
        const threshold = Math.max(120, window.innerWidth * 0.12);
        for (const orb of this.choiceOrbs) {
            v.copy(orb.group.position).project(this.camera);
            if (v.z >= 1) continue;
            const x = v.x * widthHalf + widthHalf;
            const y = -v.y * heightHalf + heightHalf;
            const d = Math.hypot(clientX - x, clientY - y);
            if (d < threshold && d < bestD) { bestD = d; best = orb; }
        }
        return best;
    }

    _clearChoiceOrbs() {
        if (!this.choiceOrbs) return;
        for (const orb of this.choiceOrbs) {
            this.scene.remove(orb.group);
            orb.group.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
            if (orb.label && orb.label.parentNode) orb.label.parentNode.removeChild(orb.label);
        }
        this.choiceOrbs = null;
    }

    applyChoice(colorHex) {
        if (!this.choiceActive) return;
        sfx.play('kotaete_choice');

        // 選んだオーブが弾けて世界へ色が広がる(はっきりした手応え)
        if (this.choiceOrbs) {
            const picked = this.choiceOrbs.find(o => o.opt.color === colorHex);
            if (picked) {
                this.spawnShockwave(picked.group.position.clone(), 4.0);
                this.spawnFlyingParticles(picked.group.position.clone());
            }
        }

        this.chosenColors.push(colorHex);
        this.choicesMade++;

        // 世界の色に混色していく(選ぶたび比重を増やす)
        const chosen = new THREE.Color(colorHex);
        const blend = 0.45 + this.choicesMade * 0.1;
        this.worldColorTarget.lerp(chosen, blend);

        // フラッシュ
        const flash = document.createElement('div');
        flash.className = 'kotaete-choice-flash';
        flash.style.background = colorHex;
        this.songWrapper.appendChild(flash);
        void flash.offsetWidth;
        flash.style.opacity = '0';
        this._domTimers.push(setTimeout(() => {
            if (flash.parentNode) flash.parentNode.removeChild(flash);
        }, 1100));

        // パレットに層として積む
        this.addPaletteLayer(colorHex);

        // 3回終えたら「あなたの答えの色」確定
        if (this.choicesMade >= this.maxChoices) {
            const mix = new THREE.Color(0, 0, 0);
            this.chosenColors.forEach(c => mix.add(new THREE.Color(c)));
            mix.multiplyScalar(1 / this.chosenColors.length);
            this.finalAnswerColor = mix;
            this.confirmPalette();
        }

        this.dismissChoice(true);
    }

    dismissChoice(selected) {
        this.choiceActive = false;
        if (!selected) {
            this.choicesMade++; // 未選択でも回数は消費(出しっぱなし防止)
            // 沈黙も答え — パレットにグレーの層として積もる
            const slot = this.paletteSlots[this.choicesMade - 1];
            if (slot) slot.classList.add('filled', 'silent');
            // 全スロット消費時は選んだ色だけで確定
            if (this.choicesMade >= this.maxChoices && this.chosenColors.length > 0 && !this.finalAnswerColor) {
                const mix = new THREE.Color(0, 0, 0);
                this.chosenColors.forEach(c => mix.add(new THREE.Color(c)));
                mix.multiplyScalar(1 / this.chosenColors.length);
                this.finalAnswerColor = mix;
                this.confirmPalette();
            }
        }
        // ミクは前を向いて再び先導
        this.mikuFacingTarget = Math.PI;
        this.reachBlendTarget = 0;
        if (this.currentVRM && this.currentVRM.springBoneManager) {
            this.currentVRM.springBoneManager.reset();
        }

        // 選択オーブとラベルをフェードして撤収
        if (this.choiceOrbs) {
            this.choiceOrbs.forEach(o => { if (o.label) o.label.classList.remove('visible'); });
            const orbs = this.choiceOrbs;
            this.choiceOrbs = null; // タップ判定を即無効化
            this._capturedOrbs = orbs;
            this._choiceTimers.push(setTimeout(() => {
                orbs.forEach(o => {
                    this.scene.remove(o.group);
                    o.group.traverse((ob) => { if (ob.geometry) ob.geometry.dispose(); if (ob.material) ob.material.dispose(); });
                    if (o.label && o.label.parentNode) o.label.parentNode.removeChild(o.label);
                });
                this._capturedOrbs = null;
            }, 500));
        }
        if (this._choiceKeyHandler) {
            document.removeEventListener('keydown', this._choiceKeyHandler);
            this._choiceKeyHandler = null;
        }
    }

    // =====================================================================
    // 答えのパレット UI
    // =====================================================================
    createPaletteUI() {
        this.paletteEl = document.createElement('div');
        this.paletteEl.className = 'kotaete-palette';
        this.paletteEl.innerHTML = `
            <div class="kotaete-palette-label">答えのパレット</div>
            <div class="kotaete-palette-slots"></div>
            <div class="kotaete-palette-swatch"></div>
            <div class="kotaete-palette-resonance">共鳴 0</div>
        `;
        const slotsEl = this.paletteEl.querySelector('.kotaete-palette-slots');
        for (let i = 0; i < this.maxChoices; i++) {
            const slot = document.createElement('div');
            slot.className = 'kotaete-palette-slot';
            slotsEl.appendChild(slot);
            this.paletteSlots.push(slot);
        }
        this.paletteSwatch = this.paletteEl.querySelector('.kotaete-palette-swatch');
        this.paletteResonanceEl = this.paletteEl.querySelector('.kotaete-palette-resonance');
        this.songWrapper.appendChild(this.paletteEl);

        // 絆(共鳴)ゲージ — 右端に縦バーで常設。触れるほど伸びる
        this.bondGaugeMax = 12;
        this.gaugeEl = document.createElement('div');
        this.gaugeEl.className = 'kotaete-gauge';
        this.gaugeEl.innerHTML = `
            <div class="kotaete-gauge-track"><div class="kotaete-gauge-fill"></div></div>
            <div class="kotaete-gauge-label">絆</div>
        `;
        this.gaugeFillEl = this.gaugeEl.querySelector('.kotaete-gauge-fill');
        this.songWrapper.appendChild(this.gaugeEl);
        this._updateGauge();

        // 湖に積もった「問い」の数(過去の自分の創作の堆積)を控えめに表示
        this.lakeCountEl = document.createElement('div');
        this.lakeCountEl.className = 'kotaete-lake-count';
        this.lakeCountEl.style.opacity = '0';
        this.songWrapper.appendChild(this.lakeCountEl);
    }

    _updateGauge() {
        if (!this.gaugeFillEl) return;
        const ratio = Math.min(1, this.resonanceCount / this.bondGaugeMax);
        this.gaugeFillEl.style.height = `${ratio * 100}%`;
        this.gaugeFillEl.style.background = `#${this.worldColor.getHexString()}`;
        this.gaugeFillEl.style.boxShadow = `0 0 12px #${this.worldColor.getHexString()}`;
    }

    addPaletteLayer(colorHex) {
        const slot = this.paletteSlots[this.choicesMade - 1];
        if (slot) {
            slot.style.background = colorHex;
            slot.style.boxShadow = `0 0 10px ${colorHex}`;
            slot.classList.add('filled');
        }
        // 現在の混色をスウォッチに反映
        const mix = new THREE.Color(0, 0, 0);
        this.chosenColors.forEach(c => mix.add(new THREE.Color(c)));
        mix.multiplyScalar(1 / this.chosenColors.length);
        if (this.paletteSwatch) {
            const hex = `#${mix.getHexString()}`;
            this.paletteSwatch.style.background = hex;
            this.paletteSwatch.style.boxShadow = `0 0 14px ${hex}`;
            this.paletteSwatch.classList.add('active');
        }
    }

    confirmPalette() {
        if (!this.paletteEl) return;
        this.paletteEl.classList.add('confirmed');
        const label = this.paletteEl.querySelector('.kotaete-palette-label');
        if (label) label.textContent = 'あなたの答えの色';
    }

    updatePaletteResonance() {
        if (this.paletteResonanceEl) {
            this.paletteResonanceEl.textContent = `共鳴 ${this.resonanceCount}`;
            this.paletteResonanceEl.classList.remove('pop');
            void this.paletteResonanceEl.offsetWidth;
            this.paletteResonanceEl.classList.add('pop');
        }
        this._updateGauge();
    }

    // 決定木の経路から到達する湖を決める。
    //   ['down', ...] → 地底湖 / ['up','night'] → 夜空の湖 / それ以外(up+day等) → 晴天の湖
    _resolveEndingLake() {
        const p = this.path;
        if (p[0] === 'down') return this.lakePresets.cavern;
        if (p[0] === 'up' && p[1] === 'night') return this.lakePresets.starry;
        if (p[0] === 'up') return this.lakePresets.clear;
        return this.lakePresets.clear; // 未選択時のフォールバック
    }

    // 湖を3Dオブジェクトとして構築する:
    // さざ波立つ水面メッシュ + 光源の映り込み(反射の筋) + 水面のきらめき
    // + 地平線の光帯 + 岸/遠景のシルエット。色は到達した湖のプリセット。
    _createLake(lake, envKey) {
        if (this.lake) return;
        const color = new THREE.Color(lake.color);
        const light = color.clone().lerp(new THREE.Color(0xffffff), 0.6);
        const group = new THREE.Group();
        group.position.z = this.camera.position.z;
        this.scene.add(group);
        const items = [];
        const D = 320;          // 湖の奥行き
        const W = 260;          // 湖の幅
        const WY = -2.0;        // 水面の高さ

        // --- 水面メッシュ(頂点を毎フレーム揺らしてさざ波) ---
        // 水際(奥)を明るく・手前を暗くする縦グラデーションを頂点色で与え、
        // 反射する水面らしさを出す。これでフォグと同化せず「水」に見える。
        const geo = new THREE.PlaneGeometry(W, D, 40, 56);
        const pos = geo.attributes.position;
        const nearC = color.clone().multiplyScalar(0.30);            // 手前=深い水(暗)
        const farC = color.clone().lerp(new THREE.Color(0xffffff), 0.55); // 奥(水際)=空の反射(明)
        const colAttr = new Float32Array(pos.count * 3);
        const tmpC = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const ty = (pos.array[i * 3 + 1] + D / 2) / D; // 0=手前 1=奥(水際)
            tmpC.copy(nearC).lerp(farC, Math.pow(ty, 1.5));
            colAttr[i * 3] = tmpC.r; colAttr[i * 3 + 1] = tmpC.g; colAttr[i * 3 + 2] = tmpC.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colAttr, 3));
        const waterMat = new THREE.MeshBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
        });
        const water = new THREE.Mesh(geo, waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.set(0, WY, -D / 2 + 18);
        water.renderOrder = 1;
        group.add(water);
        items.push({ kind: 'water', pos, base: Float32Array.from(pos.array), mat: waterMat });

        // 光源(太陽/月/光蝕)の水面上の位置に合わせて反射の筋を出す
        const streakX = envKey === 'night' ? -7 : envKey === 'day' ? 7 : 0;

        // --- 反射の筋(水面に寝かせた発光帯。奥の光源からこちらへ伸びる) ---
        const streakGeo = new THREE.PlaneGeometry(8, D * 0.9, 1, 24);
        const streakMat = new THREE.MeshBasicMaterial({
            map: this.glowTexture, color: light, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const streak = new THREE.Mesh(streakGeo, streakMat);
        streak.rotation.x = -Math.PI / 2;
        streak.position.set(streakX, WY + 0.03, -D * 0.45);
        streak.renderOrder = 2;
        group.add(streak);
        items.push({ kind: 'streak', mat: streakMat });

        // --- 光源の水面への映り込み(水際に灯る明るい円) ---
        const reflMat = new THREE.SpriteMaterial({
            map: this.glowTexture, color: light, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const refl = new THREE.Sprite(reflMat);
        refl.scale.set(18, 9, 1);
        refl.position.set(streakX, WY + 0.5, -D + 34);
        refl.renderOrder = 3;
        group.add(refl);
        items.push({ kind: 'refl', mat: reflMat });

        // --- 水面のきらめき(光の粒が水面で瞬く) ---
        const gn = this.isMobile ? 70 : 140;
        const gpos = new Float32Array(gn * 3);
        for (let i = 0; i < gn; i++) {
            gpos[i * 3] = (Math.random() - 0.5) * W * 0.8;
            gpos[i * 3 + 1] = WY + 0.05;
            gpos[i * 3 + 2] = -Math.random() * D;
        }
        const ggeo = new THREE.BufferGeometry();
        ggeo.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
        const gmat = new THREE.PointsMaterial({
            color: light, size: 0.5, map: this.glowTexture, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        group.add(new THREE.Points(ggeo, gmat));
        items.push({ kind: 'glints', mat: gmat });

        // --- 水際(水と空/天井の境の明瞭なライン) ---
        // くっきりした明るい細帯。これが無いと水と背景の境が消えて湖に見えない。
        const lineMat = new THREE.MeshBasicMaterial({
            color: light, transparent: true, opacity: 0, depthWrite: false,
        });
        const line = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, 0.9), lineMat);
        line.position.set(0, WY + 0.05, -D + 36);
        line.renderOrder = 2;
        group.add(line);
        items.push({ kind: 'line', mat: lineMat });

        // --- 水際の柔らかな光のにじみ ---
        const horizonMat = new THREE.SpriteMaterial({
            map: this.glowTexture, color: light, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const horizon = new THREE.Sprite(horizonMat);
        horizon.scale.set(140, 10, 1);
        horizon.position.set(0, WY + 1.4, -D + 35);
        group.add(horizon);
        items.push({ kind: 'horizon', mat: horizonMat });

        // --- 岸/遠景のシルエット(空の湖だけ。地底は洞窟壁が縁になる) ---
        if (envKey !== 'cavern') {
            const shoreMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(0x0a0c16), transparent: true, opacity: 0, depthWrite: false,
            });
            const shore = new THREE.Mesh(new THREE.PlaneGeometry(300, 7), shoreMat);
            shore.position.set(0, WY + 1.4, -D + 28);
            group.add(shore);
            items.push({ kind: 'shore', mat: shoreMat });
        }

        this.lake = { group, items, born: performance.now() };
    }

    // 水面のさざ波・反射・きらめきを毎フレーム更新し、カメラ前方へ追従させる
    _updateLake(now) {
        if (!this.lake) return;
        const L = this.lake;
        L.group.position.z = this.camera.position.z;
        const fadeT = Math.min(1, (now - L.born) / 1600);
        const t = now * 0.001;
        for (const it of L.items) {
            if (it.kind === 'water') {
                const { pos, base } = it;
                for (let i = 0; i < pos.count; i++) {
                    const x = base[i * 3], y = base[i * 3 + 1];
                    pos.array[i * 3 + 2] = base[i * 3 + 2]
                        + Math.sin(x * 0.15 + t * 1.3) * 0.18
                        + Math.sin(y * 0.20 + t * 0.9) * 0.14
                        + Math.sin((x + y) * 0.10 + t * 0.6) * 0.10;
                }
                pos.needsUpdate = true;
                it.mat.opacity = 0.95 * fadeT;   // 頂点色のグラデを保つので worldColor で上書きしない
            } else if (it.kind === 'streak') {
                it.mat.opacity = (0.4 + 0.2 * Math.sin(t * 2.2)) * fadeT;
            } else if (it.kind === 'refl') {
                it.mat.opacity = (0.7 + 0.2 * Math.sin(t * 1.7)) * fadeT;
            } else if (it.kind === 'glints') {
                it.mat.opacity = (0.5 + 0.4 * Math.sin(t * 3.0)) * fadeT;
            } else if (it.kind === 'line') {
                it.mat.opacity = 0.9 * fadeT;
            } else if (it.kind === 'horizon') {
                it.mat.opacity = (0.5 + 0.15 * Math.sin(t * 1.1)) * fadeT;
            } else if (it.kind === 'shore') {
                it.mat.opacity = 0.92 * fadeT;
            }
        }
    }

    // =====================================================================
    // フィナーレ: 選んだ経路の果ての「湖」へ辿り着く
    // =====================================================================
    startFinale() {
        this.finaleActive = true;

        // 経路から結末の湖を決定し、世界をその湖のプリセットへ染める
        const lake = this._resolveEndingLake();
        this.endingLake = lake;
        this.worldColorTarget.set(lake.color);
        this.fogDensityTarget = lake.fog;
        this.bgMulTarget = lake.bgMul;
        const hex = lake.color;

        // 湖に対応する3D空間背景を確実に出す(空/夜空/洞窟)
        if (lake.env) this.activateEnvironment(lake.env);

        // 湖を3D構築。地底湖(ケイブ)・晴天/夜空の湖(kotaeteLakes)は
        // それぞれの環境が独自の水面を持つので、汎用の簡易湖は出さない。
        if (lake.env !== 'cavern' && lake.env !== 'day' && lake.env !== 'night') {
            this._createLake(lake, lake.env);
        }
        this.camPitchTarget = -0.12;
        this.camYawTarget = 0;

        // ミクが振り返り、両手を差し伸べて締めくくる
        this.mikuFacingTarget = 0;
        this.reachBlendTarget = 1;
        if (this.currentVRM && this.currentVRM.springBoneManager) {
            this.currentVRM.springBoneManager.reset();
        }

        // パレットの混色(これまで通った世界の色)を「あなたの答えの色」として確定
        if (!this.finalAnswerColor && this.chosenColors.length > 0) {
            const mix = new THREE.Color(0, 0, 0);
            this.chosenColors.forEach(c => mix.add(new THREE.Color(c)));
            mix.multiplyScalar(1 / this.chosenColors.length);
            this.finalAnswerColor = mix;
            this.confirmPalette();
        }

        this.finaleOverlay = document.createElement('div');
        this.finaleOverlay.className = 'kotaete-finale-overlay';
        this.finaleOverlay.style.setProperty('--kotaete-answer-color', hex);
        const resonanceGlow = Math.min(1, 0.45 + this.resonanceCount * 0.07);
        this.finaleOverlay.style.setProperty('--kotaete-finale-glow', resonanceGlow.toFixed(2));
        const resonanceLine = this.resonanceCount > 0
            ? `<div class="kotaete-finale-sub">${this.resonanceCount} つの共鳴とともに辿り着いた</div>`
            : '<div class="kotaete-finale-sub">あなたが選んだ道の果てに</div>';
        this.finaleOverlay.innerHTML = `
            <div class="kotaete-finale-text">${lake.name}</div>
            ${resonanceLine}
        `;
        this.songWrapper.appendChild(this.finaleOverlay);
        this._domTimers.push(setTimeout(() => {
            if (this.finaleOverlay) this.finaleOverlay.classList.add('visible');
        }, 100));

        // エンドカードへ成果を登録
        this.setResultSummary({
            accentColor: hex,
            swatch: hex,
            lines: [
                `${lake.name}に辿り着いた`,
                `歌詞との共鳴 ${this.resonanceCount}`,
            ],
        });

        // 文字入力は廃止。辿り着いた湖を自動で波紋として湖に流す(創作ループは維持)。
        this._autoSaveLakeRipple(lake);
    }

    // 辿り着いた湖を、文字入力なしで自動的に湖memoryへ波紋として残す。
    // これにより「過去のプレイの到達湖が次回エコーとして再来する」循環を保つ。
    _autoSaveLakeRipple(lake) {
        try {
            this.savedRipple = addRipple({
                songId: 'kotaete', type: 'question',
                text: lake.name, color: lake.color,
                meta: { path: this.path.slice(), resonance: this.resonanceCount },
            });
            this.updateLakeCount();
        } catch (e) { /* localStorage不可時は無視 */ }
    }

    // =====================================================================
    // CSS 注入 (kotaete- プレフィックスで名前空間化)
    // =====================================================================
    injectCustomStyles() {
        this.customStyleElement = document.createElement('style');
        this.customStyleElement.innerHTML = `
            .kotaete-resonance-ripple {
                position: absolute;
                width: 14px;
                height: 14px;
                margin-left: -7px;
                margin-top: -7px;
                border: 2px solid #7F77DD;
                border-radius: 50%;
                pointer-events: none;
                z-index: 30;
                animation: kotaete-ripple-expand 0.85s ease-out forwards;
            }
            @keyframes kotaete-ripple-expand {
                0%   { transform: scale(1);   opacity: 0.95; }
                100% { transform: scale(9);   opacity: 0; }
            }
            .kotaete-choice-flash {
                position: absolute;
                inset: 0;
                opacity: 0.5;
                z-index: 40;
                pointer-events: none;
                transition: opacity 1s ease;
            }
            /* オーブに付く浮遊ラベル(ワールド座標から毎フレーム追従) */
            .kotaete-orb-label {
                position: absolute;
                transform: translate(-50%, 0);
                padding: 6px 14px;
                border: 1.5px solid #7F77DD;
                border-radius: 12px;
                background: rgba(6, 6, 20, 0.72);
                backdrop-filter: blur(4px);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 1px;
                pointer-events: none;
                opacity: 0;
                z-index: 30;
                white-space: nowrap;
                transition: opacity 0.4s ease;
            }
            .kotaete-orb-label .orb-main {
                font-size: 16px;
                font-weight: 700;
                color: #fff;
                letter-spacing: 0.04em;
            }
            .kotaete-orb-label .orb-sub {
                font-size: 11px;
                color: rgba(255, 255, 255, 0.72);
            }
            .kotaete-palette-slot.silent {
                background: rgba(150, 150, 165, 0.5) !important;
                box-shadow: none !important;
            }
            /* 絆ゲージ — 左端中央。触れるほど縦に伸びる */
            .kotaete-gauge {
                position: absolute;
                left: 16px;
                top: 50%;
                transform: translateY(-50%);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                z-index: 25;
                pointer-events: none;
            }
            .kotaete-gauge-track {
                width: 8px;
                height: 150px;
                border-radius: 5px;
                background: rgba(255, 255, 255, 0.12);
                overflow: hidden;
                display: flex;
                flex-direction: column-reverse;
            }
            .kotaete-gauge-fill {
                width: 100%;
                height: 0%;
                background: #7F77DD;
                border-radius: 5px;
                transition: height 0.5s cubic-bezier(0.22, 1, 0.36, 1), background 0.6s ease;
            }
            .kotaete-gauge-fill.bump { animation: kotaete-gauge-bump 0.4s ease; }
            @keyframes kotaete-gauge-bump {
                0% { filter: brightness(1); transform: scaleX(1); }
                40% { filter: brightness(2.2); transform: scaleX(1.7); }
                100% { filter: brightness(1); transform: scaleX(1); }
            }
            .kotaete-gauge-label {
                font-size: 11px;
                letter-spacing: 0.1em;
                color: rgba(255, 255, 255, 0.6);
                font-family: 'Noto Serif JP', serif;
            }
            @media (max-width: 600px) {
                .kotaete-gauge { left: 8px; }
                .kotaete-gauge-track { height: 110px; }
            }
            /* 答えのパレット — 上部中央に横並び(右の音量UIと干渉しない) */
            .kotaete-palette {
                position: absolute;
                left: 50%;
                top: 16px;
                transform: translateX(-50%);
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 10px;
                padding: 8px 16px;
                background: rgba(5, 5, 16, 0.55);
                border: 1px solid rgba(127, 119, 221, 0.5);
                border-radius: 20px;
                backdrop-filter: blur(4px);
                z-index: 25;
                pointer-events: none;
                transition: box-shadow 0.8s ease;
            }
            .kotaete-palette .kotaete-palette-slots {
                flex-direction: row;
            }
            .kotaete-palette.confirmed {
                box-shadow: 0 0 22px rgba(255, 255, 255, 0.35);
                animation: kotaete-palette-breathe 2.4s ease-in-out infinite;
            }
            @keyframes kotaete-palette-breathe {
                0%, 100% { transform: translateX(-50%) scale(1); }
                50%      { transform: translateX(-50%) scale(1.05); }
            }
            .kotaete-palette-label {
                font-size: 11px;
                letter-spacing: 2px;
                color: rgba(255, 255, 255, 0.85);
                text-shadow: 0 0 6px rgba(127, 119, 221, 0.9);
                white-space: nowrap;
            }
            .kotaete-palette-slots {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .kotaete-palette-slot {
                width: 18px;
                height: 26px;
                border-radius: 5px;
                border: 1px solid rgba(255, 255, 255, 0.3);
                background: rgba(255, 255, 255, 0.06);
                transition: background 0.6s ease, box-shadow 0.6s ease, transform 0.3s ease;
            }
            .kotaete-palette-slot.filled {
                transform: scale(1.12);
                border-color: rgba(255, 255, 255, 0.7);
            }
            .kotaete-palette-swatch {
                width: 26px;
                height: 26px;
                border-radius: 50%;
                border: 2px solid rgba(255, 255, 255, 0.45);
                background: rgba(255, 255, 255, 0.05);
                transition: background 0.8s ease, box-shadow 0.8s ease;
            }
            .kotaete-palette-swatch.active {
                border-color: rgba(255, 255, 255, 0.9);
            }
            .kotaete-palette-resonance {
                font-size: 10px;
                color: rgba(255, 255, 255, 0.75);
                letter-spacing: 1px;
                white-space: nowrap;
            }
            .kotaete-palette-resonance.pop {
                animation: kotaete-resonance-pop 0.4s ease;
            }
            @keyframes kotaete-resonance-pop {
                0%   { transform: scale(1); }
                40%  { transform: scale(1.35); color: #ffffff; }
                100% { transform: scale(1); }
            }
            .kotaete-finale-overlay {
                position: absolute;
                inset: 0;
                z-index: 35;
                pointer-events: none;
                opacity: 0;
                transition: opacity 3.5s ease;
                background: radial-gradient(ellipse at center,
                    transparent 30%,
                    var(--kotaete-answer-color, #7F77DD) 160%);
                display: flex;
                align-items: flex-end;
                justify-content: center;
            }
            .kotaete-finale-overlay.visible {
                opacity: calc(0.55 + var(--kotaete-finale-glow, 0.45) * 0.45);
            }
            .kotaete-finale-overlay {
                flex-direction: column;
                justify-content: flex-end;
                align-items: center;
            }
            .kotaete-finale-text { margin-bottom: 3vh; }
            .kotaete-finale-sub {
                margin-bottom: 9vh;
                font-size: clamp(11px, 1.8vw, 14px);
                letter-spacing: 4px;
                color: rgba(255, 255, 255, 0.85);
                text-shadow: 0 0 12px var(--kotaete-answer-color, #7F77DD);
                animation: kotaete-finale-rise 4s 0.6s ease-out both;
            }
            .kotaete-finale-text {
                margin-bottom: 12vh;
                font-size: clamp(18px, 3.4vw, 30px);
                font-weight: 700;
                letter-spacing: 6px;
                color: #ffffff;
                text-shadow: 0 0 18px var(--kotaete-answer-color, #7F77DD),
                             0 0 40px var(--kotaete-answer-color, #7F77DD);
                animation: kotaete-finale-rise 4s ease-out forwards;
            }
            @keyframes kotaete-finale-rise {
                0%   { transform: translateY(24px); opacity: 0; }
                100% { transform: translateY(0);    opacity: 1; }
            }
            /* 過去の問いに応えたときの浮遊ラベル */
            .kotaete-echo-tag {
                position: absolute;
                transform: translate(-50%, -50%);
                font-size: 13px;
                font-weight: 700;
                letter-spacing: 2px;
                white-space: nowrap;
                pointer-events: none;
                z-index: 32;
                text-shadow: 0 0 10px currentColor;
                animation: kotaete-echo-tag 1.6s ease-out forwards;
            }
            @keyframes kotaete-echo-tag {
                0%   { opacity: 0; transform: translate(-50%, -40%) scale(0.9); }
                20%  { opacity: 1; }
                100% { opacity: 0; transform: translate(-50%, -160%) scale(1.05); }
            }
            /* 湖に積もった問いの数(常設・控えめ) */
            .kotaete-lake-count {
                position: absolute;
                left: 50%;
                bottom: 84px;
                transform: translateX(-50%);
                font-size: 11px;
                letter-spacing: 3px;
                color: rgba(255, 255, 255, 0.6);
                text-shadow: 0 0 8px rgba(127, 119, 221, 0.7);
                font-family: 'Noto Serif JP', serif;
                pointer-events: none;
                z-index: 25;
                transition: opacity 1s ease;
            }
            /* フィナーレ「問いを書く」パネル */
            .kotaete-ask {
                position: absolute;
                left: 50%;
                bottom: 14vh;
                transform: translate(-50%, 18px);
                width: min(86vw, 460px);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                padding: 22px 24px;
                background: rgba(6, 6, 20, 0.78);
                border: 1px solid var(--kotaete-answer-color, #7F77DD);
                border-radius: 18px;
                backdrop-filter: blur(8px);
                box-shadow: 0 0 34px -6px var(--kotaete-answer-color, #7F77DD);
                z-index: 60;
                opacity: 0;
                transition: opacity 0.8s ease, transform 0.8s ease;
            }
            .kotaete-ask.visible { opacity: 1; transform: translate(-50%, 0); }
            .kotaete-ask-title {
                font-size: clamp(15px, 2.4vw, 19px);
                font-weight: 700;
                letter-spacing: 2px;
                color: #fff;
                text-align: center;
                text-shadow: 0 0 14px var(--kotaete-answer-color, #7F77DD);
            }
            .kotaete-ask-hint {
                font-size: 11px;
                letter-spacing: 1px;
                color: rgba(255, 255, 255, 0.6);
                text-align: center;
            }
            .kotaete-ask-input {
                width: 100%;
                margin-top: 4px;
                padding: 11px 14px;
                font-size: 15px;
                color: #fff;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.35);
                border-radius: 10px;
                outline: none;
                text-align: center;
                transition: border-color 0.3s ease, box-shadow 0.3s ease;
            }
            .kotaete-ask-input:focus {
                border-color: var(--kotaete-answer-color, #7F77DD);
                box-shadow: 0 0 16px -3px var(--kotaete-answer-color, #7F77DD);
            }
            .kotaete-ask-input::placeholder { color: rgba(255, 255, 255, 0.4); }
            .kotaete-ask-actions { display: flex; gap: 12px; margin-top: 2px; }
            .kotaete-ask-submit, .kotaete-ask-skip {
                padding: 9px 22px;
                font-size: 13px;
                letter-spacing: 2px;
                border-radius: 20px;
                cursor: pointer;
                transition: transform 0.2s ease, box-shadow 0.3s ease, background 0.3s ease;
            }
            .kotaete-ask-submit {
                color: #0a0a18;
                font-weight: 700;
                background: var(--kotaete-answer-color, #7F77DD);
                border: none;
                box-shadow: 0 0 18px -4px var(--kotaete-answer-color, #7F77DD);
            }
            .kotaete-ask-submit:hover { transform: translateY(-2px); }
            .kotaete-ask-skip {
                color: rgba(255, 255, 255, 0.75);
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.3);
            }
            .kotaete-ask-skip:hover { background: rgba(255, 255, 255, 0.08); }
            /* 流したあとの確認メッセージ */
            .kotaete-ask-note {
                position: absolute;
                left: 50%;
                bottom: 16vh;
                transform: translateX(-50%);
                font-size: clamp(13px, 2vw, 16px);
                letter-spacing: 4px;
                color: #fff;
                text-shadow: 0 0 14px rgba(127, 119, 221, 0.9);
                pointer-events: none;
                opacity: 0;
                z-index: 60;
                transition: opacity 0.8s ease;
            }
            .kotaete-ask-note.visible { opacity: 1; }
            @media (max-width: 767px) {
                .kotaete-palette { right: 8px; padding: 10px 6px; }
                .kotaete-palette-slot { width: 15px; height: 22px; }
                .kotaete-palette-swatch { width: 22px; height: 22px; }
                .kotaete-lake-count { bottom: 70px; }
                .kotaete-ask { bottom: 10vh; padding: 18px 18px; }
            }
        `;
        document.head.appendChild(this.customStyleElement);
    }

    // =====================================================================
    // resize / destroy
    // =====================================================================
    onResize() {
        if (!this.camera || !this.renderer) return;
        this.isMobile = window.innerWidth < 768;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    disposeVRM(vrm) {
        if (!vrm) return;
        vrm.scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach((m) => {
                    if (m.map) m.map.dispose();
                    m.dispose();
                });
            }
        });
    }

    destroy() {
        if (this._tutorialDismissTimer) clearTimeout(this._tutorialDismissTimer);
        this._choiceTimers.forEach(t => clearTimeout(t));
        this._domTimers.forEach(t => clearTimeout(t));

        window.removeEventListener('resize', this.boundOnResize);
        this.songWrapper.removeEventListener('pointerdown', this.boundOnPointerDown);
        if (this._choiceKeyHandler) {
            document.removeEventListener('keydown', this._choiceKeyHandler);
            this._choiceKeyHandler = null;
        }

        // 歌詞スプライト
        this.activeSprites.forEach(s => {
            this.scene.remove(s);
            if (s.material.map) s.material.map.dispose();
            s.material.dispose();
            if (s.userData.halo) {
                this.scene.remove(s.userData.halo);
                s.userData.halo.material.dispose();
            }
            if (s.userData.ring) {
                this.scene.remove(s.userData.ring);
                s.userData.ring.material.dispose();
            }
        });
        this.activeSprites = [];

        // 飛行パーティクル
        this.flyingParticles.forEach(p => {
            this.scene.remove(p);
            p.geometry.dispose();
            p.material.dispose();
        });
        this.flyingParticles = [];

        // エコー(過去の問い)スプライト
        this.echoRipples.forEach(e => {
            this.scene.remove(e.sprite);
            if (e.sprite.material.map) e.sprite.material.map.dispose();
            e.sprite.material.dispose();
            this.scene.remove(e.halo);
            e.halo.material.dispose();
        });
        this.echoRipples = [];

        // グリッド
        this.paths.forEach(line => {
            this.scene.remove(line);
            line.geometry.dispose();
        });
        if (this.gridMaterial) this.gridMaterial.dispose();
        this.paths = [];

        // 星
        if (this.starField) {
            this.scene.remove(this.starField);
            this.starField.geometry.dispose();
            this.starField.material.dispose();
            this.starField = null;
        }

        // ミク
        if (this.currentVRM) {
            this.scene.remove(this.currentVRM.scene);
            this.disposeVRM(this.currentVRM);
            this.currentVRM = null;
        }
        if (this.mikuGlowSprite) {
            this.scene.remove(this.mikuGlowSprite);
            this.mikuGlowSprite.material.dispose();
            this.mikuGlowSprite = null;
        }
        if (this.glowTexture) {
            this.glowTexture.dispose();
            this.glowTexture = null;
        }
        if (this.ringTexture) {
            this.ringTexture.dispose();
            this.ringTexture = null;
        }
        // 衝撃波・選択オーブ(撤収中のものを含む)を解放
        (this.shockwaves || []).forEach(r => { this.scene.remove(r); r.material.dispose(); });
        this.shockwaves = null;
        const orbSets = [this.choiceOrbs, this._capturedOrbs].filter(Boolean);
        orbSets.forEach(set => set.forEach(o => {
            this.scene.remove(o.group);
            o.group.traverse(ob => { if (ob.geometry) ob.geometry.dispose(); if (ob.material) ob.material.dispose(); });
            if (o.label && o.label.parentNode) o.label.parentNode.removeChild(o.label);
        }));
        this.choiceOrbs = null; this._capturedOrbs = null;

        // 二股分岐の枝とキーハンドラを解放
        this._clearFork();
        if (this._forkKeyHandler) {
            document.removeEventListener('keydown', this._forkKeyHandler);
            this._forkKeyHandler = null;
        }
        // 湖面を解放
        if (this.lakePlane) {
            this.scene.remove(this.lakePlane);
            this.lakePlane.geometry.dispose();
            this.lakePlane.material.dispose();
            this.lakePlane = null;
        }
        // 湖の3Dオブジェクト群を解放
        if (this.lake) {
            this.scene.remove(this.lake.group);
            this.lake.group.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (o.material.map && o.material.map !== this.glowTexture && o.material.map !== this.cloudTexture) o.material.map.dispose();
                    o.material.dispose();
                }
            });
            this.lake = null;
        }
        // 3D空間背景(環境)を解放
        this._clearEnvironments();
        if (this.cloudTexture) { this.cloudTexture.dispose(); this.cloudTexture = null; }

        // DOM
        if (this.choiceContainer && this.choiceContainer.parentNode) {
            this.choiceContainer.parentNode.removeChild(this.choiceContainer);
        }
        if (this.paletteEl && this.paletteEl.parentNode) {
            this.paletteEl.parentNode.removeChild(this.paletteEl);
        }
        if (this.gaugeEl && this.gaugeEl.parentNode) {
            this.gaugeEl.parentNode.removeChild(this.gaugeEl);
        }
        if (this.lakeCountEl && this.lakeCountEl.parentNode) {
            this.lakeCountEl.parentNode.removeChild(this.lakeCountEl);
        }
        if (this.askEl && this.askEl.parentNode) {
            this.askEl.parentNode.removeChild(this.askEl);
        }
        if (this.finaleOverlay && this.finaleOverlay.parentNode) {
            this.finaleOverlay.parentNode.removeChild(this.finaleOverlay);
        }
        if (this.customStyleElement && this.customStyleElement.parentNode) {
            this.customStyleElement.parentNode.removeChild(this.customStyleElement);
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss?.();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        super.destroy();
    }
}
