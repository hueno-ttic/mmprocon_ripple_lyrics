import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

export class SongTakeover extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        
        if (this.lyricRenderer && this.lyricRenderer.lyricContainer) {
            this.lyricRenderer.lyricContainer.style.display = 'none';
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        this.activeSprites = [];
        this.debris = [];
        this.lastPhrase = null;
        
        this.isClimax = false;
        this.climaxTriggered = false;
        
        this.themeColor = '#AD3A4B';
        this.baseCameraPos = new THREE.Vector3(0, 0, 10);
        
        this.boundOnResize = this.onResize.bind(this);
        this.boundOnClick = this.onClick.bind(this);
    }

    init() {
        this.initThree();
        this.initEnvironment();
        window.addEventListener('resize', this.boundOnResize);
        this.container.addEventListener('click', this.boundOnClick);
        
        this.isActive = true;
        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x1a0508, 0.04);
        this.scene.background = new THREE.Color(0x1a0508); // Dark blood red
        
        this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.copy(this.baseCameraPos);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true }); // aliased for sharp/glitchy look
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initEnvironment() {
        // Chaotic floating sharp debris (Tetrahedrons)
        const geo = new THREE.TetrahedronGeometry(1.5, 0);
        const edgesGeo = new THREE.EdgesGeometry(geo);
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(this.themeColor) });

        for (let i = 0; i < 50; i++) {
            const mesh = new THREE.LineSegments(edgesGeo, mat);
            mesh.position.set(
                (Math.random() - 0.5) * 60,
                (Math.random() - 0.5) * 40,
                (Math.random() - 0.5) * 60
            );
            mesh.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            mesh.userData = {
                rotSpeed: new THREE.Vector3((Math.random()-0.5)*0.1, (Math.random()-0.5)*0.1, (Math.random()-0.5)*0.1),
                zSpeed: Math.random() * 0.4 + 0.1
            };
            this.scene.add(mesh);
            this.debris.push(mesh);
        }
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    createTextTexture(text, isGlitch) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0,0,1024,256);
        
        ctx.font = 'bold 90px "Inter", "Noto Sans JP", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        if (isGlitch) {
            // Glitchy offset text
            ctx.fillStyle = '#ff0000';
            ctx.fillText(text, 512 - 5, 128);
            ctx.fillStyle = '#00ffff';
            ctx.fillText(text, 512 + 5, 128);
        }
        
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = this.themeColor;
        ctx.shadowBlur = isGlitch ? 0 : 20;
        ctx.fillText(text, 512, 128);
        
        return new THREE.CanvasTexture(canvas);
    }

    spawnText(phrase, forceGlitch = false) {
        const isGlitch = forceGlitch || this.isClimax;
        const texture = this.createTextTexture(phrase.text, isGlitch);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0 });
        const sprite = new THREE.Sprite(material);
        
        if (isGlitch) {
            // Massive scale, spawned right in front of camera
            sprite.position.set(
                (Math.random() - 0.5) * 5, 
                (Math.random() - 0.5) * 5,
                this.camera.position.z - 5 - Math.random() * 2
            );
            sprite.userData = { birth: this.currentTime, life: 1000, glitch: true };
            const aspect = 1024 / 256;
            const scale = 10 + Math.random() * 10; // MASSIVE
            sprite.scale.set(scale * aspect, scale, 1);
        } else {
            // Normal scale
            sprite.position.set(
                (Math.random() - 0.5) * 20, 
                (Math.random() - 0.5) * 10,
                this.camera.position.z - 20 - Math.random() * 10
            );
            sprite.userData = { birth: this.currentTime, life: 4000, glitch: false };
            const aspect = 1024 / 256;
            const scale = 2 + Math.random();
            sprite.scale.set(scale * aspect, scale, 1);
        }
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    onClick(event) {
        // Hacking / Smashing interaction
        this.songWrapper.style.filter = 'contrast(3) invert(1) hue-rotate(180deg)';
        setTimeout(() => { this.songWrapper.style.filter = ''; }, 50);
        
        let toSmash = 3;
        this.debris.forEach(mesh => {
            if (toSmash > 0 && mesh.position.z > this.camera.position.z - 30) {
                // "Smash" it by resetting it far back instantly
                mesh.position.z -= 80;
                mesh.position.x = (Math.random() - 0.5) * 60;
                mesh.position.y = (Math.random() - 0.5) * 40;
                toSmash--;
            }
        });
        
        // Spawn a system text
        const phrases = ["BLOCKED", "ERROR", "REJECTED", "SYSTEM FAULT"];
        const word = phrases[Math.floor(Math.random() * phrases.length)];
        this.spawnText({ text: word }, true);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        const position = this.currentTime;
        const chorus = playerManager.player.video.findChorus(position);
        this.isClimax = !!chorus;

        // Camera movement & shake
        this.baseCameraPos.z -= 0.15; // Move fast
        
        let shakeIntensity = 0.05;
        if (this.isClimax) {
            shakeIntensity = 0.5; // Intense shake during chorus
            
            // Add CSS glitch filter to the whole scene occasionally
            if (Math.random() < 0.1) {
                this.songWrapper.style.filter = 'contrast(2) hue-rotate(90deg) invert(1)';
                setTimeout(() => {
                    this.songWrapper.style.filter = '';
                }, 50);
            }
        }
        
        this.camera.position.set(
            this.baseCameraPos.x + (Math.random() - 0.5) * shakeIntensity,
            this.baseCameraPos.y + (Math.random() - 0.5) * shakeIntensity,
            this.baseCameraPos.z + (Math.random() - 0.5) * shakeIntensity
        );

        // Debris animation
        this.debris.forEach(mesh => {
            mesh.rotation.x += mesh.userData.rotSpeed.x;
            mesh.rotation.y += mesh.userData.rotSpeed.y;
            mesh.rotation.z += mesh.userData.rotSpeed.z;
            
            // Fly at camera
            mesh.position.z += mesh.userData.zSpeed;
            
            if (mesh.position.z > this.camera.position.z + 10) {
                mesh.position.z = this.camera.position.z - 60;
                mesh.position.x = (Math.random() - 0.5) * 60;
                mesh.position.y = (Math.random() - 0.5) * 40;
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
            
            if (s.userData.glitch) {
                // Erratic opacity for glitch text
                s.material.opacity = Math.random() > 0.2 ? 1 : 0;
            } else {
                if (age < 500) {
                    s.material.opacity = age / 500;
                } else if (age > s.userData.life - 500) {
                    s.material.opacity = (s.userData.life - age) / 500;
                } else {
                    s.material.opacity = 1;
                }
            }
            
            if (age > s.userData.life || s.position.z > this.camera.position.z + 5) {
                this.scene.remove(s);
                s.material.map.dispose();
                s.material.dispose();
                this.activeSprites.splice(i, 1);
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
        this.container.removeEventListener('click', this.boundOnClick);
        
        this.activeSprites.forEach(s => {
            if (s.material.map) s.material.map.dispose();
            s.material.dispose();
        });
        
        this.debris.forEach(mesh => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        
        this.songWrapper.style.filter = '';
        
        if (this.renderer) this.renderer.dispose();

        super.destroy();
    }
}
