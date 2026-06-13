import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { PhaseBase } from './PhaseBase.js';
import { appState } from '../../core/appState.js';
import { createSkyDome } from './SkyDome.js';
import { getGlowTexture } from './glowTexture.js';
import {
    createSunflower, createBroadleafTree, createConifer,
    createBirdFlock, updateBirdFlock,
} from './NatureKit.js';

// Phase 6「湖」— the journey's end, rebuilt to the approved Claude Design
// spec (design_drafts scene6.js): faceted vertex-colored Fuji, a real
// mirror lake, oblate cumulus billows, sunflower colonies on the banks
// and song nodes as glowing ripple-rings with floating orbs.
const IS_MOBILE = window.innerWidth < 768;

// Faceted mountain with concave profile, noisy ridges and a wavy snow
// line — vertex colors, flat shading (ported from the design spec).
function makeMountain(o) {
    const {
        h, r, radial = 12, rings = 7, concave = 1.5, noise = 0.07, jitter = 0.04,
        snow = 0.7, topR = 0,
        body0 = 0x9FB8D2, body1 = 0x6F90B8, snowCol = 0xF6FAFF,
    } = o;
    const g = new THREE.CylinderGeometry(Math.max(r * topR, 0.001), r, h, radial, rings, false);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    const cA = new THREE.Color(body0), cB = new THREE.Color(body1), cS = new THREE.Color(snowCol);
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), z = p.getZ(i);
        const y = p.getY(i);
        const t = Math.min(Math.max(y / h, 0), 1);
        if (Math.hypot(x, z) > 1e-4) {
            const cur = r * (1 - (1 - topR) * t);
            const target = r * ((1 - topR) * Math.pow(1 - t, concave) + topR);
            const f = target / (cur + 1e-6);
            x *= f; z *= f;
        }
        const ang = Math.atan2(z, x);
        const nf = 1 + noise * Math.sin(ang * 5 + t * 9) + jitter * Math.sin(ang * 11 + t * 4);
        x *= nf; z *= nf;
        p.setX(i, x);
        p.setY(i, y + jitter * h * 0.35 * Math.sin(ang * 7 + t * 5));
        p.setZ(i, z);
        const sl = snow + 0.06 * Math.sin(ang * 6);
        const c = t > sl ? cS : cA.clone().lerp(cB, Math.min(t / sl, 1));
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

