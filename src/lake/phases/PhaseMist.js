import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import * as K from '../sceneKit.js';

// Phase 0「晴れ」— a sunlit meadow with a small spring. Sunlight draws water
// vapor upward: the journey of a single drop begins here. (design scene0)
export class PhaseMist extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this.exposure = 1.12;
        this.bloomParams = { strength: 0.26, radius: 0.5, threshold: 0.96 };
        this.cameraRig = {
            pos: [0, 6.4, 36], lookAt: [0, 3.6, -40],
            drift: { ax: 2.4, fx: 0.10, ay: 0.28, fy: 0.16 },
        };
        this.dpr = Math.min(window.devicePixelRatio, 2);

        // pond centre + ellipse radii (used for stone placement)
        this.PX = 0; this.PZ = 10; this.PRX = 7.5; this.PRZ = 6.5;

        this._build();
    }

    _build() {
        const g = this.group;
        K.addSky(g, 0x3486CE, 0x86BDEE, 0xEAF6FD);
        this.sun = K.addLights(g, { sunPos: [38, 60, 24], sunCol: 0xFFF3D6, sunInt: 2.4, hemi: 0.74, groundCol: 0x4E8C36 });
        this.sunDisc = K.addSunDisc(g, this.sun.position, { dist: 200, glow: 110, r: 8 });

        this._buildMeadow();
        this._buildSpring();
        this._buildStones();
        this._buildTreesAndFlowers();

        this.clouds = K.addClouds(g, [[-46, 52, -140, 1.0], [54, 58, -150, 0.85], [6, 64, -180, 1.0]]);
        // evaporation shimmer rising from the small spring
        this.evap = K.addSparkles(g, { count: 40, area: [13, 18, 11], zoff: 0, maxY: 20, size: 0.55, mix: 0.7, colorA: 0x9FF0E6, colorB: 0xFFFFFF });
        this.evap.pts.position.set(this.PX, 0.2, this.PZ);
        this.motes = K.addSparkles(g, { count: 70, area: [120, 28, 120], zoff: -60, maxY: 30, size: 0.45, mix: 0.55, colorA: 0x9FE9DE, colorB: 0xFFF3C8 });
        this.birds = K.addBirds(g, { count: 6, y: 42, z: -86 });
    }

    _buildMeadow() {
        // 草原の地面。セグメントを80×70→56×48に削減(約5.7k→2.7k頂点)。見た目の差はほぼ無い。
        const groundGeo = new THREE.PlaneGeometry(340, 300, 56, 48); groundGeo.rotateX(-Math.PI / 2);
        const p = groundGeo.attributes.position; const cols = new Float32Array(p.count * 3);
        const lo = new THREE.Color(0x3C7A2E), hi = new THREE.Color(0x6CB04A), dry = new THREE.Color(0x86B84E);
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i);
            const h = Math.sin(x * 0.06) * 1.6 + Math.cos(z * 0.05 + 1) * 1.8 + Math.sin((x + z) * 0.03) * 1.2 + Math.sin(x * 0.16 + z * 0.1) * 0.5;
            p.setY(i, h);
            const t = THREE.MathUtils.clamp((h + 3) / 7, 0, 1);
            const c = lo.clone().lerp(hi, t).lerp(dry, Math.max(t - 0.6, 0) * 0.5);
            cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
        }
        groundGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); groundGeo.computeVertexNormals();
        const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
        ground.position.set(0, -0.5, -40); ground.receiveShadow = true; this.group.add(ground);

        // green ridge behind the meadow (clearly green, lightly hazed)
        [[-52, -62, 16, 32], [40, -66, 19, 38], [88, -60, 14, 28], [-96, -64, 13, 26], [6, -74, 22, 46]].forEach(([x, z, h, r]) => {
            const m = K.makeMountain({ h, r, radial: 11, rings: 5, concave: 1.5, noise: 0.08, jitter: 0.05, snow: 1.3, body0: 0x3F7E28, body1: 0x295411 });
            m.position.set(x, -0.5, z); this.group.add(m);
        });
        [[-30, -128, 20, 40], [55, -134, 22, 44]].forEach(([x, z, h, r]) => {
            const m = K.makeMountain({ h, r, radial: 9, rings: 4, concave: 1.5, noise: 0.07, jitter: 0.04, snow: 1.3, body0: 0x5A8C44, body1: 0x3F7030 });
            m.position.set(x, -0.5, z); this.group.add(m);
        });
    }

    _buildSpring() {
        this.water = K.addWater(this.group, {
            w: 15, len: 13, cz: this.PZ, x: this.PX, y: 0.12, dpr: this.dpr, mirrorColor: 0x3a6f8e,
            colors: [0x2f7fb8, 0x4f9fd6, 0x9fd8f0], opacity: 0.6, roughness: 0.2, metalness: 0.3, segW: 24, segL: 24,
        });
    }

    _buildStones() {
        const stoneMatA = new THREE.MeshStandardMaterial({ color: 0x8a8f96, flatShading: true, roughness: 1 });
        const stoneMatB = new THREE.MeshStandardMaterial({ color: 0x767b82, flatShading: true, roughness: 1 });
        const placeStone = (x, z, s) => {
            const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position;
            for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); v.multiplyScalar(1 + 0.32 * Math.sin(v.x * 3 + v.y * 2) + 0.16 * Math.cos(v.z * 4)); p.setXYZ(i, v.x, v.y * 0.72, v.z); }
            g.computeVertexNormals();
            const m = new THREE.Mesh(g, Math.random() < 0.5 ? stoneMatA : stoneMatB);
            m.scale.set(s, s * (0.55 + Math.random() * 0.3), s); m.position.set(x, s * 0.18, z);
            m.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * 6.28, (Math.random() - 0.5) * 0.3);
            m.castShadow = true; m.receiveShadow = true; this.group.add(m);
        };
        const { PX, PZ, PRX, PRZ } = this;
        const clusters = [{ a: -0.4, n: 4 }, { a: 1.0, n: 3 }, { a: 2.5, n: 5 }, { a: 4.1, n: 2 }, { a: 5.3, n: 3 }];
        clusters.forEach(cl => { for (let i = 0; i < cl.n; i++) { const a = cl.a + (Math.random() - 0.5) * 0.8; const rr = 1.0 + Math.random() * 0.5; placeStone(PX + Math.cos(a) * PRX * rr, PZ + Math.sin(a) * PRZ * rr, 0.45 + Math.random() * 0.85); } });
        placeStone(PX - 2.0, PZ - 1.0, 0.6); placeStone(PX + 2.6, PZ + 1.4, 0.5);
        [[-22, -12, 1.7], [26, -22, 1.4], [-32, 2, 1.2], [17, -6, 1.0], [8, -30, 1.5]].forEach(([x, z, s]) => placeStone(x, z, s));
    }

    _buildTreesAndFlowers() {
        const tm = K.treeMats({ a: 0x3C8A3A, b: 0x4FA046, c: 0x2E6E2C });
        this.trees = [];
        [[-22, 2, -18], [26, 1.5, -26], [-34, 1, -40], [40, 2, -44]].forEach(([x, y, z]) => {
            const t = K.roundTree(1.6 + Math.random() * 0.8, tm); t.position.set(x, y, z); t.userData.ph = Math.random() * 6.28; this.group.add(t); this.trees.push(t);
        });
        const flowerCols = [0xF4D03F, 0xFFFFFF, 0xE8553F, 0x9D7BEA];
        const fGeo = new THREE.SphereGeometry(0.18, 6, 5);
        for (let i = 0; i < 120; i++) {
            const x = (Math.random() - 0.5) * 150, z = -30 + (Math.random() - 0.5) * 120;
            if (Math.hypot(x, z - this.PZ) < 9.5) continue;
            const h = Math.sin(x * 0.06) * 1.6 + Math.cos(z * 0.05 + 1) * 1.8 + Math.sin((x + z) * 0.03) * 1.2;
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4), tm.c); stem.position.set(x, h - 0.5 + 0.35, z);
            const head = new THREE.Mesh(fGeo, new THREE.MeshStandardMaterial({ color: flowerCols[i % 4], flatShading: true, roughness: 0.8, emissive: flowerCols[i % 4], emissiveIntensity: 0.12 }));
            head.position.set(x, h - 0.5 + 0.72, z); this.group.add(stem, head);
        }
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xD7E4EC);
        this.scene.fog = new THREE.Fog(0xD7E4EC, 42, 192);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        // nodes scattered across the meadow + one on the spring (centre)
        const layout = [
            { x: this.PX, z: this.PZ }, { x: -13, z: -6 }, { x: 12, z: -4 },
            { x: -9, z: -20 }, { x: 14, z: -18 }, { x: 2, z: -30 },
        ];
        this.nodes = K.createSongNodes(this.group, layout, songs, { y: 0.12, orbY: 1.2 });
        this.songMarkers = this.nodes.markers;
    }

    update(time) {
        if (this.disposed) return;
        this.water.update(time, (x, z, tt) => Math.sin(x * 0.5 + tt * 1.4) * 0.05 + Math.cos(z * 0.5 + tt * 1.1) * 0.05);
        this.clouds.update(time); this.evap.update(); this.motes.update();
        this.nodes.update(time); this.birds.update(time);
        this.trees.forEach(tr => { tr.rotation.z = Math.sin(time * 0.8 + tr.userData.ph) * 0.02; });
        this.sunDisc.update(this.camera);
    }
}
