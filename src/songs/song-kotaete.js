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
// 葉の総数上限。連打で生やす足場はラベル無し(歌詞は雲側)なので大きく取れる。
// 上限が大きいほど“塔”が高くなり、ミクのスキップ量が増えて超ジャンプがぶっ飛ぶ。
const LEAF_CAP_PC = 512;
const LEAF_CAP_MOBILE = 256;
const CAM_LAG = 1.4;            // カメラ追従の鈍さ(小さいほど遅れて追う=暴走感)
const CAM_MAX_LEAD = 7.0;       // ミクがカメラより上へ離れてよい上限(超えたら一気に追う=画面外消失防止)
const SPAM_WINDOW = 320;        // 連打判定の時間窓(ms)
const SPAM_BURST_MAX = 3;       // 連打加速時に1クリックで足す葉の最大数

const LEAF_GREEN = '#3f8f4a';
const LEAF_GREEN_D = '#2c6b37';

// フィナーレの満開ひまわり: 画面を覆う「巨大な大輪」にするための全体倍率。
// goalLeaf.group のポップ(0→1)の内側で bloomRoot をこの倍率に保ち、
// 咲き切ると画面いっぱいの大輪になる(外周花弁が視野をわずかに超える程度=フレーム占有)。
const BLOOM_SCALE = 2.0;

