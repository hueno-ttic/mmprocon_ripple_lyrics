import * as THREE from 'three';
import { sfx } from '../core/sfx.js';
import { quality } from '../core/quality.js';
import { BaseSong } from './BaseSong.js';
import { SONGS } from '../config/songs.js';
import { playerManager } from '../core/player.js';
import { groupPhraseWords, findGroupForWord } from '../utils/lyricGroups.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { settleSpringBones, anchorSpringBonesToModel } from '../utils/vrm.js';

export class SongOrchestra extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.stars = null;
        this.starGeometry = null;
        this.starMaterial = null;
        this.starTwinkle = null;
        this.starBaseSizes = null;
        this.milkyWay = null;
        this.auroras = [];
        this._chorusOpen = 0; // サビで夜空が開く量(0..1)を滑らかに補間するための係数
        this.activeSprites = [];
        this.drawnLines = [];
        
        this.currentColor = localStorage.getItem('orchestra_color') || '#ffffff';
        this.lastChar = null;
        this.lastGroupStartTime = -1;
        this.colorPickerShown = false;
        this.hasResonatedColor = false;
        this.drawUiShown = false;
        this.isClimax = false;
        
        this.colorPickerContainer = null;
        this.fireworks = [];
        this._tutCard = null;
        
        // 色彩交響オーブ蓄積システムのステート
        this.resonateOrbs = [];
        this.hasTriggeredClimaxExplosion = false;
        this.orbGeometry = new THREE.SphereGeometry(0.12, 8, 8);

        // 序盤の予兆(premonition): 再生開始直後、まだ歌詞も操作も無い「無音地帯」を
        // 埋めるため、テーマ色のごく淡いオーブを数個ゆっくり漂わせ「触れられる」ことを示唆する。
        this.premonitionOrbs = [];
        this._premonitionDone = false;    // 予兆オーブを全て破棄し終えたら true
        this._premonitionFoldStart = undefined; // 昇華(消滅)フェーズ開始時刻(ms)
        this._tutCardTimer = null;
        this._introOverlay = null;
        this._headerDimmed = false; // イントロ中だけ左上ヘッダー(#song-info)を控えめにする状態
        this._firstLyricTime = null; // 最初の歌詞(=イントロ終端)の時刻(ms)。判定でキャッシュ
        this.introTitleSprites = []; // イントロでタップ可能なタイトル文字スプライト(ふれるとオーブ化)
        this.introFinaleFired = false; // イントロ終端の花火を一度だけ発火するフラグ
        this._finaleQueue = null; // イントロ終端の花火を時間差で夜空に咲かせるための予約列
        this._mousePos = null;
        
        // 歌詞の単語キャッシュステート
        this.lyricsCacheBuilt = false;
        this.allWordGroups = [];
        this.sublimatedGroupIndices = new Set();
        this.lastPosition = 0;



        // Climax Fireworks state
        this.climaxOrbs = [];                 // サビ中に順次打ち上げるオーブの退避用配列
        this.climaxLaunchedOrbs = new Set();  // 既に打ち上げ開始したオーブのインデックス

        // オーブゲージ(蓄積の可視化)と成果サマリーのステート
        this.collectedColors = [];        // 曲全体で集めたオーブ色の履歴(混色スウォッチ用)
        this.totalCollectedCount = 0;     // 曲全体で集めたオーブ総数(成果サマリー用)
        this.chorusOrbCount = 0;          // 直近のサビで消費するオーブ数(花火規模の比例係数)
        this.GAUGE_CAPACITY = 16;         // ゲージが満タンになるオーブ数
        this.orbGaugeEl = null;
        this.orbGaugeFillEl = null;
        this.orbGaugeCountEl = null;
        this._gaugeResetTimer = null;

        this.boundOnResize = this.onResize.bind(this);
        this.boundOnClick = this.onClick.bind(this);

        this._boundOnMouseMove = (e) => {
            this._mousePos = new THREE.Vector2(
                (e.clientX / window.innerWidth) * 2 - 1,
                -(e.clientY / window.innerHeight) * 2 + 1
            );
        };
    }

    init() {
        this.glowTexture = this.createGlowTexture();
        this.initThree();
        this.initStars();
        this.initNightSky();
        this.initOrbGauge();
        this.initPremonitionOrbs(); // 開幕直後の予兆オーブを配置（操作前でも画面を動かす）
        this.createIntroTitle();    // イントロ中に曲名・作者・遊び方を歌詞風に提示
        this.updateResultSummary(); // 0個の状態でも成果サマリーを初期登録
        window.addEventListener('resize', this.boundOnResize);
        this.container.addEventListener('click', this.boundOnClick);
        this.container.addEventListener('mousemove', this._boundOnMouseMove);
        
        // VRM model loading setup
        this.currentVRM = null;
        this.relaxedQuaternions = null;
        this.tapAnimation = null;
        this.hasTapped = false;
        this.isFlying = false;
        this.lastTappedMikuPos = null;
        this.baseMikuY = -3.2; // Adjusted down for Z=-13.0
        this.baseMikuX = 0;
        this.baseMikuZ = -13.0; // Placed behind the lyrics (Z=-11.0)
        this.baseMikuRotY = 0; // Face the camera

        // タップ時の本体配置オフセット(responsiveScale倍で使用)。
        // ハンドボーンが本体中心から「右0.064・上0.49」ぶん離れて垂れている計測値を打ち消し、
        // 手先を歌詞フレーズの中心へ重ねる。奥行きは歌詞(Z=-11)より少し後ろに置き前面で読ませる。
        this.TAP_HAND_OFF_X = 0.064;
        this.TAP_HAND_OFF_Y = 0.49;
        this.TAP_BODY_BEHIND = 0.23;
        this.lastRealTime = undefined;

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
                vrm.scene.position.set(this.baseMikuX, this.baseMikuY, this.baseMikuZ);
                vrm.scene.rotation.y = this.baseMikuRotY;
                vrm.scene.scale.set(6.0, 6.0, 6.0); // Scale up 2x to look natural at Z=-13.0
                
                // Set initial relaxed pose
                this.setupRelaxedPose(vrm);
                settleSpringBones(vrm); // 開幕時にツインテールが逆立たないよう静止状態へ

                // SpringBone の静止状態を最終ポーズ/スケールへスナップ。
                // 構築時(VRMLoaderPlugin)の「素ポーズ・原点・スケール1」のまま
                // 最初の update が走ると、ロード後に当てたトランスフォーム/初期ポーズとの
                // ズレで髪(ツインテール)がフレーム1で跳ね上がる。これを防ぐため
                // ポーズ適用直後にワールド行列を更新してから reset() する。
                vrm.update(0);
                vrm.scene.updateMatrixWorld(true);
                if (vrm.springBoneManager) {
                    vrm.springBoneManager.reset();
                }

                // SpringBoneの基準をモデルのルートへ固定し、タップ移動時の
                // 並進慣性でツインテールが逆立つのを防ぐ。
                anchorSpringBonesToModel(vrm);

                // Cache relaxed quaternions for active arms
                const leftUpper = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
                const rightUpper = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
                const leftLower = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
                const rightLower = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
                
                this.relaxedQuaternions = {
                    leftUpperArm: leftUpper ? leftUpper.quaternion.clone() : new THREE.Quaternion(),
                    rightUpperArm: rightUpper ? rightUpper.quaternion.clone() : new THREE.Quaternion(),
                    leftLowerArm: leftLower ? leftLower.quaternion.clone() : new THREE.Quaternion(),
                    rightLowerArm: rightLower ? rightLower.quaternion.clone() : new THREE.Quaternion()
                };

                console.log('[ORCHESTRA] Miku VRM loaded successfully.');
            },
            undefined,
            (error) => {
                console.error('[ORCHESTRA] Failed to load VRM:', error);
            }
        );

        super.init();

        // 初回誘導: 最初にアクティブ化した歌詞スプライト(星座ノードは除く)の実位置に
        // ガイドを重ねる(共通機構)。初回の色共鳴で resonateLyricColor() 側が dismiss する。
        this.highlightFirstInteractable(() => {
            if (this.hasResonatedColor) return null;
            const target = this.activeSprites.find(s => s && !s.userData.isNode);
            if (!target) return null;
            return this.worldToScreen(target.position.clone());
        }, { label: '歌詞をタップ' });
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050510);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 10;
        
        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        this.songWrapper.appendChild(this.renderer.domElement);

        // Add ambient light for character details
        const ambientLight = new THREE.AmbientLight(0x404070, 1.8);
        this.scene.add(ambientLight);

        // Add directional light to bring depth to the 3D model
        const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
        dirLight.position.set(2, 4, 10);
        this.scene.add(dirLight);
    }

    initStars() {
        const count = window.innerWidth > 768 ? 10000 : 3000;
        this.starGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 100;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
            sizes[i] = Math.random() * 2;
        }
        
        this.starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.starGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        this.starMaterial = new THREE.PointsMaterial({
            color: new THREE.Color(this.currentColor),
            size: 0.1,
            transparent: true,
            opacity: 0.8
        });
        
        // またたきを与えるため、各星に固有の位相/速度を持たせる
        const twinkle = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
            twinkle[i * 2] = Math.random() * Math.PI * 2;       // phase
            twinkle[i * 2 + 1] = 0.6 + Math.random() * 1.4;     // speed
        }
        this.starTwinkle = twinkle;
        this.starBaseSizes = sizes;

        this.stars = new THREE.Points(this.starGeometry, this.starMaterial);
        this.scene.add(this.stars);
    }

    // 夜空そのものの演出強化: 天の川の淡い帯とオーロラ状の光のカーテン。
    // 花火は使わず、f0_start のスクショで世界観が一目で伝わる「静かな掴み」を作る。
    initNightSky() {
        // --- 天の川: 斜めに横切る淡い星の帯 ---
        const isMobile = window.innerWidth < 768;
        const mwCount = isMobile ? 1200 : 3500;
        const mwGeo = new THREE.BufferGeometry();
        const mwPos = new Float32Array(mwCount * 3);
        for (let i = 0; i < mwCount; i++) {
            // 帯に沿った座標(t)＋帯幅方向のガウス的ばらつきで天の川らしい密度勾配を作る
            const t = (Math.random() - 0.5) * 120;
            const spread = (Math.random() - 0.5) + (Math.random() - 0.5); // 中央に集まる近似ガウス
            mwPos[i * 3] = t;
            mwPos[i * 3 + 1] = t * 0.45 + spread * 9.0 + 14.0; // 斜め上方へ流す
            mwPos[i * 3 + 2] = -38 - Math.random() * 18;
        }
        mwGeo.setAttribute('position', new THREE.BufferAttribute(mwPos, 3));
        const mwMat = new THREE.PointsMaterial({
            color: new THREE.Color(0xaecbff),
            size: 0.32,
            map: this.glowTexture,
            transparent: true,
            opacity: 0.0, // フェードインで「光が満ちる」演出
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.milkyWay = new THREE.Points(mwGeo, mwMat);
        this.scene.add(this.milkyWay);

        // --- オーロラ状の光のカーテン: 緩く脈動する2枚の縦帯 ---
        this.auroras = [];
        const auroraDefs = [
            { hex: 0x2f7fff, x: -10, w: 22, h: 34, op: 0.18 },
            { hex: 0x18c79a, x: 10, w: 20, h: 30, op: 0.15 }
        ];
        for (const d of auroraDefs) {
            const tex = this.createAuroraTexture(d.hex);
            const mat = new THREE.SpriteMaterial({
                map: tex,
                color: 0xffffff,
                transparent: true,
                opacity: 0.0,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const sp = new THREE.Sprite(mat);
            sp.position.set(d.x, 6, -34);
            sp.scale.set(d.w, d.h, 1);
            sp.userData = { baseOpacity: d.op, phase: Math.random() * Math.PI * 2, baseX: d.x };
            this.scene.add(sp);
            this.auroras.push(sp);
        }
    }

    // オーロラのカーテン用に、上方ほど淡く消える縦グラデのソフトテクスチャを生成
    createAuroraTexture(hex) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const c = new THREE.Color(hex);
        const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
        const grad = ctx.createLinearGradient(0, 128, 0, 0);
        grad.addColorStop(0.0, `rgba(${r},${g},${b},0.0)`);
        grad.addColorStop(0.35, `rgba(${r},${g},${b},0.55)`);
        grad.addColorStop(0.7, `rgba(${r},${g},${b},0.22)`);
        grad.addColorStop(1.0, `rgba(${r},${g},${b},0.0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 128);
        // 横方向もソフトに減衰させてカーテンの縁をぼかす
        const hgrad = ctx.createLinearGradient(0, 0, 64, 0);
        hgrad.addColorStop(0.0, 'rgba(0,0,0,1)');
        hgrad.addColorStop(0.5, 'rgba(0,0,0,0)');
        hgrad.addColorStop(1.0, 'rgba(0,0,0,1)');
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = hgrad;
        ctx.fillRect(0, 0, 64, 128);
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }

    // 夜空の演出更新。intro でゆっくり光が満ち、サビ(open)で天の川/オーロラが一段華やぐ。
    updateNightSky(position, open) {
        const t = position * 0.001;

        // 星のまたたき: 各星の固有位相でサイズを揺らし、生きた夜空にする(60fps配慮で軽量)
        if (this.starGeometry && this.starTwinkle && this.starBaseSizes) {
            const sizeAttr = this.starGeometry.getAttribute('size');
            if (sizeAttr) {
                const arr = sizeAttr.array;
                const tw = this.starTwinkle;
                const base = this.starBaseSizes;
                for (let i = 0; i < arr.length; i++) {
                    const flick = 0.65 + 0.35 * Math.sin(t * tw[i * 2 + 1] + tw[i * 2]);
                    arr[i] = base[i] * flick;
                }
                sizeAttr.needsUpdate = true;
            }
        }

        // 天の川: 開幕からゆっくりフェードイン、サビでさらに明るく
        if (this.milkyWay) {
            const introFade = Math.min(1.0, position / 6000); // 最初の6秒で満ちる
            // イントロ(open≈0)でも天の川が見えるよう下限を引き上げ、サビのピークは概ね据え置き。
            const target = (0.52 + 0.40 * open) * introFade;
            const m = this.milkyWay.material;
            m.opacity += (target - m.opacity) * 0.04;
            this.milkyWay.rotation.z += 0.00012; // ごく緩やかに流す
        }

        // オーロラのカーテン: 脈動しつつサビで濃く立ち上がる
        if (this.auroras) {
            const introFade = Math.min(1.0, position / 5000);
            for (const a of this.auroras) {
                const u = a.userData;
                const pulse = 0.6 + 0.4 * Math.sin(t * 0.5 + u.phase);
                // イントロからオーロラのカーテンが脈動して見えるよう下限を引き上げる。
                // サビ(open=1)のピークは旧 2.3 → 新 2.35 とほぼ同等を維持。
                const target = u.baseOpacity * (1.15 + 1.2 * open) * pulse * introFade;
                a.material.opacity += (target - a.material.opacity) * 0.05;
                // ゆらめき: 横にゆっくり漂わせる
                a.position.x = u.baseX + Math.sin(t * 0.3 + u.phase) * 1.6;
            }
        }
    }

    // 最初の歌詞(=イントロ終端)の時刻を返す。TextAlive の firstPhrase から一度だけ取得しキャッシュ。
    // まだ video が準備できていない間は null（その場合はイントロ中とみなす）。
    _getFirstLyricTime() {
        if (this._firstLyricTime != null) return this._firstLyricTime;
        const v = playerManager.player && playerManager.player.video;
        if (v && v.firstPhrase && typeof v.firstPhrase.startTime === 'number') {
            this._firstLyricTime = v.firstPhrase.startTime;
        }
        return this._firstLyricTime;
    }

    // イントロ中、曲タイトルを「タップ可能な光の文字」として夜空に提示する。
    // 文字にふれるとオーブ化して蓄積し、イントロ終端でまとめて花火になる ──
    // 本編のコア操作(歌詞タップ→色オーブ→サビで花火)をタイトルで予行演習させる狙い。
    // 文字の表示/オーブ化/花火の制御は update() → updateIntroTitle() が行う。
    createIntroTitle() {
        if (!this.songWrapper || !this.scene) return;
        const cfg = SONGS.find(s => s.id === this.songId) || {};
        const color = cfg.color || '#185FA5';

        // --- 3D: タイトル文字をタップ可能スプライトとして夜空へ並べる ---
        this._buildIntroTitleSprites(cfg.title || '');

        // --- DOM: 操作説明の小さなキャプションのみ(作者はイントロでは出さない／タイトルは3D表示) ---
        const overlay = document.createElement('div');
        overlay.className = 'orchestra-intro-title';
        overlay.style.cssText = `
            position:absolute; top:64%; left:50%; transform:translate(-50%,-50%);
            width:min(86vw,640px); text-align:center; pointer-events:none; z-index:150;
            opacity:0; transition:opacity 0.9s ease;
            font-family:"Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            text-shadow:0 0 12px ${color}, 0 2px 16px rgba(0,0,0,0.55);
        `;
        overlay.innerHTML = `
            <div style="margin:0 auto;width:46px;height:1px;background:linear-gradient(90deg,transparent,${color},transparent);"></div>
            <div style="margin-top:11px;font-size:clamp(10px,1.7vw,13px);line-height:1.8;color:rgba(255,255,255,0.8);">タイトルの文字にふれると、光のオーブになって<br>夜空にひびきます</div>
        `;
        this.songWrapper.appendChild(overlay);
        this._introOverlay = overlay;

        // イントロ中は3Dタイトルが主役なので、左上の常設ヘッダーを控えめにする。
        this._setHeaderDimmed(true);
        this._headerDimmed = true;
    }

    // タイトル文字列を1文字ずつ、タップ可能な発光スプライトとして中央上部に並べる。
    // 既存の歌詞用 createTextTexture を流用(白文字・透明背景)。activeSprites には入れず、
    // onClick 側で専用にレイキャストするため歌詞パイプラインとは干渉しない。
    _buildIntroTitleSprites(title) {
        const chars = Array.from(title).filter(c => c.trim());
        if (!chars.length) return;
        const y0 = 2.2;                                  // ミクより上、夜空の中ほど
        const z0 = -10.0;
        const GAP_RATIO = 1.18;                          // 文字間隔 / スケール

        // この奥行きでの可視幅を算出し、画面からはみ出さない範囲で文字を最大化する。
        // スマホ(縦長=狭アスペクト)では固定スケールだと文字が小さすぎて読めないため、
        // 可視幅に合わせて動的に拡大する(横長デスクトップでは従来感を保つ上限でクランプ)。
        const dist = this.camera.position.z - z0;        // カメラZ(10) - 文字Z(-10) = 20
        const fovRad = (this.camera.fov * Math.PI) / 180;
        const visibleHeight = 2.0 * dist * Math.tan(fovRad / 2.0);
        const visibleWidth = visibleHeight * this.camera.aspect;
        // 文字列の総幅 = S * advance（CJKはほぼ正方形なので代表アスペクト1.0で概算）
        const advance = (chars.length - 1) * GAP_RATIO + 1.0;
        const isMobile = window.innerWidth < 768;
        // タップしやすさ優先で可視幅の92%まで使って大きく表示。スマホ下限〜デスクトップ上限でクランプ。
        const fitS = (visibleWidth * 0.92) / advance;
        const S = Math.max(isMobile ? 1.3 : 1.15, Math.min(isMobile ? 3.2 : 1.9, fitS));
        const gap = S * GAP_RATIO;                        // 文字間隔
        const totalW = (chars.length - 1) * gap;
        chars.forEach((ch, i) => {
            const { texture, aspect } = this.createTextTexture(ch, 'default');
            const mat = new THREE.SpriteMaterial({
                map: texture, color: new THREE.Color('#ffffff'),
                transparent: true, opacity: 0, depthWrite: false
            });
            const sp = new THREE.Sprite(mat);
            const baseX = -totalW / 2 + i * gap;
            sp.position.set(baseX, y0, z0);
            sp.scale.set(aspect * S, S, 1);
            sp.userData = {
                isIntroTitle: true, text: ch,
                baseX, baseY: y0, baseScale: S, aspect,
                phase: Math.random() * Math.PI * 2, tapped: false
            };
            this.scene.add(sp);
            this.introTitleSprites.push(sp);
        });
    }

    // タイトル文字をタップ/自動でオーブ化し、蓄積オーブ(resonateOrbs)へ加える。
    // 本編 resonateLyricColor のオーブ生成部を踏襲し、イントロ終端の花火の素にする。
    _resonateIntroTitle(sprite, auto = false) {
        if (!sprite || sprite.userData.tapped) return;
        sprite.userData.tapped = true;

        const hex = this.getSemanticColor(sprite.userData.text) ||
            ['#ffffff', '#ffb834', '#ff3b5c', '#00d4ff', '#00ffb0', '#d95bff'][Math.floor(Math.random() * 6)];
        const newColor = new THREE.Color(hex);

        // 文字スプライトを除去
        const idx = this.introTitleSprites.indexOf(sprite);
        if (idx !== -1) this.introTitleSprites.splice(idx, 1);
        const pos = sprite.position.clone();
        this.scene.remove(sprite);
        if (sprite.material.map) sprite.material.map.dispose();
        sprite.material.dispose();

        // オーブ生成(resonateLyricColor と同じ蓄積系へ載せる → イントロ終端でまとめて花火に)
        if (this.resonateOrbs.length >= 120) {
            const old = this.resonateOrbs.shift();
            this.scene.remove(old);
            if (old.material) old.material.dispose();
        }
        const orbMat = new THREE.MeshBasicMaterial({ color: newColor, transparent: true, opacity: 0.85 });
        const orb = new THREE.Mesh(this.orbGeometry, orbMat);
        if (this.glowTexture) {
            const haloMat = new THREE.SpriteMaterial({
                map: this.glowTexture, color: newColor, transparent: true,
                opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false
            });
            const halo = new THREE.Sprite(haloMat);
            halo.scale.set(0.65, 0.65, 1.0);
            orb.add(halo);
        }
        orb.position.copy(pos);
        orb.userData = {
            color: newColor, angle: Math.random() * Math.PI * 2,
            radius: 3.2 + Math.random() * 2.2, speed: 0.015 + Math.random() * 0.015,
            yBase: (Math.random() - 0.5) * 3.5, phase: Math.random() * Math.PI * 2, isExploded: false
        };
        this.scene.add(orb);
        this.resonateOrbs.push(orb);

        this.spawnOrbBirthFlare(newColor, pos);
        this.spawnTapSparkles(newColor, pos);

        this.hasResonatedColor = true;     // 予兆オーブの昇華・誘導ガイド片付けと同調
        this.dismissFirstInteractable();
        this.collectedColors.push(hex);
        this.totalCollectedCount++;
        // イントロのタイトル由来オーブはゲージに溜めない(ゲージ＝本編で集めたサビ花火の燃料を表すため)。
        this.updateResultSummary();
    }

    // イントロ終端: 未タップのタイトル文字を自動でオーブ化し、集めた色を時間差で夜空に
    // 打ち上げて「花火のショー」にする。無操作でも必ず「タップ→オーブ→花火」の payoff を
    // 見せ、本編操作(歌詞タップ→色オーブ→サビで花火)の予告にする。
    _fireIntroFinale(position) {
        // 残りの文字をオーブ化(色を回収)
        for (let i = this.introTitleSprites.length - 1; i >= 0; i--) {
            this._resonateIntroTitle(this.introTitleSprites[i], true);
        }
        // 集めた色を取り出し、蓄積オーブ本体は「花火に昇華した」ものとして片付ける。
        const colors = this.resonateOrbs.map(o => o.userData.color.clone());
        this.resonateOrbs.forEach(o => { this.scene.remove(o); if (o.material) o.material.dispose(); });
        this.resonateOrbs = [];
        if (!colors.length) return;

        // 花火ショーの発火リストを組む。イントロの花火は「予告編」なので控えめにし、サビの大輪を主役に
        // 際立たせる(以前は intensity=2.4 でサビと同等に大きく、サビが目立たなかった)。
        //  ・小さめの一輪 … 集めた色ごとに1発(intensity=0.55=控えめ)
        //  ・さらに小さい余韻のecho … 数を絞って軽く添える
        const bursts = [];
        colors.forEach(c => bursts.push({ color: c, intensity: 0.55 }));
        const echoN = Math.ceil(colors.length * 0.4);
        for (let i = 0; i < echoN; i++) {
            bursts.push({ color: colors[Math.floor(Math.random() * colors.length)].clone(), intensity: 0.35 });
        }

        // 夜空の各所へ時間差(約1.4s)で咲かせる予約列(songポジション駆動=一時停止に強い)。
        // 大輪を先に、echoを後半へ寄せて「開いて→散る」流れを作る。x±12/y1.6〜6.2/z近めで大きく見せる。
        const span = 1400;
        const n = bursts.length;
        this._finaleQueue = bursts.map((b, i) => ({
            color: b.color,
            intensity: b.intensity,
            atPos: position + (i / n) * span,
            pos: new THREE.Vector3((Math.random() - 0.5) * 12, 1.6 + Math.random() * 4.6, -6 - Math.random() * 6),
        }));
    }

    // 予約された花火を、現在のsongポジションに達したものから順に打ち上げる(イントロ終端のショー)。
    _drainFinaleQueue(position) {
        if (!this._finaleQueue || !this._finaleQueue.length) return;
        for (let i = this._finaleQueue.length - 1; i >= 0; i--) {
            if (position >= this._finaleQueue[i].atPos) {
                const f = this._finaleQueue[i];
                this.spawnCustomColorFirework(f.color, f.pos, f.intensity); // 大輪/echoで開きを出し分け
                this._finaleQueue.splice(i, 1);
            }
        }
        if (!this._finaleQueue.length) this._finaleQueue = null;
    }

    // 左上の曲情報ヘッダー(#song-info: 曲名+作者)の濃さを切り替える。
    // dimmed=true でイントロ中だけ淡く、false で通常へ滑らかに戻す(他曲・他UIには非干渉)。
    _setHeaderDimmed(dimmed) {
        const el = document.getElementById('song-info');
        if (!el) return;
        el.style.transition = 'opacity 0.9s ease';
        el.style.opacity = dimmed ? '0.16' : '';
    }

    // イントロ演出の駆動: タイトル文字のフェードイン/脈動 → 終端で花火 → キャプション退場。
    updateIntroTitle(position) {
        const firstLyric = this._getFirstLyricTime();
        const HINT_LEAD = 1500;   // DOMキャプションを退場させる(最初の歌詞の手前)
        const FINALE_LEAD = 1500; // この時刻にタイトルを花火へ変えてイントロを締める

        // --- 3D タイトル文字: フェードイン + ゆらぎ + タップ誘発の脈動 ---
        if (this.introTitleSprites.length) {
            const t = position * 0.001;
            const appear = Math.min(1, Math.max(0, (position - 300) / 900));
            for (const sp of this.introTitleSprites) {
                const u = sp.userData;
                const pulse = 0.82 + 0.18 * Math.sin(t * 2.2 + u.phase);
                sp.material.opacity += (appear * pulse - sp.material.opacity) * 0.12;
                sp.position.y = u.baseY + Math.sin(t * 0.9 + u.phase) * 0.10;
                const breathe = 1.0 + 0.05 * Math.sin(t * 2.2 + u.phase);
                sp.scale.set(u.aspect * u.baseScale * breathe, u.baseScale * breathe, 1);
            }
        }

        // --- イントロ終端の花火(一度きり) ---
        if (!this.introFinaleFired && firstLyric != null && position >= firstLyric - FINALE_LEAD) {
            this.introFinaleFired = true;
            this._fireIntroFinale(position);
            // 文字が花火になって去るのでヘッダーを通常表示へ戻す
            if (this._headerDimmed) { this._setHeaderDimmed(false); this._headerDimmed = false; }
        }
        // 予約された花火を時間差で打ち上げる(ショー演出)
        this._drainFinaleQueue(position);

        // --- DOM キャプション(作者+操作説明)の表示/退場 ---
        if (this._introOverlay) {
            let target;
            if (firstLyric != null && position >= firstLyric - HINT_LEAD) target = 0;
            else if (position < 400) target = 0;
            else target = 1;
            const cur = parseFloat(this._introOverlay.style.opacity) || 0;
            if (Math.abs(cur - target) > 0.01) this._introOverlay.style.opacity = String(target);

            // ヘッダーの濃さをキャプションに同期(花火でまだ戻していなければ)。
            const wantDim = (target === 1) && !this.introFinaleFired;
            if (this._headerDimmed !== wantDim) { this._setHeaderDimmed(wantDim); this._headerDimmed = wantDim; }

            if (firstLyric != null && position >= firstLyric + 800) {
                if (this._introOverlay.parentNode) this._introOverlay.parentNode.removeChild(this._introOverlay);
                this._introOverlay = null;
                if (this._headerDimmed) { this._setHeaderDimmed(false); this._headerDimmed = false; }
            }
        }
    }

    // 序盤の予兆オーブを生成。これから集まる色彩オーブを予感させる多色の微小な加算発光
    // スプライトを数個、画面手前(カメラを塞がない z=-6〜-9)にゆるくクラスタ配置する。
    // クリック判定(activeSprites)には含めないので歌詞タップとは一切干渉しない。
    // 既存の glowTexture を共有し、新規ジオメトリは増やさない(マテリアルのみ dispose 経路へ)。
    initPremonitionOrbs() {
        if (!this.glowTexture || !this.scene) return;
        const isMobile = window.innerWidth < 768;
        // イントロの主役はタップ可能なタイトル文字なので、予兆オーブは「背景の控えめな
        // アンビエント」に抑える(数を減らす)。クリック判定には含めず(activeSprites非参加)、
        // glowTexture共有なので描画コストとリーク懸念は軽微。
        const count = isMobile ? 3 : 7;
        // 共鳴で実際に生まれるオーブ色(getSemanticColor の6色)＋テーマ青。
        // これらを予兆に使うことで「触れるとこの色たちが集まる」と視覚的に予告する。
        const PALETTE = ['#185FA5', '#ffb834', '#ff3b5c', '#00d4ff', '#00ffb0', '#d95bff'];
        // 隣り合うオーブが別色になるようシャッフルしてから順に割り当てる
        const shuffled = [...PALETTE].sort(() => Math.random() - 0.5);
        for (let i = 0; i < count; i++) {
            const hex = shuffled[i % shuffled.length];
            const mat = new THREE.SpriteMaterial({
                map: this.glowTexture,
                color: new THREE.Color(hex),
                transparent: true,
                opacity: 0.0,            // フェードインで静かに現れる
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const sp = new THREE.Sprite(mat);
            const baseX = (Math.random() - 0.5) * (isMobile ? 4.5 : 7.0);
            const baseY = (Math.random() - 0.5) * 3.2 - 0.2;
            const baseZ = -6.0 - Math.random() * 3.0;
            sp.position.set(baseX, baseY, baseZ);
            const s = 0.6 + Math.random() * 0.4;
            sp.scale.set(s, s, 1);
            sp.userData = {
                baseX, baseY,
                baseScale: s,
                hex,
                phase: Math.random() * Math.PI * 2,
                driftX: 0.55 + Math.random() * 0.45, // 横ゆらぎの周期係数
                driftY: 0.40 + Math.random() * 0.40, // 縦ゆらぎの周期係数
                ampX: 0.5 + Math.random() * 0.6,
                ampY: 0.35 + Math.random() * 0.4,
                twinkle: 0.7 + Math.random() * 0.8,
                // 昇華を一斉でなく順番に始めるためのずらし(ms)。オーブ数を12へ増やしたぶん
                // 間隔を詰め、最後のオーブも ORB_LEAD 内(歌詞開始前)に消え切るようにする。
                foldDelay: i * 120 + Math.random() * 100
            };
            this.scene.add(sp);
            this.premonitionOrbs.push(sp);
        }
    }

    // 予兆オーブの更新: 開幕で静かにフェードイン→ゆっくり漂いつつ明滅。
    // 歌詞が画面に出揃うほど自然に減光し、最初の色共鳴(操作) or 予兆時間切れで
    // 「昇華フェーズ」へ移行する。常時5個以下なので 60fps への影響は無視できる。
    updatePremonitionOrbs(position) {
        if (this._premonitionDone || !this.premonitionOrbs.length) {
            this._premonitionDone = this._premonitionDone || !this.premonitionOrbs.length;
            return;
        }

        // 畳み(昇華)フェーズへ移行する条件:
        //  ① 初回共鳴(操作)した、または
        //  ② イントロ終端(最初の歌詞)が近づいた ── 予兆オーブは「歌詞が始まる前の助走」
        //     なので、歌詞が来る少し前(ORB_LEAD)に役割を終えて夜空へ還す。
        //     これにより無操作でも歌詞開始時には予兆オーブが残らない。
        const firstLyric = this._getFirstLyricTime();
        const ORB_LEAD = 2800; // 最初の歌詞の約2.8秒前から昇華を開始(全オーブが歌詞前に消え切る)
        const introEnding = (firstLyric != null) && (position >= firstLyric - ORB_LEAD);
        const folding = this.hasResonatedColor || introEnding;
        if (folding) {
            if (this._premonitionFoldStart === undefined) this._premonitionFoldStart = position;
            // ゲージの「序盤の脈動」も操作開始で解除
            if (this.orbGaugeEl) this.orbGaugeEl.classList.remove('orchestra-orb-gauge-intro');
        }

        // 歌詞(=本来の見せ場)が立ち上がるほど予兆は控えめに引いていく。
        // ただし引きすぎると歌詞が出た瞬間に画面が痩せるので、減衰は緩やかにし、
        // 最低限の存在感(0.35)は残す。
        const activeLyrics = this.activeSprites.filter(s => !s.userData.isNode).length;
        const lyricDim = Math.max(0.35, 1 - activeLyrics * 0.22);

        const t = position * 0.001;
        const fadeIn = Math.min(1.0, position / 800);

        for (let i = this.premonitionOrbs.length - 1; i >= 0; i--) {
            const sp = this.premonitionOrbs[i];
            const u = sp.userData;

            // 常に：ゆっくりした漂い(横長のリサージュ風)
            sp.position.x = u.baseX + Math.sin(t * u.driftX + u.phase) * u.ampX;
            sp.position.y = u.baseY + Math.cos(t * u.driftY + u.phase) * u.ampY;

            // 昇華が始まっているか(オーブごとに foldDelay だけ遅れて開始)
            const sublimating = folding && (position - this._premonitionFoldStart >= u.foldDelay);

            if (sublimating) {
                // 幻想的な消滅: 夜空へゆっくり昇りながら、中盤で一度きらめき(残光)、
                // ふわっと広がって星屑になって消える。
                u.baseY += 0.012; // 夜空へ昇華
                const k = Math.min(1.0, (position - this._premonitionFoldStart - u.foldDelay) / 1200); // 1.2秒で昇華
                const bloom = Math.sin(Math.min(1.0, k * 1.6) * Math.PI); // 中盤で一瞬明るくなる残光
                sp.material.opacity = Math.max(0, (0.55 * (1 - k) + 0.4 * bloom) * 0.95);
                const sc = u.baseScale * (1.0 + k * 0.7); // 広がりながら薄れる
                sp.scale.set(sc, sc, 1);

                if (k >= 1.0 || sp.material.opacity < 0.01) {
                    // 最後に同色の星屑をきらめかせて散らす(共通の花火更新ループで dispose)
                    this.spawnPremonitionDissolve(sp.material.color, sp.position);
                    this.scene.remove(sp);
                    sp.material.dispose(); // map は共有の glowTexture なので触らない
                    this.premonitionOrbs.splice(i, 1);
                }
            } else {
                // 通常の漂い: フェードイン＋明滅＋わずかな呼吸スケール
                const twinkle = 0.55 + 0.45 * Math.sin(t * u.twinkle + u.phase);
                // タイトル文字を主役にするため、予兆オーブは控えめな明るさに抑える(背景アンビエント)。
                const target = 0.42 * fadeIn * twinkle * lyricDim;
                sp.material.opacity += (target - sp.material.opacity) * 0.06;
                const breathe = 1.0 + 0.12 * Math.sin(t * u.twinkle + u.phase);
                const sc = u.baseScale * breathe;
                sp.scale.set(sc, sc, 1);
            }
        }

        if (folding && this.premonitionOrbs.length === 0) {
            this._premonitionDone = true;
        }
    }

    // 予兆オーブが「星屑になって夜空へ還る」幻想的な消滅エフェクト。
    // 既存の花火更新ループ(this.fireworks)に載せるため、生成・破棄は完全に共通経路で安全。
    spawnPremonitionDissolve(color, pos) {
        const geo = new THREE.BufferGeometry();
        const count = 16; // ごく軽量
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            positions[i * 3] = pos.x;
            positions[i * 3 + 1] = pos.y;
            positions[i * 3 + 2] = pos.z;
            // 弱い拡散で「ふわっ」と外へ広がりつつ、上方へたなびく星屑
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const speed = 0.06 + Math.random() * 0.12;
            velocities.push(new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.abs(Math.sin(phi) * Math.sin(theta)) * speed + 0.05, // 上昇バイアス
                Math.cos(phi) * speed
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: color,
            size: 0.16,
            map: this.glowTexture, // 共有テクスチャ(花火ループは material.dispose のみで map は残す)
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0.95,
            depthWrite: false
        });
        const particles = new THREE.Points(geo, mat);
        particles.userData = { velocities, birth: Date.now() };
        this.scene.add(particles);
        this.fireworks.push(particles);
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.drawCanvas) {
            this.drawCanvas.width = window.innerWidth;
            this.drawCanvas.height = window.innerHeight;
        }
    }

    getWordCategory(text) {
        if (!text) return 'default';
        const categories = {
            sky_color: ['空', 'ソラ', '青', '色', 'イロ', '雲', '白', '黒'],
            light: ['光', 'ヒカリ', '星', '明', '輝'],
            machine: ['機械', 'データ', 'スモッグ', 'ノイズ', '五感'],
            music_march: ['マーチ', '進', '歩', '止', '戻'],
            music: ['音楽', 'オンガク', '旋律', 'メロディ', '歌', '曲', '奏'],
            voice_echo: ['声', 'コエ', '木霊', '響', '叫'],
            future_memory: ['未来', 'ミライ', '文明', '何万年', '明日', '記憶', '残', '忘', '託', '形', 'カタチ', 'キオク'],
            sadness: ['悲', '哀', 'カナシミ', '苦', '傷', '寂', '涙', 'ナミダ']
        };

        for (const [cat, keywords] of Object.entries(categories)) {
            if (keywords.some(kw => text.includes(kw))) {
                return cat;
            }
        }
        return 'default';
    }

    createTextTexture(text, category = 'default') {
        // Select font based on category (machine uses sharp gothic, others elegant mincho)
        let font = 'bold 72px "Noto Serif JP", "Yu Mincho", serif';
        if (category === 'machine') {
            font = 'bold 72px "Inter", "Noto Sans JP", "Helvetica Neue", sans-serif';
        }
        
        // 1. Measure text width first to make canvas proportional
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = font;
        const metrics = tempCtx.measureText(text);
        
        let padding = 60;
        if (category === 'music' || category === 'music_march' || category === 'voice_echo' || category === 'future_memory') {
            padding = 100; // Extra room for staffs, soundwaves, constellation lines
        }
        const textWidth = Math.max(160, Math.ceil(metrics.width) + padding);
        
        // 文字がぼやけないよう実ピクセルを SS 倍で確保し、論理座標(W×H)で描画する。
        // ただしテクスチャ実ピクセル幅に上限を設け、長いフレーズで肥大化(VRAM/アップロード/フィルレート増)
        // しないようにする。長フレーズは画面でも横長で1グリフあたりの表示解像度は十分なため、上限で
        // 抑えても見た目は変わらない(短〜中フレーズは SS=2 のまま鮮明)。
        const W = textWidth, H = 128; // 論理サイズ(aspect・レイアウト計算はこの値基準)
        const MAX_TEX_W = 1600;       // 実ピクセル幅の上限
        let ss = 2;                   // 既定のスーパーサンプリング倍率
        if (W * ss > MAX_TEX_W) ss = Math.max(1, MAX_TEX_W / W); // 長フレーズは倍率を下げる
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(W * ss);
        canvas.height = Math.round(H * ss);

        const ctx = canvas.getContext('2d');
        ctx.scale(ss, ss);
        ctx.clearRect(0, 0, W, H);

        // --- Category Background Decorations ---
        if (category === 'music' || category === 'music_march') {
            // Faint staff lines in the background
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = 1.5;
            const centerY = 64;
            const spacing = 8;
            for (let i = -2; i <= 2; i++) {
                const y = centerY + i * spacing;
                ctx.beginPath();
                ctx.moveTo(10, y);
                ctx.lineTo(W - 10, y);
                ctx.stroke();
            }
        } else if (category === 'voice_echo') {
            // Faint soundwave pattern behind text
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let x = 10; x < W - 10; x += 4) {
                const amp = Math.sin(x * 0.08) * 16 * Math.sin(x * 0.01);
                const y = 64 + amp;
                if (x === 10) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        } else if (category === 'future_memory') {
            // Connected constellation path in background
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            const pts = [
                { x: 15, y: 35 },
                { x: W * 0.28, y: 85 },
                { x: W * 0.5, y: 30 },
                { x: W * 0.72, y: 95 },
                { x: W - 15, y: 45 }
            ];
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.stroke();
            
            // Constellation nodes (stars)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            for (const p of pts) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        // --- Text Render ---
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let fillStyle = '#ffffff';
        if (category === 'sadness') {
            fillStyle = 'rgba(255, 255, 255, 0.65)'; // Quiet, heavy semi-transparent
        }
        ctx.fillStyle = fillStyle;
        
        if (category !== 'machine') {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 3;
        }
        
        // Category Text Rendering overrides
        if (category === 'machine') {
            // Glitched red/cyan offsets
            ctx.fillStyle = 'rgba(0, 255, 255, 0.7)';
            ctx.fillText(text, W / 2 - 3, 64);

            ctx.fillStyle = 'rgba(255, 0, 128, 0.7)';
            ctx.fillText(text, W / 2 + 3, 64);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, W / 2, 64);
        } else if (category === 'voice_echo') {
            // 以前は同じ文字を -40/-20/0px にずらして焼き込む「エコー残像」だったが、
            // 歌詞が二重に見える主因だったため廃止。発光は背景のサウンドウェーブとハロー(spawnText)で表現し、
            // 文字自体は中央に一度だけ描く。
            ctx.fillText(text, W / 2, 64);
        } else {
            ctx.fillText(text, W / 2, 64);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 4; // 斜め視/縮小時のにじみを軽減
        return { texture, aspect: W / H };
    }

    createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)'); // 中心コア（白）
        gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.85)');
        gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.35)');
        gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)'); // 周縁部（透明）
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }

    buildLyricsCache() {
        if (!playerManager.isTimerReady || !playerManager.player || !playerManager.player.video || !playerManager.player.video.firstPhrase) {
            return false;
        }
        
        this.allWordGroups = [];
        
        let phrase = playerManager.player.video.firstPhrase;
        let index = 0;
        
        while (phrase) {
            // フレーズ全体のテキストを使用（記号類を除去）
            const cleanText = phrase.text.replace(/[「」『』、。？！?!.,\/#!$%\^\&\*;:{}=\-_`~()]/g, "").trim();
            
            if (cleanText) {
                this.allWordGroups.push({
                    index: index++,
                    text: cleanText,
                    startTime: phrase.startTime,
                    endTime: phrase.endTime,
                    phraseEndTime: phrase.endTime
                });
            }
            phrase = phrase.next;
        }
        
        this.allWordGroups.sort((a, b) => a.startTime - b.startTime);
        console.log(`[ORCHESTRA] Pre-cached ${this.allWordGroups.length} phrases.`);
        this.lyricsCacheBuilt = true;
        return true;
    }

    disposeSprite(sprite) {
        this.scene.remove(sprite);
        if (sprite.material.map) {
            sprite.material.map.dispose();
        }
        sprite.material.dispose();
        
        // Dispose child resources (like the glow halo)
        if (sprite.children) {
            sprite.children.forEach(child => {
                if (child.material) {
                    if (child.material.map && child.material.map !== this.glowTexture) {
                        child.material.map.dispose();
                    }
                    child.material.dispose();
                }
            });
        }
    }

    spawnText(lyricEntity, spawnTime) {
        // フレーズ単位なので同時出現数を最大5個に制限する
        const activeLyrics = this.activeSprites.filter(s => !s.userData.isNode);
        if (activeLyrics.length >= 5) {
            const oldest = activeLyrics[0];
            this.disposeSprite(oldest);
            
            const idx = this.activeSprites.indexOf(oldest);
            if (idx !== -1) {
                this.activeSprites.splice(idx, 1);
            }
        }

        const category = this.getWordCategory(lyricEntity.text);
        const { texture, aspect } = this.createTextTexture(lyricEntity.text, category);
        const material = new THREE.SpriteMaterial({ 
            map: texture, 
            color: new THREE.Color('#ffffff'), 
            transparent: true,
            opacity: 0,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(material);

        // Add glow halo child sprite if category is light or voice_echo
        if (category === 'light' || category === 'voice_echo') {
            const haloMat = new THREE.SpriteMaterial({
                map: this.glowTexture,
                color: new THREE.Color(category === 'light' ? '#ffea80' : '#ffffff'),
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const halo = new THREE.Sprite(haloMat);
            halo.scale.set(aspect * 1.5, 1.5, 1);
            sprite.add(halo);
        }
        
        // 歌詞の大きさは「その奥行きでの可視領域の高さ」に対する割合で決める。
        // 固定のワールドスケールだと、奥行き(向き)や画面サイズ・カメラ引き(サビ)で見かけの大きさが
        // バラつき小さくなりがち。可視高に対する割合にすることで、奥へ下げても・画面が変わっても
        // 画面上での大きさが一定になり、十分に読める大きさを保てる。
        const _layerZ = this._lyricLayerZ();
        const _fovRad = (this.camera ? this.camera.fov : 75) * Math.PI / 180;
        const _camZ = this.camera ? this.camera.position.z : 10;
        const _visH = 2.0 * Math.max(1, (_camZ - _layerZ)) * Math.tan(_fovRad / 2.0); // 歌詞奥行きでの可視高
        const _visW = _visH * (this.camera ? this.camera.aspect : 1.6);               // 同・可視幅
        const SIZE_FRAC = 0.085;            // スプライト高 = 可視高のこの割合(大きめ=読みやすい)
        const chorusBoost = this.isClimax ? 1.35 : 1.0;
        let scale = _visH * SIZE_FRAC * (0.95 + Math.random() * 0.1) * chorusBoost;
        // 横に長いフレーズが画面からはみ出さないよう、可視幅の90%に収まる高さでクランプする(見切れ防止)。
        const _maxScaleByWidth = (_visW * 0.9) / aspect;
        if (scale > _maxScaleByWidth) scale = _maxScaleByWidth;
        
        // Ensure camera matrices are updated before projecting
        if (this.camera) {
            this.camera.updateMatrixWorld(true);
            this.camera.updateProjectionMatrix();
        }
        
        // Dynamic screen-space collision checker
        const checkOverlap = (candidateX, candidateY, padH, padV, belowDist) => {
            const pos = new THREE.Vector3(candidateX, candidateY, -11.0); // Zを-11.0に引っ込めてカメラ被りを防止
            const ndc = pos.clone().project(this.camera);
            const screenX = (ndc.x * 0.5 + 0.5) * window.innerWidth;
            const screenY = (1 - (ndc.y * 0.5 + 0.5)) * window.innerHeight;
            
            const rightPos = pos.clone().add(new THREE.Vector3((scale * aspect) * 0.5, 0, 0));
            const rightNdc = rightPos.project(this.camera);
            const screenW = Math.abs(rightNdc.x - ndc.x) * window.innerWidth * 2;
            
            const topPos = pos.clone().add(new THREE.Vector3(0, scale * 0.5, 0));
            const topNdc = topPos.project(this.camera);
            const screenH = Math.abs(topNdc.y - ndc.y) * window.innerHeight * 2;
            
            for (let i = 0; i < this.activeSprites.length; i++) {
                const s = this.activeSprites[i];
                if (s.userData.isNode) continue;
                
                const otherPos = s.position.clone();
                const otherNdc = otherPos.project(this.camera);
                const otherX = (otherNdc.x * 0.5 + 0.5) * window.innerWidth;
                const otherY = (1 - (otherNdc.y * 0.5 + 0.5)) * window.innerHeight;
                
                const otherScale = s.userData.baseScale;
                const otherAspect = s.userData.aspect;
                
                const otherRightPos = otherPos.clone().add(new THREE.Vector3((otherScale * otherAspect) * 0.5, 0, 0));
                const otherRightNdc = otherRightPos.project(this.camera);
                const otherW = Math.abs(otherRightNdc.x - otherNdc.x) * window.innerWidth * 2;
                
                const otherTopPos = otherPos.clone().add(new THREE.Vector3(0, otherScale * 0.5, 0));
                const otherTopNdc = otherTopPos.project(this.camera);
                const otherH = Math.abs(otherTopNdc.y - otherNdc.y) * window.innerHeight * 2;
                
                const dx = Math.abs(screenX - otherX);
                const dy = Math.abs(screenY - otherY);
                
                const thresholdW = (screenW + otherW) * 0.5 + padH;
                const thresholdH = (screenH + otherH) * 0.5 + padV;
                
                if (dx < thresholdW && dy < thresholdH) {
                    return true; // Overlaps horizontally & vertically
                }
                
                // Prevent spawning directly below floating active sprites
                const horizOverlap = dx < (screenW + otherW) * 0.5 + 15;
                const isBelow = screenY > otherY; // larger Y in screen space is lower on screen
                if (horizOverlap && isBelow) {
                    const vertDist = screenY - otherY;
                    if (vertDist < belowDist) {
                        return true;
                    }
                }
            }
            return false;
        };
        
        // 画面アスペクト比とカメラの視野角から、3D空間における可視領域を動的に算出して出現候補を決定。
        // 距離は歌詞の実際の奥行き(_layerZ)基準にする(固定21だと、奥へ下げた今は可視領域がズレて見切れる)。
        const dist = _camZ - _layerZ;
        const fovRad = (this.camera.fov * Math.PI) / 180;
        const visibleHeight = 2.0 * dist * Math.tan(fovRad / 2.0);
        const visibleWidth = visibleHeight * this.camera.aspect;

        // 画面端だとタップしづらいので、出現範囲を中心寄りに絞る(半幅・半高を控えめに)。
        const halfW = visibleWidth * 0.26;  // 左右をより中央寄りに
        const halfH = visibleHeight * 0.24; // 上下をより中央寄りに

        const xCandidates = [];
        const yCandidates = [];
        const cols = 10;
        const rows = 8;

        for (let i = 0; i < cols; i++) {
            xCandidates.push(-halfW + (halfW * 2.0 * i) / (cols - 1));
        }
        for (let j = 0; j < rows; j++) {
            yCandidates.push(-halfH + (halfH * 2.0 * j) / (rows - 1));
        }
        
        let foundX = 0;
        let foundY = 0;
        // スポーン時から向きに応じた奥行きに置く(背面時はミクの奥)。
        // 常に-11で湧かせると、背面時でも一瞬だけミクより手前に見えて背中を貫通するため。
        let spawnZ = this._lyricLayerZ();
        let found = false;
        
        // Search passes with decreasing padding strictly to find optimal non-overlapping spots
        const passes = [
            { padH: 60, padV: 60, below: 240 },
            { padH: 35, padV: 40, below: 140 },
            { padH: 15, padV: 20, below: 70 },
            { padH: 0,  padV: 0,  below: 0 }
        ];
        
        for (const pass of passes) {
            const shuffledX = [...xCandidates].sort(() => Math.random() - 0.5);
            const shuffledY = [...yCandidates].sort(() => Math.random() - 0.5);
            
            for (const cy of shuffledY) {
                for (const cx of shuffledX) {
                    if (!checkOverlap(cx, cy, pass.padH, pass.padV, pass.below)) {
                        foundX = cx;
                        foundY = cy;
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
            if (found) {
                console.log(`[ORCHESTRA] Spawned "${lyricEntity.text}" at (${foundX.toFixed(2)}, ${foundY.toFixed(2)}) using pass (H:${pass.padH}, V:${pass.padV})`);
                break;
            }
        }
        
        if (!found) {
            // Absolute backup fallback — 可視領域内にランダム配置
            foundX = (Math.random() - 0.5) * visibleWidth * 0.42;
            foundY = (Math.random() - 0.5) * visibleHeight * 0.42;
            console.warn(`[ORCHESTRA] Fallback spawning "${lyricEntity.text}" at (${foundX.toFixed(2)}, ${foundY.toFixed(2)})`);
        }

        // スプライト全体が画面内に収まるよう最終クランプ(左右/上下の見切れ防止)。
        const _hw = (scale * aspect) * 0.5, _hh = scale * 0.5;
        const _maxX = Math.max(0, visibleWidth * 0.5 - _hw - 0.3);
        const _maxY = Math.max(0, visibleHeight * 0.5 - _hh - 0.3);
        foundX = Math.max(-_maxX, Math.min(_maxX, foundX));
        foundY = Math.max(-_maxY, Math.min(_maxY, foundY));

        sprite.position.set(foundX, foundY, spawnZ);
        const birthTime = lyricEntity.startTime !== undefined ? lyricEntity.startTime : spawnTime;
        const duration = lyricEntity.endTime !== undefined ? (lyricEntity.endTime - lyricEntity.startTime) : 2500;
        const lifeTime = duration + (category === 'future_memory' ? 2500 : 800);
        const marchDirection = Math.random() < 0.5 ? -1 : 1;

        sprite.userData = { 
            birth: birthTime, 
            life: lifeTime,
            text: lyricEntity.text,
            category: category,
            baseScale: scale,
            aspect: aspect,
            groupIndex: lyricEntity.index, // Store the index of the word group
            baseY: foundY,
            marchDirection: marchDirection
        };
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    // 歌詞レイヤーのワールドZ(奥行き)をミクの向きに連動して返す。
    // ミクは背面(夜空を見上げる)/サビで正面(客席)に回頭する。背面のあいだは、
    // ミクの体・髪の奥行き(実測: 後端がホーム位置で約Z=-14.5、ツインテールの揺れでさらに奥)を
    // 確実に超える -17 に置き、背中を貫通させない。正面化(_faceFront)が0.7を超えてから手前(-11)へ
    // 寄せ、サビでは大きく読ませる。z自体はスポーン/毎フレームのlerpで滑らかに反映する。
    // ミクの実際のワールドZ範囲(_mikuZMin=最奥 / _mikuZMax=最前=カメラ側)を毎フレーム更新する。
    // 各メッシュのローカルAABBの8隅をワールドへ変換してz範囲を取る(頂点全走査より軽量)。
    // 体・ツインテールの張り出しまで含めるので、これを基準にすれば歌詞を確実にミクより手前/奥へ置ける。
    _updateMikuZExtent() {
        const vrm = this.currentVRM;
        if (!vrm || !vrm.scene) return;
        // タップ中はミクが歌詞へ前後に寄るため、その一時的な位置でbboxを取ると他の歌詞の奥行きが
        // 一瞬変わってしまう。タップ中は直前(静止時)の範囲を据え置き、歌詞の奥行きを安定させる。
        if (this.tapAnimation) return;
        let zmin = Infinity, zmax = -Infinity;
        const v = this._scratchVZ || (this._scratchVZ = new THREE.Vector3());
        vrm.scene.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            let bb = o.geometry.boundingBox;
            if (!bb) { o.geometry.computeBoundingBox(); bb = o.geometry.boundingBox; }
            if (!bb) return;
            const m = o.matrixWorld;
            for (let xi = 0; xi < 2; xi++)
                for (let yi = 0; yi < 2; yi++)
                    for (let zi = 0; zi < 2; zi++) {
                        v.set(xi ? bb.max.x : bb.min.x, yi ? bb.max.y : bb.min.y, zi ? bb.max.z : bb.min.z).applyMatrix4(m);
                        if (v.z < zmin) zmin = v.z;
                        if (v.z > zmax) zmax = v.z;
                    }
        });
        if (zmin <= zmax) { this._mikuZMin = zmin; this._mikuZMax = zmax; }
    }

    // 歌詞レイヤーのワールドZを、ミクの実Z範囲に対して常に手前/奥になるよう返す。
    // 正面(サビ)時はミクの最前(_mikuZMax)よりさらに手前(カメラ側)、背面時は最奥(_mikuZMin)よりさらに奥へ。
    // 固定値だとミクの位置・姿勢の変動で前後関係が崩れる(=甘い)ため、実測Z範囲に追従させる。
    _lyricLayerZ() {
        const ff = this._faceFront || 0;
        const zmin = (this._mikuZMin !== undefined) ? this._mikuZMin : -14.5; // ミクの最奥
        const zmax = (this._mikuZMax !== undefined) ? this._mikuZMax : -8.5;  // ミクの最前(カメラ側)
        const MARGIN = 1.8;                 // 確実に前後へ抜けるための余白
        const behindZ = zmin - MARGIN;      // 背面: ミクの最奥よりさらに奥
        const frontZ = zmax + MARGIN;       // 正面(サビ): ミクの最前よりさらに手前
        const t = Math.max(0, Math.min(1, (ff - 0.5) / 0.2)); // 正面度0.5→0.7で手前へ切替
        return behindZ + (frontZ - behindZ) * t;
    }

    // 歌詞スプライト同士の重なり解消(二重表示の防止)。
    // ワールド空間のAABBで重なりを判定し、重なったペアを縦方向へ少しずつ押し分ける。
    // 配置時のcheckOverlapだけでは、漂い(drift)やサビの加速で後から接近したペアを救えないため、
    // 毎フレームの連続的な分離で「別フレーズが同じ行に重なって読めない」状態を解消する。
    _separateOverlappingLyrics() {
        const arr = this.activeSprites.filter(
            s => s && !s.userData.isNode && s.userData.text && !s.userData.isBeingTapped
        );
        const PAD_X = 0.3;   // 横の余白(これ未満まで近づいたら重なり扱い)
        const PAD_Y = 0.28;  // 縦の最小すき間
        const MAX_PUSH = 0.07; // 1フレームの最大移動量(急に弾かず滑らかに分離)
        for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
                const a = arr[i], b = arr[j];
                const aHalfW = (a.userData.baseScale * a.userData.aspect) * 0.5;
                const aHalfH = a.userData.baseScale * 0.5;
                const bHalfW = (b.userData.baseScale * b.userData.aspect) * 0.5;
                const bHalfH = b.userData.baseScale * 0.5;
                const dx = Math.abs(a.position.x - b.position.x);
                const dyRaw = a.position.y - b.position.y;
                const overlapX = (aHalfW + bHalfW + PAD_X) - dx;
                const overlapY = (aHalfH + bHalfH + PAD_Y) - Math.abs(dyRaw);
                if (overlapX > 0 && overlapY > 0) {
                    // 縦に分離(重なり量の半分ずつ)。同一yに重なった場合は決定的な向きで割る。
                    const push = Math.min(overlapY * 0.5, MAX_PUSH);
                    const dir = dyRaw === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(dyRaw);
                    a.position.y += dir * push;
                    b.position.y -= dir * push;
                    if (a.userData.baseY !== undefined) a.userData.baseY += dir * push;
                    if (b.userData.baseY !== undefined) b.userData.baseY -= dir * push;
                }
            }
        }
    }

    onClick(event) {
        // ミクが現在歌詞へ移動中・タップ動作中の場合はタップ操作をロック
        if (this.tapAnimation) {
            return;
        }

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, this.camera);

        // ─── イントロ: タイトル文字のタップ(→オーブ化) ───
        // 歌詞より先に判定し、ふれた文字をその場でオーブへ変える。
        if (this.introTitleSprites.length) {
            const tHit = raycaster.intersectObjects(this.introTitleSprites);
            if (tHit.length > 0) {
                this._resonateIntroTitle(tHit[0].object, false);
                return;
            }
        }

        // ─── 歌詞共鳴タップ ───
        // アクティブな歌詞スプライトに対するクリック判定を行う
        const intersects = raycaster.intersectObjects(this.activeSprites);

        if (intersects.length > 0) {
            // 一番手前にある歌詞スプライトを取得
            const hitSprite = intersects[0].object;
            
            // 既にタップ中の場合は二重処理防止
            if (hitSprite.userData.isBeingTapped) {
                return;
            }
            
            if (this.currentVRM && this.relaxedQuaternions) {
                this.triggerMikuTap(hitSprite);
            } else {
                // VRM読み込み完了前のフォールバック（直接昇華）
                this.resonateLyricColor(hitSprite);
            }
            return; // 歌詞がクリックされた場合は、通常の波紋パーティクル生成は行わない
        }

    }

    getSemanticColor(text) {
        // 歌詞の意味・感情に応じた固定色のマッピング定義
        const colorRules = [
            {
                hex: '#00d4ff', // 深宇宙サファイア（青・空・天・水）
                keywords: ['青', 'あお', '空', '海', '深', '涙', '雨', '水', '宙', 'そら', 'ブルー', '天']
            },
            {
                hex: '#ff3b5c', // 夕焼けルビー（赤・夕・陽・火・心臓）
                keywords: ['赤', 'あか', '夕', '陽', '火', '熱', '血', '燃', '朱', 'ハート', 'レッド', '心臓']
            },
            {
                hex: '#ffb834', // 琥珀ゴールド（金・星・光・朝・黄）
                keywords: ['金', '黄', 'きいろ', '星', '光', '朝', '輝', 'ゴールド', 'イエロー', '灯', '瞬', '隊']
            },
            {
                hex: '#00ffb0', // 極光エメラルド（緑・風・生・命）
                keywords: ['緑', 'みどり', '葉', '森', '風', '芽', '生', '陸', 'グリーン', '野', '草', '命']
            },
            {
                hex: '#d95bff', // 宵闇アメジスト（紫・夜・闇・死・最後）
                keywords: ['紫', 'むらさき', '夜', '闇', '宵', '影', '死', '終', '幕', 'アメジスト', 'パープル', '最後']
            },
            {
                hex: '#ffffff', // 純白（白・音・歌・声）
                keywords: ['白', 'しろ', '雪', '無', '明', '真', '純', '音', '歌', '唄', '響', 'ホワイト', '声']
            }
        ];

        // 歌詞テキストにキーワードが含まれるか判定
        for (const rule of colorRules) {
            if (rule.keywords.some(kw => text.includes(kw))) {
                return rule.hex;
            }
        }
        return null; // 該当なし
    }

    resonateLyricColor(sprite, intersectPoint) {
        const text = sprite.userData.text || '';
        const semanticHex = this.getSemanticColor(text);
        let nextColorHex;

        if (semanticHex) {
            nextColorHex = semanticHex;
            console.log(`[ORCHESTRA] Semantic color match: "${text}" -> ${semanticHex}`);
        } else {
            // 意味キーワードに該当しない場合は、カラーパレットからランダムで選択して多様性を出す
            const ORCHESTRA_COLORS = ['#ffffff', '#ffb834', '#ff3b5c', '#00d4ff', '#00ffb0', '#d95bff'];
            nextColorHex = ORCHESTRA_COLORS[Math.floor(Math.random() * ORCHESTRA_COLORS.length)];
            console.log(`[ORCHESTRA] No semantic color match. Random fallback: "${text}" -> ${nextColorHex}`);
        }
        
        this.currentColor = nextColorHex;
        localStorage.setItem('orchestra_color', this.currentColor);
        this.hasResonatedColor = true; // カラー変更体験済みフラグ
        this.dismissFirstInteractable(); // 初回の色共鳴で誘導ガイドを片付ける

        const newColor = new THREE.Color(this.currentColor);

        // 1. 歌詞はオーブになったら消える (Remove clicked lyric immediately)
        if (sprite.userData && typeof sprite.userData.groupIndex === 'number') {
            this.sublimatedGroupIndices.add(sprite.userData.groupIndex);
        }
        this.disposeSprite(sprite);
        const idx = this.activeSprites.indexOf(sprite);
        if (idx !== -1) {
            this.activeSprites.splice(idx, 1);
        }


        // 2. 「共鳴オーブ（光の精霊）」の生成と蓄積 (Proposal 4 - Accumulation)
        // 最大120個までにクランプしてパフォーマンスを維持
        if (this.resonateOrbs.length >= 120) {
            const oldOrb = this.resonateOrbs.shift();
            this.scene.remove(oldOrb);
            if (oldOrb.material) oldOrb.material.dispose();
        }

        const orbMat = new THREE.MeshBasicMaterial({ 
            color: newColor, 
            transparent: true, 
            opacity: 0.85
        });
        const orb = new THREE.Mesh(this.orbGeometry, orbMat);
        
        // Add glowing additive halo to the orb (オーブの発光エフェクト追加)
        if (this.glowTexture) {
            const haloMat = new THREE.SpriteMaterial({
                map: this.glowTexture,
                color: newColor,
                transparent: true,
                opacity: 0.95,
                blending: THREE.AdditiveBlending, // 加算ブレンドで眩しく発光
                depthWrite: false
            });
            const halo = new THREE.Sprite(haloMat);
            halo.scale.set(0.65, 0.65, 1.0); // オーブ本体（半径0.12）より一回り大きくして光芒を表現
            orb.add(halo);
        }
        
        // タップされた歌詞の位置からスポーン
        orb.position.copy(sprite.position);
        
        // 軌道パラメータの初期化
        orb.userData = {
            color: newColor,
            angle: Math.random() * Math.PI * 2,
            radius: 3.2 + Math.random() * 2.2, // カメラからの周回半径
            speed: 0.015 + Math.random() * 0.015,
            yBase: (Math.random() - 0.5) * 3.5,
            phase: Math.random() * Math.PI * 2,
            isExploded: false
        };

        this.scene.add(orb);
        this.resonateOrbs.push(orb);

        // オーブ化の瞬間に「これが後で花火になる」予兆として、尾を引く小さな光芒を放つ
        this.spawnOrbBirthFlare(newColor, orb.position);

        // 蓄積の可視化: 左端のオーブゲージへ色の層を積み、成果サマリーを更新
        this.collectedColors.push(nextColorHex);
        this.totalCollectedCount++;
        this.addOrbToGauge(nextColorHex);
        this.updateResultSummary();

        // (オーブ生成ごとの説明ポップアップは廃止。操作はイントロの誘導で十分に伝わるため、
        //  本編では蓄積の手応えをゲージ・花火・発光だけで返し、視界を歌詞と夜空に集中させる。)
    }

    // サビ花火の大きさ(intensity)をゲージの溜まり具合で決める。
    // ゲージが空に近い=小さな花火 / 満タン(GAUGE_CAPACITY=16)=大輪、と線形に対応させる。
    // chorusOrbCount はサビ突入時に集めていたオーブ数(=ゲージの高さ)。
    _chorusFireworkIntensity() {
        const ratio = Math.min(1, (this.chorusOrbCount || 0) / this.GAUGE_CAPACITY);
        return 0.4 + ratio * (2.2 - 0.4); // 0.4(小) 〜 2.2(大)
    }

    /**
     * 色彩交響花火の生成。intensity(蓄積オーブ数に比例)で
     * 粒子数・拡散速度・粒子サイズが変化する。
     * intensity=1.0 が従来規模、0.35前後=控えめな単発、2.2=大輪。
     */
    spawnCustomColorFirework(color, targetPos, intensity = 1.0) {
        // 一斉に多数上がるため、SEは短間隔でスロットルして鳴らし過ぎを防ぐ
        const _now = (performance && performance.now) ? performance.now() : Date.now();
        if (!this._lastFireworkSfx || _now - this._lastFireworkSfx > 130) {
            this._lastFireworkSfx = _now;
            sfx.play('orchestra_firework');
        }
        const clamped = Math.min(2.4, Math.max(0.3, intensity));
        const isMobile = window.innerWidth < 768;
        const geo = new THREE.BufferGeometry();
        const baseCount = isMobile ? 110 : 180; // モバイルは粒子数を抑えて負荷軽減
        const count = Math.round(baseCount * clamped); // 蓄積数に比例した密度
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            positions[i*3] = targetPos.x;
            positions[i*3+1] = targetPos.y;
            positions[i*3+2] = targetPos.z;

            // 全方位球状拡散ベクトル（2倍大きく広がるよう初期爆発速度を倍増）
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const speed = (0.95 + Math.random() * 1.0) * (0.7 + clamped * 0.3); // 蓄積数に比例して大きく開く
            velocities.push(new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.sin(phi) * Math.sin(theta) * speed + 0.04, // わずかな上昇バイアス
                Math.cos(phi) * speed
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: color,
            size: 0.50 * (0.75 + clamped * 0.25), // 蓄積数に比例して粒も大きく
            map: this.glowTexture, // 加算合成のぼかし発光テクスチャを割り当て
            blending: THREE.AdditiveBlending, // 加算合成で火花同士が重なるとより明るく輝く
            transparent: true, 
            opacity: 1.0,
            depthWrite: false
        });
        const particles = new THREE.Points(geo, mat);
        particles.userData = { velocities, birth: Date.now() };
        this.scene.add(particles);
        this.fireworks.push(particles);
    }

    // ─── オーブゲージ（蓄積の可視化）DOM ───

    initOrbGauge() {
        const isMobile = window.innerWidth < 768;
        if (!document.getElementById('orchestra-orb-gauge-style')) {
            const style = document.createElement('style');
            style.id = 'orchestra-orb-gauge-style';
            style.textContent = `
                .orchestra-orb-gauge { position:absolute; left:${isMobile ? 8 : 16}px; top:50%; transform:translateY(-50%); width:${isMobile ? 12 : 16}px; height:${isMobile ? '36vh' : '46vh'}; z-index:150; pointer-events:none; display:flex; flex-direction:column; align-items:center; }
                .orchestra-orb-gauge-count { font:600 ${isMobile ? 10 : 12}px/1.4 "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif; color:rgba(255,255,255,0.88); letter-spacing:0.08em; margin-bottom:6px; text-shadow:0 0 6px rgba(0,0,0,0.85); white-space:nowrap; }
                .orchestra-orb-gauge-tube { position:relative; flex:1 1 auto; width:100%; border:1px solid rgba(255,255,255,0.25); border-radius:8px; background:rgba(8,8,30,0.55); overflow:hidden; box-shadow:inset 0 0 12px rgba(24,95,165,0.35); }
                .orchestra-orb-gauge-fill { position:absolute; bottom:0; left:0; width:100%; height:0%; display:flex; flex-direction:column-reverse; transition:height 0.45s cubic-bezier(0.22,1,0.36,1); }
                .orchestra-orb-gauge-layer { flex:1 1 0; min-height:2px; width:100%; opacity:0.92; box-shadow:0 0 6px currentColor; animation:orchestra-orb-layer-in 0.5s ease; }
                @keyframes orchestra-orb-layer-in { from { opacity:0; filter:brightness(2.4); } to { opacity:0.92; filter:brightness(1); } }
                .orchestra-orb-gauge-label { writing-mode:vertical-rl; font:500 ${isMobile ? 9 : 10}px/1 "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif; color:rgba(255,255,255,0.55); letter-spacing:0.22em; margin-top:8px; text-shadow:0 0 6px rgba(0,0,0,0.85); }
                .orchestra-orb-gauge-burst .orchestra-orb-gauge-tube { animation:orchestra-orb-gauge-flash 0.7s ease; }
                @keyframes orchestra-orb-gauge-flash { 0% { box-shadow:inset 0 0 12px rgba(24,95,165,0.35); } 30% { box-shadow:0 0 26px rgba(255,255,255,0.95); border-color:#fff; } 100% { box-shadow:inset 0 0 12px rgba(24,95,165,0.35); } }
                /* ゲージ満タン手前の「もうすぐ花火」期待を可視化する脈動発光 */
                .orchestra-orb-gauge-charged .orchestra-orb-gauge-tube { animation:orchestra-orb-gauge-charge 1.4s ease-in-out infinite; border-color:rgba(255,255,255,0.6); }
                @keyframes orchestra-orb-gauge-charge { 0%,100% { box-shadow:inset 0 0 12px rgba(24,95,165,0.35), 0 0 8px rgba(255,255,255,0.25); } 50% { box-shadow:inset 0 0 16px rgba(120,180,255,0.6), 0 0 22px rgba(255,255,255,0.7); } }
                .orchestra-orb-gauge-charged .orchestra-orb-gauge-count { color:#fff; text-shadow:0 0 10px rgba(180,220,255,0.95); }
                /* 満タン時: 光がゲージの周りを一周して「溜まりきった」手応えを出す */
                .orchestra-orb-gauge-full .orchestra-orb-gauge-tube { animation:orchestra-orb-gauge-full 1.5s linear infinite; border-color:#fff; }
                @keyframes orchestra-orb-gauge-full {
                    0%   { box-shadow:inset 0 0 18px rgba(200,230,255,0.85), 0 -13px 22px rgba(255,255,255,0.9); }
                    25%  { box-shadow:inset 0 0 20px rgba(210,235,255,0.9), 15px 0 22px rgba(255,255,255,0.9); }
                    50%  { box-shadow:inset 0 0 20px rgba(220,240,255,0.95), 0 13px 22px rgba(255,255,255,0.9); }
                    75%  { box-shadow:inset 0 0 20px rgba(210,235,255,0.9), -15px 0 22px rgba(255,255,255,0.9); }
                    100% { box-shadow:inset 0 0 18px rgba(200,230,255,0.85), 0 -13px 22px rgba(255,255,255,0.9); }
                }
                .orchestra-orb-gauge-full .orchestra-orb-gauge-count { color:#fff; text-shadow:0 0 14px rgba(200,235,255,1); }
                .orchestra-orb-gauge-full .orchestra-orb-gauge-label { color:rgba(255,255,255,0.92); text-shadow:0 0 10px rgba(200,235,255,0.9); }
                /* 開幕の予兆: まだ何も集めていない序盤、ゲージ管が薄く脈動して「ここに色が溜まる」ことを予感させる */
                .orchestra-orb-gauge-intro .orchestra-orb-gauge-tube { animation:orchestra-orb-gauge-introglow 2.4s ease-in-out infinite; }
                @keyframes orchestra-orb-gauge-introglow { 0%,100% { box-shadow:inset 0 0 12px rgba(24,95,165,0.35); } 50% { box-shadow:inset 0 0 18px rgba(24,95,165,0.65), 0 0 12px rgba(80,150,220,0.4); } }
            `;
            document.head.appendChild(style);
        }

        const gauge = document.createElement('div');
        gauge.className = 'orchestra-orb-gauge';
        gauge.innerHTML = `
            <div class="orchestra-orb-gauge-count">0</div>
            <div class="orchestra-orb-gauge-tube"><div class="orchestra-orb-gauge-fill"></div></div>
            <div class="orchestra-orb-gauge-label">共鳴オーブ</div>
        `;
        gauge.classList.add('orchestra-orb-gauge-intro'); // 開幕の予兆脈動（操作 or 時間切れで解除）
        this.songWrapper.appendChild(gauge);
        this.orbGaugeEl = gauge;
        this.orbGaugeFillEl = gauge.querySelector('.orchestra-orb-gauge-fill');
        this.orbGaugeCountEl = gauge.querySelector('.orchestra-orb-gauge-count');
    }

    // 集めたオーブの色を1層としてゲージに積む
    addOrbToGauge(hex) {
        if (!this.orbGaugeFillEl) return;
        const layer = document.createElement('div');
        layer.className = 'orchestra-orb-gauge-layer';
        layer.style.background = hex;
        layer.style.color = hex; // box-shadow の currentColor 発光用
        this.orbGaugeFillEl.appendChild(layer);

        const n = this.orbGaugeFillEl.children.length;
        this.orbGaugeFillEl.style.height = `${Math.min(100, (n / this.GAUGE_CAPACITY) * 100)}%`;
        if (this.orbGaugeCountEl) this.orbGaugeCountEl.textContent = String(n);

        // 75%超で「もうすぐ花火」の脈動、満タンで光が一周する演出に切り替えて手応えを出す
        if (this.orbGaugeEl) {
            const full = n >= this.GAUGE_CAPACITY;
            const charged = n >= Math.ceil(this.GAUGE_CAPACITY * 0.75) && !full;
            this.orbGaugeEl.classList.toggle('orchestra-orb-gauge-charged', charged);
            this.orbGaugeEl.classList.toggle('orchestra-orb-gauge-full', full);
        }
    }

    // サビでオーブを消費した瞬間にゲージをフラッシュ→空にして「次のサビへまた集める」ループを作る
    resetOrbGauge(consumedCount) {
        if (!this.orbGaugeEl) return;
        clearTimeout(this._gaugeResetTimer);
        this.orbGaugeEl.classList.remove('orchestra-orb-gauge-charged'); // 消費したら期待発光を解除
        this.orbGaugeEl.classList.remove('orchestra-orb-gauge-full');    // 満タン演出も解除
        if (consumedCount > 0) {
            this.orbGaugeEl.classList.add('orchestra-orb-gauge-burst');
        }
        this._gaugeResetTimer = setTimeout(() => {
            if (!this.orbGaugeEl) return;
            this.orbGaugeEl.classList.remove('orchestra-orb-gauge-burst');
            if (this.orbGaugeFillEl) {
                this.orbGaugeFillEl.style.height = '0%';
                while (this.orbGaugeFillEl.firstChild) {
                    this.orbGaugeFillEl.removeChild(this.orbGaugeFillEl.firstChild);
                }
            }
            if (this.orbGaugeCountEl) this.orbGaugeCountEl.textContent = '0';
        }, consumedCount > 0 ? 700 : 0);
    }

    // ─── 成果サマリー（集めた音色の混色 = あなたの空の色）───

    mixCollectedColors() {
        if (!this.collectedColors.length) return '#185FA5';
        let r = 0, g = 0, b = 0;
        this.collectedColors.forEach(hex => {
            const c = new THREE.Color(hex);
            r += c.r; g += c.g; b += c.b;
        });
        const n = this.collectedColors.length;
        const mixed = new THREE.Color(r / n, g / n, b / n);
        return `#${mixed.getHexString()}`;
    }

    updateResultSummary() {
        this.setResultSummary({
            lines: [`集めた音色 ${this.totalCollectedCount} ・ あなたの空の色`],
            accentColor: '#185FA5',
            swatch: this.mixCollectedColors()
        });
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        // TextAlive公式タイマー(player.timer.position)に完全同期（先行調整を排除）
        const position = (playerManager.player && playerManager.player.timer)
                         ? playerManager.player.timer.position
                         : this.getSmoothedTime();
                         
        // Clear sublimated indices on backwards seek or loop
        if (position < this.lastPosition - 1000) {
            this.sublimatedGroupIndices.clear();
        }
        this.lastPosition = position;
        
        // --- Main Lyric Update ---
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase) {
            if (this.mainLyricEl) {
                this.mainLyricEl.textContent = phrase.text;
                this.mainLyricEl.style.opacity = '1';
                this.mainLyricEl.style.transform = 'translateX(-50%) translateY(0)';
            }
        } else {
            if (this.mainLyricEl) {
                this.mainLyricEl.style.opacity = '0';
                this.mainLyricEl.style.transform = 'translateX(-50%) translateY(10px)';
            }
        }
        
        // --- Climax (Chorus) logic ---
        const chorus = playerManager.player.findChorus(position);
        this.isClimax = !!chorus || position > 180000; // fallback climax at 3min

        // --- ミクの向き(0=背面で夜空を見上げる / 1=正面で客席=ユーザーを向く) ---
        // このVRMは rotation.y=π が正面、0 が背面。通常は背を向け、サビ(クライマックス)で滑らかに回頭する。
        // この値は本体の回頭(baseMikuRotY)と、歌詞レイヤーの奥行き(背面時はミクより奥)に使う。
        const faceTarget = this.isClimax ? 1 : 0;
        if (this._faceFront === undefined) this._faceFront = 0;
        this._faceFront += (faceTarget - this._faceFront) * 0.05;
        this.baseMikuRotY = this._faceFront * Math.PI;

        // サビで「画面全体が変わる」演出量。突入で素早く開き、抜けると緩やかに閉じる(軸6)
        const chorusOpenTarget = this.isClimax ? 1.0 : 0.0;
        this._chorusOpen += (chorusOpenTarget - this._chorusOpen) * (this.isClimax ? 0.06 : 0.03);
        const open = this._chorusOpen;

        if (this.isClimax) {
            // カメラを軽く引きつつ、わずかに上(夜空)を仰がせて空が一段開く感覚を出す
            this.camera.position.z += (16 - this.camera.position.z) * 0.012;
            this.camera.position.y += ((1.4 * open) - this.camera.position.y) * 0.03;
            this.camera.rotation.x += ((0.06 * open) - this.camera.rotation.x) * 0.03;
            this.stars.rotation.y += 0.002;
        } else {
            // 通常時はカメラをホーム(z=10,y=0,無回転)へ滑らかに戻す
            this.camera.position.z += (10 - this.camera.position.z) * 0.02;
            this.camera.position.y += (0 - this.camera.position.y) * 0.03;
            this.camera.rotation.x += (0 - this.camera.rotation.x) * 0.03;
            this.stars.rotation.y += 0.0005;

            // Smoothly fade star color back to white when not in climax
            if (this.starMaterial && this.starMaterial.color) {
                const c = this.starMaterial.color;
                c.r += (1.0 - c.r) * 0.05;
                c.g += (1.0 - c.g) * 0.05;
                c.b += (1.0 - c.b) * 0.05;
            }
        }

        // 背景色: サビで一段明るい夜明け前の藍へ開き、抜けると深宇宙の闇へ戻す
        if (this.scene && this.scene.background) {
            const bg = this.scene.background;
            const tr = 0.0196 + 0.055 * open;
            const tg = 0.0196 + 0.075 * open;
            const tb = 0.0627 + 0.140 * open;
            bg.r += (tr - bg.r) * 0.05;
            bg.g += (tg - bg.g) * 0.05;
            bg.b += (tb - bg.b) * 0.05;
        }
        if (this.scene && this.scene.fog) {
            const fg = this.scene.fog.color;
            fg.r += (0.0196 - fg.r) * 0.05;
            fg.g += (0.0196 - fg.g) * 0.05;
            fg.b += (0.0627 - fg.b) * 0.05;
        }

        // --- Night sky ambience (twinkle / milky way / aurora) ---
        this.updateNightSky(position, open);

        // --- 序盤の予兆オーブ(開幕の無音地帯を埋める。操作 or イントロ終端で自然に畳む) ---
        this.updatePremonitionOrbs(position);

        // --- イントロのタイトル/作者/遊び方(歌詞が始まる前に世界観と操作を提示) ---
        this.updateIntroTitle(position);

        // --- 3D Lyrics logic (Pre-cached Word-Group granularity for rhythmic touch interaction) ---
        if (!this.lyricsCacheBuilt) {
            this.buildLyricsCache();
        }

        if (this.lyricsCacheBuilt) {
            // Filter groups that should be visible on screen.
            // 歌詞同期の詰め: スプライトは発話の少し前に出してタップ猶予を作るが、
            // サビは語句の入れ替わりが速いためリード(LEAD)を短くして「発話とぴったり」感を高める。
            // 実視認はスプライトの birth=startTime からの150msフェードインで揃うため、
            // ここでのリードは出現タイミング(=タップ可能になる先読み量)の調整。
            const LEAD = this.isClimax ? 150 : 250; // サビは短め(8→9の同期詰め)
            let activeGroups = this.allWordGroups.filter(g => {
                const category = this.getWordCategory(g.text);
                const extraLife = category === 'future_memory' ? 2500 : 800;
                return position >= g.startTime - LEAD && position <= g.endTime + extraLife;
            });

            // Deduplicate activeGroups by text if their startTimes are extremely close (duet/unison overlaps within 200ms)
            // Single-pass O(n): group accepted startTimes by text. A group is a duplicate
            // only if a previously-accepted group with identical text has a startTime within 200ms.
            const acceptedTimesByText = new Map();
            activeGroups = activeGroups.filter(g => {
                const cleanText = g.text.trim();
                if (!cleanText) return false;

                let times = acceptedTimesByText.get(cleanText);
                if (times) {
                    for (let t = 0; t < times.length; t++) {
                        if (Math.abs(times[t] - g.startTime) < 200) {
                            return false;
                        }
                    }
                    times.push(g.startTime);
                } else {
                    acceptedTimesByText.set(cleanText, [g.startTime]);
                }
                return true;
            });


            // Remove out-of-bounds sprites immediately to keep the scene clean and release resources
            for (let i = this.activeSprites.length - 1; i >= 0; i--) {
                const s = this.activeSprites[i];
                if (s.userData.isNode) continue; // Skip constellation nodes

                const groupIndex = s.userData.groupIndex;
                const isStillActive = activeGroups.some(g => g.index === groupIndex);
                if (!isStillActive) {
                    this.disposeSprite(s);
                    this.activeSprites.splice(i, 1);
                }
            }

            // Spawn missing active sprites
            activeGroups.forEach(g => {
                if (this.sublimatedGroupIndices.has(g.index)) {
                    return; // Skip if it has already been clicked and sublimated!
                }
                
                // Track by exact groupIndex to prevent clicked lyrics from reappearing,
                // but do NOT block same-text consecutive words (like 'イロ') from spawning in sequence.
                const exists = this.activeSprites.some(s => s.userData.groupIndex === g.index);
                if (!exists) {
                    this.spawnText(g, position);
                }
            });
        }

        // Update sprites
        const currentWord = playerManager.player.video.findWord(position);
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const s = this.activeSprites[i];
            
            // 星座ノードの残骸チェックがあればスキップ
            if (s.userData.isNode) continue;

            // 現在歌唱中の単語とスプライトの文字が一致するかチェックし、歌唱パルス（バウンド拡大）をトリガー
            const isWordActive = currentWord && s.userData.text && s.userData.text.includes(currentWord.text) 
                              && position >= currentWord.startTime && position <= currentWord.endTime;
            if (!s.userData.pulseProgress) s.userData.pulseProgress = 0;
            const targetPulse = isWordActive ? 1.0 : 0.0;
            s.userData.pulseProgress += (targetPulse - s.userData.pulseProgress) * 0.2;
            const pulse = s.userData.pulseProgress;
            const pulseScaleFactor = 1.0 + pulse * 0.25; // 1.25倍バウンド

            // 出現演出: 「光が集まって文字が現れる」よう、誕生直後(350ms)に
            // わずかに小さい状態から実寸へ膨らませて立ち上がりの印象を強める。
            const birthAge = Math.max(0, position - s.userData.birth);
            const birthGrow = birthAge < 350 ? (0.78 + 0.22 * (birthAge / 350)) : 1.0;
            const scaleFactor = pulseScaleFactor * birthGrow;

            const baseScale = s.userData.baseScale || 2.0;
            const aspect = s.userData.aspect || 8.0;
            s.scale.set(baseScale * aspect * scaleFactor, baseScale * scaleFactor, 1);
            
            // 歌唱中は純白にフラッシュさせて光らせる
            s.material.color.setRGB(1.0, 1.0 - pulse * 0.3, 1.0 - pulse * 0.3);

            if (s.userData.isBeingTapped) {
                // タップ中は位置をフリーズし、不透明度を維持する
                s.material.opacity = 1.0;
            } else {
                // --- Category-specific Movement Animations ---
                const category = s.userData.category || 'default';
                
                if (category === 'sky_color') {
                    s.position.y += 0.0045; // Slow float up
                    s.position.x += Math.sin(position * 0.0006 + s.position.y) * 0.003;
                } else if (category === 'machine') {
                    s.position.y += 0.007;
                    s.position.x += Math.sin(position * 0.0006 + s.position.y) * 0.003;
                    // Occasional horizontal glitch offsets
                    if (Math.random() < 0.08) {
                        s.position.x += (Math.random() - 0.5) * 0.05;
                    }
                } else if (category === 'music_march') {
                    // Beat-synced sinusoidal vertical bounce & horizontal slide
                    const beat = playerManager.player ? playerManager.player.findBeat(position) : null;
                    let beatProgress = 0;
                    if (beat && beat.duration > 0) {
                        beatProgress = Math.min(1.0, Math.max(0.0, (position - beat.startTime) / beat.duration));
                    }
                    const bounceHeight = 0.08;
                    const bounceY = Math.sin(beatProgress * Math.PI) * bounceHeight;
                    
                    // Keep updating the vertical baseline
                    s.userData.baseY += 0.004;
                    s.position.y = s.userData.baseY + bounceY;
                    
                    // March direction sliding
                    const marchDir = s.userData.marchDirection || 1;
                    s.position.x += marchDir * 0.008;
                } else if (category === 'sadness') {
                    s.position.y += 0.005; // Slow rise
                    // Shiver (shake) text
                    s.position.x += Math.sin(position * 0.0006 + s.position.y) * 0.003 + (Math.random() - 0.5) * 0.015;
                    s.position.y += (Math.random() - 0.5) * 0.015;
                } else if (category === 'future_memory') {
                    s.position.y += 0.003; // Very slow float up
                    s.position.x += Math.sin(position * 0.0006 + s.position.y) * 0.003;
                } else {
                    // Default, music, light, voice_echo
                    s.position.y += 0.007;
                    s.position.x += Math.sin(position * 0.0006 + s.position.y) * 0.003;
                }

                if (this.isClimax) {
                    s.position.x *= 1.003;
                    s.position.y *= 1.003;
                }

                const age = Math.max(0, position - s.userData.birth);
                let opacity = 1.0;
                if (age < 150) {
                    opacity = age / 150;
                } else if (age > s.userData.life - 200) {
                    opacity = Math.max(0, (s.userData.life - age) / 200);
                }
                if (s.position.y > 1.2) {
                    const heightFade = Math.max(0, 1.0 - (s.position.y - 1.2) / 1.2);
                    opacity *= heightFade;
                }
                s.material.opacity = opacity;

                if (age > s.userData.life || s.position.y > 2.4) {
                    this.disposeSprite(s);
                    this.activeSprites.splice(i, 1);
                }
            }
        }

        // 別フレーズ同士が同じ行に重なって「歌詞が二重に見える」のを防ぐ。
        // 長いフレーズが接近・漂って重なっても、毎フレームわずかに上下へ押し分けて読めるよう保つ。
        this._separateOverlappingLyrics();

        // 歌詞レイヤーの奥行きをミクの向きに連動させる(_lyricLayerZ)。
        // 背面(夜空を見上げている)ときは歌詞をミクの体・髪の奥行きを確実に超える深さへ置き、背中を貫通させない。
        // サビ(正面)では手前へ戻して大きく読ませる。タップ中の歌詞は固定なので除外。
        const targetLyricZ = this._lyricLayerZ();
        for (let i = 0; i < this.activeSprites.length; i++) {
            const s = this.activeSprites[i];
            if (!s || s.userData.isNode || s.userData.isBeingTapped) continue;
            s.position.z += (targetLyricZ - s.position.z) * 0.08;
        }

        // Update drawn/constellation lines
        this.drawnLines.forEach(line => {
            line.rotation.y += 0.01;
            line.rotation.x += 0.005;
        });

        // ─── 色彩交響オーブシステムの物理更新 ───
        if (this.isClimax) {
            // A. サビ突入時の退避処理（打ち上げタイムラインの初期化）
            if (!this.hasTriggeredClimaxExplosion) {
                this.hasTriggeredClimaxExplosion = true;
                this.climaxOrbs = [...this.resonateOrbs];
                this.resonateOrbs = []; // サビ中に新たにタップされたオーブを溜められるように蓄積配列をクリア
                this.climaxLaunchedOrbs.clear();

                const orbCount = this.climaxOrbs.length;
                this.chorusOrbCount = orbCount; // 花火規模の比例係数として保持
                this.resetOrbGauge(orbCount);   // ゲージを消費リセット（次のサビへまた集めるループ）

                if (orbCount > 0) {
                    let climaxDuration = 30000;
                    if (playerManager.player && playerManager.player.timer) {
                        const currentPos = playerManager.player.timer.position;
                        const chorusObj = playerManager.player.findChorus(currentPos);
                        if (chorusObj) {
                            climaxDuration = chorusObj.endTime - chorusObj.startTime;
                        }
                    }

                    // (サビ突入のトースト説明は廃止。蓄積オーブは花火そのもので魅せる)
                } else {
                    // 蓄積0個のサビ: 控えめな単発花火を一輪だけ上げる(トースト説明は出さない)
                    this.spawnCustomColorFirework(
                        new THREE.Color(this.currentColor),
                        new THREE.Vector3((Math.random() - 0.5) * 6.0, 3.0 + Math.random() * 2.0, -24.0),
                        0.35
                    );
                }
            }

            // B. サビ中の時系列打ち上げ更新
            let chorusStart = 180000;
            let chorusEnd = 210000;
            if (playerManager.player && playerManager.player.timer) {
                const currentPos = playerManager.player.timer.position;
                const chorusObj = playerManager.player.findChorus(currentPos);
                if (chorusObj) {
                    chorusStart = chorusObj.startTime;
                    chorusEnd = chorusObj.endTime;
                }
            }

            const climaxDuration = chorusEnd - chorusStart;
            const totalOrbs = this.climaxOrbs.length;
            // サビ終了までに「最後のオーブの爆発」が必ず収まるよう間隔を決める。
            // オーブは打ち上げから FLIGHT(=launchDuration) 後に爆発するので、最後の打ち上げは
            // chorusEnd - FLIGHT - 余裕 までに行う必要がある。打ち上げは idx=0..n-1 なので n-1 で割る。
            const FLIGHT = 1800;  // launchDuration と一致させる
            const SAFETY = 300;   // サビ終了直前に確実に咲かせる余裕
            const lastLaunchBy = Math.max(0, climaxDuration - FLIGHT - SAFETY);
            const clampedInterval = totalOrbs > 1 ? Math.min(3500, lastLaunchBy / (totalOrbs - 1)) : 0;

            const time = position * 0.001;

            this.climaxOrbs = this.climaxOrbs.filter((orb, idx) => {
                const launchTimeTrigger = chorusStart + (idx * clampedInterval);

                // 打ち上げトリガー判定
                if (position >= launchTimeTrigger && !this.climaxLaunchedOrbs.has(idx)) {
                    this.climaxLaunchedOrbs.add(idx);
                    orb.userData.isLaunched = true;
                    orb.userData.launchStart = position;
                    orb.userData.startLaunchPos = orb.position.clone();
                    orb.userData.launchDuration = 1800; // 1.8秒かけて飛翔
                    
                    // 宇宙の奥へ向けて拡散する飛翔目標
                    const angle = (idx / totalOrbs) * Math.PI * 2 + time;
                    const spreadRadius = 12.0 + Math.random() * 8.0;
                    orb.userData.targetLaunchPos = new THREE.Vector3(
                        Math.cos(angle) * spreadRadius,
                        2.0 + Math.random() * 5.0,
                        -25.0 - Math.random() * 15.0
                    );

                    // 飛翔用の光の尾 (Trail) メッシュを生成
                    // 2点固定の尾なので、位置バッファを一度だけ確保し以後は中身のみ更新する(毎フレームの再確保を回避)
                    const trailGeo = new THREE.BufferGeometry();
                    const trailPositions = new Float32Array(6);
                    trailPositions[0] = orb.position.x;
                    trailPositions[1] = orb.position.y;
                    trailPositions[2] = orb.position.z;
                    trailPositions[3] = orb.position.x;
                    trailPositions[4] = orb.position.y;
                    trailPositions[5] = orb.position.z;
                    const trailPosAttr = new THREE.BufferAttribute(trailPositions, 3);
                    trailPosAttr.setUsage(THREE.DynamicDrawUsage);
                    trailGeo.setAttribute('position', trailPosAttr);
                    orb.userData.trailPosAttr = trailPosAttr;
                    const trailMat = new THREE.LineBasicMaterial({
                        color: orb.userData.color,
                        transparent: true,
                        opacity: 0.8,
                        linewidth: 1.5
                    });
                    const trailLine = new THREE.Line(trailGeo, trailMat);
                    this.scene.add(trailLine);
                    orb.userData.trail = trailLine;
                }

                if (orb.userData.isLaunched) {
                    // 飛翔アニメーション (Lerp)
                    const age = position - orb.userData.launchStart;
                    const t = Math.min(1.0, age / orb.userData.launchDuration);
                    const ease = t * t; // 加速

                    orb.position.lerpVectors(orb.userData.startLaunchPos, orb.userData.targetLaunchPos, ease);

                    // トレイル更新 (確保済みバッファの中身のみ更新。毎フレームのジオメトリ再確保とVector3生成を回避)
                    if (orb.userData.trail) {
                        const attr = orb.userData.trailPosAttr;
                        const arr = attr.array;
                        const sp = orb.userData.startLaunchPos;
                        arr[0] = sp.x;
                        arr[1] = sp.y;
                        arr[2] = sp.z;
                        arr[3] = orb.position.x;
                        arr[4] = orb.position.y;
                        arr[5] = orb.position.z;
                        attr.needsUpdate = true;
                        orb.userData.trail.material.opacity = 0.8 * (1.0 - t);
                    }

                    // 宇宙の奥に到達したら花火として大爆発
                    if (t >= 1.0) {
                        // 浮遊歌詞の色変化 (花火の余韻として歌詞の色を共鳴)
                        this.activeSprites.forEach(s => {
                            if (s.material && s.material.color) {
                                s.material.color.copy(orb.userData.color);
                            }
                        });

                        // 花火の大きさはゲージの溜まり具合に比例（空に近い=小さな花火 / 満タン=大輪）。
                        const intensity = this._chorusFireworkIntensity();
                        this.spawnCustomColorFirework(orb.userData.color, orb.position, intensity);

                        // ゲージが溜まっているほど連鎖サブ爆発も増やす（満タン付近=2発・中盤=1発・少量=なし）
                        const gaugeRatio = Math.min(1, (this.chorusOrbCount || 0) / this.GAUGE_CAPACITY);
                        const extraBursts = gaugeRatio >= 0.75 ? 2 : (gaugeRatio >= 0.4 ? 1 : 0);
                        for (let b = 0; b < extraBursts; b++) {
                            const offset = new THREE.Vector3(
                                (Math.random() - 0.5) * 6.0,
                                (Math.random() - 0.5) * 4.0,
                                (Math.random() - 0.5) * 4.0
                            );
                            this.spawnCustomColorFirework(
                                orb.userData.color,
                                orb.position.clone().add(offset),
                                intensity * 0.55
                            );
                        }

                        this.scene.remove(orb);
                        if (orb.material) orb.material.dispose();
                        if (orb.userData.trail) {
                            this.scene.remove(orb.userData.trail);
                            orb.userData.trail.geometry.dispose();
                            orb.userData.trail.material.dispose();
                        }
                        orb.parent = null; // 親子関係を切る
                        return false; // climaxOrbsリストから除外
                    }
                }
                return true; // リストに残す
            });
        } else {
            // C. サビ以外の区間：トリガーリセット、サビ打ち上げ用配列のクリーンアップ
            if (this.hasTriggeredClimaxExplosion) {
                this.hasTriggeredClimaxExplosion = false;
                // サビ終了までに打ち上げ切れなかったオーブは、ここで必ず花火にしてから片付ける
                // (「サビが終わるタイミングで全オーブが花火になっている」を保証する)。
                const intensity = this._chorusFireworkIntensity();
                this.climaxOrbs.forEach(orb => {
                    this.spawnCustomColorFirework(orb.userData.color, orb.position, intensity);
                    this.scene.remove(orb);
                    if (orb.material) orb.material.dispose();
                    if (orb.userData.trail) {
                        this.scene.remove(orb.userData.trail);
                        orb.userData.trail.geometry.dispose();
                        orb.userData.trail.material.dispose();
                    }
                });
                this.climaxOrbs = [];
                this.climaxLaunchedOrbs.clear();
            }
        }

        // D. 螺旋周回アニメーションの実行 (サビの有無にかかわらず、また打ち上げ前のオーブに対しても実行)
        const orbTime = position * 0.0015;
        
        // 1. 通常の蓄積オーブ (サビ前後・サビ中にタップされたものすべて)
        this.resonateOrbs.forEach(orb => {
            orb.userData.angle += orb.userData.speed;
            const targetRadius = orb.userData.radius;
            const targetX = Math.cos(orb.userData.angle) * targetRadius;
            const targetZ = Math.sin(orb.userData.angle) * targetRadius - 1.5;
            const targetY = orb.userData.yBase + Math.sin(orbTime + orb.userData.phase) * 0.4;
            
            orb.position.x += (targetX - orb.position.x) * 0.1;
            orb.position.y += (targetY - orb.position.y) * 0.1;
            orb.position.z += (targetZ - orb.position.z) * 0.1;

            if (orb.material) {
                orb.material.opacity = 0.75 + 0.25 * Math.sin(orbTime * 3.0 + orb.userData.phase);
            }
        });

        // 2. 打ち上げ前のサビオーブも周回させ続ける
        this.climaxOrbs.forEach(orb => {
            if (orb.userData.isLaunched || !orb.parent) return; // 打ち上げ中、または消去済みのものは除く
            
            orb.userData.angle += orb.userData.speed;
            const targetRadius = orb.userData.radius;
            const targetX = Math.cos(orb.userData.angle) * targetRadius;
            const targetZ = Math.sin(orb.userData.angle) * targetRadius - 1.5;
            const targetY = orb.userData.yBase + Math.sin(orbTime + orb.userData.phase) * 0.4;
            
            orb.position.x += (targetX - orb.position.x) * 0.1;
            orb.position.y += (targetY - orb.position.y) * 0.1;
            orb.position.z += (targetZ - orb.position.z) * 0.1;

            if (orb.material) {
                orb.material.opacity = 0.75 + 0.25 * Math.sin(orbTime * 3.0 + orb.userData.phase);
            }
        });

        // Update fireworks
        for (let i = this.fireworks.length - 1; i >= 0; i--) {
            const fw = this.fireworks[i];
            const age = Date.now() - fw.userData.birth;
            const positions = fw.geometry.attributes.position.array;
            const friction = 0.91; // 空気抵抗で「パッと広がり、ふわっと留まって消える」情緒を演出
            
            for (let j = 0; j < fw.userData.velocities.length; j++) {
                fw.userData.velocities[j].x *= friction;
                fw.userData.velocities[j].y *= friction;
                fw.userData.velocities[j].z *= friction;
                
                fw.userData.velocities[j].y -= 0.002; // 空気中の浮遊感を持たせるため重力を極小に
                
                positions[j*3] += fw.userData.velocities[j].x;
                positions[j*3+1] += fw.userData.velocities[j].y;
                positions[j*3+2] += fw.userData.velocities[j].z;
            }
            fw.geometry.attributes.position.needsUpdate = true;
            
            // 1800msの寿命で、大輪に広がった後スーッと消え入るように2.2乗のイージングを適用（寿命延長 1400 ➔ 1800）
            const maxLife = 1800;
            fw.material.opacity = Math.max(0, Math.pow(1 - (age / maxLife), 2.2));
            
            if (age > maxLife) {
                this.scene.remove(fw);
                fw.geometry.dispose();
                fw.material.dispose();
                this.fireworks.splice(i, 1);
            }
        }

        // Update VRM Avatar animations & physics
        if (this.currentVRM) {
            // Calculate responsive scale based on window width
            const responsiveScale = Math.max(5.0, Math.min(14.0, (window.innerWidth / 1200) * 8.5));

            // Determine if there are active lyrics on screen
            const activeLyrics = this.activeSprites.filter(s => !s.userData.isNode);
            const hasLyrics = activeLyrics.length > 0;

            const floatTime = position * 0.001; // Song time in seconds

            // 飛行/通常モードのちらつき防止（ヒステリシス）。
            // 歌詞は語句ごとに数十〜数百msの隙間が空くため、hasLyrics をそのまま使うと
            // 飛行⇄通常が短時間で高速トグルし、位置(ホーム⇄軌道)と姿勢が断続的に飛んで
            // ツインテールが「発話の瞬間」に逆立つ。歌詞が一定時間(0.6s)継続して不在に
            // なって初めて飛行へ入る／戻ることで、語句の合間での誤トグルを抑える。
            if (hasLyrics) this._lastLyricMs = position;
            if (this._lastLyricMs === undefined) this._lastLyricMs = position;
            const lyricGapMs = position - this._lastLyricMs;
            const inFlight = (lyricGapMs > 600) && !this.tapAnimation;

            if (inFlight) {
                // --- FLIGHT MODE (No lyrics on screen - glide in a Lissajous orbit) ---
                this.isFlying = true;
                const flightSpeed = floatTime * 0.6;
                // Calculate dynamic path scale according to window aspect ratio
                const dist = 21.0; // Camera Z(10) - Object Z(-11)
                const fovRad = (this.camera.fov * Math.PI) / 180;
                const visibleHeight = 2.0 * dist * Math.tan(fovRad / 2.0);
                const visibleWidth = visibleHeight * this.camera.aspect;

                const flightRangeX = visibleWidth * 0.35;  // wide responsive movement
                const flightRangeY = visibleHeight * 0.22; // tall responsive movement

                const targetFlightX = Math.sin(flightSpeed * 0.8) * flightRangeX;
                const targetFlightY = Math.cos(flightSpeed * 1.2) * flightRangeY - (responsiveScale * 0.25);
                const targetFlightZ = -13.0 + Math.sin(flightSpeed * 1.6) * 3.0;

                // Glide smoothly to the flight path coordinates
                this.baseMikuX += (targetFlightX - this.baseMikuX) * 0.03;
                this.baseMikuY += (targetFlightY - this.baseMikuY) * 0.03;
                this.baseMikuZ += (targetFlightZ - this.baseMikuZ) * 0.03;
            } else {
                // --- NORMAL / LYRIC ACTIVE MODE ---
                this.isFlying = false;

                // If not tapped yet, slide smoothly to home（ハードセットだと飛行位置から
                // 一瞬でホームへ瞬間移動し、その速度差で髪が暴れるため lerp で連続的に戻す）
                if (!this.hasTapped) {
                    this.baseMikuX += (0 - this.baseMikuX) * 0.04;
                    this.baseMikuY += ((-0.53 * responsiveScale) - this.baseMikuY) * 0.04;
                    this.baseMikuZ += ((-13.0) - this.baseMikuZ) * 0.04;
                } else if (!this.tapAnimation) {
                    // Smoothly slide back to the last tapped position or home position
                    let targetHomeX = 0;
                    let targetHomeY = -0.53 * responsiveScale;
                    let targetHomeZ = -13.0;

                    if (this.lastTappedMikuPos) {
                        targetHomeX = this.lastTappedMikuPos.x;
                        targetHomeY = this.lastTappedMikuPos.y;
                        // 奥行き(Z)はタップ位置を引き継がず、必ず一定ホーム(-13)へ戻す。
                        // タップ時のZ(歌詞の前後へずらした値)を引き継ぐと、歌詞レイヤーZ(ミクのbbox基準)が
                        // タップごとに奥へ累積ドリフトし、曲が進む(タップが増える)ほど歌詞が小さくなってしまう。
                        // targetHomeZ は既定の -13.0 のまま据え置く。
                    }

                    this.baseMikuX += (targetHomeX - this.baseMikuX) * 0.04;
                    this.baseMikuY += (targetHomeY - this.baseMikuY) * 0.04;
                    this.baseMikuZ += (targetHomeZ - this.baseMikuZ) * 0.04;
                }
            }

            // Gentle floating physics base calculation
            const floatX = this.baseMikuX + Math.cos(floatTime * 0.8) * 0.15;
            const floatY = this.baseMikuY + Math.sin(floatTime * 1.2) * 0.25;
            const floatZ = this.baseMikuZ;
            const basePos = new THREE.Vector3(floatX, floatY, floatZ);

            // Apply slight flight banking roll and pitch in rotation if flying
            if (this.isFlying) {
                // Lean slightly forward and roll into the curve of the Lissajous path
                const rollAmount = Math.cos(floatTime * 0.6) * 0.15;
                const pitchAmount = Math.sin(floatTime * 1.2) * 0.08;
                this.currentVRM.scene.rotation.y = this.baseMikuRotY;
                this.currentVRM.scene.rotation.z = rollAmount;
                this.currentVRM.scene.rotation.x = pitchAmount;
            } else {
                this.currentVRM.scene.rotation.y = this.baseMikuRotY; 
                this.currentVRM.scene.rotation.z = Math.sin(floatTime * 0.6) * 0.02; // Subtle tilt roll
                this.currentVRM.scene.rotation.x = 0; // reset pitch
            }

            // Physics update for hair and costume joints (SpringBone) & Tap Animation elapsed time update
            const currentRealTime = performance.now();
            if (this.lastRealTime === undefined) this.lastRealTime = currentRealTime;
            // Cap deltaTime to 33ms (30fps equivalent) to prevent physics breakdown during frame drops
            const deltaTime = Math.min(0.033, (currentRealTime - this.lastRealTime) / 1000);
            this.lastRealTime = currentRealTime;

            // Tap animation state and interpolation calculations
            let w = 0;
            let activeArm = null;
            let projectedTarget = null;

            if (this.tapAnimation) {
                this.tapAnimation.elapsed += deltaTime;
                activeArm = this.tapAnimation.arm;
                const elapsed = this.tapAnimation.elapsed;
                const peak = this.tapAnimation.peakTime;
                const dur = this.tapAnimation.duration;
                
                if (elapsed < peak) {
                    w = Math.sin((elapsed / peak) * Math.PI / 2); // 0 -> 1
                } else {
                    w = Math.sin((1.0 - (elapsed - peak) / (dur - peak)) * Math.PI / 2); // 1 -> 0
                }
                w = Math.max(0, Math.min(1, w));
                
                // Target position is directly the clicked lyric's position (no projection needed at Z=-11)
                projectedTarget = this.tapAnimation.targetWorldPos;

                // Peak trigger (sublimation into orb)
                if (elapsed >= peak && !this.tapAnimation.sublimated) {
                    this.tapAnimation.sublimated = true;
                    const spriteColor = new THREE.Color(this.getSemanticColor(this.tapAnimation.sprite.userData.text) || '#ffffff');
                    this.spawnTapSparkles(spriteColor, this.tapAnimation.sprite.position);
                    this.resonateLyricColor(this.tapAnimation.sprite);
                }
                
                if (elapsed >= dur) {
                    // Update Miku's base position to the last tapped lyric's position
                    // so she floats there instead of flying back to the center
                    // クローズドループで手先が中心へ収束した「現在位置」をそのまま停止位置にする。
                    // (静的オフセットへスナップさせると1フレームの跳ね＝SpringBone暴発を招くため)
                    this.baseMikuX = this.currentVRM.scene.position.x;
                    this.baseMikuY = this.currentVRM.scene.position.y;
                    this.baseMikuZ = this.currentVRM.scene.position.z;
                    this.tapAnimation = null;
                    this._tapDesired = null; // 次のタップ用にローパス目標をクリア

                    // Save last tapped position to return back to after flight mode
                    this.lastTappedMikuPos = new THREE.Vector3(this.baseMikuX, this.baseMikuY, this.baseMikuZ);

                    // Reset SpringBone physics to prevent hair from locking in distorted poses when stop triggers
                    if (this.currentVRM.springBoneManager) {
                        this.currentVRM.springBoneManager.reset();
                    }
                }
            }

            // Miku body position interpolation (move to tapped lyric position and stay there)
            if (this.tapAnimation && projectedTarget) {
                // 手先(ハンドボーン)が「画面上で」歌詞フレーズの中心に重なるよう本体を配置する。
                // 旧実装は本体を中心の遥か下(-1.2×scale)・奥(-1.0×scale)へ置いていたが、腕IKが実質伸びず
                // 手は本体直下に垂れるため、中心から大きく下/奥にズレていた(計測: 下6.9・奥10.7)。
                // ここでは実際のハンドボーンを毎フレーム投影し、中心との画面誤差ぶん本体XYをずらす
                // クローズドループ補正にする。左右の腕差・揺れ・遠近に自動追従し、手先が中心へ収束する。
                // 奥行き(Z): 歌詞レイヤーの前後関係(_lyricLayerZ: サビ=歌詞が手前 / それ以外=歌詞が奥)を
                // タップ中も保つよう、本体を歌詞のどちら側に置くかを向きで切り替える。
                //  ・背面(夜空向き)時: 本体を歌詞より手前へ → タップした歌詞もミクの背後(奥)に隠れる。
                //  ・正面(サビ)時: 本体を歌詞より奥へ → タップした歌詞もミクより手前に出る。
                // 腕は別途「ミクの正面方向」へ伸ばすので、本体をどちら側に置いても手の向きは正しく保たれる。
                const facingFront = (this._faceFront || 0) > 0.5;
                const behindZ = facingFront
                    ? projectedTarget.z - (this.TAP_BODY_BEHIND * responsiveScale)  // サビ: ミクが奥 → 歌詞が手前
                    : projectedTarget.z + (this.TAP_BODY_BEHIND * responsiveScale); // それ以外: ミクが手前 → 歌詞が奥
                // フォールバック(初回フレーム=ハンド行列が未確定のとき)は計測オフセットで概算配置
                let desiredX = projectedTarget.x - (this.TAP_HAND_OFF_X * responsiveScale);
                let desiredY = projectedTarget.y - (this.TAP_HAND_OFF_Y * responsiveScale);
                const handBone = this.currentVRM.humanoid.getNormalizedBoneNode(activeArm === 'left' ? 'leftHand' : 'rightHand');
                if (handBone) {
                    handBone.updateWorldMatrix(true, false);
                    const handPos = new THREE.Vector3().setFromMatrixPosition(handBone.matrixWorld);
                    const handNdc = handPos.clone().project(this.camera);
                    const tgtNdc = projectedTarget.clone().project(this.camera);
                    const fovRad = (this.camera.fov * Math.PI) / 180;
                    const worldPerNdcY = (this.camera.position.z - handPos.z) * Math.tan(fovRad / 2);
                    const worldPerNdcX = worldPerNdcY * this.camera.aspect;
                    // 現在の本体XYに「手先→中心」の画面誤差(NDC)を world に直して加える
                    desiredX = this.currentVRM.scene.position.x + (tgtNdc.x - handNdc.x) * worldPerNdcX;
                    desiredY = this.currentVRM.scene.position.y + (tgtNdc.y - handNdc.y) * worldPerNdcY;
                }
                const rawDesired = new THREE.Vector3(desiredX, desiredY, behindZ);
                // 目標を低域通過(ローパス)で滑らかにし、クローズドループの自己振動を抑える。
                // (補正対象のハンド位置が腕の揺れで毎フレーム動くと目標が暴れ、体が跳ねてツインテールが乱れる)
                if (!this._tapDesired) this._tapDesired = rawDesired.clone();
                else this._tapDesired.lerp(rawDesired, 0.2);
                const targetMikuPos = this._tapDesired;

                const elapsed = this.tapAnimation.elapsed;
                const peak = this.tapAnimation.peakTime;

                // 目的地(intended)を求め、1フレームの移動量を上限クランプしてゆっくり動かす。
                // 体が一気に飛ぶ(=並進速度が大きい)とSpringBoneが追従しきれずツインテールが乱れるため、
                // 毎フレームの並進量を抑えて滑らかに移動させる。
                let intended;
                if (elapsed < peak) {
                    const w_pos = Math.sin((elapsed / peak) * Math.PI / 2);
                    intended = new THREE.Vector3().lerpVectors(basePos, targetMikuPos, w_pos);
                } else {
                    intended = targetMikuPos;
                }
                const cur = this.currentVRM.scene.position;
                const move = new THREE.Vector3().subVectors(intended, cur);
                const maxStep = 0.1 * responsiveScale; // ≈0.85/frame: 髪が暴れない並進上限
                if (move.length() > maxStep) move.setLength(maxStep);
                cur.add(move);
            } else {
                // タップ終了フレームでは、直前のタップ完了処理(elapsed>=dur)で baseMiku が
                // 移動先へ更新されるが、basePos は update() 冒頭で旧home値のまま計算済み。
                // basePos をそのまま使うと位置が1フレームだけhomeへ瞬間移動し、直後に移動先へ
                // 戻る——この往復速度でツインテールのSpringBoneが暴発（移動後に逆立つ）。
                // 位置を現在の baseMiku から毎フレーム再計算し、連続性を保って暴発を防ぐ。
                const homeX = this.baseMikuX + Math.cos(floatTime * 0.8) * 0.15;
                const homeY = this.baseMikuY + Math.sin(floatTime * 1.2) * 0.25;
                this.currentVRM.scene.position.set(homeX, homeY, this.baseMikuZ);
            }

            // Arm bones animation update
            const leftUpperArm = this.currentVRM.humanoid.getNormalizedBoneNode('leftUpperArm');
            const rightUpperArm = this.currentVRM.humanoid.getNormalizedBoneNode('rightUpperArm');
            const leftLowerArm = this.currentVRM.humanoid.getNormalizedBoneNode('leftLowerArm');
            const rightLowerArm = this.currentVRM.humanoid.getNormalizedBoneNode('rightLowerArm');

            if (this.relaxedQuaternions) {
                // Apply relaxed pose + breathing as base for left arm
                if (leftUpperArm) {
                    leftUpperArm.quaternion.copy(this.relaxedQuaternions.leftUpperArm);
                    const euler = new THREE.Euler().setFromQuaternion(leftUpperArm.quaternion);
                    if (this.isFlying) {
                        // Glide arm wing pose
                        euler.z += Math.PI / 4.5 + Math.sin(floatTime * 2.0) * 0.04;
                        euler.x += Math.PI / 12.0;
                    } else {
                        euler.z += Math.sin(floatTime * 1.5) * 0.05;
                    }
                    leftUpperArm.quaternion.setFromEuler(euler);
                }
                if (leftLowerArm) {
                    leftLowerArm.quaternion.copy(this.relaxedQuaternions.leftLowerArm);
                    if (this.isFlying) {
                        const euler = new THREE.Euler().setFromQuaternion(leftLowerArm.quaternion);
                        euler.y += Math.PI / 8.0;
                        leftLowerArm.quaternion.setFromEuler(euler);
                    }
                }

                // Apply relaxed pose + breathing as base for right arm
                if (rightUpperArm) {
                    rightUpperArm.quaternion.copy(this.relaxedQuaternions.rightUpperArm);
                    const euler = new THREE.Euler().setFromQuaternion(rightUpperArm.quaternion);
                    if (this.isFlying) {
                        // Glide arm wing pose
                        euler.z -= Math.PI / 4.5 + Math.sin(floatTime * 2.0) * 0.04;
                        euler.x += Math.PI / 12.0;
                    } else {
                        euler.z -= Math.sin(floatTime * 1.5) * 0.05;
                    }
                    rightUpperArm.quaternion.setFromEuler(euler);
                }
                if (rightLowerArm) {
                    rightLowerArm.quaternion.copy(this.relaxedQuaternions.rightLowerArm);
                    if (this.isFlying) {
                        const euler = new THREE.Euler().setFromQuaternion(rightLowerArm.quaternion);
                        euler.y -= Math.PI / 8.0;
                        rightLowerArm.quaternion.setFromEuler(euler);
                    }
                }

                // Superimpose arm extension animation if active
                if (this.tapAnimation && w > 0 && projectedTarget) {
                    const isLeft = activeArm === 'left';
                    const activeUpper = isLeft ? leftUpperArm : rightUpperArm;
                    const activeLower = isLeft ? leftLowerArm : rightLowerArm;

                    if (activeUpper) {
                        const shoulderPos = activeUpper.getWorldPosition(new THREE.Vector3());
                        // 歌詞の世界座標ではなく「ミクの正面(顔の向き)」方向へ腕を伸ばす。
                        // 背面時は画面奥(=ミクの前)へ、正面(サビ)時は客席側(=ミクの前)へ、常にミクの正面側へ手が出る。
                        // (歌詞へ正対させると、サビは歌詞がミクの背側に来るため腕が背面へ回ってしまう)
                        const wf = new THREE.Vector3(-Math.sin(this.baseMikuRotY), 0, -Math.cos(this.baseMikuRotY)); // ミクのワールド前方
                        const sideSign = isLeft ? 1 : -1;
                        const aimDir = wf.clone().add(new THREE.Vector3(0.3 * sideSign, -0.6, 0)).normalize(); // 前方やや下・腕側へ
                        const parentWorldQ = activeUpper.parent.getWorldQuaternion(new THREE.Quaternion());
                        const localDir = aimDir.clone().applyQuaternion(parentWorldQ.clone().invert()).normalize();

                        // 腕の長さ軸を aimDir に合わせる。このモデルでは符号が逆(左:-X / 右:+X)で
                        // ないと手が反対(背面)へ出るため反転している(計測で確定)。
                        const localAxis = isLeft ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
                        const targetUpperQ = new THREE.Quaternion().setFromUnitVectors(localAxis, localDir);

                        activeUpper.quaternion.slerp(targetUpperQ, w);
                    }

                    if (activeLower) {
                        // Straighten elbow at peak
                        const straightQ = new THREE.Quaternion();
                        activeLower.quaternion.slerp(straightQ, w);
                    }
                }
            } else {
                // Fallback direct rotation update if relaxedQuaternions are not yet cached
                // 新VRMは上腕ロール軸が逆: 左+/右- が下げ方向
                if (leftUpperArm) leftUpperArm.rotation.z = (Math.PI / 3.2) + Math.sin(floatTime * 1.5) * 0.05;
                if (rightUpperArm) rightUpperArm.rotation.z = -(Math.PI / 3.2) - Math.sin(floatTime * 1.5) * 0.05;
            }

            // アイドル時にちょくちょく客席(プレイヤー)へ手を振る挨拶。
            // 飛行中・歌詞タップ中は本来の演出を優先するため挨拶しない。
            if (this.greetTimer === undefined) {
                this.greetTimer = 6 + Math.random() * 4; this.greetActive = false;
                this.greetElapsed = 0; this.greetWave = 0;
            }
            const greetBusy = this.isFlying || !!this.tapAnimation;
            if (greetBusy) {
                this.greetActive = false; this.greetWave = 0;
            } else if (!this.greetActive) {
                this.greetTimer -= deltaTime;
                if (this.greetTimer <= 0) { this.greetActive = true; this.greetElapsed = 0; }
            }
            if (this.greetActive) {
                const GD = 2.8;
                this.greetElapsed += deltaTime;
                this.greetWave = Math.sin(Math.min(1, this.greetElapsed / GD) * Math.PI); // 0→1→0
                if (this.greetElapsed >= GD) {
                    this.greetActive = false; this.greetWave = 0;
                    this.greetTimer = 7 + Math.random() * 5;
                }
            }
            if (this.greetWave > 0 && rightUpperArm) {
                const wv = this.greetWave;
                const swing = Math.sin(floatTime * 9) * 0.3; // 手を左右に振る(穏やかに)
                // 既存ポーズ(下ろした腕)に加算。新VRMは右腕 z+ で上がる。頭の高さ程度に留める
                const eu = new THREE.Euler().setFromQuaternion(rightUpperArm.quaternion);
                eu.z += 1.5 * wv + swing * wv;  // 下げ位置(約-1.1)から頭の高さ(約+0.4)へ
                eu.x += -0.6 * wv;              // 前方(客席)へ
                rightUpperArm.quaternion.setFromEuler(eu);
                if (rightLowerArm) {
                    const el = new THREE.Euler().setFromQuaternion(rightLowerArm.quaternion);
                    el.y += -1.0 * wv; // 肘を曲げ手を顔の横へ(右前腕 y- で前方屈曲)
                    rightLowerArm.quaternion.setFromEuler(el);
                }
            }

            // Head/neck lookAt tracking (looking at the lyric during tap, otherwise looking at camera)
            const neck = this.currentVRM.humanoid.getNormalizedBoneNode('neck');
            if (neck) {
                const facingFront = (this._faceFront || 0) > 0.5;
                if (this.tapAnimation && facingFront) {
                    // サビ(正面)のタップ中は首を一切動かさない(かしげ防止)。
                    // lookAtを呼ばず、直前(タップ前にカメラを見ていた)の首の向きのまま据え置く。
                } else if (this.tapAnimation && projectedTarget && w > 0) {
                    // 背面(夜空向き)時のみ、タップした歌詞の方へ顔を向ける
                    const lookPos = new THREE.Vector3().lerpVectors(this.camera.position, projectedTarget, w);
                    this.lookAtTarget(neck, lookPos, 0.7, 0.4);
                } else {
                    // 通常時は客席=ユーザーと目を合わせる
                    this.lookAtTarget(neck, this.camera.position, 0.5, 0.3);
                }
            }

            // Set scale responsive to window size without beat pulse scaling (preventing jittery movement)
            this.currentVRM.scene.scale.set(responsiveScale, responsiveScale, responsiveScale);

            // Rhythmic lipsync mouth animation synchronized with current vocal text
            if (currentWord && currentWord.text) {
                const char = currentWord.text.charAt(0);
                let vowel = 'neutral';

                if (/[あかさたなはまやらわアカサタナハマヤラワaA]/.test(char)) vowel = 'aa';
                else if (/[いきしちにひみりイキシチニヒミリiI]/.test(char)) vowel = 'ih';
                else if (/[うくすつぬふむゆるウクスツヌフムユルuU]/.test(char)) vowel = 'uu';
                else if (/[えけせてねへめれエケセテネヘメレeE]/.test(char)) vowel = 'ee';
                else if (/[おこそとのほもよろオコソトノホモヨロoO]/.test(char)) vowel = 'oo';

                const targetValues = { aa: 0, ih: 0, uu: 0, ee: 0, oo: 0 };
                if (vowel !== 'neutral') {
                    targetValues[vowel] = 0.85;
                }

                for (const key in targetValues) {
                    const currentVal = this.currentVRM.expressionManager.getValue(key) || 0;
                    const nextVal = currentVal + (targetValues[key] - currentVal) * 0.3;
                    this.currentVRM.expressionManager.setValue(key, nextVal);
                }
            } else {
                const keys = ['aa', 'ih', 'uu', 'ee', 'oo'];
                for (const key of keys) {
                    const currentVal = this.currentVRM.expressionManager.getValue(key) || 0;
                    const nextVal = currentVal + (0 - currentVal) * 0.25;
                    this.currentVRM.expressionManager.setValue(key, nextVal);
                }
            }
            this.currentVRM.expressionManager.update();

            // Run SpringBone physics update
            this.currentVRM.update(deltaTime);

            // ミクの実Z範囲を更新(歌詞レイヤーの奥行き判定に使用。ワールド行列が確定したこの直後に取る)
            this._updateMikuZExtent();
        }

        // --- Dynamic Color Resonance Hint trigger ---
        const wordText = currentWord ? currentWord.text : '';
        if (!this.hasResonatedColor && !this.colorPickerShown && (wordText.includes('空') || wordText.includes('色') || position > 22000)) {
            this.showTutorialCard({
                icon: '✨',
                title: '響く言葉に触れよう',
                body: '浮かび上がる歌詞（言葉）をクリックすると、\n意味に応じたオーブが蓄積され、サビで花火になります。',
                duration: 6500
            });
            this.colorPickerShown = true; // ヒントを一度だけ出すためのフラグとして再利用
        }
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }


    showTutorialCard({ icon, title, body, btnLabel, duration, onDismiss } = {}) {
        if (this._tutCard && this._tutCard.parentNode) {
            this._tutCard.parentNode.removeChild(this._tutCard);
        }
        clearTimeout(this._tutCardTimer);

        const card = document.createElement('div');
        card.style.cssText = `
            position: absolute;
            top: 72px;
            left: 50%;
            transform: translateX(-50%) translateY(-12px);
            background: rgba(4, 4, 22, 0.85);
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 16px;
            padding: 22px 32px 20px;
            color: #fff;
            text-align: center;
            pointer-events: auto;
            z-index: 200;
            min-width: 270px;
            max-width: 340px;
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            transition: opacity 0.5s ease, transform 0.5s ease;
            opacity: 0;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        `;

        const bodyLines = (body || '').replace(/\n/g, '<br>');
        card.innerHTML = `
            <div style="font-size:26px;margin-bottom:10px;">${icon || ''}</div>
            <div style="font-size:14px;font-weight:600;letter-spacing:0.12em;margin-bottom:12px;">${title || ''}</div>
            <div style="font-size:12px;line-height:1.9;color:rgba(255,255,255,0.72);">${bodyLines}</div>
            ${btnLabel ? `<button class="tut-btn" style="margin-top:18px;padding:8px 26px;border:1px solid rgba(255,255,255,0.38);background:transparent;color:rgba(255,255,255,0.85);border-radius:20px;cursor:pointer;font-size:12px;letter-spacing:0.18em;font-family:inherit;transition:background 0.2s;">${btnLabel}</button>` : ''}
        `;

        this.songWrapper.appendChild(card);
        this._tutCard = card;

        requestAnimationFrame(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateX(-50%) translateY(0)';
        });

        const dismiss = () => {
            clearTimeout(this._tutCardTimer);
            card.style.opacity = '0';
            card.style.transform = 'translateX(-50%) translateY(-12px)';
            setTimeout(() => {
                if (card.parentNode) card.parentNode.removeChild(card);
                if (this._tutCard === card) this._tutCard = null;
            }, 500);
            if (onDismiss) onDismiss();
        };

        const btn = card.querySelector('.tut-btn');
        if (btn) {
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.12)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
            btn.addEventListener('click', dismiss);
        }

        if (duration) {
            this._tutCardTimer = setTimeout(dismiss, duration);
        }

        return dismiss;
    }





    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        clearTimeout(this._tutCardTimer);
        clearTimeout(this._drawAutoConfirmTimer);
        clearTimeout(this._introAutoTimer);
        clearTimeout(this._gaugeResetTimer);

        // オーブゲージのDOM・注入スタイルのクリーンアップ
        if (this.orbGaugeEl && this.orbGaugeEl.parentNode) {
            this.orbGaugeEl.parentNode.removeChild(this.orbGaugeEl);
        }
        this.orbGaugeEl = null;
        this.orbGaugeFillEl = null;
        this.orbGaugeCountEl = null;
        const orbGaugeStyle = document.getElementById('orchestra-orb-gauge-style');
        if (orbGaugeStyle && orbGaugeStyle.parentNode) {
            orbGaugeStyle.parentNode.removeChild(orbGaugeStyle);
        }

        if (this.mainLyricEl && this.mainLyricEl.parentNode) {
            this.mainLyricEl.parentNode.removeChild(this.mainLyricEl);
            this.mainLyricEl = null;
        }
        const styleEl = document.getElementById('orchestra-style');
        if (styleEl) {
            styleEl.parentNode.removeChild(styleEl);
        }

        if (this._tutCard && this._tutCard.parentNode) {
            this._tutCard.parentNode.removeChild(this._tutCard);
        }
        if (this._introOverlay && this._introOverlay.parentNode) {
            this._introOverlay.parentNode.removeChild(this._introOverlay);
        }
        this._introOverlay = null;
        // 未タップで残ったタイトル文字スプライトを破棄(イントロ中の離脱に備える)。
        if (this.introTitleSprites && this.introTitleSprites.length) {
            this.introTitleSprites.forEach(sp => {
                this.scene.remove(sp);
                if (sp.material) { if (sp.material.map) sp.material.map.dispose(); sp.material.dispose(); }
            });
            this.introTitleSprites = [];
        }
        // イントロ中にESC等で離脱した場合でも、左上ヘッダーを通常表示へ確実に戻す。
        if (this._headerDimmed) { this._setHeaderDimmed(false); this._headerDimmed = false; }

        // Cleanup VRM Avatar
        if (this.currentVRM) {
            this.scene.remove(this.currentVRM.scene);
            this.disposeVRM(this.currentVRM);
            this.currentVRM = null;
        }

        // 序盤の予兆オーブのクリーンアップ(map は共有の glowTexture なので個別 dispose しない)
        this.premonitionOrbs.forEach(sp => {
            this.scene.remove(sp);
            if (sp.material) sp.material.dispose();
        });
        this.premonitionOrbs = [];

        // 色彩交響オーブのクリーンアップ
        this.resonateOrbs.forEach(orb => {
            this.scene.remove(orb);
            if (orb.material) orb.material.dispose();
        });
        this.resonateOrbs = [];
        this.sublimatedGroupIndices = null;
        if (this.orbGeometry) {
            this.orbGeometry.dispose();
            this.orbGeometry = null;
        }

        this.activeSprites.forEach(s => {
            this.disposeSprite(s);
        });
        
        this.drawnLines.forEach(line => {
            line.geometry.dispose();
            line.material.dispose();
        });
        
        this.fireworks.forEach(fw => {
            fw.geometry.dispose();
            fw.material.dispose();
        });
        
        if (this.glowTexture) {
            this.glowTexture.dispose();
            this.glowTexture = null;
        }

        if (this.milkyWay) {
            this.scene.remove(this.milkyWay);
            this.milkyWay.geometry.dispose();
            if (this.milkyWay.material.map) this.milkyWay.material.map.dispose();
            this.milkyWay.material.dispose();
            this.milkyWay = null;
        }
        if (this.auroras) {
            this.auroras.forEach(a => {
                this.scene.remove(a);
                if (a.material.map) a.material.map.dispose();
                a.material.dispose();
            });
            this.auroras = [];
        }

        if (this.starGeometry) this.starGeometry.dispose();
        if (this.starMaterial) this.starMaterial.dispose();
        if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss?.(); }
        
        this.container.removeEventListener('click', this.boundOnClick);
        this.container.removeEventListener('mousemove', this._boundOnMouseMove);
        this.container.removeEventListener('pointerdown', this.boundOnPointerDown);
        this.container.removeEventListener('pointermove', this.boundOnPointerMove);
        window.removeEventListener('pointerup', this.boundOnPointerUp);

        if (this.constellationLineMesh) {
            this.scene.remove(this.constellationLineMesh);
            this.constellationLineMesh.geometry.dispose();
            this.constellationLineMesh.material.dispose();
        }
        if (this.guideLineMesh) {
            this.scene.remove(this.guideLineMesh);
            this.guideLineMesh.geometry.dispose();
            this.guideLineMesh.material.dispose();
        }

        super.destroy();
    }

    // VRM humanoid layout configuration for zero-gravity漂いポーズ
    setupRelaxedPose(vrm) {
        if (!vrm || !vrm.humanoid) return;

        const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');

        // 新VRMは上腕ロール軸が逆: 左+/右- で手を下ろした脱力状態
        if (leftUpperArm) leftUpperArm.rotation.z = Math.PI / 2.8;
        if (rightUpperArm) rightUpperArm.rotation.z = -Math.PI / 2.8;
        if (leftLowerArm) leftLowerArm.rotation.y = Math.PI / 12; // 肘をわずかに前に曲げる
        if (rightLowerArm) rightLowerArm.rotation.y = -Math.PI / 12; // 肘をわずかに前に曲げる

        const leftUpperLeg = vrm.humanoid.getNormalizedBoneNode('leftUpperLeg');
        const rightUpperLeg = vrm.humanoid.getNormalizedBoneNode('rightUpperLeg');
        const leftLowerLeg = vrm.humanoid.getNormalizedBoneNode('leftLowerLeg');
        const rightLowerLeg = vrm.humanoid.getNormalizedBoneNode('rightLowerLeg');

        if (leftUpperLeg) leftUpperLeg.rotation.z = Math.PI / 24;
        if (rightUpperLeg) rightUpperLeg.rotation.z = -Math.PI / 24;
        if (leftLowerLeg) leftLowerLeg.rotation.x = -Math.PI / 18;
        if (rightLowerLeg) rightLowerLeg.rotation.x = -Math.PI / 18;
    }

    // クランプ制限付きのボーン回転 LookAt 制御メソッド
    lookAtTarget(bone, targetWorldPos, maxYaw = 0.7, maxPitch = 0.4) {
        if (!bone || !this.currentVRM) return;
        const boneWorldPos = bone.getWorldPosition(new THREE.Vector3());
        const diff = targetWorldPos.clone().sub(boneWorldPos);
        
        // Mikuのシーン（体全体）の向きに対するローカル座標系での差分ベクトルに変換
        const localDiff = diff.clone().applyQuaternion(this.currentVRM.scene.quaternion.clone().invert());
        
        // baseMikuRotY が Math.PI の場合、顔の正面はローカル -Z
        // baseMikuRotY が 0 の場合、顔の正面はローカル +Z として追従計算を行う
        const isRotatedY = Math.abs(this.baseMikuRotY - Math.PI) < 0.1;
        let yaw, pitch;
        if (isRotatedY) {
            yaw = Math.atan2(-localDiff.x, -localDiff.z);
            pitch = Math.atan2(localDiff.y, Math.sqrt(localDiff.x * localDiff.x + localDiff.z * localDiff.z));
        } else {
            yaw = Math.atan2(localDiff.x, localDiff.z);
            pitch = -Math.atan2(localDiff.y, Math.sqrt(localDiff.x * localDiff.x + localDiff.z * localDiff.z));
        }
        
        // 関節の可動範囲（人間らしい自然な角度）にクランプ
        yaw = Math.max(-maxYaw, Math.min(maxYaw, yaw));
        pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
        
        // 角度を設定
        bone.rotation.y = yaw;
        bone.rotation.x = pitch;
    }

    // 歌詞タップアニメーションのトリガーメソッド
    triggerMikuTap(sprite) {
        if (!this.currentVRM || !this.relaxedQuaternions) return;
        
        // 既にタップアニメーション進行中の場合は、新たなタップ処理を無視して多重動作を防ぐ
        if (this.tapAnimation) {
            return;
        }

        this.hasTapped = true; // Mark as tapped to stop auto-positioning based on scale
        this._tapDesired = null; // ローパス目標を初期化(前回タップの残りを持ち越さない)

        // Reset SpringBone physics to prevent hair twisting or jittering on sudden starting motion
        if (this.currentVRM.springBoneManager) {
            this.currentVRM.springBoneManager.reset();
        }

        // 歌詞スプライトの上昇・揺れ動作をフリーズ
        sprite.userData.isBeingTapped = true;
        const targetWorldPos = sprite.position.clone();
        
        // 歌詞が画面の左右どちらにあるかで、左腕・右腕のどちらを使用するか選択。
        // ただしサビ(正面=rotation.y≈π)ではミクが鏡像になり左右が反転するため、出す腕も反転させる。
        // (背面時: ミクの右手は画面右側 / 正面時: ミクの右手は画面左側)
        let arm = targetWorldPos.x < 0 ? 'left' : 'right';
        if ((this._faceFront || 0) > 0.5) arm = (arm === 'left') ? 'right' : 'left';

        this.tapAnimation = {
            sprite: sprite,
            arm: arm,
            targetWorldPos: targetWorldPos,
            elapsed: 0,
            duration: 1.8,   // 全体のアニメーション時間 (秒) - よりゆったりと滑らかな飛行に延長
            peakTime: 0.9,   // タッチ接点に手が到達する時間 (秒) - 0.9秒かけて滑らかに接近
            sublimated: false
        };
    }

    // オーブ誕生時の予兆フレア。上向きに尾を引く少数の火花で「花火の種」感を出す(軽量)。
    // 既存の fireworks 更新ループ(寿命1800ms/加算合成)にそのまま乗せて使い回す。
    spawnOrbBirthFlare(color, targetPos) {
        const geo = new THREE.BufferGeometry();
        const count = 18; // ごく軽量
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            positions[i*3] = targetPos.x;
            positions[i*3+1] = targetPos.y;
            positions[i*3+2] = targetPos.z;
            // 上方へ尾を引く扇状の弱い噴き上がり
            const theta = Math.random() * Math.PI * 2;
            const up = 0.18 + Math.random() * 0.22;
            const lateral = 0.06 + Math.random() * 0.10;
            velocities.push(new THREE.Vector3(
                Math.cos(theta) * lateral,
                up,
                Math.sin(theta) * lateral
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: color,
            size: 0.22,
            map: this.glowTexture,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0.9,
            depthWrite: false
        });
        const particles = new THREE.Points(geo, mat);
        particles.userData = { velocities, birth: Date.now() };
        this.scene.add(particles);
        this.fireworks.push(particles);
    }

    // 接触接点でのきらめきスパークルエフェクト生成
    spawnTapSparkles(color, targetPos) {
        const geo = new THREE.BufferGeometry();
        const count = 40; // 軽量な40粒子バースト
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            positions[i*3] = targetPos.x;
            positions[i*3+1] = targetPos.y;
            positions[i*3+2] = targetPos.z;
            
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const speed = 0.2 + Math.random() * 0.35;
            velocities.push(new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.sin(phi) * Math.sin(theta) * speed,
                Math.cos(phi) * speed
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ 
            color: color, 
            size: 0.25, 
            map: this.glowTexture, 
            blending: THREE.AdditiveBlending, 
            transparent: true, 
            opacity: 1.0,
            depthWrite: false
        });
        const particles = new THREE.Points(geo, mat);
        particles.userData = { velocities, birth: Date.now() };
        this.scene.add(particles);
        this.fireworks.push(particles);
    }

    // Comprehensive hierarchical resource clean-up to prevent memory leaks
    disposeVRM(vrm) {
        if (!vrm) return;
        vrm.scene.traverse((obj) => {
            if (obj.geometry) {
                obj.geometry.dispose();
            }
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((m) => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    });
                } else {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                }
            }
        });
    }
}
