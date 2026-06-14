import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { addRipple, getRipples } from '../lake/lakeMemory.js';

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

        // ---- 世界の色 ----
        this.worldColor = new THREE.Color(this.themeColor);        // 現在表示中の色(毎フレーム補間)
        this.worldColorTarget = new THREE.Color(this.themeColor);  // 目標色(選択で更新)
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
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050510, 0.016);
        this.scene.background = new THREE.Color(0x050510);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 2, 10);

        this.renderer = new THREE.WebGLRenderer({ antialias: !this.isMobile, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
        if (!this.greetActive && !this.finaleActive) {
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
        const x = (Math.random() - 0.5) * 3.0;
        // サビはミクが正面・手前で主役になるので、歌詞は下方へ退避させ顔/体を隠さない
        const y = this.isClimax
            ? -2.5 + (Math.random() - 0.5) * 1.0
            : 1.4 + (Math.random() - 0.5) * 3.2;
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

        if (chorus && this.choicesMade < this.maxChoices && !this.choiceActive
            && !this.consumedChoruses.has(chorus.startTime)) {
            this.consumedChoruses.add(chorus.startTime);
            this.beginChoice();
        }
        if (chorus) this._lastChorusMs = position;
        // サビが終わって1.5秒以上経っても未選択なら静かに引っ込める(回数は消費)
        if (!chorus && this.choiceActive
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
        this.worldColor.lerp(this.worldColorTarget, Math.min(1, deltaSec * 1.2));
        const darkBg = this.worldColor.clone().multiplyScalar(this.finaleActive ? 0.22 : 0.07);
        this.scene.background.copy(darkBg);
        this.scene.fog.color.copy(darkBg);
        this.scene.fog.density = this.finaleActive ? 0.010 : 0.016;
        this.gridMaterial.color.copy(this.worldColor);
        this.gridMaterial.opacity = 0.45 + beatPulse * 0.45 + (this.finaleActive ? 0.1 : 0);
        if (this.starField) {
            this.starField.material.color.copy(this.worldColor);
            this.starField.material.opacity = 0.5 + beatPulse * 0.35;
        }
        if (this.keyLight) {
            this.keyLight.color.copy(new THREE.Color('#ffffff').lerp(this.worldColor, 0.35));
            this.keyLight.intensity = 2.0 + beatPulse * 0.5 + (this.finaleActive ? 1.2 : 0);
        }
        if (this.ambientLight) {
            this.ambientLight.color.copy(this.worldColor.clone().multiplyScalar(0.5));
        }

        // ---- カメラ前進 + グリッドループ ----
        let speed = isClimax ? 0.15 : 0.05;
        if (this.finaleActive) speed = 0.20;
        this.camera.position.z -= speed;
        // サビは少し見上げる構図(主役を大きく)+ ビートの微かな脈動
        const camYTarget = (isClimax ? 1.65 : 2) + beatPulse * 0.05;
        this.camera.position.y += (camYTarget - this.camera.position.y) * Math.min(1, deltaSec * 2);
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
                    if (Math.hypot(dx, dy) < 1.9) {
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
            s.position.x += (0 - s.position.x) * 0.012; // ゆっくり中央寄せ
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

            // 発光色: 歌唱パルスで暖色、共鳴で世界の色に染まる
            const r = 1.0;
            const g = 1.0 - ud.pulseProgress * 0.4 + flash * 0.2;
            const bch = 1.0 - ud.pulseProgress * 0.2 + flash * 0.3;
            s.material.color.setRGB(r, Math.min(1, g), Math.min(1, bch));
            if (ud.resonated && flash <= 0.01) {
                // 応答済みは世界の色の落ち着いた発光(白寄せを弱め、彩度を残す)
                s.material.color.copy(this.worldColor).lerp(new THREE.Color(0xffffff), 0.3 - settle * 0.1);
            }

            const age = Math.max(0, position - ud.birth);
            // 応答済みはふわっと上へ昇る軌跡に、未応答はその場で微かに揺れる
            if (ud.resonated) {
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
        this.updateEchoes(deltaSec, now);

        this._lastFrameReal = now;
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
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

    // =====================================================================
    // フィナーレ: あなたの答えの色が世界を満たす
    // =====================================================================
    startFinale() {
        this.finaleActive = true;

        // 最後の問いを選ばないまま終盤に入った場合も、選んだ分だけで混色を確定する
        if (!this.finalAnswerColor && this.chosenColors.length > 0) {
            const mix = new THREE.Color(0, 0, 0);
            this.chosenColors.forEach(c => mix.add(new THREE.Color(c)));
            mix.multiplyScalar(1 / this.chosenColors.length);
            this.finalAnswerColor = mix;
            this.confirmPalette();
        }

        // 答えの色(未選択ならテーマ色のまま)へ世界を染める
        if (this.finalAnswerColor) {
            this.worldColorTarget.copy(this.finalAnswerColor);
        }
        // ミクが振り返り、両手を差し伸べて締めくくる
        this.mikuFacingTarget = 0;
        this.reachBlendTarget = 1;
        if (this.currentVRM && this.currentVRM.springBoneManager) {
            this.currentVRM.springBoneManager.reset();
        }

        const hex = this.finalAnswerColor
            ? `#${this.finalAnswerColor.getHexString()}`
            : this.themeColor;

        this.finaleOverlay = document.createElement('div');
        this.finaleOverlay.className = 'kotaete-finale-overlay';
        this.finaleOverlay.style.setProperty('--kotaete-answer-color', hex);
        // 共鳴の還元②: 共鳴数がフィナーレの輝度と文言に反映される
        const resonanceGlow = Math.min(1, 0.45 + this.resonanceCount * 0.07);
        this.finaleOverlay.style.setProperty('--kotaete-finale-glow', resonanceGlow.toFixed(2));
        const resonanceLine = this.resonanceCount > 0
            ? `<div class="kotaete-finale-sub">${this.resonanceCount} つの共鳴とともに</div>`
            : '';
        this.finaleOverlay.innerHTML = `
            <div class="kotaete-finale-text">
                ${this.finalAnswerColor ? 'これが、あなたの答えの色' : 'まだ見ぬ、あなたの答えの色'}
            </div>
            ${resonanceLine}
        `;
        this.songWrapper.appendChild(this.finaleOverlay);
        this._domTimers.push(setTimeout(() => {
            if (this.finaleOverlay) this.finaleOverlay.classList.add('visible');
        }, 100));

        // エンドカードへ成果を登録(問いを書けば saveUserQuestion が上書きする)
        this.setResultSummary({
            accentColor: hex,
            swatch: this.finalAnswerColor ? hex : null,
            lines: [
                this.finalAnswerColor ? 'あなたの答えの色が生まれた' : 'まだ見ぬ、あなたの答えの色',
                `歌詞との共鳴 ${this.resonanceCount}`,
            ],
        });

        // 「問いを立てる」— この色を答えとする問いをユーザーが綴り、湖へ流す。
        // 少し間を置いてから差し出す(色が満ちる演出を見せてから)。
        this._domTimers.push(setTimeout(() => {
            if (this.isActive && this.finaleActive) this.showAskPanel(hex);
        }, 3200));
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
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        super.destroy();
    }
}
