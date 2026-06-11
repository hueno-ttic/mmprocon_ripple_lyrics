import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import { getGlowTexture } from './glowTexture.js';
import { createSkyDome } from './SkyDome.js';
import {
    createBroadleafTree, createGrassTuft, createRock,
    createMountainRange, swayItems,
} from './NatureKit.js';

// Phase 3「水たまり」— the rain has just stopped. A brightening sky is
// mirrored in puddles on the wet ground; the last drops still fall.
export class PhasePuddles extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildSky();
        this._buildGround();
        this._buildResidualDrips();
        this._buildLighting();
    }

    _buildSky() {
        this.sky = createSkyDome({
            top: '#4A6580',
            horizon: '#A8B5BE',
            bottom: '#6E7A84',
        });
        this.group.add(this.sky);
    }

    _buildGround() {
        const geo = new THREE.PlaneGeometry(160, 160, 1, 1);
        const mat = new THREE.MeshLambertMaterial({
            color: 0x4A545C,
        });
        this.ground = new THREE.Mesh(geo, mat);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = -0.05;
        this.group.add(this.ground);
    }

    _buildResidualDrips() {
        // A few lingering drops still falling after the rain
        const count = window.innerWidth < 768 ? 25 : 50;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 18;
            positions[i * 3 + 1] = Math.random() * 8;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 14;
            seeds[i] = Math.random();
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
            },
            vertexShader: `
                attribute float aSeed;
                uniform float uTime;
                uniform float uPixelRatio;
                varying float vAlpha;
                void main() {
                    vec3 pos = position;
                    float speed = 2.0 + aSeed * 2.0;
                    pos.y = mod(pos.y - uTime * speed, 8.0);
                    vAlpha = smoothstep(8.0, 6.5, pos.y) * 0.5;
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = 2.5 * uPixelRatio;
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    gl_FragColor = vec4(0.75, 0.85, 0.95, smoothstep(0.5, 0.1, d) * vAlpha);
                }
            `,
        });
        this.drips = new THREE.Points(geo, mat);
        this.group.add(this.drips);
    }

    _buildLighting() {
        this.group.add(new THREE.HemisphereLight(0xC0CCD8, 0x3A4248, 1.0));
        const dir = new THREE.DirectionalLight(0xD8E0E8, 0.5);
        dir.position.set(6, 12, 4);
        this.group.add(dir);

        this.group.add(createMountainRange({
            count: 6, distance: 55, spread: 100,
            color: 0x5E7080, height: 12,
        }));

        // Rain-washed trees, glistening rocks and fresh grass
        this.sway = [];
        const spots = [[-7, -3], [-5.5, 3], [7, -2.5], [6, 3], [3.5, -6]];
        spots.forEach(([x, z]) => {
            const tree = createBroadleafTree(1.5 + Math.random() * 0.8, {
                trunk: 0x3E3026, leaf: 0x2E5E40,
            });
            tree.position.set(x, 0, z);
            this.group.add(tree);
            this.sway.push({ obj: tree, seed: Math.random() * 10 });
        });
        for (let i = 0; i < 7; i++) {
            const rock = createRock(1.2, 0x5E6670);
            rock.position.set((Math.random() - 0.5) * 15, 0.04, (Math.random() - 0.5) * 11);
            this.group.add(rock);
        }
        for (let i = 0; i < 20; i++) {
            const tuft = createGrassTuft(1, 0x3E6E48);
            const a = Math.random() * Math.PI * 2;
            const r = 3 + Math.random() * 6;
            tuft.position.set(Math.cos(a) * r, 0, Math.sin(a) * r * 0.8);
            this.group.add(tuft);
        }
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xA8B5BE);
        this.scene.fog = new THREE.FogExp2(0x9AA7B0, 0.011);
        this.camera.position.set(0, 4.4, 7.5);
        this.camera.lookAt(0, 0, -0.5);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        this.songMarkers = [];
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));

        songs.forEach((song, i) => {
            const theta = goldenAngle * i + 0.5;
            const r = 2.2 + (i % 3) * 1.1;
            const x = Math.cos(theta) * r;
            const z = Math.sin(theta) * r * 0.8;

            const markerGroup = new THREE.Group();
            markerGroup.position.set(x, 0.01, z);

            // Puddle mirror: reflects the brightening sky, tinted by the song
            const puddleGeo = new THREE.CircleGeometry(0.95, 40);
            const puddleMat = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: new THREE.Color(song.color) },
                    uSky: { value: new THREE.Color(0xA8B5BE) },
                    uHover: { value: 0.0 },
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform vec3 uColor;
                    uniform vec3 uSky;
                    uniform float uHover;
                    varying vec2 vUv;

                    void main() {
                        vec2 center = vUv - 0.5;
                        float dist = length(center) * 2.0;

                        // Sky reflection with slow shimmering
                        float shimmer = sin(dist * 9.0 - uTime * 0.8) * 0.5 + 0.5;
                        vec3 reflection = uSky * (0.75 + shimmer * 0.2);

                        // Drop-impact rings
                        float t = fract(uTime * (0.25 + uHover * 0.3));
                        float ring = smoothstep(t + 0.05, t, dist) * smoothstep(t - 0.05, t, dist) * (1.0 - t);

                        vec3 color = mix(reflection, uColor, 0.35 + uHover * 0.3);
                        color += ring * 0.6;

                        float edge = smoothstep(1.0, 0.82, dist);
                        gl_FragColor = vec4(color, edge * (0.85 + uHover * 0.15));
                    }
                `,
                transparent: true,
                depthWrite: false,
            });

            const puddle = new THREE.Mesh(puddleGeo, puddleMat);
            puddle.rotation.x = -Math.PI / 2;
            puddle.position.y = 0.02;
            markerGroup.add(puddle);

            const glowMat = new THREE.SpriteMaterial({
                map: getGlowTexture(),
                color: new THREE.Color(song.color),
                transparent: true,
                opacity: 0.5,
                blending: THREE.NormalBlending,
                depthWrite: false,
            });
            const glow = new THREE.Sprite(glowMat);
            glow.scale.set(0.8, 0.8, 1);
            glow.position.y = 0.45;
            markerGroup.add(glow);

            markerGroup.userData = {
                songId: song.id,
                puddle,
                puddleMat,
                glow,
                glowMat,
            };

            this.group.add(markerGroup);
            this.songMarkers.push(markerGroup);
        });
    }

    getSongPosition(index) {
        if (this.songMarkers[index]) {
            const m = this.songMarkers[index];
            return new THREE.Vector3(m.position.x, 1.1, m.position.z);
        }
        return new THREE.Vector3(0, 1, 0);
    }

    onHover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.puddleMat.uniforms.uHover.value = 1.0;
        marker.userData.glowMat.opacity = 0.85;
        marker.userData.glow.scale.set(1.1, 1.1, 1);
    }

    onUnhover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.puddleMat.uniforms.uHover.value = 0.0;
        marker.userData.glowMat.opacity = 0.5;
        marker.userData.glow.scale.set(0.8, 0.8, 1);
    }

    onSelect(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.puddleMat.uniforms.uHover.value = 1.0;
        marker.userData.glowMat.opacity = 1.0;
        marker.userData.glow.scale.set(1.5, 1.5, 1);
    }

    update(time) {
        if (this.disposed) return;
        this.drips.material.uniforms.uTime.value = time;
        swayItems(this.sway, time, 0.014, 0.7);
        this.songMarkers.forEach((m) => {
            m.userData.puddleMat.uniforms.uTime.value = time;
        });
    }
}
