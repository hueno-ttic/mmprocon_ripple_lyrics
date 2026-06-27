import * as THREE from 'three';
import { sfx } from '../core/sfx.js';
import { quality } from '../core/quality.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { settleSpringBones } from '../utils/vrm.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

/**
 * トリツクロジー「水鏡の二重世界」 — issue #30 改修版
 *
 * 冷たい秋〜冬の夜の水辺。画面中央の水面ラインを境に
 *   上＝地上の世界 / 下＝水面（水鏡）の世界。
 * - 月が曲の進行に合わせて天を周回する:
 *     0:00 左から昇る → 上 → 右へ。1:01 あたりで沈むと同時に上下が反転し、
 *     また左から昇る。2:04 あたりで月が水に沈み「本当の自分」を選ぶ選択肢が現れる。
 * - 月は地上の月／水面の月の2つに分かれる。歌詞も地上にだけ昇る句と
 *   水面にだけ逆さに昇る句に分かれ、タップした歌詞の世界の月が満ちていく。
 * - 選んだ側で月が中央から昇りその世界を照らし、選ばなかった自分は
 *   輪郭が揺れて曖昧に薄くなり、光の粒へと溶けて消える。
 *
 * 旧リズムゲーム版は song-tricktology.legacy.js に保存。
 * main.js の TRICKTOLOGY_LEGACY=true で即座に戻せる。
 */

const MAX_RIPPLES = 10;

// ── 月の周回タイムライン（曲頭からの絶対時刻 ms）──
const T_INVERT = 61000;   // 1:01 月が右へ沈み、世界が上下反転
const T_CHOICE = 124000;  // 2:04 月が水に沈み、選択肢が浮かぶ

