import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

export class SongShutter extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        
        if (this.lyricRenderer && this.lyricRenderer.lyricContainer) {
            this.lyricRenderer.lyricContainer.style.display = 'none';
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        this.activeSprites = [];
        this.frames = [];
        this.lastPhrase = null;
        
        this.isClimax = false;
        this.climaxTriggered = false;
        
        this.themeColor = '#B9543C';
        
        this.boundOnResize = this.onResize.bind(this);
        this.boundOnClick = this.takePhoto.bind(this);
        this.boundOnKeyDown = (e) => { if (e.code === 'Enter') this.takePhoto(); };
    }

    init() {
        this.initThree();
        this.initEnvironment();
        this.createViewfinderUI();
        window.addEventListener('resize', this.boundOnResize);
        window.addEventListener('keydown', this.boundOnKeyDown);
        this.container.addEventListener('click', this.boundOnClick);
        
        this.isActive = true;
        super.init();
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
    }

    initEnvironment() {
        // Create flying polaroid frames (wireframe)
        const boxGeo = new THREE.BoxGeometry(4, 3, 0.1);
        const edges = new THREE.EdgesGeometry(boxGeo);
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(this.themeColor) });

        for (let i = 0; i < 30; i++) {
            const frame = new THREE.LineSegments(edges, mat);
            frame.position.set(
                (Math.random() - 0.5) * 40,
                (Math.random() - 0.5) * 40,
                -Math.random() * 50
            );
            frame.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            frame.userData = {
                rotSpeed: new THREE.Vector3((Math.random()-0.5)*0.02, (Math.random()-0.5)*0.02, (Math.random()-0.5)*0.02),
                zSpeed: Math.random() * 0.1 + 0.05
            };
            this.scene.add(frame);
            this.frames.push(frame);
        }
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
        
        this.viewfinder.innerHTML = `
            <div style="${bracketStyle}; top: 40px; left: 40px; border-right: none; border-bottom: none;"></div>
            <div style="${bracketStyle}; top: 40px; right: 40px; border-left: none; border-bottom: none;"></div>
            <div style="${bracketStyle}; bottom: 40px; left: 40px; border-right: none; border-top: none;"></div>
            <div style="${bracketStyle}; bottom: 40px; right: 40px; border-left: none; border-top: none;"></div>
            <div style="position: absolute; top: 50px; left: 50%; transform: translateX(-50%); color: ${this.themeColor}; font-family: monospace; font-size: 20px; font-weight: bold;">[ REC ]</div>
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 20px; height: 20px; border: 1px solid ${this.themeColor}; border-radius: 50%; opacity: 0.5;"></div>
        `;
        
        this.songWrapper.appendChild(this.viewfinder);
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    createTextTexture(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0,0,1024,128);
        ctx.font = 'bold 72px "Inter", "Noto Sans JP", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = this.themeColor;
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 512, 64);
        return new THREE.CanvasTexture(canvas);
    }

    spawnText(phrase) {
        const texture = this.createTextTexture(phrase.text);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0 });
        const sprite = new THREE.Sprite(material);
        
        // Spawn randomly
        sprite.position.set(
            (Math.random() - 0.5) * 8, 
            (Math.random() - 0.5) * 8,
            this.camera.position.z - 15 - Math.random() * 5 // Closer to camera
        );
        sprite.userData = { birth: this.currentTime, life: 5000, frozen: false };
        
        const aspect = 1024 / 128;
        const scale = 2.5 + Math.random();
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        const position = this.currentTime;
        const chorus = playerManager.player.video.findChorus(position);
        this.isClimax = !!chorus;
        
        if (this.isClimax && !this.climaxTriggered) {
            this.climaxTriggered = true;
            this.triggerShutterFlash();
        } else if (!this.isClimax && this.climaxTriggered) {
            this.climaxTriggered = false;
        }

        // Animate frames
        this.frames.forEach(frame => {
            if (frame.userData.dropSpeed) {
                // It's a snapped photo dropping
                frame.rotation.x += frame.userData.rotSpeed.x;
                frame.rotation.y += frame.userData.rotSpeed.y;
                frame.position.y += frame.userData.dropSpeed;
                frame.userData.dropSpeed -= 0.005; // gravity
            } else if (!this.climaxTriggered) { // Freeze during climax!
                frame.rotation.x += frame.userData.rotSpeed.x;
                frame.rotation.y += frame.userData.rotSpeed.y;
                frame.rotation.z += frame.userData.rotSpeed.z;
                frame.position.z += frame.userData.zSpeed;
                
                if (frame.position.z > this.camera.position.z + 5) {
                    frame.position.z = this.camera.position.z - 60;
                }
            }
        });

        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase !== this.lastPhrase) {
            this.lastPhrase = phrase;
            this.spawnText(phrase);
        }

        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const s = this.activeSprites[i];
            
            if (s.userData.frameTarget) {
                // Attached to a dropping photo frame
                s.position.copy(s.userData.frameTarget.position);
                s.rotation.copy(s.userData.frameTarget.rotation);
                if (s.position.y < -20) {
                    this.scene.remove(s);
                    s.material.map.dispose();
                    s.material.dispose();
                    this.activeSprites.splice(i, 1);
                }
                continue;
            }
            
            const age = position - s.userData.birth;
            
            if (age < 500) {
                s.material.opacity = age / 500;
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
        
        // Sound effect (optional, but a visual snap is enough)
        
        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => {
                if (flash.parentNode) flash.parentNode.removeChild(flash);
            }, 300);
        }, 50);
    }
    
    takePhoto() {
        this.triggerShutterFlash();
        
        // Find if there is an active sprite right now
        if (this.lastPhrase && this.activeSprites.length > 0) {
            const texture = this.createTextTexture(this.lastPhrase.text);
            const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
            const sprite = new THREE.Sprite(material);
            
            // Spawn right in front of camera
            sprite.position.set(0, 0, this.camera.position.z - 3);
            const aspect = 1024 / 128;
            const scale = 1.5;
            sprite.scale.set(scale * aspect, scale, 1);
            
            // Add a polaroid frame around it
            const boxGeo = new THREE.BoxGeometry(scale * aspect + 0.5, scale + 1.5, 0.1);
            const edges = new THREE.EdgesGeometry(boxGeo);
            const mat = new THREE.LineBasicMaterial({ color: new THREE.Color('#ffffff') });
            const frame = new THREE.LineSegments(edges, mat);
            frame.position.copy(sprite.position);
            
            this.scene.add(sprite);
            this.scene.add(frame);
            
            // Drop them down
            frame.userData = {
                rotSpeed: new THREE.Vector3((Math.random()-0.5)*0.1, (Math.random()-0.5)*0.1, 0),
                dropSpeed: -0.05
            };
            
            // We use the frames array for animation but mark it as special
            this.frames.push(frame);
            // Also animate the sprite
            sprite.userData = { frameTarget: frame };
            this.activeSprites.push(sprite);
        }
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        window.removeEventListener('keydown', this.boundOnKeyDown);
        this.container.removeEventListener('click', this.boundOnClick);
        
        this.activeSprites.forEach(s => {
            if (s.material.map) s.material.map.dispose();
            s.material.dispose();
        });
        
        this.frames.forEach(frame => {
            frame.geometry.dispose();
            frame.material.dispose();
        });
        
        if (this.viewfinder && this.viewfinder.parentNode) {
            this.viewfinder.parentNode.removeChild(this.viewfinder);
        }
        
        if (this.renderer) this.renderer.dispose();

        super.destroy();
    }
}
