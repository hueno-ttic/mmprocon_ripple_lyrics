import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import { getGlowTexture } from './glowTexture.js';
import { createSkyDome } from './SkyDome.js';
import {
    createBroadleafTree, createGrassTuft, createRock,
    createMountainRange, createBirdFlock, updateBirdFlock, swayItems,
} from './NatureKit.js';

// Phase 0「晴れ」— a sunlit meadow under a clear sky. Sunlight draws
// water vapor upward: the journey of a single drop begins here.
export class PhaseMist extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildSky();
        this._buildSun();
        this._buildMeadow();
        this._buildRisingVapor();
        this._buildLighting();
    }

    _buildMeadow() {
        // Grass field stretching to fog-melted horizon
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(200, 200, 1, 1),
            new THREE.MeshLambertMaterial({ color: 0x5E9A60 })
        );
        ground.rotation.x = -Math.PI / 2;
        this.group.add(ground);

        this.group.add(createMountainRange({
            count: 7, distance: 55, spread: 110,
            color: 0x7FA3C8, height: 13,
        }));

        // Trees ring the meadow edges, leaving the center open for songs
        this.sway = [];
        const treeSpots = [
            [-7, -4], [-5.5, 2.5], [6.5, -3.5], [7.5, 2], [-3, -6.5], [4, -6],
        ];
        treeSpots.forEach(([x, z]) => {
            const tree = createBroadleafTree(1.5 + Math.random() * 0.9);
            tree.position.set(x, 0, z);
            this.group.add(tree);
            this.sway.push({ obj: tree, seed: Math.random() * 10 });
        });

        for (let i = 0; i < 30; i++) {
            const tuft = createGrassTuft(1 + Math.random());
            const a = Math.random() * Math.PI * 2;
            const r = 2.5 + Math.random() * 7;
            tuft.position.set(Math.cos(a) * r, 0, Math.sin(a) * r * 0.8);
            this.group.add(tuft);
        }
        for (let i = 0; i < 5; i++) {
            const rock = createRock(1.2, 0x8A9098);
            rock.position.set((Math.random() - 0.5) * 14, 0.04, (Math.random() - 0.5) * 10);
            this.group.add(rock);
        }

        this.birds = createBirdFlock(5);
        this.group.add(this.birds);
    }

    _buildSky() {
        this.sky = createSkyDome({
            top: '#3D7DC8',
            horizon: '#BFE3FF',
            bottom: '#E8F4FF',
        });
        this.group.add(this.sky);
    }

    _buildSun() {
        // Warm sun glow with a wide halo
        const sunMat = new THREE.SpriteMaterial({
            map: getGlowTexture(),
            color: 0xFFF6D8,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.sun = new THREE.Sprite(sunMat);
        this.sun.position.set(-10, 14, -30);
        this.sun.scale.set(22, 22, 1);
        this.group.add(this.sun);

        const haloMat = new THREE.SpriteMaterial({
            map: getGlowTexture(),
            color: 0xFFEFC0,
            transparent: true,
            opacity: 0.35,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.sunHalo = new THREE.Sprite(haloMat);
        this.sunHalo.position.copy(this.sun.position);
        this.sunHalo.scale.set(48, 48, 1);
        this.group.add(this.sunHalo);
    }

    _buildRisingVapor() {
        // Vapor wisps rising clearly upward — evaporation made visible
        const count = window.innerWidth < 768 ? 90 : 180;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 24;
            positions[i * 3 + 1] = Math.random() * 10 - 1;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
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
                varying float vFade;
                void main() {
                    vec3 pos = position;
                    // Rise upward and loop; sway sideways as it climbs
                    float riseSpeed = 0.45 + aSeed * 0.5;
                    float y = mod(pos.y + uTime * riseSpeed, 10.0) - 1.0;
                    pos.x += sin(uTime * 0.4 + aSeed * 20.0 + y * 0.5) * 0.6;
                    pos.y = y;
                    // Fade in near the ground, fade out near the top
                    vFade = smoothstep(-1.0, 0.5, y) * smoothstep(9.0, 5.5, y);
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = (10.0 + aSeed * 16.0) * uPixelRatio * (8.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vFade;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float alpha = smoothstep(0.5, 0.05, d) * vFade * 0.4;
                    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
                }
            `,
        });

        this.vapor = new THREE.Points(geo, mat);
        this.group.add(this.vapor);
    }

    _buildLighting() {
        this.group.add(new THREE.AmbientLight(0xFFFFFF, 1.1));
        const sunLight = new THREE.DirectionalLight(0xFFF2D0, 1.2);
        sunLight.position.set(-10, 14, -10);
        this.group.add(sunLight);
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xBFE3FF);
        this.scene.fog = new THREE.FogExp2(0xCFE8FF, 0.006);
        this.camera.position.set(0, 2.4, 8);
        this.camera.lookAt(0, 1.9, 0);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        this.songMarkers = [];
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));

        songs.forEach((song, i) => {
            const theta = goldenAngle * i;
            const r = 2.6 + (i % 2) * 1.0;
            const x = Math.cos(theta) * r;
            const z = Math.sin(theta) * r * 0.7;
            const y = 1.6 + Math.sin(i * 1.7) * 1.0;

            const markerGroup = new THREE.Group();
            markerGroup.position.set(x, y, z);

            // Solid droplet core — readable against the bright sky
            const sphereGeo = new THREE.SphereGeometry(0.16, 16, 12);
            const sphereMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(song.color),
            });
            const sphere = new THREE.Mesh(sphereGeo, sphereMat);
            markerGroup.add(sphere);

            // Soft colored aura (normal blending — additive washes out in daylight)
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
                baseY: y,
                sphere,
                sphereMat,
                sprite,
                spriteMat,
            };

            this.group.add(markerGroup);
            this.songMarkers.push(markerGroup);
        });
    }

    getSongPosition(index) {
        if (this.songMarkers[index]) {
            const m = this.songMarkers[index];
            return new THREE.Vector3(m.position.x, m.position.y + 0.65, m.position.z);
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
        this.vapor.material.uniforms.uTime.value = time;

        // Sun breathes slowly
        const pulse = 1 + Math.sin(time * 0.5) * 0.04;
        this.sunHalo.scale.set(48 * pulse, 48 * pulse, 1);

        swayItems(this.sway, time);
        updateBirdFlock(this.birds, time);

        // Markers drift gently upward and back, like droplets in warm air
        this.songMarkers.forEach((m, i) => {
            m.position.y = m.userData.baseY + Math.sin(time * 0.5 + i * 1.2) * 0.2;
        });
    }
}
