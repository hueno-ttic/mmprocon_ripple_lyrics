import * as THREE from 'three';
import { quality } from '../core/quality.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { eventBus } from '../core/eventBus.js';
import { sfx } from '../core/sfx.js';

// =============================================================================
// こたえて 「ことばの水やり (Watering Garden)」
// -----------------------------------------------------------------------------
// まだ発話されていない歌詞を「ひまわりの種」として畑に並べる。発話が近づくと種が
// 光り、水やりできる状態になる。クリック/ドラッグで水をあげると芽吹き、発話に合わせ
// 成長。発話が終わると花びらが舞い、言葉は小さなひまわりとして畑に残る。長押しで
// 好きなことばを保存し、終盤に「育てたことば」を中心へ大輪のひまわりが咲く。
//   - 種=未発話の歌詞 / 水=参加 / 芽=発話直前 / 花びら=発話済み / ひまわり畑=育てた答え
//   - 既存BaseSongのライフサイクル(init/update/render/destroy)に準拠。歌詞はTextAliveから取得。
//   - ミクの3Dは登場させない(歌詞・種・水・花が主役)。
// =============================================================================

// 成長タイミング(ms)
const SEED_LEAD = 4000;    // 発話前これ以内で種が出現
const WATER_LEAD = 1500;   // 発話前これ以内で水やりチャンス
const FLOWER_DELAY = 1500; // 発話終了後これだけで花に
const WATER_RADIUS = 1.4;  // 水やり判定半径(ワールドXZ)

// 上限(複数曲対応なので使いすぎない)
const MAX_PETALS = 300;
const MAX_DROPS = 120;
const MAX_RIPPLES = 24;
const SLOT_ROWS = 8;
const SLOT_COLS = 10;       // ROWS*COLS = 80 = 同時に見える種の上限
const ROW_GAP = 3.0;
const COL_GAP = 2.5;
const NEAR_Z = 1.0;         // 最前列の畝のz

// 開発確認用のMock歌詞(本番はTextAliveを使う。未接続時のみ使用)
const MOCK_WORDS = ['こたえて', '風よ', '届けて', 'ひかり', 'きみへ', 'そっと', 'まだ', 'ことば', 'みらい', 'さいて'];

