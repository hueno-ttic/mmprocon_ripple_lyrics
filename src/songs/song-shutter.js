import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { groupPhraseWords } from '../utils/lyricGroups.js';

// 被写体ミクのポーズプリセット（正規化ヒューマノイドボーンのオイラー回転）
// 新VRMモデルは上腕/前腕のロール軸(z)が旧モデルと逆。
// 左腕は z=+1.12 で下ろした状態。z 符号反転で挙手になる。
const SHUTTER_MIKU_POSES = [
    { // 0: リラックス（基本姿勢）
        leftUpperArm: { x: 0, y: 0, z: 1.12 }, rightUpperArm: { x: 0, y: 0, z: -1.12 },
        leftLowerArm: { x: 0, y: 0.26, z: 0 }, rightLowerArm: { x: 0, y: -0.26, z: 0 },
        head: { x: 0, y: 0, z: 0 }, spine: { x: 0, y: 0, z: 0 }
    },
    { // 1: 右手を挙げて手を振る
        leftUpperArm: { x: 0, y: 0, z: 1.12 }, rightUpperArm: { x: 0, y: 0, z: 0.55 },
        leftLowerArm: { x: 0, y: 0.26, z: 0 }, rightLowerArm: { x: 0, y: 0, z: 0.85 },
        head: { x: 0, y: -0.18, z: -0.12 }, spine: { x: 0, y: -0.08, z: 0.04 }
    },
    { // 2: 左手を挙げてアピール
        leftUpperArm: { x: 0, y: 0, z: -0.55 }, rightUpperArm: { x: 0, y: 0, z: -1.12 },
        leftLowerArm: { x: 0, y: 0, z: -0.85 }, rightLowerArm: { x: 0, y: -0.26, z: 0 },
        head: { x: 0, y: 0.18, z: 0.12 }, spine: { x: 0, y: 0.08, z: -0.04 }
    },
    { // 3: 両手を挙げてチアー（サビ用）
        leftUpperArm: { x: 0, y: 0, z: -0.7 }, rightUpperArm: { x: 0, y: 0, z: 0.7 },
        leftLowerArm: { x: 0, y: 0, z: -0.35 }, rightLowerArm: { x: 0, y: 0, z: 0.35 },
        head: { x: -0.12, y: 0, z: 0 }, spine: { x: -0.05, y: 0, z: 0 }
    },
    { // 4: 顔の横でピースっぽいカメラ目線ポーズ
        leftUpperArm: { x: 0, y: 0, z: 1.12 }, rightUpperArm: { x: -0.5, y: 0, z: -0.85 },
        leftLowerArm: { x: 0, y: 0.26, z: 0 }, rightLowerArm: { x: -1.25, y: -0.35, z: 0 },
        head: { x: 0, y: -0.1, z: 0.18 }, spine: { x: 0, y: 0, z: -0.05 }
    }
];

// 「シャッターチャンス」の歌詞フレーズインデックスに対する100%正確な歌唱パートマッピング
const SHUTTER_VOCAL_MAP = {
    0: 'duet',  // 「いつだってシャッターチャンス」 (合唱)
    1: 'miku',  // 「完全無欠flawless」
    2: 'miku',  // 「息を呑むシャッター半押しの合図」
    3: 'rin',   // 「君の決断、ずっと待ってるのに」
    4: 'miku',  // 「レリーズボタンに触れたその指先は」
    5: 'rin',   // 「迷いを隠せないまま」
    6: 'miku',  // 「ファインダー越しに一瞬映る顔も可愛くて当然」
    7: 'rin',   // 「ため息混じりの嫉妬もしょうがないね」
    8: 'miku',  // 「君の世界に焼き付けたいからさ」
    9: 'rin',   // 「今すぐ私に焦点合わせて！」
    10: 'duet', // 「いつだってシャッターチャンス」 (合唱)
    11: 'duet', // サビ (全て君を落とす1枚になるモラトリアム)
    12: 'duet', // サビ (完全無欠flawless)
    13: 'duet', // サビ (過ぎ去っちゃうこの一瞬を)
    14: 'duet', // サビ (切り取り永遠に保存して♡)
    15: 'miku', // 掛け合い (NGテイクなんてない)
    16: 'rin',  // 掛け合い (誰にも真似できない勝てっこない)
    17: 'miku', // 掛け合い (絶対的なフォーカス)
    18: 'rin',  // 掛け合い (どんなテイクだって色褪せない)
    19: 'miku', // 掛け合い (誰もが追いつけない揺るがない)
    20: 'rin',  // 掛け合い (再現出来ないスナップ)
    21: 'miku', // 「その手を止めないで」
    22: 'rin',  // 「もっとバッファにアーカイブして」
    23: 'duet', // 「切り取ってフレームで閉じ込めて」
    24: 'duet', // 「思うがままほらシャッターを切って」
    25: 'miku', // 「この瞬間、残せるのは」
    26: 'rin',  // 「今しかない」
    27: 'rin',  // 「ファインダー越しの無防備な顔も可愛くて当然」 (2番Aメロ)
    28: 'miku', // 「油断してつい照れちゃうのもしょうがないね」
    29: 'rin',  // 「君の世界を彩りたいからさ」
    30: 'miku', // 「今すぐ私にピント合わせて！」
    31: 'duet', // 「いつだってシャッターチャンス」 (合唱)
    32: 'miku', // 「心象のレイヤーパララックス」 (落ちサビ)
    33: 'rin',  // 「今すぐ私に焦点合わせて！」
    34: 'duet', // 「余所見しないで！」
    35: 'duet', // ラストサビ (いつだってシャッターチャンス)
    36: 'duet', // サビ (どれも君を落とす1枚になるモラトリアム)
    37: 'duet', // サビ (完全無欠flawless)
    38: 'duet', // サビ (過ぎ去っちゃうこの一瞬を)
    39: 'duet', // サビ (切り取り永遠に残して♡)
    40: 'duet', // ラスト掛け合い (NGテイクなんてない)
    41: 'duet',
    42: 'duet',
    43: 'duet',
    44: 'duet',
    45: 'duet'  // 再現出来ないストロボ
};

