import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import { getGlowTexture } from './glowTexture.js';
import { createSkyDome } from './SkyDome.js';
import {
    createBroadleafTree, createConifer, createGrassTuft, createRock,
    createMountainRange, createBirdFlock, updateBirdFlock, swayItems,
} from './NatureKit.js';

// Phase 5「川」— brooks have joined into a wide, powerful river flowing
// under a blue sky. Foam streaks make the strong current unmistakable.
export class PhaseRiver extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildSky();
        this._buildRiver();
        this._buildBanks();
        this._buildFoam();
        this._buildLighting();
    }

    _buildSky() {
        this.sky = createSkyDome({
            top: '#2E5E9E',
            horizon: '#A2C8E8',
            bottom: '#4E7298',
        });
        this.group.add(this.sky);
    }

    _buildRiver() {
        const geo = new THREE.PlaneGeometry(26, 9, 64, 16);
        const mat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                varying vec2 vUv;
                uniform float uTime;
                void main() {
                    vUv = uv;
                    vec3 pos = position;
                    pos.z += sin(pos.x * 1.5 + uTime * 2.2) * 0.09;
                    pos.z += cos(pos.x * 0.7 + uTime * 1.4) * 0.06;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec2 vUv;
                float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
                void main() {
                    // Fast, visible current
                    float flow = fract(vUv.x * 6.0 - uTime * 0.55);
                    float n = hash(floor(vUv * 36.0 + floor(uTime * 2.0) * 0.1));
                    float highlight = smoothstep(0.3, 0.5, flow) * smoothstep(0.7, 0.5, flow);

                    vec3 deepColor = vec3(0.08, 0.25, 0.48);
                    vec3 surfaceColor = vec3(0.30, 0.55, 0.82);
                    vec3 color = mix(deepColor, surfaceColor, highlight * 0.7 + n * 0.12);

                    float edge = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
                    gl_FragColor = vec4(color, edge * 0.95);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        this.riverMesh = new THREE.Mesh(geo, mat);
        this.riverMesh.rotation.x = -Math.PI / 2;
        this.riverMesh.position.y = -0.05;
        this.group.add(this.riverMesh);
    }

    _buildBanks() {
        const mat = new THREE.MeshLambertMaterial({ color: 0x35523A });
        const far = new THREE.Mesh(new THREE.PlaneGeometry(160, 60), mat);
        far.rotation.x = -Math.PI / 2;
        far.position.set(0, -0.15, -34);
        this.group.add(far);
        const near = new THREE.Mesh(new THREE.PlaneGeometry(160, 60), mat);
        near.rotation.x = -Math.PI / 2;
        near.position.set(0, -0.15, 34);
        this.group.add(near);

        // Forested banks on both sides
        this.sway = [];
        const farTrees = [-11, -8, -5, -1.5, 2, 5.5, 9, 12];
        farTrees.forEach((x) => {
            const tree = Math.random() < 0.4
                ? createConifer(1.8 + Math.random() * 1.0)
                : createBroadleafTree(1.6 + Math.random() * 1.0);
            tree.position.set(x + (Math.random() - 0.5) * 1.5, -0.15, -5.5 - Math.random() * 2.5);
            this.group.add(tree);
            this.sway.push({ obj: tree, seed: Math.random() * 10 });
        });
        const nearTrees = [-10, -4, 3, 10];
        nearTrees.forEach((x) => {
            const tree = createBroadleafTree(1.8 + Math.random() * 0.8);
            tree.position.set(x + (Math.random() - 0.5) * 2, -0.15, 6 + Math.random() * 2);
            this.group.add(tree);
            this.sway.push({ obj: tree, seed: Math.random() * 10 });
        });

        // Boulders rising out of the current
        const boulderSpots = [[-5.5, 1.5], [2.5, -1.8], [7, 0.8]];
        boulderSpots.forEach(([x, z]) => {
            const rock = createRock(2.6, 0x6A727C);
            rock.position.set(x, -0.05, z);
            this.group.add(rock);
        });
        // Smaller rocks scattered along the waterline
        for (let i = 0; i < 10; i++) {
            const rock = createRock(1.1, 0x6E767E);
            const side = Math.random() < 0.5 ? 1 : -1;
            rock.position.set((Math.random() - 0.5) * 22, -0.12, side * (4.6 + Math.random() * 1.2));
            this.group.add(rock);
        }
        for (let i = 0; i < 18; i++) {
            const tuft = createGrassTuft(1.1, 0x46784E);
            const side = Math.random() < 0.5 ? 1 : -1;
            tuft.position.set((Math.random() - 0.5) * 24, -0.14, side * (5 + Math.random() * 2.5));
            this.group.add(tuft);
        }

        this.group.add(createMountainRange({
            count: 7, distance: 55, spread: 110,
            color: 0x54749E, height: 13,
        }));

        this.birds = createBirdFlock(6, 0x2A3640);
        this.group.add(this.birds);
    }

    _buildFoam() {
        // White foam streaks riding the current
        const count = window.innerWidth < 768 ? 80 : 160;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 24;
            positions[i * 3 + 1] = 0.05 + Math.random() * 0.08;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 7;
            speeds[i] = 1.6 + Math.random() * 2.4;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
            },
            vertexShader: `
                attribute float speed;
                uniform float uTime;
                uniform float uPixelRatio;
                varying float vAlpha;
                void main() {
                    vec3 pos = position;
                    pos.x = mod(pos.x + uTime * speed, 24.0) - 12.0;
                    vAlpha = 0.35 + speed * 0.12;
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = (2.5 + speed) * uPixelRatio;
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
                    gl_FragColor = vec4(0.95, 0.98, 1.0, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.foam = new THREE.Points(geo, mat);
        this.group.add(this.foam);
    }

    _buildLighting() {
        this.group.add(new THREE.HemisphereLight(0xD8E8F8, 0x35523A, 1.1));
        const dir = new THREE.DirectionalLight(0xFFF8E8, 0.8);
        dir.position.set(8, 12, 5);
        this.group.add(dir);
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xA2C8E8);
        this.scene.fog = new THREE.FogExp2(0x98BCD8, 0.007);
        this.camera.position.set(-2, 3.5, 8);
        this.camera.lookAt(2, 0, 0);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        this.songMarkers = [];
        songs.forEach((song, i) => {
            const x = -8 + (i / (songs.length - 1)) * 16;
            const z = Math.sin(x * 0.3) * 0.8;

            const markerGroup = new THREE.Group();
            markerGroup.position.set(x, 0.3, z);

            const sphereGeo = new THREE.SphereGeometry(0.2, 16, 12);
            const sphereMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(song.color),
            });
            markerGroup.add(new THREE.Mesh(sphereGeo, sphereMat));

            const spriteMat = new THREE.SpriteMaterial({
                map: getGlowTexture(),
                color: new THREE.Color(song.color),
                transparent: true,
                opacity: 0.55,
                blending: THREE.NormalBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.scale.set(1.0, 1.0, 1);
            markerGroup.add(sprite);

            markerGroup.userData = {
                songId: song.id,
                baseX: x,
                baseZ: z,
                sprite,
                spriteMat,
                sphereMat,
            };

            this.group.add(markerGroup);
            this.songMarkers.push(markerGroup);
        });
    }

    getSongPosition(index) {
        if (this.songMarkers[index]) {
            const m = this.songMarkers[index];
            return new THREE.Vector3(m.position.x, m.position.y + 0.85, m.position.z);
        }
        return new THREE.Vector3(0, 1, 0);
    }

    onHover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 0.9;
        marker.userData.sprite.scale.set(1.4, 1.4, 1);
        marker.scale.set(1.25, 1.25, 1.25);
    }

    onUnhover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 0.55;
        marker.userData.sprite.scale.set(1.0, 1.0, 1);
        marker.scale.set(1, 1, 1);
    }

    onSelect(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 1.0;
        marker.userData.sprite.scale.set(1.7, 1.7, 1);
        marker.scale.set(1.4, 1.4, 1.4);
    }

    update(time) {
        if (this.disposed) return;
        this.riverMesh.material.uniforms.uTime.value = time;
        this.foam.material.uniforms.uTime.value = time;
        swayItems(this.sway, time, 0.02, 0.9);
        updateBirdFlock(this.birds, time);

        this.songMarkers.forEach((m, i) => {
            m.position.y = 0.3 + Math.sin(time * 0.7 + i * 1.3) * 0.08;
            m.position.x = m.userData.baseX + Math.sin(time * 0.2 + i) * 0.1;
        });
    }
}
