import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

export class SongAfter extends BaseSong {
    constructor(container, songId) {
        super(container, songId);
        
        if (this.lyricRenderer && this.lyricRenderer.lyricContainer) {
            this.lyricRenderer.lyricContainer.style.display = 'none';
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        this.activeSprites = [];
        this.lastPhrase = null;
        
        this.isClimax = false;
        
        this.themeColor = '#207765';
        this.mouse = new THREE.Vector2();
        
        this.boundOnResize = this.onResize.bind(this);
        this.boundOnMouseMove = this.onMouseMove.bind(this);
    }

    init() {
        this.initThree();
        this.initStage();
        window.addEventListener('resize', this.boundOnResize);
        this.container.addEventListener('mousemove', this.boundOnMouseMove);
        
        this.isActive = true;
        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x020a08, 0.04);
        this.scene.background = new THREE.Color(0x020a08);
        
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 15);
        this.camera.lookAt(0, 2, 0);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Enable shadows for dramatic stage effect
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initStage() {
        // Stage Floor
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({ 
            color: 0x111111,
            roughness: 0.8,
            metalness: 0.2
        });
        this.floor = new THREE.Mesh(floorGeo, floorMat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);

        // Ambient Light (Very dim)
        this.scene.add(new THREE.AmbientLight(0x222222));

        // Dramatic Spotlight
        this.spotLight = new THREE.SpotLight(0xffffff, 100);
        this.spotLight.position.set(0, 20, 0);
        this.spotLight.angle = Math.PI / 6;
        this.spotLight.penumbra = 0.5;
        this.spotLight.decay = 2;
        this.spotLight.distance = 50;
        this.spotLight.castShadow = true;
        
        this.scene.add(this.spotLight);
        
        // Interactive Spotlight controlled by mouse
        this.mouseLight = new THREE.SpotLight(0xffffff, 50);
        this.mouseLight.position.set(0, 15, 5);
        this.mouseLight.angle = Math.PI / 10;
        this.mouseLight.penumbra = 0.5;
        this.scene.add(this.mouseLight);
        
        // Add a subtle colored light for the theme
        const pointLight = new THREE.PointLight(new THREE.Color(this.themeColor), 20, 30);
        pointLight.position.set(0, 2, 5);
        this.scene.add(pointLight);

        // The Curtain
        const curtainGeo = new THREE.PlaneGeometry(40, 20);
        const curtainMat = new THREE.MeshStandardMaterial({ 
            color: new THREE.Color(this.themeColor),
            roughness: 0.9,
            side: THREE.DoubleSide
        });
        this.curtain = new THREE.Mesh(curtainGeo, curtainMat);
        this.curtain.position.set(0, 10, 5); // Start pulled up (open)
        this.scene.add(this.curtain);
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    onMouseMove(event) {
        // Map mouse to stage floor coordinates roughly
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        const targetX = this.mouse.x * 15;
        const targetZ = -this.mouse.y * 10;
        this.mouseLight.target.position.set(targetX, 0, targetZ);
        this.mouseLight.target.updateMatrixWorld();
    }

    createTextTexture(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0,0,1024,128);
        ctx.font = 'bold 80px "Inter", "Noto Sans JP", serif'; // Serif for theatrical feel
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 512, 64);
        return new THREE.CanvasTexture(canvas);
    }

    spawnText(phrase) {
        const texture = this.createTextTexture(phrase.text);
        // Using Basic material so it is visible in the dark without needing strong direct light
        const material = new THREE.MeshBasicMaterial({ 
            map: texture, 
            transparent: true, 
            opacity: 0,
            alphaTest: 0.1,
            color: 0xffffff
        });
        const geo = new THREE.PlaneGeometry(1024/100, 128/100);
        const mesh = new THREE.Mesh(geo, material);
        
        // Spawn strictly inside the spotlight cone
        mesh.position.set(
            (Math.random() - 0.5) * 4, 
            Math.random() * 3 + 1,
            (Math.random() - 0.5) * 2
        );
        mesh.castShadow = true;
        mesh.userData = { birth: this.currentTime, life: 6000 };
        
        const scale = 1.5 + Math.random();
        mesh.scale.set(scale, scale, 1);
        
        // Face camera
        mesh.lookAt(this.camera.position);
        
        this.scene.add(mesh);
        this.activeSprites.push(mesh);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        const position = this.currentTime;
        const chorus = playerManager.player.video.findChorus(position);
        this.isClimax = !!chorus;
        
        // Curtain Animation
        if (this.isClimax) {
            // Curtain falls! (Y goes down to 0)
            this.curtain.position.y += (0 - this.curtain.position.y) * 0.05;
        } else {
            // Curtain rises! (Y goes up to 15)
            this.curtain.position.y += (15 - this.curtain.position.y) * 0.05;
        }

        // Spotlight sweeping slowly
        this.spotLight.position.x = Math.sin(Date.now() * 0.001) * 3;
        this.spotLight.target.position.x = Math.sin(Date.now() * 0.001) * 3;
        this.spotLight.target.updateMatrixWorld();

        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase !== this.lastPhrase) {
            this.lastPhrase = phrase;
            this.spawnText(phrase);
        }

        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const mesh = this.activeSprites[i];
            const age = position - mesh.userData.birth;
            
            // Float up slowly like actors rising
            mesh.position.y += 0.005;
            
            if (age < 1000) {
                mesh.material.opacity = age / 1000;
            } else if (age > mesh.userData.life - 1000) {
                mesh.material.opacity = (mesh.userData.life - age) / 1000;
            } else {
                mesh.material.opacity = 1;
            }
            
            if (age > mesh.userData.life) {
                this.scene.remove(mesh);
                mesh.material.map.dispose();
                mesh.material.dispose();
                mesh.geometry.dispose();
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
        this.container.removeEventListener('mousemove', this.boundOnMouseMove);
        
        this.activeSprites.forEach(mesh => {
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
            mesh.geometry.dispose();
        });
        
        if (this.floor) {
            this.floor.geometry.dispose();
            this.floor.material.dispose();
        }
        
        if (this.curtain) {
            this.curtain.geometry.dispose();
            this.curtain.material.dispose();
        }
        
        if (this.renderer) this.renderer.dispose();

        super.destroy();
    }
}