export class SongTricktology extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // 冷たい水色寄りの寒色パレット
        this.themeColor = '#5fb8e6';     // 氷青（水面・光の基調）
        this.bgColor = 0x041019;         // 深い冬の夜
        this.isMobile = window.innerWidth < 768;

        // ── 二重世界グループ ──
        this.worldGroup = null;   // 反転用の親（Z軸回転）
        this.upperGroup = null;   // 地上の世界（実像のリン）
        this.lowerGroup = null;   // 水面の世界（水鏡のリン）

        // 歌詞スプライト（1句=1世界）
        this.lyrics = [];
        this.lastPhrase = null;
        this._worldToggle = 0;    // 句ごとに地上/水面へ交互配分

        // 水面
        this.water = null;
        this.waterUniforms = null;
        this.surfaceLine = null;
        this.rippleIndex = 0;
        this.waveEnergy = 0;
        this.swapSmooth = 0;

        // VRM
        this.realVRM = null;      // 地上（upperGroup）
        this.mirrorVRM = null;    // 水面（lowerGroup）
        this.realMatCache = [];
        this.mirrorMatCache = [];
        this.mikuZ = -5.0;
        this.mikuScale = this.isMobile ? 3.0 : 3.6;

        // 鏡像の不気味さ（呼吸位相ズレ＋たまにこちらを向く）
        this.gazeWeight = 0;
        this.nextGazeAt = 8 + Math.random() * 6;
        this.gazeUntil = -1;

        // ── 世界反転（タイムライン主導）──
        this.invertCount = 0;     // 反転回数。偶数=地上が上 / 奇数=水面が上
        this.flipProgress = 0;    // 0..invertCount をなめらかに追従
        this.isClimax = false;

        // ── 二つの月（満ち欠け）──
        this.moonGround = null;   // 地上の世界の月
        this.moonWater = null;    // 水面の世界の月
        this.moonR = this.isMobile ? 9 : 12;     // 周回の横半径
        this.moonArcH = this.isMobile ? 7 : 9;   // 天頂の高さ
        this.moonZ = -17;
        this.moonScale = this.isMobile ? 3.2 : 4.0;
        // 現実(ground)と鏡像(water)の月は一つの天秤を奪い合う。
        // balance: 1=現実の月が満月／鏡像は新月、0=その逆。0.5=互いに半月。
        this.balance = 0.5;
        this.tugStep = this.isMobile ? 0.15 : 0.12;        // 1タップで動く満ち欠け量
        this.worldFull = { ground: 0.5, water: 0.5 };      // balance から導出（0..1 満ち）
        this.moonPulse = { ground: 0, water: 0 };
        this.invertFlash = 0;

        // ── 世界の差別化エフェクト（タップで増減し、自然減衰）──
        this.grayPulse = 0;   // 現実の反転歌詞タップ → 一時的に世界がグレーアウト
        this.vividPulse = 0;  // 鏡像の反転歌詞タップ → 一時的に鮮やかな色が戻る
        this.waterLevel = 0;  // 現実の歌詞タップで水面が少しずつ上がる
        this.maxWaterRise = this.isMobile ? 1.4 : 1.8;
        this.crackLevel = 0;  // 曲が進むほど世界に走るヒビ
        this.mirrorAlpha = 0.62; // 鏡像のリンは姿が透ける

        // ── 終盤の選択 ──
        this.choiceShown = false;
        this.worldChosen = null;     // 'ground' | 'water'
        this.chosenSide = null;      // 'upper' | 'lower'（画面上の選んだ側）
        this.collapseStart = -1;
        this.choiceOverlay = null;
        this.captionEl = null;
        this._captionTimer = null;

        // パーティクル
        this.motes = [];
        this.bursts = [];
        this.flashEl = null;

        // 時刻（float32精度対策）
        this._t0 = performance.now();
        this._lastFrameReal = undefined;
        this._ambientRippleAt = 5;

        // 入力
        this.isDragging = false;
        this.lastPointer = new THREE.Vector2();
        this.dragAccum = 0;
        this.lastRippleSpawnReal = 0;
        this.raycaster = new THREE.Raycaster();
        this.waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        this.boundOnResize = this.onResize.bind(this);
        this.boundOnPointerDown = this.onPointerDown.bind(this);
        this.boundOnPointerMove = this.onPointerMove.bind(this);
        this.boundOnPointerUp = this.onPointerUp.bind(this);
    }

    // ───────────────────────── 初期化 ─────────────────────────

    init() {
        this.injectCustomStyles();
        this.initThree();
        this.initWorlds();
        this.initWater();
        this.initStars();
        this.initAmbientShapes();
        this.glowTexture = this.createGlowTexture();
        this.loadMikus();
        this.initMoons();
        this.initHud();

        window.addEventListener('resize', this.boundOnResize);
        this.songWrapper.addEventListener('pointerdown', this.boundOnPointerDown);
        this.songWrapper.addEventListener('pointermove', this.boundOnPointerMove);
        window.addEventListener('pointerup', this.boundOnPointerUp);
        window.addEventListener('pointercancel', this.boundOnPointerUp);

        this.isActive = true;
        super.init();
    }

    relSec() {
        return (performance.now() - this._t0) / 1000;
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.bgColor);
        this.scene.fog = new THREE.FogExp2(this.bgColor, 0.021);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
        this.camera.position.set(0, 1.4, 13);
        // 注意: BaseSong.animate がパララックスで rotation を上書きするため lookAt は使わない

        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        this.renderer.domElement.style.touchAction = 'none';
        this.songWrapper.appendChild(this.renderer.domElement);

        // 寒色の照明（青白い月明かり）
        this.ambientLight = new THREE.AmbientLight(0x355a7a, 1.7);
        this.scene.add(this.ambientLight);
        this.dirLight = new THREE.DirectionalLight(0xddf1ff, 2.3);
        this.dirLight.position.set(2, 6, 10);
        this.scene.add(this.dirLight);
        // 水面世界をほの暗く照らす反射光
        this.mirrorLight = new THREE.DirectionalLight(0x6fc6ee, 0.7);
        this.mirrorLight.position.set(-2, -6, 8);
        this.scene.add(this.mirrorLight);
    }

    initWorlds() {
        this.worldGroup = new THREE.Group();
        this.upperGroup = new THREE.Group();
        this.lowerGroup = new THREE.Group();
        this.worldGroup.add(this.upperGroup);
        this.worldGroup.add(this.lowerGroup);
        this.scene.add(this.worldGroup);
    }

    initWater() {
        const themeC = new THREE.Color(this.themeColor);
        const geometry = new THREE.PlaneGeometry(140, 70, 1, 1);

        const ripples = [];
        for (let i = 0; i < MAX_RIPPLES; i++) {
            ripples.push(new THREE.Vector4(0, 0, -1000, 0));
        }

        this.waterUniforms = {
            uTime: { value: 0 },
            uRipples: { value: ripples },
            uColor: { value: new THREE.Vector3(themeC.r, themeC.g, themeC.b) },
            uSwap: { value: 0 }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.waterUniforms,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            vertexShader: `
                varying vec2 vPos;
                void main() {
                    vPos = position.xy;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec4 uRipples[${MAX_RIPPLES}];
                uniform vec3 uColor;
                uniform float uSwap;
                varying vec2 vPos;
                void main() {
                    float wave = 0.0;
                    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
                        vec4 rp = uRipples[i];
                        float age = uTime - rp.z;
                        if (age > 0.0 && age < 2.8) {
                            float r = age * 7.0;
                            float d = length(vPos - rp.xy);
                            float ring = exp(-pow(d - r, 2.0) * 1.4);
                            wave += rp.w * ring * (1.0 - age / 2.8);
                        }
                    }
                    // 水面の揺らめき（地上と区別するための常時アニメーション）
                    float s1 = sin(vPos.x * 0.7 + uTime * 1.25) * sin(vPos.y * 1.1 - uTime * 0.9);
                    float s2 = sin(vPos.x * 1.9 - uTime * 0.6) * 0.4;
                    float shimmer = s1 + s2;
                    float base = 0.10 + shimmer * 0.035;
                    vec3 col = uColor * (0.92 + wave * 1.2) + vec3(1.0) * (wave * 0.55 + uSwap * 0.15);
                    float alpha = clamp(base + wave * 0.6, 0.0, 0.9);
                    gl_FragColor = vec4(col, alpha);
                }
            `
        });

        this.water = new THREE.Mesh(geometry, material);
        this.water.rotation.x = -Math.PI / 2;
        this.water.position.set(0, 0, -10);
        this.worldGroup.add(this.water);

        // 水面ラインの淡い光（地上／水面の境界を強調）
        const lineGeo = new THREE.PlaneGeometry(120, 0.07);
        const lineMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(this.themeColor).lerp(new THREE.Color('#ffffff'), 0.55),
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.surfaceLine = new THREE.Mesh(lineGeo, lineMat);
        this.surfaceLine.position.set(0, 0, 1.0);
        this.worldGroup.add(this.surfaceLine);
    }

    initStars() {
        const half = this.isMobile ? 250 : 700;
        const positions = new Float32Array(half * 2 * 3);
        for (let i = 0; i < half; i++) {
            const x = (Math.random() - 0.5) * 70;
            const y = 0.5 + Math.random() * 16;
            const z = -8 - Math.random() * 35;
            positions[i * 6 + 0] = x;
            positions[i * 6 + 1] = y;
            positions[i * 6 + 2] = z;
            positions[i * 6 + 3] = x;
            positions[i * 6 + 4] = -y;
            positions[i * 6 + 5] = z;
        }
        this.starGeometry = new THREE.BufferGeometry();
        this.starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.starMaterial = new THREE.PointsMaterial({
            color: new THREE.Color('#bfe6ff'),
            size: 0.09,
            transparent: true,
            opacity: 0.55,
            depthWrite: false
        });
        this.stars = new THREE.Points(this.starGeometry, this.starMaterial);
        this.worldGroup.add(this.stars);
    }

    // 上世界に発光ワイヤーフレーム、下世界にその歪んだ鏡像
    initAmbientShapes() {
        this.ambientShapes = [];
        const count = this.isMobile ? 5 : 8;
        const geos = [
            new THREE.IcosahedronGeometry(0.55, 0),
            new THREE.OctahedronGeometry(0.6, 0),
            new THREE.TorusGeometry(0.5, 0.12, 6, 14),
        ];
        for (let i = 0; i < count; i++) {
            const geo = geos[i % geos.length];
            const upMat = new THREE.MeshBasicMaterial({
                color: 0x7fd4ff, wireframe: true, transparent: true, opacity: 0.32,
            });
            const up = new THREE.Mesh(geo, upMat);
            const x = (Math.random() - 0.5) * 16;
            const y = 1.6 + Math.random() * 3.4;
            const z = -6 - Math.random() * 7;
            up.position.set(x, y, z);
            this.upperGroup.add(up);

            // 鏡像側はくすんだグレーで、現実との差を出す
            const loMat = new THREE.MeshBasicMaterial({
                color: 0x6f7d86, wireframe: true, transparent: true, opacity: 0.18,
            });
            const lo = new THREE.Mesh(geo, loMat);
            lo.position.set(x, -y, z);
            lo.scale.y = -1;
            this.lowerGroup.add(lo);

            this.ambientShapes.push({
                up, lo,
                spinX: (Math.random() - 0.5) * 0.4,
                spinY: (Math.random() - 0.5) * 0.5,
                wrongPhase: Math.random() * Math.PI * 2,
                baseY: y, baseX: x,
            });
        }
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1.0)');
        g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.3)');
        g.addColorStop(1, 'rgba(255,255,255,0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    }

    // ───────────────────────── VRM 2体（鏡音リン）─────────────────────────

    loadMikus() {
        const loadOne = (onLoaded) => {
            const loader = new GLTFLoader();
            loader.register((parser) => new VRMLoaderPlugin(parser));
            loader.load(
                import.meta.env.BASE_URL + 'assets/models/model_rin.vrm',
                (gltf) => onLoaded(gltf.userData.vrm),
                undefined,
                (err) => console.error('[TRICKTOLOGY] Failed to load VRM:', err)
            );
        };

        // 地上のリン（水面ラインに立つ）
        loadOne((vrm) => {
            if (!this.isActive) { this.disposeVRM(vrm); return; }
            this.realVRM = vrm;
            vrm.scene.position.set(0, 0, this.mikuZ);
            vrm.scene.rotation.y = 0;
            vrm.scene.scale.setScalar(this.mikuScale);
            this.setupRelaxedPose(vrm);
            settleSpringBones(vrm);
            this.cacheMaterials(vrm, this.realMatCache);
            this.upperGroup.add(vrm.scene);
            console.log('[TRICKTOLOGY] Ground Rin loaded.');
        });

        // 水面のリン（逆さま・薄暗い・呼吸位相ズレ）。
        // スマホでも本物の水鏡リンを映すため2体目のVRMを必ずロードする。
        loadOne((vrm) => {
            if (!this.isActive) { this.disposeVRM(vrm); return; }
            this.mirrorVRM = vrm;
            vrm.scene.position.set(0, 0, this.mikuZ);
            vrm.scene.rotation.y = 0;
            vrm.scene.rotation.z = Math.PI;
            vrm.scene.scale.setScalar(this.mikuScale);
            this.setupRelaxedPose(vrm);
            settleSpringBones(vrm);
            this.cacheMaterials(vrm, this.mirrorMatCache);
            this.lowerGroup.add(vrm.scene);
            console.log('[TRICKTOLOGY] Water Rin loaded.');
        });
    }

    cacheMaterials(vrm, cache) {
        vrm.scene.traverse((obj) => {
            if (!obj.material) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => {
                if (m.color) {
                    cache.push({ material: m, baseColor: m.color.clone(), baseOpacity: m.opacity, baseTransparent: m.transparent });
                }
            });
        });
    }

    setBrightness(cache, factor) {
        for (let i = 0; i < cache.length; i++) {
            const e = cache[i];
            e.material.color.copy(e.baseColor).multiplyScalar(factor);
        }
    }

    setupRelaxedPose(vrm) {
        if (!vrm || !vrm.humanoid) return;
        const lu = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const ru = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const ll = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rl = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        if (lu) lu.rotation.z = Math.PI / 2.8;
        if (ru) ru.rotation.z = -Math.PI / 2.8;
        if (ll) ll.rotation.y = Math.PI / 12;
        if (rl) rl.rotation.y = -Math.PI / 12;
    }

    // ───────────────────────── 歌詞テクスチャ ─────────────────────────

    measureTextWidth(text, font) {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        ctx.font = font;
        return Math.max(160, Math.ceil(ctx.measureText(text).width) + 60);
    }

    createTextTexture(text, mirrored) {
        const font = 'bold 72px "Inter", "Noto Sans JP", sans-serif';
        const w = this.measureTextWidth(text, font);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (mirrored) {
            // 水面の句: キャンバスを上下反転して鏡文字を焼き込み、氷色の色収差を添える
            ctx.translate(0, 128);
            ctx.scale(1, -1);
            ctx.fillStyle = 'rgba(120, 220, 255, 0.55)';
            ctx.fillText(text, w / 2 - 3, 64);
            ctx.fillStyle = 'rgba(170, 140, 255, 0.5)';
            ctx.fillText(text, w / 2 + 3, 64);
            ctx.fillStyle = 'rgba(225, 245, 255, 0.85)';
            ctx.fillText(text, w / 2, 64);
        } else {
            ctx.shadowColor = this.themeColor;
            ctx.shadowBlur = 18;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, w / 2, 64);
        }
        return { texture: new THREE.CanvasTexture(canvas), aspect: w / 128 };
    }

    // 曲の進行から歌詞の出現パターンを決める
    //   序盤=水面からゆっくり浮かぶ / 中盤=左右から流れてくる /
    //   反転後=上から(逆さ世界は下から)落ちる / 終盤=中央の水面ラインへ集まる
    lyricEntry(position) {
        if (this.choiceShown || position >= T_CHOICE - 14000) return 'gather';
        if (this.invertCount > 0 || position >= T_INVERT) return 'fall';
        if (position >= T_INVERT * 0.45) return 'side';
        return 'rise';
    }

    // 1句を地上 or 水面のどちらか一方の世界に浮かべる
    spawnLyric(phrase, position) {
        const maxLyrics = this.isMobile ? 5 : 7;
        while (this.lyrics.length >= maxLyrics) {
            this.disposeLyric(this.lyrics.shift());
        }
        // 当該パートが終わったらすぐ消えるよう、既存句は素早くフェードへ送る
        for (const ex of this.lyrics) {
            if (!ex.collected) ex.life = Math.min(ex.life, (position - ex.birth) + 260);
        }

        // 句ごとに地上／水面へ交互配分
        const world = (this._worldToggle++ % 2 === 0) ? 'ground' : 'water';
        const mirrored = (world === 'water');
        const sign = mirrored ? -1 : 1;
        const { texture, aspect } = this.createTextTexture(phrase.text, mirrored);

        let scale = 1.1 + Math.random() * 0.3;
        if (aspect > 9) scale *= 9 / aspect;
        scale = Math.max(0.6, scale);

        const entry = this.lyricEntry(position);
        const z = -4 - Math.random() * 4;

        // 最終的な定位置（target）
        let tx = (Math.random() - 0.5) * 9;
        let ty = sign * (1.6 + Math.random() * 2.6);
        // 出現パターンごとの初期オフセット（target からの差分）
        let offX = 0, offY = 0;
        if (entry === 'rise') {
            // 水面ラインからゆっくり浮かぶ（まだ言葉が沈んでいる）
            ty = sign * (1.2 + Math.random() * 1.8);
            offY = sign * -(2.4 + Math.random() * 1.2);
        } else if (entry === 'side') {
            // 左右から流れ込む（現実と鏡像が引っ張り合う）
            const fromLeft = Math.random() < 0.5;
            tx = (Math.random() - 0.5) * 5;
            offX = (fromLeft ? -1 : 1) * (11 + Math.random() * 4);
        } else if (entry === 'fall') {
            // 上から（逆さ世界は下から）落ちてくる（重力が壊れた）
            offY = sign * (6 + Math.random() * 3);
        } else { // gather: 中央の水面ラインへ収束していく
            tx = (Math.random() - 0.5) * 3.2;
            ty = sign * (0.5 + Math.random() * 0.9);
            offX = (Math.random() - 0.5) * 12;
            offY = sign * (3.5 + Math.random() * 2.5);
        }

        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(tx + offX, ty + offY, z);
        sprite.scale.set(scale * aspect, scale, 1);
        (mirrored ? this.lowerGroup : this.upperGroup).add(sprite);

        const duration = (phrase.endTime - phrase.startTime) || 2500;
        this.lyrics.push({
            sprite, tex: texture, world, mirrored, entry,
            text: phrase.text,
            birth: position,
            life: duration + 350,   // パート終了後はすぐ消える
            baseScale: scale, aspect,
            baseX: tx, baseY: ty,
            offX0: offX, offY0: offY,   // 初期オフセット
            entryT: 0, entryDur: entry === 'fall' ? 0.55 : 0.85,
            drift: (Math.random() - 0.5) * 0.004,
            pulse: 0,
            collected: false, shatter: false, shatterT: 0,
        });
    }

    disposeLyric(l) {
        if (!l || !l.sprite) return;
        if (l.sprite.parent) l.sprite.parent.remove(l.sprite);
        if (l.sprite.material.map) l.sprite.material.map.dispose();
        l.sprite.material.dispose();
    }

    // ───────────────────────── 入力 ─────────────────────────

    onPointerDown(e) {
        if (this.choiceOverlay) return;
        this.isDragging = true;
        this.lastPointer.set(e.clientX, e.clientY);
        this.dragAccum = 0;

        if (!this.worldChosen) this.handleTap(e.clientX, e.clientY);
        this.spawnRippleAtPointer(e.clientX, e.clientY, 0.4);
    }

    onPointerMove(e) {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.dragAccum += Math.sqrt(dx * dx + dy * dy);
        this.lastPointer.set(e.clientX, e.clientY);

        const now = performance.now();
        if (this.dragAccum > 26 && now - this.lastRippleSpawnReal > 70) {
            this.dragAccum = 0;
            this.lastRippleSpawnReal = now;
            this.spawnRippleAtPointer(e.clientX, e.clientY, 0.6 + Math.random() * 0.3);
        }
    }

    onPointerUp() {
        this.isDragging = false;
    }

    spawnRippleAtPointer(clientX, clientY, amp) {
        if (!this.camera || !this.water) return;
        const ndc = new THREE.Vector2(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const hit = new THREE.Vector3();
        if (!this.raycaster.ray.intersectPlane(this.waterPlane, hit)) {
            hit.set(ndc.x * 10, 0, -4);
        }
        const local = this.water.worldToLocal(hit.clone());
        this.addRipple(local.x, local.y, amp);
    }

    addRipple(lx, ly, amp) {
        const ripples = this.waterUniforms.uRipples.value;
        const v = ripples[this.rippleIndex % MAX_RIPPLES];
        v.set(lx, ly, this.relSec(), amp);
        this.rippleIndex++;
        this.waveEnergy = Math.min(1.4, this.waveEnergy + amp * 0.34);
    }

    // ───────────────── 歌詞タップ → その世界の月が満ちる ─────────────────

    handleTap(clientX, clientY) {
        const hit = this.pickLyric(clientX, clientY);
        if (hit) {
            this.collectLyric(hit);
        }
        this.waveEnergy = Math.min(1.4, this.waveEnergy + 0.12);
    }

    pickLyric(clientX, clientY) {
        if (!this.camera) return null;
        const cand = this.lyrics.filter((l) => !l.collected && !l.shatter);
        if (!cand.length) return null;

        const ndc = new THREE.Vector2(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const hits = this.raycaster.intersectObjects(cand.map(c => c.sprite), false);
        if (hits.length) {
            return cand.find(c => c.sprite === hits[0].object) || null;
        }
        // 画面上の最近傍（指は大まかでも拾える）
        let best = null, bestD = 90;
        const v = new THREE.Vector3();
        for (const c of cand) {
            v.setFromMatrixPosition(c.sprite.matrixWorld).project(this.camera);
            const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
            const d = Math.hypot(sx - clientX, sy - clientY);
            if (d < bestD) { bestD = d; best = c; }
        }
        return best;
    }

    collectLyric(l) {
        l.collected = true;
        l.shatter = true;
        l.shatterT = 0;
        l.pulse = 1;

        // 句の所属世界の月が満ち、もう一方が欠ける
        this.fillMoon(l.world, 1);

        // 月へ収束する光の粒
        const worldPos = new THREE.Vector3().setFromMatrixPosition(l.sprite.matrixWorld);
        this.spawnLightMotes(worldPos, l.world);

        // タップ位置から波紋が広がる
        const local = this.water ? this.water.worldToLocal(worldPos.clone()) : null;
        if (local) this.addRipple(local.x, local.y, 0.9);

        // 反転歌詞タップの世界別演出
        if (l.world === 'ground') {
            // 現実 → 一時的に世界がグレーアウトし、水面が少しだけ上がる
            this.grayPulse = Math.min(1.2, this.grayPulse + 0.7);
            this.waterLevel = Math.min(this.maxWaterRise, this.waterLevel + 0.16);
        } else {
            // 鏡像 → 鮮やかな色が一気に戻る
            this.vividPulse = Math.min(1.2, this.vividPulse + 0.8);
        }
        // 全体に少しずつヒビが走る
        this.crackLevel = Math.min(1, this.crackLevel + 0.04);

        this.waveEnergy = Math.min(1.4, this.waveEnergy + 0.16);
    }

    // ある世界の歌詞をタップ → その世界の月が満ち、もう一方の月が欠ける（天秤）
    fillMoon(world, weight) {
        const dir = (world === 'ground') ? +1 : -1;
        const before = this.balance;
        this.balance = Math.max(0, Math.min(1, this.balance + dir * this.tugStep * weight));
        if (Math.abs(this.balance - before) > 0.0005) {
            this.worldFull.ground = this.balance;
            this.worldFull.water = 1 - this.balance;
            this.redrawMoon('ground');
            this.redrawMoon('water');
        }
        // タップした世界の月が脈動、欠ける側もわずかに反応
        this.moonPulse[world] = Math.min(1.6, this.moonPulse[world] + 0.3);
        const other = world === 'ground' ? 'water' : 'ground';
        this.moonPulse[other] = Math.min(1.6, this.moonPulse[other] + 0.12);
        // 満月に達したらフラッシュ
        const full = (world === 'ground') ? this.balance >= 0.999 : this.balance <= 0.001;
        if (full) {
            this.moonPulse[world] = 1.6;
            this.flashScreen();
        }
    }

    // ───────────────────────── 二つの月 ─────────────────────────

    initMoons() {
        this.moonGroup = new THREE.Group();
        this.scene.add(this.moonGroup); // worldGroupの反転に巻き込まれないようscene直下

        // 現実の月＝従来の青白い月／鏡像の月＝別物としてオレンジに色づける
        this.moonGround = this._makeMoon('#eaf4ff');
        this.moonWater = this._makeMoon('#ffa64d');
        this.moonGroup.add(this.moonGround.root);
        this.moonGroup.add(this.moonWater.root);

        this.redrawMoon('ground');
        this.redrawMoon('water');
    }

    _makeMoon(tint) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);

        const root = new THREE.Group();
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
        const disc = new THREE.Sprite(mat);
        disc.scale.set(this.moonScale, this.moonScale, 1);
        root.add(disc);

        const haloMat = new THREE.SpriteMaterial({
            map: this.glowTexture, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
            color: new THREE.Color(tint)
        });
        const halo = new THREE.Sprite(haloMat);
        halo.scale.set(this.moonScale * 2.4, this.moonScale * 2.4, 1);
        root.add(halo);

        return { root, disc, halo, canvas, ctx, tex, tint };
    }

    // 満ち欠けを描画（phase: 0=新月/不可視, 1=満月）
    redrawMoon(world) {
        const m = world === 'ground' ? this.moonGround : this.moonWater;
        if (!m) return;
        const phase = this.worldFull[world];
        const ctx = m.ctx;
        const S = 256, cx = 128, cy = 128, r = 96;
        ctx.clearRect(0, 0, S, S);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        const base = new THREE.Color(m.tint);
        const g = ctx.createRadialGradient(cx - 26, cy - 26, 12, cx, cy, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.6, `#${base.getHexString()}`);
        g.addColorStop(1, '#7fa9cc');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        // 満ち欠けの影（右から光が満ちる）
        const dx = phase * 2 * r;
        ctx.fillStyle = 'rgba(4,16,25,0.95)';
        ctx.beginPath();
        ctx.arc(cx + dx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        m.tex.needsUpdate = true;
    }

    // 月の周回位置を曲位置から算出
    _moonOrbit(pos) {
        let cycle, start, end;
        if (pos < T_INVERT) { cycle = 0; start = 0; end = T_INVERT; }
        else { cycle = 1; start = T_INVERT; end = T_CHOICE; }
        let p = (pos - start) / (end - start);
        p = Math.max(0, Math.min(1, p));
        const theta = p * Math.PI;
        let x = -Math.cos(theta) * this.moonR;   // 左(-R)→右(+R)
        let yAbs = Math.sin(theta) * this.moonArcH; // 地平から昇り天頂へ
        // 2周目の終盤は中央へ寄って水に沈む
        let sinking = 0;
        if (cycle === 1 && p > 0.8) {
            sinking = (p - 0.8) / 0.2;
            x *= (1 - sinking);
            yAbs = yAbs * (1 - sinking) - sinking * 5;
        }
        return { x, yAbs, cycle, p, sinking };
    }

    updateMoons(t, pos, delta) {
        if (!this.moonGround) return;
        this.moonPulse.ground *= Math.exp(-delta * 2.2);
        this.moonPulse.water *= Math.exp(-delta * 2.2);

        const groundUp = (this.invertCount % 2 === 0);
        const appearG = Math.min(1, 0.25 + this.worldFull.ground);
        const appearW = Math.min(1, 0.25 + this.worldFull.water);

        if (this.worldChosen) {
            // 選択後: 選んだ世界の月が中央から選んだ側へ昇り、世界を照らす
            const riseT = Math.min(1, (t - this.collapseStart) / 3);
            const ease = riseT * riseT * (3 - 2 * riseT);
            const dir = this.chosenSide === 'upper' ? 1 : -1;
            const chosen = this.worldChosen === 'ground' ? this.moonGround : this.moonWater;
            const other = this.worldChosen === 'ground' ? this.moonWater : this.moonGround;
            chosen.root.position.set(0, dir * (this.moonArcH * 0.75) * ease, this.moonZ);
            this._applyMoonLook(chosen, this.worldChosen, 1.0, t);
            other.root.position.set(other.root.position.x, other.root.position.y, this.moonZ);
            this._applyMoonLook(other, this.worldChosen === 'ground' ? 'water' : 'ground', (1 - ease) * 0.4, t);
            return;
        }

        const o = this._moonOrbit(pos);
        const wob = Math.sin(t * 1.6) * 0.15 * (0.4 + this.waveEnergy);

        // 空に出ている方=現在「上」の世界の月。地平を挟んで反射側にもう一方。
        const skyMoon = groundUp ? this.moonGround : this.moonWater;
        const reflMoon = groundUp ? this.moonWater : this.moonGround;
        const skyWorld = groundUp ? 'ground' : 'water';
        const reflWorld = groundUp ? 'water' : 'ground';

        skyMoon.root.position.set(o.x, o.yAbs, this.moonZ);
        reflMoon.root.position.set(o.x + wob, -o.yAbs, this.moonZ);

        this._applyMoonLook(skyMoon, skyWorld, skyWorld === 'ground' ? appearG : appearW, t);
        this._applyMoonLook(reflMoon, reflWorld, (reflWorld === 'ground' ? appearG : appearW) * 0.5, t);
    }

    _applyMoonLook(m, world, appear, t) {
        const pulse = this.moonPulse[world];
        const full = this.worldFull[world] >= 1;
        m.disc.material.opacity = appear;
        const haloBase = 0.2 + this.worldFull[world] * 0.5 + (full ? 0.25 : 0);
        const halo = Math.min(1.1, haloBase + pulse * 0.5) * Math.min(1, appear * 1.4);
        m.halo.material.opacity = halo;
        const hs = this.moonScale * (2.2 + pulse * 0.5 + (full ? 0.4 : 0));
        m.halo.scale.set(hs, hs, 1);
    }

    spawnLightMotes(worldPos, world) {
        let n = this.isMobile ? 9 : 14;
        const m = world === 'ground' ? this.moonGround : this.moonWater;
        const target = m.root.position;
        const start = worldPos.clone();
        const positions = new Float32Array(n * 3);
        const starts = [];
        for (let i = 0; i < n; i++) {
            const jx = (Math.random() - 0.5) * 1.2;
            const jy = (Math.random() - 0.5) * 1.2;
            const jz = (Math.random() - 0.5) * 1.2;
            positions[i * 3] = start.x + jx;
            positions[i * 3 + 1] = start.y + jy;
            positions[i * 3 + 2] = start.z + jz;
            starts.push(new THREE.Vector3(start.x + jx, start.y + jy, start.z + jz));
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: new THREE.Color(world === 'ground' ? '#ffffff' : '#bfeaff'),
            size: 0.26,
            map: this.glowTexture,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
        });
        const pts = new THREE.Points(geo, mat);
        // 月はscene直下なのでworld座標をそのまま終点に使う
        pts.userData = { starts, birth: this.relSec(), life: 0.95, world };
        this.scene.add(pts);
        this.motes.push(pts);
    }

    updateMotes(t, delta) {
        for (let i = this.motes.length - 1; i >= 0; i--) {
            const pts = this.motes[i];
            const age = t - pts.userData.birth;
            const k = Math.min(1, age / pts.userData.life);
            const ease = k * k * (3 - 2 * k);
            const arr = pts.geometry.attributes.position.array;
            const starts = pts.userData.starts;
            const m = pts.userData.world === 'ground' ? this.moonGround : this.moonWater;
            const tgt = m.root.position;
            for (let j = 0; j < starts.length; j++) {
                const s = starts[j];
                arr[j * 3] = s.x + (tgt.x - s.x) * ease;
                arr[j * 3 + 1] = s.y + (tgt.y - s.y) * ease;
                arr[j * 3 + 2] = s.z + (tgt.z - s.z) * ease;
            }
            pts.geometry.attributes.position.needsUpdate = true;
            pts.material.opacity = 1 - ease * ease;
            if (k >= 1) {
                this.scene.remove(pts);
                pts.geometry.dispose();
                pts.material.dispose();
                this.motes.splice(i, 1);
                this.moonPulse[pts.userData.world] = Math.min(1.6, this.moonPulse[pts.userData.world] + 0.12);
            }
        }
    }

    // ───────────────────────── 世界反転（1:01）─────────────────────────

    triggerInversion() {
        this.invertCount++;
        sfx.play('trick_flip');
        this.invertFlash = 1.0;
        this.waveEnergy = 1.4;
        this.swapSmooth = 1;
        this.flashScreen();
        this.addRipple(0, this.mikuZ + 10, 1.2);
        this.spawnCollapseBurst(null, 1);
        if (this.surfaceLine) this.surfaceLine.material.opacity = 1.0;

        const cap = document.createElement('div');
        cap.className = 'tricktology-caption';
        cap.textContent = '水面と地上が——入れ替わる';
        this.songWrapper.appendChild(cap);
        this._invCap = cap;
        requestAnimationFrame(() => cap.classList.add('visible'));
        setTimeout(() => { if (cap.parentNode) cap.classList.remove('visible'); }, 4000);
        setTimeout(() => { if (cap.parentNode) cap.parentNode.removeChild(cap); }, 5600);
    }

    flashScreen() {
        if (!this.flashEl) return;
        this.flashEl.classList.remove('fire');
        void this.flashEl.offsetWidth;
        this.flashEl.classList.add('fire');
    }

    initHud() {
        const flash = document.createElement('div');
        flash.className = 'tricktology-flash';
        this.songWrapper.appendChild(flash);
        this.flashEl = flash;

        // 世界に少しずつ走るヒビ（曲が進むほど濃くなる）
        const cracks = document.createElement('div');
        cracks.className = 'tricktology-cracks';
        this.songWrapper.appendChild(cracks);
        this.crackEl = cracks;
    }

    // ───────────────────────── 終盤の選択UI ─────────────────────────

    injectCustomStyles() {
        this.styleEl = document.createElement('style');
        this.styleEl.textContent = `
            .tricktology-choice-overlay {
                position: absolute; inset: 0; z-index: 50;
                display: flex; flex-direction: column;
                opacity: 0; transition: opacity 1.2s ease;
                font-family: "Inter", "Noto Sans JP", sans-serif;
            }
            .tricktology-choice-overlay.visible { opacity: 1; }
            .tricktology-choice-half {
                flex: 1; display: flex; align-items: center; justify-content: center;
                cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent;
                transition: background 0.4s ease;
            }
            .tricktology-choice-half.upper { background: linear-gradient(to bottom, rgba(95,184,230,0.20), rgba(95,184,230,0.0)); }
            .tricktology-choice-half.lower { background: linear-gradient(to top, rgba(95,184,230,0.20), rgba(95,184,230,0.0)); }
            .tricktology-choice-half:hover { background: rgba(120,206,238,0.16); }
            .tricktology-choice-label {
                color: #fff; font-size: clamp(16px, 3.4vw, 26px); letter-spacing: 0.18em;
                padding: 12px 28px; border: 1px solid rgba(255,255,255,0.55); border-radius: 999px;
                background: rgba(6,20,32,0.45); backdrop-filter: blur(4px);
                text-shadow: 0 0 14px #5fb8e6;
                animation: tricktology-pulse 2.2s ease-in-out infinite;
            }
            .tricktology-choice-half.lower .tricktology-choice-label { transform: scaleY(-1); }
            .tricktology-choice-question {
                position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
                color: #fff; font-size: clamp(14px, 3vw, 22px); letter-spacing: 0.3em;
                pointer-events: none; text-shadow: 0 0 18px #5fb8e6, 0 0 4px #000;
                white-space: nowrap;
            }
            @keyframes tricktology-pulse {
                0%, 100% { box-shadow: 0 0 8px rgba(120,206,238,0.4); }
                50% { box-shadow: 0 0 26px rgba(120,206,238,0.95); }
            }
            .tricktology-caption {
                position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%);
                z-index: 51; color: #fff; font-size: clamp(13px, 2.6vw, 19px);
                letter-spacing: 0.22em; pointer-events: none; white-space: nowrap;
                text-shadow: 0 0 16px #5fb8e6, 0 0 4px #000;
                opacity: 0; transition: opacity 1.4s ease;
                font-family: "Inter", "Noto Sans JP", sans-serif;
            }
            .tricktology-caption.visible { opacity: 1; }
            .tricktology-flash {
                position: absolute; inset: 0; z-index: 45; pointer-events: none;
                opacity: 0; background: radial-gradient(circle at 50% 42%, rgba(170,225,255,0.85), rgba(95,184,230,0.0) 60%);
            }
            .tricktology-flash.fire { animation: tricktology-flash-anim 0.85s ease-out; }
            @keyframes tricktology-flash-anim {
                0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: 0; }
            }
            .tricktology-cracks {
                position: absolute; inset: 0; z-index: 44; pointer-events: none;
                opacity: 0; mix-blend-mode: screen;
                transition: opacity 0.8s linear;
                background-image:
                    linear-gradient(115deg, transparent 49.6%, rgba(210,238,255,0.55) 49.8%, transparent 50.1%),
                    linear-gradient(58deg, transparent 49.6%, rgba(210,238,255,0.4) 49.85%, transparent 50.1%),
                    linear-gradient(150deg, transparent 49.7%, rgba(190,228,255,0.35) 49.9%, transparent 50.15%),
                    linear-gradient(20deg, transparent 49.7%, rgba(190,228,255,0.3) 49.9%, transparent 50.1%);
                background-size: 240px 320px, 320px 260px, 180px 200px, 280px 300px;
                background-position: 20% 30%, 70% 60%, 45% 80%, 85% 15%;
                background-repeat: no-repeat;
            }
        `;
        document.head.appendChild(this.styleEl);
    }

    showChoiceUI() {
        if (this.choiceOverlay || this.worldChosen) return;
        this.choiceShown = true;

        // 月が水に沈む余韻の波紋
        this.addRipple(0, this.mikuZ + 10, 1.0);
        this.waveEnergy = 1.4;

        const overlay = document.createElement('div');
        overlay.className = 'tricktology-choice-overlay';
        overlay.innerHTML = `
            <div class="tricktology-choice-half upper" data-side="upper">
                <span class="tricktology-choice-label">こちらが本物</span>
            </div>
            <div class="tricktology-choice-half lower" data-side="lower">
                <span class="tricktology-choice-label">こちらが本物</span>
            </div>
            <div class="tricktology-choice-question">本物は、どっち？</div>
        `;
        this.songWrapper.appendChild(overlay);
        this.choiceOverlay = overlay;
        requestAnimationFrame(() => overlay.classList.add('visible'));

        overlay.querySelectorAll('.tricktology-choice-half').forEach((el) => {
            el.addEventListener('pointerdown', (ev) => {
                ev.stopPropagation();
                this.chooseWorld(el.dataset.side);
            });
        });
    }

    chooseWorld(side) {
        if (this.worldChosen) return;
        this.chosenSide = side;
        sfx.play('trick_choose');
        const groundUp = (this.invertCount % 2 === 0);
        const upperWorld = groundUp ? 'ground' : 'water';
        const lowerWorld = groundUp ? 'water' : 'ground';
        this.worldChosen = side === 'upper' ? upperWorld : lowerWorld;
        const rejectedWorld = this.worldChosen === 'ground' ? 'water' : 'ground';
        this.collapseStart = this.relSec();

        const worldLabel = (w) => (w === 'ground' ? '地上の世界' : '水面の世界');
        this.setResultSummary({
            accentColor: '#7fd4ff',
            lines: [
                `選んだのは — ${worldLabel(this.worldChosen)}`,
                `地上の月 ${Math.round(this.worldFull.ground * 100)}% ／ 水面の月 ${Math.round(this.worldFull.water * 100)}%`,
                'もう一人のあたしは、光になって溶けた',
            ],
        });

        if (this.choiceOverlay) {
            this.choiceOverlay.classList.remove('visible');
            const el = this.choiceOverlay;
            setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1300);
            this.choiceOverlay = null;
        }

        // 選ばれなかった世界の自分 → 輪郭が揺れ、光の粒へ
        this.dissolveRejected(rejectedWorld);

        const cap = document.createElement('div');
        cap.className = 'tricktology-caption';
        cap.textContent = 'あなたが選んだ世界が、本物になった';
        this.songWrapper.appendChild(cap);
        this.captionEl = cap;
        requestAnimationFrame(() => cap.classList.add('visible'));
        this._captionTimer = setTimeout(() => {
            if (cap.parentNode) cap.classList.remove('visible');
        }, 6500);

        this.addRipple(0, this.mikuZ + 10, 1.2);
        this.waveEnergy = 1.4;
    }

    // 選ばれなかった側のリンを「曖昧に薄く → 光の粒」に溶かす
    dissolveRejected(rejectedWorld) {
        const cache = rejectedWorld === 'ground' ? this.realMatCache : this.mirrorMatCache;
        cache.forEach((e) => { e.material.transparent = true; });
        // 光の粒は少し遅れて湧かせ、薄れていく輪郭から立ち上るように
        const ySign = rejectedWorld === 'ground' ? 1 : -1;
        setTimeout(() => this.spawnCollapseBurst(null, ySign), 900);
        setTimeout(() => this.spawnCollapseBurst(null, ySign), 1700);
    }

    spawnCollapseBurst(group, ySign) {
        const count = this.isMobile ? 160 : 340;
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            const nearMiku = i % 2 === 0;
            const x = nearMiku ? (Math.random() - 0.5) * 2.5 : (Math.random() - 0.5) * 16;
            const y = ySign * (nearMiku ? Math.random() * this.mikuScale * 1.5 : Math.random() * 5);
            const z = this.mikuZ + (Math.random() - 0.5) * (nearMiku ? 1.5 : 8);
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
            velocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * 0.6,
                ySign * (0.3 + Math.random() * 0.8), // 上方へ昇華して消える
                (Math.random() - 0.5) * 0.6
            ));
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: new THREE.Color(this.themeColor).lerp(new THREE.Color('#ffffff'), 0.6),
            size: 0.28,
            map: this.glowTexture,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
        });
        const points = new THREE.Points(geo, mat);
        points.userData = { velocities, birth: this.relSec(), life: 3.2 };
        this.worldGroup.add(points);
        this.bursts.push(points);
    }

    // ───────────────────────── 毎フレーム更新 ─────────────────────────

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        const position = (playerManager.player && playerManager.player.timer)
                         ? playerManager.player.timer.position
                         : this.getSmoothedTime();

        const t = this.relSec();
        const nowReal = performance.now();
        if (this._lastFrameReal === undefined) this._lastFrameReal = nowReal;
        const delta = Math.min(0.033, (nowReal - this._lastFrameReal) / 1000);
        this._lastFrameReal = nowReal;

        // ── 減衰 ──
        this.waveEnergy *= Math.exp(-delta * 1.6);
        this.invertFlash *= Math.exp(-delta * 1.4);
        this.grayPulse *= Math.exp(-delta * 1.5);   // グレーアウトは一時的
        this.vividPulse *= Math.exp(-delta * 1.5);   // 鮮やかさの戻りも一時的
        this.waterLevel *= Math.exp(-delta * 0.25);  // 上がった水面はゆっくり引く

        // 上がった水面を反映（境界ライン＋水面メッシュを少し持ち上げる）
        if (this.surfaceLine) this.surfaceLine.position.y = this.waterLevel;
        if (this.water) this.water.position.y = this.waterLevel;

        // ヒビは曲の進行でもじわじわ濃くなる
        const crackProg = Math.min(1, position / T_CHOICE);
        this.crackLevel = Math.max(this.crackLevel, crackProg * 0.5);
        if (this.crackEl) {
            this.crackEl.style.opacity = (this.crackLevel * 0.55 + this.invertFlash * 0.3).toFixed(3);
        }

        // 環境オブジェ
        if (this.ambientShapes) {
            for (const a of this.ambientShapes) {
                a.up.rotation.x += a.spinX * delta;
                a.up.rotation.y += a.spinY * delta;
                a.up.position.y = a.baseY + Math.sin(t * 0.5 + a.wrongPhase) * 0.25;
                a.lo.rotation.x = -a.up.rotation.x + Math.sin(t * 0.7 + a.wrongPhase) * 0.3;
                a.lo.rotation.y = a.up.rotation.y * 0.8;
                a.lo.position.y = -a.up.position.y - Math.sin(t * 0.9 + a.wrongPhase) * 0.1;
                a.up.material.opacity = 0.32 + (this._sectionBlend || 0) * 0.25;
                a.lo.material.opacity = 0.20 + (this._sectionBlend || 0) * 0.18;
            }
        }

        // 色彩の高揚（サビ）
        if (!this._waterColA) {
            this._waterColA = new THREE.Color(this.themeColor);
            this._waterColB = new THREE.Color(0x8fe0ff);
            this._starColA = new THREE.Color(0xbfe6ff);
            this._starColB = new THREE.Color(0xeaf7ff);
            this._sectionBlend = 0;
            this._waterColMix = new THREE.Color();
            this._starColMix = new THREE.Color();
        }
        this._sectionBlend += ((this.isClimax ? 1 : 0) - this._sectionBlend) * Math.min(1, delta * 1.8);
        const wc = this._waterColMix.copy(this._waterColA).lerp(this._waterColB, this._sectionBlend);
        const sc = this._starColMix.copy(this._starColA).lerp(this._starColB, this._sectionBlend);

        // 鏡像世界が優勢なほど空が褪せ、現実の反転歌詞タップで一時グレーアウト。
        // 鏡像の反転歌詞タップ(vividPulse)は鮮やかさを取り戻す。月だけは別管理で色を保つ。
        const gray = Math.max(0, Math.min(1,
            this.grayPulse + (1 - this.balance) * 0.4 - this.vividPulse));
        if (gray > 0.001) {
            const lw = 0.299 * wc.r + 0.587 * wc.g + 0.114 * wc.b;
            wc.lerp(this._grayTmp ? this._grayTmp.setRGB(lw, lw, lw) : (this._grayTmp = new THREE.Color(lw, lw, lw)), gray);
            const ls = 0.299 * sc.r + 0.587 * sc.g + 0.114 * sc.b;
            sc.lerp(this._grayTmpS ? this._grayTmpS.setRGB(ls, ls, ls) : (this._grayTmpS = new THREE.Color(ls, ls, ls)), gray * 0.85);
        }
        this.waterUniforms.uColor.value.set(wc.r, wc.g, wc.b);
        this.starMaterial.color.copy(sc);
        const swapTarget = THREE.MathUtils.smoothstep(this.waveEnergy, 0.55, 1.1);
        this.swapSmooth += (swapTarget - this.swapSmooth) * 0.12;
        this.waterUniforms.uTime.value = t;
        this.waterUniforms.uSwap.value = this.swapSmooth;

        // たまに環境の波紋
        if (t > this._ambientRippleAt && !this.worldChosen) {
            this._ambientRippleAt = t + 4 + Math.random() * 4;
            this.addRipple((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, 0.18);
        }

        // ── サビ判定 ──
        const chorus = (typeof playerManager.player.findChorus === 'function')
                       ? playerManager.player.findChorus(position) : null;
        this.isClimax = !!chorus;

        // ── タイムライン: 反転 / 選択 ──
        if (this.invertCount === 0 && position >= T_INVERT && !this.worldChosen) {
            this.triggerInversion();
        }
        const duration = playerManager.player.video.duration;
        const choiceAt = (duration && duration < T_CHOICE + 4000) ? Math.max(T_INVERT + 8000, duration - 6000) : T_CHOICE;
        if (!this.choiceShown && !this.worldChosen && position >= choiceAt) {
            this.showChoiceUI();
        }

        // ── 世界反転のなめらかな追従 ──
        this.flipProgress += (this.invertCount - this.flipProgress) * 0.05;
        this.worldGroup.rotation.z = this.flipProgress * Math.PI;

        // ── 明るさ配分（地上=upperGroup / 水面=lowerGroup）──
        // flipProgress: 0=地上が上(明) → 1=水面が上(明)。反転は一度だけ。
        const up01 = Math.min(1, this.flipProgress);
        let groundB = 1.0 - 0.6 * up01;
        let waterB = 0.45 + 0.55 * up01;

        // 選択後の崩壊フェード
        let collapseT = 0;
        if (this.worldChosen && this.collapseStart >= 0) {
            collapseT = Math.min(1, (t - this.collapseStart) / 3.0);
            if (this.worldChosen === 'ground') {
                waterB *= (1 - collapseT);
                groundB = Math.max(groundB, 0.9);
            } else {
                groundB *= (1 - collapseT);
                waterB = Math.max(waterB, 0.9);
            }
            if (this.surfaceLine) {
                this.surfaceLine.material.opacity = 0.5 + 0.45 * Math.min(1, collapseT * 1.5)
                                                  + 0.05 * Math.sin(t * 3.0);
            }
        }

        this.dirLight.intensity = 2.3 * groundB + 0.4;
        this.mirrorLight.intensity = 0.7 + 1.6 * Math.max(0, waterB - 0.45);
        if (this.realMatCache.length) this.applyWorldMaterial(this.realMatCache, 'ground', Math.max(0.05, groundB), collapseT, t);
        if (this.mirrorMatCache.length) this.applyWorldMaterial(this.mirrorMatCache, 'water', Math.max(0.05, waterB * 0.95), collapseT, t);

        // ── VRM ──
        this.updateMikus(t, delta, collapseT);

        // ── 歌詞: フレーズ単位で1世界へ ──
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase !== this.lastPhrase && !this.worldChosen) {
            this.lastPhrase = phrase;
            this.spawnLyric(phrase, position);
        }
        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);

        // ビート同期パルス
        let beatPulse = 0;
        if (typeof playerManager.player.findBeat === 'function') {
            const beat = playerManager.player.findBeat(position);
            if (beat) {
                const d = Math.min(Math.abs(position - beat.startTime), Math.abs(position - beat.endTime));
                beatPulse = Math.max(0, 1 - d / 180);
            }
        }
        if (this.surfaceLine && !this.worldChosen) {
            this.surfaceLine.material.opacity = Math.min(1, 0.45 + 0.25 * this.swapSmooth
                                              + 0.3 * beatPulse + 0.4 * this.invertFlash);
        }

        // ── 歌詞更新 ──
        const wobbleAmp = 0.05 + this.waveEnergy * 0.2;
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
            const l = this.lyrics[i];
            const age = Math.max(0, position - l.birth);

            const isWordActive = word && l.text && l.text.includes(word.text)
                              && position >= word.startTime && position <= word.endTime;
            l.pulse += ((isWordActive ? 1 : 0) - l.pulse) * 0.2;
            const pulseScale = 1.0 + l.pulse * 0.25 + beatPulse * 0.12;

            let shatterFade = 1, shatterScale = 1;
            if (l.shatter) {
                l.shatterT = Math.min(1, l.shatterT + delta / 0.6);
                const st = l.shatterT;
                shatterFade = 1 - st * st;
                shatterScale = 1 + st * 0.7;
                l.pulse = Math.max(l.pulse, 1 - st * 0.6);
            }

            // 出現パターンの寄せ（初期オフセット → 定位置へイージング）
            l.entryT = Math.min(1, l.entryT + delta / (l.entryDur || 0.85));
            const ee = l.entryT * l.entryT * (3 - 2 * l.entryT);
            const offX = l.offX0 * (1 - ee);
            const offY = l.offY0 * (1 - ee);

            l.baseX += l.drift;
            const sway = l.mirrored ? Math.sin(t * 3.0 + l.baseY * 2.0) * wobbleAmp : 0;
            const bob = Math.sin(t * 0.8 + Math.abs(l.baseY)) * 0.08;
            l.sprite.position.set(l.baseX + offX + sway, l.baseY + offY + (l.mirrored ? -bob : bob), l.sprite.position.z);
            l.sprite.scale.set(l.baseScale * l.aspect * pulseScale * shatterScale, l.baseScale * pulseScale * shatterScale, 1);

            // 発光（地上=白／水面=氷シアン）
            if (l.mirrored) {
                l.sprite.material.color.setRGB(1, 1, 1).lerp(
                    this._waterGlow || (this._waterGlow = new THREE.Color('#d6f4ff')),
                    Math.min(1, l.pulse * 0.6));
            } else {
                l.sprite.material.color.setRGB(1, 1 - l.pulse * 0.2, 1 - l.pulse * 0.2);
            }

            // 不透明度（フェード × 世界の明るさ）
            let alpha = 1;
            if (age < 200) alpha = age / 200;
            else if (age > l.life - 300) alpha = Math.max(0, (l.life - age) / 300);
            const worldB = l.world === 'ground' ? groundB : waterB;
            const floor = l.world === 'ground' ? 0.2 : 0.35; // 水面句は薄暗くても拾える
            l.sprite.material.opacity = Math.min(1, alpha * (Math.max(floor, worldB) + l.pulse * 0.3)) * shatterFade;

            if (age > l.life || (l.shatter && l.shatterT >= 1)) {
                this.disposeLyric(l);
                this.lyrics.splice(i, 1);
            }
        }

        // 星屑の明滅
        if (this.starMaterial) {
            this.starMaterial.opacity = 0.45 + 0.15 * Math.sin(t * 0.7) + 0.2 * this.swapSmooth + 0.25 * this._sectionBlend;
        }

        // 崩壊パーティクル
        for (let i = this.bursts.length - 1; i >= 0; i--) {
            const pts = this.bursts[i];
            const age = t - pts.userData.birth;
            const lifeT = age / pts.userData.life;
            if (lifeT >= 1) {
                this.worldGroup.remove(pts);
                pts.geometry.dispose();
                pts.material.dispose();
                this.bursts.splice(i, 1);
                continue;
            }
            const arr = pts.geometry.attributes.position.array;
            const vels = pts.userData.velocities;
            for (let j = 0; j < vels.length; j++) {
                const v = vels[j];
                arr[j * 3] += v.x * delta;
                arr[j * 3 + 1] += v.y * delta;
                arr[j * 3 + 2] += v.z * delta;
                v.y += delta * 0.4;
            }
            pts.geometry.attributes.position.needsUpdate = true;
            pts.material.opacity = 1.0 - lifeT;
        }

        // 光の粒 → 月、月の満ち欠け
        this.updateMotes(t, delta);
        this.updateMoons(t, position, delta);
    }

    // 世界マテリアル: 明るさ＋（選ばれなかった側は）輪郭を揺らし曖昧に薄める
    applyWorldMaterial(cache, world, brightness, collapseT, t) {
        const rejected = this.worldChosen && this.worldChosen !== world;
        for (let i = 0; i < cache.length; i++) {
            const e = cache[i];
            // 溶けゆく側は色が白く飛び、輪郭が曖昧に
            if (rejected) {
                const flick = 0.6 + 0.4 * Math.sin(t * 9 + i * 0.7); // 明滅でゆらぎ
                e.material.color.copy(e.baseColor).multiplyScalar(brightness).lerp(
                    this._dissolveCol || (this._dissolveCol = new THREE.Color('#dff3ff')),
                    collapseT * 0.7 * flick);
                e.material.transparent = true;
                e.material.opacity = Math.max(0, (e.baseOpacity ?? 1) * (1 - collapseT));
            } else if (world === 'water') {
                // 鏡像のリンは姿が透け、わずかにグレーへ寄る（輪郭が曖昧）
                const lum = 0.299 * e.baseColor.r + 0.587 * e.baseColor.g + 0.114 * e.baseColor.b;
                const g = this._mScratch || (this._mScratch = new THREE.Color());
                e.material.color.copy(e.baseColor).lerp(g.setRGB(lum, lum, lum), 0.28).multiplyScalar(brightness);
                e.material.transparent = true;
                e.material.opacity = (e.baseOpacity ?? 1) * this.mirrorAlpha;
            } else {
                e.material.color.copy(e.baseColor).multiplyScalar(brightness);
                if (e.material.opacity !== (e.baseOpacity ?? 1)) {
                    e.material.opacity = e.baseOpacity ?? 1;
                    e.material.transparent = e.baseTransparent ?? false;
                }
            }
        }
    }

    updateMikus(t, delta, collapseT) {
        // 地上のリン
        if (this.realVRM) {
            const vrm = this.realVRM;
            const chest = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('chest');
            const spine = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('spine');
            const breath = Math.sin(t * 1.15) * 0.02;
            if (chest) chest.rotation.x = breath;
            if (spine) spine.rotation.x = breath * 0.5;
            const rejected = this.worldChosen === 'water';
            const wob = rejected ? collapseT * 0.06 : 0;
            vrm.scene.position.x = (rejected ? Math.sin(t * 7) * wob : 0);
            vrm.scene.position.y = Math.sin(t * 0.9) * 0.02;
            vrm.scene.rotation.z = Math.sin(t * 0.5) * 0.015 + (rejected ? Math.sin(t * 6) * wob : 0);
            vrm.update(delta);
        }

        // 水面のリン（呼吸位相ズレ＋たまにこちらを向く）
        if (this.mirrorVRM) {
            const vrm = this.mirrorVRM;
            const chest = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('chest');
            const spine = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('spine');
            const head = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('head');

            const breath = Math.sin(t * 1.15 + 2.4) * 0.026;
            if (chest) chest.rotation.x = breath;
            if (spine) spine.rotation.x = breath * 0.5;

            if (this.gazeUntil < 0 && t > this.nextGazeAt) {
                this.gazeUntil = t + 2.4;
            }
            if (this.gazeUntil > 0 && t > this.gazeUntil) {
                this.gazeUntil = -1;
                this.nextGazeAt = t + 7 + Math.random() * 8;
            }
            const gazeTarget = this.gazeUntil > 0 ? 1 : 0;
            this.gazeWeight += (gazeTarget - this.gazeWeight) * 0.06;

            if (head) {
                head.rotation.x = 0.08 - this.gazeWeight * 0.45 + Math.sin(t * 0.7 + 1.0) * 0.02;
                head.rotation.y = Math.sin(t * 0.33) * 0.06 * (1 - this.gazeWeight);
            }

            const rejected = this.worldChosen === 'ground';
            const wob = rejected ? collapseT * 0.06 : 0;
            vrm.scene.position.x = Math.sin(t * 2.0) * 0.05 * (0.25 + this.waveEnergy)
                                 + (rejected ? Math.sin(t * 7) * wob * 3 : 0);
            vrm.scene.position.y = Math.sin(t * 0.9 + 0.6) * 0.02;
            vrm.scene.rotation.z = Math.PI + Math.sin(t * 0.6 + 1.2) * 0.02 + (rejected ? Math.sin(t * 6) * wob : 0);
            vrm.update(delta);
        }
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ───────────────────────── 破棄 ─────────────────────────

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
        window.removeEventListener('resize', this.boundOnResize);
        this.songWrapper.removeEventListener('pointerdown', this.boundOnPointerDown);
        this.songWrapper.removeEventListener('pointermove', this.boundOnPointerMove);
        window.removeEventListener('pointerup', this.boundOnPointerUp);
        window.removeEventListener('pointercancel', this.boundOnPointerUp);

        if (this._captionTimer) clearTimeout(this._captionTimer);

        this.lyrics.forEach((l) => this.disposeLyric(l));
        this.lyrics = [];

        this.bursts.forEach((pts) => {
            if (pts.parent) pts.parent.remove(pts);
            pts.geometry.dispose();
            pts.material.dispose();
        });
        this.bursts = [];

        this.motes.forEach((pts) => {
            if (pts.parent) pts.parent.remove(pts);
            pts.geometry.dispose();
            pts.material.dispose();
        });
        this.motes = [];

        // 月
        if (this.moonGroup) {
            this.moonGroup.traverse((o) => {
                if (o.material) o.material.dispose();
            });
            if (this.moonGroup.parent) this.moonGroup.parent.remove(this.moonGroup);
            this.moonGroup = null;
        }
        [this.moonGround, this.moonWater].forEach((m) => { if (m && m.tex) m.tex.dispose(); });

        // HUD・キャプション
        [this.flashEl, this.crackEl, this._invCap].forEach((el) => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });

        if (this.water) {
            this.water.geometry.dispose();
            this.water.material.dispose();
        }
        if (this.surfaceLine) {
            this.surfaceLine.geometry.dispose();
            this.surfaceLine.material.dispose();
        }

        if (this.starGeometry) this.starGeometry.dispose();
        if (this.starMaterial) this.starMaterial.dispose();
        if (this.glowTexture) this.glowTexture.dispose();

        if (this.realVRM) {
            if (this.realVRM.scene.parent) this.realVRM.scene.parent.remove(this.realVRM.scene);
            this.disposeVRM(this.realVRM);
            this.realVRM = null;
        }
        if (this.mirrorVRM) {
            if (this.mirrorVRM.scene.parent) this.mirrorVRM.scene.parent.remove(this.mirrorVRM.scene);
            this.disposeVRM(this.mirrorVRM);
            this.mirrorVRM = null;
        }
        this.realMatCache = [];
        this.mirrorMatCache = [];

        if (this.choiceOverlay && this.choiceOverlay.parentNode) {
            this.choiceOverlay.parentNode.removeChild(this.choiceOverlay);
        }
        if (this.captionEl && this.captionEl.parentNode) {
            this.captionEl.parentNode.removeChild(this.captionEl);
        }

        if (this.styleEl && this.styleEl.parentNode) {
            this.styleEl.parentNode.removeChild(this.styleEl);
        }

        if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss?.(); }

        super.destroy();
    }
}
