import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

export class SongTricktology extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        
        // Hide generic DOM renderer
        if (this.lyricRenderer && this.lyricRenderer.lyricContainer) {
            this.lyricRenderer.lyricContainer.style.display = 'none';
        }

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
            textureWidth: window.innerWidth * window.devicePixelRatio,
            textureHeight: window.innerHeight * window.devicePixelRatio,
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
                window.innerWidth * window.devicePixelRatio,
                window.innerHeight * window.devicePixelRatio
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

    spawnText(phrase) {
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
        sprite.userData = { birth: this.currentTime, life: 6000 };
        
        const aspect = 1024 / 128;
        const scale = 2.5 + Math.random();
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        const position = this.currentTime;
        
        // Chorus check for Upside Down climax
        const chorus = playerManager.player.video.findChorus(position);
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

        // Move camera slowly forward
        this.camera.position.z -= 0.05;

        // Animate background shapes
        const now = Date.now();
        this.shapes.forEach((mesh, i) => {
            mesh.rotation.x += mesh.userData.rotSpeed.x;
            mesh.rotation.y += mesh.userData.rotSpeed.y;
            mesh.position.y = mesh.userData.baseY + Math.sin(now * mesh.userData.floatSpeed + i) * 2;
            
            // Reposition if behind camera
            if (mesh.position.z > this.camera.position.z + 10) {
                mesh.position.z = this.camera.position.z - 50;
            }
        });

        // Spawn lyrics
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase !== this.lastPhrase) {
            this.lastPhrase = phrase;
            this.spawnText(phrase);
        }

        // Update sprites
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const s = this.activeSprites[i];
            const age = position - s.userData.birth;
            
            s.position.y += Math.sin(age * 0.002) * 0.01;
            
            if (age < 1000) {
                s.material.opacity = age / 1000;
            } else if (age > s.userData.life - 1000) {
                s.material.opacity = (s.userData.life - age) / 1000;
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
        this.songWrapper.style.transform = ''; // reset

        super.destroy();
    }
}
