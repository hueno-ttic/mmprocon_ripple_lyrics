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
        
        // Container for DOM labels
        this.labelsContainer = document.createElement('div');
        this.labelsContainer.className = 'lake-labels-container';
        this.container.appendChild(this.labelsContainer);
        
        this.labels = []; // Store DOM elements mapping to ripples
        
        this.initLake();
        this.initRipples();
        this.bindEvents();
        
        this.animate = this.animate.bind(this);
        this.animationId = requestAnimationFrame(this.animate);
    }

    initLake() {
        // Add Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 20, 10);
        this.scene.add(directionalLight);

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
                baseColor: { value: new THREE.Color(0x0a1e3f) }, // Dark deep water
                highlightColor: { value: new THREE.Color(0x1E5B94) } // Bright blue highlights
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
        const radius = 3.5; // Slightly larger spread
        
        const rippleVertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
        
        const rippleFragmentShader = `
            uniform vec3 color;
            uniform float time;
            varying vec2 vUv;
            
            void main() {
                float dist = distance(vUv, vec2(0.5));
                // Creates expanding rings
                float wave = sin((dist - time * 0.2) * 30.0);
                float alpha = smoothstep(0.5, 0.0, dist) * (wave * 0.5 + 0.5);
                alpha *= smoothstep(0.5, 0.45, dist); // crisp edge
                
                // Add a glowing core
                float core = smoothstep(0.1, 0.0, dist);
                alpha = max(alpha, core * 0.8);
                
                gl_FragColor = vec4(color, alpha * 0.9);
            }
        `;

        SONGS.forEach((song, i) => {
            const angle = (i / SONGS.length) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            
            const geometry = new THREE.PlaneGeometry(2, 2);
            const isCompleted = appState.isSongComplete(song.id);
            const baseColor = isCompleted ? new THREE.Color(0x888888) : new THREE.Color(song.color);
            
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    color: { value: baseColor },
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

            // Create beautiful DOM label
            const label = document.createElement('div');
            label.className = 'song-label';
            label.innerHTML = `
                <div class="song-title" style="text-shadow: 0 0 15px ${song.color}, 0 2px 4px rgba(0,0,0,0.8);">${song.title}</div>
                <div class="song-artist">${song.artist}</div>
            `;
            this.labelsContainer.appendChild(label);
            
            this.labels.push({
                element: label,
                worldPos: new THREE.Vector3(x, 0.5, z)
            });

            // Make DOM label interactive!
            label.style.pointerEvents = 'auto';
            label.style.cursor = 'pointer';
            
            label.addEventListener('mouseenter', () => {
                label.style.transform = label.style.transform.replace('scale(1)', '') + ' scale(1.1)';
                ripple.material.uniforms.color.value = new THREE.Color(0xffffff);
            });
            
            label.addEventListener('mouseleave', () => {
                label.style.transform = label.style.transform.replace(' scale(1.1)', '');
                ripple.material.uniforms.color.value = baseColor;
            });

            label.addEventListener('click', (e) => {
                e.stopPropagation(); // prevent double trigger if it bubbles to container
                this.selectSong(song, ripple);
            });
        });
    }

    selectSong(song, ripple) {
        console.log(`Selected song: ${song.id}`);
        
        // Visual feedback
        if (ripple) {
            ripple.scale.set(1.5, 1.5, 1.5);
        }
        
        appState.setCurrentSong(song.id);
        this.renderer.domElement.style.display = 'none';
        this.labelsContainer.style.display = 'none';
        eventBus.emit('loadSong', song.songUrl);
    }

    bindEvents() {
        this.boundOnWindowResize = this.onWindowResize.bind(this);
        this.boundOnClick = this.onClick.bind(this);
        this.boundOnMouseMove = this.onMouseMove.bind(this);

        window.addEventListener('resize', this.boundOnWindowResize);
        this.container.addEventListener('click', this.boundOnClick);
        this.container.addEventListener('mousemove', this.boundOnMouseMove);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    onMouseMove(event) {
        if (this.renderer.domElement.style.display === 'none') return;
        
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
        if (this.renderer.domElement.style.display === 'none') return;

        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.ripples);

        if (intersects.length > 0) {
            const songData = intersects[0].object.userData;
            const song = SONGS.find(s => s.id === songData.songId);
            if (song) {
                this.selectSong(song, intersects[0].object);
            }
        }
    }

    show() {
        this.renderer.domElement.style.display = 'block';
        this.labelsContainer.style.display = 'block';
    }

    animate() {
        this.animationId = requestAnimationFrame(this.animate);
        if (this.renderer.domElement.style.display === 'none') return; // Skip if hidden
        
        const time = Date.now() * 0.001;
        
        // Update lake surface
        if (this.lakeMaterial) {
            this.lakeMaterial.uniforms.time.value = time;
        }
        
        // Update ripples shader uniforms
        this.ripples.forEach((ripple, i) => {
            const isCompleted = appState.isSongComplete(ripple.userData.songId);
            if (!isCompleted) {
                ripple.material.uniforms.time.value = time + i * 2.0;
            }
        });
        
        // Update DOM labels projection
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        
        this.labels.forEach((labelData, i) => {
            const pos = labelData.worldPos.clone();
            // Add subtle floating animation
            pos.y += Math.sin(time * 2 + i) * 0.1;
            
            pos.project(this.camera);
            
            // Convert to screen coordinates
            const x = (pos.x * widthHalf) + widthHalf;
            const y = -(pos.y * heightHalf) + heightHalf;
            
            // Apply transform if visible (behind camera z > 1 is handled usually, but Z=0-1 is view frustum)
            if (pos.z < 1) {
                // Ensure we don't overwrite the scale(1.1) from hover
                const isHovered = labelData.element.style.transform.includes('scale(1.1)');
                labelData.element.style.left = `${x}px`;
                labelData.element.style.top = `${y}px`;
                labelData.element.style.transform = `translate(-50%, -50%)` + (isHovered ? ' scale(1.1)' : '');
                labelData.element.style.opacity = '1';
            } else {
                labelData.element.style.opacity = '0';
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
        this.container.removeEventListener('click', this.boundOnClick);
        this.container.removeEventListener('mousemove', this.boundOnMouseMove);
        // Clean up Three.js resources
        this.renderer.dispose();
        
        this.interactiveRipples.forEach(mesh => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        
        if (this.labelsContainer && this.labelsContainer.parentNode) {
            this.labelsContainer.parentNode.removeChild(this.labelsContainer);
        }
    }
}
