import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { sfx } from '../core/sfx.js';
import { quality } from '../core/quality.js';
import { BaseSong } from './BaseSong.js';
import { settleSpringBones, disposeVRM } from '../utils/vrm.js';
import { playerManager } from '../core/player.js';
import { unlockAudio } from '../core/audioUnlock.js';
import { groupPhraseWordsByMinLength, findGroupForWord } from '../utils/lyricGroups.js';

export class SongTakeover extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.debris = [];

        // AES-256-GCM key (generated once per scene, non-extractable)
        this._cryptoKey = null;
        this._cryptoReady = false;

        this.phraseTargets = [];
        this.lastPhraseStart = -1;
        this.lastGroupStartTime = -1;
        this.takenCount = 0;
        this.totalCount = 0;

        this.isClimax = false;
        this.prevIsClimax = false;

        this.scoreEl = null;

        this._debrisEdgesGeo = null;
        this._debrisMat = null;
        this.allGroups = [];
        this.bgTiles = {};
        this.lyricCardBuilt = false; // 歌詞カード構築済みフラグ（update内で遅延構築・成功時にtrue）

        // ── 侵食 / コンボ / TAKEOVER COMPLETE 用の状態 ──
        this.combo = 0;                  // 現在の連続解読数
        this.maxCombo = 0;               // 最大コンボ（成果サマリー用）
        this._lastDecodeAt = 0;          // 直前の解読時刻 (performance.now)
        this._comboHideTimer = null;     // コンボ表示の自動消灯タイマー
        this.comboEl = null;
        this.erosionEl = null;           // 赤侵食オーバーレイ
        this._erosionStage = 0;          // 0〜4 の侵食段階（CSSクラス切替）
        this._completeFired = false;     // TAKEOVER COMPLETE は一度だけ
        this._completeLeadMs = 8000;     // 曲終わりの何ms前に完走演出を起動するか
        this._rebootTimers = [];         // 再起動シーケンスのタイマー群
        this.rebootEl = null;
        // 奪還カラー補間用（シーン背景: 敵に支配された赤 → 奪還したシアン）
        this._bgColorFrom = new THREE.Color(0x2a0008);
        this._bgColorTo = new THREE.Color(0x001712);

        // ── 陣取り（緑の制圧領域 vs 赤の侵食）リアルタイムモデル ──
        // 旧実装は takenCount/totalCount の単調増加で侵食率が決まる静的モデルだった。
        // ここでは「制圧率 greenCoverage(0〜1)」を主指標にし、タップで広げ・無操作で
        // じわじわ赤に押し戻される綱引きにする。曲終わりに 0.5 以上なら CLEAR。
        this.greenCoverage = 0.12;       // 開幕は赤優勢（敵に支配された状態）
        this.territoryEl = null;         // 緑（奪還）領域オーバーレイ（下からせり上がる）
        this._lastFrameAt = 0;           // 制圧率の時間減衰用 dt 計測（performance.now）
        this._lastSummaryAt = 0;         // 成果サマリー更新の間引き用
        this._outcome = null;            // 'clear' | 'failed'（終局演出の分岐）
        this._clearKind = null;          // 'complete'(全解読) | 'majority'(制圧多数)

        // ── 制圧境界の演出（波打つ境界線・ノイズ粒子・解読パルス・サビ逆流） ──
        this._bfx = null;                // 境界エフェクト用キャンバス一式
        this._bfxPhase = 0;              // 波・粒子アニメの位相
        this._boundarySurge = 0;         // コンボ時の境界押し上げ（1→0で減衰）
        this._redDimUntil = 0;           // 赤ノイズを一瞬薄れさせる期限(performance.now)

        // ── 解読体験のテンポ改善（#113）──
        // 暗号歌詞を中央端末まわりへ寄せ、直前解読位置の近傍に出して
        // カーソル移動量を抑える。サビは端から中央へ流入させ密度を上げる。
        this._lastDecodePos = null;      // {xPct, yPct} 直前に解読した位置
        // チューニング（実機で踊らせて調整しやすいよう定数化）
        this._coverageGainBase = 0.075;     // 1解読あたりの制圧獲得
        this._coverageGainClimax = 0.055;   // サビは的が多いので一手の重みを下げる
        this._coverageComboBonus = 0.02;    // コンボ中の上乗せ
        this._coverageDecayBase = 0.020;    // 無操作時の毎秒減衰（赤の再侵食）
        this._coverageDecayClimax = 0.034;  // サビは侵食が速い＝疾走感
        this._clearThreshold = 0.5;         // 画面の半分以上が緑なら CLEAR

        // ── スタート時の WARNING 警告演出 ──
        this.warningEl = null;
        this._warningShown = false;      // WARNING は一度だけ（カーテンが開く瞬間に出す）
        this._introTimers = [];          // WARNING のタイマー群

        // ── ミクの状態演出: 暗号化シルエット → 完走で復号され彩色で出現 ──
        this._mikuAnchorPhase = 0;          // 呼吸位相（シルエット/グロー/VRMの脈動に使用）
        this._mikuColorCyan = new THREE.Color(0x00ffaa); // 解読色（シアン）
        this._mikuReclaim = false;          // 完走時にtrue: 復号して光を浴びる
        this._reclaimT = 0;                 // 復号ランプ進捗 0→1
        this.mikuGlowSprite = null;         // 背後のシアン逆光グロー
        this.mikuGlowMat = null;
        this.mikuGlowTexture = null;

        // ── 3DミクVRM ──
        // ゲーム中は「暗号化された姿」＝ダークなシルエット（影）として中央に佇み、
        // 完走で復号されると本来の彩色マテリアルへ戻り、背後の光を浴びて姿を現す。
        this.currentVRM = null;
        this.mikuVrmReady = false;
        this.isMobile = window.innerWidth < 768;
        this.mikuAmbient = null;
        this.mikuKeyLight = null;
        this.mikuRimLight = null;
        this._vrmT0 = performance.now();
        this._vrmLastRel = 0;
        // 暗号化シルエット用のダーク材質と、適用中フラグ
        this.mikuSilhouetteMat = null;
        this._silhouetteOn = false;
        this._silColorEnemy = new THREE.Color(0x8a2233);    // 敵支配色の暗赤（加算で淡く発光）
        this._silColorFreed = new THREE.Color(0x105a49);    // 奪還色の暗シアン
        // ミクの基準姿勢（中央に佇む。完走でもほぼこの位置で復号される）
        this._mikuVrmBaseY = -1.5;
        this._mikuVrmBaseZ = -2.2;
        this._mikuVrmScale = 4.2;

        this.boundOnResize = this.onResize.bind(this);
    }

    init() {
        this.initThree();
        this.initDebris();
        this.initMikuGlow();
        this.initMikuLights();
        this.loadMiku();
        this.initUI();
        this._initCrypto(); // async, completes well before first phrase
        window.addEventListener('resize', this.boundOnResize);
        this.isActive = true;

        // 歌詞カードの構築は update() 内で遅延実行する（buildLyricCard が
        // isTimerReady と video.firstPhrase の両方が揃うまで毎フレーム再試行）。
        // 旧実装は init 時に player.video の「存在」だけを見て一度だけ構築して
        // いたため、video はあってもフレーズ未ロード／前曲の stale video の瞬間に
        // 空のまま固定され、歌詞が一切出ないことがあった（ステージ選択へ戻って
        // 入り直すと表示される、という症状の原因）。
        super.init();

        // 初回誘導: 最初に出現した暗号ブロック(scrambled状態)の実位置にガイドを重ねる
        // (共通機構)。初回の復号成功で _revealTarget() 側が dismiss する。
        this.highlightFirstInteractable(() => {
            if (this.takenCount > 0) return null;
            const target = this.phraseTargets.find(t => t && t.state === 'scrambled' && t.el);
            if (!target) return null;
            const r = target.el.getBoundingClientRect();
            if (!r.width && !r.height) return null;
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, { label: 'タップして復号' });

        // ※ WARNING は init では出さない。ここで出すと選曲→曲ロードのカーテン裏で
        //   2.4秒が経過し、幕が開く頃には消えてしまう。実際にシーンが公開される
        //   タイミング（タイマー準備完了）で update() 側から一度だけ起動する。
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2a0008);
        this.scene.fog = new THREE.FogExp2(0x2a0008, 0.018);

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
        this.camera.position.set(0, 0, 10);

        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias });
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.__qpr = quality.effectivePixelRatio();
        // width/height:100% を必ず明示する。cssText で全消しすると setSize が付けた
        // CSSサイズが消え、高DPI環境ではキャンバスが描画バッファの実ピクセル寸法
        // (= window×devicePixelRatio) で表示され、ウィンドウからはみ出して画面内容が
        // 右へずれる（ミクが右端に寄って見えるバグの原因）。
        this.renderer.domElement.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;';
        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initDebris() {
        const tmp = new THREE.TetrahedronGeometry(0.7, 0);
        this._debrisEdgesGeo = new THREE.EdgesGeometry(tmp);
        tmp.dispose();
        this._debrisMat = new THREE.LineBasicMaterial({ color: 0x8c1430, transparent: true, opacity: 0.55 });

        for (let i = 0; i < 18; i++) {
            const m = new THREE.LineSegments(this._debrisEdgesGeo, this._debrisMat);
            m.position.set((Math.random()-0.5)*45, (Math.random()-0.5)*28, -8 - Math.random()*32);
            m.rotation.set(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
            // 疾走感: 回転を速め＋カメラ手前へ流れる前進速度を持たせる
            m.userData.rot = new THREE.Vector3(
                (Math.random()-0.5)*0.018, (Math.random()-0.5)*0.018, (Math.random()-0.5)*0.018
            );
            m.userData.vz = 0.05 + Math.random()*0.09; // 奥→手前へ流れる速度
            this.scene.add(m);
            this.debris.push(m);
        }
    }

    // ── 完走でミクが現れる「光」: 背後のシアン逆光グロー ──
    // （ゲーム中のミク表現は完走時の3D VRMが担うため、常設シルエットは置かない）
    initMikuGlow() {
        // 背後のシアン逆光グロー（完走の実体化でだけ点灯。普段は不可視）
        const gsize = 256;
        const gcanvas = document.createElement('canvas');
        gcanvas.width = gsize;
        gcanvas.height = gsize;
        const gctx = gcanvas.getContext('2d');
        const grad = gctx.createRadialGradient(gsize / 2, gsize / 2, 0, gsize / 2, gsize / 2, gsize / 2);
        grad.addColorStop(0, 'rgba(0,255,170,0.9)');
        grad.addColorStop(0.4, 'rgba(0,255,170,0.35)');
        grad.addColorStop(1, 'rgba(0,255,170,0)');
        gctx.fillStyle = grad;
        gctx.fillRect(0, 0, gsize, gsize);

        this.mikuGlowTexture = new THREE.CanvasTexture(gcanvas);
        this.mikuGlowMat = new THREE.SpriteMaterial({
            map: this.mikuGlowTexture,
            color: this._mikuColorCyan.clone(),
            transparent: true,
            opacity: 0,                    // 完走まで消灯
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        this.mikuGlowSprite = new THREE.Sprite(this.mikuGlowMat);
        this.mikuGlowSprite.scale.set(7, 7, 1);
        this.mikuGlowSprite.position.set(0, 0.5, -4.2); // シルエットより少し奥
        this.scene.add(this.mikuGlowSprite);
    }

    // ── VRMミク(MToon)用ライト ──
    // デブリ(LineBasicMaterial)やアンカー(Sprite)は無光で描画されるため、
    // ここで足すライトは完走時に現れるVRMミクだけを照らす（既存演出に影響なし）。
    initMikuLights() {
        this.mikuAmbient = new THREE.AmbientLight(0x66ffcc, 0.55);
        this.scene.add(this.mikuAmbient);

        // 正面キー光（顔・体を起こす）
        this.mikuKeyLight = new THREE.DirectionalLight(0xffffff, 1.7);
        this.mikuKeyLight.position.set(2.5, 5, 8);
        this.scene.add(this.mikuKeyLight);

        // 背後シアンのリム光（光の中から現れる逆光感）
        this.mikuRimLight = new THREE.DirectionalLight(0x00ffaa, 2.6);
        this.mikuRimLight.position.set(0, 3.5, -9);
        this.scene.add(this.mikuRimLight);
    }

    // ── ミクVRMの読み込み。ゲーム中は暗号化シルエット（影）として中央に佇ませる ──
    loadMiku() {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        loader.load(
            import.meta.env.BASE_URL + 'assets/models/model_miku.vrm',
            (gltf) => {
                if (!this.isActive) { disposeVRM(gltf.userData.vrm, { skipMaterials: [this.mikuSilhouetteMat] }); return; }
                const vrm = gltf.userData.vrm;
                this.currentVRM = vrm;
                vrm.scene.position.set(0, this._mikuVrmBaseY, this._mikuVrmBaseZ);
                vrm.scene.rotation.y = Math.PI; // y=0だと背中向き → π回して正面
                vrm.scene.scale.setScalar(this._mikuVrmScale);
                vrm.scene.traverse((obj) => {
                    if (obj.isMesh) { obj.castShadow = false; obj.frustumCulled = false; }
                });
                this.setupReclaimPose(vrm);
                settleSpringBones(vrm); // 開幕時にツインテールが逆立たないよう静止状態へ

                // 暗号化された姿＝ライティング無視のダークな単色シルエット。
                // 実マテリアル（顔の重ね描画含む）は各メッシュの userData に退避し、
                // 完走時に復号＝そのまま戻すので顔の描画順は壊れない。
                // 加算合成で淡く発光させ、暗い背景でも輪郭が読める「暗号化ファントム」に。
                this.mikuSilhouetteMat = new THREE.MeshBasicMaterial({
                    color: this._silColorEnemy.clone(),
                    transparent: true,
                    opacity: 0.55,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending
                });
                this._applyMikuSilhouette(vrm);

                this.scene.add(vrm.scene);
                this.mikuVrmReady = true;
            },
            undefined,
            (error) => { console.error('[TAKEOVER] Failed to load Miku VRM:', error); }
        );
    }

    // 全メッシュの材質を暗号化シルエット（ダーク単色）へ差し替え、実材質は退避
    _applyMikuSilhouette(vrm) {
        if (!vrm || this._silhouetteOn || !this.mikuSilhouetteMat) return;
        vrm.scene.traverse((o) => {
            if (o.isMesh || o.isSkinnedMesh) {
                if (o.userData._origMat === undefined) o.userData._origMat = o.material;
                o.material = this.mikuSilhouetteMat;
            }
        });
        this._silhouetteOn = true;
    }

    // 復号: 退避してあった本来の彩色マテリアルへ戻す
    _restoreMikuMaterials(vrm) {
        if (!vrm || !this._silhouetteOn) return;
        vrm.scene.traverse((o) => {
            if ((o.isMesh || o.isSkinnedMesh) && o.userData._origMat !== undefined) {
                o.material = o.userData._origMat;
            }
        });
        this._silhouetteOn = false;
    }

    // スプリングボーン更新（ツインテールが自然に揺れる）用の dt 計測ヘルパ
    _tickVrm() {
        const vrm = this.currentVRM;
        if (!vrm || typeof vrm.update !== 'function') return;
        const rel = (performance.now() - this._vrmT0) / 1000;
        let dt = this._vrmLastRel ? Math.min(0.05, rel - this._vrmLastRel) : 0.016;
        if (dt <= 0) dt = 0.016;
        this._vrmLastRel = rel;
        vrm.update(dt);
    }

    // 凱旋らしい落ち着いた立ち姿（腕は軽く下ろし、脚を僅かに開く）
    setupReclaimPose(vrm) {
        if (!vrm || !vrm.humanoid) return;
        const g = (n) => vrm.humanoid.getNormalizedBoneNode(n);
        const lU = g('leftUpperArm'),  rU = g('rightUpperArm');
        const lL = g('leftLowerArm'),  rL = g('rightLowerArm');
        if (lU) lU.rotation.z = -Math.PI / 2.9;
        if (rU) rU.rotation.z =  Math.PI / 2.9;
        if (lL) lL.rotation.y =  Math.PI / 14;
        if (rL) rL.rotation.y = -Math.PI / 14;
        const lUl = g('leftUpperLeg'), rUl = g('rightUpperLeg');
        if (lUl) lUl.rotation.z =  Math.PI / 32;
        if (rUl) rUl.rotation.z = -Math.PI / 32;
    }

    // 完走中の毎フレーム: 暗号化シルエットを復号して彩色へ戻し、光を浴びて姿を現す
    _updateMikuReclaimVRM(ease, breathe) {
        const vrm = this.currentVRM;
        if (!vrm) return;
        if (!vrm.scene.visible) vrm.scene.visible = true;

        // 復号: シルエット材質 → 本来の彩色マテリアルへ戻す（顔の重ね描画はそのまま）。
        // 暗→明の切替わりは背後グローのブルームが覆い隠すので、その瞬間に行う。
        if (this._silhouetteOn && ease > 0.12) this._restoreMikuMaterials(vrm);

        // 既に中央に佇んでいるので、わずかに前へ歩み出て光を浴びる（大きな移動はしない）
        const y = this._mikuVrmBaseY + breathe * 0.02;
        const z = this._mikuVrmBaseZ - ease * 0.3;
        const sc = this._mikuVrmScale * (1 + ease * 0.04);
        vrm.scene.position.set(0, y, z);
        vrm.scene.scale.setScalar(sc);

        // 軽い呼吸
        const spine = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('spine');
        if (spine) spine.rotation.x = breathe * 0.03 - 0.015;

        this._tickVrm();
    }

    initUI() {
        if (!document.getElementById('takeover-style')) {
            const style = document.createElement('style');
            style.id = 'takeover-style';
            style.textContent = `
                @keyframes toScramblePulse {
                    0%,100% { opacity:0.45; }
                    50%      { opacity:1;    }
                }
                @keyframes toDecodeFlash {
                    0%   { text-shadow:0 0 30px #00ffaa, 0 0 60px #00ffaa; letter-spacing:10px; }
                    100% { text-shadow:0 0 12px #00ffaa; letter-spacing:2px; }
                }
                @keyframes toFadeOut {
                    to { opacity:0; transform:translateY(-24px); }
                }
                /* #116: 解読クリック直後、暗号文字を一瞬だけ崩壊させる(横ブレ＋色収差) */
                @keyframes toGlitchJitter {
                    0%   { transform:translateX(0)    skewX(0);    }
                    25%  { transform:translateX(-3px) skewX(-7deg);}
                    50%  { transform:translateX(3px)  skewX(5deg); }
                    75%  { transform:translateX(-2px) skewX(4deg); }
                    100% { transform:translateX(0)    skewX(0);    }
                }
                .to-phrase.to-glitch-collapse {
                    color:#ffffff;
                    border-color:#ffffff;
                    text-shadow: 0 0 14px #00ffaa, 2px 0 0 rgba(255,58,58,0.9), -2px 0 0 rgba(0,224,255,0.9);
                    box-shadow: 0 0 26px rgba(0,255,170,0.7), inset 0 0 14px rgba(0,255,170,0.35);
                    animation: toGlitchJitter 0.13s steps(2,end) 1;
                }
                .to-phrase {
                    position:absolute;
                    font-family:"Courier New",monospace;
                    font-weight:bold;
                    text-align:left;
                    /* 内容を縦中央寄せ。ヒント行の有無で箱の見え方が変わらないようにする */
                    display:flex;
                    flex-direction:column;
                    justify-content:center;
                    align-items:flex-start;
                    padding:15px 34px;
                    background:#05000a; /* Solid black/purple background, no transparency */
                    border:1px solid rgba(255, 58, 58, 0.3);
                    letter-spacing:2px;
                    pointer-events:auto;
                    user-select:none;
                    white-space:nowrap;
                    z-index:15;
                    transition:all 0.15s cubic-bezier(0.25, 0.8, 0.25, 1);
                    font-size: var(--to-font-size, 14px);
                    border-radius: 6px;
                }
                @container (max-width: 768px) {
                    .to-phrase {
                        font-size: calc(var(--to-font-size, 14px) * 0.9) !important;
                        padding: 10px 20px; /* Easy-to-tap large padding on mobile */
                    }
                    .to-phrase.scrambled { min-height: 50px; }
                }
                /* 暗号化された歌詞 = 赤(敵に支配されたロック状態) */
                .to-phrase.scrambled {
                    color:#ff3a3a;
                    cursor:pointer;
                    /* ヒント行の有無で高さが変わらないよう、最初の「良いサイズ」で統一する。
                       box-sizing:border-box のため min-height はパディング込みの総高さ。 */
                    min-height:64px;
                    border-color: rgba(255, 58, 58, 0.6);
                    text-shadow: 0 0 8px rgba(255, 58, 58, 0.6);
                    box-shadow: 0 0 12px rgba(255, 58, 58, 0.2), inset 0 0 8px rgba(255, 58, 58, 0.1);
                    animation:toScramblePulse .75s ease-in-out infinite;
                }
                .to-phrase.scrambled:hover {
                    color:#ffffff;
                    border-color:#ff3a3a;
                    box-shadow: 0 0 25px rgba(255, 58, 58, 0.8), inset 0 0 12px rgba(255, 58, 58, 0.3);
                    text-shadow: 0 0 12px #ff3a3a;
                    transform: scale(1.06);
                }
                .to-phrase.scrambled:active {
                    transform: scale(0.95);
                    box-shadow: 0 0 10px rgba(255, 58, 58, 0.5);
                }
                /* 見た目より広いクリック判定（押したのに外れるストレスを軽減／#113 提案5）。
                   透明な ::before が要素の当たり判定を外側へ広げる。 */
                .to-phrase.scrambled::before {
                    content: "";
                    position: absolute;
                    inset: -16px;
                    border-radius: 12px;
                }
                /* サビ中の流入アニメ（端→中央へ滑り込む） */
                .to-phrase.flow-in {
                    transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1),
                                opacity 0.5s ease;
                }
                /* 解読された歌詞 = 緑(奪還) */
                .to-phrase.decoded {
                    color:#00ffaa;
                    border-color:#00ffaa;
                    cursor:default;
                    pointer-events:none;
                    animation:toDecodeFlash .35s ease-out forwards;
                }
                .to-phrase.expired {
                    pointer-events:none;
                    animation:toFadeOut .4s ease-out forwards;
                }
                .to-hint {
                    font-size:10px;
                    color:#333;
                    letter-spacing:3px;
                    margin-top:5px;
                    text-align:center;
                }
                @keyframes toMonitorFlicker {
                    0%, 100% { opacity: 0.99; }
                    50% { opacity: 0.96; }
                }
                .to-monitor {
                    position: absolute;
                    top: 12%;
                    left: 5%;
                    width: 90%;
                    height: 72%;
                    background: radial-gradient(circle, rgba(24, 3, 8, 0.88) 0%, rgba(8, 0, 2, 0.96) 100%);
                    border: 2px solid #8c1430;
                    border-radius: 8px;
                    box-shadow:
                        0 0 25px rgba(180, 24, 48, 0.55),
                        inset 0 0 40px rgba(150, 20, 48, 0.45);
                    z-index: 5;
                    pointer-events: none;
                    overflow: hidden;
                    animation: toMonitorFlicker 0.15s infinite;
                }
                .to-monitor-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    background: rgba(140, 16, 40, 0.16);
                    border-bottom: 1px solid rgba(160, 24, 48, 0.3);
                    font-family: "Courier New", monospace;
                    font-size: 11px;
                    color: #d05068;
                    letter-spacing: 1px;
                }
                .to-monitor-dot {
                    display: inline-block;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                }
                .to-monitor-dot.red { background: #ff5f56; }
                .to-monitor-dot.yellow { background: #ffbd2e; }
                .to-monitor-dot.green { background: #27c93f; }
                .to-monitor-title {
                    margin-left: 10px;
                    font-weight: bold;
                }
                .to-monitor-scanlines {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(
                        rgba(18, 10, 36, 0) 50%, 
                        rgba(0, 0, 0, 0.25) 50%
                    );
                    background-size: 100% 4px;
                    z-index: 2;
                    pointer-events: none;
                }
                .to-monitor-grid {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-image:
                        linear-gradient(rgba(180, 30, 46, 0.05) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(180, 30, 46, 0.05) 1px, transparent 1px);
                    background-size: 40px 40px;
                    background-position: center;
                    z-index: 1;
                    pointer-events: none;
                }
                .to-monitor-footer {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 16px;
                    background: rgba(140, 16, 40, 0.08);
                    border-top: 1px solid rgba(160, 24, 48, 0.2);
                    font-family: "Courier New", monospace;
                    font-size: 10px;
                    color: rgba(208, 80, 104, 0.7);
                    letter-spacing: 1px;
                    z-index: 3;
                }
                .to-monitor-status {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .to-monitor-status::before {
                    content: "";
                    display: inline-block;
                    width: 6px;
                    height: 6px;
                    background: #ff3a3a;
                    border-radius: 50%;
                    box-shadow: 0 0 8px #ff3a3a;
                }
                @container (max-width: 768px) {
                    .to-monitor-header {
                        padding: 6px 12px;
                        font-size: 9px;
                    }
                    .to-monitor-footer {
                        padding: 6px 12px;
                        font-size: 8px;
                    }
                }

                /* ── 陣取りオーバーレイ: 上から赤(敵)、下から緑(奪還)がせめぎ合う ── */
                /* 高さは JS が制圧率(greenCoverage)から毎フレーム制御する。 */
                .to-erosion-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 50%;   /* JSが (1 - greenCoverage) を反映 */
                    /* 境界(下端=0%)はクッキリした線を to-boundary-canvas が描くので、
                       ここでは端を透明へフェードさせて二重線にならないようにする。 */
                    background:
                        linear-gradient(to top,
                            rgba(255, 48, 54, 0.0) 0%,
                            rgba(255, 48, 54, 0.42) 14%,
                            rgba(190, 26, 44, 0.34) 60%,
                            rgba(255, 58, 58, 0.42) 100%);
                    mix-blend-mode: screen;
                    transition: height 0.22s linear;
                    pointer-events: none;
                    z-index: 6;
                }
                .to-territory-overlay {
                    position: absolute;
                    bottom: 0; left: 0;
                    width: 100%; height: 12%;   /* JSが greenCoverage を反映 */
                    /* 境界(上端=0%)は透明へフェード。クッキリ線はキャンバス側が担う。 */
                    background:
                        linear-gradient(to bottom,
                            rgba(0, 255, 170, 0.0) 0%,
                            rgba(0, 255, 170, 0.46) 14%,
                            rgba(0, 210, 142, 0.30) 60%,
                            rgba(0, 255, 170, 0.46) 100%);
                    mix-blend-mode: screen;
                    transition: height 0.22s linear, filter 0.4s ease;
                    pointer-events: none;
                    z-index: 6;
                }
                /* 赤×緑の境界を描くキャンバス（波打ち・ノイズ粒子・解読パルス・サビ逆流） */
                .to-boundary-canvas {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    mix-blend-mode: screen;
                    pointer-events: none;
                    z-index: 7;
                }
                @keyframes toTerritoryPulse {
                    0%   { filter: brightness(2.4) saturate(1.5); }
                    100% { filter: brightness(1)   saturate(1);   }
                }
                .to-territory-overlay.pulse { animation: toTerritoryPulse 0.45s ease-out; }
                /* ── 奪還段階: ターミナル枠・ヘッダ・走査線が 赤(敵) → 緑(奪還) へ ── */
                .to-erode-1 .to-monitor { border-color: #b0562a; box-shadow: 0 0 25px rgba(190, 100, 40, 0.5), inset 0 0 40px rgba(170, 90, 40, 0.4); }
                .to-erode-1 .to-monitor-header { color: #e08a4a; border-bottom-color: rgba(190, 100, 40, 0.4); background: rgba(150, 80, 30, 0.16); }
                .to-erode-1 .to-monitor-status::before { background: #ff8a3a; box-shadow: 0 0 8px #ff8a3a; }
                .to-erode-2 .to-monitor { border-color: #8a9a2a; box-shadow: 0 0 28px rgba(150, 180, 50, 0.5), inset 0 0 45px rgba(130, 160, 50, 0.42); }
                .to-erode-2 .to-monitor-header { color: #c0d050; border-bottom-color: rgba(150, 180, 50, 0.4); background: rgba(110, 130, 30, 0.16); }
                .to-erode-2 .to-monitor-status::before { background: #d0e030; box-shadow: 0 0 8px #d0e030; }
                .to-erode-3 .to-monitor { border-color: #1c9e7e; box-shadow: 0 0 34px rgba(0, 255, 170, 0.5), inset 0 0 55px rgba(0, 200, 140, 0.42); }
                .to-erode-3 .to-monitor-header { color: #80ffd0; border-bottom-color: rgba(0, 255, 170, 0.4); background: rgba(0, 130, 90, 0.18); }
                .to-erode-3 .to-monitor-footer { color: rgba(128, 255, 208, 0.8); border-top-color: rgba(0, 255, 170, 0.3); background: rgba(0, 130, 90, 0.1); }
                .to-erode-3 .to-monitor-grid {
                    background-image:
                        linear-gradient(rgba(0, 255, 170, 0.07) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0, 255, 170, 0.07) 1px, transparent 1px);
                }
                .to-erode-3 .to-monitor-status::before { background: #00ffaa; box-shadow: 0 0 8px #00ffaa; }
                /* 100%: 世界が完全に赤一色 */
                .to-complete .to-monitor { border-color: #ff3a3a; box-shadow: 0 0 50px rgba(255, 58, 58, 0.8), inset 0 0 70px rgba(255, 58, 58, 0.45); }
                .to-complete .to-monitor-header { color: #ffb0b0; border-bottom-color: rgba(255, 58, 58, 0.6); background: rgba(255, 58, 58, 0.22); }
                .to-complete .to-monitor-footer { color: #ff9090; border-top-color: rgba(255, 58, 58, 0.5); background: rgba(255, 58, 58, 0.14); }
                .to-complete .to-monitor-status::before { background: #ff3a3a; box-shadow: 0 0 10px #ff3a3a; }
                .to-complete .to-monitor-dot.green,
                .to-complete .to-monitor-dot.yellow { background: #ff3a3a; }
                .to-complete .to-phrase.scrambled {
                    color: #ff8a8a;
                    border-color: rgba(255, 58, 58, 0.7);
                    text-shadow: 0 0 8px rgba(255, 58, 58, 0.7);
                    box-shadow: 0 0 12px rgba(255, 58, 58, 0.3), inset 0 0 8px rgba(255, 58, 58, 0.15);
                }
                /* 100%奪還: 世界がミクのシアンへ塗り替わる */
                .to-reclaim .to-monitor { border-color: #00ffaa; box-shadow: 0 0 50px rgba(0, 255, 170, 0.7), inset 0 0 70px rgba(0, 255, 170, 0.4); }
                .to-reclaim .to-monitor-header { color: #b0ffe6; border-bottom-color: rgba(0, 255, 170, 0.6); background: rgba(0, 255, 170, 0.18); }
                .to-reclaim .to-monitor-footer { color: #90ffd8; border-top-color: rgba(0, 255, 170, 0.5); background: rgba(0, 255, 170, 0.12); }
                .to-reclaim .to-monitor-status::before { background: #00ffaa; box-shadow: 0 0 10px #00ffaa; }
                .to-reclaim .to-monitor-dot.green,
                .to-reclaim .to-monitor-dot.yellow { background: #00ffaa; }
                .to-reclaim .to-monitor-grid {
                    background-image:
                        linear-gradient(rgba(0, 255, 170, 0.07) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0, 255, 170, 0.07) 1px, transparent 1px);
                }
                /* ── コンボ表示 ── */
                @keyframes toComboPop {
                    0%   { transform: translateX(-50%) scale(1.6); opacity: 0; }
                    35%  { transform: translateX(-50%) scale(1.0); opacity: 1; }
                    100% { transform: translateX(-50%) scale(1.0); opacity: 1; }
                }
                .to-combo {
                    position: absolute;
                    top: 40px;
                    left: 50%;
                    transform: translateX(-50%);
                    font-family: "Courier New", monospace;
                    font-size: 18px;
                    font-weight: bold;
                    letter-spacing: 5px;
                    color: #00ffaa;
                    text-shadow: 0 0 14px #00ffaa, 0 0 30px #00ffaa88;
                    pointer-events: none;
                    z-index: 21;
                    display: none;
                }
                .to-combo.show {
                    display: block;
                    animation: toComboPop 0.3s ease-out;
                }
                @container (max-width: 768px) {
                    .to-combo { font-size: 14px; top: 36px; letter-spacing: 3px; }
                }
                /* コンボ中の解読エフェクト強化 */
                @keyframes toComboDecodeFlash {
                    0%   { text-shadow: 0 0 45px #00ffaa, 0 0 90px #00ffaa, 0 0 120px #ffffff; letter-spacing: 14px; }
                    100% { text-shadow: 0 0 16px #00ffaa; letter-spacing: 2px; }
                }
                .to-phrase.decoded.to-combo-boost {
                    animation: toComboDecodeFlash 0.45s ease-out forwards;
                    box-shadow: 0 0 35px rgba(0, 255, 170, 0.9), inset 0 0 14px rgba(0, 255, 170, 0.4);
                }
                /* ── TAKEOVER COMPLETE: ブラックアウト→再起動シーケンス ── */
                .to-reboot-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    background: #000;
                    z-index: 60;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    pointer-events: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .to-reboot-overlay.on { opacity: 1; }
                .to-reboot-overlay.off { opacity: 0; transition: opacity 1.2s ease; }
                .to-reboot-lines {
                    font-family: "Courier New", monospace;
                    font-size: 15px;
                    color: #ff3a3a;
                    letter-spacing: 2px;
                    text-shadow: 0 0 10px #ff3a3a;
                    line-height: 2.1;
                    text-align: left;
                }
                @container (max-width: 768px) {
                    .to-reboot-lines { font-size: 11px; letter-spacing: 1px; padding: 0 14px; }
                }
                @keyframes toCursorBlink {
                    0%, 49% { opacity: 1; }
                    50%, 100% { opacity: 0; }
                }
                .to-reboot-line {
                    opacity: 0;
                    transform: translateY(4px);
                    transition: opacity 0.18s ease, transform 0.18s ease;
                }
                .to-reboot-line.shown { opacity: 1; transform: none; }
                .to-reboot-line.final {
                    font-size: 1.5em;
                    font-weight: bold;
                    letter-spacing: 6px;
                    margin-top: 10px;
                    text-shadow: 0 0 20px #ff3a3a, 0 0 50px #ff3a3a;
                }
                .to-reboot-line.shown::after {
                    content: "█";
                    margin-left: 4px;
                    animation: toCursorBlink 0.7s step-end infinite;
                }
                .to-reboot-line.shown:not(:last-child)::after { content: none; }
                /* 奪還版: ログをシアンに */
                .to-reboot-overlay.reclaim .to-reboot-lines { color: #00ffaa; text-shadow: 0 0 10px #00ffaa; }
                .to-reboot-overlay.reclaim .to-reboot-line.final { text-shadow: 0 0 20px #00ffaa, 0 0 50px #00ffaa; }
                /* 失敗版: ログは赤のまま、FAILED を強く光らせる */
                .to-reboot-overlay.failed .to-reboot-line.final {
                    color: #ff2a2a;
                    text-shadow: 0 0 20px #ff2a2a, 0 0 55px #ff2a2a;
                    animation: toWarnShake 0.32s steps(2) 3;
                }

                /* ── スタート時 WARNING（システム侵略アラート） ── */
                @keyframes toWarnFlash {
                    0%, 100% { opacity: 1; }
                    50%      { opacity: 0.45; }
                }
                @keyframes toWarnShake {
                    0%   { transform: translate(-50%, -50%) translate(0, 0); }
                    25%  { transform: translate(-50%, -50%) translate(-3px, 2px); }
                    50%  { transform: translate(-50%, -50%) translate(3px, -2px); }
                    75%  { transform: translate(-50%, -50%) translate(-2px, -3px); }
                    100% { transform: translate(-50%, -50%) translate(0, 0); }
                }
                @keyframes toWarnStripes {
                    0%   { background-position: 0 0; }
                    100% { background-position: 56px 0; }
                }
                .to-warning-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    z-index: 70;
                    pointer-events: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background:
                        repeating-linear-gradient(45deg,
                            rgba(255, 40, 40, 0.14) 0px, rgba(255, 40, 40, 0.14) 20px,
                            rgba(0, 0, 0, 0) 20px, rgba(0, 0, 0, 0) 40px),
                        radial-gradient(circle at 50% 50%, rgba(120, 0, 0, 0.5) 0%, rgba(20, 0, 0, 0.85) 100%);
                    animation: toWarnStripes 0.6s linear infinite, toWarnFlash 0.5s steps(2) infinite;
                    transition: opacity 0.5s ease;
                }
                .to-warning-overlay.out { opacity: 0; }
                .to-warning-core {
                    position: absolute;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    text-align: center;
                    font-family: "Courier New", monospace;
                    animation: toWarnShake 0.3s steps(2) infinite;
                }
                .to-warning-title {
                    font-size: clamp(34px, 11vw, 92px);
                    font-weight: bold;
                    letter-spacing: 10px;
                    color: #ff2a2a;
                    text-shadow: 0 0 18px #ff2a2a, 0 0 44px #ff0000, 4px 0 0 #00e0ff, -4px 0 0 #ff00a0;
                }
                .to-warning-sub {
                    margin-top: 14px;
                    font-size: clamp(11px, 3.4vw, 18px);
                    letter-spacing: 5px;
                    color: #ffd0d0;
                    text-shadow: 0 0 10px #ff3a3a;
                }
                .to-warning-bar {
                    margin-top: 10px;
                    font-size: clamp(9px, 2.6vw, 13px);
                    letter-spacing: 3px;
                    color: #ff7070;
                }
                /* 退場フェーズ1: ノイズグリッチ（速い揺れ＋色のちらつき） */
                @keyframes toWarnGlitchFlick {
                    0%, 100% { opacity: 1; filter: none; }
                    20%  { opacity: 0.65; filter: hue-rotate(-25deg) saturate(2.4); }
                    45%  { opacity: 1; filter: none; }
                    65%  { opacity: 0.55; filter: hue-rotate(25deg) brightness(1.5); }
                    85%  { opacity: 0.9; }
                }
                .to-warning-core.glitch {
                    animation: toWarnShake 0.07s steps(2) infinite,
                               toWarnGlitchFlick 0.16s steps(2) infinite;
                }
                /* 退場フェーズ2: 水平スライスに分解して左右へ飛散 */
                .to-warning-slices { z-index: 1; }
                .to-warning-slice {
                    font-family: "Courier New", monospace;
                    text-align: center;
                    will-change: transform, opacity;
                    transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.2, 1),
                                opacity 0.55s ease-out;
                    filter: drop-shadow(0 0 6px #ff2a2a);
                }
                @media (max-width: 768px) {
                    .to-warning-title { letter-spacing: 6px; }
                    .to-warning-sub { letter-spacing: 3px; }
                }
            `;
            document.head.appendChild(style);
        }

        this.bgContainer = document.createElement('div');
        this.bgContainer.className = 'to-bg-container';
        this.songWrapper.appendChild(this.bgContainer);

        // Reset card grid layout variables for fresh start
        this.allGroups = [];
        this.bgTiles = {};
        this.monitorEl = document.createElement('div');
        this.monitorEl.className = 'to-monitor';
        this.monitorEl.innerHTML = `
            <div class="to-monitor-header">
                <span class="to-monitor-dot red"></span>
                <span class="to-monitor-dot yellow"></span>
                <span class="to-monitor-dot green"></span>
                <span class="to-monitor-title">DECRYPTION_TERMINAL://SECURE_SESSION</span>
            </div>
            <div class="to-monitor-grid"></div>
            <div class="to-monitor-scanlines"></div>
            <div class="to-monitor-footer">
                <span>PORT: 5174 | AES-256-GCM</span>
                <span class="to-monitor-status">CONNECTION: SECURE</span>
            </div>
        `;
        this.songWrapper.appendChild(this.monitorEl);

        // 上から押し寄せる赤(敵)領域。高さ=制圧率の裏返し(1 - greenCoverage)。
        this.erosionEl = document.createElement('div');
        this.erosionEl.className = 'to-erosion-overlay';
        this.songWrapper.appendChild(this.erosionEl);

        // 下からせり上がる緑(奪還)領域。高さ=greenCoverage。タップで広がる。
        this.territoryEl = document.createElement('div');
        this.territoryEl.className = 'to-territory-overlay';
        this.songWrapper.appendChild(this.territoryEl);

        // 赤/緑のせめぎ合う境界の演出を担うキャンバス（波打ち・ノイズ粒子・パルス）。
        // DOMフィルの端は柔らかくし、クッキリした境界線はここが描く。
        this.initBoundaryFx();

        // コンボ表示
        this.comboEl = document.createElement('div');
        this.comboEl.className = 'to-combo';
        this.songWrapper.appendChild(this.comboEl);

        this.scoreEl = document.createElement('div');
        Object.assign(this.scoreEl.style, {
            position:'absolute', top:'14px', left:'50%',
            transform:'translateX(-50%)',
            fontFamily:'"Courier New",monospace',
            fontSize:'15px', fontWeight:'bold',
            letterSpacing:'4px', color:'#cc2244',
            textShadow:'0 0 12px #ff3a3a, 0 0 24px #ff3a3a88',
            pointerEvents:'none', zIndex:'20'
        });
        this.songWrapper.appendChild(this.scoreEl);
        this.updateScore();
    }

    updateScore() {
        // 主指標は制圧率(greenCoverage)。陣取りオーバーレイとゲージを同期する。
        this._applyTerritory();
        this._updateGauge();
    }

    // ── ゲージ表示: 制圧率(%)を上部に表示し、終了サマリーも更新する ────────
    _updateGauge() {
        if (!this.scoreEl) return;
        const cov = this.greenCoverage;
        const pct = Math.round(cov * 100);
        // 減衰で毎フレーム呼ばれるため、表示値が変わった時だけDOMへ書く（無駄なスタイル再計算を避ける）
        if (pct !== this._gaugePct) {
            this._gaugePct = pct;
            this.scoreEl.textContent = `RECLAIMED AREA: ${pct}%`;
            // 制圧率に応じて 赤(敵) → 緑(奪還) へ
            const cr = Math.round(255 - cov * 235);
            const cg = Math.round(40 + cov * 215);
            const cb = Math.round(40 + cov * 120);
            const shadow = cov < this._clearThreshold ? '#ff3a3a' : '#00ffaa';
            this.scoreEl.style.color = `rgb(${cr},${cg},${cb})`;
            this.scoreEl.style.textShadow = `0 0 ${5 + cov*18}px ${shadow}`;
        }

        // 成果サマリー（曲終了オーバーレイ用、終局演出が出るまで何度でも上書き可）
        // 減衰で毎フレーム呼ばれるため ~250ms に間引く。
        if (!this._completeFired) {
            const now = performance.now();
            if (now - this._lastSummaryAt > 250) {
                this._lastSummaryAt = now;
                this.setResultSummary({
                    lines: [`制圧率 ${pct}% ・ 最大コンボ ${this.maxCombo}`],
                    accentColor: '#00FFAA',
                    swatch: '#00FFAA'
                });
            }
        }
    }

    // ── タップで緑領域を広げる（無操作減衰の対抗手段） ──────────────────
    _gainTerritory(comboBoost) {
        const gain = (this.isClimax ? this._coverageGainClimax : this._coverageGainBase)
                   + (comboBoost ? this._coverageComboBonus : 0);
        this.greenCoverage = Math.min(1, this.greenCoverage + gain);
        this._applyTerritory();
        this._updateGauge();
        // 緑領域が一気に広がる手応え（パルス）
        if (this.territoryEl) {
            this.territoryEl.classList.remove('pulse');
            void this.territoryEl.offsetWidth; // reflow でアニメ再トリガー
            this.territoryEl.classList.add('pulse');
        }
    }

    // ── 制圧境界の演出 ───────────────────────────────────────────────
    // 赤(敵)と緑(奪還)の境界を 2D キャンバスで描く。境界は直線ではなく波打ち、
    // 沿ってノイズ粒子が湧き、解読でシアンのパルスが上へ走り、コンボで一気に
    // 押し上がり、サビ中は赤側から逆流ノイズが落ちてくる。
    initBoundaryFx() {
        const canvas = document.createElement('canvas');
        canvas.className = 'to-boundary-canvas';
        this.songWrapper.appendChild(canvas);
        this._bfx = {
            canvas,
            ctx: canvas.getContext('2d'),
            particles: [],   // 境界に湧くノイズ粒子
            pulses: [],      // 解読時にせり上がるシアンの光柱
            falls: [],       // サビ中に赤側から落ちる逆流ノイズ
            ripples: [],     // 解読位置から広がるシアンの波紋（コンボ/サビ・#113）
            bursts: [],      // #116: クリック地点のシアン衝撃波リング/中央フラッシュ
            burstParticles: [], // #116: クリック地点から散る四角いピクセル粒子/ノイズ線
            signals: [],     // #116: クリック地点→制圧境界/中央端末へ走る信号線
            w: 0, h: 0,
            dpr: Math.min(2, window.devicePixelRatio || 1),
        };
    }

    _resizeBoundaryCanvas() {
        const b = this._bfx;
        if (!b) return;
        const w = this.songWrapper.clientWidth || window.innerWidth;
        const h = this.songWrapper.clientHeight || window.innerHeight;
        if (b.w === w && b.h === h) return;
        b.w = w; b.h = h;
        b.canvas.width = Math.floor(w * b.dpr);
        b.canvas.height = Math.floor(h * b.dpr);
        b.ctx.setTransform(b.dpr, 0, 0, b.dpr, 0, 0);
    }

    // 解読成功時: 境界からシアンの光柱がせり上がる
    _spawnBoundaryPulse(x) {
        if (!this._bfx) return;
        this._bfx.pulses.push({ x, age: 0, life: 0.55 });
        if (this._bfx.pulses.length > 24) this._bfx.pulses.shift();
    }

    // コンボ/サビ中の解読: 解読位置からシアンの波紋が広がり「押し返す」手応えを出す（#113）
    _spawnDecodeRipple(x, y) {
        if (!this._bfx) return;
        this._bfx.ripples.push({ x, y, age: 0, life: 0.7 });
        if (this._bfx.ripples.length > 16) this._bfx.ripples.shift();
    }

    // #116: コンボ数・サビでクリック成功時のリアクションに段階差をつける。
    //   通常 < 3combo < 5combo の3段階＋サビ倍率。半径・粒子量・信号線・赤ノイズ抑制を制御。
    _decodeIntensity(comboBoost) {
        const combo = this.combo;
        const climax = this.isClimax;
        const tier = combo >= 5 ? 2 : combo >= 3 ? 1 : 0;
        const mul = climax ? 1.4 : 1; // サビは半径・粒子量を1.4倍
        return {
            tier, climax, mul, comboBoost,
            rings: tier >= 1 ? 2 : 1,                                   // 3combo〜でリング2枚
            particles: Math.round((tier >= 2 ? 16 : tier >= 1 ? 11 : 7) * mul),
            radius: (tier >= 2 ? 80 : tier >= 1 ? 64 : 52) * mul,
            signalToCenter: tier >= 2,    // 5combo〜: 中央端末へも信号線を走らせる
            dimRed: tier >= 2 || climax,  // 周囲の赤ノイズを一瞬薄れさせる
        };
    }

    // #116: 解読成功したクリック地点から、シアンの復号パルスを放つ。
    //   - 中央が白〜シアンに発光(フラッシュ)
    //   - 細いシアンのリングがデジタルノイズを含みつつ高速で広がる(段階差あり)
    //   - 四角いピクセル粒子と短いノイズ線が周囲へ散る
    //   - クリック地点から制圧境界(＋5combo〜は中央端末)へ信号線が走り、既存の
    //     境界押し上げ演出へ視覚的に接続する
    _spawnDecodeBurst(x, y, it) {
        const b = this._bfx;
        if (!b) return;

        // 中央フラッシュ
        b.bursts.push({ x, y, age: 0, life: 0.22, delay: 0, maxR: 11 * it.mul, flash: true });
        // 衝撃波リング(段階差: 通常1枚 / 3combo〜2枚)。少し時間差で重ねる。
        for (let i = 0; i < it.rings; i++) {
            b.bursts.push({
                x, y, age: 0, life: 0.45 + i * 0.12 + (it.climax ? 0.08 : 0),
                delay: i * 0.07, maxR: it.radius * (1 + i * 0.5),
                seed: Math.random() * Math.PI * 2,
            });
        }
        if (b.bursts.length > 40) b.bursts.splice(0, b.bursts.length - 40);

        // 四角いピクセル粒子＋短いノイズ線
        for (let i = 0; i < it.particles; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = (45 + Math.random() * 170) * it.mul;
            b.burstParticles.push({
                x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                age: 0, life: 0.4 + Math.random() * 0.3,
                size: 1 + Math.random() * 2.5, ang: a,
                line: Math.random() < 0.35,
            });
        }
        const pcap = this.isMobile ? 60 : 120;
        if (b.burstParticles.length > pcap) b.burstParticles.splice(0, b.burstParticles.length - pcap);

        // 信号線: クリック地点 → 直下の制圧境界へ。サビ/高コンボでは中央端末へも。
        const greenH = this.territoryEl ? this.greenCoverage * b.h : 0;
        const boundaryY = b.h - greenH;
        b.signals.push({ x0: x, y0: y, x1: x, y1: boundaryY, age: 0, life: 0.26 });
        if (it.signalToCenter) {
            b.signals.push({ x0: x, y0: y, x1: b.w / 2, y1: b.h * 0.42, age: 0, life: 0.3 });
        }
        if (b.signals.length > 24) b.signals.splice(0, b.signals.length - 24);
    }

    // 毎フレーム: 境界線の波打ち・粒子・パルス・サビ逆流を描く
    _updateBoundaryFx() {
        const b = this._bfx;
        if (!b || !this.territoryEl) return;
        this._resizeBoundaryCanvas();
        const ctx = b.ctx;
        const W = b.w, H = b.h;
        ctx.clearRect(0, 0, W, H);
        // 終局演出中は境界エフェクトを畳む（赤一色/シアン奪還の演出に委ねる）
        if (this._completeFired) return;

        const now = performance.now();
        const dt = this._bfxLastAt ? Math.min(0.05, (now - this._bfxLastAt) / 1000) : 0.016;
        this._bfxLastAt = now;

        this._bfxPhase += dt;
        if (this._boundarySurge > 0) {
            this._boundarySurge = Math.max(0, this._boundarySurge - dt * 2.2);
        }
        // #116: 高コンボ/サビ解読直後は赤ノイズを一瞬薄れさせ「焼き切った」感を出す。
        const redDim = now < this._redDimUntil ? 0.3 : 1;

        // 緑領域の実描画高さ(CSSトランジション込み)から境界 y を求め、DOMと完全同期。
        // clientHeight を読むと直前の style 書き込みで毎フレーム強制レイアウトになるため、
        // 制圧率から算出する（CSSトランジション分の遅れは見た目上ほぼ差が出ない）。
        const greenH = this.greenCoverage * H;
        const surgePush = this._boundarySurge * 26; // コンボで最大26px押し上げ
        const baseY = H - greenH - surgePush;

        const amp = (this.isClimax ? 11 : 7) + this._boundarySurge * 12;
        const ph = this._bfxPhase;
        const waveY = (x) => baseY
            + Math.sin(x * 0.018 + ph * 1.7) * amp
            + Math.sin(x * 0.045 - ph * 2.6) * amp * 0.5;

        // 1) 波打つ境界線（シアン本線 + 赤の薄い縁）
        ctx.save();
        const step = Math.max(6, Math.floor(W / 160));
        ctx.beginPath();
        for (let x = 0; x <= W + step; x += step) {
            const y = waveY(x);
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,255,170,0.9)';
        ctx.shadowColor = 'rgba(0,255,170,0.9)';
        ctx.shadowBlur = 14 + this._boundarySurge * 22;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,70,70,0.35)';
        ctx.stroke();
        ctx.restore();

        // 2) 境界に湧くノイズ粒子
        const spawnN = this.isMobile ? 1 : 2;
        for (let i = 0; i < spawnN; i++) {
            const x = Math.random() * W;
            b.particles.push({
                x, y: waveY(x) + (Math.random() - 0.5) * 6,
                vx: (Math.random() - 0.5) * 18,
                vy: (Math.random() - 0.5) * 24 - 8,
                life: 0.55 + Math.random() * 0.5, age: 0,
                cyan: Math.random() < 0.7,
            });
        }
        const cap = this.isMobile ? 50 : 90;
        if (b.particles.length > cap) b.particles.splice(0, b.particles.length - cap);

        // 3) サビ中: 赤側(境界より上)からノイズが落ちてくる
        if (this.isClimax) {
            const fN = this.isMobile ? 1 : 2;
            for (let i = 0; i < fN; i++) {
                const x = Math.random() * W;
                b.falls.push({ x, y: Math.random() * Math.max(0, baseY - 20),
                               vy: 70 + Math.random() * 90, life: 1.6, age: 0 });
            }
            if (b.falls.length > 80) b.falls.splice(0, b.falls.length - 80);
        }

        // 粒子の更新・描画
        ctx.save();
        for (let i = b.particles.length - 1; i >= 0; i--) {
            const p = b.particles[i];
            p.age += dt;
            if (p.age >= p.life) { b.particles.splice(i, 1); continue; }
            p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 34 * dt; // ふわっと上がって落ちる
            const k = 1 - p.age / p.life;
            ctx.globalAlpha = k * (p.cyan ? 1 : redDim);
            ctx.fillStyle = p.cyan ? 'rgba(0,255,170,1)' : 'rgba(255,90,90,1)';
            const s = 1 + k * 2;
            ctx.fillRect(p.x, p.y, s, s);
        }
        // サビ逆流ノイズ（赤・境界に当たって消える）
        for (let i = b.falls.length - 1; i >= 0; i--) {
            const f = b.falls[i];
            f.age += dt; f.y += f.vy * dt;
            if (f.age >= f.life || f.y >= waveY(f.x)) { b.falls.splice(i, 1); continue; }
            const k = 1 - f.age / f.life;
            ctx.globalAlpha = 0.5 * k * redDim;
            ctx.fillStyle = 'rgba(255,58,58,1)';
            ctx.fillRect(f.x, f.y, 2, 4);
        }
        ctx.restore();

        // 4) 解読パルス（シアンの光柱が境界から上へ走る）
        ctx.save();
        for (let i = b.pulses.length - 1; i >= 0; i--) {
            const pu = b.pulses[i];
            pu.age += dt;
            if (pu.age >= pu.life) { b.pulses.splice(i, 1); continue; }
            const k = pu.age / pu.life;            // 0→1
            const y0 = waveY(pu.x);
            const rise = k * (this.isClimax ? 150 : 110);
            const yTop = y0 - rise;
            const alpha = (1 - k) * 0.9;
            const grad = ctx.createLinearGradient(0, yTop, 0, y0);
            grad.addColorStop(0, 'rgba(0,255,170,0)');
            grad.addColorStop(1, 'rgba(0,255,170,0.85)');
            ctx.globalAlpha = alpha;
            ctx.fillStyle = grad;
            ctx.fillRect(pu.x - 2, yTop, 4, y0 - yTop);
            ctx.fillStyle = 'rgba(190,255,235,1)'; // 先頭の輝点
            ctx.fillRect(pu.x - 2.5, yTop - 2, 5, 4);
        }
        ctx.restore();

        // 5) 解読波紋（コンボ/サビ中、解読位置からシアンのリングが広がる・#113）
        ctx.save();
        for (let i = b.ripples.length - 1; i >= 0; i--) {
            const rp = b.ripples[i];
            rp.age += dt;
            if (rp.age >= rp.life) { b.ripples.splice(i, 1); continue; }
            const k = rp.age / rp.life;             // 0→1
            const radius = 8 + k * (this.isClimax ? 130 : 95);
            ctx.globalAlpha = (1 - k) * 0.8;
            ctx.lineWidth = 2.5 * (1 - k) + 0.5;
            ctx.strokeStyle = 'rgba(0,255,170,0.9)';
            ctx.beginPath();
            ctx.arc(rp.x, rp.y, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();

        // 6) #116: クリック地点のシアン復号バースト（信号線 → リング/フラッシュ → 粒子）
        ctx.save();
        // 信号線: クリック地点から制圧境界(／中央端末)へ高速で走る
        for (let i = b.signals.length - 1; i >= 0; i--) {
            const sg = b.signals[i];
            sg.age += dt;
            if (sg.age >= sg.life) { b.signals.splice(i, 1); continue; }
            const k = sg.age / sg.life;
            const grow = Math.min(1, k * 1.7); // 先端が素早く伸びきる
            ctx.globalAlpha = (1 - k) * 0.85;
            ctx.strokeStyle = 'rgba(130,255,228,1)';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(0,255,170,0.9)';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(sg.x0, sg.y0);
            ctx.lineTo(sg.x0 + (sg.x1 - sg.x0) * grow, sg.y0 + (sg.y1 - sg.y0) * grow);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        // リング/フラッシュ
        for (let i = b.bursts.length - 1; i >= 0; i--) {
            const r = b.bursts[i];
            if (r.delay > 0) { r.delay -= dt; continue; }
            r.age += dt;
            if (r.age >= r.life) { b.bursts.splice(i, 1); continue; }
            const k = r.age / r.life; // 0→1
            if (r.flash) {
                const rr = r.maxR * (0.4 + k * 0.6);
                const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, rr);
                g.addColorStop(0, 'rgba(255,255,255,0.95)');
                g.addColorStop(0.5, 'rgba(130,255,228,0.6)');
                g.addColorStop(1, 'rgba(0,255,170,0)');
                ctx.globalAlpha = 1 - k;
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(r.x, r.y, rr, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }
            // デジタルノイズを含むリング（完全な円ではなく、半径を揺らして縁を乱す）
            const rr = r.maxR * k;
            ctx.globalAlpha = (1 - k) * 0.9;
            ctx.strokeStyle = 'rgba(0,255,170,1)';
            ctx.lineWidth = 2 * (1 - k) + 0.6;
            ctx.shadowColor = 'rgba(0,255,170,0.8)';
            ctx.shadowBlur = 10;
            const segs = 40;
            ctx.beginPath();
            for (let s = 0; s <= segs; s++) {
                const a = (s / segs) * Math.PI * 2;
                const jitter = (Math.sin(a * 5 + r.seed) + (Math.random() - 0.5)) * rr * 0.06;
                const rad = rr + jitter;
                const px = r.x + Math.cos(a) * rad;
                const py = r.y + Math.sin(a) * rad;
                if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        // 四角いピクセル粒子＋短いノイズ線
        for (let i = b.burstParticles.length - 1; i >= 0; i--) {
            const p = b.burstParticles[i];
            p.age += dt;
            if (p.age >= p.life) { b.burstParticles.splice(i, 1); continue; }
            p.x += p.vx * dt; p.y += p.vy * dt;
            p.vx *= 0.92; p.vy *= 0.92; // 飛び出してすぐ失速
            const k = 1 - p.age / p.life;
            ctx.globalAlpha = k;
            ctx.fillStyle = Math.random() < 0.85 ? 'rgba(0,255,170,1)' : 'rgba(255,255,255,1)';
            if (p.line) {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.ang);
                ctx.fillRect(0, -0.6, 4 + k * 5, 1.3);
                ctx.restore();
            } else {
                const s = p.size * (0.5 + k);
                ctx.fillRect(p.x, p.y, s, s);
            }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // ── 陣取り反映: 制圧率に応じて赤/緑の領域・端末枠・背景・デブリを染める ──
    _applyTerritory() {
        const cov = this.greenCoverage;

        // 上=赤(敵) / 下=緑(奪還) の高さで綱引きを可視化する
        if (this.erosionEl)   this.erosionEl.style.height   = `${((1 - cov) * 100).toFixed(2)}%`;
        if (this.territoryEl) this.territoryEl.style.height = `${(cov * 100).toFixed(2)}%`;

        // 段階クラス切替（端末フレームの色: 赤い敵領域 → 緑に奪還）
        // 終局演出が出た後は固定（_triggerComplete/_triggerFailed 側で制御）
        const stage = this._completeFired ? this._erosionStage
            : cov >= 0.75 ? 3
            : cov >= 0.5  ? 2
            : cov >= 0.25 ? 1
            : 0;
        if (stage !== this._erosionStage) {
            this._erosionStage = stage;
            this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3');
            if (stage >= 1 && stage <= 3) {
                this.songWrapper.classList.add(`to-erode-${stage}`);
            }
        }

        // Three.js 背景・フォグ: 赤(敵) → シアン(奪還)へ補間
        if (this.scene && this.scene.background && this.scene.background.isColor) {
            this.scene.background.lerpColors(this._bgColorFrom, this._bgColorTo, cov);
            if (this.scene.fog) this.scene.fog.color.copy(this.scene.background);
        }
        // デブリのワイヤーフレームも 赤 → 緑 へ
        if (this._debrisMat) {
            this._debrisMat.color.setHex(0x8c1430).lerp(this._mikuColorCyan, cov);
        }
    }

    // ── コンボ: 連続解読(4秒以内)を数え、表示・エフェクト強化 ───────────
    _registerDecode() {
        const now = performance.now();
        if (this._lastDecodeAt > 0 && (now - this._lastDecodeAt) <= 4000) {
            this.combo++;
        } else {
            this.combo = 1;
        }
        this._lastDecodeAt = now;
        // #116: 連続解読・サビでは解読音を少し強め、テンポに乗る快感を補強する。
        const sfxGain = this.isClimax ? 1.3 : this.combo >= 5 ? 1.18 : this.combo >= 3 ? 1.1 : 1;
        sfx.play('takeover_decode', sfxGain);
        if (this.combo > this.maxCombo) this.maxCombo = this.combo;

        if (this.comboEl && this.combo >= 2) {
            this.comboEl.textContent = `COMBO x${this.combo}`;
            // アニメーション再トリガー
            this.comboEl.classList.remove('show');
            void this.comboEl.offsetWidth;
            this.comboEl.classList.add('show');

            clearTimeout(this._comboHideTimer);
            this._comboHideTimer = setTimeout(() => {
                if (this.comboEl) this.comboEl.classList.remove('show');
                this.combo = 0;
            }, 4000);
        }
        return this.combo >= 2; // コンボ中ならエフェクト強化
    }

    // ── Crypto helpers (AES-256-GCM via Web Crypto API) ─────────────────

    async _initCrypto() {
        this._cryptoKey = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,            // non-extractable: key never leaves the engine
            ['encrypt', 'decrypt']
        );
        this._cryptoReady = true;
    }

    async _encrypt(plaintext) {
        const iv   = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit random IV
        const data = new TextEncoder().encode(plaintext);
        const buf  = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this._cryptoKey,
            data
        );
        return { iv, ciphertext: new Uint8Array(buf) };
    }

    async _decrypt(iv, ciphertext) {
        const buf = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            this._cryptoKey,
            ciphertext
        );
        return new TextDecoder().decode(buf);
    }

    // Convert ciphertext bytes to a Base64 string for display.
    // Returns a string long enough to slide a window through.
    _ciphertextToBase64(ciphertext) {
        let binary = '';
        for (let i = 0; i < ciphertext.length; i++) {
            binary += String.fromCharCode(ciphertext[i]);
        }
        return btoa(binary);
    }

    // ── Spawn / decode targets ────────────────────────────────────────────

    async spawnGroupTarget(group) {
        if (!this._cryptoReady) return; // key not ready yet (extremely unlikely)

        // Encrypt before touching any state — if this throws or the scene is
        // already destroyed by the time it resolves, nothing gets miscounted.
        let iv, ciphertext;
        try {
            ({ iv, ciphertext } = await this._encrypt(group.text));
        } catch {
            return;
        }
        if (!this.isActive) return; // scene destroyed while awaiting
        if (this._completeFired) return; // 終局演出が await 中に起動した場合は出さない（#120）

        this.updateScore();

        const b64 = this._ciphertextToBase64(ciphertext); // authentic encrypted bytes

        const baseFontSize = this.isClimax ? 20 : 14;
        const winLen = Math.min(Math.max(b64.length, 12), 18);
        const hasHint = this.takenCount <= 3; // Show click hint only for the first 3 decryptions

        // Estimate size for collision checking
        const isMobile = window.innerWidth <= 768;
        const fontSizeVal = isMobile ? baseFontSize * 0.75 : baseFontSize;
        const scrambledWidth = winLen * (fontSizeVal * 0.65 + (isMobile ? 2.5 : 3.5));
        const plainWidth = group.text.length * (fontSizeVal * (isMobile ? 0.9 : 1.1));
        // ボックスを少し大きくした分、重なり判定の余白も合わせて広げて間隔を保つ。
        // 高さは CSS の min-height(PC64px/SP50px)で下限が決まり、ヒント行はその中に
        // 収まって箱の高さを変えないため、hasHint 分の加算はしない。
        const widthPx = Math.max(scrambledWidth, plainWidth) + (isMobile ? 16 : 58);
        const heightPx = Math.max(isMobile ? 50 : 64, fontSizeVal * 2.6) + (isMobile ? 16 : 18);

        const W = Math.max(1, window.innerWidth);
        const H = Math.max(1, window.innerHeight);
        const widthPct = (widthPx / W) * 100;
        const heightPct = (heightPx / H) * 100;

        // Dynamic grid layout based on screen orientation
        const isLandscape = W > H;
        const rows = isLandscape ? 4 : 5;
        const cols = isLandscape ? 5 : 3;
        const totalCells = rows * cols;
        const climax = this.isClimax;

        // 出現領域: 通常は中央寄せ（端への出現を抑える）。サビは端まで広げ、
        // 端から中央端末へ流入してくる密度・混沌感を出す（#113 提案1・3）。
        const regionLeft   = climax ? 8  : 16;
        const regionWidth  = climax ? 84 : 68;
        const regionTop    = climax ? 16 : 22;
        const regionHeight = climax ? 60 : 51;
        const cellW = regionWidth / cols;
        const cellH = regionHeight / rows;

        // セル候補を作り、重なりを避けたうえで「中央寄り・端を回避・直前解読位置から
        // 近すぎず遠すぎない」をスコアで評価して選ぶ。完全固定にならないよう乱数も混ぜる。
        const cx0 = 50, cy0 = 46;                 // 中央端末のおおよその中心(%)
        const last = this._lastDecodePos;
        const idealHop = climax ? 26 : 20;        // 直前位置からの心地よい移動距離(%)
        const cellIndices = Array.from({ length: totalCells }, (_, i) => i);

        let leftPct, topPct, cellIndex;
        let best = null;
        for (const ci of cellIndices) {
            const row = Math.floor(ci / cols);
            const col = (cols - 1) - (ci % cols); // Reversed column order
            const jitterX = (Math.random() - 0.5) * cellW * 0.5;
            const jitterY = (Math.random() - 0.5) * cellH * 0.5;
            const cl = Math.max(6, Math.min(regionLeft + col * cellW + jitterX, Math.max(6, 94 - widthPct)));
            const ct = Math.max(16, Math.min(regionTop + row * cellH + jitterY, Math.max(16, 81 - heightPct)));

            // 既存ターゲットと重なる候補は除外（解読済み/期限切れの残骸は画面に無いので数えない。
            // 数えると数回の出現で全セルが「埋まり」、以降ずっと中央付近へ重なって湧く）
            const overlaps = this.phraseTargets.some(t =>
                (t.state === 'scrambled' || t.state === 'decrypting') &&
                Math.abs(t.leftPct - cl) < widthPct && Math.abs(t.topPct - ct) < heightPct);
            if (overlaps) continue;

            const mx = cl + widthPct / 2, my = ct + heightPct / 2;
            // 中央に近いほど高得点（y方向を少し重く＝端末まわりに寄せる）
            let score = -Math.hypot(mx - cx0, (my - cy0) * 1.3) * 0.045;
            // 画面端（クリック余白の少ない位置）を回避
            const edge = Math.min(cl - 6, 94 - (cl + widthPct), ct - 16, 81 - (ct + heightPct));
            if (edge < 8) score -= (8 - edge) * 0.12;
            // 直前解読位置からの距離は idealHop 付近を優遇（近すぎ・遠すぎを減点）
            if (last) {
                const d = Math.hypot(mx - last.xPct, my - last.yPct);
                score -= Math.abs(d - idealHop) * 0.05;
            }
            score += Math.random() * 0.5; // 適度なランダム性を残す
            if (!best || score > best.score) best = { score, leftPct: cl, topPct: ct, cellIndex: ci };
        }

        if (best) {
            ({ leftPct, topPct, cellIndex } = best);
        } else {
            // 全候補が重なった場合のフォールバック（中央寄りにランダム配置）
            leftPct = Math.max(6, Math.min(cx0 - widthPct / 2 + (Math.random() - 0.5) * 24, 94 - widthPct));
            topPct  = Math.max(16, Math.min(cy0 - heightPct / 2 + (Math.random() - 0.5) * 20, 81 - heightPct));
            cellIndex = 0;
        }

        const el = document.createElement('div');
        el.className = 'to-phrase scrambled';
        el.style.top      = `${topPct}%`;
        el.style.left     = `${leftPct}%`;
        el.style.setProperty('--to-font-size', `${baseFontSize}px`);

        // サビ中は、最寄りの画面端の側から中央端末へ流れ込むように出現させる
        // （明示的なレーンは出さず、流入の動きだけで「流れに乗る」感覚を作る／#113 提案3）。
        const flowIn = climax;
        if (flowIn) {
            el.classList.add('flow-in');
            const fromDir = leftPct < 50 ? -1 : 1;
            el.style.transform = `translate(${fromDir * 64}px, ${(Math.random() - 0.5) * 36}px)`;
            el.style.opacity = '0';
        }

        // Show a sliding window of the real Base64 ciphertext
        const textNode = document.createTextNode(b64.slice(0, winLen));
        el.appendChild(textNode);

        if (hasHint) {
            const hint = document.createElement('div');
            hint.className = 'to-hint';
            hint.textContent = '[ CLICK TO DECRYPT ]';
            el.appendChild(hint);
        }

        const target = {
            el, textNode,
            iv, ciphertext,        // kept for decryption
            b64,                   // kept for display animation
            state: 'scrambled',
            scrambleTimer: null,
            leftPct,
            topPct,
            widthPct,
            heightPct,
            cellIndex,
            baseFontSize,
            groupIndex: group.index // Store its unique index
        };

        // Slide a window through the Base64 string to animate the ciphertext
        let offset = 0;
        const doubled = b64 + b64; // wrap-around source
        target.scrambleTimer = setInterval(() => {
            if (target.state !== 'scrambled') return;
            offset = (offset + 1) % b64.length;
            textNode.nodeValue = doubled.slice(offset, offset + winLen);
        }, 80);

        el.addEventListener('click', async () => {
            if (target.state !== 'scrambled') return;
            if (this._completeFired) return; // 終局演出後は操作を受け付けない
            // PAUSE中は復号を受け付けない（陣取りが止まっているので操作も無効）
            if (!(playerManager.player && playerManager.player.isPlaying)) return;
            target.state = 'decrypting'; // guard against double-click
            clearInterval(target.scrambleTimer);
            try {
                // Decrypt with AES-256-GCM using the stored IV + ciphertext
                const plaintext = await this._decrypt(target.iv, target.ciphertext);
                this._revealTarget(target, plaintext);
            } catch (e) {
                // Decryption failed – we do not update background tile, it remains empty
                if (target.el && target.el.parentNode) {
                    target.el.parentNode.removeChild(target.el);
                }
            }
        });

        this.songWrapper.appendChild(el);
        this.phraseTargets.push(target);

        // 流入アニメ: 次フレームで定位置へ滑り込ませ、着地後はホバーの即応性を戻す
        if (flowIn) {
            el.addEventListener('transitionend', () => el.classList.remove('flow-in'), { once: true });
            requestAnimationFrame(() => requestAnimationFrame(() => {
                if (target.state === 'scrambled' && el.parentNode) {
                    el.style.transform = 'translate(0, 0)';
                    el.style.opacity = '';
                }
            }));
        }

        return target;
    }

    _revealTarget(target, plaintext) {
        if (!this.isActive) return; // 復号(await)中に湖へ戻った
        if (target.state !== 'decrypting') return; // expired between click and decrypt resolve
        target.state = 'decoded';
        this.dismissFirstInteractable(); // 初回復号成功で誘導ガイドを片付ける

        // コンボ判定（コンボ中は解読フラッシュ・パルスを強化）
        const comboBoost = this._registerDecode();
        const intensity = this._decodeIntensity(comboBoost);

        // タップ成功 → 緑(奪還)領域を広げる。これが無操作減衰への対抗手段。
        this._gainTerritory(comboBoost);

        // 境界エフェクト: 解読位置からシアンの光柱が境界をせり上がる。
        // コンボ時はさらに境界を一気に押し上げる。
        const wrapRect = this.songWrapper.getBoundingClientRect();
        const fxEl = this.bgTiles[target.groupIndex] || target.el;
        if (fxEl) {
            const r = fxEl.getBoundingClientRect();
            const cxPx = r.left + r.width / 2 - wrapRect.left;
            const cyPx = r.top + r.height / 2 - wrapRect.top;
            this._spawnBoundaryPulse(cxPx);
            // 次のスポーンを直前解読位置の近傍へ寄せるため、位置(%)を記録（#113 提案2）
            const ww = wrapRect.width || window.innerWidth;
            const wh = wrapRect.height || window.innerHeight;
            this._lastDecodePos = { xPct: (cxPx / ww) * 100, yPct: (cyPx / wh) * 100 };
            // コンボ中/サビ中は、解読位置からシアンの波紋が広がる（押し返す手応え／#113 提案4）
            if (comboBoost || this.isClimax) this._spawnDecodeRipple(cxPx, cyPx);
        }
        if (comboBoost) this._boundarySurge = 1;

        // #116: クリック地点からシアンの復号パルス(衝撃波リング・粒子・信号線)を放ち、
        // 既存の制圧ライン押し上げ演出へ視覚的に接続する。
        const er = target.el.getBoundingClientRect();
        this._spawnDecodeBurst(
            er.left + er.width / 2 - wrapRect.left,
            er.top + er.height / 2 - wrapRect.top,
            intensity
        );
        // 5combo〜・サビ中は周囲の赤ノイズを一瞬薄れさせる(押し返している手応え)。
        if (intensity.dimRed) this._redDimUntil = performance.now() + 280;

        // #116: 暗号文字を一瞬グリッチ崩壊させ、正しい歌詞へ「バチッ」と確定してから吸い込む。
        this._glitchThenReveal(target, plaintext, comboBoost);
    }

    // #116: 暗号文字を数フレームだけランダム文字へ乱した後、正しい歌詞へ確定して
    //   背景タイルへ吸い込む。「ただ置き換わる」印象を避け、破壊→復号の手応えを出す。
    _glitchThenReveal(target, plaintext, comboBoost) {
        const el = target.el;
        const tn = target.textNode;

        // ヒント行があれば取り除く
        const hint = el.querySelector('.to-hint');
        if (hint && hint.parentNode) hint.parentNode.removeChild(hint);

        // 崩壊フェーズ: 赤の暗号 → 白く乱れる(横ブレ・色収差はCSS側 to-glitch-collapse)
        el.className = 'to-phrase to-glitch-collapse';
        const glitchChars = '!<>-_\\/[]{}=+*^?#%01ABCDEF';
        const len = Math.max(2, tn.nodeValue.length);
        let frame = 0;
        const FRAMES = 5;
        // spawn 時の scrambleTimer は既に clear 済み。再利用しておくと destroy() の
        // phraseTargets ループでまとめて停止でき、シーン破棄時の取りこぼしを防げる。
        target.scrambleTimer = setInterval(() => {
            if (!this.isActive) { clearInterval(target.scrambleTimer); return; }
            frame++;
            if (frame >= FRAMES) {
                clearInterval(target.scrambleTimer);
                tn.nodeValue = plaintext;
                // 確定: decoded のフラッシュ演出で「バチッ」と収束させる
                el.className = 'to-phrase decoded' + (comboBoost ? ' to-combo-boost' : '');
                this._flyToTile(target, plaintext);
                return;
            }
            let s = '';
            for (let i = 0; i < len; i++) {
                s += glitchChars[(Math.random() * glitchChars.length) | 0];
            }
            tn.nodeValue = s;
        }, 26);
    }

    // 確定した歌詞タイルを背景の所定位置へ吸い込む（従来の挙動を関数化）。
    _flyToTile(target, plaintext) {
        const tile = this.bgTiles[target.groupIndex];
        if (!tile) {
            // Fallback if background tile wasn't pre-built
            if (target.el && target.el.parentNode) {
                target.el.parentNode.removeChild(target.el);
            }
            this.takenCount++;
            this.updateScore();
            return;
        }

        // Animate fly to the background tile
        const wrapperRect = this.songWrapper.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const elRect = target.el.getBoundingClientRect();

        // Lock to pixel absolute positioning for seamless transition
        target.el.style.left = `${elRect.left - wrapperRect.left}px`;
        target.el.style.top = `${elRect.top - wrapperRect.top}px`;
        target.el.style.width = `${elRect.width}px`;
        target.el.style.height = `${elRect.height}px`;
        target.el.style.margin = '0';
        target.el.style.transform = 'none';

        // Force a layout reflow
        target.el.offsetHeight;

        // Apply transition and fly to final background tile dimensions
        target.el.style.transition = 'all 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
        target.el.style.left = `${tileRect.left - wrapperRect.left}px`;
        target.el.style.top = `${tileRect.top - wrapperRect.top}px`;
        target.el.style.width = `${tileRect.width}px`;
        target.el.style.height = `${tileRect.height}px`;
        // 着地先タイルの実寸（--to-tile-scale 反映後）に合わせ、飛行中の見た目をそろえる
        const tileStyle = window.getComputedStyle(tile);
        target.el.style.fontSize = tileStyle.fontSize;
        target.el.style.padding = tileStyle.padding;
        target.el.style.borderColor = '#ff3a3a';
        target.el.style.boxShadow = '0 0 10px rgba(255, 58, 58, 0.5)';

        // Once the transition finishes, remove target element and light up the background tile
        setTimeout(() => {
            if (target.el && target.el.parentNode) {
                target.el.parentNode.removeChild(target.el);
            }
            tile.textContent = plaintext;
            tile.classList.add('decoded');
        }, 500);

        this.takenCount++;
        this.updateScore();
    }

    // ── スタート時 WARNING: 赤いグリッチ警告を表示（退場は _scatterWarning が制御）──
    _showWarning() {
        if (this.warningEl) return;
        const overlay = document.createElement('div');
        overlay.className = 'to-warning-overlay';
        overlay.innerHTML = `
            <div class="to-warning-core">
                <div class="to-warning-title">⚠ WARNING ⚠</div>
                <div class="to-warning-sub">SYSTEM TAKEOVER DETECTED</div>
                <div class="to-warning-bar">[ DECRYPT THE LYRICS — RECLAIM THE SIGNAL ]</div>
            </div>
        `;
        this.songWrapper.appendChild(overlay);
        this.warningEl = overlay;
        // 退場（ノイズで左右に散る）は _scatterWarning() が制御する。
        // 自動では消さず、ホールド時間ぶん表示し続ける。
    }

    // ── WARNING 退場: 一瞬ノイズグリッチ → 水平スライスに分解して左右へ飛散 ──
    _scatterWarning() {
        const overlay = this.warningEl;
        if (!overlay || !overlay.parentNode) return;
        const core = overlay.querySelector('.to-warning-core');
        const cleanup = () => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (this.warningEl === overlay) this.warningEl = null;
        };
        if (!core) { // 念のためのフォールバック（フェードのみ）
            overlay.classList.add('out');
            this._introTimers.push(setTimeout(cleanup, 600));
            return;
        }

        sfx.play('takeover_decode'); // ノイズ/グリッチ音
        // フェーズ1: 一瞬ノイズで震わせる
        core.classList.add('glitch');

        const SLICE_DELAY = 360; // グリッチを見せてから分解する
        const SLICE_FLY = 600;   // 飛散アニメ + 余白
        this._introTimers.push(setTimeout(() => {
            if (!overlay.parentNode) return;
            // core の実画面位置を測り、その場にスライスを重ねる
            const wrapRect = this.songWrapper.getBoundingClientRect();
            const r = core.getBoundingClientRect();
            const left = r.left - wrapRect.left;
            const top = r.top - wrapRect.top;
            const w = r.width, h = r.height;

            const slices = document.createElement('div');
            slices.className = 'to-warning-slices';
            slices.style.cssText =
                `position:absolute; left:${left}px; top:${top}px; width:${w}px; height:${h}px; pointer-events:none;`;

            const N = 9;
            const built = [];
            for (let i = 0; i < N; i++) {
                const s = document.createElement('div');
                s.className = 'to-warning-slice';
                s.innerHTML = core.innerHTML; // 同じ内容を全幅で複製し…
                const tPct = (i / N) * 100;
                const bPct = (1 - (i + 1) / N) * 100;
                // …clip-path で自分の水平バンドだけを見せる（重ねると元の表示を再構成）
                s.style.cssText =
                    `position:absolute; left:0; top:0; width:${w}px; height:${h}px;` +
                    `clip-path:inset(${tPct}% 0 ${bPct}% 0); -webkit-clip-path:inset(${tPct}% 0 ${bPct}% 0);`;
                slices.appendChild(s);
                built.push({ s, i });
            }
            overlay.appendChild(slices);
            core.style.visibility = 'hidden';

            // 次フレームで各バンドを左右へ飛ばす（偶数=左/奇数=右、中心から遠いほど遠くへ）
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const mid = (N - 1) / 2;
                built.forEach(({ s, i }) => {
                    const dir = (i % 2 === 0) ? -1 : 1;
                    const dist = 240 + Math.abs(i - mid) * 80 + Math.random() * 120;
                    const dy = (Math.random() - 0.5) * 24;
                    s.style.transform =
                        `translateX(${dir * dist}px) translateY(${dy}px) skewX(${dir * 8}deg)`;
                    s.style.opacity = '0';
                });
                overlay.classList.add('out'); // 背景の赤グリッチもフェード
            }));
        }, SLICE_DELAY));

        this._introTimers.push(setTimeout(cleanup, SLICE_DELAY + SLICE_FLY));
    }

    // ── TAKEOVER専用の開幕: スタート押下 → WARNING を約3秒ホールド →
    //    ノイズで左右に散る → そのあとに本編再生を始める。
    //    iOS のメディア解錠はユーザー操作(クリック)の同期内で行う必要があるため、
    //    押下時に一度 play() してから（無音で）ホールドし、散り終わりに resume する。
    _autoStartPlayback() {
        if (!playerManager.isTimerReady) return;
        if (this._introStarted) return;
        this._introStarted = true;

        this._unlockAudio();
        // ホールド中は無音・頭出し位置で停止。ジェスチャ内 play() で iOS を解錠し、
        // update() 側で isPlaying を検知して即 pause し、0 の位置に留める。
        playerManager.setVolume(0);
        playerManager.seek(0);
        playerManager.play();
        this._holdPlayback = true;
        this._warningShown = true; // update() のフォールバック起動を抑止
        this._showWarning();

        const HOLD_MS = 3000;    // WARNING を見せる時間
        const SCATTER_MS = 950;  // ノイズ→飛散にかかる時間
        this._introTimers.push(setTimeout(() => {
            if (this.isActive) this._scatterWarning();
        }, HOLD_MS));
        this._introTimers.push(setTimeout(() => {
            if (this.isActive) this._beginPlayback();
        }, HOLD_MS + SCATTER_MS));
    }

    _beginPlayback() {
        this._holdPlayback = false;
        playerManager.seek(0);
        playerManager.fadeIn(1200); // 0 → 設定音量へなめらかに
        playerManager.play();
        this.showStartHint();
    }

    _unlockAudio() {
        unlockAudio(); // 共有 AudioContext を resume(押下ごとの new によるリークを防ぐ)
    }

    // 敗北(TAKEOVER FAILED)で終わった回はクリア登録しない（勝敗の意味を保つ）
    shouldMarkComplete() {
        return this._outcome !== 'failed';
    }

    // 曲終了リザルトの見出し。敗北時に「向き合えた」と出ると結果と食い違うので差し替える
    get resultHeadline() {
        return this._outcome === 'failed' ? 'この問いは、まだ終わらない' : null;
    }

    // ── TAKEOVER COMPLETE: ブラックアウト→再起動風シーケンス→赤一色 ────
    _triggerComplete() {
        if (this._completeFired) return;
        this._completeFired = true;
        this._outcome = 'clear';

        // 未解読のまま残った暗号歌詞を一掃（リザルトに居座るのを防ぐ／#120）。
        // ただしこれは「発火時点で存在するもの」しか消せない。終局後も生成が続くと
        // 残るため、生成側も _completeFired でガードしている（update内のspawn）。
        this._clearRemainingTargets();

        // 0) 静止/吸気: 解読済みの全タイルを一斉にシアンで満たす（タメ）
        Object.values(this.bgTiles).forEach(tile => {
            if (tile) tile.classList.add('to-charge');
        });

        const overlay = document.createElement('div');
        overlay.className = 'to-reboot-overlay reclaim';
        const linesWrap = document.createElement('div');
        linesWrap.className = 'to-reboot-lines';

        // クリアログは「全解読」と「制圧多数(50%以上だが未全解読)」で文言を変える。
        // 全解読 = 出題された歌詞ブロックをすべて復号できた状態。
        const fullyDecoded = this.totalCount > 0 && this.takenCount >= this.totalCount;
        this._clearKind = fullyDecoded ? 'complete' : 'majority';
        const bootLines = fullyDecoded
            ? [
                '> SYSTEM HALT :: ALL SECTORS DECRYPTED',
                '> PURGING PALETTE #FF3A3A ... OK',
                '> RESTORING SIGNAL #00FFAA .. OK',
                '> OWNERSHIP RECLAIMED',
                'TAKEOVER COMPLETE'
            ]
            : [
                '> CONTROL MAJORITY REACHED',
                '> PURGING PALETTE #FF3A3A . PARTIAL',
                '> RESTORING SIGNAL #00FFAA .. OK',
                '> OWNERSHIP RECLAIMED',
                'TAKEOVER RECLAIMED'
            ];
        const lineEls = bootLines.map((text, i) => {
            const line = document.createElement('div');
            line.className = 'to-reboot-line' + (i === bootLines.length - 1 ? ' final' : '');
            line.textContent = text;
            linesWrap.appendChild(line);
            return line;
        });
        overlay.appendChild(linesWrap);
        this.songWrapper.appendChild(overlay);
        this.rebootEl = overlay;

        const schedule = (fn, ms) => {
            this._rebootTimers.push(setTimeout(() => { if (this.isActive) fn(); }, ms));
        };

        // 1) 歌詞の爆散: 各タイルを画面中心から外向きに吹き飛ばす（衝撃波）
        schedule(() => {
            const cxv = window.innerWidth / 2;
            const cyv = window.innerHeight / 2;
            const push = 0.9 * Math.max(window.innerWidth, window.innerHeight);
            Object.values(this.bgTiles).forEach(tile => {
                if (!tile) return;
                const rect = tile.getBoundingClientRect();
                const tcx = rect.left + rect.width / 2;
                const tcy = rect.top + rect.height / 2;
                let dx = tcx - cxv;
                let dy = tcy - cyv;
                const dist = Math.hypot(dx, dy) || 1;
                const tx = (dx / dist) * push + dx * 0.4;
                const ty = (dy / dist) * push + dy * 0.4;
                const rot = (Math.random() - 0.5) * 720;
                const sc = 0.3 + Math.random() * 0.5;
                tile.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${sc})`;
                tile.classList.remove('to-charge');
                tile.classList.add('to-burst');
            });
        }, 480);

        // 2) ブラックアウト（空になった盤面を覆う）
        schedule(() => {
            if (overlay.parentNode) overlay.classList.add('on');
        }, 980);

        // 3) 奪還ログを順次表示
        const lineBase = 1200;
        lineEls.forEach((line, i) => {
            schedule(() => line.classList.add('shown'), lineBase + i * 600);
        });

        // 4) 暗転から明けると、世界はミクのシアンに塗り替わり、奥からミクが実体化
        const totalMs = lineBase + bootLines.length * 600 + 700;
        schedule(() => {
            this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3');
            this.songWrapper.classList.add('to-reclaim');
            sfx.play('takeover_reclaim');
            this._erosionStage = 0;
            // シーンを深いシアンへ
            if (this.scene && this.scene.background && this.scene.background.isColor) {
                this.scene.background.setHex(0x001712);
                if (this.scene.fog) this.scene.fog.color.setHex(0x001712);
            }
            if (this._debrisMat) {
                this._debrisMat.color.setHex(0x00ffaa);
                this._debrisMat.opacity = 0.5;
            }
            // 赤い侵食オーバーレイを消す
            if (this.erosionEl) this.erosionEl.style.opacity = '0';
            // 敵の端末(CRTモニター)を溶かし、奥のミクを前面へ露わにする
            // ※稼働中のフリッカーanimationはopacityを上書きするので止めてからフェード
            if (this.monitorEl) {
                this.monitorEl.style.animation = 'none';
                this.monitorEl.style.transition = 'opacity 1.1s ease';
                this.monitorEl.style.opacity = '0';
            }
            if (this.scoreEl) {
                this.scoreEl.textContent = this._clearKind === 'complete'
                    ? 'TAKEOVER: COMPLETE' : 'TAKEOVER: RECLAIMED';
                this.scoreEl.style.color = '#00ffaa';
                this.scoreEl.style.textShadow = '0 0 24px #00ffaa, 0 0 48px #00ffaa';
            }
            // ミクの実体化ランプ開始（update内でシアン固定・前進・発光）
            this._reclaimT = 0;
            this._mikuReclaim = true;
            // 暗転を明ける（1.2sフェードでシアンの世界とミクが現れる）
            overlay.classList.remove('on');
            overlay.classList.add('off');
        }, totalMs);

        // 5) オーバーレイ除去
        schedule(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (this.rebootEl === overlay) this.rebootEl = null;
        }, totalMs + 1600);

        // 最終成果を登録（全解読は COMPLETE、制圧多数は RECLAIMED）
        this.setResultSummary({
            lines: [
                `制圧率 ${Math.round(this.greenCoverage * 100)}% ・ 最大コンボ ${this.maxCombo}`,
                this._clearKind === 'complete' ? 'TAKEOVER COMPLETE' : 'TAKEOVER RECLAIMED',
                '奪還完了 — 世界はあなたのものに'
            ],
            accentColor: '#00FFAA',
            swatch: '#00FFAA'
        });
    }

    // ── TAKEOVER FAILED: 制圧率が半分に届かず終局 → 赤い敗北シーケンス ────
    _triggerFailed() {
        if (this._completeFired) return;
        this._completeFired = true;
        this._outcome = 'failed';
        this._erosionStage = 0;

        // 未解読のまま残った暗号歌詞を一掃（リザルトに居座るのを防ぐ／#120）
        this._clearRemainingTargets();

        // 端末フレームを完全な赤(敵支配)に固定し、世界を赤一色へ寄せる
        this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3', 'to-reclaim');
        this.songWrapper.classList.add('to-complete');
        if (this.scene && this.scene.background && this.scene.background.isColor) {
            this.scene.background.setHex(0x2a0008);
            if (this.scene.fog) this.scene.fog.color.setHex(0x2a0008);
        }
        if (this._debrisMat) this._debrisMat.color.setHex(0xff3a3a);
        // 赤を画面いっぱいに、緑領域は潰す
        if (this.erosionEl)   this.erosionEl.style.height = '100%';
        if (this.territoryEl) this.territoryEl.style.height = '0%';

        const overlay = document.createElement('div');
        overlay.className = 'to-reboot-overlay failed';
        const linesWrap = document.createElement('div');
        linesWrap.className = 'to-reboot-lines';

        const lostPct = Math.round((1 - this.greenCoverage) * 100);
        const bootLines = [
            '> DECRYPTION INCOMPLETE',
            `> SECTORS LOST :: ${lostPct}%`,
            '> SIGNAL #00FFAA SUPPRESSED',
            '> OWNERSHIP RETAINED BY INTRUDER',
            'TAKEOVER FAILED'
        ];
        const lineEls = bootLines.map((text, i) => {
            const line = document.createElement('div');
            line.className = 'to-reboot-line' + (i === bootLines.length - 1 ? ' final' : '');
            line.textContent = text;
            linesWrap.appendChild(line);
            return line;
        });
        overlay.appendChild(linesWrap);
        this.songWrapper.appendChild(overlay);
        this.rebootEl = overlay;

        const schedule = (fn, ms) => {
            this._rebootTimers.push(setTimeout(() => { if (this.isActive) fn(); }, ms));
        };

        // 1) ブラックアウト
        schedule(() => { if (overlay.parentNode) overlay.classList.add('on'); }, 300);
        // 2) 敗北ログを順次表示
        const lineBase = 600;
        lineEls.forEach((line, i) => {
            schedule(() => line.classList.add('shown'), lineBase + i * 520);
        });
        // 3) 失敗ゲージ表示
        schedule(() => {
            if (this.scoreEl) {
                this.scoreEl.textContent = 'TAKEOVER: FAILED';
                this.scoreEl.style.color = '#ff3a3a';
                this.scoreEl.style.textShadow = '0 0 24px #ff3a3a, 0 0 48px #ff3a3a';
            }
        }, lineBase + bootLines.length * 520);
        // 4) 暗転を明けて敗北ログを片付ける（残すと曲終了リザルトの文字と重なって読めない）
        const failEndMs = lineBase + bootLines.length * 520 + 1200;
        schedule(() => {
            overlay.classList.remove('on');
            overlay.classList.add('off');
        }, failEndMs);
        schedule(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (this.rebootEl === overlay) this.rebootEl = null;
        }, failEndMs + 1600);

        this.setResultSummary({
            lines: [`制圧率 ${Math.round(this.greenCoverage * 100)}% ・ 最大コンボ ${this.maxCombo}`, 'TAKEOVER FAILED', '奪還ならず — 世界はまだ赤いまま'],
            accentColor: '#FF3A3A',
            swatch: '#FF3A3A'
        });
    }

    buildLyricCard() {
        // 現在の曲のフレーズが完全に揃うまで構築しない（揃うまで update から再試行）。
        // video の存在だけでなく isTimerReady と firstPhrase を必須にすることで、
        // 別曲の stale video やフレーズ未ロード状態で空構築するのを防ぐ。
        if (!this.isActive || !playerManager.isTimerReady ||
            !playerManager.player || !playerManager.player.video ||
            !playerManager.player.video.firstPhrase) {
            return false;
        }

        const video = playerManager.player.video;
        this.allGroups = [];
        this.bgTiles = {};

        if (this.bgContainer) {
            this.bgContainer.innerHTML = '';
        }

        let phrase = video.firstPhrase;
        let index = 0;

        while (phrase) {
            const groups = groupPhraseWordsByMinLength(phrase, 4);
            for (const g of groups) {
                const groupObj = {
                    index: index,
                    text: g.text,
                    startTime: g.startTime,
                    endTime: g.endTime
                };
                this.allGroups.push(groupObj);

                // Create static background tile
                const tile = document.createElement('div');
                tile.className = 'to-tile';
                tile.textContent = g.text;
                tile.setAttribute('data-index', index);

                this.bgContainer.appendChild(tile);
                this.bgTiles[index] = tile;

                index++;
            }
            phrase = phrase.next;
        }

        this.totalCount = index;
        this.lyricCardBuilt = true;
        this.updateScore();
        // フィットは update() の _maybeFitTiles() がレイアウト安定後に自動で掛ける。
        // （構築直後は clientHeight が未確定で過剰縮小しうるため、ここでは掛けない）
        this._lastFitClientH = null;
        return true;
    }

    // 毎フレーム呼ばれ、背景コンテナの高さが安定／変化したときだけタイルを再フィットする。
    // 固定タイマーだと曲頭の演出中で clientHeight が暴れて過剰縮小するため、
    // 「高さが前回フィット時から変わったら掛け直す」方式で安定後に一度だけ確定させる。
    _maybeFitTiles() {
        const c = this.bgContainer;
        if (!c || !this.lyricCardBuilt) return;
        const ch = c.clientHeight;
        if (ch < 80) return; // レイアウト未確定（極小）のうちは見送る
        if (this._lastFitClientH != null && Math.abs(ch - this._lastFitClientH) < 2) return;
        this._lastFitClientH = ch;
        this._fitTilesToContainer();
    }

    // 解読タイルを背景(.to-bg-container)の高さ内へ必ず収める。
    // スマホ・タブレットでは折り返し行が増えて下にはみ出し、pointer-events:none で
    // スクロールもできないため後半の歌詞が見えなくなる。全タイルは buildLyricCard で
    // プレースホルダとして先に生成済みなので、この時点で総量を計測でき、収まるまで
    // --to-tile-scale を段階的に下げて全歌詞を縮小表示する。
    _fitTilesToContainer() {
        const c = this.bgContainer;
        if (!c) return;
        // 計測中はタイルのサイズ遷移を止める（遷移途中の値で測ると過剰縮小するため）
        c.classList.add('to-fitting');
        // まず等倍へ戻してから計測（前回の縮小やリサイズの影響を引きずらない＝拡大方向にも追従）
        c.style.setProperty('--to-tile-scale', '1');
        void c.offsetHeight;
        if (c.clientHeight >= 80) {
            let scale = 1;
            const minScale = 0.5; // これ以上は判読不能になるため下限を設ける
            // scrollHeight が clientHeight を超える間、スケールを段階的に下げて収める
            for (let i = 0; i < 16 && scale > minScale; i++) {
                if (c.scrollHeight <= c.clientHeight + 1) break;
                scale = Math.max(minScale, scale - 0.05);
                c.style.setProperty('--to-tile-scale', scale.toFixed(3));
                // 次ループの計測前にレイアウトを確定させる
                void c.offsetHeight;
            }
        }
        // 遷移を戻す（スケール値は確定済みなのでここでアニメは起きない）
        c.classList.remove('to-fitting');
    }

    expireTarget(target) {
        if (target.state === 'expired' || target.state === 'decrypting') return;
        target.state = 'expired';
        clearInterval(target.scrambleTimer);
        target.el.className = 'to-phrase expired';
        setTimeout(() => { if (target.el.parentNode) target.el.parentNode.removeChild(target.el); }, 400);
    }

    // 終局演出の起動時に、未解読のまま残っている暗号歌詞を一掃する（#120）。
    // 終局後は click ハンドラが _completeFired で復号を弾くため、残ったブロックは
    // タップしても消えずリザルト画面に居座ってしまう。ここでフェードして取り除く。
    _clearRemainingTargets() {
        this.phraseTargets.forEach(t => {
            if (!t || t.state === 'expired' || t.state === 'decoded') return;
            clearInterval(t.scrambleTimer);
            t.state = 'expired';
            if (t.el) {
                t.el.className = 'to-phrase expired';
                const el = t.el;
                setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
            }
        });
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.isMobile = window.innerWidth < 768;
        // 画面サイズ/向きが変わると背景の高さも変わる。次フレームの _maybeFitTiles() が
        // clientHeight の変化を検知して自動で掛け直すよう、フィット済みフラグを解除する。
        this._lastFitClientH = null;
    }

    update() {
        if (!playerManager.player || !playerManager.player.video) return;

        // 歌詞カードがまだ構築できていなければ、フレーズが揃い次第ここで構築する。
        // （タイミング次第で init 時には video.firstPhrase が未ロードのことがあるため）
        if (!this.lyricCardBuilt) {
            this.buildLyricCard();
        }

        // 解読タイルを背景内へ収める自動フィット（レイアウト安定後/リサイズ後に再計算）
        this._maybeFitTiles();

        // 再生中かどうか（PAUSE中は陣取りの減衰を止める／WARNINGの起点に使う）
        const isPlaying = !!(playerManager.player && playerManager.player.isPlaying);

        // WARNING ホールド中は頭出し位置(0)で停止させ続ける。
        // （_autoStartPlayback がジェスチャ内で一度 play() して iOS を解錠するため、
        //   その play を検知して即 pause し、散り終わりまで再生を保留する）
        if (this._holdPlayback && isPlaying) {
            playerManager.pause();
        }

        // フォールバック: スタート押下(_autoStartPlayback)以外の経路で再生が始まった
        // 場合も、一度だけ WARNING を出して数秒後に散らす。
        if (!this._warningShown && isPlaying) {
            this._warningShown = true;
            this._showWarning();
            this._introTimers.push(setTimeout(() => {
                if (this.isActive) this._scatterWarning();
            }, 3000));
        }

        // TextAlive公式タイマー(player.timer.position)に完全同期（先行調整を排除）
        const position = (playerManager.player && playerManager.player.timer)
                         ? playerManager.player.timer.position
                         : this.getSmoothedTime();
        const chorus = typeof playerManager.player.findChorus === 'function'
            ? playerManager.player.findChorus(position) : null;
        this.isClimax = !!chorus;

        // ── 終局演出の起動: 曲終わりの約8秒前に発火し、制圧率で勝敗を分ける ──
        // 演出(約6.5s)を songEnd の黒幕(通常 duration-50ms)より前に出し切るためのリード。
        // 画面の半分以上が緑(greenCoverage >= 0.5)なら CLEAR、届かなければ FAILED。
        if (!this._completeFired) {
            const duration = playerManager.player.video.duration;
            if (duration > 0 && position >= duration - this._completeLeadMs) {
                // 歌詞が取得できず暗号カードを作れなかった場合は遊びようが無いので敗北にしない
                if (!this.lyricCardBuilt || this.greenCoverage >= this._clearThreshold) {
                    this._triggerComplete();
                } else {
                    this._triggerFailed();
                }
            }
        }

        // Chorus: tighten contrast to signal intensity shift
        if (this.isClimax !== this.prevIsClimax) {
            this.songWrapper.style.filter = this.isClimax ? 'contrast(1.25) saturate(1.6)' : '';
            this.prevIsClimax = this.isClimax;
        }

        // ── 制圧率の時間減衰（無操作だと赤がじわじわ再侵食する綱引き） ──
        // 終局演出が出るまで・歌詞カード構築後・かつ再生中のみ進行させる。
        // PAUSE中は減衰を止めて境界線も静止させる（_lastFrameAtもリセットし、
        // 再開時に停止していた分の dt が一気に効いて飛ばないようにする）。
        if (!this._completeFired && this.lyricCardBuilt && isPlaying) {
            const now = performance.now();
            const dt = this._lastFrameAt ? Math.min(0.1, (now - this._lastFrameAt) / 1000) : 0;
            this._lastFrameAt = now;
            if (dt > 0) {
                const decay = this.isClimax ? this._coverageDecayClimax : this._coverageDecayBase;
                const next = Math.max(0, this.greenCoverage - decay * dt);
                if (next !== this.greenCoverage) {
                    this.greenCoverage = next;
                    this._applyTerritory();
                    this._updateGauge();
                }
            }
        } else {
            // PAUSE/未構築/終局中は計測をリセット（再開時の dt 暴発を防ぐ）
            this._lastFrameAt = 0;
        }

        // 制圧境界の演出（波打ち・ノイズ粒子・解読パルス・サビ逆流）を毎フレーム描画
        this._updateBoundaryFx();

        // Background debris rotation ＋ 疾走感: 奥→手前へ流れ、近づいたら奥へ回帰
        const driftMul = this.isClimax ? 1.8 : 1;
        this.debris.forEach(m => {
            m.rotation.x += m.userData.rot.x;
            m.rotation.y += m.userData.rot.y;
            m.rotation.z += m.userData.rot.z;
            m.position.z += (m.userData.vz || 0) * driftMul;
            if (m.position.z > 12) {
                m.position.set((Math.random()-0.5)*45, (Math.random()-0.5)*28, -40);
            }
        });

        // 疾走感: カメラを微振動させる（サビで強く）
        if (this.camera) {
            const t = performance.now() * 0.001;
            const amp = this.isClimax ? 0.16 : 0.06;
            this.camera.position.x = Math.sin(t * 13.0) * amp + Math.sin(t * 7.3) * amp * 0.5;
            this.camera.position.y = Math.cos(t * 11.0) * amp * 0.7;
            this.camera.lookAt(0, 0.5, -4);
        }

        // ── ミク: ゲーム中は暗号化シルエット → 完走で復号され光を浴びる（3D VRM） ──
        if (this._mikuReclaim) {
            // クリア演出の発火は曲終わり約3秒前なので、復号が間に合うようランプを速める。
            this._reclaimT = Math.min(1, this._reclaimT + 0.018);
            const ease = 1 - Math.pow(1 - this._reclaimT, 3); // easeOutCubic
            this._mikuAnchorPhase += 0.04;
            const breathe = (Math.sin(this._mikuAnchorPhase) + 1) * 0.5; // 0〜1

            // 背後のシアン逆光グロー＝復号で浴びる「光」。完走で強く灯す。
            if (this.mikuGlowMat && this.mikuGlowSprite) {
                this.mikuGlowMat.color.copy(this._mikuColorCyan);
                this.mikuGlowMat.opacity = ease * (0.55 + breathe * 0.2);
                const gs = 9 + ease * 13;
                this.mikuGlowSprite.scale.set(gs, gs, 1);
                this.mikuGlowSprite.position.set(0, 0.4, this._mikuVrmBaseZ - 0.6);
            }

            if (this.currentVRM) this._updateMikuReclaimVRM(ease, breathe);
        } else if (this.currentVRM && this.mikuVrmReady) {
            // ── ゲーム中: 暗号化された姿＝ダークなシルエットが中央に佇む ──
            // 解読が進む(greenCoverage↑)ほど、敵支配の赤ダーク→奪還のシアンダークへ寄せる。
            this._mikuAnchorPhase += this.isClimax ? 0.05 : 0.03;
            const breathe = (Math.sin(this._mikuAnchorPhase) + 1) * 0.5; // 0〜1
            const vrm = this.currentVRM;
            vrm.scene.position.set(0, this._mikuVrmBaseY + breathe * 0.02, this._mikuVrmBaseZ);
            vrm.scene.scale.setScalar(this._mikuVrmScale);
            if (this.mikuSilhouetteMat) {
                this.mikuSilhouetteMat.opacity = 0.5 + breathe * 0.16; // 淡く脈動
                this.mikuSilhouetteMat.color
                    .copy(this._silColorEnemy)
                    .lerp(this._silColorFreed, Math.min(1, this.greenCoverage));
            }
            const spine = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('spine');
            if (spine) spine.rotation.x = breathe * 0.02 - 0.01;
            this._tickVrm(); // ツインテールがゆっくり揺れる
        }

        // At phrase boundary: expire remaining scrambled targets after a 2-second delay
        // to give the user more time to decrypt them.
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase.startTime !== this.lastPhraseStart) {
            this.phraseTargets.forEach(t => {
                if (t.state === 'scrambled') {
                    setTimeout(() => {
                        if (this.isActive && t.state === 'scrambled') {
                            this.expireTarget(t);
                        }
                    }, 2000);
                }
            });
            this.lastPhraseStart = phrase.startTime;
        }

        // Spawn one scrambled target per word-group
        // 終局演出の起動後は新たな暗号歌詞を出さない（出すと復号できずに居座る／#120）
        const word = this._completeFired ? null
                  : (playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position));
        if (word && word.parent) {
            const groups = groupPhraseWordsByMinLength(word.parent, 4);
            const group = findGroupForWord(groups, word);
            if (group && group.startTime !== this.lastGroupStartTime) {
                this.lastGroupStartTime = group.startTime;
                
                // Match with pre-built allGroups to get the indexed group
                const matchGroup = this.allGroups.find(g => g.startTime === group.startTime && g.text === group.text);
                if (matchGroup) {
                    const tile = this.bgTiles[matchGroup.index];
                    // Only spawn if the background tile is not already decoded
                    if (tile && !tile.classList.contains('decoded')) {
                        this.spawnGroupTarget(matchGroup);
                    }
                }
            }
        }
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);

        // コンボ・再起動シーケンス・WARNING のタイマーを全停止
        clearTimeout(this._comboHideTimer);
        this._rebootTimers.forEach(t => clearTimeout(t));
        this._rebootTimers = [];
        this._introTimers.forEach(t => clearTimeout(t));
        this._introTimers = [];

        if (this.warningEl && this.warningEl.parentNode) {
            this.warningEl.parentNode.removeChild(this.warningEl);
            this.warningEl = null;
        }
        if (this.territoryEl && this.territoryEl.parentNode) {
            this.territoryEl.parentNode.removeChild(this.territoryEl);
            this.territoryEl = null;
        }

        if (this.rebootEl && this.rebootEl.parentNode) {
            this.rebootEl.parentNode.removeChild(this.rebootEl);
            this.rebootEl = null;
        }
        if (this.erosionEl && this.erosionEl.parentNode) {
            this.erosionEl.parentNode.removeChild(this.erosionEl);
            this.erosionEl = null;
        }
        if (this.comboEl && this.comboEl.parentNode) {
            this.comboEl.parentNode.removeChild(this.comboEl);
            this.comboEl = null;
        }
        if (this._bfx) {
            if (this._bfx.canvas && this._bfx.canvas.parentNode) {
                this._bfx.canvas.parentNode.removeChild(this._bfx.canvas);
            }
            this._bfx = null;
        }
        this.songWrapper.classList.remove('to-erode-1', 'to-erode-2', 'to-erode-3', 'to-complete', 'to-reclaim');
        this._mikuReclaim = false;
        this._reclaimT = 0;

        this.phraseTargets.forEach(t => {
            clearInterval(t.scrambleTimer);
            if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
        });
        this.phraseTargets = [];

        if (this._debrisEdgesGeo) { this._debrisEdgesGeo.dispose(); this._debrisEdgesGeo = null; }
        if (this._debrisMat)      { this._debrisMat.dispose();      this._debrisMat = null; }

        // 背後グローを除去・解放
        if (this.mikuGlowSprite) {
            this.scene.remove(this.mikuGlowSprite);
            this.mikuGlowSprite = null;
        }
        if (this.mikuGlowMat)     { this.mikuGlowMat.dispose();     this.mikuGlowMat = null; }
        if (this.mikuGlowTexture) { this.mikuGlowTexture.dispose(); this.mikuGlowTexture = null; }

        // 3DミクVRM・専用ライト・シルエット材質を除去・解放
        if (this.currentVRM) {
            this.scene.remove(this.currentVRM.scene);
            disposeVRM(this.currentVRM, { skipMaterials: [this.mikuSilhouetteMat] });
            this.currentVRM = null;
        }
        this.mikuVrmReady = false;
        this._silhouetteOn = false;
        if (this.mikuSilhouetteMat) { this.mikuSilhouetteMat.dispose(); this.mikuSilhouetteMat = null; }
        [this.mikuAmbient, this.mikuKeyLight, this.mikuRimLight].forEach((l) => {
            if (l && this.scene) this.scene.remove(l);
        });
        this.mikuAmbient = this.mikuKeyLight = this.mikuRimLight = null;

        const styleEl = document.getElementById('takeover-style');
        if (styleEl) styleEl.parentNode.removeChild(styleEl);

        if (this.monitorEl && this.monitorEl.parentNode) {
            this.monitorEl.parentNode.removeChild(this.monitorEl);
            this.monitorEl = null;
        }

        this.allGroups = [];
        this.bgTiles = {};

        if (this.bgContainer && this.bgContainer.parentNode) {
            this.bgContainer.parentNode.removeChild(this.bgContainer);
            this.bgContainer = null;
        }

        this.songWrapper.style.filter = '';

        if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss?.(); this.renderer = null; }

        super.destroy();
    }
}
