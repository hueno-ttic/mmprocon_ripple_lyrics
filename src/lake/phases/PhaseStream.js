import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import { getGlowTexture } from './glowTexture.js';
import { createSkyDome } from './SkyDome.js';
import {
    createBroadleafTree, createConifer, createGrassTuft, createRock,
    createMountainRange, createBirdFlock, updateBirdFlock, swayItems,
} from './NatureKit.js';

// Phase 4「小川」— puddles overflow into a winding brook. Fresh air after
// the rain: green banks, a soft morning sky, sunlight sparkling on water.
export class PhaseStream extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildSky();
        this._buildStream();
        this._buildBanks();
        this._buildSparkles();
        this._buildLighting();
    }

    _buildSky() {
        this.sky = createSkyDome({
            top: '#3E6E96',
            horizon: '#AFD4DC',
            bottom: '#7FA08E',
        });
        this.group.add(this.sky);
    }

    _buildStream() {
        const points = [
            new THREE.Vector3(-9, 0, 3),
            new THREE.Vector3(-4.5, 0, 1),
            new THREE.Vector3(-1, 0, -1),
            new THREE.Vector3(2, 0, 0.2),
            new THREE.Vector3(5.5, 0, 2),
            new THREE.Vector3(9, 0, 1),
        ];
        this.streamPath = new THREE.CatmullRomCurve3(points);

        const geo = new THREE.TubeGeometry(this.streamPath, 64, 0.55, 8, false);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(0x4FA8D8) },
            },
            vertexShader: `
                varying vec2 vUv;
                uniform float uTime;
                void main() {
                    vUv = uv;
                    vec3 pos = position;
                    pos.y += sin(pos.x * 2.0 + uTime * 1.5) * 0.04;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                varying vec2 vUv;
                float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
                void main() {
                    // Flow texture moving clearly downstream
                    float flow = fract(vUv.x * 4.0 - uTime * 0.35);
                    float n = hash(floor(vUv * 24.0));
                    float highlight = smoothstep(0.35, 0.5, flow) * smoothstep(0.65, 0.5, flow);
                    vec3 color = uColor + highlight * 0.45 + n * 0.06;
                    float edge = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
                    gl_FragColor = vec4(color, edge * 0.92);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        this.streamMesh = new THREE.Mesh(geo, mat);
        this.streamMesh.position.y = -0.1;
        this.group.add(this.streamMesh);
    }

    _buildBanks() {
        // Grassy green banks on both sides of the brook
        const geo = new THREE.PlaneGeometry(160, 120, 1, 1);
        const mat = new THREE.MeshLambertMaterial({ color: 0x2E5238 });
        const ground = new THREE.Mesh(geo, mat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.35;
        this.group.add(ground);

        // Rocks hugging the waterline
        for (let i = 0; i < 12; i++) {
            const t = (i + 0.5) / 12;
            const p = this.streamPath.getPointAt(t);
            const side = i % 2 === 0 ? 1 : -1;
            const rock = createRock(1.0, 0x6E7378);
            rock.position.set(
                p.x + (Math.random() - 0.2),
                -0.3,
                p.z + side * (0.85 + Math.random() * 0.9)
            );
            this.group.add(rock);
        }

        // Trees lining both banks — a brook running through woods
        this.sway = [];
        const treeSpots = [
            [-8, 5.5, 'b'], [-6, -2.5, 'c'], [-3, 2.8, 'b'], [-1, -3.5, 'c'],
            [1.5, 3.6, 'b'], [4.5, -4, 'b'], [6.5, 4.5, 'c'], [8.5, -3, 'b'],
        ];
        treeSpots.forEach(([x, z, kind]) => {
            const tree = kind === 'c'
                ? createConifer(1.6 + Math.random() * 0.9)
                : createBroadleafTree(1.4 + Math.random() * 0.8);
            tree.position.set(x, -0.35, z);
            this.group.add(tree);
            this.sway.push({ obj: tree, seed: Math.random() * 10 });
        });

        for (let i = 0; i < 26; i++) {
            const tuft = createGrassTuft(1 + Math.random() * 0.6);
            const t = Math.random();
            const p = this.streamPath.getPointAt(t);
            const side = Math.random() < 0.5 ? 1 : -1;
            tuft.position.set(
                p.x + (Math.random() - 0.5) * 2,
                -0.33,
                p.z + side * (1.2 + Math.random() * 2.5)
            );
            this.group.add(tuft);
        }

        this.group.add(createMountainRange({
            count: 6, distance: 50, spread: 100,
            color: 0x5E8296, height: 11,
        }));

        this.birds = createBirdFlock(4, 0x2E3A30);
        this.group.add(this.birds);
    }

    _buildSparkles() {
        // Sunlight glinting on the flowing water
        const count = window.innerWidth < 768 ? 30 : 60;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const p = this.streamPath.getPointAt(Math.random());
            positions[i * 3] = p.x;
            positions[i * 3 + 1] = 0.12;
            positions[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.5;
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
                    vTwinkle = pow(abs(sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 30.0)), 3.0);
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = (2.0 + vTwinkle * 3.0) * uPixelRatio;
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vTwinkle;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    gl_FragColor = vec4(1.0, 1.0, 0.92, smoothstep(0.5, 0.0, d) * vTwinkle * 0.9);
                }
            `,
        });
        this.sparkles = new THREE.Points(geo, mat);
        this.group.add(this.sparkles);
    }

    _buildLighting() {
        this.group.add(new THREE.HemisphereLight(0xD8ECF4, 0x2E4A38, 1.1));
        const dir = new THREE.DirectionalLight(0xFFF4DC, 0.8);
        dir.position.set(-6, 10, 4);
        this.group.add(dir);
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xAFD4DC);
        this.scene.fog = new THREE.FogExp2(0xA5C8CC, 0.009);
        this.camera.position.set(0, 4, 8.5);
        this.camera.lookAt(0, 0, 0);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        this.songMarkers = [];
        songs.forEach((song, i) => {
            const t = (i + 0.5) / songs.length;
            const pos = this.streamPath.getPointAt(t);

            const markerGroup = new THREE.Group();
            markerGroup.position.copy(pos);
            markerGroup.position.y = 0.35;

            const sphereGeo = new THREE.SphereGeometry(0.18, 16, 12);
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
            sprite.scale.set(0.9, 0.9, 1);
            markerGroup.add(sprite);

            markerGroup.userData = {
                songId: song.id,
                basePos: pos.clone(),
                pathT: t,
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
            return new THREE.Vector3(m.position.x, m.position.y + 0.75, m.position.z);
        }
        return new THREE.Vector3(0, 1, 0);
    }

    onHover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 0.9;
        marker.userData.sprite.scale.set(1.3, 1.3, 1);
        marker.scale.set(1.25, 1.25, 1.25);
    }

    onUnhover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 0.55;
        marker.userData.sprite.scale.set(0.9, 0.9, 1);
        marker.scale.set(1, 1, 1);
    }

    onSelect(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 1.0;
        marker.userData.sprite.scale.set(1.6, 1.6, 1);
        marker.scale.set(1.4, 1.4, 1.4);
    }

    update(time) {
        if (this.disposed) return;
        this.streamMesh.material.uniforms.uTime.value = time;
        this.sparkles.material.uniforms.uTime.value = time;
        swayItems(this.sway, time, 0.016, 0.8);
        updateBirdFlock(this.birds, time);

        this.songMarkers.forEach((m, i) => {
            const base = m.userData.basePos;
            m.position.x = base.x + Math.sin(time * 0.3 + i * 2.0) * 0.12;
            m.position.y = 0.35 + Math.sin(time * 0.5 + i * 1.5) * 0.08;
            m.position.z = base.z + Math.cos(time * 0.25 + i * 1.8) * 0.08;
        });
    }
}
