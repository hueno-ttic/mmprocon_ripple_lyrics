import * as THREE from 'three';
import { eventBus } from '../core/eventBus.js';
import { SONGS } from '../config/songs.js';
import { appState } from '../core/appState.js';

export class LakeUI {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);
        
        this.camera.position.z = 5;
        this.camera.position.y = 2;
        this.camera.lookAt(0, 0, 0);

        this.ripples = [];
        this.interactiveRipples = [];
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.lastRippleTime = 0;
        this.selectedIndex = 0;          // index of the song currently at the front
        this.currentRotation = Math.PI / 2; // song 0 starts at front (z+)
        this.targetRotation  = Math.PI / 2;
        this.currentBrightness = 0;
        this.targetBrightness = 0;
        
        // Container for DOM labels
        this.labelsContainer = document.createElement('div');
        this.labelsContainer.className = 'lake-labels-container';
        this.container.appendChild(this.labelsContainer);
        
        this.labels = []; // Store DOM elements mapping to ripples
        
        this.initLake();
        this.initRipples();

        // Progress counter
        this.progressCounter = document.createElement('div');
        this.progressCounter.className = 'lake-progress-counter';
        this.labelsContainer.appendChild(this.progressCounter);

        // Apply initial brightness based on already-completed songs
        const completedCount = SONGS.filter(s => appState.isSongComplete(s.id)).length;
        this.targetBrightness = completedCount / SONGS.length;
        this.currentBrightness = this.targetBrightness;
        this._updateProgressCounter();
        this._applyBrightness(this.currentBrightness);

        this.bindEvents();
        
        this.animate = this.animate.bind(this);
        this.animationId = requestAnimationFrame(this.animate);
    }

    initLake() {
        // Background and fog — start very dark; brightened via _applyBrightness()
        this.scene.background = new THREE.Color(0x030508);
        this.scene.fog = new THREE.FogExp2(0x030508, 0.018);

        // Add Lighting — intensity starts low; _applyBrightness() raises it as songs complete
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(this.ambientLight);

        this.dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
        this.dirLight.position.set(10, 20, 10);
        this.scene.add(this.dirLight);

        // Dynamic Lake Shader
        const lakeVertexShader = `
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            void main() {
                vUv = uv;
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `;
        
        const lakeFragmentShader = `
            uniform float time;
            uniform vec3 baseColor;
            uniform vec3 highlightColor;
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            
            // Simple pseudo-random noise
            float hash(vec2 p) { return fract(1e4 * sin(17.0 * p.x + p.y * 0.1) * (0.1 + abs(sin(p.y * 13.0 + p.x)))); }
            float noise(vec2 x) {
                vec2 i = floor(x);
                vec2 f = fract(x);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }

            void main() {
                vec2 uv = vWorldPosition.xz * 0.2;
                
                // Multi-layered animated noise for water surface
                float n = noise(uv + time * 0.2) * 0.5 + 
                          noise(uv * 2.0 - time * 0.3) * 0.25 + 
                          noise(uv * 4.0 + time * 0.1) * 0.125;
                
                // Create caustics / water highlights
                float caustics = smoothstep(0.6, 0.8, n);
                
                vec3 finalColor = mix(baseColor, highlightColor, n * 0.5 + caustics * 0.8);
                
                // Fade out transparency towards horizon
                float dist = length(vWorldPosition);
                float alpha = smoothstep(80.0, 20.0, dist);
                
                gl_FragColor = vec4(finalColor, alpha * 0.9);
            }
        `;

        const geometry = new THREE.PlaneGeometry(200, 200, 64, 64);
        this.lakeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                baseColor: { value: new THREE.Color(0x041030) },    // t=0: very dark
                highlightColor: { value: new THREE.Color(0x0e3d6e) } // t=0: dark highlight
            },
            vertexShader: lakeVertexShader,
            fragmentShader: lakeFragmentShader,
            transparent: true,
            side: THREE.DoubleSide
        });
        
        this.lakePlane = new THREE.Mesh(geometry, this.lakeMaterial);
        this.lakePlane.rotation.x = -Math.PI / 2;
        this.lakePlane.position.y = -0.1; // Ensure it's below ripples
        this.scene.add(this.lakePlane);
        
        this.initFuji();
    }

    initFuji() {
        // Procedurally generate Mount Fuji using ConeGeometry and a custom ShaderMaterial
        const fujiGeo = new THREE.ConeGeometry(40, 25, 64);
        const fujiMat = new THREE.ShaderMaterial({
            uniforms: {
                colorSnow: { value: new THREE.Color(0xFFFFFF) },
                colorBase: { value: new THREE.Color(0x2B5A8B) }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 colorSnow;
                uniform vec3 colorBase;
                varying vec2 vUv;
                
                // Simple pseudo-random noise
                float random(vec2 st) {
                    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                }
                
                void main() {
                    // vUv.y is 0 at bottom, 1 at tip
                    // Add noise to the snowline
                    float noise = random(vUv * 50.0) * 0.1;
                    float snowLine = 0.6 + noise;
                    float mixValue = smoothstep(snowLine - 0.1, snowLine + 0.1, vUv.y);
                    
                    gl_FragColor = vec4(mix(colorBase, colorSnow, mixValue), 1.0);
                }
            `,
            transparent: true
        });
        
        this.fuji = new THREE.Mesh(fujiGeo, fujiMat);
        this.fuji.position.set(0, 8, -60);
        this.scene.add(this.fuji);

        // Add some smaller background mountains
        const mountainMat = new THREE.MeshBasicMaterial({ color: 0x1A4068 });
        for (let i = 0; i < 5; i++) {
            const mGeo = new THREE.ConeGeometry(20 + Math.random() * 10, 10 + Math.random() * 10, 16);
            const mMtx = new THREE.Mesh(mGeo, mountainMat);
            mMtx.position.set((Math.random() - 0.5) * 120, 2, -55 + Math.random() * 10);
            this.scene.add(mMtx);
        }
    }

    initRipples() {
        const radius = 3.5;

        const rippleVertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        // Three expanding concentric rings — each offset by 1/3 period
        const rippleFragmentShader = `
            uniform vec3 color;
            uniform float time;
            varying vec2 vUv;

            void main() {
                vec2 center = vUv - 0.5;
                float dist = length(center);

                float edge = smoothstep(0.5, 0.42, dist);

                float alpha = 0.0;

                float r1 = fract(dist * 5.0 - time * 0.22);
                alpha += (smoothstep(0.12, 0.0, r1) + smoothstep(0.88, 1.0, r1) * 0.25) * 0.9;

                float r2 = fract(dist * 5.0 - time * 0.22 + 0.333);
                alpha += (smoothstep(0.12, 0.0, r2) + smoothstep(0.88, 1.0, r2) * 0.25) * 0.6;

                float r3 = fract(dist * 5.0 - time * 0.22 + 0.666);
                alpha += (smoothstep(0.12, 0.0, r3) + smoothstep(0.88, 1.0, r3) * 0.25) * 0.4;

                alpha *= smoothstep(0.5, 0.04, dist);
                alpha = clamp(alpha, 0.0, 1.0);

                float core = smoothstep(0.1, 0.0, dist);
                alpha = max(alpha, core * 0.9);

                gl_FragColor = vec4(color, alpha * edge * 0.9);
            }
        `;

        SONGS.forEach((song, i) => {
            const angle = (i / SONGS.length) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;

            const geometry = new THREE.PlaneGeometry(3, 3);
            const isCompleted = appState.isSongComplete(song.id);
            const initialColor = isCompleted ? new THREE.Color(0xD4AF37) : new THREE.Color(song.color);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    color: { value: initialColor.clone() },
                    time: { value: 0 }
                },
                vertexShader: rippleVertexShader,
                fragmentShader: rippleFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            const ripple = new THREE.Mesh(geometry, material);
            ripple.rotation.x = -Math.PI / 2;
            ripple.position.set(x, 0.05, z);
            ripple.userData = { songId: song.id, songUrl: song.songUrl };

            this.scene.add(ripple);
            this.ripples.push(ripple);

            // Create DOM label
            const completeMark = isCompleted
                ? `<span class="complete-mark" style="color:#D4AF37;margin-left:5px;filter:drop-shadow(0 0 4px #D4AF37)">✓</span>`
                : '';
            const label = document.createElement('div');
            label.className = 'song-label';
            label.innerHTML = `
                <div class="song-title" style="text-shadow: 0 0 15px ${song.color}, 0 2px 4px rgba(0,0,0,0.8);">
                    ${song.title}${completeMark}
                </div>
                <div class="song-artist">${song.artist}</div>
            `;
            this.labelsContainer.appendChild(label);

            // Ripple anchor sits at the water surface (y=0) — independent of the floating label
            const rippleAnchor = document.createElement('div');
            rippleAnchor.className = 'song-ripple-anchor';
            rippleAnchor.innerHTML = `
                <div class="song-ripple-indicator" style="color:${isCompleted ? '#D4AF37' : song.color}">
                    <span></span><span></span><span></span>
                </div>`;
            if (isCompleted) {
                rippleAnchor.style.display = 'none';
            }
            this.labelsContainer.appendChild(rippleAnchor);

            const rippleIndicator = rippleAnchor.querySelector('.song-ripple-indicator');

            // labelData holds mutable baseColor so hover/complete updates stay in sync
            const labelData = {
                element: label,
                rippleAnchor,
                rippleIndicator,
                rippleSpans: Array.from(rippleIndicator.querySelectorAll('span')),
                baseAngle: (i / SONGS.length) * Math.PI * 2,
                worldPos: new THREE.Vector3(x, 0.5, z),
                surfacePos: new THREE.Vector3(x, 0, z),
                baseColor: initialColor.clone(),
                _hovered: false,
            };
            this.labels.push(labelData);

            label.style.pointerEvents = 'auto';
            label.style.cursor = 'pointer';

            label.addEventListener('mouseenter', () => {
                label.classList.add('song-label--hovered');
                labelData._hovered = true;
            });

            label.addEventListener('mouseleave', () => {
                label.classList.remove('song-label--hovered');
                labelData._hovered = false;
            });

            label.addEventListener('click', (e) => {
                e.stopPropagation();
                if (i === this.selectedIndex) {
                    this.selectSong(song, ripple);
                } else {
                    this._rotateToSong(i);
                }
            });
        });

        // Keyboard navigation guide is removed as requested by the user

        this._createSoftButtons();
    }

    selectSong(song, ripple) {
        console.log(`Selected song: ${song.id}`);

        if (ripple) ripple.scale.set(1.5, 1.5, 1.5);

        appState.setCurrentSong(song.id);
        this.renderer.domElement.style.display = 'none';
        this.labelsContainer.style.display = 'none';
        if (this.softBtnContainer) this.softBtnContainer.style.display = 'none';
        eventBus.emit('loadSong', song);
    }

    bindEvents() {
        this.boundOnWindowResize = this.onWindowResize.bind(this);
        this.boundOnClick = this.onClick.bind(this);
        this.boundOnMouseMove = this.onMouseMove.bind(this);
        this.boundOnKeyDown = this.onKeyDown.bind(this);
        this.boundOnSongComplete = this.onSongComplete.bind(this);

        window.addEventListener('resize', this.boundOnWindowResize);
        window.addEventListener('keydown', this.boundOnKeyDown);
        this.container.addEventListener('click', this.boundOnClick);
        this.container.addEventListener('mousemove', this.boundOnMouseMove);
        eventBus.on('songComplete', this.boundOnSongComplete);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        // ripple angles are recomputed every frame in animate()
    }
    
    onMouseMove(event) {
        if (appState.currentSongId !== null || this.renderer.domElement.style.display === 'none') return;
        
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Raycast to lake plane to spawn temporary ripples
        const now = Date.now();
        if (now - this.lastRippleTime > 100) {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObject(this.lakePlane);
            if (intersects.length > 0) {
                this.spawnTemporaryRipple(intersects[0].point.x, intersects[0].point.z);
                this.lastRippleTime = now;
            }
        }
    }
    
    spawnTemporaryRipple(x, z) {
        const geo = new THREE.RingGeometry(0.1, 0.2, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, -0.4, z);
        mesh.userData = { birth: Date.now() };
        this.scene.add(mesh);
        this.interactiveRipples.push(mesh);
    }

    onClick(event) {
        if (appState.currentSongId !== null || this.renderer.domElement.style.display === 'none') return;
        // Ignore clicks that originate from the soft nav buttons
        if (event.target.closest('.lake-soft-btn')) return;

        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.ripples);

        if (intersects.length > 0) {
            const idx = this.ripples.indexOf(intersects[0].object);
            if (idx === this.selectedIndex) {
                this.selectSong(SONGS[idx], intersects[0].object);
            } else {
                this._rotateToSong(idx);
            }
        }
    }

    show() {
        this.renderer.domElement.style.display = 'block';
        this.labelsContainer.style.display = 'block';
        if (this.softBtnContainer) this.softBtnContainer.style.display = 'flex';
    }

    onKeyDown(e) {
        if (appState.currentSongId !== null || this.renderer.domElement.style.display === 'none') return;
        const N = SONGS.length;
        if (e.code === 'ArrowRight') {
            e.preventDefault();
            this.selectedIndex = (this.selectedIndex - 1 + N) % N;
            this.targetRotation += (2 * Math.PI / N);
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            this.selectedIndex = (this.selectedIndex + 1) % N;
            this.targetRotation -= (2 * Math.PI / N);
        } else if (e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            this.selectSong(SONGS[this.selectedIndex], this.ripples[this.selectedIndex]);
        }
    }

    _rotateToSong(targetIndex) {
        const N = SONGS.length;
        let steps = ((targetIndex - this.selectedIndex) % N + N) % N;
        if (steps > N / 2) steps -= N; // take the shorter arc
        this.targetRotation -= steps * (2 * Math.PI / N);
        this.selectedIndex = targetIndex;
    }

    _createSoftButtons() {
        this.softBtnContainer = document.createElement('div');
        this.softBtnContainer.className = 'lake-soft-buttons';
        this.softBtnContainer.innerHTML = `
            <button class="lake-soft-btn lake-soft-btn--prev" aria-label="前の曲">&#9664;</button>
            <button class="lake-soft-btn lake-soft-btn--next" aria-label="次の曲">&#9654;</button>
        `;
        this.container.appendChild(this.softBtnContainer);

        const N = SONGS.length;
        this.softBtnContainer.querySelector('.lake-soft-btn--prev').addEventListener('click', () => {
            this.selectedIndex = (this.selectedIndex + 1) % N;
            this.targetRotation -= (2 * Math.PI / N);
        });
        this.softBtnContainer.querySelector('.lake-soft-btn--next').addEventListener('click', () => {
            this.selectedIndex = (this.selectedIndex - 1 + N) % N;
            this.targetRotation += (2 * Math.PI / N);
        });
    }

    _applyBrightness(t) {
        // t: 0 = moonless night, 1 = clear dawn — lerps lights, lake colors, fog, background
        if (this.ambientLight) this.ambientLight.intensity = 0.3 + t * 1.2;
        if (this.dirLight)     this.dirLight.intensity     = 0.5 + t * 1.3;

        if (this.lakeMaterial) {
            // baseColor: #041030 → #1a4070
            this.lakeMaterial.uniforms.baseColor.value.setRGB(
                0.016 + t * 0.087,
                0.063 + t * 0.19,
                0.188 + t * 0.25
            );
            // highlightColor: #0e3d6e → #3a87c0
            this.lakeMaterial.uniforms.highlightColor.value.setRGB(
                0.055 + t * 0.175,
                0.239 + t * 0.29,
                0.431 + t * 0.32
            );
        }

        if (this.scene.fog)        this.scene.fog.density = 0.018 - t * 0.012;
        if (this.scene.background) this.scene.background.setRGB(
            0.012 + t * 0.038,
            0.020 + t * 0.105,
            0.031 + t * 0.22
        );
    }

    _updateProgressCounter() {
        if (!this.progressCounter) return;
        const completed = SONGS.filter(s => appState.isSongComplete(s.id)).length;
        const total = SONGS.length;
        this.progressCounter.textContent = `${completed} / ${total}`;
        this.progressCounter.title = `${completed}曲クリア済み`;
    }

    onSongComplete(songId) {
        const idx = SONGS.findIndex(s => s.id === songId);
        if (idx < 0 || idx >= this.labels.length) return;

        const goldColor = new THREE.Color(0xD4AF37);
        this.labels[idx].baseColor = goldColor.clone();
        this.ripples[idx].material.uniforms.color.value = goldColor.clone();

        if (this.labels[idx].rippleIndicator) {
            this.labels[idx].rippleIndicator.style.color = '#D4AF37';
        }

        // Hide the DOM ripple anchor for completed songs to prevent doubling
        if (this.labels[idx].rippleAnchor) {
            this.labels[idx].rippleAnchor.style.display = 'none';
        }

        const titleEl = this.labels[idx].element.querySelector('.song-title');
        if (titleEl && !titleEl.querySelector('.complete-mark')) {
            const mark = document.createElement('span');
            mark.className = 'complete-mark';
            mark.textContent = '✓';
            mark.style.cssText = 'color:#D4AF37; margin-left:5px; filter:drop-shadow(0 0 4px #D4AF37);';
            titleEl.appendChild(mark);
        }

        // Gradually brighten the scene with each completion
        const completedCount = SONGS.filter(s => appState.isSongComplete(s.id)).length;
        this.targetBrightness = completedCount / SONGS.length;
        this._updateProgressCounter();
    }

    animate() {
        this.animationId = requestAnimationFrame(this.animate);
        if (this.renderer.domElement.style.display === 'none') return; // Skip if hidden
        
        const time = Date.now() * 0.001;

        // Smoothly lerp toward target brightness (each completed song brightens the scene)
        if (Math.abs(this.currentBrightness - this.targetBrightness) > 0.0005) {
            this.currentBrightness += (this.targetBrightness - this.currentBrightness) * 0.005;
            this._applyBrightness(this.currentBrightness);
        }

        // Update lake surface
        if (this.lakeMaterial) {
            this.lakeMaterial.uniforms.time.value = time;
        }
        
        // Carousel rotation lerp
        this.currentRotation += (this.targetRotation - this.currentRotation) * 0.07;

        const N = SONGS.length;
        const radius = 3.5;

        // Update song world positions based on current rotation
        this.labels.forEach((labelData, i) => {
            const actualAngle = labelData.baseAngle + this.currentRotation;
            const wx = Math.cos(actualAngle) * radius;
            const wz = Math.sin(actualAngle) * radius;

            this.ripples[i].position.set(wx, 0.05, wz);
            labelData.worldPos.set(wx, 0.5, wz);
            labelData.surfacePos.set(wx, 0, wz);

            // Ripple shader time + color
            const isCompleted = appState.isSongComplete(this.ripples[i].userData.songId);
            if (!isCompleted) this.ripples[i].material.uniforms.time.value = time + i * 2.0;

            this.ripples[i].material.uniforms.color.value.copy(labelData.baseColor);
        });

        // DOM label projection + depth scale/opacity
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;

        this.labels.forEach((labelData, i) => {
            const wx = labelData.worldPos.x;
            const wz = labelData.worldPos.z;

            // Depth factor: wz ranges [-radius, +radius]; front (wz=+radius) → t=1
            const t = (wz + radius) / (2 * radius);
            const depthScale   = 0.55 + t * 0.55;  // 0.55(back) → 1.1(front)
            const depthOpacity = 0.2  + t * 0.8;   // 0.2(back)  → 1.0(front)

            // baseCycle: 0 at label's lowest point, 0.5 at highest — synced with ripple sawtooth
            const baseCycle = ((time * 2 + i + Math.PI / 2) / (2 * Math.PI)) % 1;

            // Floating label position driven by same cycle as ripple
            const pos = labelData.worldPos.clone();
            pos.y += -Math.cos(baseCycle * 2 * Math.PI) * 0.1;
            pos.project(this.camera);
            const x = (pos.x * widthHalf) + widthHalf;
            const y = -(pos.y * heightHalf) + heightHalf;

            if (pos.z < 1) {
                const padX   = Math.max(40, window.innerWidth * 0.07);
                const padTop = 50;
                const padBot = 120; // clear soft buttons + play bar
                const cx = Math.max(padX, Math.min(window.innerWidth  - padX, x));
                const cy = Math.max(padTop, Math.min(window.innerHeight - padBot, y));

                const finalScale = depthScale * (labelData._hovered ? 1.12 : 1.0);
                labelData.element.style.left      = `${cx}px`;
                labelData.element.style.top       = `${cy}px`;
                labelData.element.style.transform = `translate(-50%, -50%) scale(${finalScale})`;
                labelData.element.style.opacity   = depthOpacity.toFixed(3);

                if (i === this.selectedIndex) {
                    labelData.element.classList.add('song-label--front');
                } else {
                    labelData.element.classList.remove('song-label--front');
                }

                // Ripple anchor: clamp Y so front songs don't fall behind nav buttons
                const surfNdc = labelData.surfacePos.clone().project(this.camera);
                const sx  = (surfNdc.x * widthHalf) + widthHalf;
                const sy  = -(surfNdc.y * heightHalf) + heightHalf;
                const safeSY = Math.min(sy, window.innerHeight - 150);
                labelData.rippleAnchor.style.left    = `${sx}px`;
                labelData.rippleAnchor.style.top     = `${safeSY}px`;
                labelData.rippleAnchor.style.opacity = depthOpacity.toFixed(3);

                // Depth-based sizing — front: large, back: small, aspect 3.5:1 = flat ellipse.
                // Opacity uses pow curve so rings stay bright longer then fade quickly.
                const maxW = Math.max(180 * depthScale, 30);
                const maxH = Math.max(maxW * 0.285, 6);

                labelData.rippleIndicator.style.width     = `${maxW}px`;
                labelData.rippleIndicator.style.height    = `${maxH}px`;
                labelData.rippleIndicator.style.transform = ''; // always horizontal

                labelData.rippleSpans.forEach((span, si) => {
                    const p = (baseCycle + si / 3) % 1;
                    span.style.width   = `${p * maxW}px`;
                    span.style.height  = `${p * maxH}px`;
                    span.style.opacity = (Math.pow(1 - p, 0.6) * 0.95).toFixed(3);
                });
            } else {
                labelData.element.style.opacity      = '0';
                labelData.rippleAnchor.style.opacity = '0';
            }
        });
        
        // Animate interactive ripples
        for (let i = this.interactiveRipples.length - 1; i >= 0; i--) {
            const mesh = this.interactiveRipples[i];
            const age = Date.now() - mesh.userData.birth;
            mesh.scale.setScalar(1 + age * 0.005);
            mesh.material.opacity = 0.5 - (age / 1000) * 0.5;
            if (age > 1000) {
                this.scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
                this.interactiveRipples.splice(i, 1);
            }
        }

        this.renderer.render(this.scene, this.camera);
    }
    
    destroy() {
        cancelAnimationFrame(this.animationId);
        window.removeEventListener('resize', this.boundOnWindowResize);
        window.removeEventListener('keydown', this.boundOnKeyDown);
        this.container.removeEventListener('click', this.boundOnClick);
        this.container.removeEventListener('mousemove', this.boundOnMouseMove);
        eventBus.off('songComplete', this.boundOnSongComplete);
        // Clean up Three.js resources
        this.renderer.dispose();
        
        this.interactiveRipples.forEach(mesh => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        
        if (this.labelsContainer && this.labelsContainer.parentNode) {
            this.labelsContainer.parentNode.removeChild(this.labelsContainer);
        }
        if (this.softBtnContainer && this.softBtnContainer.parentNode) {
            this.softBtnContainer.parentNode.removeChild(this.softBtnContainer);
        }
    }
}
