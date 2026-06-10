import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';

export class SongKotaete extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

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

        // Horizontal lines with perspective — denser near camera, sparser toward horizon
        const zPositions = [];
        for (let i = 0; i <= 30; i++) {
            zPositions.push(-50 + i * i * 0.055);
        }
        zPositions.forEach(z => {
            const points = [
                new THREE.Vector3(-20, -2, z),
                new THREE.Vector3(20, -2, z)
            ];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
            this.paths.push(line);
        });
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
        ctx.font = 'bold 80px "Inter", "Noto Sans JP", "Hiragino Kaku Gothic Pro", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = colorStr;
        ctx.shadowBlur = 20;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 512, 64);
        return new THREE.CanvasTexture(canvas);
    }

    spawnText(phrase, spawnTime) {
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
        
        const aspect = 1024 / 128;
        const scale = 2 + Math.random();
        sprite.userData = { 
            birth: spawnTime, 
            life: 5000,
            text: phrase.text,
            baseScale: scale,
            aspect: aspect
        };
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    update(time) {
        // Do not call super.update(time) to skip Generic LyricRenderer
        if (!playerManager.player || !playerManager.player.video) return;

        // TextAlive公式タイマー(player.timer.position)に完全同期（先行調整を排除）
        const position = (playerManager.player && playerManager.player.timer)
                         ? playerManager.player.timer.position
                         : this.getSmoothedTime();
        
        // Move camera forward continuously
        let speed = 0.05;
        
        let chorus = null;
        if (playerManager.player && typeof playerManager.player.findChorus === 'function') {
            chorus = playerManager.player.findChorus(position);
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

        // Background theatrical text — phrase level so 3D sprites aren't too busy
        const phrase = playerManager.player.video.findPhrase(position);

        // Word-level lyric display (finer granularity)
        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);
        if (this.lyricRenderer) {
            if (word) {
                this.lyricRenderer.update(word);
            } else if (!phrase) {
                this.lyricRenderer.update(null);
            }
        }
        if (phrase && phrase !== this.lastPhrase) {
            this.lastPhrase = phrase;
            this.spawnText(phrase, position);
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
            
            // 色変化グロウ効果
            s.material.color.setRGB(1.0, 1.0 - pulse * 0.4, 1.0 - pulse * 0.2);

            const age = Math.max(0, position - s.userData.birth);
            
            // Drift slightly. Oscillation is synchronized to song position
            s.position.y += Math.sin(position * 0.002) * 0.01;
            
            if (age < 150) {
                s.material.opacity = age / 150;
            } else if (age > s.userData.life - 200) {
                s.material.opacity = Math.max(0, (s.userData.life - age) / 200);
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
        // Step 1: brief announcement
        const announcement = document.createElement('div');
        announcement.className = 'kotaete-choice-announcement';
        announcement.textContent = '— 問いが届きます —';
        this.songWrapper.appendChild(announcement);
        setTimeout(() => { announcement.style.opacity = '1'; }, 80);
        setTimeout(() => { announcement.style.opacity = '0'; }, 1600);
        setTimeout(() => {
            if (announcement.parentNode) announcement.parentNode.removeChild(announcement);
            this._showChoiceButtons();
        }, 2300);
    }

    _showChoiceButtons() {
        this.choiceContainer = document.createElement('div');
        this.choiceContainer.className = 'kotaete-choice-container';

        const hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r},${g},${b},${alpha})`;
        };

        const createBtn = (mainText, subText, color, choice) => {
            const btn = document.createElement('button');
            btn.className = 'kotaete-choice-btn';
            btn.style.border = `2px solid ${color}`;
            btn.innerHTML = `
                <span class="choice-main">${mainText}</span>
                <span class="choice-sub">${subText}</span>
            `;
            btn.addEventListener('mouseenter', () => {
                btn.style.background = hexToRgba(color, 0.35);
                btn.style.boxShadow = `0 0 20px ${color}`;
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'rgba(0,0,0,0.5)';
                btn.style.boxShadow = 'none';
            });
            btn.addEventListener('click', () => {
                this.userChoice = choice;
                this.applyChoice(color);
                this.choiceContainer.style.opacity = '0';
                setTimeout(() => {
                    if (this.choiceContainer && this.choiceContainer.parentNode) {
                        this.choiceContainer.parentNode.removeChild(this.choiceContainer);
                    }
                }, 500);
            });
            return btn;
        };

        this.choiceContainer.appendChild(
            createBtn('あなたの答え', 'もし僕だったら、あなたは？', this.leftColor, 'left')
        );
        this.choiceContainer.appendChild(
            createBtn('僕の答え', '歌の主人公と同じ道へ', this.rightColor, 'right')
        );

        this.songWrapper.appendChild(this.choiceContainer);
        setTimeout(() => this.choiceContainer.classList.add('visible'), 50);

        const btns = Array.from(this.choiceContainer.querySelectorAll('.kotaete-choice-btn'));
        let focusIdx = -1;

        const choiceKeyHandler = (e) => {
            if (!this.choiceContainer || !this.choiceContainer.parentNode) return;
            if (e.code === 'ArrowLeft') {
                e.preventDefault();
                focusIdx = 0;
                btns[0].focus();
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                focusIdx = 1;
                btns[1].focus();
            } else if ((e.code === 'Space' || e.code === 'Enter') && focusIdx >= 0) {
                e.preventDefault();
                btns[focusIdx].click();
            }
        };

        document.addEventListener('keydown', choiceKeyHandler);

        // Clean up listener when the container is removed
        const observer = new MutationObserver(() => {
            if (!this.choiceContainer || !this.choiceContainer.parentNode) {
                document.removeEventListener('keydown', choiceKeyHandler);
                observer.disconnect();
            }
        });
        observer.observe(this.songWrapper, { childList: true });
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
        if (this._tutorialDismissTimer) clearTimeout(this._tutorialDismissTimer);
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
