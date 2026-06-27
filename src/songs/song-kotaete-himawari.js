import * as THREE from 'three';
import { quality } from '../core/quality.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { settleSpringBones } from '../utils/vrm.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { eventBus } from '../core/eventBus.js';
import { sfx } from '../core/sfx.js';

// =============================================================================
// こたえて 「ひまわり登攀版」
// -----------------------------------------------------------------------------
// マリオ風の縦スクロール。必ずゴール(満開のひまわり)へ着く一本道の演出。
//   1. 開幕: ミクは地面に立ち、足元にひまわりの芽。
//   2. 曲の進行で茎が上へ伸びる。
//   3. 歌詞が発話されるたび、その歌詞を描いた「葉っぱ」が茎の左右交互に生える(=足場)。
//   4. ミクは曲に合わせて自動で葉から葉へジャンプして登る(カメラが上へ追従)。
//   5. てっぺんの満開ひまわりに到達してゴール(毎回必ず咲く)。
//
// ゲームではなく「必ず着く演出」。落下・ミス・GameOverは無し。
// 補助インタラクション(同一画面で共存):
//   A. 歌詞にこたえる: 葉っぱをタッチで開く・光る=足場確定(問いにこたえる)。
//   B. 足場づくり    : 空きをタッチで葉っぱを生やしルートを作る。
//   C. 太陽操作      : 太陽をドラッグ→光の向き/成長速度と葉の生える側が変わる。
// どれも「やると良くなる」だけで、やらなくても必ずゴールに着く。
// =============================================================================

const GROUND_Y = 0;
const FIRST_LEAF_Y = 2.4;     // 最初の葉の高さ
const LEAF_SPACING = 2.6;     // 葉と葉の縦間隔
const LEAF_X = 1.5;           // 茎からの左右オフセット
const STEM_R = 0.16;          // 茎の半径
const JUMP_DUR = 0.62;        // 1ジャンプの所要(秒)
const JUMP_MIN_INTERVAL = 0.12; // 連続ジャンプの最小間隔(=葉に追従しやすく)
const LEAF_SPAWN_INTERVAL = 1200; // 葉の生成間隔(ms)。総数を抑え登攀が追いつくように
const MAX_BACKLOG_LEAVES = 4;     // ミクがこれ以上遅れていたら新しい葉を生やさない
const CAM_Z = 9.0;
const CAM_Y_OFF = 2.6;        // ミクより少し上を見る
const LOOK_Y_OFF = 2.4;

const LEAF_GREEN = '#3f8f4a';
const LEAF_GREEN_D = '#2c6b37';
const SUN_GOLD = new THREE.Color('#FFD54A');

