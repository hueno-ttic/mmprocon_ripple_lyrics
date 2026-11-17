import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import * as K from '../sceneKit.js';

// Phase 5「川」— a powerful river running down between forested banks toward a
// distant mountain range, foam streaking downstream. (design scene5)
export class PhaseRiver extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this.exposure = 1.16;
        this.bloomParams = { strength: 0.48, radius: 0.5, threshold: 0.84 };
        this.cameraRig = {
            pos: [0, 6.2, 36], lookAt: [0, 4.9, -54],
            drift: { ax: 2.0, fx: 0.10, ay: 0.25, fy: 0.17 },
        };
        this.dpr = Math.min(window.devicePixelRatio, 2);
        this.RIVER_W = 36; this.RIVER_LEN = 150; this.RIVER_CZ = -30;
        this._build();
    }

    _build() {
        const g = this.group;
        K.addSky(g, 0x2C7AC8, 0x77B3EC, 0xDFF0FB);
        const sun = K.addLights(g, { sunPos: [-40, 64, 26], sunCol: 0xFFEFD2, sunInt: 2.35, hemi: 0.66, skyCol: 0xCDE8F6, groundCol: 0x37642C, amb: 0.16 });
        this.sunDisc = K.addSunDisc(g, sun.position, { dist: 195, glow: 95, r: 7 });

        // distant range framing the river source
        const peaks = [[0, -96, 30, 26, 0.62], [-30, -94, 18, 17, 0.74], [30, -95, 20, 18, 0.72], [-54, -92, 14, 15, 0.8], [54, -92, 15, 15, 0.8], [-78, -90, 11, 13, 0.82], [78, -90, 12, 13, 0.82]];
        peaks.forEach(([x, z, h, r, snow]) => { const m = K.makeMountain({ h, r, radial: 12, rings: 7, concave: 1.18, noise: 0.06, jitter: 0.035, snow, topR: 0.05, body0: 0xA6C0DB, body1: 0x6B8BB2, snowCol: 0xF4FAFF }); m.position.set(x, 0, z); g.add(m); });

        // ground base under everything
        const ground = new THREE.Mesh(new THREE.BoxGeometry(320, 6, 200), new THREE.MeshStandardMaterial({ color: 0x356B2B, flatShading: true, roughness: 1 }));
        ground.position.set(0, -3.2, -40); ground.receiveShadow = true; g.add(ground);

        // forested banks framing the river
        const bankMat = new THREE.MeshStandardMaterial({ color: 0x4F9C3C, flatShading: true, roughness: 1 });
        const bankMat2 = new THREE.MeshStandardMaterial({ color: 0x3E7E30, flatShading: true, roughness: 1 });
        const embankment = side => {
            const len = 150, depthW = 70; const geo = new THREE.PlaneGeometry(depthW, len, 14, 30); geo.rotateX(-Math.PI / 2);
            const p = geo.attributes.position;
            for (let i = 0; i < p.count; i++) { const lx = p.getX(i); const lz = p.getZ(i); const edge = (lx + depthW / 2) / depthW; let yy = Math.pow(edge, 0.7) * 9.0 + Math.sin(lz * 0.10) * 1.4 + Math.cos(lx * 0.18 + lz * 0.05) * 0.9; if (edge < 0.04) yy = -1.2; p.setY(i, yy); }
            geo.computeVertexNormals(); const m = new THREE.Mesh(geo, side < 0 ? bankMat : bankMat2); m.receiveShadow = true; m.castShadow = true; m.position.set(side * (16 + depthW / 2), 0, -30); return m;
        };
        g.add(embankment(-1)); g.add(embankment(+1));
        // low grassy shelf at each waterline
        const shelfMat = new THREE.MeshStandardMaterial({ color: 0x47913a, flatShading: true, roughness: 1 });
        [[-1], [1]].forEach(([s]) => { const sh = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 150, 1, 1, 30), shelfMat); const pp = sh.geometry.attributes.position; for (let i = 0; i < pp.count; i++) { if (pp.getY(i) > 0) pp.setY(i, pp.getY(i) + Math.sin(pp.getZ(i) * 0.2) * 0.3); } sh.geometry.computeVertexNormals(); sh.position.set(s * 19.5, 0.2, -30); sh.receiveShadow = true; g.add(sh); });

        // dense forest on both banks
        const tm = K.treeMats({ a: 0x2E6B34, b: 0x357F39, c: 0x255A2C });
        this.trees = [];
        const plantBank = side => {
            const n = K.isMobile() ? 34 : 56;
            for (let i = 0; i < n; i++) { const z = -100 + Math.random() * 138; const across = 18.5 + Math.pow(Math.random(), 0.62) * 38; const x = side * across + (Math.random() - 0.5) * 3; const edge = (across - 16) / 70; const gy = Math.pow(Math.max(edge, 0), 0.7) * 9.0 - 0.3 + Math.sin(z * 0.10) * 1.0; const near = Math.max(1 - (across - 18.5) / 30, 0); const s = 1.0 + Math.random() * 0.7 + near * 0.7; const t = (Math.random() < 0.55) ? K.pineTree(s, tm) : K.roundTree(s, tm); t.position.set(x, gy, z); t.rotation.y = Math.random() * 6.28; t.userData.ph = Math.random() * 6.28; g.add(t); this.trees.push(t); }
        };
        plantBank(-1); plantBank(+1);

        // boulders breaking the current
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x6E737A, flatShading: true, roughness: 1 });
        const rockMat2 = new THREE.MeshStandardMaterial({ color: 0x595E64, flatShading: true, roughness: 1 });
        const makeRock = s => { const geo = new THREE.IcosahedronGeometry(1, 1); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); v.multiplyScalar(1 + 0.32 * Math.sin(v.x * 3 + v.y * 2.5) + 0.18 * Math.cos(v.z * 4)); p.setXYZ(i, v.x, v.y * 0.78, v.z); } geo.computeVertexNormals(); const m = new THREE.Mesh(geo, Math.random() < 0.5 ? rockMat : rockMat2); m.scale.setScalar(s); m.castShadow = true; m.receiveShadow = true; return m; };
        const rockSpots = [[-10, -4, 2.5], [8, -9, 2.8], [-3, 5, 2.1], [13, 0, 2.1], [-14, -13, 2.3], [5, 13, 1.9]];
        const rocks = [];
        rockSpots.forEach(([x, z, s]) => { const r = makeRock(s); r.position.set(x, 0.1, z); r.rotation.y = Math.random() * 6.28; g.add(r); rocks.push({ x, z, s }); });

        // river: reflective base + flowing surface (depth-tinted)
        this.water = K.addWater(g, { w: this.RIVER_W, len: this.RIVER_LEN, cz: this.RIVER_CZ, y: 0.06, dpr: this.dpr, mirrorColor: 0x1d3a57, colors: [0x1c4f86, 0x2E72BE, 0x4f9bd8], opacity: 0.74, roughness: 0.36, metalness: 0.14, segW: 48, segL: 110 });

        // foam streaks: flat dashes flowing ON the water surface
        const streakMat = new THREE.MeshBasicMaterial({ map: K.streakTex(), color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false, fog: true, blending: THREE.NormalBlending, side: THREE.DoubleSide });
        const streakGeo = new THREE.PlaneGeometry(1, 1); streakGeo.rotateX(-Math.PI / 2);
        this.streaks = []; const STREAKS = K.isMobile() ? 54 : 96;
        for (let i = 0; i < STREAKS; i++) { const m = new THREE.Mesh(streakGeo, streakMat.clone()); const lane = (Math.random() - 0.5) * 30; const len = 5 + Math.random() * 11; const wid = 0.45 + Math.random() * 0.7; m.scale.set(wid, 1, len); m.position.set(lane, 0.13, -90 + Math.random() * 132); m.userData = { lane, spd: 13 + Math.random() * 10, len, amp: 0.4 + Math.random() * 0.38 }; g.add(m); this.streaks.push(m); }

        // white-water foam crowns + downstream wakes around rocks
        const foamMat = new THREE.SpriteMaterial({ map: K.glowTex('rgba(255,255,255,0.98)', 'rgba(226,242,255,0.55)'), color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.NormalBlending, fog: true });
        this.foams = [];
        rocks.forEach(r => {
            const crown = [[0, -1.0, 1.9], [-0.85, -0.4, 1.3], [0.85, -0.4, 1.3], [0, -0.1, 1.5]];
            crown.forEach(o => { const f = new THREE.Sprite(foamMat.clone()); f.position.set(r.x + o[0] * r.s, 0.24, r.z + o[1] * r.s); const base = r.s * o[2] * 0.62; f.scale.setScalar(base); f.userData = { ph: Math.random() * 6.28, base }; g.add(f); this.foams.push(f); });
            for (let k = 0; k < 3; k++) { const w = new THREE.Sprite(foamMat.clone()); w.material.opacity = 0.5 - k * 0.13; w.position.set(r.x + (Math.random() - 0.5) * 0.4 * r.s, 0.22, r.z - (1.0 + k * 0.9) * r.s); const base = r.s * (1.1 - k * 0.22) * 0.55; w.scale.setScalar(base); w.userData = { ph: Math.random() * 6.28, base, wake: 0.5 - k * 0.13 }; g.add(w); this.foams.push(w); }
        });

        // shoreline foam
        const shoreFoamMat = new THREE.SpriteMaterial({ map: K.glowTex('rgba(255,255,255,0.9)', 'rgba(220,240,255,0.4)'), color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, fog: true });
        this.shoreFoams = [];
        [-1, 1].forEach(side => { for (let i = 0; i < 20; i++) { const z = -88 + i * 6.6 + (Math.random() - 0.5) * 2; const f = new THREE.Sprite(shoreFoamMat.clone()); f.position.set(side * (16.5 + Math.random() * 1.2), 0.2, z); const base = 1.3 + Math.random() * 0.9; f.scale.set(base * 2.2, base * 0.5, 1); f.userData = { ph: Math.random() * 6.28, base }; g.add(f); this.shoreFoams.push(f); } });

        // drifting mist
        const mistMat = new THREE.SpriteMaterial({ map: K.glowTex('rgba(255,255,255,0.45)', 'rgba(230,244,255,0.14)'), color: 0xeaf4ff, transparent: true, opacity: 0.0, depthWrite: false, fog: true });
        this.mists = [];
        for (let i = 0; i < 9; i++) { const m = new THREE.Sprite(mistMat.clone()); const z = -78 + Math.random() * 96; m.position.set((Math.random() - 0.5) * 32, 1.8 + Math.random() * 2.0, z); const base = 14 + Math.random() * 10; m.scale.set(base * 2.6, base * 0.42, 1); m.userData = { ph: Math.random() * 6.28, spd: 1.6 + Math.random() * 2.4, base }; g.add(m); this.mists.push(m); }

        this.clouds = K.addClouds(g, [[-58, 60, -150, 1.15], [60, 56, -140, 0.9], [4, 70, -180, 1.05]]);
        this.sparkles = K.addSparkles(g, { count: 80, area: [70, 30, 90], zoff: -60, maxY: 32, size: 0.5, mix: 0.6, colorA: 0x6FF0E4, colorB: 0xFFF6CF });
        this.birds = K.addBirds(g, { count: 6, y: 40, z: -78 });
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xCBE6F4);
        this.scene.fog = new THREE.Fog(0xCBE6F4, 62, 205);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        const layout = [
            { x: -11, z: 6 }, { x: 7, z: -3 }, { x: -2, z: -9 },
            { x: 13, z: 2 }, { x: -8, z: -15 }, { x: 4, z: 13 },
        ];
        this.nodes = K.createSongNodes(this.group, layout, songs, { y: 0.1, orbY: 1.1 });
        this.songMarkers = this.nodes.markers;
    }

    update(time) {
        if (this.disposed) return;
        const W = this.RIVER_W;
        // river: waves travelling downstream (-z, toward the distant range), stronger chop in the channel
        this.water.update(time, (x, z) => { const channel = 1 - Math.min(Math.abs(x) / (W / 2), 1); const flow = Math.sin(z * 0.45 + time * 4.6) * 0.13 + Math.sin(z * 0.26 + x * 0.16 + time * 3.1) * 0.16; return (flow + Math.cos(x * 0.42 - time * 1.4) * 0.06) * (0.4 + channel * 0.95); });

        this.streaks.forEach(s => { s.position.z -= s.userData.spd * 0.016 * (1 + (s.position.z + 92) / 180); if (s.position.z < -92) { s.position.z = 45; s.userData.lane = s.userData.lane + (Math.random() - 0.5) * 5; } const life = (s.position.z + 92) / 137; s.material.opacity = Math.sin(life * Math.PI) * s.userData.amp; s.position.x = s.userData.lane + Math.sin(time * 0.8 + s.position.z * 0.1) * 0.5; });
        this.foams.forEach(f => { const s = f.userData.base * (1 + Math.sin(time * 4 + f.userData.ph) * 0.14); f.scale.setScalar(s); const peak = f.userData.wake !== undefined ? f.userData.wake : 0.82; f.material.opacity = peak * 0.7 + Math.sin(time * 4 + f.userData.ph) * 0.18; });
        this.shoreFoams.forEach(f => { f.material.opacity = 0.35 + Math.sin(time * 3 + f.userData.ph) * 0.2; });
        this.mists.forEach(m => { m.position.z -= m.userData.spd * 0.016; if (m.position.z < -80) { m.position.z = 40; m.position.x = (Math.random() - 0.5) * 32; } const life = (m.position.z + 80) / 120; m.material.opacity = Math.sin(life * Math.PI) * 0.2; });
        this.clouds.update(time);
        this.trees.forEach(tr => { tr.rotation.z = Math.sin(time * 0.9 + tr.userData.ph) * 0.025; });
        this.nodes.update(time); this.sparkles.update(); this.birds.update(time); this.sunDisc.update(this.camera);
    }
}
