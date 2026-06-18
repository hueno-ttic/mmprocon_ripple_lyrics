import * as THREE from 'three';
import { quality } from '../core/quality.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { groupPhraseWords, findGroupForWord } from '../utils/lyricGroups.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { settleSpringBones } from '../utils/vrm.js';

export class SongOrchestra extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.stars = null;
        this.starGeometry = null;
        this.starMaterial = null;
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
        this._tutCardTimer = null;
        this._introOverlay = null;
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
        this.initOrbGauge();
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
        
        this.stars = new THREE.Points(this.starGeometry, this.starMaterial);
        this.scene.add(this.stars);
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
        
        const canvas = document.createElement('canvas');
        canvas.width = textWidth;
        canvas.height = 128;
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
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
                ctx.lineTo(canvas.width - 10, y);
                ctx.stroke();
            }
        } else if (category === 'voice_echo') {
            // Faint soundwave pattern behind text
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let x = 10; x < canvas.width - 10; x += 4) {
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
                { x: canvas.width * 0.28, y: 85 },
                { x: canvas.width * 0.5, y: 30 },
                { x: canvas.width * 0.72, y: 95 },
                { x: canvas.width - 15, y: 45 }
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
            ctx.fillText(text, canvas.width / 2 - 3, 64);
            
            ctx.fillStyle = 'rgba(255, 0, 128, 0.7)';
            ctx.fillText(text, canvas.width / 2 + 3, 64);
            
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, canvas.width / 2, 64);
        } else if (category === 'voice_echo') {
            // Echo ghost trailing texts baked in
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillText(text, canvas.width / 2 - 40, 64);
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.fillText(text, canvas.width / 2 - 20, 64);
            
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, canvas.width / 2, 64);
        } else {
            ctx.fillText(text, canvas.width / 2, 64);
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        return { texture, aspect: canvas.width / 128 };
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
        
        let scale = 1.2 + Math.random() * 0.2; // フレーズ表示用にやや小さめのベーススケール
        if (aspect > 10.0) {
            scale *= (10.0 / aspect); // フレーズは長いのでキャップを広めに
            scale = Math.max(0.7, scale); // 最低限の可読性を維持
        }
        
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
        
        // 画面アスペクト比とカメラの視野角から、3D空間における可視領域を動的に算出して出現候補を決定
        const dist = 21.0; // カメラZ(10) - オブジェクトZ(-11)
        const fovRad = (this.camera.fov * Math.PI) / 180;
        const visibleHeight = 2.0 * dist * Math.tan(fovRad / 2.0);
        const visibleWidth = visibleHeight * this.camera.aspect;

        // はみ出し防止のマージンを考慮した配置可能半幅・半高
        const halfW = visibleWidth * 0.38;  // 左右端から十分な余裕をもたせる
        const halfH = visibleHeight * 0.35; // 上下端から十分な余裕をもたせる

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
        let spawnZ = -11.0; // Zを-11.0に引っ込めてカメラを塞がないように調整
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
            // Absolute backup fallback — 画面全体を使ってランダム配置
            foundX = (Math.random() - 0.5) * 14;
            foundY = (Math.random() - 0.5) * 7;
            console.warn(`[ORCHESTRA] Fallback spawning "${lyricEntity.text}" at (${foundX.toFixed(2)}, ${foundY.toFixed(2)})`);
        }
        
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

        // 蓄積の可視化: 左端のオーブゲージへ色の層を積み、成果サマリーを更新
        this.collectedColors.push(nextColorHex);
        this.totalCollectedCount++;
        this.addOrbToGauge(nextColorHex);
        this.updateResultSummary();

        // 3. カラー変更を告げる美しい一時的なミニポップアップ（Toast）の表示
        const colorNames = {
            '#ffffff': '純白',
            '#ffb834': '琥珀ゴールド',
            '#ff3b5c': '夕焼けルビー',
            '#00d4ff': '深宇宙サファイア',
            '#00ffb0': '極光エメラルド',
            '#d95bff': '宵闇アメジスト'
        };
        const colorName = colorNames[this.currentColor] || '新たな色';
        
        // 情緒的なトースト文言の出し分け（意味が一致したか、ランダムか）
        let bodyText = `色彩のオーブ（計${this.resonateOrbs.length}個）が夜空に蓄積されました。`;
        if (semanticHex) {
            const matchedRule = [
                { hex: '#00d4ff', keywords: ['青', 'あお', '空', '海', '深', '涙', '雨', '水', '宙', 'そら', 'ブルー', '天'] },
                { hex: '#ff3b5c', keywords: ['赤', 'あか', '夕', '陽', '火', '熱', '血', '燃', '朱', 'ハート', 'レッド', '心臓'] },
                { hex: '#ffb834', keywords: ['金', '黄', 'きいろ', '星', '光', '朝', '輝', 'ゴールド', 'イエロー', '灯', '瞬', '隊'] },
                { hex: '#00ffb0', keywords: ['緑', 'みどり', '葉', '森', '風', '芽', '生', '陸', 'グリーン', '野', '草', '命'] },
                { hex: '#d95bff', keywords: ['紫', 'むらさき', '夜', '闇', '宵', '影', '死', '終', '幕', 'アメジスト', 'パープル', '最後'] },
                { hex: '#ffffff', keywords: ['白', 'しろ', '雪', '無', '明', '真', '純', '音', '歌', '唄', '響', 'ホワイト', '声'] }
            ].find(r => r.hex === semanticHex);
            
            const matchedKeyword = matchedRule ? matchedRule.keywords.find(kw => text.includes(kw)) : '';
            bodyText = `「${matchedKeyword}」の言葉が色彩を呼び覚ましました。\nオーブが蓄積されました。`;
        }

        this.showTutorialCard({
            icon: '✨',
            title: `言葉が共鳴しました`,
            body: bodyText,
            duration: 2800
        });
    }

    /**
     * 色彩交響花火の生成。intensity(蓄積オーブ数に比例)で
     * 粒子数・拡散速度・粒子サイズが変化する。
     * intensity=1.0 が従来規模、0.35前後=控えめな単発、2.2=大輪。
     */
    spawnCustomColorFirework(color, targetPos, intensity = 1.0) {
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
    }

    // サビでオーブを消費した瞬間にゲージをフラッシュ→空にして「次のサビへまた集める」ループを作る
    resetOrbGauge(consumedCount) {
        if (!this.orbGaugeEl) return;
        clearTimeout(this._gaugeResetTimer);
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
        
        if (this.isClimax) {
            this.camera.position.z += (15 - this.camera.position.z) * 0.01;
            this.stars.rotation.y += 0.002;
        } else {
            this.stars.rotation.y += 0.0005;
            
            // Smoothly fade star color back to white when not in climax
            if (this.starMaterial && this.starMaterial.color) {
                const c = this.starMaterial.color;
                c.r += (1.0 - c.r) * 0.05;
                c.g += (1.0 - c.g) * 0.05;
                c.b += (1.0 - c.b) * 0.05;
            }
            
            // Smoothly fade background back to original deep space dark blue (0x050510)
            if (this.scene && this.scene.background) {
                const bg = this.scene.background;
                bg.r += (0.0196 - bg.r) * 0.05;
                bg.g += (0.0196 - bg.g) * 0.05;
                bg.b += (0.0627 - bg.b) * 0.05;
            }
            if (this.scene && this.scene.fog) {
                const fg = this.scene.fog.color;
                fg.r += (0.0196 - fg.r) * 0.05;
                fg.g += (0.0196 - fg.g) * 0.05;
                fg.b += (0.0627 - fg.b) * 0.05;
            }
        }

        // --- 3D Lyrics logic (Pre-cached Word-Group granularity for rhythmic touch interaction) ---
        if (!this.lyricsCacheBuilt) {
            this.buildLyricsCache();
        }

        if (this.lyricsCacheBuilt) {
            // Filter groups that should be visible on screen
            // Start showing 250ms before singing to give user time to click, and keep visible until 800ms (or 2500ms for future_memory) after singing
            let activeGroups = this.allWordGroups.filter(g => {
                const category = this.getWordCategory(g.text);
                const extraLife = category === 'future_memory' ? 2500 : 800;
                return position >= g.startTime - 250 && position <= g.endTime + extraLife;
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

            const baseScale = s.userData.baseScale || 2.0;
            const aspect = s.userData.aspect || 8.0;
            s.scale.set(baseScale * aspect * pulseScaleFactor, baseScale * pulseScaleFactor, 1);
            
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

                    // 豪華な大合奏のアナウンスを表示
                    this.showTutorialCard({
                        icon: '🎆',
                        title: '色彩交響曲（カラー・シンフォニー）',
                        body: `蓄積された${orbCount}個の言葉の記憶が、\nサビの終わりに向け時間をかけて夜空に咲き誇ります！`,
                        duration: 4500
                    });
                } else {
                    // 蓄積0個のサビ: 控えめな単発花火を一輪だけ上げ、蓄積が体験に直結することを伝える
                    this.spawnCustomColorFirework(
                        new THREE.Color(this.currentColor),
                        new THREE.Vector3((Math.random() - 0.5) * 6.0, 3.0 + Math.random() * 2.0, -24.0),
                        0.35
                    );
                    this.showTutorialCard({
                        icon: '🌠',
                        title: '静かな夜空…',
                        body: 'オーブが空のため、ささやかな一輪だけ。\n歌詞に触れてオーブを集めると、\nサビの花火が大連鎖になります。',
                        duration: 4500
                    });
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
            const activeWindow = climaxDuration * 0.85;
            const totalOrbs = this.climaxOrbs.length;
            const clampedInterval = totalOrbs > 1 ? Math.min(3500, activeWindow / totalOrbs) : 0;

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

                        // 花火の比例: 蓄積オーブ数が多いほど一発あたりの規模が増し、さらに連鎖サブ爆発が加わる
                        const accumulated = Math.max(this.chorusOrbCount, totalOrbs);
                        const intensity = Math.min(2.2, 0.6 + accumulated * 0.11);
                        this.spawnCustomColorFirework(orb.userData.color, orb.position, intensity);

                        const extraBursts = accumulated >= 12 ? 2 : (accumulated >= 6 ? 1 : 0);
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
                // まだ残っている打ち上げ用オーブがあればすべてクリーンアップ
                this.climaxOrbs.forEach(orb => {
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

            if (!hasLyrics && !this.tapAnimation) {
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
                
                // If not tapped yet, adjust base position based on current scale dynamically
                if (!this.hasTapped) {
                    this.baseMikuX = 0;
                    this.baseMikuY = -0.53 * responsiveScale;
                    this.baseMikuZ = -13.0;
                } else if (!this.tapAnimation) {
                    // Smoothly slide back to the last tapped position or home position
                    let targetHomeX = 0;
                    let targetHomeY = -0.53 * responsiveScale;
                    let targetHomeZ = -13.0;

                    if (this.lastTappedMikuPos) {
                        targetHomeX = this.lastTappedMikuPos.x;
                        targetHomeY = this.lastTappedMikuPos.y;
                        targetHomeZ = this.lastTappedMikuPos.z;
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
                    this.baseMikuX = projectedTarget.x;
                    this.baseMikuY = projectedTarget.y + (-1.2 * responsiveScale);
                    this.baseMikuZ = projectedTarget.z + (-1.0 * responsiveScale);
                    this.tapAnimation = null;

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
                // Adjust offsets dynamically based on responsive scale
                const targetMikuPos = new THREE.Vector3(
                    projectedTarget.x,
                    projectedTarget.y + (-1.2 * responsiveScale),
                    projectedTarget.z + (-1.0 * responsiveScale)
                );
                
                const elapsed = this.tapAnimation.elapsed;
                const peak = this.tapAnimation.peakTime;
                
                if (elapsed < peak) {
                    const t_pos = elapsed / peak;
                    const w_pos = Math.sin(t_pos * Math.PI / 2);
                    this.currentVRM.scene.position.lerpVectors(basePos, targetMikuPos, w_pos);
                } else {
                    this.currentVRM.scene.position.copy(targetMikuPos);
                }
            } else {
                this.currentVRM.scene.position.copy(basePos);
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
                        const dir = projectedTarget.clone().sub(shoulderPos);
                        const parentWorldQ = activeUpper.parent.getWorldQuaternion(new THREE.Quaternion());
                        const localDir = dir.clone().applyQuaternion(parentWorldQ.clone().invert()).normalize();
                        
                        // VRM standard arm axis (left: +X, right: -X)
                        const localAxis = isLeft ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
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
                if (this.tapAnimation && projectedTarget && w > 0) {
                    // Turn head towards target lyric
                    const lookPos = new THREE.Vector3().lerpVectors(this.camera.position, projectedTarget, w);
                    this.lookAtTarget(neck, lookPos, 0.7, 0.4);
                } else {
                    // Keep eye contact with user/camera
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

        // Cleanup VRM Avatar
        if (this.currentVRM) {
            this.scene.remove(this.currentVRM.scene);
            this.disposeVRM(this.currentVRM);
            this.currentVRM = null;
        }

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

        // Reset SpringBone physics to prevent hair twisting or jittering on sudden starting motion
        if (this.currentVRM.springBoneManager) {
            this.currentVRM.springBoneManager.reset();
        }

        // 歌詞スプライトの上昇・揺れ動作をフリーズ
        sprite.userData.isBeingTapped = true;
        const targetWorldPos = sprite.position.clone();
        
        // 歌詞が画面の左右どちらにあるかで、左腕・右腕のどちらを使用するか選択
        const arm = targetWorldPos.x < 0 ? 'left' : 'right';

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
