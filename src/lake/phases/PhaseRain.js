import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import { getGlowTexture } from './glowTexture.js';
import { createSkyDome } from './SkyDome.js';
import { createBroadleafTree, createRock, swayItems } from './NatureKit.js';

// Phase 2「雨」— the gathered clouds darken and burst. Rain streaks fall
// in visible lines, ripples spread on the wet ground, lightning flickers.
export class PhaseRain extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildSky();
        this._buildRainClouds();
        this._buildRainStreaks();
        this._buildGround();
        this._buildLighting();
        this._nextFlash = 4 + Math.random() * 5;
        this._flashDecay = 0;
    }

    _buildSky() {
        this.sky = createSkyDome({
            top: '#39444F',
            horizon: '#5E6C78',
            bottom: '#414B55',
        });
        this.group.add(this.sky);
    }

    _buildRainClouds() {
        // Heavy dark clouds pressing down from above
        this.rainClouds = [];
        const count = window.innerWidth < 768 ? 4 : 7;
        for (let i = 0; i < count; i++) {
            const geo = new THREE.IcosahedronGeometry(2.0 + Math.random() * 1.5, 3);
            const positions = geo.attributes.position;
            for (let j = 0; j < positions.count; j++) {
                const x = positions.getX(j);
                const y = positions.getY(j);
                const z = positions.getZ(j);
                const noise = Math.sin(x * 2.1 + y * 1.5) * Math.cos(z * 1.7) * 0.4;
                positions.setXYZ(j, x + noise * x * 0.3, y * 0.4 + noise * 0.2, z + noise * z * 0.3);
            }
            positions.needsUpdate = true;
            geo.computeVertexNormals();

            const mat = new THREE.MeshLambertMaterial({
                color: 0x525E6A,
                transparent: true,
                opacity: 0.96,
            });
            const cloud = new THREE.Mesh(geo, mat);
            cloud.position.set(
                (i / (count - 1) - 0.5) * 18 + (Math.random() - 0.5) * 2,
                6.5 + Math.random() * 1.5,
                -4 + (Math.random() - 0.5) * 6
            );
            cloud.scale.set(1.4, 0.5, 1.2);
            this.group.add(cloud);
            this.rainClouds.push(cloud);
        }
    }

    _buildRainStreaks() {
        // Rain as instanced camera-facing quads — thick enough to be
        // unmistakably visible streaks, unlike 1px WebGL lines
        const count = window.innerWidth < 768 ? 220 : 420;

        const base = new THREE.PlaneGeometry(0.035, 0.7);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        geo.attributes.position = base.attributes.position;
        geo.attributes.uv = base.attributes.uv;

        const offsets = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            offsets[i * 3] = (Math.random() - 0.5) * 24;
            offsets[i * 3 + 1] = Math.random() * 12;
            // Spread reaches right up to the camera — close drops become
            // big foreground streaks, selling the downpour
            offsets[i * 3 + 2] = -6 + Math.random() * 13.5;
            seeds[i] = Math.random();
        }
        geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
        geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
        geo.instanceCount = count;

        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                attribute vec3 aOffset;
                attribute float aSeed;
                uniform float uTime;
                varying float vAlpha;
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    vec3 off = aOffset;
                    float speed = 12.0 + aSeed * 6.0;
                    off.y = mod(off.y - uTime * speed, 12.0);
                    // Wind: gusts come and go, blowing the rain sideways
                    float wind = 0.5 + sin(uTime * 0.6) * 0.3 + sin(uTime * 1.7) * 0.12;
                    off.x += sin(aSeed * 40.0) * 0.3 + (12.0 - off.y) * wind * 0.1;
                    vAlpha = 0.4 + aSeed * 0.4;
                    // Billboard in view space: streak length varies per drop,
                    // and the whole streak leans with the wind
                    vec4 mvPos = modelViewMatrix * vec4(off, 1.0);
                    vec2 lean = vec2(position.x - position.y * wind * 0.45, position.y * (0.9 + aSeed * 0.7));
                    mvPos.xy += lean;
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                varying vec2 vUv;
                void main() {
                    // Soft vertical streak: bright core, fading tips
                    float core = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
                    float tip = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
                    gl_FragColor = vec4(0.8, 0.88, 0.98, vAlpha * core * tip);
                }
            `,
        });

        this.rainLines = new THREE.Mesh(geo, mat);
        this.rainLines.frustumCulled = false;
        this.group.add(this.rainLines);

        this._buildSplashes();
    }

    _buildSplashes() {
        // Droplets bouncing off the ground — sells the impact of the rain
        const count = window.innerWidth < 768 ? 60 : 120;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 18;
            positions[i * 3 + 1] = -0.45;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 12 + 2;
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
                varying float vAlpha;
                void main() {
                    vec3 pos = position;
                    // Each splash repeats on its own clock: a tiny bounce arc
                    float t = fract(uTime * (1.5 + aSeed) + aSeed * 7.0);
                    float arc = t * (1.0 - t) * 4.0;
                    pos.y += arc * (0.12 + aSeed * 0.22);
                    pos.x += (aSeed - 0.5) * t * 0.4;
                    vAlpha = (1.0 - t) * 0.85;
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = (2.0 + aSeed * 2.0) * uPixelRatio * (1.0 - t * 0.5);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    gl_FragColor = vec4(0.8, 0.88, 0.98, smoothstep(0.5, 0.1, d) * vAlpha);
                }
            `,
        });

        this.splashes = new THREE.Points(geo, mat);
        this.group.add(this.splashes);
    }

    _buildGround() {
        const geo = new THREE.PlaneGeometry(40, 40, 1, 1);
        const mat = new THREE.ShaderMaterial({
            transparent: true,
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec3 vWorldPos;
                float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
                void main() {
                    vec3 wet = vec3(0.10, 0.12, 0.15);
                    // Expanding impact rings all over the ground
                    float ripple = 0.0;
                    for (int i = 0; i < 14; i++) {
                        vec2 center = vec2(hash(vec2(float(i), 1.0)) - 0.5, hash(vec2(2.0, float(i))) - 0.5) * 16.0;
                        float t = fract(uTime * 0.65 + float(i) * 0.117);
                        float d = length(vWorldPos.xz - center);
                        float ring = smoothstep(t * 2.4 + 0.08, t * 2.4, d) * smoothstep(t * 2.4 - 0.08, t * 2.4, d);
                        ripple += ring * (1.0 - t) * 0.5;
                    }
                    float dist = length(vWorldPos.xz);
                    float alpha = smoothstep(20.0, 6.0, dist);
                    gl_FragColor = vec4(wet + vec3(0.5, 0.6, 0.72) * ripple, alpha * 0.9);
                }
            `,
        });

        this.ground = new THREE.Mesh(geo, mat);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = -0.5;
        this.group.add(this.ground);
    }

    _buildLighting() {
        this.ambient = new THREE.AmbientLight(0xA5AFBC, 1.0);
        this.group.add(this.ambient);
        this.flashLight = new THREE.DirectionalLight(0xCFE0FF, 0);
        this.flashLight.position.set(5, 15, -5);
        this.group.add(this.flashLight);

        // Storm-darkened trees bending in the wind at the scene edges
        this.sway = [];
        const spots = [[-8, -2], [-6.5, 3], [7.5, -1], [6, 3.5], [-4, -5]];
        spots.forEach(([x, z]) => {
            const tree = createBroadleafTree(1.4 + Math.random() * 0.8, {
                trunk: 0x2A2018, leaf: 0x223A2C,
            });
            tree.position.set(x, -0.5, z);
            this.group.add(tree);
            this.sway.push({ obj: tree, seed: Math.random() * 10 });
        });
        for (let i = 0; i < 5; i++) {
            const rock = createRock(1.3, 0x444C56);
            rock.position.set((Math.random() - 0.5) * 14, -0.46, (Math.random() - 0.5) * 10);
            this.group.add(rock);
        }
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0x5E6C78);
        this.scene.fog = new THREE.FogExp2(0x5E6C78, 0.012);
        this.camera.position.set(0, 2.6, 8);
        this.camera.lookAt(0, 1.6, 0);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        this.songMarkers = [];
        songs.forEach((song, i) => {
            const angle = (i / songs.length) * Math.PI * 2 + 0.6;
            const r = 3.1;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r * 0.6;

            const markerGroup = new THREE.Group();
            markerGroup.position.set(x, 2.0 + Math.sin(i * 1.3) * 0.6, z);

            const sphereGeo = new THREE.SphereGeometry(0.16, 16, 12);
            const sphereMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(song.color),
            });
            markerGroup.add(new THREE.Mesh(sphereGeo, sphereMat));

            const spriteMat = new THREE.SpriteMaterial({
                map: getGlowTexture(),
                color: new THREE.Color(song.color),
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.scale.set(0.8, 0.8, 1);
            markerGroup.add(sprite);

            markerGroup.userData = {
                songId: song.id,
                baseY: markerGroup.position.y,
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
            return new THREE.Vector3(m.position.x, m.position.y + 0.6, m.position.z);
        }
        return new THREE.Vector3(0, 2, 0);
    }

    onHover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 0.95;
        marker.userData.sprite.scale.set(1.2, 1.2, 1);
        marker.scale.set(1.25, 1.25, 1.25);
    }

    onUnhover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 0.6;
        marker.userData.sprite.scale.set(0.8, 0.8, 1);
        marker.scale.set(1, 1, 1);
    }

    onSelect(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 1.0;
        marker.userData.sprite.scale.set(1.5, 1.5, 1);
        marker.scale.set(1.4, 1.4, 1.4);
    }

    update(time, delta = 0.016) {
        if (this.disposed) return;
        this.rainLines.material.uniforms.uTime.value = time;
        this.ground.material.uniforms.uTime.value = time;
        this.splashes.material.uniforms.uTime.value = time;

        // Occasional distant lightning
        this._nextFlash -= delta;
        if (this._nextFlash <= 0) {
            this._flashDecay = 1.0;
            this._nextFlash = 5 + Math.random() * 6;
        }
        if (this._flashDecay > 0) {
            this._flashDecay = Math.max(0, this._flashDecay - delta * 4.0);
            this.flashLight.intensity = this._flashDecay * 2.2;
            this.ambient.intensity = 0.8 + this._flashDecay * 0.7;
        }

        this.rainClouds.forEach((c, i) => {
            c.position.x += Math.sin(time * 0.08 + i) * 0.002;
        });

        // Stronger sway — wind in the storm
        swayItems(this.sway, time, 0.045, 1.6);

        this.songMarkers.forEach((m, i) => {
            m.position.y = m.userData.baseY + Math.sin(time * 0.6 + i * 1.1) * 0.25;
        });
    }
}
