import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import * as K from '../sceneKit.js';

// Phase 4「小川」— a clear brook meandering through a valley toward the misty
// forest. Banks rise naturally from the waterline. (design scene4)
export class PhaseStream extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this.exposure = 1.15;
        this.bloomParams = { strength: 0.34, radius: 0.55, threshold: 0.85 };
        // The brook used to run straight down the view axis — a thin vertical
        // ribbon dead-center, fully hidden behind the jacket card so the scene
        // read as a plain meadow. Re-framed per device so the water always shows:
        //  - Desktop: a side-oblique vantage sweeps the brook across the wide
        //    lower-left foreground, clear of the centered card.
        //  - Mobile: the tall, narrow frame's big centered card fills the whole
        //    valley, so we lift to an elevated vantage and look down at the
        //    meander — the brook winds through the open frame above the card.
        const mobile = K.isMobile();
        this.cameraRig = mobile
            ? { pos: [6, 27, 20], lookAt: [1, 0, -18], drift: { ax: 0.8, fx: 0.09, ay: 0.18, fy: 0.15 } }
            : { pos: [25, 10.5, 31], lookAt: [-9, 0.1, -30], drift: { ax: 1.0, fx: 0.09, ay: 0.16, fy: 0.15 } };
        this._build();
    }

    _build() {
        const g = this.group;
        K.addSky(g, 0x86B6D6, 0xC2DAD8, 0xF2EFD6);
        const sun = K.addLights(g, { sunPos: [-40, 44, 28], sunCol: 0xFFE4B2, sunInt: 1.6, hemi: 0.72, groundCol: 0x4C7233 });
        this.sunDisc = K.addSunDisc(g, sun.position, { dist: 175, glow: 86, r: 6.5, inner: 'rgba(255,244,214,0.95)', outer: 'rgba(255,226,170,0.34)' });
        const sunDir = sun.position.clone().normalize();

        // meandering stream centerlines (near camera -> far). t=0 near, t=1 far.
        // Bolder left-right swings + a wider near mouth so the brook unmistakably
        // snakes through the frame (the gentle old wiggle read as a flat ribbon
        // once seen from the side).
        const mainPts = [[12, 36], [-8, 18], [11, -2], [-10, -26], [6, -50], [-4, -76], [1, -100]];
        this.mainCurve = new THREE.CatmullRomCurve3(mainPts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'catmullrom', 0.5);
        const mainWidth = t => 7.6 - t * 4.4;
        const sidePts = [[28, 2], [19, -1], [11, -3], [5.5, -4.5]];
        this.sideCurve = new THREE.CatmullRomCurve3(sidePts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'catmullrom', 0.5);
        const sideWidth = t => 2.8 - t * 1.3;

        // sample both curves for distance queries
        const samples = [];
        [[this.mainCurve, mainWidth, 150], [this.sideCurve, sideWidth, 60]].forEach(([c, wf, n]) => { for (let i = 0; i <= n; i++) { const t = i / n; const p = c.getPoint(t); samples.push([p.x, p.z, wf(t) / 2]); } });
        const nearStream = (x, z) => { let best = 1e9, half = 3; for (const s of samples) { const dx = x - s[0], dz = z - s[1]; const d = dx * dx + dz * dz; if (d < best) { best = d; half = s[2]; } } return { d: Math.sqrt(best), half }; };
        const terrainY = (x, z) => {
            const { d, half } = nearStream(x, z); const e = d - half;
            const hills = (Math.sin(x * 0.05 + z * 0.01) * 1.3 + Math.cos(z * 0.045) * 1.0 + Math.sin((x * 0.7 + z) * 0.022) * 0.7) * 0.6;
            if (e < 0) return -0.4 + Math.sin(x * 0.5 + z * 0.4) * 0.08;
            const bank = Math.min(e / 7, 1); return 0.14 + bank * bank * 2.3 + hills * bank;
        };

        // valley terrain (banks + bed in one heightfield)
        // 背景の谷地形。flatShadingなので高密度セグメントは見た目にほぼ寄与せず、
        // 頂点数(=シャドウ/描画コスト)だけ嵩むため128×118→72×64に削減(約15k→4.7k頂点)。
        const TGEO = new THREE.PlaneGeometry(280, 260, 72, 64); TGEO.rotateX(-Math.PI / 2);
        { const p = TGEO.attributes.position; const cols = new Float32Array(p.count * 3);
            const bedC = new THREE.Color(0x7d8a76), wetC = new THREE.Color(0x3f6b3a), bankC = new THREE.Color(0x4f9b35), hiC = new THREE.Color(0x77c44c), dryC = new THREE.Color(0x9fcf63);
            for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const y = terrainY(x, z); p.setY(i, y);
                const { d, half } = nearStream(x, z); const e = d - half; let c;
                if (e < 0) c = bedC.clone();
                else if (e < 1.6) c = wetC.clone().lerp(bankC, e / 1.6);
                else { const h = Math.min(Math.max((y - 0.4) / 4, 0), 1); c = bankC.clone().lerp(hiC, Math.min(e / 8, 1)).lerp(dryC, h * 0.5); }
                cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
            }
            TGEO.setAttribute('color', new THREE.BufferAttribute(cols, 3)); TGEO.computeVertexNormals();
        }
        const terrain = new THREE.Mesh(TGEO, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
        terrain.receiveShadow = true; g.add(terrain);

        // meandering water ribbons
        const buildWater = (curve, wf, segs) => {
            const pos = [], col = [], idx = [];
            const ctr = new THREE.Color(0xd6f0f0), mid = new THREE.Color(0x74bce0), deep = new THREE.Color(0x3f8fc6);
            for (let i = 0; i <= segs; i++) { const t = i / segs; const p = curve.getPoint(t); const tan = curve.getTangent(t); let ux = -tan.z, uz = tan.x; const nl = Math.hypot(ux, uz) || 1; ux /= nl; uz /= nl; const hw = wf(t) / 2;
                for (let k = -1; k <= 1; k++) { pos.push(p.x + ux * hw * k, 0.07, p.z + uz * hw * k); const c = (k === 0 ? ctr : mid).clone(); if (k !== 0) c.lerp(deep, 0.35); col.push(c.r, c.g, c.b); } }
            for (let i = 0; i < segs; i++) for (let k = 0; k < 2; k++) { const a = i * 3 + k, b = a + 1, cc = (i + 1) * 3 + k, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
            const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
            const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.88, flatShading: true, roughness: 0.22, metalness: 0.2, side: THREE.DoubleSide }));
            g.add(m); return { g: geo, base: geo.attributes.position.array.slice(), segs };
        };
        this.mainW = buildWater(this.mainCurve, mainWidth, 150);
        this.sideW = buildWater(this.sideCurve, sideWidth, 60);

        // sun glints sparkling along the flow
        const glintMat = new THREE.SpriteMaterial({ map: K.glowTex('rgba(255,255,255,0.95)', 'rgba(214,244,255,0.3)'), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
        this.glints = [];
        for (let i = 0; i < 46; i++) { const useMain = Math.random() < 0.78; const s = new THREE.Sprite(glintMat.clone()); s.scale.setScalar(0.45 + Math.random() * 0.6); this.glints.push({ s, curve: useMain ? this.mainCurve : this.sideCurve, wf: useMain ? mainWidth : sideWidth, t: Math.random(), lat: (Math.random() - 0.5) * 0.7, sp: 0.018 + Math.random() * 0.03, ph: Math.random() * 6.28 }); g.add(s); }

        // foam at rocks / tight bends
        const foamMat = new THREE.SpriteMaterial({ map: K.glowTex('rgba(255,255,255,0.95)', 'rgba(226,242,255,0.5)'), color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, fog: true });
        this.foams = [];
        const addFoam = (x, z, s) => { const f = new THREE.Sprite(foamMat.clone()); f.position.set(x, 0.2, z); f.scale.setScalar(s); f.userData = { ph: Math.random() * 6.28, base: s }; g.add(f); this.foams.push(f); };

        // mossy boulders in / beside the stream
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x787d82, flatShading: true, roughness: 1 });
        const rockMat2 = new THREE.MeshStandardMaterial({ color: 0x666c72, flatShading: true, roughness: 1 });
        const mossMat = new THREE.MeshStandardMaterial({ color: 0x4f8a36, flatShading: true, roughness: 1 });
        const makeRock = s => { const geo = new THREE.IcosahedronGeometry(1, 1); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); v.multiplyScalar(1 + 0.3 * Math.sin(v.x * 3 + v.y * 2.5) + 0.16 * Math.cos(v.z * 4)); p.setXYZ(i, v.x, v.y * 0.8, v.z); } geo.computeVertexNormals(); const m = new THREE.Mesh(geo, Math.random() < 0.5 ? rockMat : rockMat2); m.scale.setScalar(s); m.castShadow = true; return m; };
        [0.12, 0.3, 0.55, 0.78, 0.93, 0.07].forEach((t, i) => { const p = this.mainCurve.getPoint(t); const tan = this.mainCurve.getTangent(t); let ux = -tan.z, uz = tan.x; const nl = Math.hypot(ux, uz) || 1; ux /= nl; uz /= nl; const off = (i % 2 ? 1 : -1) * (mainWidth(t) / 2 + 0.2);
            const x = p.x + ux * off, z = p.z + uz * off; const s = 0.5 + Math.random() * 0.5; const r = makeRock(s); r.position.set(x, 0.0, z); r.rotation.y = Math.random() * 6.28; g.add(r);
            if (Math.random() < 0.6) { const m = new THREE.Mesh(new THREE.SphereGeometry(s * 0.82, 8, 6, 0, 6.28, 0, 1.0), mossMat); m.position.set(x, s * 0.2, z); g.add(m); }
            addFoam(p.x + ux * (mainWidth(t) / 2 * 0.4), p.z + uz * (mainWidth(t) / 2 * 0.4), s * 0.9); });
        addFoam(5.5, -4.5, 1.0); addFoam(4, -6, 0.8);

        // grass tufts + ferns hugging the banks
        const gA = new THREE.MeshStandardMaterial({ color: 0x4f9b35, flatShading: true, roughness: 1 });
        const gB = new THREE.MeshStandardMaterial({ color: 0x6cbf45, flatShading: true, roughness: 1 });
        const tuft = (x, y, z, sc) => { const grp = new THREE.Group(); const n = 5 + (Math.random() * 4 | 0); for (let b = 0; b < n; b++) { const h = 0.5 + Math.random() * 0.7; const bl = new THREE.Mesh(new THREE.ConeGeometry(0.05, h, 3), Math.random() < 0.5 ? gA : gB); bl.position.set((Math.random() - 0.5) * 0.5, h / 2, (Math.random() - 0.5) * 0.5); bl.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 6.28, (Math.random() - 0.5) * 0.4); grp.add(bl); } grp.position.set(x, y, z); grp.scale.setScalar(sc); grp.userData.ph = Math.random() * 6.28; return grp; };
        this.tufts = [];
        const tuftN = K.isMobile() ? 180 : 320;
        for (let i = 0; i < tuftN; i++) { const x = (Math.random() - 0.5) * 120, z = -96 + Math.random() * 150; const { d, half } = nearStream(x, z); const e = d - half; if (e < 0.2 || e > 3.4) continue; const tf = tuft(x, terrainY(x, z) - 0.1, z, 0.7 + Math.random() * 0.8); g.add(tf); this.tufts.push(tf); }
        const fernMat = new THREE.MeshStandardMaterial({ color: 0x357a2b, flatShading: true, roughness: 1, side: THREE.DoubleSide });
        for (let i = 0; i < 30; i++) { const x = (Math.random() - 0.5) * 110, z = -90 + Math.random() * 150; const { d, half } = nearStream(x, z); const e = d - half; if (e < 0.3 || e > 2.4) { i--; continue; } const fr = new THREE.Group(); for (let f = 0; f < 6; f++) { const bl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 1.5), fernMat); bl.position.y = 0.5; bl.rotation.z = (f - 2.5) * 0.32; bl.rotation.y = Math.random() * 0.4; fr.add(bl); } fr.position.set(x, terrainY(x, z), z); fr.rotation.y = Math.random() * 6.28; fr.scale.setScalar(0.8 + Math.random() * 0.6); g.add(fr); }

        // trees on higher ground, receding into mist
        const tm = K.treeMats({ a: 0x2F7A38, b: 0x3C9140, c: 0x245B2A });
        this.trees = [];
        const treeN = K.isMobile() ? 64 : 110;
        for (let i = 0; i < treeN; i++) { const x = (Math.random() - 0.5) * 150, z = -100 + Math.random() * 150; const { d, half } = nearStream(x, z); if (d - half < 5.5) continue; const s = 1.0 + Math.random() * 1.0; const t = (Math.random() < 0.5) ? K.pineTree(s, tm) : K.roundTree(s, tm); t.position.set(x, terrainY(x, z) - 0.2, z); t.rotation.y = Math.random() * 6.28; t.userData.ph = Math.random() * 6.28; g.add(t); this.trees.push(t); }

        // mossy fallen log spanning a narrow bend
        { const p = this.mainCurve.getPoint(0.62); const tan = this.mainCurve.getTangent(0.62); const ang = Math.atan2(tan.x, tan.z);
            const logMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, flatShading: true, roughness: 1 });
            const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 8, 7), logMat); log.rotation.z = Math.PI / 2; log.rotation.y = ang + Math.PI / 2; log.position.set(p.x, 0.9, p.z); log.castShadow = true; g.add(log);
            const moss = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 8, 7, 1, true, 0, Math.PI * 0.9), mossMat); moss.rotation.z = Math.PI / 2; moss.rotation.y = ang + Math.PI / 2; moss.position.set(p.x, 1.02, p.z); g.add(moss); }

        // dappled light shafts + surface mist + motes
        this.shaftGroup = new THREE.Group(); g.add(this.shaftGroup);
        for (let i = 0; i < 7; i++) { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7 + i * 0.2, 28, 5, 1, true), new THREE.MeshBasicMaterial({ color: 0xFFE7B0, transparent: true, opacity: 0.04, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })); cone.position.copy(sunDir.clone().multiplyScalar(16)).add(new THREE.Vector3((i - 3) * 5.5, -1, -26 + (Math.random() - 0.5) * 12)); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir); cone.userData = { ph: i * 0.7, base: 0.028 + Math.random() * 0.016 }; this.shaftGroup.add(cone); }
        const mistMat = new THREE.SpriteMaterial({ map: K.glowTex('rgba(255,255,255,0.5)', 'rgba(228,242,255,0.16)'), color: 0xeef6ff, transparent: true, opacity: 0, depthWrite: false, fog: true });
        this.mists = []; for (let i = 0; i < 12; i++) { const t = 0.35 + Math.random() * 0.6; const p = this.mainCurve.getPoint(t); const m = new THREE.Sprite(mistMat.clone()); m.position.set(p.x + (Math.random() - 0.5) * 6, 0.8 + Math.random() * 1.2, p.z); const base = 6 + Math.random() * 6; m.scale.set(base * 2.1, base * 0.42, 1); m.userData = { spd: 0.6 + Math.random() * 1.0, z0: p.z }; g.add(m); this.mists.push(m); }
        this.motes = K.addSparkles(g, { count: 80, area: [110, 22, 150], zoff: -70, maxY: 24, size: 0.45, mix: 0.5, colorA: 0xBFF0D0, colorB: 0xFFE9B8 });

        this._mainWidth = mainWidth; this._sideWidth = sideWidth;
        this._v = new THREE.Vector3(); this._t = new THREE.Vector3();
    }

    _rippleWater(w, t) {
        const p = w.g.attributes.position, b = w.base;
        for (let i = 0; i < p.count; i++) { const row = (i / 3) | 0; const x = b[i * 3], z = b[i * 3 + 2]; p.setY(i, 0.07 + Math.sin(row * 0.5 - t * 2.2) * 0.05 + Math.sin(x * 0.5 + z * 0.3 - t * 1.5) * 0.035); }
        p.needsUpdate = true; w.g.computeVertexNormals();
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xDEE9D2);
        this.scene.fog = new THREE.Fog(0xDEE9D2, 40, 175);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        // nodes resting along the brook
        const songT = [0.06, 0.22, 0.4, 0.6, 0.82, 0.0];
        const layout = songT.map((t, i) => { const c = (i === 5 ? this.sideCurve : this.mainCurve); const p = c.getPoint(i === 5 ? 0.4 : t); return { x: p.x, z: p.z }; });
        this.nodes = K.createSongNodes(this.group, layout, songs, { y: 0.12, orbY: 0.95 });
        this.songMarkers = this.nodes.markers;
    }

    update(time) {
        if (this.disposed) return;
        this._rippleWater(this.mainW, time); this._rippleWater(this.sideW, time);
        this.glints.forEach(go => { go.t += go.sp * 0.05; if (go.t > 1) go.t -= 1; go.curve.getPoint(go.t, this._v); go.curve.getTangent(go.t, this._t); let ux = -this._t.z, uz = this._t.x; const nl = Math.hypot(ux, uz) || 1; ux /= nl; uz /= nl; const hw = go.wf(go.t) / 2; go.s.position.set(this._v.x + ux * go.lat * hw, 0.16, this._v.z + uz * go.lat * hw); go.s.material.opacity = Math.max(0, Math.sin(go.t * Math.PI)) * (.5 + Math.sin(time * 5 + go.ph) * 0.3); });
        this.foams.forEach(f => { const s = f.userData.base * (1 + Math.sin(time * 4 + f.userData.ph) * 0.13); f.scale.setScalar(s); f.material.opacity = 0.5 + Math.sin(time * 4 + f.userData.ph) * 0.18; });
        this.mists.forEach(m => { m.position.z -= m.userData.spd * 0.03; if (m.position.z < m.userData.z0 - 14) m.position.z = m.userData.z0; m.material.opacity = 0.22; });
        this.shaftGroup.children.forEach(c => { c.material.opacity = c.userData.base + Math.sin(time * 0.6 + c.userData.ph) * 0.01; });
        this.tufts.forEach(tf => { tf.rotation.z = Math.sin(time * 1.4 + tf.userData.ph) * 0.06; });
        this.trees.forEach(tr => { tr.rotation.z = Math.sin(time * 0.9 + tr.userData.ph) * 0.02; });
        this.motes.update(); this.nodes.update(time); this.sunDisc.update(this.camera);
    }
}
