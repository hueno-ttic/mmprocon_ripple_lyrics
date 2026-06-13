import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

/**
 * トリツクロジー「水鏡の二重世界」
 *
 * 画面中央の水面ラインを境に、上＝実像の世界 / 下＝水鏡の世界。
 * - 歌詞は上世界では正しく、下世界では上下反転（鏡文字）＋色収差で同時に流れる
 * - 水面ラインに立つミクと、その鏡像のミク（VRM 2体 / モバイルはシルエット）
 * - ドラッグ/スワイプで波紋 → 下世界が歪み、波のピークで上下の明暗が入れ替わる
 * - サビで世界全体が滑らかに上下反転（Three.jsグループ回転、CSS transformは廃止）
 * - 終盤に「本物はどっち？」の選択UI。選んだ側が確定し、もう片方は光の粒へ崩壊
 */

const MAX_RIPPLES = 10;

export class SongTricktology extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        this.themeColor = '#3C3489';
        this.isMobile = window.innerWidth < 768;

        // ── 二重世界グループ ──
        this.worldGroup = null;   // サビ反転用の親（Z軸回転）
        this.upperGroup = null;   // 実像の世界
        this.lowerGroup = null;   // 水鏡の世界

        // 歌詞スプライト（上下ペアで管理）
        this.activePairs = [];
        this.lastPhrase = null;

        // 水面
        this.water = null;
        this.waterUniforms = null;
        this.surfaceLine = null;
        this.rippleIndex = 0;
        this.waveEnergy = 0;     // 波の蓄積エネルギー 0..1+
        this.swapSmooth = 0;     // 上下明暗スワップの平滑値 0..1
        this.rippleCount = 0;    // 操作の積み上げカウント

        // VRM
        this.realVRM = null;
        this.mirrorVRM = null;
        this.realMatCache = [];   // { material, baseColor }
        this.mirrorMatCache = [];
        this.mirrorSilhouette = null; // モバイル用シルエット
        this.mikuZ = -5.0;
        this.mikuScale = this.isMobile ? 3.0 : 3.6;

        // 鏡像の不気味さ演出（呼吸位相ズレ＋たまにこちらを向く）
        this.gazeWeight = 0;
        this.nextGazeAt = 8 + Math.random() * 6; // 相対秒
        this.gazeUntil = -1;

        // サビ反転
        this.isClimax = false;
        this.flipProgress = 0;   // 0=実像が上, 1=鏡像が上

        // 終盤の選択
        this.endingShown = false;
        this.worldChosen = null;     // 'upper' | 'lower'
        this.collapseStart = -1;     // 相対秒
        this.choiceOverlay = null;
        this.captionEl = null;
        this._captionTimer = null;

        // パーティクル（崩壊の光の粒など）
        this.bursts = [];

        // 時刻（float32精度対策：シーン生成時点からの相対秒のみ使う）
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
        this.scene.background = new THREE.Color(0x06061a);
        this.scene.fog = new THREE.FogExp2(0x06061a, 0.022);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
        this.camera.position.set(0, 1.4, 13);
        // 注意: BaseSong.animate がパララックスで rotation を上書きするため lookAt は使わない

        this.renderer = new THREE.WebGLRenderer({ antialias: !this.isMobile, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
        this.renderer.domElement.style.touchAction = 'none'; // モバイルでドラッグを奪われない
        this.songWrapper.appendChild(this.renderer.domElement);

        this.ambientLight = new THREE.AmbientLight(0x404070, 1.6);
        this.scene.add(this.ambientLight);
        this.dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
        this.dirLight.position.set(2, 6, 10);
        this.scene.add(this.dirLight);
        // 下世界をほの暗く照らす反射光
        this.mirrorLight = new THREE.DirectionalLight(0x8a7fff, 0.7);
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
            ripples.push(new THREE.Vector4(0, 0, -1000, 0)); // x, z(localY), startT, amp
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
                    vPos = position.xy; // 平面ローカル座標（反転中も安定）
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
                    // 微かな揺らめき模様
                    float shimmer = sin(vPos.x * 0.7 + uTime * 1.3) * sin(vPos.y * 1.1 - uTime * 0.9);
                    float base = 0.08 + shimmer * 0.025;
                    vec3 col = uColor * (0.9 + wave * 1.2) + vec3(1.0) * (wave * 0.55 + uSwap * 0.15);
                    float alpha = clamp(base + wave * 0.6, 0.0, 0.85);
                    gl_FragColor = vec4(col, alpha);
                }
            `
        });

        this.water = new THREE.Mesh(geometry, material);
        this.water.rotation.x = -Math.PI / 2;
        this.water.position.set(0, 0, -10);
        this.worldGroup.add(this.water);

        // 水面ラインの淡い光（境界を強調）
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
        // 上下対称の星屑（鏡映え）。上半分を生成し、同じxzで-yにも置く
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
            color: new THREE.Color('#9a90e8'),
            size: 0.09,
            transparent: true,
            opacity: 0.55,
            depthWrite: false
        });
        this.stars = new THREE.Points(this.starGeometry, this.starMaterial);
        this.worldGroup.add(this.stars);
    }

    // 二重世界の対比を常時見せる環境オブジェ:
    // 上世界に発光ワイヤーフレームの幾何体、下世界にその「歪んだ」鏡像
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
                color: 0x8a7fff, wireframe: true, transparent: true, opacity: 0.35,
            });
            const up = new THREE.Mesh(geo, upMat);
            const x = (Math.random() - 0.5) * 16;
            const y = 1.6 + Math.random() * 3.4;
            const z = -6 - Math.random() * 7;
            up.position.set(x, y, z);
            this.upperGroup.add(up);

            // 鏡像: 同じ形だが暗く、わずかに「ありえない」回転位相を持つ
            const loMat = new THREE.MeshBasicMaterial({
                color: 0x5a4fd0, wireframe: true, transparent: true, opacity: 0.22,
            });
            const lo = new THREE.Mesh(geo, loMat);
            lo.position.set(x, -y, z);
            lo.scale.y = -1; // メッシュは負スケール有効(スプライトと違い)
            this.lowerGroup.add(lo);

            this.ambientShapes.push({
                up, lo,
                spinX: (Math.random() - 0.5) * 0.4,
                spinY: (Math.random() - 0.5) * 0.5,
                wrongPhase: Math.random() * Math.PI * 2, // 鏡像のズレ
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

    // ───────────────────────── VRM 2体 ─────────────────────────

    loadMikus() {
        const loadOne = (onLoaded) => {
            const loader = new GLTFLoader();
            loader.register((parser) => new VRMLoaderPlugin(parser));
            loader.load(
                import.meta.env.BASE_URL + 'assets/models/model_miku.vrm',
                (gltf) => onLoaded(gltf.userData.vrm),
                undefined,
                (err) => console.error('[TRICKTOLOGY] Failed to load VRM:', err)
            );
        };

        // 実像のミク（水面ラインに立つ）
        loadOne((vrm) => {
            if (!this.isActive) { this.disposeVRM(vrm); return; }
            this.realVRM = vrm;
            vrm.scene.position.set(0, 0, this.mikuZ);
            vrm.scene.rotation.y = 0; // カメラ正面
            vrm.scene.scale.setScalar(this.mikuScale);
            this.setupRelaxedPose(vrm);
            this.cacheMaterials(vrm, this.realMatCache);
            this.upperGroup.add(vrm.scene);
            console.log('[TRICKTOLOGY] Real Miku loaded.');
        });

        if (!this.isMobile) {
            // 鏡像のミク（逆さま・薄暗い・呼吸位相ズレ）
            loadOne((vrm) => {
                if (!this.isActive) { this.disposeVRM(vrm); return; }
                this.mirrorVRM = vrm;
                vrm.scene.position.set(0, 0, this.mikuZ);
                vrm.scene.rotation.y = 0;
                vrm.scene.rotation.z = Math.PI; // 足元(原点)を軸に上下反転 → 水鏡の像
                vrm.scene.scale.setScalar(this.mikuScale);
                this.setupRelaxedPose(vrm);
                this.cacheMaterials(vrm, this.mirrorMatCache);
                this.lowerGroup.add(vrm.scene);
                console.log('[TRICKTOLOGY] Mirror Miku loaded.');
            });
        } else {
            // モバイル: 暗いシルエットスプライトで負荷削減
            this.mirrorSilhouette = this.createSilhouetteSprite();
            this.lowerGroup.add(this.mirrorSilhouette);
        }
    }

    cacheMaterials(vrm, cache) {
        vrm.scene.traverse((obj) => {
            if (!obj.material) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => {
                if (m.color) {
                    cache.push({ material: m, baseColor: m.color.clone() });
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
        // 新VRMは上腕ロール軸が逆: 左+/右- で腕が下がる
        if (lu) lu.rotation.z = Math.PI / 2.8;
        if (ru) ru.rotation.z = -Math.PI / 2.8;
        if (ll) ll.rotation.y = Math.PI / 12;
        if (rl) rl.rotation.y = -Math.PI / 12;
    }

    createSilhouetteSprite() {
        // プロシージャルなシルエット（頭＋ツインテール風＋身体）をcanvasで描画
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(10, 8, 40, 0.9)';
        // 身体（台形）
        ctx.beginPath();
        ctx.moveTo(52, 90); ctx.lineTo(76, 90); ctx.lineTo(86, 250); ctx.lineTo(42, 250);
        ctx.closePath(); ctx.fill();
        // 頭
        ctx.beginPath(); ctx.arc(64, 62, 28, 0, Math.PI * 2); ctx.fill();
        // ツインテール
        ctx.beginPath(); ctx.ellipse(26, 120, 12, 70, 0.18, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(102, 120, 12, 70, -0.18, 0, Math.PI * 2); ctx.fill();
        // 全体をぼかし風グラデで沈める
        const g = ctx.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0, 'rgba(6,6,26,0.0)');
        g.addColorStop(1, 'rgba(6,6,26,0.65)');
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 256);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.7, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        const h = this.mikuScale * 1.55;
        sprite.scale.set(h * 0.5, -h, 1); // 負のYスケールで上下反転
        sprite.position.set(0, -h / 2, this.mikuZ);
        return sprite;
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
            // 水鏡の像: キャンバス自体を上下反転して鏡文字を焼き込む
            // (THREE.Spriteは負のスケールを無視するため、ここで反転する)
            ctx.translate(0, 128);
            ctx.scale(1, -1);
            // 色収差（シアン/マゼンタの色ずれ）
            ctx.fillStyle = 'rgba(0, 220, 255, 0.55)';
            ctx.fillText(text, w / 2 - 3, 64);
            ctx.fillStyle = 'rgba(255, 60, 180, 0.55)';
            ctx.fillText(text, w / 2 + 3, 64);
            ctx.fillStyle = 'rgba(230, 230, 255, 0.8)';
            ctx.fillText(text, w / 2, 64);
        } else {
            ctx.shadowColor = this.themeColor;
            ctx.shadowBlur = 18;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, w / 2, 64);
        }
        return { texture: new THREE.CanvasTexture(canvas), aspect: w / 128 };
    }

    spawnLyricPair(phrase, position) {
        // 最大ペア数制限（古いものから消す）
        const maxPairs = this.isMobile ? 3 : 4;
        while (this.activePairs.length >= maxPairs) {
            this.disposePair(this.activePairs.shift());
        }

        const { texture: upTex, aspect } = this.createTextTexture(phrase.text, false);
        const { texture: loTex } = this.createTextTexture(phrase.text, true);

        let scale = 1.1 + Math.random() * 0.3;
        if (aspect > 9) scale *= 9 / aspect;
        scale = Math.max(0.6, scale);

        const x = (Math.random() - 0.5) * 9;
        const y = 1.6 + Math.random() * 2.8;
        const z = -4 - Math.random() * 4;

        const upMat = new THREE.SpriteMaterial({ map: upTex, transparent: true, opacity: 0, depthWrite: false });
        const upper = new THREE.Sprite(upMat);
        upper.position.set(x, y, z);
        upper.scale.set(scale * aspect, scale, 1);
        this.upperGroup.add(upper);

        const loMat = new THREE.SpriteMaterial({ map: loTex, transparent: true, opacity: 0, depthWrite: false });
        const lower = new THREE.Sprite(loMat);
        lower.position.set(x, -y, z);
        lower.scale.set(scale * aspect, scale, 1); // 反転はテクスチャ側で実施済み
        this.lowerGroup.add(lower);

        const duration = (phrase.endTime - phrase.startTime) || 2500;
        this.activePairs.push({
            upper, lower,
            upTex, loTex,
            flipped: false,
            text: phrase.text,
            birth: position,
            life: duration + 1400,
            baseScale: scale,
            aspect,
            baseX: x,
            baseY: y,
            drift: (Math.random() - 0.5) * 0.004,
            pulse: 0
        });
    }

    disposePair(pair) {
        if (!pair) return;
        [pair.upper, pair.lower].forEach((s) => {
            if (!s) return;
            if (s.parent) s.parent.remove(s);
            if (s.material.map) s.material.map.dispose();
            s.material.dispose();
        });
    }

    // ───────────────────────── 入力 → 波紋 ─────────────────────────

    onPointerDown(e) {
        if (this.choiceOverlay) return; // 選択UI表示中はドラッグ無効
        this.isDragging = true;
        this.lastPointer.set(e.clientX, e.clientY);
        this.dragAccum = 0;
        this.spawnRippleAtPointer(e.clientX, e.clientY, 0.5);
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
            this.spawnRippleAtPointer(e.clientX, e.clientY, 0.65 + Math.random() * 0.35);
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
            // 平面と交差しない角度なら、画面X位置から推定
            hit.set(ndc.x * 10, 0, -4);
        }
        // 水面プレーンのローカル座標へ変換（反転中も安定）
        const local = this.water.worldToLocal(hit.clone());
        this.addRipple(local.x, local.y, amp);
    }

    addRipple(lx, ly, amp) {
        const ripples = this.waterUniforms.uRipples.value;
        const v = ripples[this.rippleIndex % MAX_RIPPLES];
        v.set(lx, ly, this.relSec(), amp);
        this.rippleIndex++;
        this.rippleCount++;
        this.waveEnergy = Math.min(1.4, this.waveEnergy + amp * 0.38);
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
            .tricktology-choice-half.upper { background: linear-gradient(to bottom, rgba(60,52,137,0.22), rgba(60,52,137,0.0)); }
            .tricktology-choice-half.lower { background: linear-gradient(to top, rgba(60,52,137,0.22), rgba(60,52,137,0.0)); }
            .tricktology-choice-half:hover { background: rgba(124,112,230,0.18); }
            .tricktology-choice-label {
                color: #fff; font-size: clamp(16px, 3.4vw, 26px); letter-spacing: 0.18em;
                padding: 12px 28px; border: 1px solid rgba(255,255,255,0.55); border-radius: 999px;
                background: rgba(10,8,40,0.45); backdrop-filter: blur(4px);
                text-shadow: 0 0 14px #3C3489;
                animation: tricktology-pulse 2.2s ease-in-out infinite;
            }
            .tricktology-choice-half.lower .tricktology-choice-label { transform: scaleY(-1); }
            .tricktology-choice-question {
                position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
                color: #fff; font-size: clamp(14px, 3vw, 22px); letter-spacing: 0.3em;
                pointer-events: none; text-shadow: 0 0 18px #3C3489, 0 0 4px #000;
                white-space: nowrap;
            }
            @keyframes tricktology-pulse {
                0%, 100% { box-shadow: 0 0 8px rgba(124,112,230,0.4); }
                50% { box-shadow: 0 0 26px rgba(124,112,230,0.95); }
            }
            .tricktology-caption {
                position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%);
                z-index: 51; color: #fff; font-size: clamp(13px, 2.6vw, 19px);
                letter-spacing: 0.22em; pointer-events: none; white-space: nowrap;
                text-shadow: 0 0 16px #3C3489, 0 0 4px #000;
                opacity: 0; transition: opacity 1.4s ease;
                font-family: "Inter", "Noto Sans JP", sans-serif;
            }
            .tricktology-caption.visible { opacity: 1; }
        `;
        document.head.appendChild(this.styleEl);
    }

    showChoiceUI() {
        if (this.choiceOverlay || this.worldChosen) return;
        this.endingShown = true;

        const overlay = document.createElement('div');
        overlay.className = 'tricktology-choice-overlay';
        overlay.innerHTML = `
            <div class="tricktology-choice-half upper" data-side="upper">
                <span class="tricktology-choice-label">こちらが本物</span>
            </div>
            <div class="tricktology-choice-half lower" data-side="lower">
                <span class="tricktology-choice-label">こちらが本物</span>
            </div>
            <div class="tricktology-choice-question">─ 本物は、どっち？ ─</div>
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
        this.worldChosen = side;
        this.collapseStart = this.relSec();

        // エンドカードへ成果を登録
        this.setResultSummary({
            accentColor: '#8a7fff',
            lines: [
                side === 'upper' ? '選んだのは — 実像の世界' : '選んだのは — 水鏡の世界',
                `起こした波紋 ${this.rippleCount}`,
            ],
        });

        if (this.choiceOverlay) {
            this.choiceOverlay.classList.remove('visible');
            const el = this.choiceOverlay;
            setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1300);
            this.choiceOverlay = null;
        }

        // 拒まれた側の世界 → 光の粒へ崩壊
        const rejectedGroup = side === 'upper' ? this.lowerGroup : this.upperGroup;
        this.spawnCollapseBurst(rejectedGroup, side === 'upper' ? -1 : 1);

        // 確定の余韻キャプション（歌詞ではなく演出上の自作テキスト）
        const cap = document.createElement('div');
        cap.className = 'tricktology-caption';
        cap.textContent = 'あなたが選んだ世界が、本物になった';
        this.songWrapper.appendChild(cap);
        this.captionEl = cap;
        requestAnimationFrame(() => cap.classList.add('visible'));
        this._captionTimer = setTimeout(() => {
            if (cap.parentNode) cap.classList.remove('visible');
        }, 6500);

        // 選択の瞬間、水面に強い波
        this.addRipple(0, this.mikuZ + 10, 1.2);
        this.waveEnergy = 1.4;
    }

    spawnCollapseBurst(group, ySign) {
        const count = this.isMobile ? 160 : 360;
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            // 拒まれた側のミク周辺＋空間全体から光の粒が湧く
            const nearMiku = i % 2 === 0;
            const x = nearMiku ? (Math.random() - 0.5) * 2.5 : (Math.random() - 0.5) * 16;
            const y = ySign * (nearMiku ? Math.random() * this.mikuScale * 1.5 : Math.random() * 5);
            const z = this.mikuZ + (Math.random() - 0.5) * (nearMiku ? 1.5 : 8);
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
            velocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * 0.6,
                -ySign * (0.4 + Math.random() * 0.9), // 水面ラインへ吸い込まれてから散る
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

        // ── 波エネルギーの減衰と上下明暗スワップ ──
        this.waveEnergy *= Math.exp(-delta * 1.6);

        // 環境オブジェ: 上はゆっくり回り、鏡像は位相のずれた「ありえない」動き
        if (this.ambientShapes) {
            for (const a of this.ambientShapes) {
                a.up.rotation.x += a.spinX * delta;
                a.up.rotation.y += a.spinY * delta;
                a.up.position.y = a.baseY + Math.sin(t * 0.5 + a.wrongPhase) * 0.25;
                a.lo.rotation.x = -a.up.rotation.x + Math.sin(t * 0.7 + a.wrongPhase) * 0.3;
                a.lo.rotation.y = a.up.rotation.y * 0.8;
                a.lo.position.y = -a.up.position.y - Math.sin(t * 0.9 + a.wrongPhase) * 0.1;
                // サビの高揚で輝度が上がる
                a.up.material.opacity = 0.35 + (this._sectionBlend || 0) * 0.25;
                a.lo.material.opacity = 0.22 + (this._sectionBlend || 0) * 0.18;
            }
        }

        // 曲展開の視覚化: サビで水面と星屑の色彩が高揚し、場面が絵替わりする
        if (!this._waterColA) {
            this._waterColA = new THREE.Color(this.themeColor);   // 通常: 紺紫
            this._waterColB = new THREE.Color(0x6A5AE8);          // サビ: 高揚した青紫
            this._starColA = new THREE.Color(0x9a90e8);
            this._starColB = new THREE.Color(0xCFE8FF);
            this._sectionBlend = 0;
        }
        this._sectionBlend += ((this.isClimax ? 1 : 0) - this._sectionBlend) * Math.min(1, delta * 1.8);
        const wc = this._waterColA.clone().lerp(this._waterColB, this._sectionBlend);
        this.waterUniforms.uColor.value.set(wc.r, wc.g, wc.b);
        this.starMaterial.color.copy(this._starColA.clone().lerp(this._starColB, this._sectionBlend));
        this.starMaterial.opacity = 0.55 + this._sectionBlend * 0.35;
        const swapTarget = THREE.MathUtils.smoothstep(this.waveEnergy, 0.55, 1.1);
        this.swapSmooth += (swapTarget - this.swapSmooth) * 0.12;
        this.waterUniforms.uTime.value = t;
        this.waterUniforms.uSwap.value = this.swapSmooth;

        // たまに環境の波紋（静かな水面が生きている感じ）
        if (t > this._ambientRippleAt && !this.worldChosen) {
            this._ambientRippleAt = t + 4 + Math.random() * 4;
            this.addRipple((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, 0.18);
            this.rippleCount--; // 自動波紋は操作カウントに含めない
        }

        // ── サビ判定 → 世界反転 ──
        const chorus = (typeof playerManager.player.findChorus === 'function')
                       ? playerManager.player.findChorus(position) : null;
        this.isClimax = !!chorus;

        let flipTarget = this.isClimax ? 1 : 0;
        if (this.worldChosen === 'lower') flipTarget = 1; // 下の世界を本物に確定 → 上に
        if (this.worldChosen === 'upper') flipTarget = 0;
        this.flipProgress += (flipTarget - this.flipProgress) * 0.035;
        this.worldGroup.rotation.z = this.flipProgress * Math.PI;

        // ── 明るさの配分（実像 / 鏡像）──
        // 通常: 上=明るい(1.0) 下=薄暗い(0.5)。波のピークで入れ替わる。サビ反転中は鏡像が主役。
        const flip = this.flipProgress;
        const swap = this.swapSmooth;
        let upperB = 1.0 - 0.55 * swap - 0.25 * flip;
        let lowerB = 0.5 + 0.55 * swap + 0.5 * flip;

        // 選択後の崩壊フェード
        let collapseT = 0;
        if (this.worldChosen && this.collapseStart >= 0) {
            collapseT = Math.min(1, (t - this.collapseStart) / 2.5);
            if (this.worldChosen === 'upper') {
                lowerB *= (1 - collapseT);
                upperB = Math.max(upperB, 0.85);
            } else {
                upperB *= (1 - collapseT);
                lowerB = Math.max(lowerB, 0.85);
            }
            if (collapseT >= 1) {
                const rejected = this.worldChosen === 'upper' ? this.lowerGroup : this.upperGroup;
                rejected.visible = false;
            }
            // 確定後は水面ラインが強く輝く
            if (this.surfaceLine) {
                this.surfaceLine.material.opacity = 0.5 + 0.45 * Math.min(1, collapseT * 1.5)
                                                  + 0.05 * Math.sin(t * 3.0);
            }
        }

        this.dirLight.intensity = 2.4 * upperB + 0.4;
        this.mirrorLight.intensity = 0.7 + 1.6 * (lowerB - 0.5);
        if (this.realMatCache.length) this.setBrightness(this.realMatCache, Math.max(0.05, upperB));
        if (this.mirrorMatCache.length) this.setBrightness(this.mirrorMatCache, Math.max(0.05, lowerB * 0.9));
        if (this.mirrorSilhouette) {
            this.mirrorSilhouette.material.opacity = 0.7 * Math.max(0, lowerB);
            this.mirrorSilhouette.position.x = Math.sin(t * 2.2) * 0.06 * (0.3 + this.waveEnergy);
        }

        // ── VRM 更新 ──
        this.updateMikus(t, delta);

        // ── 歌詞: フレーズ単位で上下ペア生成 ──
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase !== this.lastPhrase && !this.worldChosen) {
            this.lastPhrase = phrase;
            this.spawnLyricPair(phrase, position);
        }

        // 前面の読みやすい歌詞（共通レンダラ）
        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);
        if (this.lyricRenderer) {
            if (word) {
                this.lyricRenderer.update(word);
            } else if (!phrase) {
                this.lyricRenderer.update(null);
            }
        }

        // ── 歌詞ペアの更新 ──
        const wobbleAmp = 0.05 + this.waveEnergy * 0.22; // 波で下世界が歪む
        for (let i = this.activePairs.length - 1; i >= 0; i--) {
            const p = this.activePairs[i];
            const age = Math.max(0, position - p.birth);

            // 歌唱中の単語と一致したらパルス
            const isWordActive = word && p.text && p.text.includes(word.text)
                              && position >= word.startTime && position <= word.endTime;
            p.pulse += ((isWordActive ? 1 : 0) - p.pulse) * 0.2;
            const pulseScale = 1.0 + p.pulse * 0.25;

            // ゆっくり漂う
            p.baseX += p.drift;
            const upY = p.baseY + Math.sin(t * 0.8 + p.baseY) * 0.08;
            p.upper.position.set(p.baseX, upY, p.upper.position.z);
            p.upper.scale.set(p.baseScale * p.aspect * pulseScale, p.baseScale * pulseScale, 1);

            // 波紋が歌詞の真下を通過する瞬間、正像⇄鏡像が入れ替わる
            // (触った波が歌詞に届く=操作が歌詞演出に還元される核)
            let waveAt = 0;
            const rps = this.waterUniforms.uRipples.value;
            for (let ri = 0; ri < rps.length; ri++) {
                const age = t - rps[ri].z;
                if (age > 0 && age < 2.8) {
                    const rr = age * 7.0;
                    const dd = Math.abs(p.baseX - rps[ri].x);
                    waveAt += rps[ri].w * Math.exp(-Math.pow(dd - rr, 2) * 0.35) * (1 - age / 2.8);
                }
            }
            const shouldFlip = waveAt > 0.42;
            if (shouldFlip !== p.flipped) {
                p.flipped = shouldFlip;
                p.upper.material.map = shouldFlip ? p.loTex : p.upTex;
                p.lower.material.map = shouldFlip ? p.upTex : p.loTex;
                p.upper.material.needsUpdate = true;
                p.lower.material.needsUpdate = true;
                // 入れ替わりの瞬間に白くスパーク
                p.pulse = Math.max(p.pulse, 0.9);
            }

            // 鏡像: 上下対称＋揺らぎ（波エネルギーで増幅）
            const wob = Math.sin(t * 3.1 + p.baseY * 2.0) * wobbleAmp;
            p.lower.position.set(p.baseX + wob, -upY, p.lower.position.z);
            p.lower.scale.set(
                p.baseScale * p.aspect * pulseScale * (1.0 + wob * 0.08),
                p.baseScale * pulseScale,
                1
            );

            // 歌唱パルスで純白フラッシュ
            p.upper.material.color.setRGB(1, 1 - p.pulse * 0.25, 1 - p.pulse * 0.25);

            // 不透明度（フェードイン/アウト × 世界の明るさ）
            let alpha = 1;
            if (age < 200) alpha = age / 200;
            else if (age > p.life - 300) alpha = Math.max(0, (p.life - age) / 300);
            p.upper.material.opacity = alpha * Math.min(1, upperB + 0.15);
            p.lower.material.opacity = alpha * 0.7 * Math.min(1, lowerB + 0.2);

            if (age > p.life) {
                this.disposePair(p);
                this.activePairs.splice(i, 1);
            }
        }

        // ── 星屑の明滅 ──
        if (this.starMaterial) {
            this.starMaterial.opacity = 0.45 + 0.15 * Math.sin(t * 0.7) + 0.2 * this.swapSmooth;
        }

        // ── 崩壊パーティクル更新 ──
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
                // 水面ラインを越えたら上方向に散って消える（光の昇華）
                v.y += delta * 0.5;
            }
            pts.geometry.attributes.position.needsUpdate = true;
            pts.material.opacity = 1.0 - lifeT;
        }

        // ── 終盤検出 → 選択UI ──
        const duration = playerManager.player.video.duration;
        if (duration && !this.endingShown && !this.worldChosen
            && position > duration - 16000 && position < duration) {
            this.showChoiceUI();
        }
    }

    updateMikus(t, delta) {
        // 実像: 静かな呼吸＋揺らぎ
        if (this.realVRM) {
            const vrm = this.realVRM;
            const chest = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('chest');
            const spine = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('spine');
            const breath = Math.sin(t * 1.15) * 0.02;
            if (chest) chest.rotation.x = breath;
            if (spine) spine.rotation.x = breath * 0.5;
            vrm.scene.position.y = Math.sin(t * 0.9) * 0.02; // 水面に立つ微かな上下
            vrm.scene.rotation.z = Math.sin(t * 0.5) * 0.015;
            vrm.update(delta);
        }

        // 鏡像: 呼吸の位相がズレる＋たまにこちらを向く（不気味さの核）
        if (this.mirrorVRM) {
            const vrm = this.mirrorVRM;
            const chest = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('chest');
            const spine = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('spine');
            const head = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('head');

            const breath = Math.sin(t * 1.15 + 2.4) * 0.026; // 位相ズレ＋やや深い呼吸
            if (chest) chest.rotation.x = breath;
            if (spine) spine.rotation.x = breath * 0.5;

            // 視線イベント管理
            if (this.gazeUntil < 0 && t > this.nextGazeAt) {
                this.gazeUntil = t + 2.4; // 2.4秒こちらを見る
            }
            if (this.gazeUntil > 0 && t > this.gazeUntil) {
                this.gazeUntil = -1;
                this.nextGazeAt = t + 7 + Math.random() * 8;
            }
            const gazeTarget = this.gazeUntil > 0 ? 1 : 0;
            this.gazeWeight += (gazeTarget - this.gazeWeight) * 0.06;

            if (head) {
                // 普段はわずかに俯き漂うが、視線イベント時はぐっと観客側へ顔を上げる
                head.rotation.x = 0.08 - this.gazeWeight * 0.45 + Math.sin(t * 0.7 + 1.0) * 0.02;
                head.rotation.y = Math.sin(t * 0.33) * 0.06 * (1 - this.gazeWeight);
            }

            // 波で像全体が揺らぐ
            vrm.scene.position.x = Math.sin(t * 2.0) * 0.05 * (0.25 + this.waveEnergy);
            vrm.scene.position.y = Math.sin(t * 0.9 + 0.6) * 0.02;
            vrm.scene.rotation.z = Math.PI + Math.sin(t * 0.6 + 1.2) * 0.02;
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

        // 歌詞ペア
        this.activePairs.forEach((p) => this.disposePair(p));
        this.activePairs = [];

        // 崩壊パーティクル
        this.bursts.forEach((pts) => {
            if (pts.parent) pts.parent.remove(pts);
            pts.geometry.dispose();
            pts.material.dispose();
        });
        this.bursts = [];

        // 水面
        if (this.water) {
            this.water.geometry.dispose();
            this.water.material.dispose();
        }
        if (this.surfaceLine) {
            this.surfaceLine.geometry.dispose();
            this.surfaceLine.material.dispose();
        }

        // 星屑
        if (this.starGeometry) this.starGeometry.dispose();
        if (this.starMaterial) this.starMaterial.dispose();

        // グローテクスチャ
        if (this.glowTexture) this.glowTexture.dispose();

        // VRM 2体
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

        // モバイルシルエット
        if (this.mirrorSilhouette) {
            if (this.mirrorSilhouette.parent) this.mirrorSilhouette.parent.remove(this.mirrorSilhouette);
            if (this.mirrorSilhouette.material.map) this.mirrorSilhouette.material.map.dispose();
            this.mirrorSilhouette.material.dispose();
            this.mirrorSilhouette = null;
        }

        // 選択UI・キャプション
        if (this.choiceOverlay && this.choiceOverlay.parentNode) {
            this.choiceOverlay.parentNode.removeChild(this.choiceOverlay);
        }
        if (this.captionEl && this.captionEl.parentNode) {
            this.captionEl.parentNode.removeChild(this.captionEl);
        }

        // 注入CSS
        if (this.styleEl && this.styleEl.parentNode) {
            this.styleEl.parentNode.removeChild(this.styleEl);
        }

        if (this.renderer) this.renderer.dispose();

        super.destroy();
    }
}
