import * as THREE from 'three';
import { sfx } from '../core/sfx.js';
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
 *  - 歌詞を一定時間照らし切ると、光って弾け、紙吹雪となって舞い降りる(破裂演出)
 *  - 弾けた歌詞は同時に暖色の灯となって客席へ飛び、座席に灯り続ける(残光システム)
 *  - 紙吹雪は床に積もり、曲終了まで残る(降るのは破裂した歌詞からのみ)
 *  - 終演: 照明が落ち、客席の残光と床の紙吹雪だけが闇に浮かぶ
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
        this._beamDir = new THREE.Vector3();   // スポットライトのビーム軸(毎フレーム再利用)
        this._toLyric = new THREE.Vector3();   // ビーム始点→歌詞ベクトル(毎フレーム再利用)
        // ミクの「顔だけ」注視: 最も強く照らされている歌詞の方を向く(本体は正面のまま)
        this._lyricFocus = new THREE.Vector3(0, 3, 0); // 注視対象(照らされている歌詞)のワールド位置
        this._lyricFocusW = 0;                         // 注視の重み(=照射度)。0で正面へ戻る
        this._headWorld = new THREE.Vector3();         // 頭のワールド位置(毎フレーム再利用)
        this._softFocus = new THREE.Vector3(0, 3, 0);  // 照らしていなくても「出たばかりの歌詞」の方へ視線を送る対象

        // スポットライト: 押している(クリック/タップ)間だけ照らす
        this.isPointerDown = false;
        this.spotOn = 0;                    // 0=消灯 → 1=点灯(押下中) を滑らかに補間

        // ─── 緞帳(前面カーテン) & 幕間の湖 ───
        // preroll: 夜の湖を背景に見せたまま開演を待つ(カーテンは上方へ退避)
        // intro  : スタート押下後、カーテンが上からゆっくり降りて視界を覆う → 降り切って曲開始
        // show   : カーテンは閉じたまま。歌詞を紙吹雪にするたび合わせ目から光が漏れる
        // 終演   : 紙吹雪にした量に応じてカーテンが上へ開き、その先に晴天の湖が広がる
        this.actPhase = 'preroll';          // preroll → intro → show
        this.introP = 0;                    // イントロのカーテン降下進捗 0→1
        this.introDur = 6.5;                // 降下にかける秒数(ゆっくり降ろす)
        this._introStartRel = 0;
        this._musicResumed = false;

        this.curtainW = 80;                 // 背景(湖)を覆う前面カーテン
        this.curtainH = 46;
        this.curtainCoverY = 13;            // 閉: 視界を覆う定位置
        this.curtainOpenY = 65;             // 開: フレーム上方へ退避(下端が画面外)
        this.curtainOpen = 0;               // 終演の開き具合 0(閉)→1(全開)
        this.curtainMinOpen = 0.18;         // 紙吹雪が少なくても最低これだけは開く
        this.openFullCount = this.isMobile ? 8 : 12; // この数を照らし切れば終演で全開
        this._curtainLeak = 0;              // 合わせ目からの漏れ光(破裂でパルス)
        this.curtainTex = null;
        this.leakPlane = null;
        this.lake = null;                   // 夜→晴天の湖背景(self-contained / 共有依存なし)

        // 残光システム
        this.kindledCount = 0;              // 照らし切った歌詞の累計
        this.litThreshold = 2200;           // 照らし切り判定に必要な累計照射時間(ms)(しっかり当てないと弾けない)
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
        this.boundOnPlay = () => this.onPlayEvent();
    }

    relNow() {
        return (performance.now() - this._t0) / 1000;
    }

    init() {
        this.glowTexture = this.createGlowTexture();
        this.initThree();
        this.initStage();
        this.initStars();
        this.initLake();
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
        // 再生開始(スタート押下)で、まず夜の湖の前にカーテンを降ろし、降り切ってから曲を始める
        eventBus.on('play', this.boundOnPlay);

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

        // 赤い緞帳 — 背景(湖)を覆う前面カーテン(Z=-5)。開演前は上方へ退避し、
        // イントロで降りて視界を覆い、終演で再び上へ開いて湖を見せる。
        const curtainGeo = new THREE.PlaneGeometry(this.curtainW, this.curtainH);
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
        this.curtain.position.set(0, this.curtainOpenY, -5); // 開演前はフレーム上方に退避
        this.scene.add(this.curtain);

        // 緞帳の合わせ目から漏れる光 — 破裂のたびに一瞬強まり、閉じている間だけ見える。
        const leakGeo = new THREE.PlaneGeometry(2.6, this.curtainH);
        const leakMat = new THREE.MeshBasicMaterial({
            map: this.glowTexture,
            color: 0xffe6b0,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        this.leakPlane = new THREE.Mesh(leakGeo, leakMat);
        this.leakPlane.position.set(0, this.curtainOpenY, -4.8); // カーテン手前で一緒に昇降
        this.scene.add(this.leakPlane);

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
                // ステージ中央、床の上に立たせ、客席(カメラ)へ正面を向ける。
                // このVRMは rotation.y=0 だと背中がカメラを向くため、π回して正面に。
                vrm.scene.position.set(0, this.mikuBaseY, this.mikuBaseZ);
                vrm.scene.rotation.y = Math.PI;
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

    // ─── 再生開始(スタート押下): まず夜の湖の前でカーテンを降ろし、降り切ってから曲を始める ───
    onPlayEvent() {
        if (this.actPhase !== 'preroll') return; // 自前の requestPlay 再発火は無視
        this.actPhase = 'intro';
        this._introStartRel = this.relNow();
        // カーテン降下のあいだ曲を頭で待たせる。
        // (requestPause/Seek が効かない環境では降下が曲頭に重なるだけで、曲は止まらない)
        try {
            playerManager.player.requestPause();
            playerManager.player.requestMediaSeek(0);
        } catch (e) { /* noop */ }
    }

    // ─── 幕間の湖背景(夜→晴天) — kotaeteLakes を参考にした self-contained 実装 ───
    // カーテン背後(Z=-72〜-96)に夜空と水面を置き、uDay(0=夜,1=晴天)で色を切り替える。
    // 共有モジュールへは依存せず、afterシーン内で完結させる(fog:false で常にクリア)。
    initLake() {
        const skyUni = { uDay: { value: 0 }, uTime: { value: 0 } };
        const skyMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
            uniforms: skyUni,
            vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
            fragmentShader: `
              varying vec2 vUv; uniform float uDay, uTime;
              void main(){
                float h = vUv.y;
                vec3 nightTop = vec3(0.012,0.03,0.10);
                vec3 nightBot = vec3(0.05,0.12,0.27);
                vec3 dayTop   = vec3(0.50,0.74,0.52);
                vec3 dayBot   = vec3(0.86,0.97,0.88);
                vec3 night = mix(nightBot, nightTop, smoothstep(0.0,0.9,h));
                vec3 day   = mix(dayBot,   dayTop,   smoothstep(-0.1,0.85,h));
                // 月(夜) / 太陽の光芒(昼) を中央やや上に
                vec2 c = vec2(0.5, 0.62);
                float d = distance(vUv, c);
                float moon = smoothstep(0.055,0.0,d);
                float halo = pow(smoothstep(0.35,0.0,d), 2.0);
                night += vec3(0.7,0.78,0.85)*moon + vec3(0.10,0.13,0.18)*halo;
                float sun = pow(smoothstep(0.5,0.0,d), 3.0);
                day += vec3(1.0,1.0,0.95)*sun*0.8;
                vec3 col = mix(night, day, uDay);
                gl_FragColor = vec4(col, 1.0);
              }`
        });
        const sky = new THREE.Mesh(new THREE.PlaneGeometry(320, 200), skyMat);
        sky.position.set(0, 24, -72);
        sky.renderOrder = -10;
        this.scene.add(sky);

        const watUni = { uDay: { value: 0 }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } };
        const watMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, fog: false,
            uniforms: watUni,
            vertexShader: `varying vec3 vW; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
            fragmentShader: `
              varying vec3 vW; uniform float uDay, uTime; uniform vec3 uCam;
              float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5); }
              void main(){
                float far = clamp(length(vW.xz-uCam.xz)*0.01,0.0,1.0);
                vec3 nightW = mix(vec3(0.015,0.05,0.14), vec3(0.05,0.14,0.30), far);
                vec3 dayW   = mix(vec3(0.10,0.52,0.72), vec3(0.55,0.88,0.86), far);
                vec3 col = mix(nightW, dayW, uDay);
                // 月光/陽光の輝線(中央) + 細かなきらめき
                float lane = smoothstep(18.0,0.0,abs(vW.x));
                float shim = smoothstep(0.92,1.0, h21(floor(vW.xz*vec2(2.0,1.3)+uTime*0.6)));
                col += mix(vec3(0.5,0.6,0.7), vec3(0.7,0.95,0.92), uDay) * (lane*0.25 + shim*0.4) * far;
                gl_FragColor = vec4(col, 1.0);
              }`
        });
        const watGeo = new THREE.PlaneGeometry(320, 160, 1, 1);
        watGeo.rotateX(-Math.PI / 2);
        const water = new THREE.Mesh(watGeo, watMat);
        water.position.set(0, -2.0, -96);
        water.renderOrder = -9;
        this.scene.add(water);

        this.lake = {
            sky, water,
            update: (now, day) => {
                skyUni.uDay.value = day; skyUni.uTime.value = now;
                watUni.uDay.value = day; watUni.uTime.value = now;
                if (this.camera) watUni.uCam.value.set(this.camera.position.x, this.camera.position.y, 0);
            },
            dispose: () => {
                sky.geometry.dispose(); sky.material.dispose();
                water.geometry.dispose(); water.material.dispose();
            }
        };
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
        if (this.actPhase !== 'show') return; // イントロ(カーテン降下中)は操作を受けない
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
        if (this.actPhase !== 'show') return; // イントロ(カーテン降下中)は操作を受けない

        // 3Dキャンバス直上の押下だけを受け付ける。songWrapper で pointerdown を
        // フックしているため、上に重なるDOM UI(チュートリアルの「スタート」ボタン等)の
        // 押下もここに伝播してくる。その場合に setPointerCapture でポインタを奪うと
        // ボタンの click イベントが発火せず、チュートリアルから先へ進めなくなる。
        if (event.target !== this.renderer.domElement) return;

        // 押下開始: ここから照射が点灯し、ドラッグで追尾する
        this.isPointerDown = true;
        if (event.pointerId != null && this.songWrapper.setPointerCapture) {
            try { this.songWrapper.setPointerCapture(event.pointerId); } catch (e) { /* noop */ }
        }

        // タップ位置にもスポットライトを即移動 (タッチではmoveより先にdownが来る)
        // 紙吹雪はタップでは降らせない。歌詞を照らし切って破裂したときだけ舞い降りる。
        this.updateSpotFromClient(event.clientX, event.clientY);
    }

    // BaseSong既定のクリック波紋(DOM)との二重処理を抑止 — pointerdownに一本化
    onClick() {}

    // ─── 紙吹雪: 照らし切った歌詞が破裂して生まれ、舞い降りて床に積もる ───
    // 歌詞の位置から一度パッと弾け飛び(初速の外向き+上向き)、その後ふわりと降る。
    burstLyricToConfetti(origin) {
        sfx.play('after_ignite');
        // 歌詞が弾けるたび、閉じた緞帳の合わせ目から光が少しだけ漏れる
        this._curtainLeak = Math.min(1, this._curtainLeak + 0.55);
        const count = this.isMobile ? 12 : 20;
        for (let i = 0; i < count; i++) {
            const mat = this.petalMaterials[Math.random() > 0.5 ? 0 : 1];
            const mesh = new THREE.Mesh(this.petalGeo, mat);

            // 歌詞のあった一点から弾け出す(密集スタート)
            mesh.position.set(
                origin.x + (Math.random() - 0.5) * 0.6,
                origin.y + (Math.random() - 0.5) * 0.6,
                origin.z + (Math.random() - 0.5) * 0.6
            );
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);

            // 破裂: 全方位へ散ったあと重力でふわりと舞い降りる
            const ang = Math.random() * Math.PI * 2;
            const spd = 0.06 + Math.random() * 0.10;
            mesh.userData = {
                vx: Math.cos(ang) * spd,
                vy: 0.05 + Math.random() * 0.08,        // いったん跳ね上がる
                vz: Math.sin(ang) * spd * 0.6,
                gravity: 0.004 + Math.random() * 0.002, // その後ゆっくり降下
                rotSpeedX: (Math.random() - 0.5) * 0.12,
                rotSpeedY: (Math.random() - 0.5) * 0.12,
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

    spawnText(phrase, fallbackTime) {
        const chunks = this.splitPhraseText(phrase.text);
        // 各チャンクに TextAlive の実歌唱タイミング(先頭文字の startTime)を割り当て、
        // その時刻に出現させる(固定刻みではなく歌唱に同期)。
        const timed = this.assignChunkTimes(phrase, chunks, fallbackTime);
        for (const { text, startTime } of timed) {
            this.spawnTextChunk(text, startTime);
        }
    }

    // ─── 各チャンクに TextAlive の歌唱タイミングを割り当てる ───
    // フレーズの文字(IChar)を時系列に並べ、各チャンクの先頭文字に一致する位置の
    // startTime をそのチャンクの出現時刻とする。空白・約物のズレに強い前進照合。
    assignChunkTimes(phrase, chunks, fallbackTime) {
        // フレーズ内の全文字を {ch, t} の時系列に展開
        const timeline = [];
        let c = phrase && phrase.firstChar;
        let guard = 0;
        while (c && guard++ < 20000) {
            const txt = c.text || '';
            for (const ch of txt) timeline.push({ ch, t: c.startTime });
            if (c === phrase.lastChar) break;
            c = c.next;
        }
        // 文字データが取れない場合はフレーズ開始時刻に揃える(従来同等のフォールバック)
        if (!timeline.length) {
            const base = (phrase && typeof phrase.startTime === 'number') ? phrase.startTime : fallbackTime;
            return chunks.map(text => ({ text, startTime: base }));
        }

        const result = [];
        let cursor = 0;
        for (const chunkText of chunks) {
            const target = (chunkText || '').replace(/\s/g, ''); // 空白を無視して照合
            let startTime = fallbackTime;
            if (target.length) {
                // カーソル以降で chunk 先頭文字に一致する位置まで進む(約物・空白はスキップ)
                let k = cursor;
                while (k < timeline.length && timeline[k].ch !== target[0]) k++;
                if (k < timeline.length) {
                    startTime = timeline[k].t;
                    // chunk 全体ぶんカーソルを前進(タイムライン側の余剰文字はスキップ)
                    let ti = 0, p = k;
                    while (p < timeline.length && ti < target.length) {
                        if (timeline[p].ch === target[ti]) ti++;
                        p++;
                    }
                    cursor = p;
                }
            }
            result.push({ text: chunkText, startTime });
        }
        return result;
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

        // 画面いっぱいに歌詞を散らしつつ、ミク前方(客席側)に出して視線も自然に向くようにする。
        mesh.position.set(
            (Math.random() - 0.5) * 20,  // 左右いっぱい(±10)
            Math.random() * 4.8 + 1.3,   // 上下も広く(1.3〜6.1)
            Math.random() * 4.6 - 0.6    // -0.6〜4.0(ミク頭部 z≈-2 より手前=客席側)
        );
        mesh.castShadow = !this.isMobile;

        mesh.userData = {
            birth: spawnTime,
            life: 14000,        // 安全上限(通常は発話後フェードで消える)
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
            this.rimLight.intensity = 50 + breath * 14 + b * 20;
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

        // 頭: 本体は正面のまま、照らされている歌詞の方へ「顔だけ」向ける (クランプ付き)
        const head = vrm.humanoid.getNormalizedBoneNode('head');
        if (head) {
            let targetYaw = 0;
            let targetPitch = 0;

            // 注視対象(_lyricFocus)と重み(_lyricFocusW=照射度)は歌詞更新ループで決定済み。
            if (this._lyricFocusW > 0.06 && this.finaleP < 0.3) {
                const headWorld = head.getWorldPosition(this._headWorld);
                const dirX = this._lyricFocus.x - headWorld.x;
                const dirY = this._lyricFocus.y - headWorld.y;
                const dirZ = this._lyricFocus.z - headWorld.z;
                const horiz = Math.sqrt(dirX * dirX + dirZ * dirZ);
                // 正面=ローカル+Z(本体 rotation.y=π)。ワールド方向→頭ローカルyawは atan2(x, z)。
                let yaw = Math.atan2(dirX, dirZ);
                let pitch = -Math.atan2(dirY, horiz);
                // 人間らしい可動域にクランプし、照射の強さ(重み)で向ける度合いを決める
                yaw = Math.max(-0.8, Math.min(0.8, yaw));
                pitch = Math.max(-0.5, Math.min(0.4, pitch));
                const w = Math.min(1, this._lyricFocusW);
                targetYaw = yaw * w;
                targetPitch = pitch * w;
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
            // 終演入り(バラの舞い降り)に一度だけ余韻のSE
            if (!this._finalePetalSfx && this.finaleP > 0.02) {
                this._finalePetalSfx = true;
                sfx.play('after_petal', 0.8);
            }
        }
        const f = this.finaleP;
        const stageDim = 1 - f;

        // 押している間だけ点灯。離すと滑らかに消灯する
        const spotGoal = (this.isPointerDown && f < 0.05) ? 1 : 0;
        this.spotOn += (spotGoal - this.spotOn) * Math.min(1, dt * 8);

        // 照明フェード (スポット以外はさらに薄暗く保ち、全体を沈ませる)
        this.spotLight.intensity = 14 * stageDim;
        this.mouseLight.intensity = 124 * stageDim * this.spotOn; // 押下中のみ照射(照らす手応えは残す)
        this.pointLight.intensity = 4.5 * stageDim;
        this.ambientLight.intensity = Math.max(0.03, 0.32 * stageDim);
        // 客席の灯: 数に応じて暖かく。終演時はそれだけが世界を照らす
        const seatGlow = Math.min(1, this.seatLights.length / 40);
        this.audienceLight.intensity = seatGlow * (1.8 + f * 7.0);

        if (f > 0.5 && this.counterEl && !this.counterEl.classList.contains('finale')) {
            this.counterEl.classList.add('finale');
            this.counterEl.innerHTML = `残った灯 <span class="after-count-num">${this.kindledCount}</span>`;
            this.counterEl.classList.add('visible');
        }

        // 1. 幕(前面カーテン)と幕間の湖
        const ease = (x) => x * x * (3 - 2 * x);
        // イントロ: 夜の湖を見せたまま、カーテンが上からゆっくり降りて視界を覆う。
        if (this.actPhase === 'intro') {
            this.introP = Math.max(0, Math.min(1, (rel - this._introStartRel) / this.introDur));
            // 自動再生がすり抜けて曲が進んでしまう環境向けに、降下中は頭(0)で待たせ続ける。
            const pl = playerManager.player;
            if (pl && pl.isPlaying) { try { pl.requestPause(); } catch (e) { /* noop */ } }
            if (pl && pl.timer && pl.timer.position > 120) { try { pl.requestMediaSeek(0); } catch (e) { /* noop */ } }
            if (this.introP >= 1 && !this._musicResumed) {
                this._musicResumed = true;
                this.actPhase = 'show';
                // 本編の頭から歌詞を一度だけ出すため、保持中に拾った直近フレーズを忘れる
                this.lastPhrase = null;
                // カーテンが降り切ったら自動で曲を開始
                try { pl && pl.requestPlay(); } catch (e) { /* 音源制御不可でもショーは進む */ }
            }
        }
        // 曲の進行度(0→1)と、アウトロ(終盤約22秒)でゆっくり開くための進捗。
        const songProg = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
        const outroMs = 22000;
        const outroP = duration > 0
            ? Math.max(0, Math.min(1, (position - (duration - outroMs)) / outroMs))
            : 0;
        // アウトロ: 紙吹雪にした量に応じた幅まで、カーテンがゆっくり上がっていく(下限あり)
        const kindleRatio = Math.min(1, this.kindledCount / this.openFullCount);
        const maxOpen = this.curtainMinOpen + (1 - this.curtainMinOpen) * kindleRatio;
        this.curtainOpen = maxOpen * ease(outroP);

        // カーテンの目標Y(phaseごと)
        let curtainTargetY;
        if (this.actPhase === 'preroll') {
            curtainTargetY = this.curtainOpenY;
        } else if (this.actPhase === 'intro') {
            curtainTargetY = this.curtainOpenY + (this.curtainCoverY - this.curtainOpenY) * ease(this.introP);
        } else {
            curtainTargetY = this.curtainCoverY + (this.curtainOpenY - this.curtainCoverY) * this.curtainOpen;
        }
        this.curtain.position.y += (curtainTargetY - this.curtain.position.y) * Math.min(1, dt * 2.4);

        // 漏れ光: 曲が進むほど合わせ目から漏れる光が増し、破裂でさらに一瞬強まる。
        // カーテンが閉じているほど(coverFrac)強く現れ、開くにつれ全開の光へ溶ける。
        this._curtainLeak *= 0.92;
        const coverFrac = Math.max(0, Math.min(1,
            (this.curtainOpenY - this.curtain.position.y) / (this.curtainOpenY - this.curtainCoverY)));
        if (this.leakPlane) {
            this.leakPlane.position.y = this.curtain.position.y;
            this.leakPlane.material.opacity = coverFrac * (0.04 + 0.34 * songProg + this._curtainLeak * 0.8);
        }

        // 幕間の湖: アウトロでカーテンが開くにつれ、その先が夜→晴天へ移ろう。
        const dayMix = ease(outroP);
        if (this.lake) this.lake.update(rel, dayMix);

        // 星空: サビは夜空が瞬く。終演=昼へ向かうので消えてゆく。
        const starTarget = (this.isClimax && f < 0.3) ? 0.9 : 0.0;
        if (this.stars) {
            this.stars.material.opacity += (starTarget - this.stars.material.opacity) * 0.04;
            this.stars.material.opacity *= (1 - dayMix);
        }

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

        // 歌詞は本編(show)中のみ生成。イントロの曲頭保持中に拾って二重出現するのを防ぐ。
        if (this.actPhase === 'show' && phrase && phrase !== this.lastPhrase && f < 0.2) {
            this.lastPhrase = phrase;
            this.spawnText(phrase, position);
        } else if (!phrase) {
            this.lastPhrase = null;
        }

        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);

        // スポットライトが実際に照らしている円錐(ビーム)を毎フレーム1回求める。
        // 始点(ライト位置)→狙点(target)が軸。当たり判定は甘め: コーン半頂角に
        // 少し余裕(×1.2)を持たせ、ビーム周縁の薄明かりに入った歌詞も照射とみなす。
        const beamPos = this.mouseLight.position;
        const beamDir = this._beamDir.copy(this.mouseLight.target.position).sub(beamPos).normalize();
        const spotCos = Math.cos(Math.min(Math.PI / 2, this.mouseLight.angle * 1.2));

        // 2. Update Interactive 3D Lyrics
        let focusW = 0; // このフレームで最も強く照らされている歌詞の照射度(ミクの注視対象選び)
        let softW = 0, newestBirth = -Infinity; // 照らしていないとき、出たばかりの歌詞へ送る視線
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const mesh = this.activeSprites[i];
            const ud = mesh.userData;
            const age = Math.max(0, position - ud.birth);

            // スポットライトのビーム(円錐)の中に歌詞が入っているかで判定する。
            // クリック位置(カーソル)ではなく、実際に光が当たっている範囲を使う。
            // ビーム始点から歌詞へのベクトルが、軸方向の前方かつコーン半頂角内にあれば照射。
            const toLyric = this._toLyric.copy(mesh.position).sub(beamPos);
            const along = toLyric.dot(beamDir);                 // ビーム軸方向の前方距離
            const cosToAxis = along > 0 ? along / toLyric.length() : -1;
            // スポットライトは押下中のみ有効(spotOn)。サビは舞台全体が照らされ、
            // すべての歌詞が浮かび上がる(受動的に聴いていても見せ場が伝わる)。
            const litBySpot = this.spotOn > 0.25 && along > 0 && cosToAxis > spotCos;
            const isIlluminated = (litBySpot || this.isClimax) && f < 0.3;
            const targetProgress = isIlluminated ? 1.0 : 0.0;
            ud.hoverProgress += (targetProgress - ud.hoverProgress) * 0.08;
            const p = ud.hoverProgress;

            // 照射時間の蓄積 → 照らし切り(kindle)判定
            // 蓄積は「スポットライトで照らした時間」だけ。サビで全体が明るくなっても
            // 自動的に弾けない(自分で照らした歌詞だけが紙吹雪になる)。
            if (litBySpot && f < 0.3) {
                ud.litTime += dtMs;
                if (!ud.kindled && ud.litTime >= this.litThreshold) {
                    ud.kindled = true;
                    ud.kindleFlash = 1.0;
                    ud.bursting = true;
                    ud.burstT = 0;
                    this.burstLyricToConfetti(mesh.position.clone());
                    this.spawnSeatLight(mesh.position.clone());
                }
            }
            ud.kindleFlash *= 0.94;

            // 破裂演出: 膨らんで強く発光しながら弾け飛び、紙吹雪を残して消える
            if (ud.bursting) {
                ud.burstT += dt;
                const bt = Math.min(1, ud.burstT / 0.35);
                const bs = 1 + bt * 1.8;
                mesh.scale.set(bs, bs, 1);
                mesh.material.opacity = Math.max(0, 1 - bt);
                mesh.material.emissive.setHSL(0.12, 0.9, Math.min(0.95, 0.4 + 0.55 * (1 - bt)));
                if (bt >= 1) {
                    this.scene.remove(mesh);
                    mesh.material.map.dispose();
                    mesh.material.dispose();
                    mesh.geometry.dispose();
                    this.activeSprites.splice(i, 1);
                }
                continue; // 破裂中は通常の歌詞更新をスキップ
            }

            // Float up and drift smoothly
            mesh.position.y = ud.baseY + Math.sin(position * 0.0015 + ud.birth) * 0.25 * p + (age * 0.00025);
            mesh.rotation.y = Math.sin(position * 0.001) * 0.12 * p + (ud.spinFactor * p);

            // 現在いちばん強く照らされている歌詞を、ミクが顔を向ける対象にする
            if (p > focusW) { focusW = p; this._lyricFocus.copy(mesh.position); }
            // 照らしていなくても、出たばかり(最新)の歌詞の方へ自然に視線を送る
            if (ud.birth > newestBirth) { newestBirth = ud.birth; this._softFocus.copy(mesh.position); softW = mesh.material.opacity || 0; }

            // 歌唱パルス
            const isWordActive = word && ud.text && ud.text.includes(word.text)
                              && position >= word.startTime && position <= word.endTime;
            if (!ud.pulseProgress) ud.pulseProgress = 0;
            ud.pulseProgress += ((isWordActive ? 1 : 0) - ud.pulseProgress) * 0.2;
            const pulse = ud.pulseProgress;
            const s = (1.0 + p * 0.35) * (1.0 + pulse * 0.25) * (1.0 + ud.kindleFlash * 0.15);
            mesh.scale.set(s, s, 1);

            // 発光: 暗いステージでも黒くつぶれないよう常にほのかに自己発光。
            // 照らし切るほど暖色へ寄り、スポット/歌唱で強く光る。
            const litRatio = Math.min(1, ud.litTime / this.litThreshold);
            const hue = 0.46 + pulse * 0.05 - litRatio * 0.38; // 緑 → 暖色
            const baseGlow = 0.26;                              // 常時のほのかな白光(発話後も黒くならない)
            let lum = Math.min(0.92, baseGlow + 0.5 * p + pulse * 0.4 + ud.kindleFlash * 0.5 + (ud.kindled ? 0.15 : 0));
            lum *= (0.4 + 0.6 * stageDim);                      // 終演のみ少し沈ませる
            mesh.material.emissive.setHSL(Math.max(0.06, hue), 0.7, lum);

            // 出現→発話中は保持→発話後はゆるやかにフェードアウト(黒く残さない)。
            // スポットライトで照らしている間は消えずに留まり、読んで弾けるまで粘れる。
            const fadeInMs = 200, singHold = 3000, fadeOutMs = 2200;
            let targetOpacity;
            if (age < fadeInMs) {
                targetOpacity = age / fadeInMs;
            } else if (litBySpot || age <= singHold) {
                targetOpacity = 1.0;
            } else {
                targetOpacity = Math.max(0, 1 - (age - singHold) / fadeOutMs);
            }
            mesh.material.opacity += (targetOpacity - mesh.material.opacity) * Math.min(1, dt * 6);

            // フェードし切った歌詞、または終演で除去(照らしている間は残す)
            if ((mesh.material.opacity <= 0.02 && !litBySpot && age > singHold) || age > ud.life || f >= 1) {
                this.scene.remove(mesh);
                mesh.material.map.dispose();
                mesh.material.dispose();
                mesh.geometry.dispose();
                this.activeSprites.splice(i, 1);
            }
        }
        // 照らされた歌詞があればそれを強く注視。無ければ最新の歌詞へ控えめに視線を送る。
        // どちらも無ければ重み0 → ミクは正面へ戻る。
        if (focusW > 0.12) {
            this._lyricFocusW = focusW;
        } else if (softW > 0.2) {
            this._lyricFocus.copy(this._softFocus);
            this._lyricFocusW = 0.85 * softW;
        } else {
            this._lyricFocusW = 0;
        }

        // 3. 紙吹雪(破裂した歌詞由来): 舞い降りて床に積もり、曲が終わるまで残る
        for (let i = this.petals.length - 1; i >= 0; i--) {
            const mesh = this.petals[i];
            const ud = mesh.userData;

            if (!ud.isFloored) {
                // 破裂の初速を重力で減衰させ、跳ね上がりからふわりと降下へ転じる
                if (ud.gravity) ud.vy = Math.max(-0.085, ud.vy - ud.gravity);
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
        eventBus.off('play', this.boundOnPlay);
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
        if (this.leakPlane) {
            this.leakPlane.geometry.dispose();
            this.leakPlane.material.dispose();
        }
        if (this.lake) {
            this.scene.remove(this.lake.sky);
            this.scene.remove(this.lake.water);
            this.lake.dispose();
            this.lake = null;
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