export class SongShutter extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        this.activeSprites = [];
        this.frames = [];
        this.transitioningPhotos = []; // 移動・吸い込み中の写真を管理する配列
        this.lastPhrase = null;
        
        // 歌詞の単語レベル（助詞連結）＆被り回避管理
        this.currentPhraseGroups = [];
        this.spawnedGroupIndices = new Set();
        this.occupiedCells = new Set();
        this.lastWordText = '';
        this.customStyleElement = null;
        
        this.isClimax = false;
        this.climaxTriggered = false;
        
        this.themeColor = '#B9543C';
        
        this.lyricsCacheBuilt = false;
        this.allWordGroups = [];
        this.lyricTexturesCache = null;
        this.lastPosition = -1;

        // --- モバイル負荷分岐 ---
        this.isMobile = window.innerWidth < 768;

        // --- フィルムストリップ（撮影成果の内部記録・最大12枚） ---
        this.photoLog = [];          // { url, starred, timeStr }
        this.MAX_FILM_PHOTOS = 12;
        this.totalShots = 0;         // 累計撮影枚数
        this.starShots = 0;          // ★ベストショット枚数
        this.lockShots = 0;          // ターゲットロック成功回数
        this.filmStripVisible = false;
        this.filmStripEl = null;

        // --- 被写体ミクVRM ---
        this.mikuVRM = null;
        this.mikuBaseY = -4.2;
        this.mikuBaseX = 0;
        this.mikuBaseZ = -16.5;      // AFターゲットスコープ(z=-15)のすぐ奥のステージ位置
        this.mikuPoseIndex = 0;
        this.lastPhraseStartTime = -1;
        this.lastPoseBeatStart = -1;
        this.poseBeatCounter = 0;
        this.lastVrmRealTime = undefined;
        this.vrmUpdateAccum = 0;

        // --- カメラズーム（写真の拡大縮小範囲）制御システム ---
        this.zoomLevel = 1.0;
        this.targetZoom = 1.0;
        this.touchStartDist = 0;

        this.boundOnWheel = this.onWheel.bind(this);
        this.boundOnTouchStart = this.onTouchStart.bind(this);
        this.boundOnTouchMove = this.onTouchMove.bind(this);
        this.boundOnTouchEnd = this.onTouchEnd.bind(this);
        
        this.boundOnResize = this.onResize.bind(this);
        this.boundOnClick = this.takePhoto.bind(this);
        this.boundOnKeyDown = (e) => { 
            if (e.code === 'Enter' || e.code === 'Space') {
                if (playerManager.player && playerManager.player.isPlaying) {
                    this.takePhoto();
                }
            } else if (e.code === 'KeyW' || e.code === 'ArrowUp') {
                this.targetZoom = Math.min(2.5, this.targetZoom + 0.15);
                e.preventDefault();
            } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
                this.targetZoom = Math.max(0.6, this.targetZoom - 0.15);
                e.preventDefault();
            }
        };

        this.boundOnSliderInput = (e) => {
            this.targetZoom = parseFloat(e.target.value);
        };

        // --- カメラ首振り（パン・チルト）ドラッグ操作システム ---
        this.cameraRotation = new THREE.Vector2(0, 0); // 現在の角度 (x=ピッチ, y=ヨー)
        this.targetCameraRotation = new THREE.Vector2(0, 0); // 目標の角度
        this.isDragging = false;
        this.dragStartPos = new THREE.Vector2(0, 0);
        this.previousMousePosition = new THREE.Vector2(0, 0);
        this.draggedDistance = 0; // クリックとドラッグの判定用

        this.boundOnMouseDown = (e) => {
            if (e.target.id === 'shutter-zoom-slider' || e.target.closest('#shutter-zoom-slider-container')) return;
            this.isDragging = true;
            this.dragStartPos.set(e.clientX, e.clientY);
            this.previousMousePosition.set(e.clientX, e.clientY);
            this.draggedDistance = 0;
        };

        this.boundOnMouseMove = (e) => {
            if (!this.isDragging) return;
            const dx = e.clientX - this.previousMousePosition.x;
            const dy = e.clientY - this.previousMousePosition.y;
            this.previousMousePosition.set(e.clientX, e.clientY);

            // ドラッグ移動距離を累積
            const distFromStart = Math.sqrt(Math.pow(e.clientX - this.dragStartPos.x, 2) + Math.pow(e.clientY - this.dragStartPos.y, 2));
            this.draggedDistance = distFromStart;

            // カメラの回転目標を更新（左右±0.45ラジアン(約25度)、上下±0.25ラジアン(約14度)に制御）
            this.targetCameraRotation.y = Math.min(0.45, Math.max(-0.45, this.targetCameraRotation.y + dx * 0.002));
            this.targetCameraRotation.x = Math.min(0.25, Math.max(-0.25, this.targetCameraRotation.x + dy * 0.002));
        };

        this.boundOnMouseUp = (e) => {
            if (!this.isDragging) return;
            this.isDragging = false;
            
            // マウスの総移動距離が 10 ピクセル未満なら「撮影（クリック）」と判定し、それ以上なら「カメラ操作」として撮影をガード！
            if (this.draggedDistance < 10) {
                if (playerManager.player && playerManager.player.isPlaying) {
                    this.takePhoto();
                }
            }
        };

        // スマホ用タッチ首振りバインド
        this.boundOnTouchStartCam = (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                if (touch.target.id === 'shutter-zoom-slider' || touch.target.closest('#shutter-zoom-slider-container')) return;
                this.isDragging = true;
                this.dragStartPos.set(touch.clientX, touch.clientY);
                this.previousMousePosition.set(touch.clientX, touch.clientY);
                this.draggedDistance = 0;
            }
        };

        this.boundOnTouchMoveCam = (e) => {
            if (!this.isDragging || e.touches.length !== 1) return;
            const touch = e.touches[0];
            const dx = touch.clientX - this.previousMousePosition.x;
            const dy = touch.clientY - this.previousMousePosition.y;
            this.previousMousePosition.set(touch.clientX, touch.clientY);

            const distFromStart = Math.sqrt(Math.pow(touch.clientX - this.dragStartPos.x, 2) + Math.pow(touch.clientY - this.dragStartPos.y, 2));
            this.draggedDistance = distFromStart;

            this.targetCameraRotation.y = Math.min(0.45, Math.max(-0.45, this.targetCameraRotation.y + dx * 0.003));
            this.targetCameraRotation.x = Math.min(0.25, Math.max(-0.25, this.targetCameraRotation.x + dy * 0.003));
        };

        this.boundOnTouchEndCam = (e) => {
            if (!this.isDragging) return;
            this.isDragging = false;
            
            if (this.draggedDistance < 10) {
                if (playerManager.player && playerManager.player.isPlaying) {
                    this.takePhoto();
                }
            }
        };
    }

    init() {
        this.initThree();
        this.initEnvironment();
        this.loadMiku();
        this.injectCustomStyles();
        this.createViewfinderUI();
        
        // ズームスライダーのイベント登録
        const slider = document.getElementById('shutter-zoom-slider');
        if (slider) {
            slider.addEventListener('input', this.boundOnSliderInput);
        }

        window.addEventListener('resize', this.boundOnResize);
        window.addEventListener('keydown', this.boundOnKeyDown);
        
        // カメラ首振り ＆ 統合された撮影イベントの登録
        this.songWrapper.addEventListener('mousedown', this.boundOnMouseDown);
        this.songWrapper.addEventListener('mousemove', this.boundOnMouseMove);
        window.addEventListener('mouseup', this.boundOnMouseUp);
        
        // スマホ用首振りタッチイベントの登録
        this.songWrapper.addEventListener('touchstart', this.boundOnTouchStartCam, { passive: true });
        this.songWrapper.addEventListener('touchmove', this.boundOnTouchMoveCam, { passive: false });
        this.songWrapper.addEventListener('touchend', this.boundOnTouchEndCam, { passive: true });
        
        // ズーム用のホイール・タッチイベントを登録
        this.songWrapper.addEventListener('wheel', this.boundOnWheel, { passive: false });
        this.songWrapper.addEventListener('touchstart', this.boundOnTouchStart, { passive: true });
        this.songWrapper.addEventListener('touchmove', this.boundOnTouchMove, { passive: false });
        this.songWrapper.addEventListener('touchend', this.boundOnTouchEnd, { passive: true });
        
        // 重複表示を避けるため、画面中央のデフォルト2D歌詞表示を非表示にする
        if (this.lyricRenderer && this.lyricRenderer.lyricContainer) {
            this.lyricRenderer.lyricContainer.style.display = 'none';
        }
        
        this.isActive = true;
        super.init();

        // 曲終了オーバーレイに表示される撮影成果を初期登録
        this.updateResultSummary();
    }

    // 撮影成果サマリーの登録（撮影のたびに最新値で上書き）
    updateResultSummary() {
        const lines = [`撮影 ${this.totalShots}枚 ・ ★ベストショット ${this.starShots}枚`];
        if (this.lockShots > 0) {
            lines.push(`ターゲットロック成功 ${this.lockShots}回`);
        }
        this.setResultSummary({
            lines: lines,
            accentColor: '#D85A30',
            swatch: '#D85A30'
        });
    }

    // 被写体ミクVRMをステージ奥にロード（orchestraの実績パターンを踏襲）
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
                this.mikuVRM = vrm;
                this.scene.add(vrm.scene);
                vrm.scene.position.set(this.mikuBaseX, this.mikuBaseY, this.mikuBaseZ);
                vrm.scene.rotation.y = 0; // カメラ（撮影者）の方を向かせる
                vrm.scene.scale.set(6.0, 6.0, 6.0);

                // 初期ポーズ（リラックス）を即適用
                this.applyMikuPoseImmediate(SHUTTER_MIKU_POSES[0]);
                console.log('[SHUTTER] Miku VRM loaded successfully.');
            },
            undefined,
            (error) => {
                console.error('[SHUTTER] Failed to load VRM:', error);
            }
        );
    }

    applyMikuPoseImmediate(pose) {
        if (!this.mikuVRM || !this.mikuVRM.humanoid) return;
        Object.keys(pose).forEach(boneName => {
            const bone = this.mikuVRM.humanoid.getNormalizedBoneNode(boneName);
            if (bone) {
                bone.rotation.set(pose[boneName].x, pose[boneName].y, pose[boneName].z);
            }
        });
    }

    // 目標ポーズへ毎フレーム滑らかにイージング補間
    lerpMikuPose(pose, t) {
        if (!this.mikuVRM || !this.mikuVRM.humanoid) return;
        Object.keys(pose).forEach(boneName => {
            const bone = this.mikuVRM.humanoid.getNormalizedBoneNode(boneName);
            if (!bone) return;
            bone.rotation.x += (pose[boneName].x - bone.rotation.x) * t;
            bone.rotation.y += (pose[boneName].y - bone.rotation.y) * t;
            bone.rotation.z += (pose[boneName].z - bone.rotation.z) * t;
        });
    }

    advanceMikuPose() {
        if (!this.mikuVRM) return;
        // 同じポーズの連続を避けつつ次のポーズへ
        let next = Math.floor(Math.random() * SHUTTER_MIKU_POSES.length);
        if (next === this.mikuPoseIndex) {
            next = (next + 1) % SHUTTER_MIKU_POSES.length;
        }
        this.mikuPoseIndex = next;
        // ポーズ切替時に髪の物理が暴れないようリセット
        if (this.mikuVRM.springBoneManager) {
            this.mikuVRM.springBoneManager.reset();
        }
    }

    disposeVRM(vrm) {
        if (!vrm) return;
        vrm.scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
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

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    onWheel(e) {
        e.preventDefault();
        // スクリュー方向で拡大・縮小
        const delta = -e.deltaY * 0.0015;
        this.targetZoom = Math.min(2.5, Math.max(0.6, this.targetZoom + delta));
    }

    onTouchStart(e) {
        if (e.touches.length === 2) {
            // 2本指の距離を測定
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this.touchStartDist = Math.sqrt(dx * dx + dy * dy);
        }
    }

    onTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (this.touchStartDist > 0) {
                const ratio = dist / this.touchStartDist;
                // ピンチ比率に基づいて目標ズームを変更
                this.targetZoom = Math.min(2.5, Math.max(0.6, this.targetZoom * (ratio > 1 ? 1.03 : 0.97)));
                this.touchStartDist = dist; // 次回更新用
            }
        }
    }

    onTouchEnd(e) {
        if (e.touches.length < 2) {
            this.touchStartDist = 0;
        }
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x110805, 0.01); // Reduced fog density so frames are visible
        this.scene.background = new THREE.Color(0x110805);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0, 10);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.pointerEvents = 'none'; // allow clicks to pass through to songWrapper
        this.songWrapper.appendChild(this.renderer.domElement);

        // 被写体ミクVRM用ライティング（既存のワイヤーフレーム・スプライトは無灯影響なし）
        this.ambientLight = new THREE.AmbientLight(0x554038, 1.6);
        this.scene.add(this.ambientLight);
        this.dirLight = new THREE.DirectionalLight(0xffe8d0, 2.2);
        this.dirLight.position.set(2, 5, 10);
        this.scene.add(this.dirLight);
    }

    updateFramePosition(frame) {
        const ud = frame.userData;
        const cosA = Math.cos(ud.orbitAngle);
        const sinA = Math.sin(ud.orbitAngle);
        
        // 3D空間におけるパースペクティブ楕円軌道座標の計算
        const baseValX = sinA * ud.orbitWidth;
        const baseValZ = -cosA * ud.orbitDepth + ud.centerZ;
        const baseValY = Math.sin(ud.orbitAngle * 2) * (ud.orbitHeight * 0.2) + cosA * (ud.orbitHeight * 0.3);
        
        const pos = new THREE.Vector3(baseValX, baseValY, baseValZ);
        
        // 軌道全体の3次元傾斜の適用
        pos.applyAxisAngle(new THREE.Vector3(1, 0, 0), ud.tiltX);
        pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), ud.tiltY);
        
        frame.position.copy(pos);
    }

    initEnvironment() {
        // Create flying polaroid frames (wireframe)
        const boxGeo = new THREE.BoxGeometry(4, 3, 0.1);
        const edges = new THREE.EdgesGeometry(boxGeo);
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(this.themeColor) });

        for (let i = 0; i < 30; i++) {
            const frame = new THREE.LineSegments(edges, mat);
            
            // 3D周回（楕円軌道）パラメータの設定
            const angle = Math.random() * Math.PI * 2;
            const orbitWidth = 10 + Math.random() * 10;
            const orbitHeight = 6 + Math.random() * 8;
            const orbitDepth = 22 + Math.random() * 6;
            const centerZ = -25 - Math.random() * 5;
            const orbitSpeed = 0.0015 + Math.random() * 0.002;
            const tiltX = (Math.random() - 0.5) * 0.4;
            const tiltY = (Math.random() - 0.5) * 0.4;

            frame.userData = {
                orbitAngle: angle,
                orbitWidth: orbitWidth,
                orbitHeight: orbitHeight,
                orbitDepth: orbitDepth,
                centerZ: centerZ,
                orbitSpeed: orbitSpeed,
                tiltX: tiltX,
                tiltY: tiltY,
                rotSpeed: new THREE.Vector3((Math.random()-0.5)*0.015, (Math.random()-0.5)*0.015, (Math.random()-0.5)*0.015),
                hasPhoto: false,
                photoMesh: null,
                photoImage: null,
                photoSpawnTime: 0,
                fadeOpacity: 1.0,
                isFadingOut: false
            };

            // 固有の初期姿勢を設定
            frame.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );

            // 初期位置を軌道パラメータから計算して設定
            this.updateFramePosition(frame);

            this.scene.add(frame);
            this.frames.push(frame);
        }

        // 3Dオートフォーカス・ターゲットレティクル（フォトスポット）の生成
        const targetGeo = new THREE.RingGeometry(0.8, 0.9, 32);
        const targetMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color('#FFEE11'), // リンイエローをベースに光らせる
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        this.targetScope = new THREE.Mesh(targetGeo, targetMat);
        
        // ターゲットスコープにお洒落なAF照準ブラケット（十字インジケーター）を子要素として追加
        const crossGeo = new THREE.PlaneGeometry(0.15, 0.4);
        const crossMat = new THREE.MeshBasicMaterial({ color: 0x39C5BB, transparent: true, opacity: 0.8 });
        
        const topBar = new THREE.Mesh(crossGeo, crossMat);
        topBar.position.set(0, 1.0, 0);
        this.targetScope.add(topBar);
        
        const bottomBar = topBar.clone();
        bottomBar.position.set(0, -1.0, 0);
        this.targetScope.add(bottomBar);
        
        const leftBar = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15), crossMat);
        leftBar.position.set(-1.0, 0, 0);
        this.targetScope.add(leftBar);
        
        const rightBar = leftBar.clone();
        rightBar.position.set(1.0, 0, 0);
        this.targetScope.add(rightBar);

        // フォトスポットのお洒落な座標 (ビューファインダー中央 (0, 0) に完全配置してピント合わせ機能と物理連動)
        this.targetScope.position.set(0, 0, -15);
        this.scene.add(this.targetScope);
    }

    injectCustomStyles() {
        this.customStyleElement = document.createElement('style');
        this.customStyleElement.innerHTML = `
            #shutter-zoom-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #FFEE11;
                border: 2px solid #B9543C;
                cursor: pointer;
                box-shadow: 0 0 8px #FFEE11;
                transition: transform 0.1s;
            }
            #shutter-zoom-slider::-webkit-slider-thumb:hover {
                transform: scale(1.2);
            }
            #shutter-zoom-slider::-moz-range-thumb {
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #FFEE11;
                border: 2px solid #B9543C;
                cursor: pointer;
                box-shadow: 0 0 8px #FFEE11;
            }
            /* --- シャッターチャンス: 終盤フィルムストリップ --- */
            #shutter-filmstrip {
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                z-index: 45;
                display: flex;
                justify-content: center;
                pointer-events: none;
                transform: translateY(120%);
                transition: transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
            }
            #shutter-filmstrip.shutter-filmstrip-visible {
                transform: translateY(0);
            }
            #shutter-filmstrip-track {
                display: flex;
                gap: 8px;
                align-items: center;
                max-width: 96vw;
                overflow-x: auto;
                padding: 18px 22px;
                background:
                    repeating-linear-gradient(90deg, rgba(216,90,48,0.55) 0 6px, transparent 6px 22px) top / 100% 8px no-repeat,
                    repeating-linear-gradient(90deg, rgba(216,90,48,0.55) 0 6px, transparent 6px 22px) bottom / 100% 8px no-repeat,
                    rgba(12, 5, 3, 0.92);
                border-top: 1px solid rgba(216, 90, 48, 0.6);
                box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.6);
                pointer-events: auto;
            }
            .shutter-film-cell {
                position: relative;
                flex: 0 0 auto;
                width: 76px;
                height: 76px;
                border: 3px solid #f5f0ea;
                background: #000;
                box-shadow: 0 2px 8px rgba(0,0,0,0.6);
                transform: rotate(var(--film-tilt, 0deg));
            }
            .shutter-film-cell img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .shutter-film-cell.shutter-film-star {
                border-color: #FFEE11;
                box-shadow: 0 0 12px rgba(255, 238, 17, 0.75);
            }
            .shutter-film-badge {
                position: absolute;
                top: -12px;
                right: -9px;
                font-size: 17px;
                color: #FFEE11;
                text-shadow: 0 0 6px #FFEE11, 0 0 2px #000;
                font-family: monospace;
            }
            .shutter-film-time {
                position: absolute;
                bottom: 1px;
                left: 2px;
                font-family: monospace;
                font-size: 8px;
                color: rgba(255, 255, 255, 0.85);
                text-shadow: 0 0 3px #000;
            }
            .shutter-film-empty {
                color: rgba(216, 90, 48, 0.85);
                font-family: monospace;
                font-size: 12px;
                letter-spacing: 2px;
                padding: 28px 10px;
                white-space: nowrap;
            }
            .shutter-film-label {
                position: absolute;
                top: -22px;
                left: 50%;
                transform: translateX(-50%);
                color: #D85A30;
                font-family: monospace;
                font-size: 12px;
                font-weight: bold;
                letter-spacing: 3px;
                text-shadow: 0 0 8px #D85A30;
                white-space: nowrap;
            }
            @media (max-width: 767px) {
                .shutter-film-cell { width: 54px; height: 54px; border-width: 2px; }
                #shutter-filmstrip-track { gap: 6px; padding: 14px 12px; }
            }
        `;
        document.head.appendChild(this.customStyleElement);
    }

    createViewfinderUI() {
        this.viewfinder = document.createElement('div');
        this.viewfinder.style.position = 'absolute';
        this.viewfinder.style.top = '0';
        this.viewfinder.style.left = '0';
        this.viewfinder.style.width = '100%';
        this.viewfinder.style.height = '100%';
        this.viewfinder.style.pointerEvents = 'none';
        this.viewfinder.style.zIndex = '30';
        this.viewfinder.style.boxSizing = 'border-box';
        
        // Target bracket styles
        const bracketStyle = `
            position: absolute;
            width: 50px;
            height: 50px;
            border: 4px solid ${this.themeColor};
            opacity: 0.7;
        `;
        
        // 液晶インジケーターのスタイル
        const indicatorContainerStyle = `
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            width: 130px;
            padding: 10px;
            background: rgba(17, 8, 5, 0.75);
            border: 1px solid rgba(185, 84, 60, 0.4);
            border-radius: 4px;
            font-family: 'Courier New', Courier, monospace;
            color: ${this.themeColor};
            font-size: 11px;
            box-sizing: border-box;
            backdrop-filter: blur(4px);
            transition: all 0.2s ease;
        `;
        
        this.viewfinder.innerHTML = `
            <!-- Brackets -->
            <div style="${bracketStyle}; top: 40px; left: 40px; border-right: none; border-bottom: none;"></div>
            <div style="${bracketStyle}; top: 40px; right: 40px; border-left: none; border-bottom: none;"></div>
            <div style="${bracketStyle}; bottom: 40px; left: 40px; border-right: none; border-top: none;"></div>
            <div style="${bracketStyle}; bottom: 40px; right: 40px; border-left: none; border-top: none;"></div>
            
            <!-- REC Title -->
            <div style="position: absolute; top: 50px; left: 50%; transform: translateX(-50%); color: ${this.themeColor}; font-family: monospace; font-size: 20px; font-weight: bold; text-shadow: 0 0 10px ${this.themeColor};" id="shutter-rec-label">[ REC ]</div>
            
            <!-- CAMERA SETTINGS (Zoom & Aperture) -->
            <div style="position: absolute; top: 50px; left: 80px; color: ${this.themeColor}; font-family: monospace; font-size: 11px; font-weight: bold; text-shadow: 0 0 5px ${this.themeColor}; transition: all 0.1s;" id="shutter-zoom-label">ZOOM 1.0x</div>
            <div style="position: absolute; top: 50px; right: 80px; color: ${this.themeColor}; font-family: monospace; font-size: 11px; font-weight: bold; text-shadow: 0 0 5px ${this.themeColor}; transition: all 0.1s;" id="shutter-aperture-label">F2.8 [OPEN]</div>

            <!-- Center Crosshair (AF Focus Reticle) -->
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 30px; height: 30px; border: 1.5px solid ${this.themeColor}; border-radius: 50%; opacity: 0.7; box-shadow: 0 0 6px ${this.themeColor}; display: flex; align-items: center; justify-content: center;" id="shutter-center-reticle">
                <div style="width: 8px; height: 1.5px; background: ${this.themeColor}; position: absolute;"></div>
                <div style="width: 1.5px; height: 8px; background: ${this.themeColor}; position: absolute;"></div>
            </div>
            <!-- AF Indicator Text -->
            <div style="position: absolute; top: calc(50% + 25px); left: 50%; transform: translateX(-50%); font-family: monospace; font-size: 9px; color: ${this.themeColor}; opacity: 0.7; font-weight: bold; letter-spacing: 1px; text-shadow: 0 0 3px ${this.themeColor};" id="shutter-af-label">AUTO FOCUS</div>
            
            <!-- MIKU CH-1 Indicator (Left) -->
            <div style="${indicatorContainerStyle}; left: 40px;" id="miku-indicator-container">
                <div style="font-weight: bold; margin-bottom: 5px; color: #39C5BB; text-shadow: 0 0 4px #39C5BB;" id="miku-vocal-label">MIKU CH-1</div>
                <div style="display: flex; gap: 2px;" id="miku-meter-blocks">
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                </div>
                <div style="font-size: 8px; margin-top: 5px; opacity: 0.8; color: #39C5BB;" id="miku-status-txt">STANDBY</div>
            </div>
            
            <!-- RIN CH-2 Indicator (Right) -->
            <div style="${indicatorContainerStyle}; right: 40px;" id="rin-indicator-container">
                <div style="font-weight: bold; margin-bottom: 5px; color: #FFEE11; text-shadow: 0 0 4px #FFEE11;" id="rin-vocal-label">RIN CH-2</div>
                <div style="display: flex; gap: 2px;" id="rin-meter-blocks">
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                </div>
                <div style="font-size: 8px; margin-top: 5px; opacity: 0.8; color: #FFEE11;" id="rin-status-txt">STANDBY</div>
            </div>
            
            <!-- Alert Display -->
            <div id="shutter-alert-display" style="position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%); font-family: monospace; font-size: 14px; font-weight: bold; color: #ff3333; background: rgba(0,0,0,0.85); padding: 6px 16px; border: 1px solid #ff3333; border-radius: 3px; display: none; text-shadow: 0 0 5px #ff3333; letter-spacing: 2px; transition: all 0.1s;">ALERT: EXPOSURE</div>

            <!-- Vertical Zoom Slider (Right Side) -->
            <div style="position: absolute; right: 200px; top: 50%; transform: translateY(-50%); height: 250px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; pointer-events: auto; z-index: 35;" id="shutter-zoom-slider-container">
                <span style="color: ${this.themeColor}; font-family: monospace; font-size: 14px; font-weight: bold; text-shadow: 0 0 4px ${this.themeColor}; user-select: none;">[+]</span>
                <input type="range" id="shutter-zoom-slider" min="0.6" max="2.5" step="0.01" value="1.0" style="
                    -webkit-appearance: none;
                    appearance: none;
                    width: 6px;
                    height: 180px;
                    background: rgba(185, 84, 60, 0.2);
                    border: 1px solid rgba(185, 84, 60, 0.4);
                    outline: none;
                    border-radius: 3px;
                    cursor: pointer;
                    writing-mode: bt-lr;
                    -webkit-writing-mode: vertical-lr;
                    direction: rtl;
                ">
                <span style="color: ${this.themeColor}; font-family: monospace; font-size: 14px; font-weight: bold; text-shadow: 0 0 4px ${this.themeColor}; user-select: none;">[-]</span>
            </div>
        `;
        
        this.songWrapper.appendChild(this.viewfinder);
    }
 
    buildLyricsCache() {
        if (!playerManager.isTimerReady || !playerManager.player || !playerManager.player.video || !playerManager.player.video.firstPhrase) {
            return false;
        }
        
        this.allWordGroups = [];
        this.lyricTexturesCache = new Map(); // text -> { texture, aspect }
        
        let phrase = playerManager.player.video.firstPhrase;
        let index = 0;
        let phraseIndex = 0;
        
        while (phrase) {
            // フレーズインデックスから、100%精密な歌い分けマッピングを取得
            const vocal = SHUTTER_VOCAL_MAP[phraseIndex] || 'miku';
            
            const groups = groupPhraseWords(phrase);
            groups.forEach(group => {
                this.allWordGroups.push({
                    index: index++,
                    text: group.text,
                    startTime: group.startTime,
                    endTime: group.endTime,
                    phraseEndTime: phrase.endTime,
                    phraseIndex: phraseIndex,
                    vocal: vocal // 精密アノテーション
                });
                
                // 歌詞単語のテクスチャを事前にレンダリングしてキャッシュに蓄積
                if (!this.lyricTexturesCache.has(group.text)) {
                    this.lyricTexturesCache.set(group.text, this.createTextTexture(group.text));
                }
            });
            phrase = phrase.next;
            phraseIndex++;
        }
        
        this.allWordGroups.sort((a, b) => a.startTime - b.startTime);
        console.log(`Successfully cached ${this.allWordGroups.length} word groups and pre-rendered ${this.lyricTexturesCache.size} textures for Shutter Chance.`);
        this.lyricsCacheBuilt = true;
        return true;
    }

    createTextTexture(text) {
        const charCount = Math.max(1, text.length);
        const canvas = document.createElement('canvas');
        
        // 1文字あたり 90px + 左右余白 64px
        const canvasWidth = Math.min(1024, charCount * 90 + 64);
        canvas.width = canvasWidth;
        canvas.height = 128;
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 文字数が多い場合はフォントサイズをやや小さくして隣接被りを排除
        const fontSize = charCount > 6 ? 54 : 72;
        ctx.font = `bold ${fontSize}px "Inter", "Noto Sans JP", sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = this.themeColor;
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        
        return {
            texture: texture,
            aspect: canvas.width / 128
        };
    }

    spawnWordText(group, wordEndTime, startTime, groupIndex) {
        const text = group.text;
        let texData = this.lyricTexturesCache ? this.lyricTexturesCache.get(text) : null;
        if (!texData) {
            texData = this.createTextTexture(text);
            if (this.lyricTexturesCache) {
                this.lyricTexturesCache.set(text, texData);
            }
        }
        const { texture, aspect } = texData;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        
        // 中心（ターゲットスコープ）のZ深度位置を基準に初期配置
        const targetPos = this.targetScope ? this.targetScope.position : new THREE.Vector3(0, 0, -15);
        
        // 出現位置が重なって被るのを防ぐため、画面内の広い範囲から衝突しない安全な座標を探索
        let posX = targetPos.x;
        let posY = targetPos.y;
        let posZ = targetPos.z;
        
        let bestX = posX;
        let bestY = posY;
        let bestZ = posZ;
        let minOverlapScore = Infinity;
        
        const candidateScale = 2.25;
        const newWidth = candidateScale * aspect;
        const newHeight = candidateScale;
        
        for (let attempt = 0; attempt < 30; attempt++) {
            // 探索範囲内でランダムに座標候補を生成
            const testX = targetPos.x + (Math.random() - 0.5) * 12.5;
            const testY = targetPos.y + (Math.random() - 0.5) * 8.5;
            const testZ = targetPos.z - Math.random() * 1.5;
            
            let overlaps = false;
            let overlapScore = 0;
            
            for (const other of this.activeSprites) {
                // すでにフレームに収められて落下中のものは位置判定から除外
                if (other.userData.frameTarget) continue;
                
                const otherWidth = other.scale.x;
                const otherHeight = other.scale.y;
                
                const dx = Math.abs(testX - other.position.x);
                const dy = Math.abs(testY - other.position.y);
                
                // 横方向・縦方向の最小マージン（少しの重なりは許容するよう安全係数 0.45 = 90% で計算）
                const minXDist = (newWidth + otherWidth) * 0.45;
                const minYDist = (newHeight + otherHeight) * 0.45;
                
                if (dx < minXDist && dy < minYDist) {
                    overlaps = true;
                    // 不透明度で重みを付け、消えかかっている歌詞との重なりは許容度を上げる
                    const opacity = other.material ? other.material.opacity : 1;
                    overlapScore += (minXDist - dx) * (minYDist - dy) * opacity;
                }
            }
            
            if (!overlaps) {
                bestX = testX;
                bestY = testY;
                bestZ = testZ;
                break;
            } else {
                if (overlapScore < minOverlapScore) {
                    minOverlapScore = overlapScore;
                    bestX = testX;
                    bestY = testY;
                    bestZ = testZ;
                }
            }
        }
        
        posX = bestX;
        posY = bestY;
        posZ = bestZ;
        
        sprite.position.set(posX, posY, posZ);
        
        // 四方八方に散るための角度をランダムに決定 (0〜2PI)
        const angle = Math.random() * Math.PI * 2;
        
        // 散る速度を「ゆっくり」設定 (1秒間で 0.6 〜 1.6 単位程度)
        const speed = 0.6 + Math.random() * 1.0;
        
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        sprite.userData = {
            birthTime: startTime,
            deathTime: wordEndTime,
            text: text,
            baseScale: 2.0 + Math.random() * 0.5, // 飛び散るため少しだけコンパクトにして読みやすさとのバランスをとる
            aspect: aspect,
            groupIndex: groupIndex,
            vocal: group.vocal,
            dirX: dirX,
            dirY: dirY,
            scatterSpeed: speed,
            startPosition: new THREE.Vector3(posX, posY, posZ)
        };
        
        const scale = sprite.userData.baseScale;
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        // Use high-precision smoothed time to ensure ultra-smooth transitions
        const position = this.getSmoothedTime();
        this.lastPosition = position;

        // --- ズーム制御とイージング補間 ---
        this.zoomLevel += (this.targetZoom - this.zoomLevel) * 0.15;
        if (this.camera) {
            this.camera.fov = 75 / this.zoomLevel;
            this.camera.updateProjectionMatrix();
            
            // カメラのドラッグ首振りアングルを滑らかにイージング更新 (YXZオイラー角)
            this.cameraRotation.lerp(this.targetCameraRotation, 0.1);
            this.camera.rotation.set(-this.cameraRotation.x, this.cameraRotation.y, 0, 'YXZ');
        }

        // スライダーのツマミを現在のズーム目標値に自動追随させる（双方向バインド）
        const slider = document.getElementById('shutter-zoom-slider');
        if (slider && document.activeElement !== slider) {
            slider.value = this.targetZoom.toFixed(2);
        }

        // --- ズーム ＆ 絞り液晶表示の更新 ---
        const zoomLabel = document.getElementById('shutter-zoom-label');
        const apertureLabel = document.getElementById('shutter-aperture-label');
        if (zoomLabel) {
            zoomLabel.innerText = `ZOOM ${this.zoomLevel.toFixed(1)}x`;
            // ズームしている時はカラーをイエロー系にして警告感を出す
            zoomLabel.style.color = this.zoomLevel > 1.2 ? '#FFEE11' : this.themeColor;
            zoomLabel.style.textShadow = this.zoomLevel > 1.2 ? '0 0 5px #FFEE11' : `0 0 5px ${this.themeColor}`;
        }
        if (apertureLabel) {
            // ズームするほどF値が開き（小さく）、引くほど絞られる（大きく）リアルな設定
            // ズーム範囲 0.6 〜 2.5 ➔ F値 8.0 〜 1.8
            const fVal = (8.0 - (this.zoomLevel - 0.6) * (6.2 / 1.9)).toFixed(1);
            const clampedF = Math.min(8.0, Math.max(1.4, parseFloat(fVal))).toFixed(1);
            let stateStr = 'NORMAL';
            if (clampedF <= 2.0) stateStr = 'OPEN';
            else if (clampedF >= 5.6) stateStr = 'SHARP';
            apertureLabel.innerText = `F${clampedF} [${stateStr}]`;
            apertureLabel.style.color = clampedF <= 2.0 ? '#39C5BB' : this.themeColor;
            apertureLabel.style.textShadow = clampedF <= 2.0 ? '0 0 5px #39C5BB' : `0 0 5px ${this.themeColor}`;
        }
        
        // Climax state detection based on smoothed playhead position
        const isPlaying = playerManager.player && playerManager.player.isPlaying;
        const chorus = (isPlaying && position > 1500 && typeof playerManager.player.findChorus === 'function') 
                       ? playerManager.player.findChorus(position) 
                       : null;
        this.isClimax = !!chorus;
        
        if (this.isClimax && !this.climaxTriggered) {
            this.climaxTriggered = true;
        } else if (!this.isClimax && this.climaxTriggered) {
            this.climaxTriggered = false;
        }

        // --- 液晶ライブメーターのアニメーション制御 ---
        const currentWord = isPlaying ? (playerManager.player.video.findWord(position) || playerManager.player.video.findChar(position)) : null;
        let activeVocal = 'none';
        
        if (currentWord) {
            const cached = this.allWordGroups.find(g => g.startTime <= position && position <= g.endTime);
            if (cached) {
                activeVocal = this.isClimax ? 'duet' : cached.vocal;
            } else {
                activeVocal = this.isClimax ? 'duet' : 'miku'; // fallback
            }
        } else if (this.isClimax) {
            activeVocal = 'duet';
        }
        
        this.animateVocalMeters(activeVocal, position);

        // 1. 動いている赤い背景ワイヤーフレームのアニメーション
        for (let i = 0; i < this.frames.length; i++) {
            const frame = this.frames[i];
            
            // 軌道の進行と位置の更新
            frame.userData.orbitAngle += frame.userData.orbitSpeed;
            this.updateFramePosition(frame);

            // 自転アニメーション
            frame.rotation.x += frame.userData.rotSpeed.x;
            frame.rotation.y += frame.userData.rotSpeed.y;
            frame.rotation.z += frame.userData.rotSpeed.z;

            // はめ込まれている写真があれば、位置と回転を完全に追従させ、さらにフェードアウト処理を行う
            if (frame.userData.hasPhoto && frame.userData.photoMesh) {
                frame.userData.photoMesh.position.copy(frame.position);
                frame.userData.photoMesh.quaternion.copy(frame.quaternion);

                // 古い写真のフェードアウト消去ライフサイクル
                if (frame.userData.isFadingOut) {
                    frame.userData.fadeOpacity -= 0.02; // 約1秒かけてフェードアウト
                    if (frame.userData.fadeOpacity <= 0) {
                        const photo = frame.userData.photoMesh;
                        this.scene.remove(photo);
                        if (photo.material) {
                            if (photo.material.map) photo.material.map.dispose();
                            photo.material.dispose();
                        }
                        frame.userData.hasPhoto = false;
                        frame.userData.photoMesh = null;
                        frame.userData.photoImage = null;
                        frame.userData.isFadingOut = false;
                        frame.userData.fadeOpacity = 1.0;
                    } else {
                        frame.userData.photoMesh.material.opacity = frame.userData.fadeOpacity;
                    }
                } else {
                    frame.userData.photoMesh.material.opacity = 1.0;
                }
            }
        }

        // 2. 吸い込み移動・トランジション中の写真メッシュのアニメーション
        for (let i = this.transitioningPhotos.length - 1; i >= 0; i--) {
            const photo = this.transitioningPhotos[i];
            const data = photo.userData;

            // 最初のフレームがレンダリングされた瞬間に時間をリセットし、テクスチャ転送ラグを完璧に相殺！
            if (data.startTime === 0) {
                data.startTime = Date.now();
            }
            const elapsed = Date.now() - data.startTime;
            const holdDur = data.holdDuration || 0;
            const targetFrame = data.targetFrame;
            
            if (elapsed < holdDur) {
                // 【フェーズ1：目前でのホールド表示 (一瞬大きく表示する提示機能)】
                photo.position.set(0, 0, this.camera.position.z - 3);
                photo.quaternion.copy(this.camera.quaternion);
                
                // 出現時のわずかなズームアップ演出 (0.8から1.2倍へ) ＆ ズームレベルに反比例させて一定の見かけサイズに保つ
                const zoomProgress = Math.min(1.0, elapsed / 300);
                const currentScale = (0.8 + 0.4 * zoomProgress) / this.zoomLevel;
                photo.scale.set(currentScale, currentScale, currentScale);
                
                data.startPos.copy(photo.position);
                data.startRot.copy(photo.quaternion);
                continue;
            }
            
            // 【フェーズ2：赤い枠（targetFrame）への吸い込み】
            const travelTime = elapsed - holdDur;
            const progress = Math.min(1.0, travelTime / data.duration);
            const t = progress * progress * (3 - 2 * progress);
            
            if (progress < 1.0 && targetFrame && !targetFrame.userData.dropSpeed) {
                photo.position.lerpVectors(data.startPos, targetFrame.position, t);
                photo.quaternion.slerpQuaternions(data.startRot, targetFrame.quaternion, t);
                
                // 開始時の一定見かけスケール (1.2 / zoomLevel) から、最終的な本来の枠のスケール (1.0) へ滑らかに遷移させる
                const startScale = 1.2 / this.zoomLevel;
                const endScale = 1.0;
                const scaleT = startScale + (endScale - startScale) * t;
                photo.scale.set(scaleT, scaleT, scaleT);
            } else {
                this.transitioningPhotos.splice(i, 1);
                
                if (targetFrame && !targetFrame.userData.dropSpeed) {
                    // シーンから削除せず、直接シーン直下でtargetFrameに追従させる
                    photo.position.copy(targetFrame.position);
                    photo.quaternion.copy(targetFrame.quaternion);
                    photo.scale.set(1, 1, 1);
                    targetFrame.userData.photoMesh = photo;
                    targetFrame.userData.photoSpawnTime = Date.now(); // 写真登録時刻を記録
                    targetFrame.userData.fadeOpacity = 1.0;
                    targetFrame.userData.isFadingOut = false;
                } else {
                    this.scene.remove(photo);
                    if (photo.material) {
                        if (photo.material.map) photo.material.map.dispose();
                        photo.material.dispose();
                    }
                }
            }
        }

        // 3. DETERMINISTIC lyric sprite spawning and deletion
        if (!this.lyricsCacheBuilt) {
            this.buildLyricsCache();
        }

        // Filter groups that should be visible on screen (extended post-singing lifespan to +2500ms for prolonged presence)
        let activeGroups = this.allWordGroups.filter(g => 
            position >= g.startTime - 600 && position <= g.endTime + 2500
        );

        // Deduplicate activeGroups by text to prevent duet/unison overlaps and rapid consecutive identical word doubling
        const seenText = new Set();
        activeGroups = activeGroups.filter(g => {
            if (seenText.has(g.text)) {
                return false;
            }
            seenText.add(g.text);
            return true;
        });

        // First, remove out-of-bounds sprites immediately to keep the scene pristine and free grid cells
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const s = this.activeSprites[i];
            const groupIndex = s.userData.groupIndex;
            
            // Check if this sprite is still in the active groups list
            const isStillActive = activeGroups.some(g => g.index === groupIndex);
            
            if (!isStillActive) {
                if (s.userData.cellIdx !== undefined) {
                    this.occupiedCells.delete(s.userData.cellIdx);
                }
                this.scene.remove(s);
                s.material.dispose();
                this.activeSprites.splice(i, 1);
            }
        }

        // Build a map of currently active sprites keyed by their group index
        const currentSpritesMap = new Map();
        this.activeSprites.forEach(s => {
            if (s.userData && typeof s.userData.groupIndex === 'number') {
                currentSpritesMap.set(s.userData.groupIndex, s);
            }
        });

        // Spawn missing active sprites
        activeGroups.forEach(g => {
            if (!currentSpritesMap.has(g.index)) {
                this.spawnWordText(g, g.endTime, g.startTime, g.index);
            }
        });

        // Animate remaining active sprites
        for (let i = 0; i < this.activeSprites.length; i++) {
            const s = this.activeSprites[i];

            // Opacity management (birthTime is startTime, deathTime is endTime)
            const birthTime = s.userData.birthTime;
            const deathTime = s.userData.deathTime;

            // 歌詞をターゲット（中心）から四方八方にゆっくりと散らせる
            const elapsedSeconds = Math.max(0, (position - birthTime) / 1000);
            
            if (s.userData.startPosition && s.userData.dirX !== undefined) {
                const startPos = s.userData.startPosition;
                const dirX = s.userData.dirX;
                const dirY = s.userData.dirY;
                const speed = s.userData.scatterSpeed;
                
                // 方向ベクトル * 速度 * 経過時間分だけ外側へ移動
                s.position.x = startPos.x + dirX * speed * elapsedSeconds;
                s.position.y = startPos.y + dirY * speed * elapsedSeconds;
                // Z座標もゆっくり手前に浮かび上がらせて奥行きのアニメーションを強化
                s.position.z = startPos.z + elapsedSeconds * 0.2;
            }
            
            const fadeStart = birthTime - 600;
            const fadeEnd = birthTime - 450;
            
            if (position < fadeStart) {
                s.material.opacity = 0;
            } else if (position < fadeEnd) {
                s.material.opacity = (position - fadeStart) / (fadeEnd - fadeStart);
            } else if (position > deathTime + 2000) {
                // Keep fully visible for 2000ms after singing, then fade out smoothly over 500ms (total 2500ms)
                const fadeOutStart = deathTime + 2000;
                const fadeProgress = (position - fadeOutStart) / 500;
                s.material.opacity = Math.max(0, 1 - fadeProgress);
            } else {
                s.material.opacity = 1;
            }

            // Vocal singing pulse (bounce & color transition based on singer)
            const isWordActive = position >= birthTime - 450 && position <= deathTime - 450;
            if (!s.userData.pulseProgress) s.userData.pulseProgress = 0;
            const targetPulse = isWordActive ? 1.0 : 0.0;
            s.userData.pulseProgress += (targetPulse - s.userData.pulseProgress) * 0.2;
            const pulse = s.userData.pulseProgress;
            const pulseScaleFactor = 1.0 + pulse * 0.25; // 1.25x bounce
            
            const baseScale = s.userData.baseScale || 3.0;
            const aspect = s.userData.aspect || 1.0;
            s.scale.set(baseScale * aspect * pulseScaleFactor, baseScale * pulseScaleFactor, 1);
            
            // 歌い手に応じた発光色 (ミク=シアン, リン=イエロー, サビ=深紅)
            const vocal = s.userData.vocal;
            if (this.isClimax) {
                s.material.color.setRGB(1.0, 1.0 - pulse * 0.4, 1.0 - pulse * 0.4); // Gold-Sunset Red
            } else if (vocal === 'miku') {
                s.material.color.setRGB(1.0 - pulse * 0.6, 1.0, 1.0 - pulse * 0.1); // Cyan Glow
            } else {
                s.material.color.setRGB(1.0, 1.0 - pulse * 0.1, 1.0 - pulse * 0.8); // Yellow Glow
            }
        }

        // ターゲットスコープのパルス脈動（Beatシンクロ） ＆ 回転
        if (this.targetScope) {
            const beat = playerManager.player ? playerManager.player.findBeat(position) : null;
            let pulseScale = 1.0;
            if (beat) {
                const beatElapsed = position - beat.startTime;
                const beatProgress = Math.min(1.0, beatElapsed / beat.duration);
                pulseScale = 1.0 + 0.25 * Math.exp(-beatProgress * 4.0); // 拍の頭でパッと広がり、指数減衰で縮む
            }
            this.targetScope.scale.set(pulseScale, pulseScale, 1.0);

            // ターゲットサークル自体をゆっくり回転させてSFチックにする
            this.targetScope.rotation.z += 0.01;
        }

        // --- 被写体ミクVRMのポーズ切替＆アイドルアニメーション ---
        if (this.mikuVRM) {
            const nowReal = performance.now();
            if (this.lastVrmRealTime === undefined) this.lastVrmRealTime = nowReal;
            const deltaTime = Math.min(0.05, (nowReal - this.lastVrmRealTime) / 1000);
            this.lastVrmRealTime = nowReal;

            // フレーズ切替でポーズチェンジ
            const currentPhrase = playerManager.player.video.findPhrase(position);
            if (currentPhrase && currentPhrase.startTime !== this.lastPhraseStartTime) {
                this.lastPhraseStartTime = currentPhrase.startTime;
                this.advanceMikuPose();
            }

            // ビート4拍ごとにもポーズチェンジ（間奏などフレーズが無い区間用）
            const poseBeat = playerManager.player ? playerManager.player.findBeat(position) : null;
            if (poseBeat && poseBeat.startTime !== this.lastPoseBeatStart) {
                this.lastPoseBeatStart = poseBeat.startTime;
                this.poseBeatCounter++;
                if (!currentPhrase && this.poseBeatCounter % 4 === 0) {
                    this.advanceMikuPose();
                }
            }

            // サビ突入の瞬間は両手チアーポーズへ
            if (this.isClimax && this.mikuPoseIndex !== 3 && currentPhrase &&
                currentPhrase.startTime === this.lastPhraseStartTime &&
                position - currentPhrase.startTime < 200) {
                this.mikuPoseIndex = 3;
            }

            // 目標ポーズへ滑らかに補間
            this.lerpMikuPose(SHUTTER_MIKU_POSES[this.mikuPoseIndex], 0.08);

            // ビート同期の浮遊バウンス＆ゆれ（シーン生成からの相対時刻ベース）
            const floatT = position / 1000;
            let bounce = 0;
            if (poseBeat) {
                const beatProg = Math.min(1.0, (position - poseBeat.startTime) / poseBeat.duration);
                bounce = 0.12 * Math.exp(-beatProg * 5.0);
            }
            this.mikuVRM.scene.position.y = this.mikuBaseY + Math.sin(floatT * 1.8) * 0.06 + bounce;
            this.mikuVRM.scene.rotation.y = Math.sin(floatT * 0.5) * 0.08;
            this.mikuVRM.scene.rotation.z = Math.sin(floatT * 0.7) * 0.015;

            // VRM内部更新（スプリングボーン等）。モバイルは約30fpsに間引いて負荷削減
            if (this.isMobile) {
                this.vrmUpdateAccum += deltaTime;
                if (this.vrmUpdateAccum >= 1 / 30) {
                    this.mikuVRM.update(this.vrmUpdateAccum);
                    this.vrmUpdateAccum = 0;
                }
            } else {
                this.mikuVRM.update(deltaTime);
            }
        }

        // --- 曲終了12秒前: フィルムストリップ（撮影成果の回収演出）を表示 ---
        const video = playerManager.player.video;
        if (!this.filmStripVisible && video && video.duration > 0 &&
            position >= video.duration - 12000) {
            this.showFilmStrip();
        }
    }

    animateVocalMeters(activeVocal, position) {
        const mikuContainer = document.getElementById('miku-indicator-container');
        const rinContainer = document.getElementById('rin-indicator-container');
        const recLabel = document.getElementById('shutter-rec-label');
        
        if (!mikuContainer || !rinContainer) return;
        
        // RECラベルを優雅に点滅させる
        if (recLabel) {
            recLabel.style.opacity = (Math.floor(position / 600) % 2 === 0) ? '1.0' : '0.25';
        }
        
        let mikuIntensity = 0;
        let rinIntensity = 0;
        
        if (activeVocal === 'miku') {
            mikuIntensity = 2 + Math.floor(Math.sin(position * 0.05) * 2) + Math.floor(Math.random() * 2);
            mikuIntensity = Math.max(1, Math.min(5, mikuIntensity));
            
            document.getElementById('miku-status-txt').innerText = 'VOCAL_ACTIVE';
            document.getElementById('rin-status-txt').innerText = 'STANDBY';
            mikuContainer.style.borderColor = 'rgba(57, 197, 187, 0.7)';
            mikuContainer.style.boxShadow = '0 0 10px rgba(57, 197, 187, 0.25)';
            rinContainer.style.borderColor = 'rgba(185, 84, 60, 0.2)';
            rinContainer.style.boxShadow = 'none';
        } else if (activeVocal === 'rin') {
            rinIntensity = 2 + Math.floor(Math.sin(position * 0.05) * 2) + Math.floor(Math.random() * 2);
            rinIntensity = Math.max(1, Math.min(5, rinIntensity));
            
            document.getElementById('miku-status-txt').innerText = 'STANDBY';
            document.getElementById('rin-status-txt').innerText = 'VOCAL_ACTIVE';
            rinContainer.style.borderColor = 'rgba(255, 238, 17, 0.7)';
            rinContainer.style.boxShadow = '0 0 10px rgba(255, 238, 17, 0.25)';
            mikuContainer.style.borderColor = 'rgba(185, 84, 60, 0.2)';
            mikuContainer.style.boxShadow = 'none';
        } else if (activeVocal === 'duet') {
            mikuIntensity = 3 + Math.floor(Math.sin(position * 0.08) * 2) + Math.floor(Math.random() * 2);
            mikuIntensity = Math.max(2, Math.min(5, mikuIntensity));
            
            rinIntensity = 3 + Math.floor(Math.cos(position * 0.08) * 2) + Math.floor(Math.random() * 2);
            rinIntensity = Math.max(2, Math.min(5, rinIntensity));
            
            document.getElementById('miku-status-txt').innerText = 'DUET_MAX';
            document.getElementById('rin-status-txt').innerText = 'DUET_MAX';
            
            mikuContainer.style.borderColor = 'rgba(57, 197, 187, 0.8)';
            mikuContainer.style.boxShadow = '0 0 12px rgba(57, 197, 187, 0.35)';
            rinContainer.style.borderColor = 'rgba(255, 238, 17, 0.8)';
            rinContainer.style.boxShadow = '0 0 12px rgba(255, 238, 17, 0.35)';
        } else {
            document.getElementById('miku-status-txt').innerText = 'STANDBY';
            document.getElementById('rin-status-txt').innerText = 'STANDBY';
            mikuContainer.style.borderColor = 'rgba(185, 84, 60, 0.2)';
            mikuContainer.style.boxShadow = 'none';
            rinContainer.style.borderColor = 'rgba(185, 84, 60, 0.2)';
            rinContainer.style.boxShadow = 'none';
        }
        
        // Miku メーターブロックの点灯
        const mikuBlocks = document.getElementById('miku-meter-blocks').children;
        for (let i = 0; i < 5; i++) {
            if (i < mikuIntensity) {
                mikuBlocks[i].style.background = '#39C5BB';
            } else {
                mikuBlocks[i].style.background = 'rgba(57, 197, 187, 0.15)';
            }
        }
        
        // Rin メーターブロックの点灯
        const rinBlocks = document.getElementById('rin-meter-blocks').children;
        for (let i = 0; i < 5; i++) {
            if (i < rinIntensity) {
                rinBlocks[i].style.background = '#FFEE11';
            } else {
                rinBlocks[i].style.background = 'rgba(255, 238, 17, 0.15)';
            }
        }
    }

    // 撮影写真をフィルムストリップ用に内部記録（小型サムネイル化・最大12枚で古い順に間引き）
    recordPhotoToFilm(canvas, starred, timeStr) {
        const thumbSize = this.isMobile ? 112 : 160;
        const thumb = document.createElement('canvas');
        thumb.width = thumbSize;
        thumb.height = thumbSize;
        const tctx = thumb.getContext('2d');
        tctx.drawImage(canvas, 0, 0, thumbSize, thumbSize);
        const url = thumb.toDataURL('image/jpeg', 0.72);

        this.photoLog.push({ url: url, starred: starred, timeStr: timeStr });
        while (this.photoLog.length > this.MAX_FILM_PHOTOS) {
            this.photoLog.shift(); // 超過分は古い順に間引く
        }

        // すでにフィルムストリップ表示中なら即時反映
        if (this.filmStripVisible) {
            this.renderFilmStripPhotos();
        }
    }

    // 曲終了が近づいたら画面下部に撮影成果をフィルムとして横一列表示
    showFilmStrip() {
        if (this.filmStripVisible || !this.songWrapper) return;
        this.filmStripVisible = true;

        const strip = document.createElement('div');
        strip.id = 'shutter-filmstrip';
        strip.innerHTML = `
            <div id="shutter-filmstrip-track" style="position: relative;">
                <span class="shutter-film-label">— FILM ROLL : BEST MOMENTS —</span>
            </div>
        `;
        this.songWrapper.appendChild(strip);
        this.filmStripEl = strip;
        this.renderFilmStripPhotos();

        requestAnimationFrame(() => {
            strip.classList.add('shutter-filmstrip-visible');
        });
    }

    renderFilmStripPhotos() {
        if (!this.filmStripEl) return;
        const track = this.filmStripEl.querySelector('#shutter-filmstrip-track');
        if (!track) return;

        const label = '<span class="shutter-film-label">— FILM ROLL : BEST MOMENTS —</span>';
        if (this.photoLog.length === 0) {
            track.innerHTML = `${label}<div class="shutter-film-empty">NO FILM — タップでシャッターを切ろう！</div>`;
            return;
        }

        const cells = this.photoLog.map((p, i) => {
            const tilt = ((i % 2 === 0) ? -1 : 1) * (1 + (i % 3));
            return `
                <div class="shutter-film-cell${p.starred ? ' shutter-film-star' : ''}" style="--film-tilt: ${tilt}deg;">
                    <img src="${p.url}" alt="">
                    ${p.starred ? '<span class="shutter-film-badge">★</span>' : ''}
                    <span class="shutter-film-time">${p.timeStr}</span>
                </div>
            `;
        }).join('');
        track.innerHTML = label + cells;
    }

    triggerShutterFlash() {
        const flash = document.createElement('div');
        flash.style.position = 'absolute';
        flash.style.top = '0';
        flash.style.left = '0';
        flash.style.width = '100%';
        flash.style.height = '100%';
        flash.style.background = '#ffffff';
        flash.style.zIndex = '50';
        flash.style.pointerEvents = 'none';
        flash.style.transition = 'opacity 0.2s ease-out';
        this.songWrapper.appendChild(flash);
        
        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => {
                if (flash.parentNode) flash.parentNode.removeChild(flash);
            }, 300);
        }, 50);
    }
    
    // 被写体ミクVRMだけを透過レンダリングし、ポラロイド写真の中央に焼き付ける
    burnMikuIntoPhoto(ctx, photoX, photoY, photoW, photoH) {
        if (!this.mikuVRM || !this.renderer) return;

        // ミク以外のオブジェクトを一時的に非表示にする
        const toHide = [];
        this.frames.forEach(f => {
            toHide.push(f);
            if (f.userData.photoMesh) toHide.push(f.userData.photoMesh);
        });
        this.activeSprites.forEach(s => toHide.push(s));
        this.transitioningPhotos.forEach(p => toHide.push(p));
        if (this.targetScope) toHide.push(this.targetScope);

        const prevVisibility = toHide.map(o => o.visible);
        toHide.forEach(o => { o.visible = false; });

        const prevBackground = this.scene.background;
        const prevFog = this.scene.fog;
        this.scene.background = null;
        this.scene.fog = null;

        try {
            // ミクのみを透過背景でレンダリングし、その場でCanvasへ転写
            this.renderer.render(this.scene, this.camera);

            const srcCanvas = this.renderer.domElement;
            const srcW = srcCanvas.width;
            const srcH = srcCanvas.height;

            // 写真エリアのアスペクト比に合わせて中央クロップ
            const photoAspect = photoW / photoH;
            let sw = srcW;
            let sh = srcW / photoAspect;
            if (sh > srcH) {
                sh = srcH;
                sw = srcH * photoAspect;
            }
            const sx = (srcW - sw) / 2;
            const sy = (srcH - sh) / 2;

            ctx.save();
            ctx.globalAlpha = 0.96;
            ctx.drawImage(srcCanvas, sx, sy, sw, sh, photoX, photoY, photoW, photoH);
            ctx.restore();
        } catch (err) {
            console.warn('[SHUTTER] Miku burn-in skipped:', err);
        }

        // すべての可視状態と背景・フォグを復元
        toHide.forEach((o, i) => { o.visible = prevVisibility[i]; });
        this.scene.background = prevBackground;
        this.scene.fog = prevFog;
    }

    takePhoto() {
        if (!playerManager.player || !playerManager.player.isPlaying || !playerManager.player.timer) {
            return;
        }

        // 高精度に補間された描画時間（smoothed time）を使用し、画面描画とミリ秒レベルで同期させる
        const position = this.getSmoothedTime();
        if (position <= 0) {
            return;
        }

        // Ensure camera and scene world matrices are completely up-to-date before projections
        this.camera.updateMatrixWorld(true);
        this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
        this.scene.updateMatrixWorld(true);

        this.triggerShutterFlash();

        // 撮影瞬間のボーカル（ミク / リン / サビならduet）をキャッシュデータおよびアクティブスプライトから判定
        let activeVocal = 'none';
        
        const cached = this.allWordGroups.find(g => g.startTime <= position && position <= g.endTime);
        if (cached) {
            activeVocal = this.isClimax ? 'duet' : cached.vocal;
        } else if (this.isClimax) {
            activeVocal = 'duet';
        } else {
            // アクティブな表示スプライトから多数決で判別
            const mikuCount = this.activeSprites.filter(s => s.userData.vocal === 'miku').length;
            const rinCount = this.activeSprites.filter(s => s.userData.vocal === 'rin').length;
            if (mikuCount > 0 || rinCount > 0) {
                activeVocal = mikuCount >= rinCount ? 'miku' : 'rin';
            } else {
                activeVocal = 'miku'; // fallback
            }
        }

        // 【★ベストショット判定】サビ中（findChorus）またはミク＆リン両ボーカル同時パート中の撮影
        const isBestShot = this.isClimax || activeVocal === 'duet';

        // 【フォトスポット・ターゲットロック判定 (案B)】
        let isTargetLocked = false;
        let lockedWordText = '';
        if (this.targetScope) {
            this.activeSprites.forEach(sprite => {
                // 各スプライト固有のオフセットターゲット座標を取得
                const offset = sprite.userData.targetOffset || new THREE.Vector2(0, 0);
                const targetPos = new THREE.Vector3(
                    this.targetScope.position.x + offset.x,
                    this.targetScope.position.y + offset.y,
                    sprite.position.z // Z座標は同じ深度
                );
                
                const dist = sprite.position.distanceTo(targetPos);
                // 各自の指定ピント位置へ十分に吸着しているか（距離が 1.5 以内かつある程度不透明）を判定！
                if (dist <= 1.5 && sprite.material && sprite.material.opacity > 0.5) {
                    isTargetLocked = true;
                    lockedWordText = sprite.userData.text;
                }
            });
        }

        // 液晶画面に [SHOT!] アラート表示をトリガー
        const alertDisp = document.getElementById('shutter-alert-display');
        if (alertDisp) {
            alertDisp.style.display = 'block';
            if (isTargetLocked) {
                alertDisp.innerText = '★ TARGET LOCKED ★';
                alertDisp.style.color = '#FFEE11';
                alertDisp.style.borderColor = '#FFEE11';
                alertDisp.style.textShadow = '0 0 15px #FFEE11, 0 0 5px #ffffff';
            } else {
                alertDisp.innerText = activeVocal === 'miku' ? 'SHOT: MIKU_CH' : (activeVocal === 'rin' ? 'SHOT: RIN_CH' : 'SHOT: DUET_MAX');
                const alertColor = activeVocal === 'miku' ? '#39C5BB' : (activeVocal === 'rin' ? '#FFEE11' : '#B9543C');
                alertDisp.style.color = alertColor;
                alertDisp.style.borderColor = alertColor;
                alertDisp.style.textShadow = `0 0 8px ${alertColor}`;
            }
            
            setTimeout(() => {
                alertDisp.style.display = 'none';
            }, 600);
        }

        // 1. 古い写真の枚数制限処理を実行
        const activePhotoFrames = this.frames.filter(f => f.userData.hasPhoto && !f.userData.isFadingOut);
        const MAX_PHOTOS = 8;
        if (activePhotoFrames.length >= MAX_PHOTOS) {
            activePhotoFrames.sort((a, b) => a.userData.photoSpawnTime - b.userData.photoSpawnTime);
            const oldest = activePhotoFrames[0];
            oldest.userData.isFadingOut = true;
            oldest.userData.fadeOpacity = 1.0;
        }

        // 2. 背景を浮遊している赤いワイヤーフレームの中から、まだ写真が入っていない(hasPhoto = false)ものを抽出し、奥の方（Z座標がより小さくカメラから遠い）順にソートする
        const availableFrames = this.frames.filter(f => !f.userData.hasPhoto && !f.userData.dropSpeed);
        
        // Z座標の昇順でソート（最も奥にあるフレームが先頭にくる）
        availableFrames.sort((a, b) => a.position.z - b.position.z);
        
        // できるだけ背景の奥の方にある赤い枠（最も遠い上位3つ）からランダムに選択することで、自然な分散を持たせつつ奥へ吸い込まれる演出にする
        const candidates = availableFrames.slice(0, Math.min(3, availableFrames.length));
        const targetFrame = candidates.length > 0 
            ? candidates[Math.floor(Math.random() * candidates.length)]
            : this.frames.find(f => !f.userData.dropSpeed);

        if (!targetFrame) return; // 浮遊フレームが万が一見つからない場合は処理をスキップ

        // 2. メモリ上に Canvas を作成し、スナップショットを描画
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // 【Beat同期判定に応じたポラロイド台紙（枠）カラー】
        const player = playerManager.player;
        let isBeatSynced = false;
        if (player && typeof player.findBeat === 'function') {
            const beat = player.findBeat(position);
            if (beat) {
                const diff = Math.abs(position - beat.startTime);
                if (diff <= 150) {
                    isBeatSynced = true;
                }
            }
        }

        // 【フォトスポット ＆ Beat同期のカラー台紙マージ判定】
        const hasColorBorder = isBeatSynced || isTargetLocked;

        // ポラロイドの枠（台紙）の描画
        if (isTargetLocked) {
            // 最上位アワード：ターゲットロックオン成功（極上のネオ・パステルレインボー）
            const bgGrad = ctx.createLinearGradient(0, 0, 1024, 1024);
            bgGrad.addColorStop(0, '#39C5BB'); // シアン
            bgGrad.addColorStop(0.4, '#FFEE11'); // イエロー
            bgGrad.addColorStop(0.7, '#FF3366'); // ネオンピンク
            bgGrad.addColorStop(1, '#9B5DE5'); // パープル
            ctx.fillStyle = bgGrad;
        } else if (isBeatSynced) {
            // Beat同期成功：歌唱パートに合わせてカラー化
            const bgGrad = ctx.createLinearGradient(0, 0, 1024, 1024);
            if (activeVocal === 'miku') {
                // ミク：さわやかなシアン
                bgGrad.addColorStop(0, '#39C5BB');
                bgGrad.addColorStop(1, '#20857E');
            } else if (activeVocal === 'rin') {
                // リン：鮮やかなイエロー
                bgGrad.addColorStop(0, '#FFEE11');
                bgGrad.addColorStop(1, '#B5A500');
            } else {
                // デュエット・合唱：シアンとイエローの美しいグラデーション
                bgGrad.addColorStop(0, '#39C5BB');
                bgGrad.addColorStop(0.5, '#99DA66');
                bgGrad.addColorStop(1, '#FFEE11');
            }
            ctx.fillStyle = bgGrad;
        } else {
            // 通常（失敗またはタイミング外し）：白色の台紙
            ctx.fillStyle = '#ffffff';
        }
        ctx.fillRect(0, 0, 1024, 1024);

        // 特別アワード刻印
        if (isTargetLocked) {
            // ターゲットロックオン刻印
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 28px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#FF3366';
            ctx.shadowBlur = 10;
            ctx.fillText('★ TARGET LOCKED & PERFECT AF ★', 512, 42);
            ctx.shadowBlur = 0; // シャドウをリセット
        } else if (isBeatSynced) {
            // 通常ビート同期刻印
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 28px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = activeVocal === 'miku' ? '#115450' : (activeVocal === 'rin' ? '#6E6300' : '#883300');
            ctx.shadowBlur = 8;
            ctx.fillText('★ PERFECT BEAT SYNC ★', 512, 42);
            ctx.shadowBlur = 0; // シャドウをリセット
        }

        const photoX = 80;
        const photoY = 80;
        const photoW = 864;
        const photoH = 700;

        // 【ボイスカラー・プリント (提案A)】
        // 歌唱タイミングに応じて、背景の焼き込みカラーグラデーションを変化
        const gradient = ctx.createLinearGradient(photoX, photoY, photoX + photoW, photoY + photoH);
        if (activeVocal === 'miku') {
            // ミク: さわやかで深みのあるシアン〜ネイビー
            gradient.addColorStop(0, '#092120');
            gradient.addColorStop(0.5, '#194D4A');
            gradient.addColorStop(1, '#02100F');
        } else if (activeVocal === 'rin') {
            // リン: 温かみのあるアンバーイエロー〜ゴールドダーク
            gradient.addColorStop(0, '#241D09');
            gradient.addColorStop(0.5, '#524314');
            gradient.addColorStop(1, '#100C02');
        } else {
            // デュエット・合唱: シアンとゴールドが溶け合うサンセット色
            gradient.addColorStop(0, '#092120');
            gradient.addColorStop(0.5, '#303612');
            gradient.addColorStop(1, '#1A1D05');
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(photoX, photoY, photoW, photoH);

        // カメラのファインダー（ビューファインダー）と、湖面の波紋を模したサークルエンブレムを薄く焼き付ける
        ctx.strokeStyle = activeVocal === 'miku' ? 'rgba(57, 197, 187, 0.12)' : (activeVocal === 'rin' ? 'rgba(255, 238, 17, 0.12)' : 'rgba(185, 84, 60, 0.15)');
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(photoX + photoW / 2, photoY + photoH / 2, 220, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(photoX + photoW / 2, photoY + photoH / 2, 120, 0, Math.PI * 2);
        ctx.stroke();

        // 四隅のファインダー枠
        ctx.strokeStyle = activeVocal === 'miku' ? 'rgba(57, 197, 187, 0.35)' : (activeVocal === 'rin' ? 'rgba(255, 238, 17, 0.35)' : 'rgba(185, 84, 60, 0.45)');
        ctx.lineWidth = 4;
        const pad = 35;
        // 左上
        ctx.beginPath();
        ctx.moveTo(photoX + pad, photoY + pad + 30);
        ctx.lineTo(photoX + pad, photoY + pad);
        ctx.lineTo(photoX + pad + 30, photoY + pad);
        ctx.stroke();
        // 右上
        ctx.beginPath();
        ctx.moveTo(photoX + photoW - pad, photoY + pad + 30);
        ctx.lineTo(photoX + photoW - pad, photoY + pad);
        ctx.lineTo(photoX + photoW - pad - 30, photoY + pad);
        ctx.stroke();
        // 左下
        ctx.beginPath();
        ctx.moveTo(photoX + pad, photoY + photoH - pad - 30);
        ctx.lineTo(photoX + pad, photoY + photoH - pad);
        ctx.lineTo(photoX + pad + 30, photoY + photoH - pad);
        ctx.stroke();
        // 右下
        ctx.beginPath();
        ctx.moveTo(photoX + photoW - pad, photoY + photoH - pad - 30);
        ctx.lineTo(photoX + photoW - pad, photoY + photoH - pad);
        ctx.lineTo(photoX + photoW - pad - 30, photoY + photoH - pad);
        ctx.stroke();

        // 中央の照準（クロスヘア）
        ctx.beginPath();
        ctx.moveTo(photoX + photoW / 2 - 15, photoY + photoH / 2);
        ctx.lineTo(photoX + photoW / 2 + 15, photoY + photoH / 2);
        ctx.moveTo(photoX + photoW / 2, photoY + photoH / 2 - 15);
        ctx.lineTo(photoX + photoW / 2, photoY + photoH / 2 + 15);
        ctx.stroke();

        // 現在の3D空間の背景（すべての浮遊フレーム ＆ AFターゲットサークル ＆ 歌詞スプライト）を Canvas に焼き付ける
        ctx.save();
        
        // 写真の画像表示エリア（photoX, photoY, photoW, photoH）でクリップを設定し、枠外はみ出しを防ぐ
        ctx.beginPath();
        ctx.rect(photoX, photoY, photoW, photoH);
        ctx.clip();

        // --- 0. 被写体ミクVRMの焼き付け（実際のWebGLレンダリングをミクのみ表示で抽出） ---
        this.burnMikuIntoPhoto(ctx, photoX, photoY, photoW, photoH);

        // --- 1. 背景のすべての浮遊フレーム（ワイヤーフレーム ＆ 過去の写真）の焼き付け ---
        ctx.save();
        ctx.strokeStyle = activeVocal === 'miku' ? 'rgba(57, 197, 187, 0.22)' : (activeVocal === 'rin' ? 'rgba(255, 238, 17, 0.22)' : 'rgba(185, 84, 60, 0.25)');
        ctx.lineWidth = 2.0;
        
        this.frames.forEach(frame => {
            const frameV = new THREE.Vector3();
            frameV.copy(frame.position);
            
            // カメラの背面にあるものは写り込まないので除外
            const localPos = frame.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
            if (localPos.z >= 0) return;
            
            frameV.project(this.camera);
            
            // 画面外にはみ出しすぎているフレームはスキップ
            if (frameV.x < -1.5 || frameV.x > 1.5 || frameV.y < -1.5 || frameV.y > 1.5) return;
            
            const fx = photoX + (frameV.x + 1) / 2 * photoW;
            const fy = photoY + (1 - (frameV.y + 1) / 2) * photoH;
            
            // カメラからの距離（遠近法）に応じて大きさを決定
            const dist = this.camera.position.distanceTo(frame.position);
            const fovRad = ((75 / this.zoomLevel) * Math.PI) / 180;
            const visibleFrustumHeight = 2 * dist * Math.tan(fovRad / 2);
            // 物理的に正確なパースペクティブ投影によるサイズ計算
            const frameSizeH = photoH * (3.0 / visibleFrustumHeight);
            const frameSizeW = frameSizeH * (4.0 / 3.0); // 4:3 アスペクト比
            
            ctx.save();
            ctx.translate(fx, fy);
            
            // フレームの回転角度を擬似的に表現
            const rotZ = frame.rotation ? frame.rotation.z : 0;
            ctx.rotate(rotZ);
            
            // フレーム枠（ワイヤーフレーム）を描画
            ctx.strokeRect(-frameSizeW / 2, -frameSizeH / 2, frameSizeW, frameSizeH);
            
            // 既に写真がはめ込まれている場合は、その写真画像を焼き付ける！
            if (frame.userData.hasPhoto && frame.userData.photoImage) {
                ctx.drawImage(frame.userData.photoImage, -frameSizeW / 2, -frameSizeH / 2, frameSizeW, frameSizeH);
            } else if (frame.userData.hasPhoto) {
                ctx.fillStyle = activeVocal === 'miku' ? 'rgba(57, 197, 187, 0.08)' : (activeVocal === 'rin' ? 'rgba(255, 238, 17, 0.08)' : 'rgba(185, 84, 60, 0.1)');
                ctx.fillRect(-frameSizeW / 2, -frameSizeH / 2, frameSizeW, frameSizeH);
            }
            
            ctx.restore();
        });
        ctx.restore();

        // --- 1.5. トランジション中（飛行中・ホールド中）の写真の焼き付け ---
        ctx.save();
        this.transitioningPhotos.forEach(photo => {
            // カメラの背面にあるものは写り込まないので除外
            const localPos = photo.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
            if (localPos.z >= 0) return;
            
            const photoV = photo.position.clone().project(this.camera);
            
            // 画面外にはみ出しすぎているものはスキップ
            if (photoV.x < -1.5 || photoV.x > 1.5 || photoV.y < -1.5 || photoV.y > 1.5) return;
            
            const px = photoX + (photoV.x + 1) / 2 * photoW;
            const py = photoY + (1 - (photoV.y + 1) / 2) * photoH;
            
            const dist = this.camera.position.distanceTo(photo.position);
            const fovRad = ((75 / this.zoomLevel) * Math.PI) / 180;
            const visibleFrustumHeight = 2 * dist * Math.tan(fovRad / 2);
            // 物理的に正確なパースペクティブ投影によるサイズ計算（現在のスケールを適用）
            const currentScale = photo.scale.x;
            const sizeH = photoH * ((2.9 * currentScale) / visibleFrustumHeight);
            const sizeW = sizeH * (3.9 / 2.9);
            
            ctx.save();
            ctx.translate(px, py);
            
            // クォータニオンからZ軸周りの回転を計算
            const euler = new THREE.Euler().setFromQuaternion(photo.quaternion, 'YXZ');
            ctx.rotate(euler.z);
            
            // 写真画像を焼き付ける
            if (photo.material && photo.material.map && photo.material.map.image) {
                ctx.drawImage(photo.material.map.image, -sizeW / 2, -sizeH / 2, sizeW, sizeH);
            }
            
            // 白い枠線を描画（ポラロイド感を強調）
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-sizeW / 2, -sizeH / 2, sizeW, sizeH);
            
            ctx.restore();
        });
        ctx.restore();

        // --- 2. 3D AFターゲットサークル（照準器）の焼き付け ---
        if (this.targetScope) {
            ctx.save();
            const scopeV = new THREE.Vector3();
            scopeV.copy(this.targetScope.position);
            
            // カメラの背面にあるものは除外
            const localPos = this.targetScope.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
            if (localPos.z < 0) {
                scopeV.project(this.camera);
                
                const sx = photoX + (scopeV.x + 1) / 2 * photoW;
                const sy = photoY + (1 - (scopeV.y + 1) / 2) * photoH;
                
                const scopeDist = this.camera.position.distanceTo(this.targetScope.position);
                const fovRad = ((75 / this.zoomLevel) * Math.PI) / 180;
                const visibleFrustumHeight = 2 * scopeDist * Math.tan(fovRad / 2);
                // 物理的に正確なパースペクティブ投影による半径計算（現在のスケールを適用）
                const currentScale = this.targetScope.scale.x;
                const scopeRadius = photoH * ((0.9 * currentScale) / visibleFrustumHeight);
                
                ctx.strokeStyle = isTargetLocked ? 'rgba(255, 238, 17, 0.35)' : 'rgba(57, 197, 187, 0.22)';
                ctx.lineWidth = 3;
                ctx.shadowColor = isTargetLocked ? '#FFEE11' : '#39C5BB';
                ctx.shadowBlur = 10;
                
                // AFサークルの円形を描画
                ctx.beginPath();
                ctx.arc(sx, sy, scopeRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
        }

        // --- 3. 現在画面に表示されている歌詞（activeSprites）を Canvas に焼き付ける ---
        this.activeSprites.forEach(sprite => {
            if (sprite.userData.frameTarget) return; // 落下中のものは除く
            
            // 不透明度がほぼゼロのものは画面に映っていないため、描画を完全にスキップ
            const opacity = sprite.material ? sprite.material.opacity : 1;
            if (opacity < 0.05) return;
            
            const spriteText = sprite.userData.text;
            if (!spriteText) return;
            
            // 【3D世界座標からのスクリーン投影 (projectメソッドによる完全な画面一致)】
            const spriteV = new THREE.Vector3();
            spriteV.copy(sprite.position);
            
            // カメラの背面にある場合は除外
            const localPos = sprite.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
            if (localPos.z >= 0) return;
            
            spriteV.project(this.camera);
            
            // 投影座標が画面からはみ出しすぎているものはスキップ
            if (spriteV.x < -1.15 || spriteV.x > 1.15 || spriteV.y < -1.15 || spriteV.y > 1.15) return;
            
            const textX = photoX + (spriteV.x + 1) / 2 * photoW;
            const textY = photoY + (1 - (spriteV.y + 1) / 2) * photoH; // Y軸反転
            
            // カメラからの距離（遠近法深度）をフォントサイズに完全反映！
            const dist = this.camera.position.distanceTo(sprite.position);
            const fovRad = ((75 / this.zoomLevel) * Math.PI) / 180;
            const visibleFrustumHeight = 2 * dist * Math.tan(fovRad / 2);
            
            const currentScaleY = sprite.scale ? sprite.scale.y : (sprite.userData.baseScale || 2.5);
            // 物理的に正確なパースペクティブ投影によるフォントサイズ（高さピクセル）計算
            const fontSize = Math.round(photoH * (currentScaleY / visibleFrustumHeight));
            
            ctx.save();
            ctx.globalAlpha = opacity; // 画面上の不透明度をそのまま写真に適用！
            
            ctx.font = `bold ${fontSize}px "Inter", "Noto Sans JP", sans-serif`;
            ctx.fillStyle = '#ffffff';
            
            // 文字の色とシャドウはスプライトに設定されている実際の発光色をリアルタイムに反映
            let glowColor = activeVocal === 'miku' ? '#39C5BB' : (activeVocal === 'rin' ? '#FFEE11' : '#B9543C');
            if (sprite.material && sprite.material.color) {
                const r = Math.round(sprite.material.color.r * 255);
                const g = Math.round(sprite.material.color.g * 255);
                const b = Math.round(sprite.material.color.b * 255);
                glowColor = `rgb(${r}, ${g}, ${b})`;
            }
            
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 15;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(spriteText, textX, textY);
            ctx.restore();
        });
        
        ctx.restore(); // クリップ設定を復元

        // タイムスタンプの描画
        const mins = Math.floor(position / 60000).toString().padStart(2, '0');
        const secs = Math.floor((position % 60000) / 1000).toString().padStart(2, '0');
        const centis = Math.floor((position % 1000) / 10).toString().padStart(2, '0');
        const timeStr = `${mins}:${secs}.${centis}`;
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = hasColorBorder ? '#ffffff' : '#B9543C';
        ctx.font = 'bold 28px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`[ REC ${timeStr} ]  SNAP_${Date.now().toString().slice(-4)}`, photoX + 30, 850);

        // 【ステッカーコラージュ描画 (案A)】
        const keyword = lockedWordText || (this.activeSprites.length > 0 ? this.activeSprites[0].userData.text : '');
        if (keyword) {
            ctx.save();
            ctx.shadowBlur = 0;
            
            if (keyword.includes('シャッター') || keyword.includes('チャンス') || keyword.includes('スナップ') || keyword.includes('撮')) {
                // 1. レトロカメラスタンプの描画
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : '#B9543C';
                ctx.fillStyle = hasColorBorder ? 'rgba(255,255,255,0.15)' : 'rgba(185, 84, 60, 0.08)';
                ctx.lineWidth = 6;
                const cx = photoX + 150;
                const cy = photoY + 150;
                
                // カメラボディ
                ctx.beginPath();
                ctx.roundRect(cx - 80, cy - 40, 160, 90, 8);
                ctx.stroke();
                ctx.fill();
                
                // レンズマウント
                ctx.beginPath();
                ctx.arc(cx, cy + 5, 35, 0, Math.PI * 2);
                ctx.stroke();
                
                // ペンタプリズム（上部の出っ張り）
                ctx.beginPath();
                ctx.moveTo(cx - 30, cy - 40);
                ctx.lineTo(cx, cy - 65);
                ctx.lineTo(cx + 30, cy - 40);
                ctx.closePath();
                ctx.stroke();
                
                // シャッターボタン
                ctx.fillRect(cx - 65, cy - 50, 15, 10);
                
                // 「SNAP!」のコミックロゴ
                ctx.fillStyle = hasColorBorder ? '#ffffff' : '#B9543C';
                ctx.font = 'bold 22px monospace';
                ctx.fillText('[ SNAP! ]', cx - 45, cy + 85);
                
            } else if (keyword.includes('可愛い') || keyword.includes('当然') || keyword.includes('嫉妬') || keyword.includes('照れ') || keyword.includes('指先')) {
                // 2. ハート＆キラキラスタンプの描画
                ctx.fillStyle = hasColorBorder ? 'rgba(255,255,255,0.9)' : 'rgba(255, 50, 120, 0.8)';
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : 'rgba(255, 50, 120, 0.8)';
                ctx.lineWidth = 3;
                
                // キラキラ星（✨）を3箇所に描画
                const drawStar = (x, y, r) => {
                    ctx.beginPath();
                    for (let i = 0; i < 4; i++) {
                        ctx.lineTo(x + r * Math.cos(i * Math.PI / 2), y + r * Math.sin(i * Math.PI / 2));
                        ctx.lineTo(x + (r/3) * Math.cos(i * Math.PI / 2 + Math.PI / 4), y + (r/3) * Math.sin(i * Math.PI / 2 + Math.PI / 4));
                    }
                    ctx.closePath();
                    ctx.fill();
                };
                
                drawStar(photoX + 120, photoY + 120, 25);
                drawStar(photoX + photoW - 120, photoY + 120, 30);
                drawStar(photoX + 100, photoY + photoH - 120, 20);
                
                // ハート（♡）の描画
                const drawHeart = (x, y, size) => {
                    ctx.beginPath();
                    ctx.arc(x - size/2, y - size/2, size/2, Math.PI, 0);
                    ctx.arc(x + size/2, y - size/2, size/2, Math.PI, 0);
                    ctx.lineTo(x, y + size);
                    ctx.closePath();
                    ctx.fill();
                };
                
                drawHeart(photoX + 170, photoY + 180, 18);
                drawHeart(photoX + photoW - 180, photoY + 180, 22);
                
            } else if (keyword.includes('完全無欠') || keyword.includes('フォーカス') || keyword.includes('ピント') || keyword.includes('焦点')) {
                // 3. レンズ絞り羽根スタンプの描画
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : '#39C5BB';
                ctx.lineWidth = 4;
                const cx = photoX + photoW - 150;
                const cy = photoY + 150;
                
                ctx.beginPath();
                ctx.arc(cx, cy, 60, 0, Math.PI * 2);
                ctx.stroke();
                
                // 絞り羽根の線
                for (let i = 0; i < 6; i++) {
                    const angle = (i * Math.PI) / 3;
                    ctx.beginPath();
                    ctx.moveTo(cx + 60 * Math.cos(angle), cy + 60 * Math.sin(angle));
                    ctx.lineTo(cx + 20 * Math.cos(angle + 0.5), cy + 20 * Math.sin(angle + 0.5));
                    ctx.stroke();
                }
                
                ctx.fillStyle = hasColorBorder ? '#ffffff' : '#39C5BB';
                ctx.font = 'bold 20px monospace';
                ctx.fillText('[ FOCUS ]', cx - 50, cy + 90);
                
            } else if (keyword.includes('NG') || keyword.includes('テイク') || keyword.includes('迷') || keyword.includes('勝て')) {
                // 4. 手書きカチンコスタンプの描画
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : '#B9543C';
                ctx.fillStyle = hasColorBorder ? 'rgba(255,255,255,0.15)' : 'rgba(185, 84, 60, 0.08)';
                ctx.lineWidth = 5;
                const cx = photoX + 150;
                const cy = photoY + photoH - 180;
                
                // カチンコのベース
                ctx.beginPath();
                ctx.rect(cx - 70, cy - 20, 140, 70);
                ctx.stroke();
                ctx.fill();
                
                // カッパー（叩く上の棒。斜めに傾ける）
                ctx.save();
                ctx.translate(cx - 70, cy - 20);
                ctx.rotate(-0.2); // 少し開いている演出
                ctx.beginPath();
                ctx.rect(0, -20, 140, 20);
                ctx.stroke();
                ctx.fill();
                
                // 縞模様のドローイング
                ctx.lineWidth = 3;
                for (let i = 0; i < 5; i++) {
                    ctx.beginPath();
                    ctx.moveTo(20 + i * 25, -20);
                    ctx.lineTo(10 + i * 25, 0);
                    ctx.stroke();
                }
                ctx.restore();
                
                ctx.fillStyle = hasColorBorder ? '#ffffff' : '#B9543C';
                ctx.font = 'bold 18px monospace';
                ctx.fillText('NG_TAKE_✖', cx - 45, cy + 80);
                
            } else if (keyword.includes('一瞬') || keyword.includes('永遠') || keyword.includes('アーカイブ') || keyword.includes('思い出') || keyword.includes('残')) {
                // 5. 時計盤 / 砂時計スタンプの描画
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : '#FFEE11';
                ctx.lineWidth = 4;
                const cx = photoX + photoW - 150;
                const cy = photoY + photoH - 180;
                
                // 時計盤の円
                ctx.beginPath();
                ctx.arc(cx, cy, 50, 0, Math.PI * 2);
                ctx.stroke();
                
                // 時計の針（10時10分を指す）
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx - 25, cy - 20); // 短針
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + 35, cy - 10); // 長針
                ctx.stroke();
                
                ctx.fillStyle = hasColorBorder ? '#ffffff' : '#FFEE11';
                ctx.font = 'bold 18px monospace';
                ctx.fillText('[ TIME_LOCK ]', cx - 60, cy + 80);
            }
            
            ctx.restore();
        }

        // 【手書きサイン＆メッセージ現像 (提案B)】
        // ポラロイドの余白（白い下部エリア）に、手書き落書き＆メッセージがじわじわ現像される
        const textYPos = 940; // 余白の中央位置
        ctx.shadowBlur = 0;
        
        if (activeVocal === 'miku') {
            // ミクサイン ＋ ネギ星マーク
            ctx.fillStyle = hasColorBorder ? '#ffffff' : 'rgba(57, 197, 187, 0.85)';
            ctx.font = 'bold 36px "Brush Script MT", "Caveat", "Comic Sans MS", cursive, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('Miku ♡', photoX + photoW - 50, textYPos);
            
            // ネギ／星マークのドローイング
            ctx.strokeStyle = hasColorBorder ? '#ffffff' : 'rgba(57, 197, 187, 0.7)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            const cx = photoX + photoW - 200;
            const cy = textYPos;
            ctx.moveTo(cx, cy - 15);
            ctx.lineTo(cx + 4, cy - 4);
            ctx.lineTo(cx + 15, cy - 4);
            ctx.lineTo(cx + 6, cy + 4);
            ctx.lineTo(cx + 10, cy + 15);
            ctx.lineTo(cx, cy + 8);
            ctx.lineTo(cx - 10, cy + 15);
            ctx.lineTo(cx - 6, cy + 4);
            ctx.lineTo(cx - 15, cy - 4);
            ctx.lineTo(cx - 4, cy - 4);
            ctx.closePath();
            ctx.stroke();
            
            // ミク一言メッセージ
            ctx.fillStyle = hasColorBorder ? '#ffffff' : '#110805';
            ctx.font = 'bold 24px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('キレイに撮れたね！ 😊💚', photoX + 30, textYPos);
            
        } else if (activeVocal === 'rin') {
            // リンサイン ＋ イナズママーク
            ctx.fillStyle = hasColorBorder ? '#ffffff' : 'rgba(235, 218, 10, 0.9)';
            ctx.font = 'bold 36px "Brush Script MT", "Caveat", "Comic Sans MS", cursive, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('Rin ⚡', photoX + photoW - 50, textYPos);
            
            // イナズマのドローイング
            ctx.strokeStyle = hasColorBorder ? '#ffffff' : 'rgba(235, 218, 10, 0.75)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            const cx = photoX + photoW - 180;
            const cy = textYPos;
            ctx.moveTo(cx - 10, cy - 15);
            ctx.lineTo(cx + 10, cy - 5);
            ctx.lineTo(cx - 8, cy + 2);
            ctx.lineTo(cx + 8, cy + 15);
            ctx.stroke();
            
            // リン一言メッセージ
            ctx.fillStyle = hasColorBorder ? '#ffffff' : '#110805';
            ctx.font = 'bold 24px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('イェイ！最高のシャッターチャンス！ 🍊💛', photoX + 30, textYPos);
            
        } else {
            // デュエットサイン ＋ ダブルハート
            ctx.fillStyle = hasColorBorder ? '#ffffff' : '#B9543C';
            ctx.font = 'bold 32px "Brush Script MT", "Caveat", "Comic Sans MS", cursive, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('Miku & Rin ✨', photoX + photoW - 50, textYPos - 15);
            
            ctx.fillStyle = hasColorBorder ? 'rgba(255, 255, 255, 0.8)' : 'rgba(185, 84, 60, 0.6)';
            ctx.font = 'bold 18px monospace';
            ctx.fillText('MAGICAL MIRAI 2026', photoX + photoW - 50, textYPos + 25);
            
            // ハートマークのドローイング
            ctx.strokeStyle = hasColorBorder ? '#ffffff' : 'rgba(185, 84, 60, 0.7)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            const cx = photoX + photoW - 320;
            const cy = textYPos;
            ctx.arc(cx - 10, cy - 8, 8, Math.PI, 0);
            ctx.arc(cx + 10, cy - 8, 8, Math.PI, 0);
            ctx.lineTo(cx, cy + 12);
            ctx.closePath();
            ctx.stroke();
            
            // デュエット一言メッセージ
            ctx.fillStyle = hasColorBorder ? '#ffffff' : '#110805';
            ctx.font = 'bold 24px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('終わらない瞬間を、いつまでも。 ✨', photoX + 30, textYPos);
        }

        // 【★ベストショット刻印】サビ／デュエット同時パート撮影は写真フレーム左上に★マークを付与
        if (isBestShot) {
            ctx.save();
            ctx.shadowColor = '#FFEE11';
            ctx.shadowBlur = 16;
            ctx.fillStyle = '#FFEE11';
            ctx.font = 'bold 64px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('★', 22, 48);
            ctx.shadowBlur = 0;
            ctx.font = 'bold 16px monospace';
            ctx.fillText('BEST', 24, 92);
            ctx.restore();
        }

        // 【フィルムストリップ記録 ＆ 撮影成果サマリー更新】
        this.totalShots++;
        if (isBestShot) this.starShots++;
        if (isTargetLocked) this.lockShots++;
        this.recordPhotoToFilm(canvas, isBestShot, timeStr);
        this.updateResultSummary();

        // 3. CanvasTexture の生成と設定
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        const photoMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 1.0, side: THREE.DoubleSide });
        const photoGeo = new THREE.PlaneGeometry(3.9, 2.9);
        const photoMesh = new THREE.Mesh(photoGeo, photoMat);

        // 撮影の瞬間、カメラの正面に配置
        photoMesh.position.set(0, 0, this.camera.position.z - 3);
        photoMesh.quaternion.copy(this.camera.quaternion);
        this.scene.add(photoMesh);

        targetFrame.userData.hasPhoto = true;
        targetFrame.userData.photoImage = canvas;

        // 4. 写真がターゲットフレーム（赤い枠）に向けて「スーッと吸い込まれる」トランジションデータを設定
        this.transitioningPhotos.push(photoMesh);
        
        // 撮影の瞬間は目の前に大きく表示させるために初期スケールを拡大（ズームレベルに反比例させて一定の大きさに保つ）
        const initialScale = 1.2 / this.zoomLevel;
        photoMesh.scale.set(initialScale, initialScale, initialScale);
        
        photoMesh.userData = {
            startTime: 0,       // 最初の update 時に Date.now() で初期化し、テクスチャ転送の強烈な初期ラグを完璧に相殺！
            holdDuration: 1000, // 1.0秒間、目の前に大きく静止させて提示する（認識しやすい絶妙な長さに調整）
            duration: 800,      // その後、0.8秒かけてフレームへ吸い込む
            startPos: photoMesh.position.clone(),
            startRot: photoMesh.quaternion.clone(),
            targetFrame: targetFrame
        };
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        window.removeEventListener('keydown', this.boundOnKeyDown);
        
        // カメラ首振り ＆ 撮影イベントの確実な解除
        this.songWrapper.removeEventListener('mousedown', this.boundOnMouseDown);
        this.songWrapper.removeEventListener('mousemove', this.boundOnMouseMove);
        window.removeEventListener('mouseup', this.boundOnMouseUp);

        // タッチ首振りイベントの確実な解除
        this.songWrapper.removeEventListener('touchstart', this.boundOnTouchStartCam);
        this.songWrapper.removeEventListener('touchmove', this.boundOnTouchMoveCam);
        this.songWrapper.removeEventListener('touchend', this.boundOnTouchEndCam);
        
        // ズーム用イベントリスナーの確実な解除
        this.songWrapper.removeEventListener('wheel', this.boundOnWheel);
        this.songWrapper.removeEventListener('touchstart', this.boundOnTouchStart);
        this.songWrapper.removeEventListener('touchmove', this.boundOnTouchMove);
        this.songWrapper.removeEventListener('touchend', this.boundOnTouchEnd);
        
        const slider = document.getElementById('shutter-zoom-slider');
        if (slider) {
            slider.removeEventListener('input', this.boundOnSliderInput);
        }
        
        // CSSスタイルの削除
        if (this.customStyleElement && this.customStyleElement.parentNode) {
            this.customStyleElement.parentNode.removeChild(this.customStyleElement);
        }
        
        this.activeSprites.forEach(s => {
            if (s.material.map) s.material.map.dispose();
            s.material.dispose();
        });
        this.activeSprites = [];
        
        this.transitioningPhotos.forEach(photo => {
            if (photo.material) {
                if (photo.material.map) photo.material.map.dispose();
                photo.material.dispose();
            }
            this.scene.remove(photo);
        });
        this.transitioningPhotos = [];
        
        this.frames.forEach(frame => {
            // フレームにはめ込まれた写真がある場合は先にクリーンアップ
            if (frame.userData.photoMesh) {
                const photo = frame.userData.photoMesh;
                if (photo.material) {
                    if (photo.material.map) photo.material.map.dispose();
                    photo.material.dispose();
                }
                this.scene.remove(photo); // シーンから確実に削除
            }
            
            frame.geometry.dispose();
            frame.material.dispose();
        });
        this.frames = [];
        
        if (this.viewfinder && this.viewfinder.parentNode) {
            this.viewfinder.parentNode.removeChild(this.viewfinder);
        }

        // フィルムストリップDOMと写真ログの解放
        if (this.filmStripEl && this.filmStripEl.parentNode) {
            this.filmStripEl.parentNode.removeChild(this.filmStripEl);
        }
        this.filmStripEl = null;
        this.photoLog = [];

        // 被写体ミクVRMの完全解放
        if (this.mikuVRM) {
            this.scene.remove(this.mikuVRM.scene);
            this.disposeVRM(this.mikuVRM);
            this.mikuVRM = null;
        }

        // ライトの解放
        if (this.ambientLight) {
            this.scene.remove(this.ambientLight);
            this.ambientLight = null;
        }
        if (this.dirLight) {
            this.scene.remove(this.dirLight);
            this.dirLight = null;
        }

        if (this.renderer) this.renderer.dispose();

        super.destroy();
    }
}
