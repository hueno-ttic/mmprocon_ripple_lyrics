import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

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
        this.colorPickerShown = false;
        this.drawUiShown = false;
        this.isClimax = false;
        
        this.colorPickerContainer = null;
        this.drawCanvas = null;
        this.drawCtx = null;
        this.isDrawing = false;
        this.currentStroke = [];
        this.fireworks = [];
        
        this.boundOnResize = this.onResize.bind(this);
        this.boundOnClick = this.onClick.bind(this);
    }

    init() {
        this.initThree();
        this.initStars();
        window.addEventListener('resize', this.boundOnResize);
        this.container.addEventListener('click', this.boundOnClick);
        super.init(); // calls requestAnimationFrame loop
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
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0,0,1024,128);
        ctx.font = 'bold 80px "Inter", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 512, 64);
        return new THREE.CanvasTexture(canvas);
    }

    spawnText(lyricEntity) {
        const texture = this.createTextTexture(lyricEntity.text);
        const material = new THREE.SpriteMaterial({ 
            map: texture, 
            color: new THREE.Color(this.currentColor), 
            transparent: true, 
            opacity: 0 
        });
        const sprite = new THREE.Sprite(material);
        // Reduce randomness for phrases so they are easier to read
        sprite.position.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 4, -5 - Math.random() * 5);
        sprite.userData = { birth: this.currentTime, life: 4000 };
        
        // Scale based on text length to avoid squishing
        const aspect = 1024 / 128;
        const scale = 2 + Math.random();
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    onClick(event) {
        // Prevent click if drawing
        if (this.isDrawing) return;
        
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, this.camera);
        
        const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(planeZ, intersectPoint);
        
        if (!intersectPoint) return;

        // Spawn particles
        const geo = new THREE.BufferGeometry();
        const count = 50;
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            positions[i*3] = intersectPoint.x;
            positions[i*3+1] = intersectPoint.y;
            positions[i*3+2] = intersectPoint.z;
            velocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5 + 0.2, // bias up
                (Math.random() - 0.5) * 0.5
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({ color: new THREE.Color(this.currentColor), size: 0.2, transparent: true });
        const particles = new THREE.Points(geo, mat);
        particles.userData = { velocities, birth: Date.now() };
        this.scene.add(particles);
        this.fireworks.push(particles);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        const position = this.currentTime;
        
        // --- Climax (Chorus) logic ---
        const chorus = playerManager.player.findChorus(position);
        this.isClimax = !!chorus || position > 180000; // fallback climax at 3min
        
        if (this.isClimax) {
            this.camera.position.z += (15 - this.camera.position.z) * 0.01;
            this.stars.rotation.y += 0.002;
        } else {
            this.stars.rotation.y += 0.0005;
        }

        // --- 3D Lyrics logic ---
        // Changed from findChar to findPhrase or findWord to improve readability
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase !== this.lastPhrase) {
            this.lastPhrase = phrase;
            this.spawnText(phrase);
        }

        // Update sprites
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const s = this.activeSprites[i];
            const age = position - s.userData.birth;
            s.position.y += 0.01; // drift up
            s.position.x += Math.sin(position * 0.001 + s.position.y) * 0.01;
            
            if (this.isClimax) {
                s.position.x *= 1.01;
                s.position.y *= 1.01;
            }
            
            if (age < 500) {
                s.material.opacity = age / 500;
            } else if (age > s.userData.life - 500) {
                s.material.opacity = (s.userData.life - age) / 500;
            } else {
                s.material.opacity = 1;
            }
            
            if (age > s.userData.life) {
                this.scene.remove(s);
                s.material.map.dispose();
                s.material.dispose();
                this.activeSprites.splice(i, 1);
            }
        }

        // Update drawn lines
        this.drawnLines.forEach(line => {
            line.rotation.y += 0.01;
            line.rotation.x += 0.005;
        });
        
        // Update fireworks
        for (let i = this.fireworks.length - 1; i >= 0; i--) {
            const fw = this.fireworks[i];
            const age = Date.now() - fw.userData.birth;
            const positions = fw.geometry.attributes.position.array;
            for (let j = 0; j < fw.userData.velocities.length; j++) {
                positions[j*3] += fw.userData.velocities[j].x;
                positions[j*3+1] += fw.userData.velocities[j].y;
                positions[j*3+2] += fw.userData.velocities[j].z;
                fw.userData.velocities[j].y -= 0.01; // gravity
            }
            fw.geometry.attributes.position.needsUpdate = true;
            fw.material.opacity = 1 - (age / 1000);
            if (age > 1000) {
                this.scene.remove(fw);
                fw.geometry.dispose();
                fw.material.dispose();
                this.fireworks.splice(i, 1);
            }
        }

        // --- Color Picker trigger ---
        const word = playerManager.player.video.findWord(position);
        const wordText = word ? word.text : '';
        if (!this.colorPickerShown && (wordText.includes('空') || wordText.includes('色') || position > 20000)) {
            this.showColorPicker();
            this.colorPickerShown = true;
        }

        // --- Draw UI trigger ---
        if (!this.drawUiShown && (wordText.includes('形') || wordText.includes('カタチ') || position > 40000)) {
            this.showDrawUI();
            this.drawUiShown = true;
        }
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    showColorPicker() {
        this.colorPickerContainer = document.createElement('div');
        this.colorPickerContainer.style.position = 'absolute';
        this.colorPickerContainer.style.bottom = '100px';
        this.colorPickerContainer.style.left = '50%';
        this.colorPickerContainer.style.transform = 'translateX(-50%)';
        this.colorPickerContainer.style.background = 'rgba(0,0,0,0.5)';
        this.colorPickerContainer.style.padding = '10px';
        this.colorPickerContainer.style.borderRadius = '10px';
        this.colorPickerContainer.style.display = 'flex';
        this.colorPickerContainer.style.flexDirection = 'column';
        this.colorPickerContainer.style.alignItems = 'center';
        this.colorPickerContainer.style.color = '#fff';
        this.colorPickerContainer.innerHTML = `
            <div style="margin-bottom: 8px;">空の色を選んでください</div>
            <input type="color" id="orchestra-color-picker" value="${this.currentColor}">
        `;
        this.songWrapper.appendChild(this.colorPickerContainer);

        const picker = document.getElementById('orchestra-color-picker');
        picker.addEventListener('input', (e) => {
            this.currentColor = e.target.value;
            localStorage.setItem('orchestra_color', this.currentColor);
            const c = new THREE.Color(this.currentColor);
            if (this.starMaterial) this.starMaterial.color = c;
            this.activeSprites.forEach(s => s.material.color = c);
        });

        // Hide after 10 seconds
        setTimeout(() => {
            if (this.colorPickerContainer && this.colorPickerContainer.parentNode) {
                this.colorPickerContainer.parentNode.removeChild(this.colorPickerContainer);
                this.colorPickerContainer = null;
            }
        }, 10000);
    }

    showDrawUI() {
        this.drawCanvas = document.createElement('canvas');
        this.drawCanvas.width = window.innerWidth;
        this.drawCanvas.height = window.innerHeight;
        this.drawCanvas.style.position = 'absolute';
        this.drawCanvas.style.top = '0';
        this.drawCanvas.style.left = '0';
        this.drawCanvas.style.zIndex = '50';
        this.drawCanvas.style.cursor = 'crosshair';
        this.songWrapper.appendChild(this.drawCanvas);
        
        this.drawCtx = this.drawCanvas.getContext('2d');
        
        const info = document.createElement('div');
        info.innerText = 'あなたのカタチを描いてください';
        info.style.position = 'absolute';
        info.style.top = '100px';
        info.style.width = '100%';
        info.style.textAlign = 'center';
        info.style.color = '#fff';
        info.style.fontSize = '24px';
        info.style.pointerEvents = 'none';
        info.style.zIndex = '51';
        this.songWrapper.appendChild(info);

        this.boundPointerDown = this.onPointerDown.bind(this);
        this.boundPointerMove = this.onPointerMove.bind(this);
        this.boundPointerUp = this.onPointerUp.bind(this);

        this.drawCanvas.addEventListener('pointerdown', this.boundPointerDown);
        this.drawCanvas.addEventListener('pointermove', this.boundPointerMove);
        window.addEventListener('pointerup', this.boundPointerUp);

        // Auto confirm after 10 seconds
        setTimeout(() => {
            this.confirmDrawing(info);
        }, 10000);
    }

    onPointerDown(e) {
        this.isDrawing = true;
        this.currentStroke = [];
        this.drawCtx.beginPath();
        this.drawCtx.moveTo(e.clientX, e.clientY);
        this.currentStroke.push(new THREE.Vector3(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1,
            0
        ));
    }

    onPointerMove(e) {
        if (!this.isDrawing) return;
        this.drawCtx.lineTo(e.clientX, e.clientY);
        this.drawCtx.strokeStyle = this.currentColor;
        this.drawCtx.lineWidth = 3;
        this.drawCtx.stroke();
        this.currentStroke.push(new THREE.Vector3(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1,
            0
        ));
    }

    onPointerUp() {
        this.isDrawing = false;
    }

    confirmDrawing(infoEl) {
        if (!this.drawCanvas) return;
        
        this.drawCanvas.removeEventListener('pointerdown', this.boundPointerDown);
        this.drawCanvas.removeEventListener('pointermove', this.boundPointerMove);
        window.removeEventListener('pointerup', this.boundPointerUp);
        
        if (this.drawCanvas.parentNode) {
            this.drawCanvas.parentNode.removeChild(this.drawCanvas);
        }
        if (infoEl && infoEl.parentNode) {
            infoEl.parentNode.removeChild(infoEl);
        }
        this.drawCanvas = null;

        if (this.currentStroke.length > 1) {
            // Unproject stroke points from screen space to 3D world space
            const worldPoints = this.currentStroke.map(p => {
                const vec = p.clone();
                vec.unproject(this.camera);
                const dir = vec.sub(this.camera.position).normalize();
                const distance = 8; // distance from camera
                return this.camera.position.clone().add(dir.multiplyScalar(distance));
            });

            const geometry = new THREE.BufferGeometry().setFromPoints(worldPoints);
            const material = new THREE.LineBasicMaterial({ color: new THREE.Color(this.currentColor), linewidth: 2 });
            const line = new THREE.Line(geometry, material);
            
            // Center geometry
            geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            geometry.boundingBox.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);
            line.position.copy(center);
            
            this.scene.add(line);
            this.drawnLines.push(line);
        }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        
        if (this.drawCanvas) {
            this.drawCanvas.removeEventListener('pointerdown', this.boundPointerDown);
            this.drawCanvas.removeEventListener('pointermove', this.boundPointerMove);
            window.removeEventListener('pointerup', this.boundPointerUp);
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
        
        if (this.starGeometry) this.starGeometry.dispose();
        if (this.starMaterial) this.starMaterial.dispose();
        if (this.renderer) this.renderer.dispose();
        
        this.container.removeEventListener('click', this.boundOnClick);
        
        // Clean DOM overlays in BaseSong.destroy
        super.destroy();
    }
}
