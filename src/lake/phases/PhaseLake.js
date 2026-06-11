import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import { appState } from '../../core/appState.js';
import { createSkyDome } from './SkyDome.js';
import { getGlowTexture } from './glowTexture.js';
import {
    createSunflower, createCumulusCloud, createBroadleafTree,
    createMountainRange, createBirdFlock, updateBirdFlock, swayItems,
} from './NatureKit.js';

// Phase 6「湖」— the journey's end, in full summer. Blue sky, cumulus
// clouds, Mt. Fuji across the sparkling water, and sunflowers blooming
// on the shore (Magical Mirai 2026 motif, rebuilt procedurally).
export class PhaseLake extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildSky();
        this._buildLake();
        this._buildFuji();
        this._buildShore();
        this._buildSparkles();
        this._buildLighting();
    }

    _buildSky() {
        this.sky = createSkyDome({
            top: '#2E86D8',
            horizon: '#AEE0F8',
            bottom: '#8FD0F4',
        });
        this.group.add(this.sky);

        const sunMat = new THREE.SpriteMaterial({
            map: getGlowTexture(),
            color: 0xFFF8D8,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.sun = new THREE.Sprite(sunMat);
        this.sun.position.set(14, 18, -34);
        this.sun.scale.set(16, 16, 1);
        this.group.add(this.sun);

        // Summer cumulus drifting high above the mountains
        this.clouds = [];
        const cloudSpots = [[-26, 15, -55], [14, 17, -60], [34, 13, -50]];
        cloudSpots.forEach(([x, y, z]) => {
            const cloud = createCumulusCloud(1.6 + Math.random() * 0.8);
            cloud.position.set(x, y, z);
            this.group.add(cloud);
            this.clouds.push(cloud);
        });
    }

    _buildLake() {
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
                float n = noise(uv + time * 0.2) * 0.5 +
                          noise(uv * 2.0 - time * 0.3) * 0.25 +
                          noise(uv * 4.0 + time * 0.1) * 0.125;
                float caustics = smoothstep(0.55, 0.8, n);
                vec3 finalColor = mix(baseColor, highlightColor, n * 0.55 + caustics * 0.7);
                float dist = length(vWorldPosition);
                float alpha = smoothstep(90.0, 25.0, dist);
                gl_FragColor = vec4(finalColor, alpha * 0.95);
            }
        `;

        const geometry = new THREE.PlaneGeometry(220, 220, 64, 64);
        this.lakeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                baseColor: { value: new THREE.Color(0x3E92D8) },
                highlightColor: { value: new THREE.Color(0x9EDCF8) },
            },
            vertexShader: lakeVertexShader,
            fragmentShader: lakeFragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
        });

        this.lakePlane = new THREE.Mesh(geometry, this.lakeMaterial);
        this.lakePlane.rotation.x = -Math.PI / 2;
        this.lakePlane.position.y = -0.1;
        this.group.add(this.lakePlane);
    }

    _buildFuji() {
        const fujiGeo = new THREE.ConeGeometry(40, 25, 64);
        const fujiMat = new THREE.ShaderMaterial({
            uniforms: {
                colorSnow: { value: new THREE.Color(0xFFFFFF) },
                colorBase: { value: new THREE.Color(0x3E6E9E) },
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
                float random(vec2 st) {
                    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                }
                void main() {
                    float noise = random(vUv * 50.0) * 0.08;
                    // Summer Fuji: only the very peak keeps its snow
                    float snowLine = 0.78 + noise;
                    float mixValue = smoothstep(snowLine - 0.08, snowLine + 0.08, vUv.y);
                    gl_FragColor = vec4(mix(colorBase, colorSnow, mixValue), 1.0);
                }
            `,
        });

        this.fuji = new THREE.Mesh(fujiGeo, fujiMat);
        this.fuji.position.set(0, 6, -78);
        this.fuji.scale.set(0.85, 0.85, 0.85);
        this.group.add(this.fuji);

        this.group.add(createMountainRange({
            count: 6, distance: 48, spread: 130,
            color: 0x5E8AB6, height: 11,
        }));
    }

    _buildShore() {
        // Green banks flanking the view, crowded with sunflowers
        const bankMat = new THREE.MeshLambertMaterial({ color: 0x4E8E55 });
        [[-4.8, 1.2], [4.8, 1.2]].forEach(([x, z]) => {
            const bank = new THREE.Mesh(new THREE.CircleGeometry(2.8, 24), bankMat);
            bank.rotation.x = -Math.PI / 2;
            bank.position.set(x, -0.04, z);
            this.group.add(bank);
        });

        this.sway = [];
        const planted = [];
        const plantCluster = (cx, cz, count) => {
            for (let i = 0; i < count; i++) {
                const a = Math.random() * Math.PI * 2;
                const r = Math.random() * 2.4;
                const x = cx + Math.cos(a) * r * 0.75;
                const z = cz + Math.sin(a) * r * 0.5;
                const flower = createSunflower(1.4 + Math.random() * 0.7);
                flower.position.set(x, -0.04, z);
                this.group.add(flower);
                this.sway.push({ obj: flower, seed: Math.random() * 10 });
                planted.push(flower);
            }
        };
        const perCluster = window.innerWidth < 768 ? 12 : 20;
        plantCluster(-4.8, 1.2, perCluster);
        plantCluster(4.8, 1.2, perCluster);

        // Far shore: a green line with summer trees beneath the mountains
        const farShore = new THREE.Mesh(
            new THREE.PlaneGeometry(180, 10),
            new THREE.MeshLambertMaterial({ color: 0x3E7C4A })
        );
        farShore.rotation.x = -Math.PI / 2;
        farShore.position.set(0, -0.05, -30);
        this.group.add(farShore);
        for (let i = 0; i < 9; i++) {
            const tree = createBroadleafTree(2.0 + Math.random() * 1.2);
            tree.position.set(-32 + i * 8 + (Math.random() - 0.5) * 3, -0.05, -29 - Math.random() * 3);
            this.group.add(tree);
            this.sway.push({ obj: tree, seed: Math.random() * 10 });
        }

        this.birds = createBirdFlock(5, 0x2A3640);
        this.group.add(this.birds);
    }

    _buildSparkles() {
        // Sunlight glittering across the lake
        const count = window.innerWidth < 768 ? 40 : 80;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = 4 + Math.random() * 16;
            positions[i * 3] = Math.cos(a) * r;
            positions[i * 3 + 1] = 0.02;
            positions[i * 3 + 2] = Math.sin(a) * r - 4;
            seeds[i] = Math.random();
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
            },
            vertexShader: `
                attribute float aSeed;
                uniform float uTime;
                uniform float uPixelRatio;
                varying float vTwinkle;
                void main() {
                    vTwinkle = pow(abs(sin(uTime * (1.2 + aSeed * 1.8) + aSeed * 30.0)), 3.0);
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = (2.0 + vTwinkle * 3.0) * uPixelRatio;
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vTwinkle;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    gl_FragColor = vec4(1.0, 1.0, 0.95, smoothstep(0.5, 0.0, d) * vTwinkle * 0.85);
                }
            `,
        });
        this.sparkles = new THREE.Points(geo, mat);
        this.group.add(this.sparkles);
    }

    _buildLighting() {
        this.group.add(new THREE.HemisphereLight(0xFFFFFF, 0x6E9A78, 1.25));
        const sunLight = new THREE.DirectionalLight(0xFFF4D8, 1.1);
        sunLight.position.set(14, 18, -10);
        this.group.add(sunLight);
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xAEE0F8);
        this.scene.fog = new THREE.FogExp2(0xA5D8F0, 0.006);
        this.camera.position.set(0, 3.6, 9);
        this.camera.lookAt(0, 0.2, -2);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        this.songMarkers = [];
        const radius = 3.5;

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
                vec2 center = vUv - 0.5;
                float dist = length(center);
                float edge = smoothstep(0.5, 0.42, dist);
                // Crisp expanding rings — no soft area glow that would
                // blur into an orange blob in daylight
                float alpha = 0.0;
                float r1 = fract(dist * 4.0 - time * 0.2);
                alpha += smoothstep(0.1, 0.05, r1) * smoothstep(0.0, 0.05, r1) * 0.95;
                float r2 = fract(dist * 4.0 - time * 0.2 + 0.5);
                alpha += smoothstep(0.1, 0.05, r2) * smoothstep(0.0, 0.05, r2) * 0.6;
                alpha *= smoothstep(0.5, 0.15, dist);
                float core = smoothstep(0.05, 0.0, dist);
                alpha = max(alpha, core);
                gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0) * edge * 0.95);
            }
        `;

        songs.forEach((song, i) => {
            const angle = (i / songs.length) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;

            const isCompleted = appState.isSongComplete(song.id);
            const color = isCompleted ? new THREE.Color(0xC89E20) : new THREE.Color(song.color);

            const geometry = new THREE.PlaneGeometry(3, 3);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    color: { value: color.clone() },
                    time: { value: 0 },
                },
                vertexShader: rippleVertexShader,
                fragmentShader: rippleFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const ripple = new THREE.Mesh(geometry, material);
            ripple.rotation.x = -Math.PI / 2;
            ripple.position.set(x, 0.05, z);
            ripple.userData = { songId: song.id, baseAngle: (i / songs.length) * Math.PI * 2 };

            this.group.add(ripple);
            this.songMarkers.push(ripple);
        });

        this.currentRotation = Math.PI / 2;
        this.targetRotation = Math.PI / 2;
    }

    getSongPosition(index) {
        if (this.songMarkers[index]) {
            const m = this.songMarkers[index];
            return new THREE.Vector3(m.position.x, 0.5, m.position.z);
        }
        return new THREE.Vector3(0, 0.5, 0);
    }

    onHover(index) {}
    onUnhover(index) {}

    onSelect(index) {
        const marker = this.songMarkers[index];
        if (marker) marker.scale.set(1.5, 1.5, 1.5);
    }

    update(time) {
        if (this.disposed) return;
        if (this.lakeMaterial) {
            this.lakeMaterial.uniforms.time.value = time;
        }
        this.sparkles.material.uniforms.uTime.value = time;
        swayItems(this.sway, time, 0.03, 1.1);
        updateBirdFlock(this.birds, time);

        this.clouds.forEach((c, i) => {
            c.position.x += Math.sin(time * 0.05 + i * 2.0) * 0.004;
        });

        // Carousel rotation (managed by WorldUI)
        if (this.currentRotation !== undefined) {
            this.currentRotation += (this.targetRotation - this.currentRotation) * 0.07;
            const radius = 3.5;
            this.songMarkers.forEach((marker, i) => {
                const angle = marker.userData.baseAngle + this.currentRotation;
                const x = Math.cos(angle) * radius;
                const z = Math.sin(angle) * radius;
                marker.position.set(x, 0.05, z);
                marker.material.uniforms.time.value = time + i * 2.0;
            });
        }
    }
}
