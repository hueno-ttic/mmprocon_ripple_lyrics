import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

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
        this.reachBlend = 0;              // 0=脱力 1=手を差し伸べる
        this.reachBlendTarget = 0;
        this.mikuGlowPulse = 0;
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
                vrm.scene.position.set(0, 1.5, this.camera.position.z - 13);
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
        if (leftUpperArm) leftUpperArm.rotation.z = -Math.PI / 2.8;
        if (rightUpperArm) rightUpperArm.rotation.z = Math.PI / 2.8;
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

        // 回廊の少し先を先導(カメラ相対で固定し、上下にゆったり浮遊)
        const bobY = Math.sin(t * 1.25) * 0.35 + Math.sin(t * 0.47) * 0.12;
        const swayX = Math.sin(t * 0.6) * 0.55;
        vs.position.x += ((swayX) - vs.position.x) * 0.05;
        vs.position.y = 1.5 + bobY + beatPulse * 0.08;
        vs.position.z = this.camera.position.z - 13;

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
            if (lu) { lu.rotation.z = lerp(-Math.PI / 2.8, -Math.PI / 9); lu.rotation.x = lerp(0, -Math.PI / 2.4); }
            if (ru) { ru.rotation.z = lerp(Math.PI / 2.8, Math.PI / 9); ru.rotation.x = lerp(0, -Math.PI / 2.4); }
            if (ll) { ll.rotation.y = lerp(Math.PI / 12, Math.PI / 18); }
            if (rl) { rl.rotation.y = lerp(-Math.PI / 12, -Math.PI / 18); }
            if (neck) { neck.rotation.x = lerp(0, 0.12); }
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

        this.currentVRM.update(deltaSec);
    }

    // =====================================================================
    // 歌詞スプライト
    // =====================================================================
    createTextTexture(text, colorStr) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 1024, 128);
        ctx.font = 'bold 80px "Inter", "Noto Sans JP", "Hiragino Kaku Gothic Pro", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = colorStr;
        ctx.shadowBlur = 22;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 512, 64);
        return new THREE.CanvasTexture(canvas);
    }

    spawnText(phrase, spawnTime) {
        const colorStr = `#${this.worldColor.getHexString()}`;
        const texture = this.createTextTexture(phrase.text, colorStr);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0,
        });
        const sprite = new THREE.Sprite(material);

        // ミク(中央)を避けて左右に散らす
        const side = Math.random() < 0.5 ? -1 : 1;
        sprite.position.set(
            side * (2.5 + Math.random() * 4),
            0.5 + Math.random() * 4,
            this.camera.position.z - 16 - Math.random() * 6
        );

        const aspect = 1024 / 128;
        let scale = 2 + Math.random();
        // 見切れ防止: スプライト幅をビューポート内に収める
        const maxWidth = 17;
        if (scale * aspect > maxWidth) scale = maxWidth / aspect;
        // メリハリ: サビのフレーズだけ一回り大きく堂々と
        if (this.isClimax) scale = Math.min(scale * 1.3, (maxWidth * 1.15) / aspect);
        sprite.userData = {
            birth: spawnTime,
            life: 5000,
            text: phrase.text,
            baseScale: scale,
            aspect: aspect,
            pulseProgress: 0,
            resonated: false,
            resonateFlash: 0,
        };
        sprite.scale.set(scale * aspect, scale, 1);

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
            event.target.closest('.kotaete-choice-container, .song-tutorial-overlay')) {
            return;
        }

        this.pointerVec.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointerVec.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.pointerVec, this.camera);

        const hits = this.raycaster.intersectObjects(this.activeSprites, false);
        if (hits.length > 0) {
            const sprite = hits[0].object;
            if (!sprite.userData.resonated) {
                this.resonate(sprite, event.clientX, event.clientY);
            }
        }
    }

    resonate(sprite, clientX, clientY) {
        sprite.userData.resonated = true;
        sprite.userData.resonateFlash = 1.0;
        // 共鳴の還元①: 共鳴したフレーズは輝く軌跡として長く回廊に残る
        sprite.userData.life += 2800;
        this.resonanceCount++;
        this.updatePaletteResonance();

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
            : new THREE.Vector3(0, 1.5, this.camera.position.z - 13);

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

        // ---- ビート脈動 ----
        let beatPulse = 0;
        if (typeof playerManager.player.findBeat === 'function') {
            const beat = playerManager.player.findBeat(position);
            if (beat && beat.duration > 0) {
                const p = Math.min(1, Math.max(0, (position - beat.startTime) / beat.duration));
                beatPulse = Math.pow(1 - p, 2.2); // 拍頭で跳ねて減衰
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
        this.camera.position.y = 2 + beatPulse * 0.05; // ビートの微かな脈動
        this.paths.forEach(line => {
            if (this.camera.position.z - line.position.z < -25) {
                line.position.z -= 50;
            }
        });
        if (this.starField && this.camera.position.z - this.starField.position.z < -70) {
            this.starField.position.z -= 140;
        }

        // ---- 歌詞 ----
        const phrase = playerManager.player.video.findPhrase(position);
        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);
        if (this.lyricRenderer) {
            if (word) {
                this.lyricRenderer.update(word);
            } else if (!phrase) {
                this.lyricRenderer.update(null);
            }
        }
        if (phrase && phrase !== this.lastPhrase && !this.isTutorialActive) {
            this.lastPhrase = phrase;
            this.spawnText(phrase, position);
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

            // 共鳴フラッシュ(タップ直後の発光・拡大)
            ud.resonateFlash = Math.max(0, ud.resonateFlash - deltaSec * 2.2);
            const flash = ud.resonateFlash;

            const pulseScale = 1.0 + ud.pulseProgress * 0.25 + flash * 0.45;
            s.scale.set(ud.baseScale * ud.aspect * pulseScale, ud.baseScale * pulseScale, 1);

            // 発光色: 歌唱パルスで暖色、共鳴で世界の色に染まる
            const r = 1.0;
            const g = 1.0 - ud.pulseProgress * 0.4 + flash * 0.2;
            const bch = 1.0 - ud.pulseProgress * 0.2 + flash * 0.3;
            s.material.color.setRGB(r, Math.min(1, g), Math.min(1, bch));
            if (ud.resonated && flash <= 0.01) {
                s.material.color.copy(this.worldColor).lerp(new THREE.Color(0xffffff), 0.55);
            }

            const age = Math.max(0, position - ud.birth);
            s.position.y += Math.sin(position * 0.002) * 0.01;

            if (age < 150) {
                s.material.opacity = age / 150;
            } else if (age > ud.life - 200) {
                s.material.opacity = Math.max(0, (ud.life - age) / 200);
            } else {
                s.material.opacity = ud.resonated ? 1 : 0.92;
            }

            if (age > ud.life || s.position.z > this.camera.position.z) {
                this.scene.remove(s);
                if (s.material.map) s.material.map.dispose();
                s.material.dispose();
                this.activeSprites.splice(i, 1);
            }
        }

        // ---- ミク & 光の粒 ----
        this.updateMiku(position, beatPulse);
        this.updateFlyingParticles(deltaSec);

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

        this.choiceContainer = document.createElement('div');
        this.choiceContainer.className = 'kotaete-choice-container';

        const hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r},${g},${b},${alpha})`;
        };

        const createBtn = (opt) => {
            const btn = document.createElement('button');
            btn.className = 'kotaete-choice-btn';
            btn.style.border = `2px solid ${opt.color}`;
            btn.innerHTML = `
                <span class="choice-main">${opt.main}</span>
                <span class="choice-sub">${opt.sub}</span>
            `;
            const on = () => {
                btn.style.background = hexToRgba(opt.color, 0.35);
                btn.style.boxShadow = `0 0 20px ${opt.color}`;
            };
            const off = () => {
                btn.style.background = 'rgba(0,0,0,0.5)';
                btn.style.boxShadow = 'none';
            };
            btn.addEventListener('mouseenter', on);
            btn.addEventListener('mouseleave', off);
            btn.addEventListener('touchstart', on, { passive: true });
            btn.addEventListener('click', () => this.applyChoice(opt.color));
            return btn;
        };

        this.choiceContainer.appendChild(createBtn(round.left));
        this.choiceContainer.appendChild(createBtn(round.right));
        this.songWrapper.appendChild(this.choiceContainer);
        this._choiceTimers.push(setTimeout(() => {
            if (this.choiceContainer) this.choiceContainer.classList.add('visible');
        }, 50));

        // キーボード対応
        const btns = Array.from(this.choiceContainer.querySelectorAll('.kotaete-choice-btn'));
        let focusIdx = -1;
        this._choiceKeyHandler = (e) => {
            if (!this.choiceContainer || !this.choiceContainer.parentNode) return;
            if (e.code === 'ArrowLeft') {
                e.preventDefault(); focusIdx = 0; btns[0].focus();
            } else if (e.code === 'ArrowRight') {
                e.preventDefault(); focusIdx = 1; btns[1].focus();
            } else if ((e.code === 'Space' || e.code === 'Enter') && focusIdx >= 0) {
                e.preventDefault(); btns[focusIdx].click();
            }
        };
        document.addEventListener('keydown', this._choiceKeyHandler);
    }

    applyChoice(colorHex) {
        if (!this.choiceActive) return;

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

        if (this.choiceContainer) {
            const container = this.choiceContainer;
            this.choiceContainer = null;
            container.style.pointerEvents = 'none'; // 残骸クリック防止
            container.style.opacity = '0';
            this._domTimers.push(setTimeout(() => {
                if (container.parentNode) container.parentNode.removeChild(container);
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

        // エンドカードへ成果を登録
        this.setResultSummary({
            accentColor: hex,
            swatch: this.finalAnswerColor ? hex : null,
            lines: [
                this.finalAnswerColor ? 'あなたの答えの色が生まれた' : 'まだ見ぬ、あなたの答えの色',
                `歌詞との共鳴 ${this.resonanceCount}`,
            ],
        });
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
            /* 選択UIはミク(画面中央)を隠さないよう下寄せ+改行抑止 */
            .kotaete-choice-container {
                top: 72% !important;
            }
            .kotaete-choice-btn .choice-main,
            .kotaete-choice-btn .choice-sub {
                white-space: nowrap;
            }
            .kotaete-palette-slot.silent {
                background: rgba(150, 150, 165, 0.5) !important;
                box-shadow: none !important;
            }
            .kotaete-palette {
                position: absolute;
                right: 14px;
                top: 50%;
                transform: translateY(-50%);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                padding: 12px 8px;
                background: rgba(5, 5, 16, 0.55);
                border: 1px solid rgba(127, 119, 221, 0.5);
                border-radius: 14px;
                backdrop-filter: blur(4px);
                z-index: 25;
                pointer-events: none;
                transition: box-shadow 0.8s ease;
            }
            .kotaete-palette.confirmed {
                box-shadow: 0 0 22px rgba(255, 255, 255, 0.35);
                animation: kotaete-palette-breathe 2.4s ease-in-out infinite;
            }
            @keyframes kotaete-palette-breathe {
                0%, 100% { transform: translateY(-50%) scale(1); }
                50%      { transform: translateY(-50%) scale(1.05); }
            }
            .kotaete-palette-label {
                writing-mode: vertical-rl;
                font-size: 11px;
                letter-spacing: 3px;
                color: rgba(255, 255, 255, 0.85);
                text-shadow: 0 0 6px rgba(127, 119, 221, 0.9);
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
            @media (max-width: 767px) {
                .kotaete-palette { right: 8px; padding: 10px 6px; }
                .kotaete-palette-slot { width: 15px; height: 22px; }
                .kotaete-palette-swatch { width: 22px; height: 22px; }
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
        });
        this.activeSprites = [];

        // 飛行パーティクル
        this.flyingParticles.forEach(p => {
            this.scene.remove(p);
            p.geometry.dispose();
            p.material.dispose();
        });
        this.flyingParticles = [];

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

        // DOM
        if (this.choiceContainer && this.choiceContainer.parentNode) {
            this.choiceContainer.parentNode.removeChild(this.choiceContainer);
        }
        if (this.paletteEl && this.paletteEl.parentNode) {
            this.paletteEl.parentNode.removeChild(this.paletteEl);
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
