import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { groupPhraseWords, findGroupForWord } from '../utils/lyricGroups.js';

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
        window.addEventListener('resize', this.boundOnResize);
        this.container.addEventListener('click', this.boundOnClick);
        this.container.addEventListener('mousemove', this._boundOnMouseMove);
        
        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050510);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 10;
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.songWrapper.appendChild(this.renderer.domElement);
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

    createTextTexture(text) {
        // 1. Measure text width first to make canvas proportional
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = 'bold 80px "Inter", "Noto Sans JP", "Hiragino Kaku Gothic Pro", sans-serif';
        const metrics = tempCtx.measureText(text);
        const textWidth = Math.max(120, Math.ceil(metrics.width) + 60); // add generous horizontal padding
        
        const canvas = document.createElement('canvas');
        canvas.width = textWidth;
        canvas.height = 128;
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.font = 'bold 80px "Inter", "Noto Sans JP", "Hiragino Kaku Gothic Pro", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Add premium drop shadow for perfect visibility over the dark space background
        ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 3;
        
        ctx.fillText(text, canvas.width / 2, 64);
        
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
            const groups = groupPhraseWords(phrase);
            groups.forEach(group => {
                // 記号類を削除（「 」 、 。 ? ! ？ ！ 等）
                const cleanText = group.text.replace(/[「」『』、。？！?!.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
                
                // 空文字列になった場合は表示候補から除外
                if (!cleanText) return;

                this.allWordGroups.push({
                    index: index++,
                    text: cleanText,
                    startTime: group.startTime,
                    endTime: group.endTime,
                    phraseEndTime: phrase.endTime
                });
            });
            phrase = phrase.next;
        }
        
        this.allWordGroups.sort((a, b) => a.startTime - b.startTime);
        console.log(`[ORCHESTRA] Pre-cached ${this.allWordGroups.length} word groups (symbols filtered).`);
        this.lyricsCacheBuilt = true;
        return true;
    }

    spawnText(lyricEntity, spawnTime) {
        // 歌詞の同時出現数を最大4個までに緩和し、タップできる選択肢を増やしてリズム感を出す
        const activeLyrics = this.activeSprites.filter(s => !s.userData.isNode);
        if (activeLyrics.length >= 4) {
            const oldest = activeLyrics[0];
            this.scene.remove(oldest);
            if (oldest.material.map) oldest.material.map.dispose();
            oldest.material.dispose();
            
            const idx = this.activeSprites.indexOf(oldest);
            if (idx !== -1) {
                this.activeSprites.splice(idx, 1);
            }
        }

        const { texture, aspect } = this.createTextTexture(lyricEntity.text);
        const material = new THREE.SpriteMaterial({ 
            map: texture, 
            color: new THREE.Color('#ffffff'), 
            transparent: true,
            opacity: 0,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(material);
        
        let scale = 1.4 + Math.random() * 0.3; // 単語表示なので、少しだけコンパクトにして可読性を向上
        if (aspect > 6.0) {
            scale *= (6.0 / aspect); // Cap total horizontal width beautifully
            scale = Math.max(1.0, scale); // Keep legible
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
        
        // 画面中央（X=0付近）を完全に避けることで、カメラの正面視線を遮らないように配置
        const xCandidates = [-5.5, -4.0, -2.5, 2.5, 4.0, 5.5];
        const yCandidates = [-2.8, -2.4, -2.0, -1.6];
        
        let foundX = 0;
        let foundY = -2.4;
        let spawnZ = -11.0; // Zを-11.0に引っ込めてカメラを塞がないように調整
        let found = false;
        
        // Search passes with decreasing padding strictly to find optimal non-overlapping spots
        const passes = [
            { padH: 45, padV: 50, below: 240 },
            { padH: 25, padV: 30, below: 140 },
            { padH: 10, padV: 15, below: 70 },
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
            // Absolute backup fallback
            foundX = (Math.random() - 0.5) * 6;
            foundY = -2.3 - Math.random() * 0.3;
            console.warn(`[ORCHESTRA] Fallback spawning "${lyricEntity.text}" at (${foundX.toFixed(2)}, ${foundY.toFixed(2)})`);
        }
        
        sprite.position.set(foundX, foundY, spawnZ);
        const birthTime = lyricEntity.startTime !== undefined ? lyricEntity.startTime : spawnTime;
        const duration = lyricEntity.endTime !== undefined ? (lyricEntity.endTime - lyricEntity.startTime) : 2500;
        const lifeTime = duration + 800; // 歌唱時間 + 800ms余韻

        sprite.userData = { 
            birth: birthTime, 
            life: lifeTime,
            text: lyricEntity.text,
            baseScale: scale,
            aspect: aspect,
            groupIndex: lyricEntity.index // Store the index of the word group
        };
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    onClick(event) {
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
            this.resonateLyricColor(hitSprite, intersects[0].point);
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
        this.scene.remove(sprite);
        if (sprite.material.map) sprite.material.map.dispose();
        sprite.material.dispose();
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

    spawnCustomColorFirework(color, targetPos) {
        const geo = new THREE.BufferGeometry();
        const count = 180; // 粒子数を増やして大輪の密度の高さを維持（120 ➔ 180）
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            positions[i*3] = targetPos.x;
            positions[i*3+1] = targetPos.y;
            positions[i*3+2] = targetPos.z;
            
            // 全方位球状拡散ベクトル（2倍大きく広がるよう初期爆発速度を倍増）
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const speed = 0.95 + Math.random() * 1.0; // 拡散スピードを倍増 (0.45 ➔ 0.95)
            velocities.push(new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.sin(phi) * Math.sin(theta) * speed + 0.04, // わずかな上昇バイアス
                Math.cos(phi) * speed
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ 
            color: color, 
            size: 0.50, // 粒子サイズを大きく（0.30 ➔ 0.50）
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
            // Start showing 250ms before singing to give user time to click, and keep visible until 800ms after singing (if not clicked)
            let activeGroups = this.allWordGroups.filter(g => 
                position >= g.startTime - 250 && position <= g.endTime + 800
            );

            // Deduplicate activeGroups by text if their startTimes are extremely close (duet/unison overlaps within 200ms)
            const seenTextAndTimes = [];
            activeGroups = activeGroups.filter(g => {
                const cleanText = g.text.trim();
                if (!cleanText) return false;
                
                const isDuplicate = seenTextAndTimes.some(seen => 
                    seen.text === cleanText && Math.abs(seen.startTime - g.startTime) < 200
                );
                
                if (isDuplicate) {
                    return false;
                }
                seenTextAndTimes.push({ text: cleanText, startTime: g.startTime });
                return true;
            });


            // Remove out-of-bounds sprites immediately to keep the scene clean and release resources
            for (let i = this.activeSprites.length - 1; i >= 0; i--) {
                const s = this.activeSprites[i];
                if (s.userData.isNode) continue; // Skip constellation nodes

                const groupIndex = s.userData.groupIndex;
                const isStillActive = activeGroups.some(g => g.index === groupIndex);
                if (!isStillActive) {
                    this.scene.remove(s);
                    if (s.material.map) s.material.map.dispose();
                    s.material.dispose();
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

            s.position.y += 0.007; // 少しゆっくり上がらせて可読性をアップ（0.01 ➔ 0.007）
            s.position.x += Math.sin(position * 0.0006 + s.position.y) * 0.003; // 横揺れを大幅に抑制して交差・被りを防止

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
                this.scene.remove(s);
                if (s.material.map) s.material.map.dispose();
                s.material.dispose();
                this.activeSprites.splice(i, 1);
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
                    const trailGeo = new THREE.BufferGeometry();
                    const trailPts = [orb.position.clone(), orb.position.clone()];
                    trailGeo.setFromPoints(trailPts);
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

                    // トレイル更新
                    if (orb.userData.trail) {
                        const pts = [orb.userData.startLaunchPos, orb.position.clone()];
                        orb.userData.trail.geometry.setFromPoints(pts);
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

                        this.spawnCustomColorFirework(orb.userData.color, orb.position);
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
        if (this._tutCard && this._tutCard.parentNode) {
            this._tutCard.parentNode.removeChild(this._tutCard);
        }
        if (this._introOverlay && this._introOverlay.parentNode) {
            this._introOverlay.parentNode.removeChild(this._introOverlay);
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
            if (s.material.map) s.material.map.dispose();
            s.material.dispose();
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
        if (this.renderer) this.renderer.dispose();
        
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
}