export class SongKotaete extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        this.isMobile = window.innerWidth < 768;

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // ---- グループ(rootGroup配下で一括管理/破棄) ----
        this.rootGroup = null;
        this.backgroundGroup = null;
        this.fieldGroup = null;
        this.seedGroup = null;     // 種/芽/花の実体(itemのgroupを格納)
        this.petalGroup = null;
        this.waterGroup = null;
        this.effectGroup = null;

        // ---- 歌詞→畑アイテム ----
        this.items = [];           // KotaeteGardenItem[]
        this._wordsReady = false;
        this._mock = false;
        this._slotOccupant = new Array(SLOT_ROWS * SLOT_COLS).fill(null);

        // ---- プール ----
        this.petals = [];
        this.drops = [];
        this.ripples = [];

        // ---- メモリー(長押し保存) ----
        this.memoryWords = [];

        // ---- 進行 ----
        this._duration = 0;
        this.progress = 0;
        this._finaleBuilt = false;
        this._songEnded = false;

        // ---- 入力 ----
        this._down = false;
        this._downReal = 0;
        this._downPos = { x: 0, y: 0 };
        this._lastPos = { x: 0, y: 0 };
        this._moved = 0;
        this._lastDropReal = 0;
        this._longPressTimer = null;

        // ---- 共有ジオメトリ/テクスチャ ----
        this._shared = {};

        // ---- レイキャスト ----
        this._raycaster = new THREE.Raycaster();
        this._ndc = new THREE.Vector2();
        this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this._hit = new THREE.Vector3();

        this._lastFrameReal = performance.now();
        this._debugTime = null;    // 検証用に時刻を注入できる

        this.boundOnResize = this.onResize.bind(this);
        this.boundOnPointerDown = this.onPointerDown.bind(this);
        this.boundOnPointerMove = this.onPointerMove.bind(this);
        this.boundOnPointerUp = this.onPointerUp.bind(this);
        this.boundOnSongEnd = () => { this._songEnded = true; };
    }

    // =====================================================================
    // init
    // =====================================================================
    init() {
        this.initThree();
        this.buildGroups();
        this.buildSky();
        this.buildField();
        this.buildDistantField();
        this.initPools();
        this.buildHUD();

        window.addEventListener('resize', this.boundOnResize);
        this.songWrapper.addEventListener('pointerdown', this.boundOnPointerDown);
        window.addEventListener('pointermove', this.boundOnPointerMove);
        window.addEventListener('pointerup', this.boundOnPointerUp);
        eventBus.on('songEnd', this.boundOnSongEnd);

        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this._skyTop = new THREE.Color(0x7fb6e8);
        this._skyBot = new THREE.Color(0xfde7c8);
        this.scene.fog = new THREE.FogExp2(0xdfeaf2, 0.012);
        this.scene.background = this._skyTop.clone();

        this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 600);
        this.camera.position.set(0, 6.2, 15);
        this.camera.lookAt(0, 0.5, -6);

        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        this.songWrapper.appendChild(this.renderer.domElement);

        this.hemiLight = new THREE.HemisphereLight(0xeaf4ff, 0x6a9a4a, 1.0);
        this.scene.add(this.hemiLight);
        this.keyLight = new THREE.DirectionalLight(0xfff2c8, 1.7);
        this.keyLight.position.set(4, 12, 8);
        this.scene.add(this.keyLight);
    }

    buildGroups() {
        this.rootGroup = new THREE.Group();
        this.backgroundGroup = new THREE.Group();
        this.fieldGroup = new THREE.Group();
        this.seedGroup = new THREE.Group();
        this.petalGroup = new THREE.Group();
        this.waterGroup = new THREE.Group();
        this.effectGroup = new THREE.Group();
        this.rootGroup.add(this.backgroundGroup, this.fieldGroup, this.seedGroup, this.petalGroup, this.waterGroup, this.effectGroup);
        this.scene.add(this.rootGroup);
    }

    // 朝→昼へ明るくなる空(背面スフィア)
    buildSky() {
        const mat = new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false,
            uniforms: { uTop: { value: this._skyTop }, uBot: { value: this._skyBot } },
            vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
            fragmentShader: `varying vec3 vP; uniform vec3 uTop,uBot;
              void main(){ float h=clamp(vP.y/180.0+0.4,0.0,1.0); gl_FragColor=vec4(mix(uBot,uTop,h),1.0);} `,
        });
        this._skyMat = mat;
        this.sky = new THREE.Mesh(new THREE.SphereGeometry(260, 24, 16), mat);
        this.backgroundGroup.add(this.sky);

        // 淡い光の粒
        const N = this.isMobile ? 60 : 120;
        const pos = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 60;
            pos[i * 3 + 1] = 4 + Math.random() * 30;
            pos[i * 3 + 2] = -40 + Math.random() * 50;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const m = new THREE.PointsMaterial({ map: this._glowTex(), size: 0.9, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
        this._motes = new THREE.Points(g, m);
        this.backgroundGroup.add(this._motes);
    }

    // 地面 + 畝(うね)。種は畝に沿って出る。
    buildField() {
        const groundMat = new THREE.MeshStandardMaterial({ color: 0x6cae4e, roughness: 1 });
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.z = -10;
        this.fieldGroup.add(ground);
        this._ground = ground;

        const soilMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 });
        this._shared.soilMat = soilMat;
        for (let r = 0; r < SLOT_ROWS; r++) {
            const z = NEAR_Z - r * ROW_GAP;
            const ridge = new THREE.Mesh(new THREE.BoxGeometry(SLOT_COLS * COL_GAP + 2.4, 0.22, 1.1), soilMat);
            ridge.position.set(0, 0.05, z);
            this.fieldGroup.add(ridge);
        }
    }

    // 遠景のひまわり畑(進行で広がる/明るくなる)。インスタンス化した簡易花。
    buildDistantField() {
        const N = this.isMobile ? 60 : 140;
        const geo = new THREE.CircleGeometry(0.6, 10);
        const mat = new THREE.MeshBasicMaterial({ color: 0xf2c233, side: THREE.DoubleSide });
        const inst = new THREE.InstancedMesh(geo, mat, N);
        const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        this._distantBase = [];
        for (let i = 0; i < N; i++) {
            const x = (Math.random() - 0.5) * 90;
            const z = -28 - Math.random() * 22;
            const y = 1.2 + Math.random() * 0.8;
            p.set(x, y, z); s.set(1, 1, 1); m.compose(p, q, s);
            inst.setMatrixAt(i, m);
            this._distantBase.push({ x, y, z });
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.count = 0; // 進行に応じて増やす
        this._distant = inst;
        this.backgroundGroup.add(inst);
    }

    initPools() {
        const petalTex = this._petalTex();
        for (let i = 0; i < MAX_PETALS; i++) {
            const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: petalTex, transparent: true, depthWrite: false, opacity: 0 }));
            spr.visible = false; spr.scale.set(0.5, 0.5, 1);
            this.petalGroup.add(spr);
            this.petals.push({ spr, active: false, life: 0, dur: 1, vel: new THREE.Vector3(), spin: 0 });
        }
        const dropTex = this._glowTex();
        for (let i = 0; i < MAX_DROPS; i++) {
            const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: dropTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x8fd0ff, opacity: 0 }));
            spr.visible = false; spr.scale.set(0.35, 0.35, 1);
            this.waterGroup.add(spr);
            this.drops.push({ spr, active: false, life: 0, dur: 0.6, vel: new THREE.Vector3() });
        }
        const ringGeo = new THREE.RingGeometry(0.5, 0.62, 24);
        ringGeo.rotateX(-Math.PI / 2);
        this._shared.ringGeo = ringGeo;
        for (let i = 0; i < MAX_RIPPLES; i++) {
            const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
            mesh.visible = false;
            this.waterGroup.add(mesh);
            this.ripples.push({ mesh, active: false, life: 0, dur: 0.9 });
        }
    }

    // =====================================================================
    // HUD (曲固有オーバーレイ)
    // =====================================================================
    buildHUD() {
        this._ensureHudStyles();
        const hud = document.createElement('div');
        hud.className = 'kwg-hud';
        hud.innerHTML = `
            <div class="kwg-lyric"><span class="kwg-phrase"></span></div>
            <div class="kwg-memory"><div class="kwg-memory-title">そだてたことば</div><div class="kwg-memory-list"></div></div>
            <div class="kwg-hints">Click：水をあげる　Drag：水の流れ　長押し：ことばを保存</div>
        `;
        this.songWrapper.appendChild(hud);
        this._hud = hud;
        this._hudPhrase = hud.querySelector('.kwg-phrase');
        this._hudMemList = hud.querySelector('.kwg-memory-list');
        this._hudHints = hud.querySelector('.kwg-hints');
        // 操作ヒントは数秒で薄くする
        this._hintsTimer = setTimeout(() => { if (this._hudHints) this._hudHints.classList.add('faded'); }, 8000);
    }

    _ensureHudStyles() {
        if (document.getElementById('kwg-hud-styles')) return;
        const st = document.createElement('style');
        st.id = 'kwg-hud-styles';
        st.textContent = `
            .kwg-hud{position:absolute;inset:0;pointer-events:none;z-index:10;font-family:'Inter','Noto Sans JP',sans-serif;}
            .kwg-lyric{position:absolute;top:6%;left:50%;transform:translateX(-50%);max-width:86%;
              background:rgba(40,30,10,0.42);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
              padding:10px 22px;border-radius:16px;border:1px solid rgba(255,224,140,0.4);text-align:center;}
            .kwg-phrase{color:#fff;font-size:clamp(16px,3.4vw,26px);font-weight:700;letter-spacing:1px;
              text-shadow:0 2px 10px rgba(0,0,0,0.55);}
            .kwg-phrase .cur{color:#ffe45e;}
            .kwg-memory{position:absolute;top:16%;right:3%;width:min(30vw,170px);
              background:rgba(40,30,10,0.34);border:1px solid rgba(255,224,140,0.35);border-radius:14px;padding:8px 10px;}
            .kwg-memory-title{color:#ffe9a8;font-size:11px;letter-spacing:2px;margin-bottom:6px;text-align:center;}
            .kwg-memory-list{display:flex;flex-direction:column;gap:5px;}
            .kwg-mem{color:#fff;font-size:13px;font-weight:600;background:rgba(255,200,61,0.22);
              border-radius:8px;padding:3px 8px;text-align:center;text-shadow:0 1px 4px rgba(0,0,0,0.5);
              animation:kwgPop .4s ease;}
            @keyframes kwgPop{from{transform:scale(.5);opacity:0;}to{transform:scale(1);opacity:1;}}
            .kwg-hints{position:absolute;bottom:5%;left:50%;transform:translateX(-50%);
              color:#fff;font-size:12px;letter-spacing:1px;background:rgba(0,0,0,0.3);
              padding:7px 16px;border-radius:999px;transition:opacity 1.2s ease;text-shadow:0 1px 4px rgba(0,0,0,0.6);}
            .kwg-hints.faded{opacity:0;}
            .kwg-final{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
              color:#fff;font-size:clamp(16px,3.6vw,28px);font-weight:700;letter-spacing:2px;text-align:center;
              text-shadow:0 2px 16px rgba(0,0,0,0.6),0 0 24px #ffd54a;opacity:0;transition:opacity 1.8s ease;z-index:12;pointer-events:none;}
            .kwg-final.show{opacity:1;}
            @media (max-width:600px){ .kwg-memory{top:auto;bottom:16%;} }
        `;
        document.head.appendChild(st);
    }

    // =====================================================================
    // 歌詞取得(TextAlive / Mockフォールバック)
    // =====================================================================
    _now() {
        if (this._debugTime != null) return this._debugTime;
        const p = playerManager.player;
        if (p && p.timer && playerManager.isTimerReady) return p.timer.position;
        return this.currentTime;
    }

    _ensureWords() {
        if (this._wordsReady) return;
        const p = playerManager.player;
        // 本番: TextAlive の単語を列挙
        if (p && p.video && p.video.firstPhrase) {
            const words = [];
            let ph = p.video.firstPhrase, pi = 0;
            while (ph) {
                let w = ph.firstWord;
                while (w) {
                    if (w.text && w.text.trim()) {
                        words.push({ text: w.text, startTime: w.startTime, endTime: w.endTime, index: words.length, phraseIndex: pi });
                    }
                    if (w === ph.lastWord) break;
                    w = w.next;
                }
                ph = ph.next; pi++;
            }
            if (words.length) {
                this._duration = p.video.duration || (words[words.length - 1].endTime + 4000);
                this._initItems(words); this._wordsReady = true; this._mock = false;
                return;
            }
        }
        // 未接続のまま時間が進んでいる(開発確認) → Mock
        if (!this._wordsReady && this._now() > 800) this._useMockTimeline(this._now());
    }

    _useMockTimeline(baseMs = 1000) {
        const words = [];
        let t = baseMs + 1500;
        for (let i = 0; i < 40; i++) {
            const text = MOCK_WORDS[i % MOCK_WORDS.length];
            const dur = 500 + (i % 3) * 250;
            words.push({ text, startTime: t, endTime: t + dur, index: i, phraseIndex: Math.floor(i / 4) });
            t += dur + 350 + (i % 5) * 120;
        }
        this._duration = t + 6000;
        this._initItems(words); this._wordsReady = true; this._mock = true;
    }

    _initItems(words) {
        this.items = words.map((w) => ({
            word: w,
            slot: w.index % (SLOT_ROWS * SLOT_COLS),
            stage: 'hidden',
            watered: false,
            waterAmount: 0,
            memory: false,
            built: false,
            petalsEmitted: false,
            group: null, seed: null, ring: null, sprout: null, flower: null, label: null,
            pos: new THREE.Vector3(),
        }));
    }

    _slotPos(slot) {
        const r = Math.floor(slot / SLOT_COLS), c = slot % SLOT_COLS;
        // 行ごとに少しずらして畝に並ぶ自然さを出す
        const jitter = ((r * 7 + c * 13) % 10) / 10 - 0.5;
        const x = (c - (SLOT_COLS - 1) / 2) * COL_GAP + jitter * 0.7;
        const z = NEAR_Z - r * ROW_GAP;
        return { x, z };
    }

    // =====================================================================
    // アイテムの実体生成 / 成長
    // =====================================================================
    _buildItem(item) {
        const { x, z } = this._slotPos(item.slot);
        item.pos.set(x, 0, z);
        const g = new THREE.Group();
        g.position.set(x, 0, z);

        // 種(茶色い小さな楕円体)
        const seed = new THREE.Mesh(this._seedGeo(), new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.8, emissive: 0x000000 }));
        seed.position.y = 0.22; seed.scale.set(1, 1.4, 1);
        g.add(seed); item.seed = seed;

        // 水やりチャンスの青いリング
        const ring = new THREE.Mesh(this._shared.ringGeo, new THREE.MeshBasicMaterial({ color: 0x6fc8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        ring.position.y = 0.06; ring.visible = false;
        g.add(ring); item.ring = ring;

        // 言葉のラベル(可読・小さめ)
        const label = this._makeLabel(item.word.text);
        label.position.set(0, 1.1, 0);
        g.add(label); item.label = label;

        item.group = g;
        item.built = true;
        this.seedGroup.add(g);

        // スロット占有: 前の住人(花など)を片付ける
        const prev = this._slotOccupant[item.slot];
        if (prev && prev !== item && prev.group) this._disposeItem(prev);
        this._slotOccupant[item.slot] = item;
    }

    _ensureSprout(item) {
        if (item.sprout) return;
        const grp = new THREE.Group();
        const stem = new THREE.Mesh(this._stemGeo(), new THREE.MeshStandardMaterial({ color: 0x4fa03c, roughness: 0.8 }));
        stem.position.y = 0.5; grp.add(stem);
        for (const sx of [-1, 1]) {
            const leaf = new THREE.Mesh(this._leafGeo(), new THREE.MeshStandardMaterial({ color: 0x57b341, roughness: 0.7, side: THREE.DoubleSide }));
            leaf.position.set(sx * 0.18, 0.55, 0); leaf.scale.setScalar(0.6); leaf.rotation.z = sx * 0.5;
            grp.add(leaf);
        }
        grp.scale.setScalar(0.01);
        item.group.add(grp); item.sprout = grp;
    }

    _ensureFlower(item) {
        if (item.flower) return;
        item.flower = this._makeSunflower(0.5 + item.waterAmount * 0.5, item.watered);
        item.flower.position.y = 0.9 + item.waterAmount * 0.5;
        item.flower.scale.setScalar(0.01);
        item.group.add(item.flower);
    }

    _stageFor(item, now) {
        const w = item.word;
        if (now < w.startTime - SEED_LEAD) return 'hidden';
        if (now < w.startTime - WATER_LEAD) return 'seed';
        if (now < w.startTime) return 'water_chance';
        if (now < w.endTime) return 'sprout';
        if (now < w.endTime + FLOWER_DELAY) return 'blooming';
        return 'flower';
    }

    updateGarden(now, dt) {
        for (const item of this.items) {
            const stage = this._stageFor(item, now);
            if (stage === 'hidden') continue;
            if (!item.built) this._buildItem(item);

            const w = item.word;
            // 発話の近さ(0..1) — 種が光る量
            const near = THREE.MathUtils.clamp(1 - (w.startTime - now) / SEED_LEAD, 0, 1);

            // 各ステージの見た目
            if (stage === 'seed' || stage === 'water_chance') {
                item.seed.visible = true;
                const glow = stage === 'water_chance' ? 0.5 + 0.3 * Math.sin(now * 0.012) : near * 0.3;
                item.seed.material.emissive.setRGB(glow * 0.9, glow * 0.6, glow * 0.1);
                item.ring.visible = stage === 'water_chance';
                if (item.ring.visible) {
                    const pulse = 1 + 0.25 * Math.sin(now * 0.01);
                    item.ring.scale.setScalar((WATER_RADIUS / 0.56) * pulse * (item.watered ? 1.15 : 1));
                    item.ring.material.opacity = item.watered ? 0.85 : 0.5;
                    item.ring.material.color.set(item.watered ? 0x9affc0 : 0x6fc8ff);
                }
            } else if (stage === 'sprout') {
                item.seed.visible = false; item.ring.visible = false;
                this._ensureSprout(item);
                const prog = THREE.MathUtils.clamp((now - w.startTime) / Math.max(120, w.endTime - w.startTime), 0, 1);
                const grow = (0.7 + item.waterAmount * 0.8) * (0.4 + prog * 0.6);
                item.sprout.visible = true;
                item.sprout.scale.setScalar(this._eb(Math.min(1, grow)));
            } else if (stage === 'blooming' || stage === 'flower') {
                if (item.sprout) item.sprout.visible = false;
                this._ensureFlower(item);
                item.flower.visible = true;
                const t = THREE.MathUtils.clamp((now - w.endTime) / FLOWER_DELAY, 0, 1);
                const sc = 0.4 + (0.6 + item.waterAmount * 0.7) * this._eb(t);
                item.flower.scale.setScalar(sc);
                item.flower.rotation.y += dt * 0.5;
                // 発話終了時に花びらを舞わせる(1回)
                if (!item.petalsEmitted) {
                    item.petalsEmitted = true;
                    this._emitPetals(item);
                }
            }
            item.stage = stage;
            // ラベルは発話前後で明るく、花になったら控えめに
            if (item.label) {
                const op = stage === 'flower' ? 0.5 : (stage === 'seed' ? 0.55 + near * 0.4 : 0.95);
                item.label.material.opacity = op;
            }
        }
    }

    _emitPetals(item) {
        const chorus = this._isChorus(item.word.startTime);
        let n = 5 + Math.round(item.waterAmount * 10) + (chorus ? 6 : 0);
        n += Math.round(this.progress * 6); // 終盤ほど多め
        const origin = item.group.position.clone(); origin.y = 1.0;
        const col = item.watered ? new THREE.Color(0xffe06a) : new THREE.Color(0xf4c84a);
        for (let i = 0; i < n; i++) this._spawnPetal(origin, col);
    }

    // =====================================================================
    // 水やり
    // =====================================================================
    _raycastGround(event) {
        this._ndc.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
        this._raycaster.setFromCamera(this._ndc, this.camera);
        const hit = this._raycaster.ray.intersectPlane(this._groundPlane, this._hit);
        return hit ? hit.clone() : null;
    }

    _waterAt(worldPos) {
        this._spawnRipple(worldPos);
        for (let i = 0; i < 5; i++) this._spawnDrop(worldPos);
        sfx.play('ripple');
        // 近くの種/芽に水を与える(water_chance > sprout > seed の優先で当たり判定)
        for (const item of this.items) {
            if (!item.built) continue;
            if (!['seed', 'water_chance', 'sprout'].includes(item.stage)) continue;
            const dx = item.pos.x - worldPos.x, dz = item.pos.z - worldPos.z;
            if (dx * dx + dz * dz <= WATER_RADIUS * WATER_RADIUS) {
                item.watered = true;
                item.waterAmount = Math.min(1, item.waterAmount + 0.28);
            }
        }
    }

    _saveMemoryWord() {
        if (this.memoryWords.length >= 8) return;
        const now = this._now();
        // 代表単語: いま発話中(sprout) → 直近water_chance → 直近seed
        let cand = this.items.find(it => it.built && it.stage === 'sprout');
        if (!cand) cand = this.items.find(it => it.built && it.stage === 'water_chance');
        if (!cand) {
            // TextAliveの現在単語にフォールバック
            const p = playerManager.player;
            const w = (p && p.video) ? p.video.findWord(now) : null;
            if (w && w.text) {
                cand = this.items.find(it => it.word.text === w.text && !it.memory);
            }
        }
        if (!cand || cand.memory) return;
        cand.memory = true;
        this.memoryWords.push(cand.word.text);
        this._renderMemory();
        sfx.play('kotaete_resonance');
    }

    _renderMemory() {
        if (!this._hudMemList) return;
        this._hudMemList.innerHTML = this.memoryWords.map(t => `<div class="kwg-mem">${this._esc(t)}</div>`).join('');
    }

    // =====================================================================
    // プール(花びら/水滴/波紋)
    // =====================================================================
    _spawnPetal(pos, color) {
        const p = this.petals.find(x => !x.active);
        if (!p) return;
        p.active = true; p.life = 0; p.dur = 2.2 + Math.random() * 1.6;
        p.spr.visible = true;
        p.spr.position.copy(pos);
        p.spr.material.opacity = 0.95;
        p.spr.material.color.copy(color);
        p.spr.scale.setScalar(0.4 + Math.random() * 0.3);
        p.vel.set((Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
        p.spin = (Math.random() - 0.5) * 4;
    }

    _spawnDrop(pos) {
        const d = this.drops.find(x => !x.active);
        if (!d) return;
        d.active = true; d.life = 0; d.dur = 0.5 + Math.random() * 0.3;
        d.spr.visible = true;
        d.spr.position.set(pos.x + (Math.random() - 0.5) * 0.5, 2.2 + Math.random(), pos.z + (Math.random() - 0.5) * 0.5);
        d.spr.material.opacity = 0.9;
        d.vel.set(0, -6 - Math.random() * 2, 0);
    }

    _spawnRipple(pos) {
        const r = this.ripples.find(x => !x.active);
        if (!r) return;
        r.active = true; r.life = 0; r.dur = 0.9;
        r.mesh.visible = true;
        r.mesh.position.set(pos.x, 0.05, pos.z);
        r.mesh.scale.setScalar(0.4);
        r.mesh.material.opacity = 0.7;
    }

    updatePools(dt) {
        for (const p of this.petals) {
            if (!p.active) continue;
            p.life += dt; const t = p.life / p.dur;
            if (t >= 1) { p.active = false; p.spr.visible = false; continue; }
            p.vel.y -= dt * 0.9; // ふわっと落ちる
            p.spr.position.addScaledVector(p.vel, dt);
            p.spr.material.rotation += p.spin * dt;
            p.spr.material.opacity = 0.95 * (1 - t * t);
        }
        for (const d of this.drops) {
            if (!d.active) continue;
            d.life += dt; const t = d.life / d.dur;
            d.vel.y -= dt * 12;
            d.spr.position.addScaledVector(d.vel, dt);
            if (d.spr.position.y <= 0.05 || t >= 1) { d.active = false; d.spr.visible = false; continue; }
            d.spr.material.opacity = 0.9 * (1 - t);
        }
        for (const r of this.ripples) {
            if (!r.active) continue;
            r.life += dt; const t = r.life / r.dur;
            if (t >= 1) { r.active = false; r.mesh.visible = false; continue; }
            r.mesh.scale.setScalar(0.4 + t * 3.4);
            r.mesh.material.opacity = 0.7 * (1 - t);
        }
    }

    // =====================================================================
    // 進行に応じた演出
    // =====================================================================
    updateProgress(now) {
        const dur = this._duration || 240000;
        this.progress = THREE.MathUtils.clamp(now / dur, 0, 1);
        const pr = this.progress;
        // 朝(暖色)→昼(青空)
        this._skyTop.setRGB(...this._lerp3([0.62, 0.78, 0.95], [0.30, 0.55, 0.85], pr));
        this._skyBot.setRGB(...this._lerp3([0.99, 0.91, 0.78], [0.80, 0.92, 1.0], pr));
        if (this.scene.background && this.scene.background.copy) this.scene.background.copy(this._skyTop);
        // 遠景ひまわり畑を進行で増やす
        if (this._distant) this._distant.count = Math.floor(this._distant.instanceMatrix.count * THREE.MathUtils.clamp((pr - 0.2) / 0.6, 0, 1));
    }

    _isChorus(timeMs) {
        const p = playerManager.player;
        try { if (p && typeof p.findChorus === 'function') return !!p.findChorus(timeMs); } catch (_) {}
        return false;
    }

    _maybeFinale(now) {
        if (this._finaleBuilt) return;
        if (this.progress < 0.92 && !this._songEnded) return;
        this._finaleBuilt = true;
        this._buildFinale();
    }

    _buildFinale() {
        // 育てたことば(無ければ発話済みの代表語)
        let words = this.memoryWords.slice();
        if (words.length === 0) {
            words = this.items.filter(it => it.stage === 'flower').sort((a, b) => b.waterAmount - a.waterAmount).slice(0, 6).map(it => it.word.text);
        }
        const big = this._makeSunflower(2.6, true);
        big.position.set(0, 3.4, 5.5);
        big.scale.setScalar(0.01);
        this.effectGroup.add(big);
        this._bigFlower = big;
        // ことばを花の周りに
        words.slice(0, 8).forEach((t, i) => {
            const ang = (i / Math.max(1, Math.min(8, words.length))) * Math.PI * 2;
            const lbl = this._makeLabel(t, 1.6);
            lbl.position.set(Math.cos(ang) * 3.0, 3.4 + Math.sin(ang) * 2.2, 5.6);
            this.effectGroup.add(lbl);
        });
        // 最後のメッセージ
        const fin = document.createElement('div');
        fin.className = 'kwg-final';
        fin.textContent = '育てたことばが、あなたのこたえになった';
        this.songWrapper.appendChild(fin);
        this._finalEl = fin;
        requestAnimationFrame(() => requestAnimationFrame(() => fin.classList.add('show')));
        this.setResultSummary({
            lines: ['ことばの水やり', `そだてたことば: ${this.memoryWords.length}　咲いた花: ${this.items.filter(it => it.stage === 'flower').length}`],
            accentColor: '#FFD54A', swatch: '#FFD54A',
        });
    }

    // =====================================================================
    // HUD更新(中央の歌詞)
    // =====================================================================
    updateHUD(now) {
        if (!this._hudPhrase) return;
        const p = playerManager.player;
        let html = '';
        if (p && p.video && !this._mock) {
            const ph = p.video.findPhrase(now);
            const curW = p.video.findWord(now);
            if (ph) {
                let w = ph.firstWord;
                while (w) {
                    const on = (curW && w === curW);
                    html += `<span class="${on ? 'cur' : ''}">${this._esc(w.text)}</span>`;
                    if (w === ph.lastWord) break; w = w.next;
                }
            }
        } else if (this._mock) {
            const cur = this.items.filter(it => now >= it.word.startTime && now < it.word.endTime).map(it => it.word.text);
            if (cur.length) html = `<span class="cur">${this._esc(cur.join(' '))}</span>`;
        }
        if (html !== this._lastHudHtml) { this._hudPhrase.innerHTML = html; this._lastHudHtml = html; }
    }

    // =====================================================================
    // メインループ
    // =====================================================================
    update() {
        const realNow = performance.now();
        const dt = Math.min((realNow - this._lastFrameReal) / 1000, 0.05);
        this._lastFrameReal = realNow;

        this._ensureWords();
        const now = this._now();

        this.updateProgress(now);
        if (this._wordsReady && !this.isTutorialActive) this.updateGarden(now, dt);
        this.updatePools(dt);
        this.updateHUD(now);
        this._maybeFinale(now);

        // 大輪のせり上がり
        if (this._bigFlower) {
            this._bigFlower.scale.setScalar(Math.min(1, this._bigFlower.scale.x + dt * 0.8));
            this._bigFlower.rotation.y += dt * 0.3;
        }
        // 光の粒のゆるい風
        if (this._motes) this._motes.rotation.y += dt * 0.02;
        if (this._skyMat) this._skyMat.uniforms.uTop.value.copy(this._skyTop), this._skyMat.uniforms.uBot.value.copy(this._skyBot);
    }

    render() {
        if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    }

    // =====================================================================
    // 入力
    // =====================================================================
    onClick() { /* BaseSongの汎用CSSリップルは抑止 */ }

    onPointerDown(event) {
        if (!this.isActive || !this.camera || this.isTutorialActive) return;
        if (event.target && event.target.closest && event.target.closest('button, a, input, .song-tutorial-overlay, .kwg-mem')) return;
        this._down = true;
        this._downReal = performance.now();
        this._downPos = { x: event.clientX, y: event.clientY };
        this._lastPos = { x: event.clientX, y: event.clientY };
        this._moved = 0;
        const wp = this._raycastGround(event);
        if (wp) { this._waterAt(wp); this._lastDropReal = performance.now(); }
        clearTimeout(this._longPressTimer);
        this._longPressTimer = setTimeout(() => { if (this._down && this._moved < 16) this._saveMemoryWord(); }, 600);
    }

    onPointerMove(event) {
        if (!this._down) return;
        this._moved += Math.hypot(event.clientX - this._lastPos.x, event.clientY - this._lastPos.y);
        this._lastPos = { x: event.clientX, y: event.clientY };
        const realNow = performance.now();
        if (realNow - this._lastDropReal > 70) { // 水滴を出しすぎない
            const wp = this._raycastGround(event);
            if (wp) { this._waterAt(wp); this._lastDropReal = realNow; }
        }
    }

    onPointerUp() {
        this._down = false;
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
    }

    // =====================================================================
    // 形状/テクスチャ(共有・キャッシュ)
    // =====================================================================
    _seedGeo() { return this._shared.seedGeo || (this._shared.seedGeo = new THREE.SphereGeometry(0.16, 10, 8)); }
    _stemGeo() { return this._shared.stemGeo || (this._shared.stemGeo = new THREE.CylinderGeometry(0.05, 0.07, 1.0, 8)); }
    _leafGeo() { return this._shared.leafGeo || (this._shared.leafGeo = new THREE.CircleGeometry(0.4, 8)); }

    _makeSunflower(size, bright) {
        const grp = new THREE.Group();
        const center = new THREE.Mesh(new THREE.SphereGeometry(0.28 * size, 18, 12), new THREE.MeshStandardMaterial({ color: 0x5a3417, roughness: 0.95 }));
        center.scale.set(1, 1, 0.5); grp.add(center);
        const petalMat = new THREE.MeshStandardMaterial({ color: bright ? 0xffd23a : 0xefc03a, roughness: 0.55, side: THREE.DoubleSide, emissive: 0x3a2a00, emissiveIntensity: bright ? 0.2 : 0.1 });
        const petalGeo = this._petalShapeGeo();
        const n = 16;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.set(Math.cos(a) * 0.42 * size, Math.sin(a) * 0.42 * size, -0.02);
            petal.rotation.z = a; petal.scale.setScalar(size);
            grp.add(petal);
        }
        return grp;
    }

    _petalShapeGeo() {
        if (this._shared.petalShape) return this._shared.petalShape;
        const sh = new THREE.Shape();
        sh.moveTo(0, 0); sh.bezierCurveTo(0.18, 0.12, 0.5, 0.1, 0.6, 0); sh.bezierCurveTo(0.5, -0.1, 0.18, -0.12, 0, 0);
        const geo = new THREE.ShapeGeometry(sh, 8);
        this._shared.petalShape = geo; return geo;
    }

    _makeLabel(text, scale = 1) {
        const W = 256, H = 96;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        x.fillStyle = 'rgba(30,20,6,0.55)';
        this._roundRect(x, 8, 22, W - 16, 52, 18); x.fill();
        x.strokeStyle = 'rgba(255,224,120,0.55)'; x.lineWidth = 3; x.stroke();
        let fs = 46; x.textAlign = 'center'; x.textBaseline = 'middle';
        do { x.font = `bold ${fs}px "Inter","Noto Sans JP",sans-serif`; fs -= 3; } while (fs > 16 && x.measureText(text).width > W - 36);
        x.lineWidth = 5; x.strokeStyle = 'rgba(8,16,8,0.9)'; x.strokeText(text, W / 2, 48);
        x.fillStyle = '#ffffff'; x.fillText(text, W / 2, 48);
        const tex = new THREE.CanvasTexture(c);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }));
        spr.scale.set(1.5 * scale, 0.56 * scale, 1);
        spr.userData.tex = tex;
        return spr;
    }

    _glowTex() {
        if (this._shared.glowTex) return this._shared.glowTex;
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const x = c.getContext('2d');
        const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 64, 64);
        this._shared.glowTex = new THREE.CanvasTexture(c); return this._shared.glowTex;
    }

    _petalTex() {
        if (this._shared.petalTex) return this._shared.petalTex;
        const c = document.createElement('canvas'); c.width = 64; c.height = 64;
        const x = c.getContext('2d');
        x.fillStyle = '#ffffff';
        x.beginPath(); x.ellipse(32, 32, 12, 28, 0, 0, Math.PI * 2); x.fill();
        this._shared.petalTex = new THREE.CanvasTexture(c); return this._shared.petalTex;
    }

    // =====================================================================
    // 検証フック / ヘルパ
    // =====================================================================
    _debugState() {
        const byStage = {};
        for (const it of this.items) { if (it.built) byStage[it.stage] = (byStage[it.stage] || 0) + 1; }
        return {
            wordsReady: this._wordsReady, mock: this._mock, items: this.items.length,
            built: this.items.filter(i => i.built).length, byStage,
            memory: this.memoryWords.length, progress: +this.progress.toFixed(2),
            finale: this._finaleBuilt,
            activePetals: this.petals.filter(p => p.active).length,
        };
    }

    _eb(t) { const c1 = 1.70158, c3 = c1 + 1, p = t - 1; return 1 + c3 * p * p * p + c1 * p * p; }
    _lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    _roundRect(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
    _esc(s) { return String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
    }

    _disposeItem(item) {
        if (!item.group) return;
        this.seedGroup.remove(item.group);
        item.group.traverse(o => {
            if (o.geometry && !this._isShared(o.geometry)) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map && m.map.dispose && m !== this._shared.glowTex) m.map.dispose(); m.dispose && m.dispose(); });
        });
        if (item.label && item.label.userData.tex) item.label.userData.tex.dispose();
        item.group = item.seed = item.ring = item.sprout = item.flower = item.label = null;
        item.built = false;
    }

    _isShared(geo) {
        const s = this._shared;
        return geo === s.seedGeo || geo === s.stemGeo || geo === s.leafGeo || geo === s.ringGeo || geo === s.petalShape;
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        this.songWrapper.removeEventListener('pointerdown', this.boundOnPointerDown);
        window.removeEventListener('pointermove', this.boundOnPointerMove);
        window.removeEventListener('pointerup', this.boundOnPointerUp);
        eventBus.off('songEnd', this.boundOnSongEnd);
        clearTimeout(this._longPressTimer);
        clearTimeout(this._hintsTimer);

        // rootGroup配下を一括破棄
        if (this.rootGroup) {
            this.rootGroup.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map && m.map.dispose) m.map.dispose(); m.dispose && m.dispose(); });
            });
            this.scene.remove(this.rootGroup);
        }
        // ラベルのキャンバステクスチャ
        for (const it of this.items) { if (it.label && it.label.userData.tex) it.label.userData.tex.dispose(); }
        this.items = [];

        // HUD/最終メッセージを除去
        if (this._hud && this._hud.parentNode) this._hud.parentNode.removeChild(this._hud);
        if (this._finalEl && this._finalEl.parentNode) this._finalEl.parentNode.removeChild(this._finalEl);

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        super.destroy();
    }
}
