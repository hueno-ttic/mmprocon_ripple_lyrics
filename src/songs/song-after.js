import * as THREE from 'three';
import { quality } from '../core/quality.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { eventBus } from '../core/eventBus.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { settleSpringBones } from '../utils/vrm.js';

/**
 * アフター・ザ・カーテン — 「終わりの後に何が残るのか」
 *
 * 劇場ステージ演出:
 *  - スポットライト(実SpotLight)をポインタ(マウス/タッチ統一)で操作し、暗闇の歌詞とミクを照らす
 *  - ステージ中央にミクVRM(脱力ポーズ+呼吸)。照らすと顔がそちらを向き、サビで両腕を広げ星空を見上げる
 *  - 照らし切った歌詞は消える時に暖色の灯となって客席へ飛び、座席に灯り続ける(残光システム)
 *  - バラ紙吹雪は床に積もり、曲終了まで残る
 *  - 終演: 照明が落ち、客席の残光と床のバラだけが闇に浮かぶ
 */
export class SongAfter extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        this.activeSprites = [];
        this.petals = [];
        this.seatLights = [];
        this.stars = null;
        this.lastPhrase = null;
        this.lastPosition = 0;

        this.isClimax = false;
        this.isMobile = window.innerWidth < 768;

        this.themeColor = '#1D9E75';
        this.mouse = new THREE.Vector2(0, 0);

        // スポットライト: 押している(クリック/タップ)間だけ照らす
        this.isPointerDown = false;
        this.spotOn = 0;                    // 0=消灯 → 1=点灯(押下中) を滑らかに補間

        // 赤い緞帳(ミク背後の3D背景幕): 開演で上から降りてきて、そのまま留まる(閉幕しない)
        this._curtainDropped = false;
        this.curtainHiddenY = 30;           // 開演前: フレーム上方に退避(見えない)
        this.curtainRestY = 2;              // 開演後: ミク背後の定位置(降り切った状態)
        this.curtainTex = null;

        // 残光システム
        this.kindledCount = 0;              // 照らし切った歌詞の累計
        this.litThreshold = 1400;           // 照らし切り判定に必要な累計照射時間(ms)
        this.maxSeatLights = this.isMobile ? 60 : 100;

        // バラ
        this.maxPetals = this.isMobile ? 120 : 240;
        this.petalGeo = null;
        this.petalMaterials = [];

        // VRM
        this.currentVRM = null;
        this.poseBlend = 0;       // 0=脱力 → 1=サビ(両腕を広げ星空を見上げる)
        this.headYaw = 0;
        this.headPitch = 0;
        this.mikuBaseY = 0;
        this.mikuBaseZ = -2.0;

        // 終演演出
        this.finaleP = 0;

        // シェーダー/アニメ用の相対時刻基準 (エポック秒の float32 凍結回避)
        this._t0 = performance.now();
        this._lastReal = null;

        this.glowTexture = null;
        this.customStyleElement = null;
        this.counterEl = null;
        this.audienceLight = null;

        this.boundOnResize = this.onResize.bind(this);
        this.boundOnPointerMove = this.onPointerMove.bind(this);
        this.boundOnPointerDown = this.onPointerDown.bind(this);
        this.boundOnPointerUp = this.onPointerUp.bind(this);
        this.boundDropCurtain = () => this.dropCurtain();
    }

    relNow() {
        return (performance.now() - this._t0) / 1000;
    }

    init() {
        this.glowTexture = this.createGlowTexture();
        this.initThree();
        this.initStage();
        this.initStars();
        this.loadMiku();
        this.injectCustomStyles();
        this.createCounterUI();

        window.addEventListener('resize', this.boundOnResize);
        // pointermove/pointerdown でマウス・タッチを統一処理
        this.songWrapper.addEventListener('pointermove', this.boundOnPointerMove);
        this.songWrapper.addEventListener('pointerdown', this.boundOnPointerDown);
        // 押下の解除はウィンドウ全体で拾う(要素外で離しても確実に消灯)
        window.addEventListener('pointerup', this.boundOnPointerUp);
        window.addEventListener('pointercancel', this.boundOnPointerUp);
        // 再生開始(スタート押下)でミク背後に緞帳が降りてくる
        eventBus.on('play', this.boundDropCurtain);

        this.isActive = true;
        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x020a08, 0.03);
        this.scene.background = new THREE.Color(0x020a08);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 15);
        this.camera.lookAt(0, 2, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();

        this.renderer.shadowMap.enabled = quality.useShadows;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;

        // タッチドラッグでスポットライトを動かせるよう、ブラウザ既定のスクロール/ズームを無効化
        this.renderer.domElement.style.touchAction = 'none';
        this.songWrapper.style.touchAction = 'none';

        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initStage() {
        // Stage Floor
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x111b18,
            roughness: 0.7,
            metalness: 0.3
        });
        this.floor = new THREE.Mesh(floorGeo, floorMat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.receiveShadow = !this.isMobile;
        this.scene.add(this.floor);

        // Ambient Light (Very dim, so spotlight effects are dramatic)
        this.ambientLight = new THREE.AmbientLight(0x081512, 0.5);
        this.scene.add(this.ambientLight);

        // Dramatic Sweeping Spotlight (automatic / faint stage wash)
        this.spotLight = new THREE.SpotLight(0xffffff, 22);
        this.spotLight.position.set(0, 20, -2);
        this.spotLight.angle = Math.PI / 6;
        this.spotLight.penumbra = 0.6;
        this.spotLight.decay = 1.5;
        this.spotLight.distance = 50;
        this.spotLight.castShadow = !this.isMobile;
        this.scene.add(this.spotLight);
        this.scene.add(this.spotLight.target);

        // Interactive Spotlight controlled by pointer (mouse + touch)
        this.mouseLight = new THREE.SpotLight(0xfff6e0, 90);
        this.mouseLight.position.set(0, 18, 5);
        this.mouseLight.angle = Math.PI / 8;
        this.mouseLight.penumbra = 0.5;
        this.mouseLight.decay = 1.2;
        this.mouseLight.distance = 40;
        this.scene.add(this.mouseLight);
        this.scene.add(this.mouseLight.target);
        // 滑らかな追従用ターゲット
        this._spotTargetGoal = new THREE.Vector3(0, 0.1, 0);

        // Subtle colored point light for theme mood (控えめ: スポット以外は薄暗く)
        this.pointLight = new THREE.PointLight(new THREE.Color(this.themeColor), 8, 25);
        this.pointLight.position.set(0, 3, 0);
        this.scene.add(this.pointLight);

        // 客席の残光が集まる暖色の微光 (灯が増えるほど明るくなる)
        this.audienceLight = new THREE.PointLight(0xffb070, 0, 35, 1.6);
        this.audienceLight.position.set(0, 2.5, 9);
        this.scene.add(this.audienceLight);

        // 逆光リムライト: ミクの背後(カーテン側)からティールで縁を光らせ、暗闇の中で
        // 「シルエット＋輪郭のグロー」として際立たせる。前へ長い影も落とす(公演後の孤独感)。
        this.rimLight = new THREE.SpotLight(new THREE.Color(this.themeColor), 70);
        this.rimLight.position.set(0, 4.2, -7.5);
        this.rimLight.angle = Math.PI / 7;
        this.rimLight.penumbra = 0.75;
        this.rimLight.decay = 1.3;
        this.rimLight.distance = 28;
        this.rimLight.castShadow = !this.isMobile; // ミクの影をカメラ手前へ長く伸ばす
        if (this.rimLight.shadow) { this.rimLight.shadow.mapSize.set(1024, 1024); this.rimLight.shadow.bias = -0.0005; }
        this.rimLight.target.position.set(0, 1.2, -2);
        this.scene.add(this.rimLight);
        this.scene.add(this.rimLight.target);

        // 赤い緞帳 — ミク背後(Z=-5)の背景幕。開演で上方から降りてくる。
        const curtainGeo = new THREE.PlaneGeometry(44, 24);
        this.curtainTex = this.createCurtainTexture();
        const curtainMat = new THREE.MeshStandardMaterial({
            map: this.curtainTex,
            color: 0xffffff,
            emissive: new THREE.Color(0x3a0509), // 暗がりでも赤がほのかに沈んで見えるように
            roughness: 0.95,
            metalness: 0.0,
            side: THREE.DoubleSide
        });
        this.curtain = new THREE.Mesh(curtainGeo, curtainMat);
        this.curtain.position.set(0, this.curtainHiddenY, -5); // 開演前はフレーム上方に退避
        this.scene.add(this.curtain);

        // 共有バラジオメトリ/マテリアル
        this.petalGeo = new THREE.PlaneGeometry(0.3, 0.4);
        this.petalMaterials = [
            new THREE.MeshStandardMaterial({ color: 0xd61c4e, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide, emissive: new THREE.Color(0x140204) }),
            new THREE.MeshStandardMaterial({ color: 0x1d9e75, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide, emissive: new THREE.Color(0x02140d) })
        ];
    }

    initStars() {
        const starCount = this.isMobile ? 130 : 250;
        const starGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);

        for (let i = 0; i < starCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 60;
            positions[i * 3 + 1] = Math.random() * 25 + 2;
            positions[i * 3 + 2] = -12 - Math.random() * 8;
        }

        starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const starMat = new THREE.PointsMaterial({
            color: 0xBFFFE4,
            size: 0.3,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            map: this.glowTexture || null,
        });

        this.stars = new THREE.Points(starGeo, starMat);
        this.scene.add(this.stars);
    }

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
                // ステージ中央、床の上に立たせる (orchestra実績: rotation.y=0でカメラ正面)
                vrm.scene.position.set(0, this.mikuBaseY, this.mikuBaseZ);
                vrm.scene.rotation.y = 0;
                vrm.scene.scale.setScalar(2.6);
                vrm.scene.traverse((obj) => {
                    if (obj.isMesh) obj.castShadow = !this.isMobile;
                });
                this.setupRelaxedPose(vrm);
                settleSpringBones(vrm); // 開幕時にツインテールが逆立たないよう静止状態へ
                console.log('[AFTER] Miku VRM loaded.');
            },
            undefined,
            (error) => {
                console.error('[AFTER] Failed to load VRM:', error);
            }
        );
    }

    setupRelaxedPose(vrm) {
        if (!vrm || !vrm.humanoid) return;
        const l = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const r = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const ll = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rl = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        if (l) l.rotation.z = -Math.PI / 2.8;
        if (r) r.rotation.z = Math.PI / 2.8;
        if (ll) ll.rotation.y = Math.PI / 12;
        if (rl) rl.rotation.y = -Math.PI / 12;

        const lul = vrm.humanoid.getNormalizedBoneNode('leftUpperLeg');
        const rul = vrm.humanoid.getNormalizedBoneNode('rightUpperLeg');
        if (lul) lul.rotation.z = Math.PI / 30;
        if (rul) rul.rotation.z = -Math.PI / 30;
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(0.25, 'rgba(255, 240, 210, 0.85)');
        gradient.addColorStop(0.55, 'rgba(255, 200, 130, 0.32)');
        gradient.addColorStop(1.0, 'rgba(255, 180, 100, 0.0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    }

    injectCustomStyles() {
        this.customStyleElement = document.createElement('style');
        this.customStyleElement.innerHTML = `
            .after-lights-counter {
                position: absolute;
                right: 18px;
                bottom: 18px;
                z-index: 10;
                padding: 6px 14px;
                border-radius: 18px;
                font-size: 12px;
                letter-spacing: 0.12em;
                color: rgba(255, 214, 160, 0.85);
                background: rgba(2, 12, 9, 0.45);
                border: 1px solid rgba(255, 196, 130, 0.25);
                backdrop-filter: blur(4px);
                pointer-events: none;
                opacity: 0;
                transition: opacity 1.2s ease, color 1.2s ease, border-color 1.2s ease;
                font-family: "Noto Serif JP", "Yu Mincho", serif;
            }
            .after-lights-counter.visible { opacity: 1; }
            .after-lights-counter.finale {
                color: rgba(255, 232, 190, 1);
                border-color: rgba(255, 214, 150, 0.6);
                text-shadow: 0 0 10px rgba(255, 190, 110, 0.7);
            }
            .after-lights-counter .after-count-num {
                font-size: 15px;
                margin: 0 2px;
                color: #ffd9a0;
            }
        `;
        document.head.appendChild(this.customStyleElement);
    }

    createCounterUI() {
        this.counterEl = document.createElement('div');
        this.counterEl.className = 'after-lights-counter';
        this.counterEl.innerHTML = `客席の灯 <span class="after-count-num">0</span>`;
        this.songWrapper.appendChild(this.counterEl);
    }

    updateCounterUI() {
        if (!this.counterEl) return;
        const num = this.counterEl.querySelector('.after-count-num');
        if (num) num.textContent = String(this.kindledCount);
        if (this.kindledCount > 0) this.counterEl.classList.add('visible');
    }

    // ─── 赤い緞帳: 開演でミク背後に上から降りてくる(閉幕しない) ───
    dropCurtain() {
        this._curtainDropped = true;
    }

    // ベロアの赤い緞帳テクスチャ(縦ひだ + 上下の陰影 + 裾の金モール)
    createCurtainTexture() {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 512;
        const ctx = c.getContext('2d');
        // 縦ひだ: x方向に明暗を周期変化させてベロアの折り目を表現
        const folds = 16;
        for (let x = 0; x < 512; x++) {
            const shade = Math.sin(x / 512 * folds * Math.PI * 2) * 0.5 + 0.5; // 0..1
            const r = Math.round(38 + shade * 130);
            const g = Math.round(2 + shade * 18);
            const b = Math.round(6 + shade * 24);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, 0, 1, 512);
        }
        // 上下の陰影(天地を落ち着かせる)
        const vg = ctx.createLinearGradient(0, 0, 0, 512);
        vg.addColorStop(0.0, 'rgba(0,0,0,0.55)');
        vg.addColorStop(0.18, 'rgba(0,0,0,0)');
        vg.addColorStop(0.88, 'rgba(0,0,0,0)');
        vg.addColorStop(1.0, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, 512, 512);
        // 裾の金モール
        const fg = ctx.createLinearGradient(0, 474, 0, 512);
        fg.addColorStop(0.0, 'rgba(214,176,86,0)');
        fg.addColorStop(0.6, 'rgba(214,176,86,0.7)');
        fg.addColorStop(1.0, 'rgba(150,110,40,0.95)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 474, 512, 38);
        return new THREE.CanvasTexture(c);
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ─── ポインタ統一入力 (マウス + タッチ) ───
    updateSpotFromClient(clientX, clientY) {
        this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;
        // ステージ床座標へマッピング
        this._spotTargetGoal.set(this.mouse.x * 12, 0.1, -this.mouse.y * 6);
    }

    onPointerMove(event) {
        if (!this.isActive || this.finaleP > 0.05) return;
        // 押している(クリック/タップ)間だけスポットライトが追尾する
        if (!this.isPointerDown) return;
        this.updateSpotFromClient(event.clientX, event.clientY);
    }

    onPointerUp() {
        // 指/ボタンを離したら消灯(spotOnが滑らかに0へ落ちる)
        this.isPointerDown = false;
    }

    onPointerDown(event) {
        if (!this.isActive || !this.renderer || !this.camera) return;
        if (this.finaleP > 0.05) return; // 終演中は操作を受けない

        // 押下開始: ここから照射が点灯し、ドラッグで追尾する
        this.isPointerDown = true;
        if (event.pointerId != null && this.songWrapper.setPointerCapture) {
            try { this.songWrapper.setPointerCapture(event.pointerId); } catch (e) { /* noop */ }
        }

        // タップ位置にもスポットライトを即移動 (タッチではmoveより先にdownが来る)
        this.updateSpotFromClient(event.clientX, event.clientY);

        // Raycast to Z=0 plane to spawn confetti precisely where tapped in 3D
        const rect = this.renderer.domElement.getBoundingClientRect();
        const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const intersectionPoint = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
            this.spawnPetals(intersectionPoint);
        }
    }

    // BaseSong既定のクリック波紋(DOM)とバラの二重生成を抑止 — pointerdownに一本化
    onClick() {}

    // ─── バラ紙吹雪: 床に積もり、曲が終わるまで残る ───
    spawnPetals(origin) {
        const count = this.isMobile ? 8 : 14;
        for (let i = 0; i < count; i++) {
            const mat = this.petalMaterials[Math.random() > 0.35 ? 0 : 1];
            const mesh = new THREE.Mesh(this.petalGeo, mat);

            mesh.position.set(
                origin.x + (Math.random() - 0.5) * 4,
                origin.y + Math.random() * 5 + 4,
                origin.z + (Math.random() - 0.5) * 4
            );
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);

            mesh.userData = {
                vx: (Math.random() - 0.5) * 0.04,
                vy: -0.04 - Math.random() * 0.04,
                vz: (Math.random() - 0.5) * 0.04,
                rotSpeedX: (Math.random() - 0.5) * 0.06,
                rotSpeedY: (Math.random() - 0.5) * 0.06,
                flutterPhase: Math.random() * Math.PI * 2,
                isFloored: false,
                fading: false,
                fadeStart: 0
            };

            this.scene.add(mesh);
            this.petals.push(mesh);
        }

        // 上限超過時は最も古いものから静かにフェード (終盤までは残留感を維持)
        let over = this.petals.length - this.maxPetals;
        for (let i = 0; over > 0 && i < this.petals.length; i++) {
            const p = this.petals[i];
            if (!p.userData.fading) {
                this.startPetalFade(p);
                over--;
            }
        }
    }

    startPetalFade(petal) {
        petal.userData.fading = true;
        petal.userData.fadeStart = this.relNow();
        // 共有マテリアルを汚さないようクローンしてフェード
        petal.material = petal.material.clone();
        petal.material.transparent = true;
        petal.userData.ownMaterial = true;
    }

    // ─── 歌詞テクスチャ ───
    createTextTexture(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, 1024, 128);

        // 長い歌詞でも端が切れないよう、テキスト幅を計測してフォントを自動縮小する
        const maxWidth = 1024 - 80; // 左右パディング
        let fontSize = 72;
        const minFont = 34;
        do {
            ctx.font = `bold ${fontSize}px "Noto Serif JP", "Yu Mincho", serif`;
            if (ctx.measureText(text).width <= maxWidth) break;
            fontSize -= 4;
        } while (fontSize > minFont);

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 12;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 512, 64);
        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 4;
        return tex;
    }

    // ─── フレーズを文法的に意味のある単位で「もう少しだけ」短く区切る ───
    // 句読点・空白で必ず切り、長い節は助詞・接続のあとで近い中点を選んで分割する。
    // 文法的な切れ目が見つからない場合は無理に割らず、そのまま1つとして扱う。
    splitPhraseText(text) {
        const src = (text || '').trim();
        if (!src) return [];
        const SOFT_MAX = 14; // これ以下はそのまま出す(=もう少しだけ短く、過分割しない)
        // 「直後で切っても語を割らない」助詞・記号に限定する。
        // よ/ね/か/な/さ/っ など語中に紛れやすい字は誤分割を招くので含めない。
        const PARTICLE = 'はがをにへとでもやの、。，．！？・…」』';

        const splitOnce = (s) => {
            if (s.length <= SOFT_MAX) return [s];
            const mid = s.length / 2;
            let best = -1, bestDist = Infinity;
            // 末尾以外で、助詞などの直後(=区切って意味が通る位置)を中点近くから探す
            for (let i = 1; i < s.length - 1; i++) {
                if (PARTICLE.indexOf(s[i]) !== -1) {
                    const d = Math.abs((i + 1) - mid);
                    if (d < bestDist) { bestDist = d; best = i + 1; }
                }
            }
            if (best <= 0 || best >= s.length) return [s]; // 自然な切れ目なし → 割らない
            return [s.slice(0, best).trim(), s.slice(best).trim()].filter(Boolean);
        };

        // 明示的な区切り(空白・読点)でまず割ってから、長い節をさらに一段分割
        const out = [];
        for (const part of src.split(/[\s、，]+/).filter(Boolean)) {
            for (const seg of splitOnce(part)) out.push(seg);
        }
        return out.length ? out : [src];
    }

    spawnText(phrase, spawnTime) {
        const chunks = this.splitPhraseText(phrase.text);
        // 区切った各チャンクを、読む順に少し時間差を付けて出す
        for (let ci = 0; ci < chunks.length; ci++) {
            this.spawnTextChunk(chunks[ci], spawnTime + ci * 450);
        }
    }

    spawnTextChunk(text, spawnTime) {
        const texture = this.createTextTexture(text);

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            transparent: true,
            opacity: 0,
            alphaTest: 0.005,
            color: 0xffffff,
            emissive: new THREE.Color(0x000000),
            roughness: 0.6,
            metalness: 0.1,
            side: THREE.DoubleSide
        });

        const geo = new THREE.PlaneGeometry(1024 / 110, 128 / 110);
        const mesh = new THREE.Mesh(geo, material);

        mesh.position.set(
            (Math.random() - 0.5) * 16,
            Math.random() * 4.5 + 1.2,
            (Math.random() - 0.5) * 6 - 1
        );
        mesh.castShadow = !this.isMobile;

        mesh.userData = {
            birth: spawnTime,
            life: 9000,
            hoverProgress: 0,
            litTime: 0,        // 累計照射時間(ms)
            kindled: false,    // 照らし切り済みフラグ
            kindleFlash: 0,
            baseY: mesh.position.y,
            spinFactor: (Math.random() - 0.5) * 0.15,
            text: text
        };

        mesh.scale.set(1, 1, 1);
        mesh.lookAt(new THREE.Vector3(this.camera.position.x, mesh.position.y, this.camera.position.z));

        this.scene.add(mesh);
        this.activeSprites.push(mesh);
    }

    // ─── 残光システム: 照らし切った歌詞が客席の灯になる ───
    spawnSeatLight(fromPos) {
        if (this.seatLights.length >= this.maxSeatLights) {
            const old = this.seatLights.shift();
            this.scene.remove(old);
            old.material.dispose();
        }

        const mat = new THREE.SpriteMaterial({
            map: this.glowTexture,
            color: new THREE.Color().setHSL(0.075 + Math.random() * 0.03, 0.9, 0.62),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const spr = new THREE.Sprite(mat);
        spr.position.copy(fromPos);
        spr.scale.setScalar(0.05);

        // 客席: 画面下方(カメラ手前)の暗がり。奥から手前へ向かって座席が高くなる
        const seatZ = 5 + Math.random() * 8;
        const seatX = (Math.random() - 0.5) * 20;
        const seatY = 0.35 + (seatZ - 5) * 0.12 + Math.random() * 0.2;
        const to = new THREE.Vector3(seatX, seatY, seatZ);
        const ctrl = fromPos.clone().lerp(to, 0.5);
        ctrl.y += 2.5 + Math.random() * 1.5; // ふわりと弧を描いて飛ぶ

        spr.userData = {
            phase: 'fly',
            t: 0,
            from: fromPos.clone(),
            ctrl,
            to,
            flicker: Math.random() * Math.PI * 2,
            baseScale: 0.42 + Math.random() * 0.14
        };

        this.scene.add(spr);
        this.seatLights.push(spr);

        this.kindledCount++;
        this.updateCounterUI();

        // エンドカードへ成果を登録(灯が増えるたび最新化)
        this.setResultSummary({
            accentColor: '#E8A84C',
            lines: [
                `客席に残った灯 ${this.kindledCount}`,
                '終わりの後にも、灯りは消えない',
            ],
        });
    }

    updateSeatLights(dt) {
        const rel = this.relNow();
        const tmp = new THREE.Vector3();
        for (const spr of this.seatLights) {
            const ud = spr.userData;
            if (ud.phase === 'fly') {
                ud.t = Math.min(1, ud.t + dt / 1.7);
                const t = ud.t;
                // Quadratic bezier flight
                const inv = 1 - t;
                tmp.set(0, 0, 0)
                    .addScaledVector(ud.from, inv * inv)
                    .addScaledVector(ud.ctrl, 2 * inv * t)
                    .addScaledVector(ud.to, t * t);
                spr.position.copy(tmp);
                spr.material.opacity = Math.min(0.95, t * 1.6);
                spr.scale.setScalar(0.05 + ud.baseScale * t);
                if (t >= 1) ud.phase = 'lit';
            } else {
                // 座席で静かに灯り続ける (ろうそくの揺らぎ)
                const flick = Math.sin(rel * 2.2 + ud.flicker) * 0.5 + Math.sin(rel * 5.7 + ud.flicker * 2) * 0.5;
                spr.material.opacity = 0.62 + flick * 0.16;
                spr.scale.setScalar(ud.baseScale * (1 + flick * 0.07));
            }
        }
    }

    // ─── ミクVRMの毎フレーム更新 ───
    updateMiku(dt, rel) {
        const vrm = this.currentVRM;
        if (!vrm || !vrm.humanoid) return;

        // サビポーズへのブレンド (終演中は静かに脱力へ戻る)
        const poseTarget = (this.isClimax && this.finaleP < 0.3) ? 1 : 0;
        this.poseBlend += (poseTarget - this.poseBlend) * Math.min(1, dt * 2.2);
        const b = this.poseBlend;
        const lerp = (a, c) => a + (c - a) * b;

        // 呼吸: 胸のわずかな上下とスケール揺れ
        const breath = Math.sin(rel * 1.5) * 0.5 + 0.5;
        vrm.scene.position.y = this.mikuBaseY + breath * 0.015 - 0.0075;
        const spine = vrm.humanoid.getNormalizedBoneNode('spine');
        if (spine) spine.rotation.x = breath * 0.025 - 0.0125 + b * -0.12; // サビでは胸を反らす
        const chest = vrm.humanoid.getNormalizedBoneNode('chest');
        if (chest) chest.rotation.x = breath * 0.02 - 0.01;

        // 逆光リムを呼吸に合わせて静かに脈動させ、シルエットの輪郭を息づかせる。
        // サビはオープンポーズで縁が広がるぶん少し強める。
        if (this.rimLight) {
            this.rimLight.intensity = 62 + breath * 16 + b * 22;
            this.rimLight.target.position.set(vrm.scene.position.x, 1.2, vrm.scene.position.z);
        }

        // 腕: 脱力 → サビで両腕を大きく広げる
        const lU = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rU = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const lL = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rL = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        const sway = Math.sin(rel * 1.5 + 1.2) * 0.02; // 腕も呼吸に同期して微かに揺れる
        // サビは「Tポーズ」ではなく45°のオープンポーズ+肘の柔らかい曲げで人間らしく
        // 新VRMは上腕ロール軸が逆: 左+/右- が下げ方向。脱力(下げ)→サビでオープン
        if (lU) {
            lU.rotation.z = lerp(Math.PI / 2.8, Math.PI / 4.2) + sway;
            lU.rotation.x = lerp(0, -0.38);
            lU.rotation.y = lerp(0, 0.15);
        }
        if (rU) {
            rU.rotation.z = lerp(-Math.PI / 2.8, -Math.PI / 4.2) - sway;
            rU.rotation.x = lerp(0, -0.38);
            rU.rotation.y = lerp(0, -0.15);
        }
        if (lL) {
            lL.rotation.y = lerp(Math.PI / 12, Math.PI / 5);
            lL.rotation.z = lerp(0, -0.18);
        }
        if (rL) {
            rL.rotation.y = lerp(-Math.PI / 12, -Math.PI / 5);
            rL.rotation.z = lerp(0, 0.18);
        }

        // ちょくちょく客席(プレイヤー)へ手を振る挨拶。ミクは正面を向いたまま。
        // サビ(両腕オープン)・終演中は本来の演出を優先するので挨拶しない。
        if (this.greetTimer === undefined) {
            this.greetTimer = 6 + Math.random() * 4; this.greetActive = false;
            this.greetElapsed = 0; this.greetWave = 0;
        }
        const greetBusy = this.isClimax || this.finaleP >= 0.3;
        if (greetBusy) {
            this.greetActive = false; this.greetWave = 0;
        } else if (!this.greetActive) {
            this.greetTimer -= dt;
            if (this.greetTimer <= 0) { this.greetActive = true; this.greetElapsed = 0; }
        }
        if (this.greetActive) {
            const GD = 2.8;
            this.greetElapsed += dt;
            this.greetWave = Math.sin(Math.min(1, this.greetElapsed / GD) * Math.PI); // 0→1→0
            if (this.greetElapsed >= GD) {
                this.greetActive = false; this.greetWave = 0;
                this.greetTimer = 7 + Math.random() * 5;
            }
        }
        if (this.greetWave > 0 && rU) {
            const wv = this.greetWave;
            const swing = Math.sin(rel * 9) * 0.28; // 手を左右に振る(穏やかに)
            // 右腕は z+ で上がる。頭の高さ程度に留め(万歳にしない)、左右にゆらす
            rU.rotation.z += (0.5 - rU.rotation.z) * wv + swing * wv;
            rU.rotation.x += (-0.5 - rU.rotation.x) * wv;       // 前方(客席)へ
            if (rL) rL.rotation.y += (-1.2 - rL.rotation.y) * wv; // 肘を曲げ手を顔の横へ
        }

        // 頭: スポットライトがミク付近に当たると顔をそちらへ (クランプ付き)
        const head = vrm.humanoid.getNormalizedBoneNode('head');
        if (head) {
            let targetYaw = 0;
            let targetPitch = 0;

            const spot = this.mouseLight.target.position;
            const dx = spot.x - vrm.scene.position.x;
            const dz = spot.z - vrm.scene.position.z;
            const distToMiku = Math.sqrt(dx * dx + dz * dz);

            if (distToMiku < 5.0 && this.finaleP < 0.3) {
                // 光の差す方向(客席側の操作者方向)を見る
                const lookPoint = new THREE.Vector3(spot.x * 0.9, 4.0, 11);
                const headWorld = head.getWorldPosition(new THREE.Vector3());
                const diff = lookPoint.sub(headWorld);
                // ミク正面はローカル+Z (rotation.y=0)
                targetYaw = Math.atan2(diff.x, diff.z);
                targetPitch = -Math.atan2(diff.y, Math.sqrt(diff.x * diff.x + diff.z * diff.z));
                // 人間らしい可動域にクランプ
                targetYaw = Math.max(-0.65, Math.min(0.65, targetYaw));
                targetPitch = Math.max(-0.45, Math.min(0.35, targetPitch));
            }

            // サビ: 開いたカーテンの向こうの星空を見上げる
            targetYaw = targetYaw * (1 - b);
            targetPitch = targetPitch * (1 - b) + (-0.52) * b;

            this.headYaw += (targetYaw - this.headYaw) * Math.min(1, dt * 4);
            this.headPitch += (targetPitch - this.headPitch) * Math.min(1, dt * 4);
            head.rotation.y = this.headYaw;
            head.rotation.x = this.headPitch;
        }

        vrm.update(dt);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        // TextAlive公式タイマー(player.timer.position)に完全同期
        const position = (playerManager.player && playerManager.player.timer)
            ? playerManager.player.timer.position
            : this.getSmoothedTime();

        const rel = this.relNow();
        let dt = 0.016;
        if (this._lastReal !== null) {
            dt = Math.min(0.1, Math.max(0.001, rel - this._lastReal));
        }
        this._lastReal = rel;

        const dtMs = Math.max(0, Math.min(120, position - this.lastPosition));
        this.lastPosition = position;

        const chorus = playerManager.player && typeof playerManager.player.findChorus === 'function'
            ? playerManager.player.findChorus(position) : null;
        this.isClimax = !!chorus;

        // ─── 終演の余韻: 曲の最後で照明が落ち、残光とバラだけが闇に浮かぶ ───
        const duration = playerManager.player.video.duration || 0;
        if (duration > 0) {
            const finaleStart = duration - 7000;
            this.finaleP = Math.max(0, Math.min(1, (position - finaleStart) / 4000));
        }
        const f = this.finaleP;
        const stageDim = 1 - f;

        // 押している間だけ点灯。離すと滑らかに消灯する
        const spotGoal = (this.isPointerDown && f < 0.05) ? 1 : 0;
        this.spotOn += (spotGoal - this.spotOn) * Math.min(1, dt * 8);

        // 照明フェード (スポット以外は薄暗く保つ)
        this.spotLight.intensity = 22 * stageDim;
        this.mouseLight.intensity = 130 * stageDim * this.spotOn; // 押下中のみ照射
        this.pointLight.intensity = 8 * stageDim;
        this.ambientLight.intensity = Math.max(0.04, 0.5 * stageDim);
        // 客席の灯: 数に応じて暖かく。終演時はそれだけが世界を照らす
        const seatGlow = Math.min(1, this.seatLights.length / 40);
        this.audienceLight.intensity = seatGlow * (1.8 + f * 7.0);

        if (f > 0.5 && this.counterEl && !this.counterEl.classList.contains('finale')) {
            this.counterEl.classList.add('finale');
            this.counterEl.innerHTML = `残った灯 <span class="after-count-num">${this.kindledCount}</span>`;
            this.counterEl.classList.add('visible');
        }

        // 1. 緞帳 — 開演で上方からミク背後へすっと降り、そのまま留まる(閉幕しない)
        const curtainTargetY = this._curtainDropped ? this.curtainRestY : this.curtainHiddenY;
        this.curtain.position.y += (curtainTargetY - this.curtain.position.y) * Math.min(1, dt * 1.6);
        // 星空: サビは緞帳の上の夜空が瞬く
        const starTarget = (this.isClimax && f < 0.3) ? 0.9 : 0.0;
        if (this.stars) this.stars.material.opacity += (starTarget - this.stars.material.opacity) * 0.04;

        // 自動スイープスポットライト (相対秒で駆動)
        this.spotLight.position.x = Math.sin(rel * 0.8) * 8;
        this.spotLight.target.position.x = Math.sin(rel * 0.8) * 4;
        this.spotLight.target.updateMatrixWorld();

        // ポインタライトの滑らかな追従
        this.mouseLight.target.position.lerp(this._spotTargetGoal, Math.min(1, dt * 10));
        this.mouseLight.position.x += (this._spotTargetGoal.x * 0.4 - this.mouseLight.position.x) * Math.min(1, dt * 5);
        this.mouseLight.target.updateMatrixWorld();

        // ─── 歌詞 ───
        // DOM歌詞は常に非表示: 「スポットライトで照らして読む」3D歌詞が
        // この曲の唯一の歌詞表示(常時表示はコンセプトを壊す)
        const phrase = playerManager.player.video.findPhrase(position);
        if (this.lyricRenderer) {
            this.lyricRenderer.update(null);
        }

        if (phrase && phrase !== this.lastPhrase && f < 0.2) {
            this.lastPhrase = phrase;
            this.spawnText(phrase, position);
        } else if (!phrase) {
            this.lastPhrase = null;
        }

        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);

        // 2. Update Interactive 3D Lyrics
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const mesh = this.activeSprites[i];
            const ud = mesh.userData;
            const age = Math.max(0, position - ud.birth);

            const spotTarget = this.mouseLight.target.position;
            // sqrtを避け2乗距離で比較(4.2 → 4.2²)。毎フレーム×全スプライトの平方根を削減。
            const distToSpotSq = mesh.position.distanceToSquared(spotTarget);
            // スポットライトは押下中のみ有効(spotOn)。サビは舞台全体が照らされ、
            // すべての歌詞が浮かび上がる(受動的に聴いていても見せ場が伝わる)。
            const litBySpot = distToSpotSq < 4.2 * 4.2 && this.spotOn > 0.4;
            const isIlluminated = (litBySpot || this.isClimax) && f < 0.3;
            const targetProgress = isIlluminated ? 1.0 : 0.0;
            ud.hoverProgress += (targetProgress - ud.hoverProgress) * 0.08;
            const p = ud.hoverProgress;

            // 照射時間の蓄積 → 照らし切り(kindle)判定
            if (isIlluminated) {
                ud.litTime += dtMs;
                if (!ud.kindled && ud.litTime >= this.litThreshold) {
                    ud.kindled = true;
                    ud.kindleFlash = 1.0;
                }
            }
            ud.kindleFlash *= 0.94;

            // Float up and drift smoothly
            mesh.position.y = ud.baseY + Math.sin(position * 0.0015 + ud.birth) * 0.25 * p + (age * 0.00025);
            mesh.rotation.y = Math.sin(position * 0.001) * 0.12 * p + (ud.spinFactor * p);

            // 歌唱パルス
            const isWordActive = word && ud.text && ud.text.includes(word.text)
                              && position >= word.startTime && position <= word.endTime;
            if (!ud.pulseProgress) ud.pulseProgress = 0;
            ud.pulseProgress += ((isWordActive ? 1 : 0) - ud.pulseProgress) * 0.2;
            const pulse = ud.pulseProgress;
            const s = (1.0 + p * 0.35) * (1.0 + pulse * 0.25) * (1.0 + ud.kindleFlash * 0.15);
            mesh.scale.set(s, s, 1);

            // 発光: 通常はエメラルド。照らし切ると暖色の灯色へ移ろう
            const litRatio = Math.min(1, ud.litTime / this.litThreshold);
            const hue = 0.44 + pulse * 0.05 - litRatio * 0.36; // 0.44(緑) → 0.08(暖色)
            const lum = (0.45 * p + pulse * 0.45 + ud.kindleFlash * 0.5 + (ud.kindled ? 0.18 : 0)) * stageDim;
            mesh.material.emissive.setHSL(Math.max(0.06, hue), 0.85, Math.min(0.85, lum));

            // Fade in/out
            if (age < 150) {
                mesh.material.opacity = age / 150;
            } else if (age > ud.life - 200) {
                mesh.material.opacity = Math.max(0, (ud.life - age) / 200);
            } else {
                mesh.material.opacity = 1.0;
            }

            if (age > ud.life || f >= 1) {
                // 照らし切った歌詞は、消える瞬間に客席の灯として残る
                if (ud.kindled && f < 1) {
                    this.spawnSeatLight(mesh.position.clone());
                }
                this.scene.remove(mesh);
                mesh.material.map.dispose();
                mesh.material.dispose();
                mesh.geometry.dispose();
                this.activeSprites.splice(i, 1);
            }
        }

        // 3. Petals: 床に積もり、曲が終わるまで残る
        for (let i = this.petals.length - 1; i >= 0; i--) {
            const mesh = this.petals[i];
            const ud = mesh.userData;

            if (!ud.isFloored) {
                mesh.position.x += ud.vx + Math.sin(rel * 3.5 + ud.flutterPhase) * 0.015;
                mesh.position.y += ud.vy;
                mesh.position.z += ud.vz;
                mesh.rotation.x += ud.rotSpeedX;
                mesh.rotation.y += ud.rotSpeedY;

                if (mesh.position.y <= 0.08) {
                    mesh.position.y = 0.08;
                    ud.isFloored = true;
                    mesh.rotation.x = -Math.PI / 2;
                    mesh.rotation.y = 0;
                    mesh.rotation.z = Math.random() * Math.PI * 2;
                }
            } else if (!ud.toLamp && !ud.fading) {
                // 床のバラをスポットライトでじっくり照らすと、灯に変わって客席へ
                // (押下中=spotOnのときだけ照射が効く)
                const spot = this.mouseLight.target.position;
                const dx = mesh.position.x - spot.x;
                const dz = mesh.position.z - spot.z;
                if (this.spotOn > 0.4 && dx * dx + dz * dz < 3.2) {
                    ud.roseLit = (ud.roseLit || 0) + dt * 1000;
                    if (ud.roseLit >= 900 && this.relNow() - (this._lastRoseLamp || 0) > 0.45) {
                        this._lastRoseLamp = this.relNow();
                        ud.toLamp = true;
                        this.spawnSeatLight(mesh.position.clone());
                        this.startPetalFade(mesh); // 共有マテリアルを汚さない正規ルート
                    }
                }
            }

            // 上限超過でフェード指定されたものだけ静かに消える
            if (ud.fading) {
                const ft = this.relNow() - ud.fadeStart;
                mesh.material.opacity = Math.max(0, 1 - ft / 2.5);
                if (ft > 2.5) {
                    this.scene.remove(mesh);
                    if (ud.ownMaterial) mesh.material.dispose();
                    this.petals.splice(i, 1);
                }
            }
        }

        // 4. 客席の残光
        this.updateSeatLights(dt);

        // 5. ミク
        this.updateMiku(dt, rel);
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    disposeVRM(vrm) {
        if (!vrm) return;
        vrm.scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach((m) => {
                    if (m.map) m.map.dispose();
                    if (m.normalMap) m.normalMap.dispose();
                    if (m.emissiveMap) m.emissiveMap.dispose();
                    m.dispose();
                });
            }
        });
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        window.removeEventListener('pointerup', this.boundOnPointerUp);
        window.removeEventListener('pointercancel', this.boundOnPointerUp);
        eventBus.off('play', this.boundDropCurtain);
        if (this.songWrapper) {
            this.songWrapper.removeEventListener('pointermove', this.boundOnPointerMove);
            this.songWrapper.removeEventListener('pointerdown', this.boundOnPointerDown);
        }

        // 歌詞メッシュ
        this.activeSprites.forEach(mesh => {
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
            mesh.geometry.dispose();
        });
        this.activeSprites = [];

        // バラ (共有geo/matは下でまとめてdispose。クローンのみ個別解放)
        this.petals.forEach(mesh => {
            if (mesh.userData.ownMaterial) mesh.material.dispose();
        });
        this.petals = [];
        if (this.petalGeo) this.petalGeo.dispose();
        this.petalMaterials.forEach(m => m.dispose());
        this.petalMaterials = [];

        // 客席の灯
        this.seatLights.forEach(spr => spr.material.dispose());
        this.seatLights = [];

        if (this.glowTexture) this.glowTexture.dispose();

        if (this.stars) {
            this.stars.geometry.dispose();
            this.stars.material.dispose();
        }
        if (this.floor) {
            this.floor.geometry.dispose();
            this.floor.material.dispose();
        }
        if (this.curtain) {
            this.curtain.geometry.dispose();
            if (this.curtain.material.map) this.curtain.material.map.dispose();
            this.curtain.material.dispose();
        }

        // VRM
        if (this.currentVRM) {
            this.scene.remove(this.currentVRM.scene);
            this.disposeVRM(this.currentVRM);
            this.currentVRM = null;
        }

        if (this.spotLight && this.spotLight.target) this.scene.remove(this.spotLight.target);
        if (this.mouseLight && this.mouseLight.target) this.scene.remove(this.mouseLight.target);

        if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss?.(); }

        if (this.customStyleElement && this.customStyleElement.parentNode) {
            this.customStyleElement.parentNode.removeChild(this.customStyleElement);
        }
        this.counterEl = null;

        super.destroy();
    }
}
