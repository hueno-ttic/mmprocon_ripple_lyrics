import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

export class SongAfter extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        this.activeSprites = [];
        this.petals = [];
        this.stars = null;
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
        this.initStars();
        
        window.addEventListener('resize', this.boundOnResize);
        this.container.addEventListener('mousemove', this.boundOnMouseMove);
        
        this.isActive = true;
        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x020a08, 0.03);
        this.scene.background = new THREE.Color(0x020a08);
        
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 15);
        this.camera.lookAt(0, 2, 0);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        
        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initStage() {
        // Stage Floor
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({ 
            color: 0x111b18,
            roughness: 0.7,
            metalness: 0.3
        });
        this.floor = new THREE.Mesh(floorGeo, floorMat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);

        // Ambient Light (Very dim, so spotlight effects are dramatic)
        this.scene.add(new THREE.AmbientLight(0x081512));

        // Dramatic Sweeping Spotlight
        this.spotLight = new THREE.SpotLight(0xffffff, 80);
        this.spotLight.position.set(0, 20, -2);
        this.spotLight.angle = Math.PI / 6;
        this.spotLight.penumbra = 0.6;
        this.spotLight.decay = 1.5;
        this.spotLight.distance = 50;
        this.spotLight.castShadow = true;
        this.scene.add(this.spotLight);
        this.scene.add(this.spotLight.target);

        // Interactive Spotlight controlled by mouse
        this.mouseLight = new THREE.SpotLight(0xffffff, 90);
        this.mouseLight.position.set(0, 18, 5);
        this.mouseLight.angle = Math.PI / 8;
        this.mouseLight.penumbra = 0.5;
        this.mouseLight.decay = 1.2;
        this.mouseLight.distance = 40;
        this.scene.add(this.mouseLight);
        this.scene.add(this.mouseLight.target);

        // Subtle colored point light for theme mood
        this.pointLight = new THREE.PointLight(new THREE.Color(this.themeColor), 25, 25);
        this.pointLight.position.set(0, 3, 0);
        this.scene.add(this.pointLight);

        // The Curtain - acting as a backstage backdrop (Z = -5)
        const curtainGeo = new THREE.PlaneGeometry(40, 22);
        const curtainMat = new THREE.MeshStandardMaterial({ 
            color: new THREE.Color(0x0b3d2e),
            roughness: 0.95,
            side: THREE.DoubleSide
        });
        this.curtain = new THREE.Mesh(curtainGeo, curtainMat);
        this.curtain.position.set(0, 6, -5); // Closed Y=6, opens up to Y=20
        this.scene.add(this.curtain);
    }

    initStars() {
        const starCount = 250;
        const starGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        
        for (let i = 0; i < starCount; i++) {
            // Stars are positioned far behind the curtain backdrop (Z = -15)
            positions[i * 3] = (Math.random() - 0.5) * 60;
            positions[i * 3 + 1] = Math.random() * 25 + 2;
            positions[i * 3 + 2] = -12 - Math.random() * 8;
        }
        
        starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const starMat = new THREE.PointsMaterial({
            color: 0x99ffd6,
            size: 0.12,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending
        });
        
        this.stars = new THREE.Points(starGeo, starMat);
        this.scene.add(this.stars);
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    onMouseMove(event) {
        if (!this.isActive) return;
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Raycast spotlight target onto stage floor coordinates
        const targetX = this.mouse.x * 12;
        const targetZ = -this.mouse.y * 6;
        this.mouseLight.target.position.set(targetX, 0.1, targetZ);
        this.mouseLight.target.updateMatrixWorld();
    }

    onClick(event) {
        if (!this.isActive || !this.renderer || !this.camera) return;
        
        // Calculate mouse position in normalized device coordinates
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        // Raycast to Z=0 plane to spawn confetti precisely where clicked in 3D
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), this.camera);
        
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const intersectionPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersectionPoint);
        
        this.spawnPetals(intersectionPoint);
    }

    spawnPetals(origin) {
        const petalGeo = new THREE.PlaneGeometry(0.3, 0.4);
        
        // Spawn 15 fluttering rose petals/theatre confetti
        for (let i = 0; i < 15; i++) {
            const isRed = Math.random() > 0.35;
            const color = isRed ? 0xd61c4e : 0x1d9e75; // Rose Red or Teal Theme Color
            
            const petalMat = new THREE.MeshStandardMaterial({
                color: color,
                roughness: 0.5,
                metalness: 0.1,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(petalGeo, petalMat);
            
            // Random scatter around origin
            mesh.position.set(
                origin.x + (Math.random() - 0.5) * 4,
                origin.y + Math.random() * 5 + 4, // Spawn above click
                origin.z + (Math.random() - 0.5) * 4
            );
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
            
            mesh.userData = {
                vx: (Math.random() - 0.5) * 0.04,
                vy: -0.04 - Math.random() * 0.04,
                vz: (Math.random() - 0.5) * 0.04,
                rotSpeedX: (Math.random() - 0.5) * 0.06,
                rotSpeedY: (Math.random() - 0.5) * 0.06,
                life: 6000,
                birth: Date.now(),
                isFloored: false
            };
            
            this.scene.add(mesh);
            this.petals.push(mesh);
        }
    }

    createTextTexture(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0,0,1024,128);
        ctx.font = 'bold 72px "Inter", "Noto Sans JP", serif'; // Serif styling for dramatic curtain vibe
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 12;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 512, 64);
        return new THREE.CanvasTexture(canvas);
    }

    spawnText(phrase, spawnTime) {
        const texture = this.createTextTexture(phrase.text);
        
        // MeshStandardMaterial reacts beautifully to both stage lights and spotlight
        const material = new THREE.MeshStandardMaterial({ 
            map: texture, 
            transparent: true, 
            opacity: 0,
            alphaTest: 0.005,
            color: 0xffffff,
            emissive: new THREE.Color(0x000000), // Start pitch black in darkness
            roughness: 0.6,
            metalness: 0.1,
            side: THREE.DoubleSide
        });
        
        const geo = new THREE.PlaneGeometry(1024/110, 128/110);
        const mesh = new THREE.Mesh(geo, material);
        
        // Spawn randomly across the stage floor but in visual range
        mesh.position.set(
            (Math.random() - 0.5) * 16, 
            Math.random() * 4.5 + 1.2,
            (Math.random() - 0.5) * 6 - 1 // Floating in active play field
        );
        mesh.castShadow = true;
        
        mesh.userData = {
            birth: spawnTime,
            life: 9000,
            hoverProgress: 0, // Interpolation factor for spotlight reactions
            baseY: mesh.position.y,
            spinFactor: (Math.random() - 0.5) * 0.15,
            text: phrase.text
        };
        
        const scale = 1.0;
        mesh.scale.set(scale, scale, 1);
        
        // Face camera slightly
        mesh.lookAt(new THREE.Vector3(this.camera.position.x, mesh.position.y, this.camera.position.z));
        
        this.scene.add(mesh);
        this.activeSprites.push(mesh);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        // TextAlive公式タイマー(player.timer.position)に完全同期（先行調整を排除）
        const position = (playerManager.player && playerManager.player.timer)
                         ? playerManager.player.timer.position
                         : this.getSmoothedTime();
        const chorus = playerManager.player && typeof playerManager.player.findChorus === 'function' ? playerManager.player.findChorus(position) : null;
        this.isClimax = !!chorus;
        
        // 1. Curtain & Backstage Starry Sky Climax Animations
        if (this.isClimax) {
            // Chorus climax -> Open curtain upwards dramatically to reveal the starry void
            this.curtain.position.y += (18 - this.curtain.position.y) * 0.04;
            if (this.stars) {
                this.stars.material.opacity += (0.9 - this.stars.material.opacity) * 0.04;
            }
        } else {
            // Normal section -> Close curtain to act as backdrop framing the stage
            this.curtain.position.y += (6 - this.curtain.position.y) * 0.04;
            if (this.stars) {
                this.stars.material.opacity += (0.0 - this.stars.material.opacity) * 0.04;
            }
        }

        // Automatic sweeping ambient spotlight to keep stage alive
        this.spotLight.position.x = Math.sin(Date.now() * 0.0008) * 8;
        this.spotLight.target.position.x = Math.sin(Date.now() * 0.0008) * 4;
        this.spotLight.target.updateMatrixWorld();

        const phrase = playerManager.player.video.findPhrase(position);
        if (this.lyricRenderer) {
            this.lyricRenderer.update(phrase);
        }
        
        // Continuously spawn 3D lyric phrases in the dark stage
        if (phrase && phrase !== this.lastPhrase) {
            this.lastPhrase = phrase;
            this.spawnText(phrase, position);
        } else if (!phrase) {
            this.lastPhrase = null;
        }

        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);

        // 2. Update Interactive 3D Lyrics
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const mesh = this.activeSprites[i];
            const age = Math.max(0, position - mesh.userData.birth);
            
            // Check proximity to mouse spotlight target
            const spotTarget = this.mouseLight.target.position;
            const distToSpot = mesh.position.distanceTo(spotTarget);
            
            const isIlluminated = distToSpot < 4.2;
            const targetProgress = isIlluminated ? 1.0 : 0.0;
            
            // Smoothly morph spotlight reaction parameters
            mesh.userData.hoverProgress += (targetProgress - mesh.userData.hoverProgress) * 0.08;
            const p = mesh.userData.hoverProgress;
            
            // Float up and drift smoothly. Speed is boosted when illuminated!
            // ゆらぎの周期も曲再生位置タイマー(position)に同期し、一時停止時に静止する
            mesh.position.y = mesh.userData.baseY + Math.sin(position * 0.0015 + mesh.userData.birth) * 0.25 * p + (age * 0.00025);
            
            // Spin elegantly under the spotlight
            mesh.rotation.y = Math.sin(position * 0.001) * 0.12 * p + (mesh.userData.spinFactor * p);
            
            // 現在歌唱中の単語とスプライトの文字が一致するかチェックし、歌唱パルス（バウンド拡大＆発光）をトリガー
            const isWordActive = word && mesh.userData.text && mesh.userData.text.includes(word.text)
                              && position >= word.startTime && position <= word.endTime;
            if (!mesh.userData.pulseProgress) mesh.userData.pulseProgress = 0;
            const targetPulse = isWordActive ? 1.0 : 0.0;
            mesh.userData.pulseProgress += (targetPulse - mesh.userData.pulseProgress) * 0.2;
            const pulse = mesh.userData.pulseProgress;
            const pulseScaleFactor = 1.0 + pulse * 0.25; // 1.25倍バウンド

            // Scale up dynamically
            const s = (1.0 + p * 0.35) * pulseScaleFactor;
            mesh.scale.set(s, s, 1);
            
            // Glow via Emissive HSL mapping (Emerald Teal glow)
            // 歌唱中（pulse > 0）はさらに発光輝度と彩度をブースト
            mesh.material.emissive.setHSL(0.44 + pulse * 0.05, 0.8 + pulse * 0.2, 0.45 * p + pulse * 0.45);
            
            // Handle fade-in/fade-out
            if (age < 150) {
                mesh.material.opacity = age / 150;
            } else if (age > mesh.userData.life - 200) {
                mesh.material.opacity = Math.max(0, (mesh.userData.life - age) / 200);
            } else {
                mesh.material.opacity = 1.0;
            }
            
            if (age > mesh.userData.life) {
                this.scene.remove(mesh);
                mesh.material.map.dispose();
                mesh.material.dispose();
                mesh.geometry.dispose();
                this.activeSprites.splice(i, 1);
            }
        }

        // 3. Update Fluttering Petals / Confetti
        for (let i = this.petals.length - 1; i >= 0; i--) {
            const mesh = this.petals[i];
            const age = Date.now() - mesh.userData.birth;
            
            if (!mesh.userData.isFloored) {
                // Fall downwards with side-to-side floating flutter
                mesh.position.x += mesh.userData.vx + Math.sin(Date.now() * 0.0035 + mesh.userData.birth) * 0.015;
                mesh.position.y += mesh.userData.vy;
                mesh.position.z += mesh.userData.vz;
                
                // Spin in flight
                mesh.rotation.x += mesh.userData.rotSpeedX;
                mesh.rotation.y += mesh.userData.rotSpeedY;
                
                // Floor collision detection (Y = 0.08)
                if (mesh.position.y <= 0.08) {
                    mesh.position.y = 0.08;
                    mesh.userData.isFloored = true;
                    // Lie flat on the wooden stage floor
                    mesh.rotation.x = -Math.PI / 2;
                    mesh.rotation.y = 0;
                    mesh.rotation.z = Math.random() * Math.PI * 2;
                }
            } else {
                // Subtle floor sliding
                mesh.position.x += Math.sin(Date.now() * 0.0005) * 0.0005;
            }
            
            // Fade out cleanly at end of life
            const life = mesh.userData.life;
            if (age > life - 1000) {
                mesh.material.opacity = Math.max(0, (life - age) / 1000);
            } else {
                mesh.material.opacity = 1.0;
            }
            
            if (age > life) {
                this.scene.remove(mesh);
                mesh.material.dispose();
                mesh.geometry.dispose();
                this.petals.splice(i, 1);
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
        
        // Clean active text meshes
        this.activeSprites.forEach(mesh => {
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
            mesh.geometry.dispose();
        });
        this.activeSprites = [];
        
        // Clean falling petals
        this.petals.forEach(mesh => {
            mesh.material.dispose();
            mesh.geometry.dispose();
        });
        this.petals = [];
        
        // Clean starry sky
        if (this.stars) {
            this.stars.geometry.dispose();
            this.stars.material.dispose();
        }
        
        // Clean stage meshes
        if (this.floor) {
            this.floor.geometry.dispose();
            this.floor.material.dispose();
        }
        
        if (this.curtain) {
            this.curtain.geometry.dispose();
            this.curtain.material.dispose();
        }
        
        if (this.renderer) this.renderer.dispose();

        if (this.spotLight && this.spotLight.target) this.scene.remove(this.spotLight.target);
        if (this.mouseLight && this.mouseLight.target) this.scene.remove(this.mouseLight.target);

        super.destroy();
    }
}
