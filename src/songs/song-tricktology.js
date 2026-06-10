import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

export class SongTricktology extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        this.activeSprites = [];
        this.lastPhrase = null;
        this.isClimax = false;
        this.climaxTriggered = false;
        
        this.themeColor = '#3C3489';
        
        this.baseRot = new THREE.Vector3();
        this.isDragging = false;
        this.dragOffset = new THREE.Vector2();
        this.lastMouse = new THREE.Vector2();
        
        this.boundOnResize = this.onResize.bind(this);
        this.boundOnPointerDown = this.onPointerDown.bind(this);
        this.boundOnPointerMove = this.onPointerMove.bind(this);
        this.boundOnPointerUp = this.onPointerUp.bind(this);
    }

    init() {
        this.initThree();
        this.initEnvironment();
        window.addEventListener('resize', this.boundOnResize);
        this.container.addEventListener('pointerdown', this.boundOnPointerDown);
        this.container.addEventListener('pointermove', this.boundOnPointerMove);
        window.addEventListener('pointerup', this.boundOnPointerUp);
        
        this.isActive = true;
        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050510, 0.02);
        this.scene.background = new THREE.Color(0x050510);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        // Start camera slightly above the floor
        this.camera.position.set(0, 3, 15);
        this.camera.lookAt(0, 0, 0);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initEnvironment() {
        // Create the Mirror Floor
        const geometry = new THREE.PlaneGeometry(100, 100);
        this.mirror = new Reflector(geometry, {
            clipBias: 0.003,
            textureWidth:  Math.min(window.innerWidth  * window.devicePixelRatio, 1024),
            textureHeight: Math.min(window.innerHeight * window.devicePixelRatio, 1024),
            color: 0x8899a6
        });
        this.mirror.position.y = 0;
        this.mirror.rotation.x = -Math.PI / 2;
        this.scene.add(this.mirror);

        // Add some floating geometric shapes that reflect
        this.shapes = [];
        const geoMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.themeColor), wireframe: true });
        for (let i = 0; i < 20; i++) {
            const geo = new THREE.IcosahedronGeometry(Math.random() * 2 + 0.5, 0);
            const mesh = new THREE.Mesh(geo, geoMaterial);
            mesh.position.set(
                (Math.random() - 0.5) * 40,
                Math.random() * 15 + 2,
                (Math.random() - 0.5) * 40 - 10
            );
            mesh.userData = {
                rotSpeed: new THREE.Vector3(Math.random() * 0.02, Math.random() * 0.02, Math.random() * 0.02),
                floatSpeed: Math.random() * 0.02 + 0.01,
                baseY: mesh.position.y
            };
            this.scene.add(mesh);
            this.shapes.push(mesh);
        }
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.mirror) {
            this.mirror.getRenderTarget().setSize(
                Math.min(window.innerWidth  * window.devicePixelRatio, 1024),
                Math.min(window.innerHeight * window.devicePixelRatio, 1024)
            );
        }
    }

    onPointerDown(e) {
        this.isDragging = true;
        this.lastMouse.set(e.clientX, e.clientY);
    }

    onPointerMove(e) {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.dragOffset.x += dx * 0.005;
        this.dragOffset.y -= dy * 0.005; // -dy because screen Y is down
        this.lastMouse.set(e.clientX, e.clientY);
    }

    onPointerUp() {
        this.isDragging = false;
    }

    createTextTexture(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0,0,1024,128);
        ctx.font = 'bold 80px "Inter", "Noto Sans JP", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = this.themeColor;
        ctx.shadowBlur = 15;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 512, 64);
        return new THREE.CanvasTexture(canvas);
    }

    spawnText(phrase, spawnTime) {
        const texture = this.createTextTexture(phrase.text);
        const material = new THREE.SpriteMaterial({ 
            map: texture, 
            transparent: true, 
            opacity: 0,
            depthTest: false // Ensures lyrics render over mirror reflection clearly
        });
        const sprite = new THREE.Sprite(material);
        
        // Spawn text randomly around the mirror
        sprite.position.set(
            (Math.random() - 0.5) * 20, 
            Math.random() * 5 + 3, // Keep above the mirror
            this.camera.position.z - 20 - Math.random() * 10
        );
        
        const aspect = 1024 / 128;
        const scale = 2.5 + Math.random();
        sprite.userData = { 
            birth: spawnTime, 
            life: 6000,
            text: phrase.text,
            baseScale: scale,
            aspect: aspect
        };
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        // TextAlive公式タイマー(player.timer.position)に完全同期（先行調整を排除）
        const position = (playerManager.player && playerManager.player.timer)
                         ? playerManager.player.timer.position
                         : this.getSmoothedTime();
        
        // Chorus check for Upside Down climax
        const chorus = playerManager.player && typeof playerManager.player.findChorus === 'function' ? playerManager.player.findChorus(position) : null;
        this.isClimax = !!chorus;
        
        if (this.isClimax && !this.climaxTriggered) {
            this.climaxTriggered = true;
            this.triggerIllusion();
        } else if (!this.isClimax && this.climaxTriggered) {
            this.climaxTriggered = false;
            this.resetIllusion();
        }

        // Apply base rotation + drag distortion
        if (this.isClimax) {
            this.baseRot.z += (Math.PI - this.baseRot.z) * 0.05;
        } else {
            this.baseRot.z += (0 - this.baseRot.z) * 0.05;
        }

        this.dragOffset.x *= 0.95; // spring back
        this.dragOffset.y *= 0.95;
        this.songWrapper.style.transform = `rotate(${this.baseRot.z}rad) rotateX(${this.dragOffset.y}rad) rotateY(${this.dragOffset.x}rad)`;

        // カメラが -200 を超えたらシーン全体をシフトして戻す
        if (this.camera.position.z < -200) {
            const shift = -this.camera.position.z - 10;
            this.camera.position.z = -10;
            this.shapes.forEach(mesh => { mesh.position.z += shift; });
            if (this.mirror) this.mirror.position.z += shift;
        }

        // Move camera slowly forward
        this.camera.position.z -= 0.05;

        // Animate background shapes. Oscillation is synchronized to song position
        this.shapes.forEach((mesh, i) => {
            mesh.rotation.x += mesh.userData.rotSpeed.x;
            mesh.rotation.y += mesh.userData.rotSpeed.y;
            mesh.position.y = mesh.userData.baseY + Math.sin(position * mesh.userData.floatSpeed * 0.1 + i) * 2;
            
            // Reposition if behind camera
            if (mesh.position.z > this.camera.position.z + 10) {
                mesh.position.z = this.camera.position.z - 50;
            }
        });

        // Phrase-level for 3D background text, word-level for foreground lyric display
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase !== this.lastPhrase) {
            this.lastPhrase = phrase;
            this.spawnText(phrase, position);
        }

        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);
        if (this.lyricRenderer) {
            this.lyricRenderer.update(word);
        }

        // Update sprites
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const s = this.activeSprites[i];
            // 現在歌唱中の単語とスプライトの文字が一致するかチェックし、歌唱パルス（バウンド拡大＆発光）をトリガー
            const isWordActive = word && s.userData.text && s.userData.text.includes(word.text) 
                              && position >= word.startTime && position <= word.endTime;
            if (!s.userData.pulseProgress) s.userData.pulseProgress = 0;
            const targetPulse = isWordActive ? 1.0 : 0.0;
            s.userData.pulseProgress += (targetPulse - s.userData.pulseProgress) * 0.2;
            const pulse = s.userData.pulseProgress;
            const pulseScaleFactor = 1.0 + pulse * 0.25; // 1.25倍バウンド

            const baseScale = s.userData.baseScale || 2.5;
            const aspect = s.userData.aspect || 8.0;
            s.scale.set(baseScale * aspect * pulseScaleFactor, baseScale * pulseScaleFactor, 1);
            
            // 歌唱中は純白に近い強発光にする
            s.material.color.setRGB(1.0, 1.0 - pulse * 0.3, 1.0 - pulse * 0.3);

            const age = Math.max(0, position - s.userData.birth);

            // Oscillation is synchronized to song position
            s.position.y += Math.sin(position * 0.002) * 0.01;
            
            if (age < 150) {
                s.material.opacity = age / 150;
            } else if (age > s.userData.life - 200) {
                s.material.opacity = Math.max(0, (s.userData.life - age) / 200);
            } else {
                s.material.opacity = 1;
            }
            
            if (age > s.userData.life || s.position.z > this.camera.position.z) {
                this.scene.remove(s);
                s.material.map.dispose();
                s.material.dispose();
                this.activeSprites.splice(i, 1);
            }
        }
    }
    
    triggerIllusion() {
        this.songWrapper.style.transformOrigin = 'center center';
        // We use a CSS transition on the wrapper for a smooth effect
        this.songWrapper.style.transition = 'transform 2s cubic-bezier(0.68, -0.55, 0.27, 1.55)';
        setTimeout(() => { this.songWrapper.style.transition = 'none'; }, 2000);
        
        // Also flash the screen
        const flash = document.createElement('div');
        flash.style.position = 'absolute';
        flash.style.top = '0';
        flash.style.left = '0';
        flash.style.width = '100%';
        flash.style.height = '100%';
        flash.style.background = '#ffffff';
        flash.style.zIndex = '40';
        flash.style.pointerEvents = 'none';
        flash.style.transition = 'opacity 1.5s ease';
        this.songWrapper.appendChild(flash);
        
        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => {
                if (flash.parentNode) flash.parentNode.removeChild(flash);
            }, 1500);
        }, 100);
    }
    
    resetIllusion() {
        this.songWrapper.style.transformOrigin = 'center center';
        this.songWrapper.style.transition = 'transform 2s cubic-bezier(0.68, -0.55, 0.27, 1.55)';
        setTimeout(() => { this.songWrapper.style.transition = 'none'; }, 2000);
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        this.container.removeEventListener('pointerdown', this.boundOnPointerDown);
        this.container.removeEventListener('pointermove', this.boundOnPointerMove);
        window.removeEventListener('pointerup', this.boundOnPointerUp);
        
        this.activeSprites.forEach(s => {
            if (s.material.map) s.material.map.dispose();
            s.material.dispose();
        });
        
        this.shapes.forEach(mesh => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        
        if (this.mirror) {
            this.mirror.geometry.dispose();
            this.mirror.material.dispose();
            this.mirror.dispose(); // Important for Reflector
        }
        
        if (this.renderer) this.renderer.dispose();
        this.songWrapper.style.transform = '';
        this.songWrapper.style.transformOrigin = '';

        super.destroy();
    }
}
