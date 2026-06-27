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

// ── まだ行けるよモード（#119: 暴走は残す。破綻は消す。）──
const LEAF_HARD_CAP = 64;       // 葉の総数上限(超過分は通過済みの下方から回収=重さ防止)
const CAM_LAG = 1.4;            // カメラ追従の鈍さ(小さいほど遅れて追う=暴走感)
const CAM_MAX_LEAD = 7.0;       // ミクがカメラより上へ離れてよい上限(超えたら一気に追う=画面外消失防止)
const SPAM_WINDOW = 320;        // 連打判定の時間窓(ms)
const SPAM_BURST_MAX = 3;       // 連打加速時に1クリックで足す葉の最大数

const LEAF_GREEN = '#3f8f4a';
const LEAF_GREEN_D = '#2c6b37';
const SUN_GOLD = new THREE.Color('#FFD54A');

export class SongKotaete extends BaseSong {
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
        this.sunHeight = 7.0;          // 太陽の高さ(空での位置)
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

        // ---- まだ行けるよモード(#119) ----
        this._altitude = 0;            // 到達高度(HUD・オチ用、climbYの最大)
        this._lastClickAt = -Infinity; // 連打加速の計測
        this._clickStreak = 0;         // 連続クリック数(暴走の段階)
        this._hudEl = null;            // 高度HUD
        this._finaleEl = null;         // 締め字幕
        this._overflowFired = false;   // オチの空フラッシュ発火済み

        // ---- 雲(高度に応じて横の空きに湧く / 歌詞を乗せる / 衝突で霧散) ----
        this._clouds = [];
        this._cloudPuffs = [];         // 衝突の霧散パーティクル
        this._lastCloudAt = -Infinity; // 雲の生成レート(実時間ms)
        this._lyricCloudAt = -Infinity;// 歌詞雲のレート
        this._cloudSide = 1;           // 左右交互

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

        this._ensureHud(); // 高度HUDを常設(オチの伏線)