export class PhaseLake extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildSky();
        this._buildMountains();
        this._buildShoreAndBanks();
        this._buildLake();
        this._buildClouds();
        this._buildSparkles();
        this._buildLighting();
    }

    _buildSky() {
        this.sky = createSkyDome({
            top: '#1E73D4',
            horizon: '#6FB1EC',
            bottom: '#DDF0FB',
        });
        this.sky.scale.setScalar(3.5); // design-scale world needs a bigger dome
        this.group.add(this.sky);

        // Sun disc + halo toward the key light
        const sdir = new THREE.Vector3(48, 62, 30).normalize();
        const disc = new THREE.Mesh(
            new THREE.CircleGeometry(14, 32),
            new THREE.MeshBasicMaterial({ color: 0xFFFEF6, fog: false })
        );
        disc.position.copy(sdir.clone().multiplyScalar(370));
        this.sunDisc = disc;
        this.group.add(disc);

        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getGlowTexture(), color: 0xFFF2C8, transparent: true,
            depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.85,
        }));
        glow.position.copy(disc.position);
        glow.scale.setScalar(180);
        this.group.add(glow);
    }

    _buildMountains() {
        // Hero Fuji: blunt top, near-straight profile, calm ridges
        this.fuji = makeMountain({
            h: 15, r: 27, radial: 18, rings: 8, concave: 1.02, noise: 0.016, jitter: 0.009,
            snow: 0.64, topR: 0.05, body0: 0x7E9CC0, body1: 0x52729E, snowCol: 0xF8FCFF,
        });
        this.fuji.position.set(0, 0, -58);
        this.group.add(this.fuji);

        // Surrounding range, hazier palette
        const ranges = [
            [-42, -66, 11, 12], [-60, -74, 9, 11], [42, -68, 12, 13],
            [60, -76, 9, 11], [32, -82, 8, 10], [-30, -84, 8, 10],
        ];
        ranges.forEach(([x, z, h, r]) => {
            const m = makeMountain({
                h, r, radial: 10, rings: 5, concave: 1.35, noise: 0.09, jitter: 0.05,
                snow: 0.78, body0: 0xA8C0DA, body1: 0x82A0C0, snowCol: 0xEAF2FB,
            });
            m.position.set(x, 0, z);
            this.group.add(m);
        });
    }

    _buildShoreAndBanks() {
        // Far shore strip with a gently noisy top
        const shoreMat = new THREE.MeshLambertMaterial({ color: 0x3F7D34, flatShading: true });
        const shore = new THREE.Mesh(new THREE.BoxGeometry(260, 3, 14), shoreMat);
        shore.position.set(0, -0.6, -50);
        this.group.add(shore);
        const sg = new THREE.PlaneGeometry(260, 14, 40, 4);
        sg.rotateX(-Math.PI / 2);
        const sp = sg.attributes.position;
        for (let i = 0; i < sp.count; i++) {
            sp.setY(i, 0.9 + Math.sin(sp.getX(i) * 0.3) * 0.4 + Math.cos(sp.getZ(i) * 0.5) * 0.3);
        }
        sg.computeVertexNormals();
        const shoreTop = new THREE.Mesh(sg, shoreMat);
        shoreTop.position.set(0, 0, -49);
        this.group.add(shoreTop);

        // Trees along the far shore (skip the center so Fuji stays clear)
        for (let i = 0; i < 14; i++) {
            const x = -120 + i * 17 + (Math.random() - 0.5) * 8;
            if (Math.abs(x) < 20) continue;
            const s = 2.4 + Math.random() * 1.6;
            const tree = (i % 3 === 0) ? createConifer(s) : createBroadleafTree(s);
            tree.position.set(x, 0.9, -49 + (Math.random() - 0.5) * 4);
            this.group.add(tree);
        }

        // Lakeside mounds, slightly irregular
        const bankMat = new THREE.MeshLambertMaterial({ color: 0x52A03E, flatShading: true });
        const makeBank = (x, z, sx, sy, sz) => {
            const g = new THREE.IcosahedronGeometry(1, 2);
            const p = g.attributes.position;
            const v = new THREE.Vector3();
            for (let i = 0; i < p.count; i++) {
                v.fromBufferAttribute(p, i);
                v.multiplyScalar(1 + 0.08 * Math.sin(v.x * 4 + v.z * 3));
                p.setXYZ(i, v.x, v.y, v.z);
            }
            g.computeVertexNormals();
            const m = new THREE.Mesh(g, bankMat);
            m.scale.set(sx, sy, sz);
            m.position.set(x, -sy * 0.55, z);
            this.group.add(m);
        };
        makeBank(-15, 9, 12, 3.0, 9);
        makeBank(16, 7, 12, 3.0, 9);
        const bankTopY = -3.0 * 0.55 + 3.0;

        // Sunflower colonies blooming on the banks
        this.flowers = [];
        const colony = (cx, cz, n, spread) => {
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2;
                const d = Math.sqrt(Math.random());
                const f = createSunflower(0.85 + Math.random() * 0.5);
                f.position.set(
                    cx + Math.cos(a) * spread * d,
                    bankTopY - 0.1,
                    cz + Math.sin(a) * spread * d * 0.7
                );
                f.rotation.y = Math.random() * Math.PI * 2;
                f.userData.head.rotation.z = (Math.random() - 0.5) * 0.3;
                this.group.add(f);
                this.flowers.push(f);
            }
        };
        const perColony = IS_MOBILE ? 9 : 13;
        colony(-15, 10, perColony, 7.5);
        colony(16, 8, perColony, 7.5);

        this.birds = createBirdFlock(5, 0x2A3640);
        this.birds.userData.radius = 60;
        this.birds.userData.baseY = 26;
        this.group.add(this.birds);

        // 湖への還元: 「こたえて」で生まれた答えの色が、灯として湖上に浮かぶ
        try {
            const results = JSON.parse(localStorage.getItem('songResults') || '{}');
            const answer = results.kotaete?.swatch;
            if (answer) {
                const mat = new THREE.SpriteMaterial({
                    map: getGlowTexture(),
                    color: new THREE.Color(answer),
                    transparent: true, opacity: 0.85,
                    blending: THREE.AdditiveBlending, depthWrite: false,
                });
                this.answerLight = new THREE.Sprite(mat);
                this.answerLight.position.set(0, 2.4, -14);
                this.answerLight.scale.setScalar(2.2);
                this.group.add(this.answerLight);
            }
        } catch (e) { /* storage不整合は無視 */ }
    }

    _buildLake() {
        // Real mirror: mountains, clouds and flowers reflect in the water
        const dpr = Math.min(window.devicePixelRatio, 2);
        const texSize = (IS_MOBILE ? 512 : 1024) * dpr;
        this.mirror = new Reflector(new THREE.PlaneGeometry(250, 108), {
            clipBias: 0.004,
            textureWidth: texSize,
            textureHeight: texSize,
            color: 0x4878AB,
        });
        this.mirror.rotateX(-Math.PI / 2);
        this.mirror.position.set(0, 0, 4);
        this.group.add(this.mirror);

        // Translucent rippling tint layer above the mirror
        this.waterGeo = new THREE.PlaneGeometry(250, 108, 60, 30);
        this.waterGeo.rotateX(-Math.PI / 2);
        const waterMat = new THREE.MeshLambertMaterial({
            color: 0x3F86D0, transparent: true, opacity: 0.34, flatShading: true,
        });
        const water = new THREE.Mesh(this.waterGeo, waterMat);
        water.position.set(0, 0.05, 4);
        this.group.add(water);
        this._waterBase = this.waterGeo.attributes.position.array.slice();
    }

    _buildClouds() {
        // Oblate cumulus billows: smooth icospheres in a wide flat formation
        const cloudMat = new THREE.MeshLambertMaterial({ color: 0xFDFEFF });
        const cloudSphere = new THREE.IcosahedronGeometry(1, IS_MOBILE ? 3 : 4);
        const lumps = [
            [0, 0.55, 0.6], [-1.0, 0.35, 0.5], [1.0, 0.32, 0.5], [-0.05, 0.1, 0.72],
            [-1.7, 0.05, 0.42], [1.7, 0.0, 0.42], [0.7, 0.18, 0.55], [-0.75, 0.2, 0.55],
            [0, -0.18, 0.78],
        ];
        const tower = (x, y, z, scale) => {
            const g = new THREE.Group();
            lumps.forEach((l) => {
                const s = new THREE.Mesh(cloudSphere, cloudMat);
                s.position.set(l[0] * 5, l[1] * 5, 0);
                s.scale.set(l[2] * 6.2, l[2] * 4.2, l[2] * 5);
                g.add(s);
            });
            g.position.set(x, y, z);
            g.scale.setScalar(scale);
            g.rotation.y = (Math.random() - 0.5) * 0.5;
            g.userData = { ph: Math.random() * Math.PI * 2, base: scale };
            this.group.add(g);
            return g;
        };
        this.clouds = [
            tower(-46, 38, -90, 1.4), tower(58, 32, -78, 0.95),
            tower(10, 47, -120, 1.15), tower(-92, 34, -70, 0.78),
        ];
    }

    _buildSparkles() {
        // Teal / cream motes rising over the lake
        const SP = IS_MOBILE ? 50 : 90;
        this._sparkleCount = SP;
        const pos = new Float32Array(SP * 3);
        const col = new Float32Array(SP * 3);
        this._sparkleSpeed = new Float32Array(SP);
        const teal = new THREE.Color(0x6FF0E4), cream = new THREE.Color(0xFFF6CF);
        for (let i = 0; i < SP; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 120;
            pos[i * 3 + 1] = Math.random() * 45;
            pos[i * 3 + 2] = -60 + Math.random() * 90;
            const c = Math.random() < 0.62 ? teal : cream;
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
            this._sparkleSpeed[i] = 1.5 + Math.random() * 2.5;
        }
        this.sparkleGeo = new THREE.BufferGeometry();
        this.sparkleGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.sparkleGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        this.sparkles = new THREE.Points(this.sparkleGeo, new THREE.PointsMaterial({
            size: 0.5, vertexColors: true, transparent: true, opacity: 0.9,
            depthWrite: false, blending: THREE.AdditiveBlending,
            map: getGlowTexture(), fog: false,
        }));
        this.group.add(this.sparkles);
    }

    _buildLighting() {
        this.group.add(new THREE.HemisphereLight(0xBFE3F5, 0x3C7030, 0.95));
        const sun = new THREE.DirectionalLight(0xFFF3DC, 1.4);
        sun.position.set(48, 62, 30);
        this.group.add(sun);
        this.group.add(new THREE.AmbientLight(0xFFFFFF, 0.25));
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xBFE3F5);
        this.scene.fog = new THREE.Fog(0xBFE3F5, 64, 220);
        this.camera.position.set(0, 6.6, 34);
        this.camera.lookAt(0, 6.5, -46);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        // Glowing ripple nodes with floating orbs, on the carousel circle
        this.songMarkers = [];
        this.carouselRadius = 10;

        songs.forEach((song, i) => {
            const isCompleted = appState.isSongComplete(song.id);
            const col = new THREE.Color(isCompleted ? 0xE2B53C : song.color);

            const grp = new THREE.Group();
            grp.position.set(0, 0.08, 0);

            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(1.15, 0.055, 8, 40),
                new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, fog: false })
            );
            ring.rotation.x = -Math.PI / 2;
            grp.add(ring);

            const exp = new THREE.Mesh(
                new THREE.TorusGeometry(1.15, 0.04, 8, 40),
                new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, fog: false })
            );
            exp.rotation.x = -Math.PI / 2;
            grp.add(exp);

            const glow = new THREE.Sprite(new THREE.SpriteMaterial({
                map: getGlowTexture(), color: col, transparent: true,
                depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.7,
            }));
            glow.scale.setScalar(1.6);
            glow.position.y = 0.25;
            grp.add(glow);

            const orb = new THREE.Mesh(
                new THREE.SphereGeometry(0.3, 16, 12),
                new THREE.MeshBasicMaterial({ color: col, fog: false })
            );
            orb.position.y = 1.2;
            grp.add(orb);

            grp.userData = {
                songId: song.id,
                baseAngle: (i / songs.length) * Math.PI * 2,
                exp, orb, ph: i * 0.4,
            };
            this.group.add(grp);
            this.songMarkers.push(grp);
        });

        this.currentRotation = Math.PI / 2;
        this.targetRotation = Math.PI / 2;
    }

    getSongPosition(index) {
        if (this.songMarkers[index]) {
            const m = this.songMarkers[index];
            return new THREE.Vector3(m.position.x, 2.4, m.position.z);
        }
        return new THREE.Vector3(0, 2, 0);
    }

    onHover(index) {
        const m = this.songMarkers[index];
        if (m) m.scale.setScalar(1.2);
    }

    onUnhover(index) {
        const m = this.songMarkers[index];
        if (m) m.scale.setScalar(1.0);
    }

    onSelect(index) {
        const m = this.songMarkers[index];
        if (m) m.scale.setScalar(1.45);
    }

    update(time) {
        if (this.disposed) return;

        // Water ripple (vertex bobbing over the mirror)
        const wp = this.waterGeo.attributes.position;
        const base = this._waterBase;
        for (let i = 0; i < wp.count; i++) {
            const x = base[i * 3], z = base[i * 3 + 2];
            wp.setY(i, Math.sin(x * 0.25 + time * 0.9) * 0.12 + Math.cos(z * 0.3 + time * 0.7) * 0.12);
        }
        wp.needsUpdate = true;

        // Clouds breathe and drift
        this.clouds.forEach((c, i) => {
            const s = c.userData.base * (1 + Math.sin(time * 0.25 + c.userData.ph) * 0.02);
            c.scale.setScalar(s);
            c.position.x += Math.sin(time * 0.05 + i) * 0.002;
        });

        // Sunflower heads sway
        this.flowers.forEach((f) => {
            f.userData.head.rotation.z = Math.sin(time * 1.1 + f.userData.ph) * 0.12;
        });

        updateBirdFlock(this.birds, time);

        if (this.answerLight) {
            this.answerLight.position.y = 2.4 + Math.sin(time * 0.6) * 0.3;
            this.answerLight.material.opacity = 0.7 + Math.sin(time * 1.1) * 0.15;
        }

        // Sparkles rise
        const sp = this.sparkleGeo.attributes.position;
        for (let i = 0; i < this._sparkleCount; i++) {
            let y = sp.getY(i) + this._sparkleSpeed[i] * 0.016;
            if (y > 46) y = 0;
            sp.setY(i, y);
        }
        sp.needsUpdate = true;

        // Carousel rotation + node animation
        if (this.currentRotation !== undefined) {
            this.currentRotation += (this.targetRotation - this.currentRotation) * 0.07;
            this.songMarkers.forEach((m) => {
                const angle = m.userData.baseAngle + this.currentRotation;
                m.position.set(
                    Math.cos(angle) * this.carouselRadius,
                    0.08,
                    4 + Math.sin(angle) * this.carouselRadius * 0.7
                );
                // Expanding ripple ring + bobbing orb
                const k = ((time + m.userData.ph) % 2.2) / 2.2;
                const s = 0.5 + k * 2.1;
                m.userData.exp.scale.set(s, s, 1);
                m.userData.exp.material.opacity = 0.85 * (1 - k);
                m.userData.orb.position.y = 1.2 + Math.sin(time * 1.6 + m.userData.ph * 3) * 0.14;
            });
        }
    }

    dispose() {
        if (this.mirror) {
            this.mirror.getRenderTarget().dispose();
        }
        super.dispose();
    }
}