export class SongKotaete extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        this.isMobile = window.innerWidth < 768;
        this._leafCap = this.isMobile ? LEAF_CAP_MOBILE : LEAF_CAP_PC;

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
        this._megaAt = -Infinity;      // 直近の“ぶっ飛び”大ジャンプ時刻(周期制御)
        this.mikuPulse = 0;
        this.faceDir = 0;              // -1左 / 0正面 / +1右(進行方向)

        // ---- 光源 / 環境(見える太陽スプライトは廃止、方向光のみ) ----
        this.sunX = 2.5;               // 光の横位置(方向光の向き)
        this.sunHeight = 7.0;          // 光の高さ(成長レートに影響)
        this.growthRate = 1.0;
        this.sideBias = 0;             // -1..+1 光の側へ葉が寄る

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
        // 縦に軽くカップ + 先端を少し反らせて(リアルな花弁の起伏)
        for (let i = 0; i < pos.count; i++) {
            const px = pos.getX(i), py = pos.getY(i);
            const along = px / L; // 0基部..1先端
            pos.setZ(i, (py / Wd) * (py / Wd) * 0.08 - along * along * 0.05);
        }
        pos.needsUpdate = true; geo.computeVertexNormals();
        // 頂点カラーで二色グラデ(基部=琥珀 → 先端=明るい黄)。本物のひまわりの花弁らしさ。
        const base = new THREE.Color('#E59A1C'), tip = new THREE.Color('#FFE14C');
        const col = new Float32Array(pos.count * 3), tmp = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const along = THREE.MathUtils.clamp(pos.getX(i) / L, 0, 1);
            tmp.copy(base).lerp(tip, along);
            col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        this._petalGeo = geo;
        return geo;
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

            // 歌詞は雲側で読ませるので、連打で量産する足場(label:false)はラベル無しにして
            // 1枚あたりのテクスチャ生成コストを抑える(=上限を大きく取れる/破綻防止)。
            // 歌詞葉(レート制限・少数)だけ可読テキスト札を乗せる。
            if (opts.label !== false && text) {
                label = this._makeTextLabel(text);
                label.position.set(side * -0.15, 0.05, 0.4);
                group.add(label);
            }
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

    // 歌詞ワード発火で足場の葉を生やす。総数を抑え(間隔)、ミクが遅れすぎたら止める(バックログ上限)。
    // → 曲終わりにミクが必ずてっぺんへ追いつける範囲に保つ。
    // 歌詞テキストは雲側(_spawnLyricCloud)で単語ごとに読ませるので、葉はラベル無しの純3D足場。
    _spawnLyricLeaf() {
        const now = performance.now();
        if (now - this._lastLeafAt < LEAF_SPAWN_INTERVAL) return null;
        const highestY = this.leaves.length ? this.leaves[this.leaves.length - 1].y : this.climbY;
        if (highestY - this.climbY > MAX_BACKLOG_LEAVES * LEAF_SPACING) return null; // 遅れすぎ→生やさない
        this._lastLeafAt = now;
        return this.spawnLeaf('', { label: false });
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
            // 弧の高さは大ジャンプほど高いが、上限を付けて飛びすぎ→戻らないのを防ぐ。
            const amp = Math.min(14, 0.8 + Math.abs(j.toY - j.fromY) * 0.18);
            const arc = Math.sin(t * Math.PI) * amp;
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
            const now = performance.now();
            // 普段は活発に登る(数枚スキップ)→ 雲・歌詞が見える。
            // 葉が積み上がったら一定間隔で“ぶっ飛び”の大ジャンプを解放(緊張→解放)。
            if (above.length >= 6 && now - this._megaAt > 1800) {
                this._megaAt = now;
                const top = above[above.length - 1];
                const bonus = Math.min(26, 6 + above.length * 0.3); // 積み上がるほど高く打ち上がる
                const land = this.spawnLeaf('', {
                    y: top.y + bonus, side: (Math.random() < 0.5 ? -1 : 1), label: false,
                });
                land.confirmed = true;
                target = land; level = 4;
                above.forEach(l => { l.landed = true; }); // 通過した塔は下へ流して回収
            } else if (above.length >= 2) {
                const skip = Math.min(3, above.length - 1); // 通常は控えめ(雲・歌詞を見せる)
                target = above[skip];
                level = Math.min(2, skip);
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

    // 見える太陽スプライトは廃止。陰影づけの方向光だけを空の高い位置から当て続ける。
    updateSun(dt) {
        const want = THREE.MathUtils.clamp(this.sunX / 5, -1, 1);
        this.sideBias += (want - this.sideBias) * Math.min(1, dt * 2);
        if (this.sunLight) this.sunLight.position.set(this.sunX, this.camera.position.y + 10, 6);
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
                if (this.leaves.length >= this._leafCap) this._recycleLeaves(true);
                const side = (i === 0) ? (p.x >= 0 ? 1 : -1) : (Math.random() < 0.5 ? -1 : 1);
                const yy = baseY + i * LEAF_SPACING * (0.7 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.4;
                // 量産する足場はラベル無し(歌詞は雲側)。大量でも軽い。
                const leaf = this.spawnLeaf('', { y: yy, side, label: false });
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
                /* 右上の「← 湖面へ戻る」ボタンの真下へ。ノッチ/セーフエリアぶん下げて重なりを回避。 */
                position:absolute;
                right:calc(14px + env(safe-area-inset-right, 0px));
                top:calc(104px + env(safe-area-inset-top, 0px));
                z-index:55; pointer-events:none;
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
        const over = this.leaves.length - this._leafCap;
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
        const cap = this.isMobile ? 14 : 24;
        if (this._clouds.length >= cap) {
            // 歌詞雲は単語ごとに必ず出したい。満杯なら最古の装飾雲(歌詞でない)を退避して席を空ける。
            if (!opts.lyric) return null;
            const victim = this._clouds.find(c => !c.lyric) || this._clouds[0];
            if (victim) this._disposeCloud(victim);
        }
        const side = opts.side || this._cloudSide;
        this._cloudSide = -side; // 交互
        const group = new THREE.Group();
        // 横の空き(葉は±1.5)。歌詞雲は読みやすい中距離、装飾雲は外側まで。
        const xMin = opts.lyric ? 3.4 : 3.0;
        const xMax = opts.lyric ? 5.4 : 7.2;
        const x = side * (xMin + Math.random() * (xMax - xMin));
        // ミクが速く昇っても置いていかれないよう、上方向に広めの帯へ出す
        const y = (opts.y != null) ? opts.y : (this.climbY + 4 + Math.random() * 20);
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
        // 歌詞は単語ごとに必ず雲へ。連続発火は _trackLyrics 側で startTime 単位に間引かれているので
        // ここではレート制限せず、各単語ぶんの雲を出す(満杯時は装飾雲を退避=_spawnCloud)。
        this._lyricCloudAt = performance.now();
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
        // 高度が上がるほど雲が増える。ミクが速く昇っても空が埋まるよう供給を早める。
        const now = performance.now();
        const rate = this.climbY > 6 ? 420 : 800;
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
            // 画面下方へ流れ去った雲は回収(速い上昇でも少し長く残す)
            if (c.group.position.y < this.camera.position.y - 20) { this._disposeCloud(c); }
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
        // 巨大な大輪にするため、ポップ(0→1)の内側に bloomRoot を置いて常時 BLOOM_SCALE 倍に保つ。
        // 咲き切ると pop≒1 × BLOOM_SCALE で画面いっぱいの満開ひまわりになる。
        const root = new THREE.Group();
        root.scale.setScalar(BLOOM_SCALE);
        parent.add(root);
        this._bloomRoot = root;

        // --- 中心(花盤): 手前へ膨らむ茶色のドーム + 外周のディスク・フローレット環 ---
        const centerMat = new THREE.MeshStandardMaterial({ color: 0x4f2e14, roughness: 0.96 });
        const center = new THREE.Mesh(new THREE.SphereGeometry(0.86, 36, 26), centerMat);
        center.scale.set(1, 1, 0.42);
        center.position.set(0, 0, 0.12);
        root.add(center);
        this._bloomCenterMat = centerMat;
        // 花盤と花弁の境目の黄褐色リング(本物のひまわりの“縁取り”)
        const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a5a1c, roughness: 0.8 });
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.1, 12, 48), rimMat);
        rim.position.set(0, 0, 0.16);
        root.add(rim);
        this._bloomRimMat = rimMat;

        // --- 種(phyllotaxis 螺旋に並ぶ): InstancedMesh で大量配置。大輪ぶん数も半径も増やす ---
        const seedCount = this.isMobile ? 240 : 460;
        const seedGeo = new THREE.CylinderGeometry(0.016, 0.032, 0.07, 5);
        seedGeo.rotateX(Math.PI / 2); // +zへ向ける
        const seedMat = new THREE.MeshStandardMaterial({ color: 0x21150a, roughness: 0.88 });
        const seeds = new THREE.InstancedMesh(seedGeo, seedMat, seedCount);
        const golden = Math.PI * (3 - Math.sqrt(5));
        const mtx = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        const seedR = 0.8;
        for (let i = 0; i < seedCount; i++) {
            const r = seedR * Math.sqrt(i / seedCount);
            const a = i * golden;
            p.set(Math.cos(a) * r, Math.sin(a) * r, 0.12 + Math.sqrt(Math.max(0, 0.72 - r * r)) * 0.4);
            const s = 0.7 + (i / seedCount) * 0.85;
            sc.set(s, s, s);
            mtx.compose(p, q, sc);
            seeds.setMatrixAt(i, mtx);
        }
        seeds.instanceMatrix.needsUpdate = true;
        root.add(seeds);
        this._bloomSeeds = seeds;

        // --- 花びら: 3重リングの尖った花弁(頂点カラーで二色グラデ)。閉→開アニメ ---
        this.bloomPetals = [];
        const petalGeo = this._petalGeometry();
        const petalMat = new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.5, side: THREE.DoubleSide,
            emissive: 0x4a3500, emissiveIntensity: 0.16,
        });
        this._bloomPetalMat = petalMat;
        // 内側=短く立ち気味、外側=長く寝かせて大輪のシルエットを作る
        const rings = [
            { n: 18, r: 0.92, len: 1.05, tilt: 0.34 },
            { n: 22, r: 1.18, len: 1.35, tilt: 0.2 },
            { n: 26, r: 1.46, len: 1.6, tilt: 0.08 },
        ];
        rings.forEach((ring, ri) => {
            for (let i = 0; i < ring.n; i++) {
                const ang = (i / ring.n) * Math.PI * 2 + (ri % 2 ? Math.PI / ring.n : 0);
                // 花弁ごとに小さなホルダーを噛ませ、放射軸まわりに少し起こして“皿”の立体感を出す
                const holder = new THREE.Group();
                holder.position.set(Math.cos(ang) * ring.r, Math.sin(ang) * ring.r, 0.04 - ri * 0.02);
                holder.rotation.z = ang;          // 外向き
                holder.rotation.y = ring.tilt;    // 先端を手前へ起こす(皿状)
                const petal = new THREE.Mesh(petalGeo, petalMat);
                petal.scale.setScalar(ring.len * 0.01); // 閉じた状態
                holder.add(petal);
                root.add(holder);
                this.bloomPetals.push({ petal, holder, base: ring.len, ang, tilt: ring.tilt });
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
            // 開きながら花弁が反り返る(unfurl): 閉時は強く起き上がり、開くと所定の皿角へ寝る
            if (bp.holder) bp.holder.rotation.y = bp.tilt + (1 - this.bloom.open) * 0.95;
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
                this._spawnLyricLeaf();         // 足場(ラベル無し)を間隔制御で生やす
                this._spawnLyricCloud(w.text);  // 歌詞は単語ごとに必ず雲へ(歌詞アプリの芯)
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