        this.highlightFirstInteractable(() => {
            if (this.answeredCount > 0 || this.builtCount > 0) return null;
            return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.62 };
        }, { label: 'クリック連打で葉を伸ばせ！ミクを空へ', autoDismissMs: 9000 });
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

        // 空(青)と地(緑)の自然な回り込み＋太陽の方向光で立体感を出す
        this.hemiLight = new THREE.HemisphereLight(0xbfe3ff, 0x5f9a44, 0.9);
        this.scene.add(this.hemiLight);
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(this.ambientLight);
        this.sunLight = new THREE.DirectionalLight(0xfff1bf, 2.0);
        this.sunLight.position.set(this.sunX, 12, 6);
        this.scene.add(this.sunLight);
        // カメラ側からの弱いフィル(正面の陰を起こす)
        this.fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
        this.fillLight.position.set(0, 2, 12);
        this.scene.add(this.fillLight);
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
        // 縦の縞・微かな艶を持たせた茎。単位高(y -0.5..0.5)を scale.y で伸ばす。
        const tex = this._stemTexture();
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        this._stemTex = tex;
        const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x74bf45, roughness: 0.72, metalness: 0.02 });
        const geo = new THREE.CylinderGeometry(STEM_R * 0.5, STEM_R * 1.1, 1, 18, 1, true);
        this.stem = new THREE.Mesh(geo, mat);
        this.stem.position.set(0, this.stemDisplay / 2, 0);
        this.stem.scale.y = this.stemDisplay;
        this.scene.add(this.stem);

        // 芽(双葉) — 小さな本物の葉
        this._ensureLeafAssets();
        for (const sx of [-1, 1]) {
            const f = this._buildFoliage(sx, 0.6);
            f.position.set(sx * 0.32, 0.5, 0.05);
            f.rotation.z = sx * 0.5;
            this.scene.add(f);
        }
    }

    _stemTexture() {
        const W = 48, H = 256;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, '#3f8a36'); g.addColorStop(0.45, '#7cc94a');
        g.addColorStop(0.6, '#9bdc63'); g.addColorStop(1, '#3a8030');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        // 縦の繊維(濃淡)
        x.globalAlpha = 0.25;
        for (let i = 0; i < 7; i++) {
            x.strokeStyle = i % 2 ? '#2f6e28' : '#a9e26f';
            x.lineWidth = 1 + Math.random();
            const px = 4 + Math.random() * (W - 8);
            x.beginPath(); x.moveTo(px, 0); x.lineTo(px + (Math.random() - 0.5) * 4, H); x.stroke();
        }
        x.globalAlpha = 1;
        return new THREE.CanvasTexture(c);
    }

    // 葉のジオメトリ(卵形＋葉脈テクスチャ＋カップ状の起伏)とマテリアルを一度だけ用意
    _ensureLeafAssets() {
        if (this._leafGeo) return;
        // --- 形状(基部=原点, 先端=+x) ---
        const L = 1.0, Wd = 0.62;
        const sh = new THREE.Shape();
        sh.moveTo(0, 0);
        sh.bezierCurveTo(L * 0.28, Wd * 0.55, L * 0.72, Wd * 0.5, L, 0);
        sh.bezierCurveTo(L * 0.72, -Wd * 0.5, L * 0.28, -Wd * 0.55, 0, 0);
        const geo = new THREE.ShapeGeometry(sh, 36);
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const sxw = bb.max.x - bb.min.x, syw = bb.max.y - bb.min.y;
        const pos = geo.attributes.position, uv = geo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            const px = pos.getX(i), py = pos.getY(i);
            uv.setXY(i, (px - bb.min.x) / sxw, (py - bb.min.y) / syw);
            const vy = py / Wd;                 // -1..1
            const along = px / L;               // 0基部..1先端
            pos.setZ(i, (vy * vy) * 0.17 - along * along * 0.10); // 縁が立ち上がり、先がやや垂れる
        }
        pos.needsUpdate = true; uv.needsUpdate = true;
        geo.computeVertexNormals();
        // 中央を原点付近へ寄せて、ミクが葉の真ん中に立つように
        geo.translate(-0.42, 0, 0);
        this._leafGeo = geo;
        this._leafVeinTex = this._leafVeinTexture();
    }

    _leafVeinTexture() {
        const W = 256, H = 168;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, LEAF_GREEN_D); g.addColorStop(0.5, LEAF_GREEN);
        g.addColorStop(1, LEAF_GREEN_D);
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        // 主脈(基部 u≈0 → 先端 u≈1)
        x.strokeStyle = 'rgba(20,60,24,0.55)'; x.lineWidth = 4;
        x.beginPath(); x.moveTo(8, H / 2); x.lineTo(W - 8, H / 2); x.stroke();
        // 側脈
        x.strokeStyle = 'rgba(20,60,24,0.35)'; x.lineWidth = 2;
        for (let i = 1; i <= 6; i++) {
            const u = 14 + (W - 30) * (i / 7);
            x.beginPath(); x.moveTo(u, H / 2); x.lineTo(u + 22, 14); x.stroke();
            x.beginPath(); x.moveTo(u, H / 2); x.lineTo(u + 22, H - 14); x.stroke();
        }
        // ハイライト(基部寄りの艶)
        const hl = x.createRadialGradient(W * 0.32, H * 0.4, 4, W * 0.32, H * 0.4, 70);
        hl.addColorStop(0, 'rgba(220,255,200,0.35)'); hl.addColorStop(1, 'rgba(220,255,200,0)');
        x.fillStyle = hl; x.fillRect(0, 0, W, H);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    // 一枚の葉メッシュ(side: -1左/+1右, scale)。テキストは持たない純粋な3D葉。
    _buildFoliage(side, scale = 1) {
        this._ensureLeafAssets();
        const mat = new THREE.MeshStandardMaterial({
            map: this._leafVeinTex, side: THREE.DoubleSide, roughness: 0.62, metalness: 0.0,
            emissive: 0x000000,
        });
        const mesh = new THREE.Mesh(this._leafGeo, mat);
        mesh.scale.set(side * scale, scale, scale); // 左は x 反転
        return mesh;
    }

    // カメラへ正対する可読テキスト札(歌詞)。葉の上に重ねる。
    _makeTextLabel(text) {
        const W = 360, H = 130;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        // 角丸の暗い帯(背景と同化させない)
        x.fillStyle = 'rgba(18,40,18,0.62)';
        const r = 26, pad = 8;
        x.beginPath();
        x.roundRect(pad, pad, W - pad * 2, H - pad * 2, r);
        x.fill();
        x.strokeStyle = 'rgba(255,236,150,0.5)'; x.lineWidth = 3; x.stroke();
        let fs = 58;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        do { x.font = `bold ${fs}px "Inter","Noto Sans JP",sans-serif`; fs -= 4; }
        while (fs > 20 && x.measureText(text).width > W - 60);
        x.lineWidth = 6; x.strokeStyle = 'rgba(8,24,8,0.95)'; x.strokeText(text, W / 2, H / 2 + 2);
        x.fillStyle = '#ffffff'; x.fillText(text, W / 2, H / 2 + 2);
        const tex = new THREE.CanvasTexture(c);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
        spr.scale.set(1.5, 0.54, 1);
        spr.userData.tex = tex;
        return spr;
    }

    // 花びら1枚のジオメトリ(基部=原点, 先端=+x の尖った卵形, カップ状)
    _petalGeometry() {
        if (this._petalGeo) return this._petalGeo;
        const L = 1.0, Wd = 0.26;
        const sh = new THREE.Shape();
        sh.moveTo(0, 0);
        sh.bezierCurveTo(L * 0.2, Wd, L * 0.82, Wd * 0.7, L, 0);
        sh.bezierCurveTo(L * 0.82, -Wd * 0.7, L * 0.2, -Wd, 0, 0);
        const geo = new THREE.ShapeGeometry(sh, 18);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const py = pos.getY(i);
            pos.setZ(i, (py / Wd) * (py / Wd) * 0.07); // 縦に軽くカップ
        }
        pos.needsUpdate = true; geo.computeVertexNormals();
        this._petalGeo = geo;
        return geo;
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

        let foliage = null, label = null;
        if (!opts.isGoal) {
            // 茎から葉への葉柄(petiole)
            const stalk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.07, Math.abs(x) || LEAF_X, 6),
                new THREE.MeshStandardMaterial({ color: 0x4c9a3f, roughness: 0.8 }));
            stalk.position.set(-x / 2, 0, -0.02); stalk.rotation.z = Math.PI / 2;
            group.add(stalk);

            // 3Dの葉(卵形＋葉脈＋カップ)。先端を少し上へ。札より大きくして葉らしさを見せる。
            foliage = this._buildFoliage(side, 2.15);
            foliage.rotation.z = side * 0.14;
            group.add(foliage);

            // 可読テキスト札(カメラ正対・暗い帯で同化を防ぐ)。葉の内側に寄せる。
            label = this._makeTextLabel(text || '♪');
            label.position.set(side * -0.15, 0.05, 0.4);
            group.add(label);
        }
        this.scene.add(group);

        const item = {
            group, foliage, label, y, x, side, text: text || '',
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
            l.group.scale.setScalar(this._easeOutBack(l.openT));
            // 確定/着地でほのかに光る(葉は発光、札は不透明度UP)
            const targetGlow = (l.confirmed ? 0.55 : 0) + (l.landed ? 0.25 : 0);
            l.glow += (targetGlow - l.glow) * Math.min(1, dt * 6);
            if (l.foliage) l.foliage.material.emissive.setRGB(l.glow * 0.45, l.glow * 0.55, l.glow * 0.18);
            if (l.label) l.label.material.opacity = Math.min(1, 0.9 + l.glow * 0.1);
            // そよ風で群ごと軽く揺れる
            l.group.rotation.z = Math.sin(l.born * 1.2 + l.index) * 0.03;
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

        // idle: 自分より上で一番近い葉へ。ただし上に葉が積み上がっている(バックログ)ほど
        // 数枚スキップして上の葉へ「超ジャンプ」する(=連打の暴走が勢いに化ける/#119)。
        if (this._jumpCooldown > 0) return;
        const next = this._nextLeafAbove(this.climbY);
        if (!next) return;

        let target = next, level = 0;
        if (!this.finishing) {
            const above = this.leaves
                .filter(l => !l.landed && !l.isGoal && l.y > this.climbY + 0.15)
                .sort((a, b) => a.y - b.y);
            if (above.length >= 4) {
                const skip = Math.min(above.length - 1, 1 + Math.floor(above.length / 4));
                target = above[skip];
                level = Math.min(4, Math.floor(above.length / 4));
                // スキップした下の葉は通過済み扱い(回収対象になり、見た目は下へ流れる)
                for (let k = 0; k < skip; k++) above[k].landed = true;
            }
        }
        this._startJump(target, level);
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

    _startJump(leaf, level = 0) {
        this.climbState = 'jumping';
        this.faceDir = Math.sign(leaf.x - this.climbX) || 0;
        this.jump = {
            fromX: this.climbX, fromY: this.climbY,
            toX: leaf.x, toY: leaf.y, toLeaf: leaf, t: 0, level,
        };
        // デッドパン方針: 超ジャンプでも煽らない。踏み切り音だけ(欠損時は無音)。
        sfx.play('ripple');
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
        // わざと鈍く追う(=ミクが一時的に上へ抜けて暴走感)。離れすぎたら一気に追って
        // 画面外に消えっぱなしになるのを防ぐ(破綻ガード)。終盤は登り切りを見せる。
        const lead = this.climbY - this.camera.position.y;
        let k = dt * CAM_LAG;
        if (lead > CAM_MAX_LEAD) k = dt * 7;
        else if (this.finishing) k = dt * 4;
        this.camera.position.x += (0 - this.camera.position.x) * Math.min(1, dt * 3);
        this.camera.position.y += (targetY - this.camera.position.y) * Math.min(1, k);
        this.camera.position.z = CAM_Z;
        // 位置は遅れて追いつつ、画角はミクを見上げて追う(ぶっ飛ぶと上を仰ぐ)。
        this.camera.lookAt(0, this.climbY + LOOK_Y_OFF, 0);
    }

    updateSun(dt) {
        // 終盤: 太陽は「飛んでいく先」。巨大化＆ミクの到達点へ降りてきて、
        // 暴走の果てに“太陽へ着く”絵を作る(真顔のイカロス)。
        if (this._sunFinale && this.sun) {
            this._sunSwell = Math.min(1, (this._sunSwell || 0) + dt * 0.7);
            const s = 5 + this._sunSwell * 18;
            this.sun.scale.set(s, s, 1);
            const ty = (this.goalLeaf ? this.goalLeaf.y : this.climbY) + 2.2;
            this.sun.position.y += (ty - this.sun.position.y) * Math.min(1, dt * 2);
            this.sun.position.x += (0 - this.sun.position.x) * Math.min(1, dt * 2);
            this.sun.position.z = -6;
            if (this.sunLight) this.sunLight.intensity = 2.0 + this._sunSwell * 2.2;
            this.sun.material.rotation = (this.sun.material.rotation || 0) + dt * 0.2;
            return;
        }
        // 通常: 太陽は常に空(カメラ上方)にいる=これから登っていく終着点
        const want = THREE.MathUtils.clamp(this.sunX / 5, -1, 1);
        this.sideBias += (want - this.sideBias) * Math.min(1, dt * 2);
        this._positionSun();
        if (this.sunLight) this.sunLight.position.set(this.sunX, this.camera.position.y + 10, 6);
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

        // A. 葉っぱ(葉本体 or テキスト札)をタッチ → 確定(問いにこたえる)
        const targets = [];
        for (const l of this.leaves) { if (l.foliage) targets.push(l.foliage); if (l.label) targets.push(l.label); }
        const hitLeaf = this._raycaster.intersectObjects(targets, false);
        if (hitLeaf.length) {
            const o = hitLeaf[0].object;
            const l = this.leaves.find(x => x.foliage === o || x.label === o);
            if (l && !l.confirmed) { this._confirmLeaf(l); }
            this.dismissFirstInteractable();
            return;
        }
        // B. 空きをタッチ → 葉を生やす(ルートづくり)。連打加速で“暴走”させる(#119)。
        const p = this._raycaster.ray.intersectPlane(this._climbPlane, this._hit);
        if (p && Math.abs(p.x) < LEAF_X * 3.2 && !this.finishing) {
            // 短時間に連続クリックするほど 1回で多くの葉を積む(=塔が一気に伸びる)
            const tnow = performance.now();
            this._clickStreak = (tnow - this._lastClickAt < SPAM_WINDOW) ? this._clickStreak + 1 : 0;
            this._lastClickAt = tnow;
            const burst = 1 + Math.min(SPAM_BURST_MAX, Math.floor(this._clickStreak / 3));
            const baseY = Math.max(this.climbY + 0.6, p.y);
            for (let i = 0; i < burst; i++) {
                // 上限は“生成を止める”のではなく“通過済みの葉を下から回収して席を空ける”で守る
                // (生成を止めると、登り切った後に新しい足場が生えず操作不能になるため)。
                if (this.leaves.length >= LEAF_HARD_CAP) this._recycleLeaves(true);
                const side = (i === 0) ? (p.x >= 0 ? 1 : -1) : (Math.random() < 0.5 ? -1 : 1);
                const yy = baseY + i * LEAF_SPACING * (0.7 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.4;
                const leaf = this.spawnLeaf(this._currentLyricText() || '♪', { y: yy, side });
                leaf.confirmed = true; this.builtCount++;
            }
            this.dismissFirstInteractable();
        }
    }

    // 太陽は「飛んでいく先」になったので、もう操作対象ではない(ドラッグ廃止)。
    onPointerMove() { /* no-op */ }
    onPointerUp() { /* no-op */ }

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
    // まだ行けるよモード UI(#119): 導入・高度HUD・超ジャンプラベル・オチ
    // =====================================================================
    _ensureModeStyles() {
        if (document.getElementById('kotaete-mada-styles')) return;
        const s = document.createElement('style');
        s.id = 'kotaete-mada-styles';
        s.textContent = `
            .mada-intro {
                position:absolute; left:50%; top:22%; transform:translate(-50%,-50%);
                z-index:60; pointer-events:none; text-align:center;
                font-family:"Noto Sans JP",sans-serif; color:#fff;
                opacity:0; transition:opacity .5s ease, transform .5s ease;
                text-shadow:0 2px 10px rgba(0,0,0,.45);
            }
            .mada-intro.show { opacity:1; transform:translate(-50%,-50%) scale(1.0); }
            .mada-intro .t { font-size:clamp(22px,6vw,40px); font-weight:800; letter-spacing:2px;
                color:#FFD54A; text-shadow:0 0 16px rgba(255,213,74,.7),0 2px 8px rgba(0,0,0,.5); }
            .mada-intro .s { margin-top:10px; font-size:clamp(12px,3.2vw,16px); line-height:1.7; font-weight:600; }
            .mada-hud {
                position:absolute; right:14px; top:64px; z-index:55; pointer-events:none;
                font-family:"Courier New",monospace; font-weight:bold; text-align:right;
                color:#2c6b37; text-shadow:0 1px 4px rgba(255,255,255,.6);
            }
            .mada-hud .alt { font-size:clamp(18px,4.4vw,30px); color:#3f8f4a; }
            .mada-hud .unit { font-size:11px; letter-spacing:2px; opacity:.8; }
            .mada-finale {
                position:absolute; inset:0; z-index:62; pointer-events:none;
                display:flex; flex-direction:column; align-items:center; justify-content:center;
                font-family:"Noto Sans JP",sans-serif; color:#fff; text-align:center;
                opacity:0; transition:opacity 1.0s ease;
            }
            .mada-finale.show { opacity:1; }
            .mada-finale .cap { font-size:clamp(15px,4vw,24px); font-weight:700; letter-spacing:2px;
                text-shadow:0 2px 12px rgba(0,0,0,.55); }
            .mada-flash { position:absolute; inset:0; z-index:61; pointer-events:none;
                background:#fff; opacity:0; }
            .mada-flash.fire { animation:madaFlash .9s ease-out forwards; }
            @keyframes madaFlash { 0%{opacity:0;} 12%{opacity:.85;} 100%{opacity:0;} }
        `;
        document.head.appendChild(s);
    }

    // 開始時: これは「ネタ寄りの暴走モード」だと伝える短い導入
    _showModeIntro() {
        this._ensureModeStyles();
        const el = document.createElement('div');
        el.className = 'mada-intro';
        el.innerHTML = `
            <div class="t">まだ行けるよモード</div>
            <div class="s">クリック連打で答えの葉を伸ばそう。<br>伸ばしすぎると、ミクが空へ飛びます。</div>
        `;
        this.songWrapper.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { if (el.parentNode) el.classList.remove('show'); }, 4200);
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 4900);
    }

    _ensureHud() {
        if (this._hudEl) return;
        this._ensureModeStyles();
        const el = document.createElement('div');
        el.className = 'mada-hud';
        el.innerHTML = `<span class="alt">0</span><span class="unit"> m</span>`;
        this.songWrapper.appendChild(el);
        this._hudEl = el;
        this._hudAltSpan = el.querySelector('.alt');
    }

    _updateHud() {
        if (!this._hudEl) this._ensureHud();
        // 昇った高度。バカっぽく1単位=10m換算で水増しして爆発感を出す(真顔の異常さ)
        const val = Math.max(0, Math.round((this._altitude - GROUND_Y) * 10));
        if (this._hudAltSpan) this._hudAltSpan.textContent = val.toLocaleString();
    }

    // 破綻ガード: 葉が増えたら、ミクが通過済み(landed かつ足元より下)の葉を下から回収。
    // 上方の「塔」と足元付近は残すので“めちゃくちゃ伸びてる感”は保たれ、かつ churn する
    // ので「上限で生成が止まって操作不能」にはならない。
    // makeRoom=true のときは、上限ぴったりでも1枚は席を空ける(生成直前の呼び出し用)。
    _recycleLeaves(makeRoom = false) {
        const over = this.leaves.length - LEAF_HARD_CAP;
        const target = makeRoom ? Math.max(1, over + 1) : over;
        if (target <= 0) return;
        let removed = 0;
        for (let i = 0; i < this.leaves.length && removed < target; ) {
            const l = this.leaves[i];
            if (!l.isGoal && l.landed && l.y < this.climbY - 2) {
                this._disposeLeaf(l);
                this.leaves.splice(i, 1);
                removed++;
            } else { i++; }
        }
    }

    _disposeLeaf(l) {
        this.scene.remove(l.group);
        l.group.traverse(o => {
            if (o.geometry && o.geometry !== this._leafGeo && o.geometry !== this._petalGeo) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
                if (m.map && m.map !== this._leafVeinTex) m.map.dispose();
                m.dispose && m.dispose();
            });
        });
    }

    // オチ(デッドパン): 太陽へ迫った瞬間に空が一瞬だけ白む(過露光)。文字での煽りはしない。
    _overflowFinale() {
        if (this._overflowFired) return;
        this._overflowFired = true;
        this._ensureModeStyles();
        const flash = document.createElement('div');
        flash.className = 'mada-flash';
        this.songWrapper.appendChild(flash);
        requestAnimationFrame(() => flash.classList.add('fire'));
        setTimeout(() => { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 950);
    }

    // 着地後のオチ字幕(真顔で一行だけ。テーマへ軽く戻す)
    _finaleCaption() {
        this._ensureModeStyles();
        const el = document.createElement('div');
        el.className = 'mada-finale';
        el.innerHTML = `<div class="cap">こたえは、まだ空の上。</div>`;
        this.songWrapper.appendChild(el);
        this._finaleEl = el;
        requestAnimationFrame(() => el.classList.add('show'));
    }

    // =====================================================================
    // 雲(#119): 高度に応じて横の空きに湧き、歌詞を乗せて読ませる。
    //   ミクがぶっ飛んで通り過ぎると衝突して霧散する(物理ギャグ)。
    // =====================================================================
    _cloudTexture() {
        if (this._cloudTex) return this._cloudTex;
        const W = 256, H = 160;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        // やわらかい白い塊を複数重ねて雲のシルエットに
        const blobs = [[128, 95, 60], [80, 100, 44], [176, 100, 44], [108, 70, 40], [150, 72, 40]];
        for (const [bx, by, br] of blobs) {
            const g = x.createRadialGradient(bx, by, 2, bx, by, br);
            g.addColorStop(0, 'rgba(255,255,255,0.95)');
            g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g;
            x.beginPath(); x.arc(bx, by, br, 0, Math.PI * 2); x.fill();
        }
        this._cloudTex = new THREE.CanvasTexture(c);
        return this._cloudTex;
    }

    // 雲に乗せる歌詞ラベル(濃い文字＋白フチ＝雲に書いてあるように読める)
    _makeCloudLabel(text) {
        const W = 380, H = 120;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        let fs = 56; x.textAlign = 'center'; x.textBaseline = 'middle';
        do { x.font = `bold ${fs}px "Inter","Noto Sans JP",sans-serif`; fs -= 4; }
        while (fs > 18 && x.measureText(text).width > W - 36);
        x.lineWidth = 11; x.strokeStyle = 'rgba(255,255,255,0.96)'; x.strokeText(text, W / 2, H / 2);
        x.lineWidth = 4; x.strokeStyle = 'rgba(150,190,230,0.5)'; x.strokeText(text, W / 2, H / 2);
        x.fillStyle = '#2b4a6b'; x.fillText(text, W / 2, H / 2);
        const tex = new THREE.CanvasTexture(c);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
        spr.scale.set(2.0, 0.63, 1);
        spr.userData.tex = tex;
        return spr;
    }

    // 雲を1つ生やす。lyric があれば歌詞札を乗せる。side で左右の空きへ寄せる。
    _spawnCloud(opts = {}) {
        if (this._clouds.length >= (this.isMobile ? 12 : 18)) return null;
        const side = opts.side || this._cloudSide;
        this._cloudSide = -side; // 交互
        const group = new THREE.Group();
        // 横の空き(葉は±1.5)。歌詞雲は読みやすい中距離、装飾雲は外側まで。
        const xMin = opts.lyric ? 3.4 : 3.0;
        const xMax = opts.lyric ? 5.4 : 7.2;
        const x = side * (xMin + Math.random() * (xMax - xMin));
        const y = (opts.y != null) ? opts.y : (this.climbY + 3 + Math.random() * 11);
        group.position.set(x, y, opts.lyric ? -1.5 : -3 - Math.random() * 3);

        const puff = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this._cloudTexture(), transparent: true, opacity: 0, depthWrite: false, depthTest: true,
        }));
        const w = 3.0 + Math.random() * 2.4;
        puff.scale.set(w, w * 0.62, 1);
        group.add(puff);

        let label = null;
        if (opts.lyric) {
            label = this._makeCloudLabel(opts.lyric); // 雲に“書いてある”見た目(濃い文字+白フチ)
            label.position.set(0, 0, 0.2);
            group.add(label);
        }
        this.scene.add(group);
        const cloud = {
            group, puff, label,
            x, y, vx: (Math.random() * 0.3 + 0.1) * (Math.random() < 0.5 ? -1 : 1),
            halfW: w * 0.5, born: 0, appear: 0, lyric: !!opts.lyric, dead: false,
        };
        this._clouds.push(cloud);
        return cloud;
    }

    _spawnLyricCloud(text) {
        const now = performance.now();
        if (now - this._lyricCloudAt < 1400) return;
        this._lyricCloudAt = now;
        this._spawnCloud({ lyric: text });
    }

    // 衝突: 雲を白い粒へ霧散させて消す
    _scatterCloud(cloud) {
        if (cloud.dead) return;
        cloud.dead = true;
        const n = this.isMobile ? 5 : 8;
        const tex = this._cloudTexture();
        for (let i = 0; i < n; i++) {
            const m = new THREE.Sprite(new THREE.SpriteMaterial({
                map: tex, transparent: true, opacity: 0.9, depthWrite: false,
            }));
            const s = 0.6 + Math.random() * 0.9;
            m.scale.set(s, s, 1);
            m.position.set(cloud.group.position.x, cloud.group.position.y, cloud.group.position.z);
            this.scene.add(m);
            this._cloudPuffs.push({
                spr: m, life: 0.6 + Math.random() * 0.3, age: 0,
                vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 5 + 1,
            });
        }
        this._disposeCloud(cloud);
    }

    _disposeCloud(cloud) {
        this.scene.remove(cloud.group);
        cloud.group.traverse(o => {
            if (o.material) {
                // ラベル札の固有テクスチャのみ破棄(共有の雲テクスチャ _cloudTex は残す)
                if (o.material.map && o.material.map !== this._cloudTex) o.material.map.dispose();
                o.material.dispose && o.material.dispose();
            }
        });
        const i = this._clouds.indexOf(cloud);
        if (i >= 0) this._clouds.splice(i, 1);
    }

    _updateClouds(dt) {
        // 高度が上がるほど雲が増える。ミクが登っている間だけ供給。
        const now = performance.now();
        const rate = this.climbY > 6 ? 750 : 1100;
        if (!this.finishing && now - this._lastCloudAt > rate) {
            this._lastCloudAt = now;
            this._spawnCloud({});
        }

        const mikuY = this.climbY + (this._jumpArc || 0);
        const mikuX = this.climbX;
        const jumping = this.climbState === 'jumping';
        for (let i = this._clouds.length - 1; i >= 0; i--) {
            const c = this._clouds[i];
            c.born += dt;
            c.appear = Math.min(1, c.appear + dt * 1.5);
            c.group.position.x += c.vx * dt;
            c.group.position.y += Math.sin(c.born * 0.6) * 0.12 * dt; // ゆるい上下
            const baseOp = c.lyric ? 0.92 : 0.7;
            c.puff.material.opacity = baseOp * c.appear;
            if (c.label) c.label.material.opacity = c.appear;

            // ミクがぶっ飛んで通り過ぎると衝突 → 霧散(登坂中のみ＝“突っ込んだ”感)
            if (jumping) {
                const dy = Math.abs(c.group.position.y - mikuY);
                const dx = Math.abs(c.group.position.x - mikuX);
                if (dy < 1.7 && dx < c.halfW + 1.6) { this._scatterCloud(c); continue; }
            }
            // 画面下方へ流れ去った雲は回収
            if (c.group.position.y < this.camera.position.y - 13) { this._disposeCloud(c); }
        }

        // 霧散パーティクル
        for (let i = this._cloudPuffs.length - 1; i >= 0; i--) {
            const p = this._cloudPuffs[i];
            p.age += dt;
            const k = p.age / p.life;
            if (k >= 1) { this.scene.remove(p.spr); p.spr.material.dispose(); this._cloudPuffs.splice(i, 1); continue; }
            p.spr.position.x += p.vx * dt;
            p.spr.position.y += p.vy * dt;
            p.vy -= 4 * dt;
            p.spr.material.opacity = 0.9 * (1 - k);
            p.spr.scale.multiplyScalar(1 + dt * 1.2);
        }
    }

    // =====================================================================
    // ゴール(満開のひまわり)
    // =====================================================================
    reachGoal() {
        if (this.goalPending || this.goalReached) return;
        this.goalPending = true;
        this.finishing = true; // 一気に締めへ
        this._sunFinale = true; // 太陽が終着点として降りてきて巨大化(飛んでいく先)
        // 塔がどれだけ高くても確実に締まるよう、既存の葉は通過済みにして、
        // ミクを満開ひまわりへ“最後の超ジャンプ”で一気に到達させる。
        const highest = this.leaves.length ? this.leaves[this.leaves.length - 1].y : FIRST_LEAF_Y;
        this.leaves.forEach(l => { if (!l.isGoal) l.landed = true; });
        const topY = Math.max(this.climbY, highest) + LEAF_SPACING * 1.6;
        this.goalLeaf = this.spawnLeaf('', { y: topY, side: 0, isGoal: true });
        this.goalLeaf.confirmed = true;
        this.goalLeaf.group.position.x = 0; this.goalLeaf.x = 0;
        this._buildBloom(this.goalLeaf.group, topY);
        this.stemTopTarget = topY + 0.5;
    }

    _buildBloom(parent, y) {
        // --- 中心(花托): 手前へ膨らむ茶色のドーム ---
        const centerMat = new THREE.MeshStandardMaterial({ color: 0x5a3417, roughness: 0.95 });
        const center = new THREE.Mesh(new THREE.SphereGeometry(0.74, 30, 22), centerMat);
        center.scale.set(1, 1, 0.46);
        center.position.set(0, 0, 0.14);
        parent.add(center);
        this._bloomCenterMat = centerMat;

        // --- 種(phyllotaxis 螺旋に並ぶ): InstancedMesh で大量配置 ---
        const seedCount = this.isMobile ? 120 : 220;
        const seedGeo = new THREE.CylinderGeometry(0.016, 0.03, 0.06, 5);
        seedGeo.rotateX(Math.PI / 2); // +zへ向ける
        const seedMat = new THREE.MeshStandardMaterial({ color: 0x271a0c, roughness: 0.85 });
        const seeds = new THREE.InstancedMesh(seedGeo, seedMat, seedCount);
        const golden = Math.PI * (3 - Math.sqrt(5));
        const mtx = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        for (let i = 0; i < seedCount; i++) {
            const r = 0.66 * Math.sqrt(i / seedCount);
            const a = i * golden;
            p.set(Math.cos(a) * r, Math.sin(a) * r, 0.14 + Math.sqrt(Math.max(0, 0.55 - r * r)) * 0.42);
            const s = 0.7 + (i / seedCount) * 0.8;
            sc.set(s, s, s);
            mtx.compose(p, q, sc);
            seeds.setMatrixAt(i, mtx);
        }
        seeds.instanceMatrix.needsUpdate = true;
        parent.add(seeds);
        this._bloomSeeds = seeds;

        // --- 花びら: 2重リングの尖った花弁(カップ状)。閉→開アニメ ---
        this.bloomPetals = [];
        const petalGeo = this._petalGeometry();
        const petalMat = new THREE.MeshStandardMaterial({
            color: SUN_GOLD, roughness: 0.55, side: THREE.DoubleSide,
            emissive: 0x4a3500, emissiveIntensity: 0.18,
        });
        this._bloomPetalMat = petalMat;
        const rings = [{ n: 14, r: 0.72, len: 0.95 }, { n: 16, r: 0.92, len: 1.18 }];
        rings.forEach((ring, ri) => {
            for (let i = 0; i < ring.n; i++) {
                const ang = (i / ring.n) * Math.PI * 2 + (ri ? Math.PI / ring.n : 0);
                const petal = new THREE.Mesh(petalGeo, petalMat);
                petal.position.set(Math.cos(ang) * ring.r, Math.sin(ang) * ring.r, 0.02 - ri * 0.03);
                petal.rotation.z = ang;            // 外向き
                petal.scale.setScalar(ring.len * 0.01); // 閉じた状態
                parent.add(petal);
                this.bloomPetals.push({ petal, base: ring.len, ang });
            }
        });
        this.bloom = { y, open: 0 };
    }

    _onReachBloom() {
        this.goalReached = true;
        this.mikuPulse = 1;
        // 決めポーズ(両手を上げて咲かせる)
        this._victoryPose = true;
        sfx.play('complete');
        this._overflowFinale(); // 太陽へ着いた瞬間、空が一瞬だけ白む(過露光)
        this._finaleCaption();  // 真顔の一行(テーマへ軽く戻す)
        const peak = Math.max(0, Math.round((this._altitude - GROUND_Y) * 10));
        this.setResultSummary({
            lines: [`まだ行けるよモード クリア`, `到達こたえ高度: ${peak} ・ 生やした葉: ${this.builtCount}枚`],
            accentColor: '#FFD54A', swatch: '#FFD54A',
        });
    }

    updateBloom(dt) {
        if (!this.bloom) return;
        const target = this.goalReached ? 1 : 0.0;
        this.bloom.open += (target - this.bloom.open) * Math.min(1, dt * 2.2);
        const s = this._easeOutBack(this.bloom.open);
        for (const bp of this.bloomPetals) {
            bp.petal.scale.setScalar(Math.max(0.01, bp.base * s));
            // 開きながら少しだけ起き上がる(unfurl)
            bp.petal.position.z = (0.02) + (1 - this.bloom.open) * 0.18;
        }
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

        // 再生が始まった瞬間に一度だけ「まだ行けるよモード」を提示(チュートリアル後)
        if (!this._introShown && !this.isTutorialActive
            && playerManager.player && playerManager.player.isPlaying) {
            this._introShown = true;
            this._showModeIntro();
        }

        this.updateStem(dt);
        this.updateLeaves(dt);
        this.updateClimb(dt);
        this.updateMiku(now, dt);
        this.updateBloom(dt);
        this.updateCamera(dt);
        this.updateSun(dt);
        this._updateClouds(dt);

        // 到達高度の更新 + HUD(バカっぽい爆発カウンタ) + 破綻ガード(葉の回収)
        this._altitude = Math.max(this._altitude, this.climbY);
        this._updateHud();
        this._recycleLeaves();

        if (this._victoryPose) this._applyVictoryPose(dt);
    }

    _trackLyrics() {
        const p = playerManager.player;
        if (!p || !p.video) return;
        const pos = p.timer ? p.timer.position : this.currentTime;
        const w = p.video.findWord(pos);
        if (w && w.startTime !== this._lastWordStart) {
            this._lastWordStart = w.startTime;
            if (w.text) {
                this._spawnLyricLeaf(w.text);
                this._spawnLyricCloud(w.text); // 横の空きに歌詞を雲として読ませる(歌詞アプリの芯)
            }
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

        // まだ行けるよモードの後始末(DOMオーバーレイ)
        [this._hudEl, this._finaleEl].forEach(el => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        this._hudEl = this._finaleEl = null;

        // 雲・霧散パーティクルの破棄(共有テクスチャ _cloudTex は最後に1回)
        this._clouds.slice().forEach(c => this._disposeCloud(c));
        this._clouds = [];
        this._cloudPuffs.forEach(p => { this.scene.remove(p.spr); p.spr.material.dispose(); });
        this._cloudPuffs = [];
        this._cloudTex && this._cloudTex.dispose();

        // 葉/花: 共有ジオメトリ(_leafGeo/_petalGeo)は最後に1回だけ破棄するので、
        // ここでは材質と固有ジオメトリ(葉柄/種/中心)のみ破棄する。
        this.leaves.forEach(l => {
            this.scene.remove(l.group);
            l.group.traverse(o => {
                if (o.geometry && o.geometry !== this._leafGeo && o.geometry !== this._petalGeo) o.geometry.dispose();
                if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
                    if (m.map && m.map !== this._leafVeinTex) m.map.dispose();
                    m.dispose && m.dispose();
                });
            });
        });
        this.leaves = [];
        // 共有アセットを1回だけ破棄
        this._leafGeo && this._leafGeo.dispose();
        this._petalGeo && this._petalGeo.dispose();
        this._leafVeinTex && this._leafVeinTex.dispose();
        this._stemTex && this._stemTex.dispose();

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