export class SongKotaeteHimawari extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        this.isMobile = window.innerWidth < 768;

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // ---- 茎 ----
        this.stem = null;
        this.stemDisplay = 0.4;       // いま見えている茎の高さ(lerpで伸ばす)
        this.stemTopTarget = FIRST_LEAF_Y; // 目標の茎の高さ

        // ---- 葉っぱ(足場)。y昇順で管理する ----
        this.leaves = [];
        this.leafIndexCounter = 0;

        // ---- ミク(登攀) ----
        this.currentVRM = null;
        this.mikuLoaded = false;
        this.basePose = null;
        this.climbY = GROUND_Y;        // ミクの足元の高さ
        this.climbX = 0;
        this.currentLeafIndex = -1;    // -1=地面
        this.climbState = 'idle';      // 'idle' | 'jumping'
        this.jump = null;              // {fromX,fromY,toX,toY,toLeaf,t}
        this._jumpCooldown = 0;
        this.mikuPulse = 0;
        this.faceDir = 0;              // -1左 / 0正面 / +1右(進行方向)

        // ---- 太陽 / 環境 ----
        this.sun = null;
        this.sunX = 2.5;               // 太陽の横位置(光の向き)
        this.sunHeight = 7.0;          // 太陽の高さ(光の強さ=成長速度)
        this.draggingSun = false;
        this.growthRate = 1.0;
        this.sideBias = 0;             // -1..+1 太陽の側へ葉が寄る

        // ---- ゴール ----
        this.goalLeaf = null;
        this.goalPending = false;
        this.goalReached = false;
        this.bloom = null;

        // ---- 進行/補助 ----
        this.answeredCount = 0;        // タッチで確定した葉の数
        this.builtCount = 0;           // プレイヤーが生やした葉の数
        this._lastWordStart = -1;
        this._lastLeafAt = -Infinity;  // 葉の生成レート制限(実時間ms)
        this._lastFrameReal = performance.now();

        // ---- レイキャスト ----
        this._raycaster = new THREE.Raycaster();
        this._ndc = new THREE.Vector2();
        this._climbPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z=0平面
        this._hit = new THREE.Vector3();
        this._white = new THREE.Color(0xffffff);

        this.boundOnResize = this.onResize.bind(this);
        this.boundOnPointerDown = this.onPointerDown.bind(this);
        this.boundOnPointerMove = this.onPointerMove.bind(this);
        this.boundOnPointerUp = this.onPointerUp.bind(this);
        this.boundOnSongEnd = () => this.reachGoal();
    }

    // =====================================================================
    // init
    // =====================================================================
    init() {
        this.initThree();
        this.buildSky();
        this.buildGround();
        this.buildStem();
        this.buildSun();
        this.loadMiku();

        window.addEventListener('resize', this.boundOnResize);
        this.songWrapper.addEventListener('pointerdown', this.boundOnPointerDown);
        window.addEventListener('pointermove', this.boundOnPointerMove);
        window.addEventListener('pointerup', this.boundOnPointerUp);
        eventBus.on('songEnd', this.boundOnSongEnd);

        super.init();

        this.highlightFirstInteractable(() => {
            if (this.answeredCount > 0 || this.builtCount > 0) return null;
            const leaf = this.leaves.find(l => !l.confirmed);
            if (leaf) { const p = this.worldToScreen(leaf.group.position.clone()); if (p) return p; }
            return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
        }, { label: '歌詞の葉にふれて、道をつくろう', autoDismissMs: 11000 });
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0xbfe3ff, 0.011);
        this.scene.background = new THREE.Color(0x8fcdf0);

        this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, CAM_Y_OFF, CAM_Z);

        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        this.songWrapper.appendChild(this.renderer.domElement);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 1.15);
        this.scene.add(this.ambientLight);
        this.sunLight = new THREE.DirectionalLight(0xfff3c4, 1.5);
        this.sunLight.position.set(this.sunX, 12, 6);
        this.scene.add(this.sunLight);
    }

    // 空のグラデーション(下=明るい地平、上=青空)。大きな背面スフィアで表現。
    buildSky() {
        const mat = new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false,
            uniforms: { uTop: { value: new THREE.Color(0x4fa3e0) }, uBot: { value: new THREE.Color(0xdff2ff) } },
            vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
            fragmentShader: `varying vec3 vP; uniform vec3 uTop, uBot;
              void main(){ float h=clamp(vP.y/260.0+0.5,0.0,1.0); gl_FragColor=vec4(mix(uBot,uTop,h),1.0);} `,
        });
        this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), mat);
        this.scene.add(this.sky);
    }

    buildGround() {
        const geo = new THREE.PlaneGeometry(120, 120);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0x7ec85a, roughness: 1 });
        this.ground = new THREE.Mesh(geo, mat);
        this.ground.position.y = GROUND_Y;
        this.scene.add(this.ground);
        // 遠くの丘
        const hillMat = new THREE.MeshBasicMaterial({ color: 0x6fb84f });
        for (let i = 0; i < 5; i++) {
            const r = 6 + Math.random() * 6;
            const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), hillMat);
            hill.position.set(-40 + i * 20 + (Math.random() - 0.5) * 8, GROUND_Y - r * 0.55, -30 - Math.random() * 10);
            this.scene.add(hill);
        }
    }

    buildStem() {
        const mat = new THREE.MeshStandardMaterial({ color: 0x4c9a3f, roughness: 0.9 });
        const geo = new THREE.CylinderGeometry(STEM_R * 0.7, STEM_R, 1, 10);
        this.stem = new THREE.Mesh(geo, mat);
        this.stem.position.set(0, this.stemDisplay / 2, 0);
        this.stem.scale.y = this.stemDisplay;
        this.scene.add(this.stem);

        // 芽(双葉)
        const sproutMat = new THREE.MeshStandardMaterial({ color: 0x6cc24a, roughness: 0.8, side: THREE.DoubleSide });
        const sprout = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), sproutMat);
        sprout.position.set(0.35, 0.4, 0.05); sprout.rotation.z = -0.5;
        this.scene.add(sprout);
        const sprout2 = sprout.clone(); sprout2.position.x = -0.35; sprout2.rotation.z = 0.5;
        this.scene.add(sprout2);
    }

    // 太陽(ドラッグ可能)。光線つき。
    buildSun() {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const x = c.getContext('2d');
        const g = x.createRadialGradient(128, 128, 10, 128, 128, 120);
        g.addColorStop(0, 'rgba(255,248,200,1)');
        g.addColorStop(0.55, 'rgba(255,196,40,1)');
        g.addColorStop(0.8, 'rgba(255,170,30,0.85)');
        g.addColorStop(1, 'rgba(255,170,30,0)');
        x.fillStyle = g; x.beginPath(); x.arc(128, 128, 120, 0, Math.PI * 2); x.fill();
        this._sunTex = new THREE.CanvasTexture(c);
        // 青空の上では加算合成だと白飛びするので通常合成で金色を保つ
        const mat = new THREE.SpriteMaterial({ map: this._sunTex, transparent: true, depthTest: false });
        this.sun = new THREE.Sprite(mat);
        this.sun.scale.set(5, 5, 1);
        this.sun.renderOrder = 5;
        this.scene.add(this.sun);
        this._positionSun();
    }

    _positionSun() {
        // 太陽は常に空(カメラの上方)に位置し、横は sunX に追従
        this.sun.position.set(this.sunX, this.camera.position.y + (this.sunHeight - 4), -8);
    }

    // =====================================================================
    // ミク
    // =====================================================================
    loadMiku() {
        const loader = new GLTFLoader();
        loader.register((p) => new VRMLoaderPlugin(p));
        loader.load(import.meta.env.BASE_URL + 'assets/models/model_miku.vrm',
            (gltf) => {
                if (!this.isActive) { this._disposeVRM(gltf.userData.vrm); return; }
                const vrm = gltf.userData.vrm;
                this.currentVRM = vrm;
                this.scene.add(vrm.scene);
                vrm.scene.scale.setScalar(1.9);
                vrm.scene.position.set(this.climbX, this.climbY, 0.4);
                vrm.scene.rotation.y = Math.PI; // 顔をカメラへ向ける
                this._baseRotY = Math.PI;
                this.setupStandPose(vrm);
                settleSpringBones(vrm);
                this.mikuLoaded = true;
            }, undefined,
            (e) => console.error('[HIMAWARI] VRM load failed', e));
    }

    setupStandPose(vrm) {
        if (!vrm || !vrm.humanoid) return;
        const get = (n) => vrm.humanoid.getNormalizedBoneNode(n);
        const lu = get('leftUpperArm'), ru = get('rightUpperArm');
        const ll = get('leftLowerArm'), rl = get('rightLowerArm');
        if (lu) lu.rotation.z = Math.PI / 2.7;
        if (ru) ru.rotation.z = -Math.PI / 2.7;
        if (ll) ll.rotation.y = Math.PI / 14;
        if (rl) rl.rotation.y = -Math.PI / 14;
        this.basePose = { luZ: Math.PI / 2.7, ruZ: -Math.PI / 2.7, llY: Math.PI / 14, rlY: -Math.PI / 14 };
    }

    // =====================================================================
    // 葉っぱ(足場)
    // =====================================================================
    createLeafTexture(text) {
        const W = 512, H = 256;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        // 葉の形(横長の楕円)。緑のグラデ。
        const g = x.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, LEAF_GREEN); g.addColorStop(1, LEAF_GREEN_D);
        x.fillStyle = g;
        x.beginPath(); x.ellipse(W / 2, H / 2, W / 2 - 8, H / 2 - 8, 0, 0, Math.PI * 2); x.fill();
        // 葉脈
        x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 3;
        x.beginPath(); x.moveTo(40, H / 2); x.lineTo(W - 40, H / 2); x.stroke();
        // 可読性のための暗い帯
        x.fillStyle = 'rgba(20,40,20,0.45)';
        x.beginPath(); x.ellipse(W / 2, H / 2, W / 2 - 60, 64, 0, 0, Math.PI * 2); x.fill();
        // 歌詞テキスト(白・濃い縁取り)
        let fs = 64;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        do { x.font = `bold ${fs}px "Inter","Noto Sans JP",sans-serif`; fs -= 4; }
        while (fs > 22 && x.measureText(text).width > W - 90);
        x.lineWidth = 7; x.strokeStyle = 'rgba(10,30,10,0.9)'; x.strokeText(text, W / 2, H / 2);
        x.fillStyle = '#ffffff'; x.fillText(text, W / 2, H / 2);
        const tex = new THREE.CanvasTexture(c);
        return tex;
    }

    // 次の葉を生やす。yを指定しなければラダーの次段に。sideは太陽バイアスで決定。
    spawnLeaf(text, opts = {}) {
        const idx = this.leafIndexCounter++;
        let y = (opts.y != null) ? opts.y : (FIRST_LEAF_Y + idx * LEAF_SPACING);
        // 側: 交互を基本に、太陽の側へ寄せる(sideBias)
        let side = (idx % 2 === 0) ? -1 : 1;
        if (opts.side) side = opts.side;
        else if (this.sideBias > 0.4) side = 1;
        else if (this.sideBias < -0.4) side = -1;
        const x = side * LEAF_X;

        const group = new THREE.Group();
        group.position.set(x, y, 0);

        // 茎から葉への短い葉柄
        const stalkMat = new THREE.MeshBasicMaterial({ color: 0x4c9a3f });
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, LEAF_X, 6), stalkMat);
        stalk.position.set(-x / 2, 0, -0.02); stalk.rotation.z = Math.PI / 2;
        group.add(stalk);

        const tex = this.createLeafTexture(text || '♪');
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
        const leaf = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), mat);
        leaf.position.set(0, 0, 0);
        group.add(leaf);
        this.scene.add(group);

        const item = {
            group, leaf, mat, tex, y, x, side, text: text || '',
            born: 0, openT: 0, confirmed: false, landed: false, glow: 0,
            index: idx, isGoal: !!opts.isGoal,
        };
        // 生え際は小さく → ポップして開く
        group.scale.setScalar(0.01);
        this.leaves.push(item);
        this.leaves.sort((a, b) => a.y - b.y);
        // 茎はこの葉より少し上まで伸ばす
        this.stemTopTarget = Math.max(this.stemTopTarget, y + 1.6);
        return item;
    }

    // 歌詞ワード発火で葉を生やす。総数を抑え(間隔)、ミクが遅れすぎたら止める(バックログ上限)。
    // → 曲終わりにミクが必ずてっぺんへ追いつける範囲に保つ。
    _spawnLyricLeaf(text) {
        const now = performance.now();
        if (now - this._lastLeafAt < LEAF_SPAWN_INTERVAL) return null;
        const highestY = this.leaves.length ? this.leaves[this.leaves.length - 1].y : this.climbY;
        if (highestY - this.climbY > MAX_BACKLOG_LEAVES * LEAF_SPACING) return null; // 遅れすぎ→生やさない
        this._lastLeafAt = now;
        return this.spawnLeaf(text);
    }

    updateLeaves(dt) {
        for (const l of this.leaves) {
            l.born += dt;
            // ポップアップして開く
            l.openT = Math.min(1, l.openT + dt * 3.2);
            const s = this._easeOutBack(l.openT);
            l.group.scale.setScalar(s);
            // 確定/着地でほのかに光る
            const targetGlow = (l.confirmed ? 0.6 : 0) + (l.landed ? 0.25 : 0);
            l.glow += (targetGlow - l.glow) * Math.min(1, dt * 6);
            // 葉の色を確定でやや明るく
            l.mat.color.setRGB(1 + l.glow * 0.3, 1 + l.glow * 0.3, 1 + l.glow * 0.3);
            // 葉は常にカメラの方へ少しだけ向く(可読性)。基本はz+正面。
            l.group.rotation.y = 0;
            // そよ風で軽く揺れる
            l.leaf.rotation.z = Math.sin(l.born * 1.5 + l.index) * 0.04;
        }
    }

    // =====================================================================
    // 茎の成長
    // =====================================================================
    updateStem(dt) {
        // 太陽が高いほど速く伸びる
        this.growthRate = 0.6 + 0.8 * THREE.MathUtils.clamp((this.sunHeight - 3) / 6, 0, 1);
        const speed = 2.2 * this.growthRate;
        this.stemDisplay += (this.stemTopTarget - this.stemDisplay) * Math.min(1, dt * speed);
        if (this.stem) {
            this.stem.scale.y = this.stemDisplay;
            this.stem.position.y = this.stemDisplay / 2;
        }
    }

    // =====================================================================
    // ミクの自動登攀(落下なし)
    // =====================================================================
    updateClimb(dt) {
        if (!this.mikuLoaded) return;
        this._jumpCooldown = Math.max(0, this._jumpCooldown - dt);

        if (this.climbState === 'jumping') {
            const j = this.jump;
            // 終盤(ゴール発火後)はジャンプを速め、残りの足場を一気に登り切る
            j.t += dt / (JUMP_DUR * (this.finishing ? 0.45 : 1));
            const t = Math.min(1, j.t);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            this.climbX = THREE.MathUtils.lerp(j.fromX, j.toX, ease);
            this.climbY = THREE.MathUtils.lerp(j.fromY, j.toY, ease);
            const arc = Math.sin(t * Math.PI) * (0.8 + Math.abs(j.toY - j.fromY) * 0.18);
            this._jumpArc = arc;
            this.mikuPulse = Math.max(this.mikuPulse, 0.5);
            if (t >= 1) {
                // 着地。落下なし方針: 必ず目標の葉に乗る。
                this.climbX = j.toX; this.climbY = j.toY; this._jumpArc = 0;
                this.currentLeafIndex = j.toLeaf ? j.toLeaf.index : this.currentLeafIndex;
                if (j.toLeaf) { j.toLeaf.landed = true; }
                this.climbState = 'idle';
                this.jump = null;
                this._jumpCooldown = this.finishing ? 0 : JUMP_MIN_INTERVAL;
                this.faceDir = 0;
                if (j.toLeaf && j.toLeaf.isGoal) this._onReachBloom();
            }
            return;
        }

        // idle: 自分より上で一番近い葉へ次の一歩
        if (this._jumpCooldown > 0) return;
        const next = this._nextLeafAbove(this.climbY);
        if (next) {
            this._startJump(next);
        }
    }

    _nextLeafAbove(y) {
        // y より上にある葉のうち最も低いもの(まだ乗っていない)
        let best = null;
        for (const l of this.leaves) {
            if (l.y > y + 0.15 && !l.landed) {
                if (!best || l.y < best.y) best = l;
            }
        }
        return best;
    }

    _startJump(leaf) {
        this.climbState = 'jumping';
        this.faceDir = Math.sign(leaf.x - this.climbX) || 0;
        this.jump = {
            fromX: this.climbX, fromY: this.climbY,
            toX: leaf.x, toY: leaf.y, toLeaf: leaf, t: 0,
        };
        sfx.play('ripple'); // 軽い踏み切り音(欠損時は無音)
    }

    // ミクのポーズ/向き/上下(ジャンプの弧)を反映
    updateMiku(now, dt) {
        if (!this.currentVRM) return;
        const t = now * 0.001;
        this.mikuPulse = Math.max(0, this.mikuPulse - dt * 1.6);

        const vrm = this.currentVRM;
        vrm.scene.position.set(this.climbX, this.climbY + (this._jumpArc || 0), 0.4);
        // 顔はカメラへ向けたまま、進行方向(ジャンプ中)へ体を少しひねる
        const targetRotY = (this._baseRotY || Math.PI) + this.faceDir * 0.45;
        vrm.scene.rotation.y += (targetRotY - vrm.scene.rotation.y) * Math.min(1, dt * 10);

        // 立ち姿のグルーヴ + ジャンプ中は腕を上げる
        const get = (n) => vrm.humanoid.getNormalizedBoneNode(n);
        const bp = this.basePose;
        if (bp) {
            const jumping = this.climbState === 'jumping' ? 1 : 0;
            const sway = Math.sin(t * 1.2) * 0.04 * (1 - jumping);
            const lu = get('leftUpperArm'), ru = get('rightUpperArm');
            const spine = get('spine');
            if (lu) lu.rotation.z = bp.luZ * (1 - jumping * 0.55) + sway;
            if (ru) ru.rotation.z = bp.ruZ * (1 - jumping * 0.55) - sway;
            if (spine) spine.rotation.x = -jumping * 0.12 + this.mikuPulse * 0.04;
            const llg = get('leftUpperLeg'), rlg = get('rightUpperLeg');
            if (llg) llg.rotation.x = jumping * -0.5;   // ジャンプで膝を曲げる
            if (rlg) rlg.rotation.x = jumping * -0.3;
        }
        // 上(次の葉/てっぺん)を見上げる
        const head = get('head');
        if (head) head.rotation.x = -0.12;

        vrm.update(dt);
    }

    // =====================================================================
    // カメラ(縦スクロール追従)
    // =====================================================================
    updateCamera(dt) {
        const targetY = this.climbY + CAM_Y_OFF;
        this.camera.position.x += (0 - this.camera.position.x) * Math.min(1, dt * 3);
        this.camera.position.y += (targetY - this.camera.position.y) * Math.min(1, dt * 3);
        this.camera.position.z = CAM_Z;
        this.camera.lookAt(0, this.climbY + LOOK_Y_OFF, 0);
    }

    updateSun(dt) {
        // 太陽の側へ葉が寄るバイアス(滑らかに)
        const want = THREE.MathUtils.clamp(this.sunX / 5, -1, 1);
        this.sideBias += (want - this.sideBias) * Math.min(1, dt * 2);
        this._positionSun();
        if (this.sunLight) this.sunLight.position.set(this.sunX, this.camera.position.y + 10, 6);
        // 太陽のゆらめき
        if (this.sun) this.sun.material.rotation = (this.sun.material.rotation || 0) + dt * 0.1;
    }

    // =====================================================================
    // 入力
    // =====================================================================
    onClick() { /* BaseSongの汎用CSSリップルは抑止 */ }

    onPointerDown(event) {
        if (!this.isActive || !this.camera || this.isTutorialActive) return;
        if (event.target && event.target.closest &&
            event.target.closest('button, a, input, .song-tutorial-overlay')) return;

        this._setNDC(event);
        this._raycaster.setFromCamera(this._ndc, this.camera);

        // C. 太陽をつかむ
        if (this.sun) {
            const hitSun = this._raycaster.intersectObject(this.sun, false);
            if (hitSun.length) { this.draggingSun = true; this.dismissFirstInteractable(); return; }
        }
        // A. 葉っぱをタッチ → 確定(問いにこたえる)
        const leafMeshes = this.leaves.map(l => l.leaf);
        const hitLeaf = this._raycaster.intersectObjects(leafMeshes, false);
        if (hitLeaf.length) {
            const l = this.leaves.find(x => x.leaf === hitLeaf[0].object);
            if (l && !l.confirmed) { this._confirmLeaf(l); }
            this.dismissFirstInteractable();
            return;
        }
        // B. 空きをタッチ → 葉を生やす(ルートづくり)
        const p = this._raycaster.ray.intersectPlane(this._climbPlane, this._hit);
        if (p && p.y > this.climbY + 0.4 && Math.abs(p.x) < LEAF_X * 2.2) {
            const side = p.x >= 0 ? 1 : -1;
            const leaf = this.spawnLeaf(this._currentLyricText() || '♪', { y: p.y, side });
            leaf.confirmed = true; this.builtCount++;
            this.dismissFirstInteractable();
        }
    }

    onPointerMove(event) {
        if (!this.draggingSun || !this.camera) return;
        this._setNDC(event);
        // NDC.x → 太陽の横位置、NDC.y → 太陽の高さ(光の強さ=成長速度)
        this.sunX = THREE.MathUtils.clamp(this._ndc.x * 7, -7, 7);
        this.sunHeight = THREE.MathUtils.clamp(4 + (this._ndc.y * 0.5 + 0.5) * 6, 3, 10);
    }

    onPointerUp() { this.draggingSun = false; }

    _confirmLeaf(l) {
        l.confirmed = true;
        l.openT = Math.min(l.openT, 0.6); // 開き直すアニメ
        this.answeredCount++;
        this.mikuPulse = 1;
        sfx.play('kotaete_resonance');
        this.setResultSummary({
            lines: [`こたえた葉: ${this.answeredCount}枚`, `つくった足場: ${this.builtCount}`],
            accentColor: '#FFD54A',
        });
    }

    // =====================================================================
    // ゴール(満開のひまわり)
    // =====================================================================
    reachGoal() {
        if (this.goalPending || this.goalReached) return;
        this.goalPending = true;
        this.finishing = true; // 残りの足場を一気に登り切る
        // 最高到達点の上に「満開ひまわり」の足場を出し、ミクをそこへ登らせる
        const topY = (this.leaves.length ? this.leaves[this.leaves.length - 1].y : FIRST_LEAF_Y) + LEAF_SPACING;
        this.goalLeaf = this.spawnLeaf('', { y: topY, side: 0, isGoal: true });
        this.goalLeaf.confirmed = true;
        this.goalLeaf.group.position.x = 0; this.goalLeaf.x = 0;
        this._buildBloom(this.goalLeaf.group, topY);
        this.stemTopTarget = topY + 0.5;
    }

    _buildBloom(parent, y) {
        // 中心の花托
        const core = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20),
            new THREE.MeshStandardMaterial({ color: 0x6b3d1f, roughness: 1 }));
        core.position.set(0, 0, 0.1);
        parent.add(core);
        // 花びら(放射状)。最初は閉じていて bloomOpen で開く。
        this.bloomPetals = [];
        const N = 16;
        const petalMat = new THREE.MeshStandardMaterial({ color: SUN_GOLD, roughness: 0.7, side: THREE.DoubleSide });
        for (let i = 0; i < N; i++) {
            const ang = (i / N) * Math.PI * 2;
            const petal = new THREE.Mesh(new THREE.CircleGeometry(0.42, 8), petalMat);
            petal.scale.set(0.5, 1.3, 1);
            petal.position.set(Math.cos(ang) * 0.8, Math.sin(ang) * 0.8, 0.05);
            petal.rotation.z = ang - Math.PI / 2;
            petal.scale.multiplyScalar(0.01); // 閉じた状態
            parent.add(petal);
            this.bloomPetals.push({ petal, ang });
        }
        this.bloom = { y, open: 0 };
    }

    _onReachBloom() {
        this.goalReached = true;
        this.mikuPulse = 1;
        // 決めポーズ(両手を上げて咲かせる)
        this._victoryPose = true;
        sfx.play('complete');
        this.setResultSummary({
            lines: ['満開のひまわりに到達！', `こたえた葉: ${this.answeredCount}枚 / つくった足場: ${this.builtCount}`],
            accentColor: '#FFD54A', swatch: '#FFD54A',
        });
    }

    updateBloom(dt) {
        if (!this.bloom) return;
        const target = this.goalReached ? 1 : 0.0;
        this.bloom.open += (target - this.bloom.open) * Math.min(1, dt * 2.2);
        const s = this._easeOutBack(this.bloom.open);
        for (const bp of this.bloomPetals) bp.petal.scale.setScalar(0.01 + s * 1.0);
    }

    // =====================================================================
    // メインループ
    // =====================================================================
    update() {
        const realNow = performance.now();
        let dt = Math.min((realNow - this._lastFrameReal) / 1000, 0.05);
        this._lastFrameReal = realNow;
        const now = realNow;

        if (!this.isTutorialActive) this._trackLyrics();

        this.updateStem(dt);
        this.updateLeaves(dt);
        this.updateClimb(dt);
        this.updateMiku(now, dt);
        this.updateBloom(dt);
        this.updateCamera(dt);
        this.updateSun(dt);

        if (this._victoryPose) this._applyVictoryPose(dt);
    }

    _trackLyrics() {
        const p = playerManager.player;
        if (!p || !p.video) return;
        const pos = p.timer ? p.timer.position : this.currentTime;
        const w = p.video.findWord(pos);
        if (w && w.startTime !== this._lastWordStart) {
            this._lastWordStart = w.startTime;
            if (w.text) this._spawnLyricLeaf(w.text);
        }
    }

    _currentLyricText() {
        const p = playerManager.player;
        if (!p || !p.video) return null;
        const pos = p.timer ? p.timer.position : this.currentTime;
        const w = p.video.findWord(pos) || p.video.findChar(pos);
        return (w && w.text) ? w.text : null;
    }

    _applyVictoryPose(dt) {
        const vrm = this.currentVRM;
        if (!vrm || !vrm.humanoid) return;
        const get = (n) => vrm.humanoid.getNormalizedBoneNode(n);
        const lu = get('leftUpperArm'), ru = get('rightUpperArm');
        // 両手を上げて咲かせる
        if (lu) lu.rotation.z += (Math.PI * 0.9 - lu.rotation.z) * Math.min(1, dt * 4);
        if (ru) ru.rotation.z += (-Math.PI * 0.9 - ru.rotation.z) * Math.min(1, dt * 4);
    }

    render() {
        if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    }

    // =====================================================================
    // ヘルパ / 検証フック
    // =====================================================================
    _setNDC(event) {
        this._ndc.set(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1,
        );
    }
    _easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; const p = t - 1; return 1 + c3 * p * p * p + c1 * p * p; }

    // Preview は 0x0 で描画検証できないため、状態機械を直接駆動・観測するフック。
    _debugState() {
        return {
            leaves: this.leaves.length,
            stemTop: +this.stemDisplay.toFixed(2),
            stemTarget: +this.stemTopTarget.toFixed(2),
            mikuY: +this.climbY.toFixed(2),
            mikuLeafIndex: this.currentLeafIndex,
            climbState: this.climbState,
            answered: this.answeredCount,
            built: this.builtCount,
            goalReached: this.goalReached,
            bloomOpen: this.bloom ? +this.bloom.open.toFixed(2) : null,
            mikuLoaded: this.mikuLoaded,
        };
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
    }

    _disposeVRM(vrm) {
        try {
            vrm?.scene?.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose && m.dispose());
            });
        } catch (_) { /* noop */ }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        this.songWrapper.removeEventListener('pointerdown', this.boundOnPointerDown);
        window.removeEventListener('pointermove', this.boundOnPointerMove);
        window.removeEventListener('pointerup', this.boundOnPointerUp);
        eventBus.off('songEnd', this.boundOnSongEnd);

        this.leaves.forEach(l => {
            this.scene.remove(l.group);
            l.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose && m.dispose()); });
            l.tex && l.tex.dispose();
        });
        this.leaves = [];

        if (this.currentVRM) { this.scene.remove(this.currentVRM.scene); this._disposeVRM(this.currentVRM); this.currentVRM = null; }
        if (this.sun) { this.scene.remove(this.sun); this.sun.material.dispose(); }
        this._sunTex && this._sunTex.dispose();
        [this.stem, this.ground, this.sky].forEach(m => {
            if (!m) return; this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => mm.dispose && mm.dispose());
        });

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
        super.destroy();
    }
}
