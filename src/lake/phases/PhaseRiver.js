import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { PhaseBase } from './PhaseBase.js';
import { createSkyDome } from './SkyDome.js';
import { getGlowTexture } from './glowTexture.js';
import {
    createBroadleafTree, createConifer, createRock,
    createBirdFlock, updateBirdFlock, swayItems,
} from './NatureKit.js';

// Phase 5「川」— rebuilt to the approved Claude Design spec (scene5.js):
// the camera looks upstream toward snow-capped peaks, a mirror river
// flows toward the viewer with foam dashes, boulders crowned in white
// water, dense forested embankments and drifting mist.
const IS_MOBILE = window.innerWidth < 768;
const RIVER_W = 36;
const RIVER_LEN = 150;
const RIVER_CZ = -30;

// Faceted vertex-colored mountain (same technique as PhaseLake)
function makeMountain(o) {
    const {
        h, r, radial = 12, rings = 7, concave = 1.18, noise = 0.06, jitter = 0.035,
        snow = 0.7, topR = 0.05,
        body0 = 0xA6C0DB, body1 = 0x6B8BB2, snowCol = 0xF4FAFF,
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

export class PhaseRiver extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildSky();
        this._buildMountains();
        this._buildBanks();
        this._buildRocks();
        this._buildRiver();
        this._buildFoam();
        this._buildMist();
        this._buildClouds();
        this._buildSparkles();
        this._buildLighting();
    }

    _buildSky() {
        this.sky = createSkyDome({
            top: '#2C7AC8',
            horizon: '#77B3EC',
            bottom: '#DFF0FB',
        });
        this.sky.scale.setScalar(3.6);
        this.group.add(this.sky);

        // Morning sun back-left, raking across the river
        const sdir = new THREE.Vector3(-40, 64, 26).normalize();
        const disc = new THREE.Mesh(
            new THREE.CircleGeometry(13, 32),
            new THREE.MeshBasicMaterial({ color: 0xFFFEF6, fog: false })
        );
        disc.position.copy(sdir.clone().multiplyScalar(380));
        this.group.add(disc);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getGlowTexture(), color: 0xFFF2C8, transparent: true,
            depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.8,
        }));
        glow.position.copy(disc.position);
        glow.scale.setScalar(185);
        this.group.add(glow);
    }

    _buildMountains() {
        // Tall central peak flanked by ranges — the river's source
        const peaks = [
            [0, -96, 30, 26, 0.62], [-30, -94, 18, 17, 0.74], [30, -95, 20, 18, 0.72],
            [-54, -92, 14, 15, 0.8], [54, -92, 15, 15, 0.8],
            [-78, -90, 11, 13, 0.82], [78, -90, 12, 13, 0.82],
        ];
        peaks.forEach(([x, z, h, r, snow]) => {
            const m = makeMountain({ h, r, snow });
            m.position.set(x, 0, z);
            this.group.add(m);
        });
    }

    _buildBanks() {
        // Ground base under everything
        const ground = new THREE.Mesh(
            new THREE.BoxGeometry(320, 6, 200),
            new THREE.MeshLambertMaterial({ color: 0x356B2B, flatShading: true })
        );
        ground.position.set(0, -3.2, -40);
        this.group.add(ground);

        // Raised embankments with rolling tops, framing the river
        const embankment = (side) => {
            const len = 150, depthW = 70;
            const g = new THREE.PlaneGeometry(depthW, len, 14, 30);
            g.rotateX(-Math.PI / 2);
            const p = g.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const lx = p.getX(i), lz = p.getZ(i);
                const edge = (lx + depthW / 2) / depthW;
                let yy = Math.pow(edge, 0.7) * 9.0 + Math.sin(lz * 0.10) * 1.4
                       + Math.cos(lx * 0.18 + lz * 0.05) * 0.9;
                if (edge < 0.04) yy = -1.2;
                p.setY(i, yy);
            }
            g.computeVertexNormals();
            const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
                color: side < 0 ? 0x4F9C3C : 0x3E7E30, flatShading: true,
            }));
            m.position.set(side * (16 + depthW / 2), 0, RIVER_CZ);
            return m;
        };
        this.group.add(embankment(-1));
        this.group.add(embankment(1));

        // Grassy shelves at each waterline
        [-1, 1].forEach((s) => {
            const sh = new THREE.Mesh(
                new THREE.BoxGeometry(8, 2, 150, 1, 1, 30),
                new THREE.MeshLambertMaterial({ color: 0x47913A, flatShading: true })
            );
            sh.position.set(s * 19.5, 0.2, RIVER_CZ);
            this.group.add(sh);
        });

        // Dense forest on both banks — taller trees crowd the waterline
        this.sway = [];
        const perBank = IS_MOBILE ? 14 : 34;
        const plantBank = (side) => {
            for (let i = 0; i < perBank; i++) {
                const z = -100 + Math.random() * 138;
                const across = 18.5 + Math.pow(Math.random(), 0.62) * 38;
                const x = side * across + (Math.random() - 0.5) * 3;
                const edge = (across - 16) / 70;
                const gy = Math.pow(Math.max(edge, 0), 0.7) * 9.0 - 0.3 + Math.sin(z * 0.10) * 1.0;
                const near = Math.max(1 - (across - 18.5) / 30, 0);
                const s = (1.0 + Math.random() * 0.7 + near * 0.7) * 2.2;
                const tree = (Math.random() < 0.55) ? createConifer(s) : createBroadleafTree(s);
                tree.position.set(x, gy, z);
                tree.rotation.y = Math.random() * Math.PI * 2;
                this.group.add(tree);
                this.sway.push({ obj: tree, seed: Math.random() * 10 });
            }
        };
        plantBank(-1);
        plantBank(1);

        this.birds = createBirdFlock(6, 0x2A3340);
        this.birds.userData.radius = 55;
        this.birds.userData.baseY = 34;
        this.group.add(this.birds);
    }

    _buildRocks() {
        // Hero boulders breaking the current, leading the eye upstream
        this.rockSpots = [
            [-10, -4, 2.5], [8, -9, 2.8], [-3, 5, 2.1],
            [13, 0, 2.1], [-14, -13, 2.3], [5, 13, 1.9],
        ];
        this.rockSpots.forEach(([x, z, s]) => {
            const rock = createRock(s * 3.2, 0x6E737A);
            rock.position.set(x, 0.1, z);
            rock.rotation.y = Math.random() * Math.PI * 2;
            this.group.add(rock);
        });
    }

    _buildRiver() {
        const dpr = Math.min(window.devicePixelRatio, 2);
        const texSize = (IS_MOBILE ? 512 : 1024) * dpr;
        this.mirror = new Reflector(new THREE.PlaneGeometry(RIVER_W, RIVER_LEN), {
            clipBias: 0.004, textureWidth: texSize, textureHeight: texSize, color: 0x1D3A57,
        });
        this.mirror.rotateX(-Math.PI / 2);
        this.mirror.position.set(0, -0.02, RIVER_CZ);
        this.group.add(this.mirror);

        // Flowing translucent surface, depth-tinted via vertex colors
        const segX = IS_MOBILE ? 28 : 48;
        const segZ = IS_MOBILE ? 64 : 110;
        this.riverGeo = new THREE.PlaneGeometry(RIVER_W, RIVER_LEN, segX, segZ);
        this.riverGeo.rotateX(-Math.PI / 2);
        const p = this.riverGeo.attributes.position;
        const cols = new Float32Array(p.count * 3);
        const deep = new THREE.Color(0x1C4F86), mid = new THREE.Color(0x2E72BE), shallow = new THREE.Color(0x4F9BD8);
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i);
            const edge = Math.min(Math.abs(x) / (RIVER_W / 2), 1);
            const far = Math.min(Math.max((-z) / (RIVER_LEN / 2), 0), 1);
            const c = mid.clone().lerp(deep, (1 - edge) * 0.7);
            c.lerp(shallow, Math.max(edge - 0.55, 0) * 1.6 + far * 0.25);
            cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
        }
        this.riverGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        const mat = new THREE.MeshLambertMaterial({
            vertexColors: true, transparent: true, opacity: 0.74, flatShading: true,
        });
        this.river = new THREE.Mesh(this.riverGeo, mat);
        this.river.position.set(0, 0.06, RIVER_CZ);
        this.group.add(this.river);
        this._riverBase = this.riverGeo.attributes.position.array.slice();
    }

    _streakTexture() {
        const w = 128, h = 32;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const x = cv.getContext('2d');
        const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.5, 'rgba(232,245,255,0.4)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);
        return new THREE.CanvasTexture(cv);
    }

    _buildFoam() {
        // Flat foam dashes streaming downstream on the surface
        const streakGeo = new THREE.PlaneGeometry(1, 1);
        streakGeo.rotateX(-Math.PI / 2);
        const streakTex = this._streakTexture();
        const count = IS_MOBILE ? 48 : 96;
        this.streaks = [];
        for (let i = 0; i < count; i++) {
            const m = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({
                map: streakTex, color: 0xFFFFFF, transparent: true, opacity: 0,
                depthWrite: false, side: THREE.DoubleSide,
            }));
            const lane = (Math.random() - 0.5) * 30;
            m.scale.set(0.45 + Math.random() * 0.7, 1, 5 + Math.random() * 11);
            m.position.set(lane, 0.13, -90 + Math.random() * 132);
            m.userData = { lane, spd: 13 + Math.random() * 10, amp: 0.4 + Math.random() * 0.38 };
            this.group.add(m);
            this.streaks.push(m);
        }

        // White-water crowns + downstream wakes around each boulder
        this.foams = [];
        const addFoam = (x, z, base, peak) => {
            const f = new THREE.Sprite(new THREE.SpriteMaterial({
                map: getGlowTexture(), color: 0xFFFFFF, transparent: true,
                opacity: peak, depthWrite: false,
            }));
            f.position.set(x, 0.24, z);
            f.scale.setScalar(base);
            f.userData = { ph: Math.random() * Math.PI * 2, base, peak };
            this.group.add(f);
            this.foams.push(f);
        };
        this.rockSpots.forEach(([rx, rz, rs]) => {
            [[0, -1.0, 1.9], [-0.85, -0.4, 1.3], [0.85, -0.4, 1.3], [0, -0.1, 1.5]].forEach((o) => {
                addFoam(rx + o[0] * rs, rz + o[1] * rs, rs * o[2] * 0.62, 0.82);
            });
            for (let k = 0; k < 3; k++) {
                addFoam(
                    rx + (Math.random() - 0.5) * 0.4 * rs,
                    rz + (1.0 + k * 0.9) * rs,
                    rs * (1.1 - k * 0.22) * 0.55,
                    0.5 - k * 0.13
                );
            }
        });

        // Shoreline foam where the current meets the banks
        this.shoreFoams = [];
        [-1, 1].forEach((side) => {
            const n = IS_MOBILE ? 10 : 20;
            for (let i = 0; i < n; i++) {
                const f = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: getGlowTexture(), color: 0xFFFFFF, transparent: true,
                    opacity: 0.5, depthWrite: false,
                }));
                const base = 1.3 + Math.random() * 0.9;
                f.position.set(side * (16.5 + Math.random() * 1.2), 0.2, -88 + i * (132 / n));
                f.scale.set(base * 2.2, base * 0.5, 1);
                f.userData = { ph: Math.random() * Math.PI * 2 };
                this.group.add(f);
                this.shoreFoams.push(f);
            }
        });
    }

    _buildMist() {
        // Thin horizontal wisps drifting downstream above the water
        this.mists = [];
        const n = IS_MOBILE ? 5 : 9;
        for (let i = 0; i < n; i++) {
            const m = new THREE.Sprite(new THREE.SpriteMaterial({
                map: getGlowTexture(), color: 0xEAF4FF, transparent: true,
                opacity: 0, depthWrite: false,
            }));
            const base = 14 + Math.random() * 10;
            m.position.set((Math.random() - 0.5) * 32, 1.8 + Math.random() * 2.0, -78 + Math.random() * 96);
            m.scale.set(base * 2.6, base * 0.42, 1);
            m.userData = { ph: Math.random() * Math.PI * 2, spd: 1.6 + Math.random() * 2.4 };
            this.group.add(m);
            this.mists.push(m);
        }
    }

    _buildClouds() {
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
            g.userData = { ph: Math.random() * Math.PI * 2, base: scale };
            this.group.add(g);
            return g;
        };
        this.clouds = [
            tower(-58, 60, -150, 1.15), tower(60, 56, -140, 0.9), tower(4, 70, -180, 1.05),
        ];
    }

    _buildSparkles() {
        const SP = IS_MOBILE ? 45 : 80;
        this._sparkleCount = SP;
        const pos = new Float32Array(SP * 3);
        const col = new Float32Array(SP * 3);
        this._sparkleSpeed = new Float32Array(SP);
        const teal = new THREE.Color(0x6FF0E4), cream = new THREE.Color(0xFFF6CF);
        for (let i = 0; i < SP; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 70;
            pos[i * 3 + 1] = Math.random() * 30;
            pos[i * 3 + 2] = -60 + Math.random() * 90;
            const c = Math.random() < 0.6 ? teal : cream;
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
            this._sparkleSpeed[i] = 1.4 + Math.random() * 2.4;
        }
        this.sparkleGeo = new THREE.BufferGeometry();
        this.sparkleGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.sparkleGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        this.sparkles = new THREE.Points(this.sparkleGeo, new THREE.PointsMaterial({
            size: 0.5, vertexColors: true, transparent: true, opacity: 0.9,
            depthWrite: false, blending: THREE.AdditiveBlending, map: getGlowTexture(), fog: false,
        }));
        this.group.add(this.sparkles);
    }

    _buildLighting() {
        this.group.add(new THREE.HemisphereLight(0xCDE8F6, 0x37642C, 0.95));
        const sun = new THREE.DirectionalLight(0xFFEFD2, 1.5);
        sun.position.set(-40, 64, 26);
        this.group.add(sun);
        this.group.add(new THREE.AmbientLight(0xFFFFFF, 0.28));
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xCBE6F4);
        this.scene.fog = new THREE.Fog(0xCBE6F4, 62, 205);
        // Lower, more dramatic angle looking upstream toward the peaks
        this.camera.position.set(0, 6.2, 36);
        this.camera.lookAt(0, 4.9, -54);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        // Glowing ripple nodes floating on the river (lake-style language)
        this.songMarkers = [];
        const spots = [
            [-11, 6], [7, -3], [-2, -9], [13, 2], [-8, -15], [4, 13],
        ];
        songs.forEach((song, i) => {
            const [x, z] = spots[i % spots.length];
            const col = new THREE.Color(song.color);

            const grp = new THREE.Group();
            grp.position.set(x, 0.1, z);

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
            orb.position.y = 1.1;
            grp.add(orb);

            grp.userData = {
                songId: song.id,
                exp, orb,
                ph: i * 0.4,
                driftPh: Math.random() * Math.PI * 2,
            };
            this.group.add(grp);
            this.songMarkers.push(grp);
        });
    }

    getSongPosition(index) {
        if (this.songMarkers[index]) {
            const m = this.songMarkers[index];
            return new THREE.Vector3(m.position.x, 2.3, m.position.z);
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

        // Waves clearly travelling downstream (+z), stronger chop mid-channel
        const wp = this.riverGeo.attributes.position;
        const base = this._riverBase;
        for (let i = 0; i < wp.count; i++) {
            const x = base[i * 3], z = base[i * 3 + 2];
            const channel = 1 - Math.min(Math.abs(x) / (RIVER_W / 2), 1);
            const flow = Math.sin(z * 0.45 - time * 4.6) * 0.13
                       + Math.sin(z * 0.26 + x * 0.16 - time * 3.1) * 0.16;
            wp.setY(i, (flow + Math.cos(x * 0.42 - time * 1.4) * 0.06) * (0.4 + channel * 0.95));
        }
        wp.needsUpdate = true;

        // Foam dashes accelerate toward the camera, recycle, fade at ends
        this.streaks.forEach((s) => {
            s.position.z += s.userData.spd * 0.016 * (1 + (s.position.z + 92) / 180);
            if (s.position.z > 45) {
                s.position.z = -92;
                s.position.x = s.userData.lane + (Math.random() - 0.5) * 5;
            }
            const life = (s.position.z + 92) / 137;
            s.material.opacity = Math.sin(life * Math.PI) * s.userData.amp;
            s.position.x = s.userData.lane + Math.sin(time * 0.8 + s.position.z * 0.1) * 0.5;
        });

        // Rock foam pulses; shoreline foam shimmers
        this.foams.forEach((f) => {
            const s = f.userData.base * (1 + Math.sin(time * 4 + f.userData.ph) * 0.14);
            f.scale.setScalar(s);
            f.material.opacity = f.userData.peak * 0.7 + Math.sin(time * 4 + f.userData.ph) * 0.18;
        });
        this.shoreFoams.forEach((f) => {
            f.material.opacity = 0.35 + Math.sin(time * 3 + f.userData.ph) * 0.2;
        });

        // Mist drifts downstream
        this.mists.forEach((m) => {
            m.position.z += m.userData.spd * 0.016;
            if (m.position.z > 40) {
                m.position.z = -80;
                m.position.x = (Math.random() - 0.5) * 32;
            }
            const life = (m.position.z + 80) / 120;
            m.material.opacity = Math.sin(life * Math.PI) * 0.2;
        });

        // Clouds breathe; trees sway; birds circle
        this.clouds.forEach((c, i) => {
            const s = c.userData.base * (1 + Math.sin(time * 0.25 + c.userData.ph) * 0.02);
            c.scale.setScalar(s);
            c.position.x += Math.sin(time * 0.05 + i) * 0.002;
        });
        swayItems(this.sway, time, 0.025, 0.9);
        updateBirdFlock(this.birds, time);

        // Song nodes: expanding ripple + bobbing orb + gentle drift
        this.songMarkers.forEach((m) => {
            const k = ((time + m.userData.ph) % 2.2) / 2.2;
            const s = 0.5 + k * 2.1;
            m.userData.exp.scale.set(s, s, 1);
            m.userData.exp.material.opacity = 0.85 * (1 - k);
            m.userData.orb.position.y = 1.1 + Math.sin(time * 1.6 + m.userData.ph * 3) * 0.14;
            m.position.y = 0.1 + Math.sin(time * 1.3 + m.userData.driftPh) * 0.08;
        });

        // Sparkles rise
        const sp = this.sparkleGeo.attributes.position;
        for (let i = 0; i < this._sparkleCount; i++) {
            let y = sp.getY(i) + this._sparkleSpeed[i] * 0.016;
            if (y > 32) y = 0;
            sp.setY(i, y);
        }
        sp.needsUpdate = true;
    }

    dispose() {
        if (this.mirror) {
            this.mirror.getRenderTarget().dispose();
        }
        super.dispose();
    }
}
