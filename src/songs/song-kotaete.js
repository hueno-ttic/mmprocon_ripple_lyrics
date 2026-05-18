import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

export class SongKotaete extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        
        // Hide the generic DOM lyric renderer since we use 3D
        if (this.lyricRenderer && this.lyricRenderer.lyricContainer) {
            this.lyricRenderer.lyricContainer.style.display = 'none';
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        this.paths = [];
        this.activeSprites = [];
        this.lastPhrase = null;
        
        this.isClimax = false;
        this.choiceUiShown = false;
        this.userChoice = null; // 'left' or 'right'
        
        this.themeColor = '#7F77DD';
        this.leftColor = '#ff5555';
        this.rightColor = '#5555ff';

        this.boundOnResize = this.onResize.bind(this);
    }

    init() {
        this.initThree();
        this.initPaths();
        window.addEventListener('resize', this.boundOnResize);
        
        // Skip calling super.init() directly because it starts the loop,
        // we can just call it, BaseSong.init() calls this.loop() (or animate())
        this.isActive = true;
        // In BaseSong it sets isActive = true, registers eventBus, and calls requestAnimationFrame
        // Wait, BaseSong.init() is not exported as super.init() if we override it?
        // Actually, we don't need to override init() if we can just call super.init() at the end.
        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050510, 0.015); // Reduced fog
        this.scene.background = new THREE.Color(0x050510);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 2, 10);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initPaths() {
        // Create grid lines representing the "path"
        const material = new THREE.LineBasicMaterial({ color: new THREE.Color(this.themeColor), transparent: true, opacity: 0.8 }); // Increased opacity
        
        for (let i = -10; i <= 10; i++) {
            const points = [];
            points.push(new THREE.Vector3(i * 2, -2, -50));
            points.push(new THREE.Vector3(i * 2, -2, 50));
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
            this.paths.push(line);
        }

        // Horizontal lines
        for (let i = -25; i <= 25; i++) {
            const points = [];
            points.push(new THREE.Vector3(-20, -2, i * 2));
            points.push(new THREE.Vector3(20, -2, i * 2));
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
            this.paths.push(line);
        }
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    createTextTexture(text, colorStr) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0,0,1024,128);
        ctx.font = 'bold 80px "Inter", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = colorStr;
        ctx.shadowBlur = 20;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 512, 64);
        return new THREE.CanvasTexture(canvas);
    }

    spawnText(phrase) {
        let color = this.themeColor;
        if (this.userChoice === 'left') color = this.leftColor;
        if (this.userChoice === 'right') color = this.rightColor;

        const texture = this.createTextTexture(phrase.text, color);
        const material = new THREE.SpriteMaterial({ 
            map: texture, 
            transparent: true, 
            opacity: 0 
        });
        const sprite = new THREE.Sprite(material);
        
        // Spawn slightly ahead of camera
        sprite.position.set((Math.random() - 0.5) * 6, Math.random() * 4, this.camera.position.z - 15 - Math.random() * 5); // Spawn closer
        sprite.userData = { birth: this.currentTime, life: 5000 };
        
        const aspect = 1024 / 128;
        const scale = 2 + Math.random();
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    update(time) {
        // Do not call super.update(time) to skip Generic LyricRenderer

        if (!playerManager.player || !playerManager.player.video) return;

        const position = this.currentTime;
        
        // Move camera forward continuously
        let speed = 0.05;
        
        let chorus = null;
        if (typeof playerManager.player.video.findChorus === 'function') {
            chorus = playerManager.player.video.findChorus(position);
        }
        this.isClimax = !!chorus;
        
        if (this.isClimax) {
            speed = 0.15; // Faster during chorus
            if (!this.choiceUiShown) {
                this.showChoiceUI();
                this.choiceUiShown = true;
            }
        }
        
        this.camera.position.z -= speed;

        // Loop the grid to give infinite illusion
        this.paths.forEach(line => {
            if (this.camera.position.z - line.position.z < -25) {
                line.position.z -= 50; // Move grid forward
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
            
            // Drift slightly
            s.position.y += Math.sin(age * 0.002) * 0.01;
            
            if (age < 1000) {
                s.material.opacity = age / 1000;
            } else if (age > s.userData.life - 1000) {
                s.material.opacity = (s.userData.life - age) / 1000;
            } else {
                s.material.opacity = 1;
            }
            
            // Remove if past camera or dead
            if (age > s.userData.life || s.position.z > this.camera.position.z) {
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

    showChoiceUI() {
        this.choiceContainer = document.createElement('div');
        this.choiceContainer.style.position = 'absolute';
        this.choiceContainer.style.top = '50%';
        this.choiceContainer.style.left = '50%';
        this.choiceContainer.style.transform = 'translate(-50%, -50%)';
        this.choiceContainer.style.display = 'flex';
        this.choiceContainer.style.gap = '40px';
        this.choiceContainer.style.zIndex = '50';

        const createBtn = (text, color, choice) => {
            const btn = document.createElement('button');
            btn.innerText = text;
            btn.style.padding = '20px 40px';
            btn.style.fontSize = '24px';
            btn.style.fontWeight = 'bold';
            btn.style.color = '#fff';
            btn.style.background = 'rgba(0,0,0,0.5)';
            btn.style.border = `2px solid ${color}`;
            btn.style.borderRadius = '8px';
            btn.style.cursor = 'pointer';
            btn.style.backdropFilter = 'blur(10px)';
            btn.style.transition = 'all 0.3s ease';
            
            btn.addEventListener('mouseenter', () => {
                btn.style.background = color;
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'rgba(0,0,0,0.5)';
            });
            
            btn.addEventListener('click', () => {
                this.userChoice = choice;
                this.applyChoice(color);
                this.choiceContainer.style.opacity = '0';
                setTimeout(() => {
                    if (this.choiceContainer.parentNode) {
                        this.choiceContainer.parentNode.removeChild(this.choiceContainer);
                    }
                }, 500);
            });
            return btn;
        };

        this.choiceContainer.appendChild(createBtn('あなたの答え', this.leftColor, 'left'));
        this.choiceContainer.appendChild(createBtn('僕の答え', this.rightColor, 'right'));

        this.songWrapper.appendChild(this.choiceContainer);
    }

    applyChoice(color) {
        // Change grid color
        const c = new THREE.Color(color);
        this.paths.forEach(line => {
            line.material.color = c;
        });
        
        // Add a flash effect
        const flash = document.createElement('div');
        flash.style.position = 'absolute';
        flash.style.top = '0';
        flash.style.left = '0';
        flash.style.width = '100%';
        flash.style.height = '100%';
        flash.style.background = color;
        flash.style.opacity = '0.5';
        flash.style.zIndex = '40';
        flash.style.pointerEvents = 'none';
        flash.style.transition = 'opacity 1s ease';
        this.songWrapper.appendChild(flash);
        
        // Force reflow
        void flash.offsetWidth;
        flash.style.opacity = '0';
        setTimeout(() => {
            if (flash.parentNode) flash.parentNode.removeChild(flash);
        }, 1000);
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        
        this.activeSprites.forEach(s => {
            if (s.material.map) s.material.map.dispose();
            s.material.dispose();
        });
        
        this.paths.forEach(line => {
            line.geometry.dispose();
            line.material.dispose();
        });
        
        if (this.renderer) this.renderer.dispose();
        
        if (this.choiceContainer && this.choiceContainer.parentNode) {
            this.choiceContainer.parentNode.removeChild(this.choiceContainer);
        }

        super.destroy();
    }
}
