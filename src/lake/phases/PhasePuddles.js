import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import * as K from '../sceneKit.js';

// Phase 3「水たまり」— after the rain. A broad calm puddle mirrors a clearing
// sky, with warm light shafts breaking through the cloud gap. (design scene3)
export class PhasePuddles extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this.exposure = 0.92;
        this.bloomParams = { strength: 0.34, radius: 0.6, threshold: 0.85 };
        this.cameraRig = {
            pos: [0, 9, 32], lookAt: [0, 1.2, -26],
            drift: { ax: 2.0, fx: 0.09, ay: 0.25, fy: 0.15 },
        };
        this.dpr = Math.min(window.devicePixelRatio, 2);
        this._build();
    }

    _puffTex() {
        const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d');
        for (let i = 0; i < 9; i++) { const ang = Math.random() * 6.28, rad = Math.random() * S * 0.2; const cx = S / 2 + Math.cos(ang) * rad, cy = S / 2 + Math.sin(ang) * rad * 0.7, r = S * (0.15 + Math.random() * 0.16);
            const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.55, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, S, S); }
        const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    }

    _makeCloud(cx, cy, cz, w) {
        const g = new THREE.Group(); const baseCol = new THREE.Color(0x8898A6), topCol = new THREE.Color(0xD2D9DC);
        const n = 7 + (Math.random() * 5 | 0);
        for (let i = 0; i < n; i++) {
            const ox = (Math.random() - 0.5) * w, oy = (Math.random() - 0.5) * w * 0.32, oz = (Math.random() - 0.5) * w * 0.4; const tt = THREE.MathUtils.clamp(oy / (w * 0.32) + 0.5, 0, 1);
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._puffTexes[(Math.random() * 4) | 0], color: baseCol.clone().lerp(topCol, tt), transparent: true, opacity: 0.55 + Math.random() * 0.25, depthWrite: false, fog: true }));
            const s = w * (0.42 + Math.random() * 0.4); sp.scale.set(s, s * 0.82, 1); sp.position.set(ox, oy, oz); g.add(sp);
        }
        g.position.set(cx, cy, cz); return g;
    }

    _build() {
        const g = this.group;
        K.addSky(g, 0x47657F, 0x788C9A, 0xAAB4B4);
        const sun = K.addLights(g, { sunPos: [26, 50, -10], sunCol: 0xDED9C8, sunInt: 1.1, hemi: 0.62, groundCol: 0x3E4A40, amb: 0.18 });
        this.sunDisc = K.addSunDisc(g, sun.position, { dist: 175, glow: 95, r: 8, inner: 'rgba(244,244,232,0.85)', outer: 'rgba(226,224,200,0.3)' });
        const sunDir = sun.position.clone().normalize();

        // wet earth ground (the puddle sits in it)
        const earthGeo = new THREE.PlaneGeometry(260, 260, 48, 48); earthGeo.rotateX(-Math.PI / 2);
        { const p = earthGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, Math.sin(x * 0.12) * 0.35 + Math.cos(z * 0.14) * 0.3 + Math.sin((x + z) * 0.05) * 0.2 - 0.18); } earthGeo.computeVertexNormals(); }
        const earth = new THREE.Mesh(earthGeo, new THREE.MeshStandardMaterial({ color: 0x3C4436, flatShading: true, roughness: 0.9, metalness: 0.12 }));
        earth.position.set(0, 0, -30); earth.receiveShadow = true; g.add(earth);

        // the puddle: broad calm reflector (the hero)
        this.water = K.addWater(g, { w: 140, len: 96, cz: -14, y: 0.06, dpr: this.dpr, mirrorColor: 0x5e88ac, colors: [0x3f74ad, 0x73a6d2, 0xCFE6F4], opacity: 0.4, roughness: 0.08, metalness: 0.45, segW: 48, segL: 52 });

        // wet earth banks framing the puddle
        const earthMat = new THREE.MeshStandardMaterial({ color: 0x4E5A45, flatShading: true, roughness: 1 });
        [[-1], [1]].forEach(([s]) => {
            const bg = new THREE.PlaneGeometry(60, 200, 12, 26); bg.rotateX(-Math.PI / 2);
            const p = bg.attributes.position; for (let i = 0; i < p.count; i++) { const lx = p.getX(i); const edge = (lx + 30) / 60; p.setY(i, Math.pow(edge, 0.85) * 6 + Math.sin(p.getZ(i) * 0.12) * 0.6); }
            bg.computeVertexNormals(); const m = new THREE.Mesh(bg, earthMat); m.position.set(s * (40 + 30), 0, -40); m.receiveShadow = true; g.add(m);
        });
        // wet pebbles + grass tufts on the banks
        const pebMat = new THREE.MeshStandardMaterial({ color: 0x787f86, flatShading: true, roughness: 0.7, metalness: 0.2 });
        for (let i = 0; i < 30; i++) { const x = (Math.random() < 0.5 ? -1 : 1) * (34 + Math.random() * 22); const z = -90 + Math.random() * 120; const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4 + Math.random() * 0.5, 0), pebMat); p.position.set(x, 0.1, z); p.scale.y = 0.6; p.rotation.set(Math.random(), Math.random(), 0); g.add(p); }
        const grassMat = new THREE.MeshStandardMaterial({ color: 0x5C8B3E, flatShading: true, roughness: 1 });
        for (let i = 0; i < 70; i++) { const side = Math.random() < 0.5 ? -1 : 1; const x = side * (33 + Math.random() * 26); const z = -90 + Math.random() * 120; const edge = (Math.abs(x) - 30) / 60; const gy = Math.pow(Math.max(edge, 0), 0.85) * 6; const bl = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 4), grassMat); bl.position.set(x, gy + 0.35, z); bl.rotation.z = (Math.random() - 0.5) * 0.4; g.add(bl); }

        // broken soft cumulus with a bright gap (reflected in the puddle)
        this._puffTexes = [this._puffTex(), this._puffTex(), this._puffTex(), this._puffTex()];
        this.cloudGroup = new THREE.Group(); g.add(this.cloudGroup);
        [[-66, 30, -120, 30], [-100, 26, -95, 26], [-34, 42, -160, 34], [48, 44, -170, 30], [90, 30, -135, 26], [-120, 30, -90, 24], [26, 48, -190, 32]].forEach(([x, y, z, w]) => this.cloudGroup.add(this._makeCloud(x, y, z, w)));

        // light shafts through the cloud gap (warm, volumetric)
        this.shaftGroup = new THREE.Group(); g.add(this.shaftGroup);
        const shaftMat = new THREE.MeshBasicMaterial({ color: 0xF2ECD6, transparent: true, opacity: 0.04, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
        for (let i = 0; i < 9; i++) {
            const cone = new THREE.Mesh(new THREE.ConeGeometry(2.0 + i * 0.55, 84, 6, 1, true), shaftMat.clone());
            cone.position.copy(sunDir.clone().multiplyScalar(38)).add(new THREE.Vector3((i - 4) * 4.2, 0, 6));
            cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
            cone.userData = { ph: i * 0.7, base: 0.03 + Math.random() * 0.02 }; this.shaftGroup.add(cone);
        }

        // warm sun glint streaking on the puddle + scattered bright glints
        this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTex('rgba(248,246,232,0.85)', 'rgba(232,228,200,0.26)'), color: 0xeee8d2, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
        this.glint.position.set(10, 0.14, -18); this.glint.scale.set(6, 22, 1); g.add(this.glint);
        this.waterGlints = [];
        for (let i = 0; i < 18; i++) { const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTex('rgba(255,255,255,0.95)', 'rgba(255,246,220,0.3)'), color: 0xfff4d8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true })); gl.position.set(2 + Math.random() * 22, 0.13, -40 + Math.random() * 46); gl.scale.setScalar(0.5 + Math.random() * 0.7); gl.userData = { ph: Math.random() * 6.28, sp: 1.5 + Math.random() * 2 }; g.add(gl); this.waterGlints.push(gl); }

        // reeds at the waterline (foreground interest)
        const reedMat = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, flatShading: true, roughness: 1 });
        for (let c = 0; c < 8; c++) { const bx = (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 30), bz = -8 + Math.random() * 34; for (let k = 0; k < 5; k++) { const rd = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.4 + Math.random() * 1.0, 4), reedMat); rd.position.set(bx + (Math.random() - 0.5) * 1.6, (rd.geometry.parameters.height) / 2 - 0.1, bz + (Math.random() - 0.5) * 1.6); rd.rotation.z = (Math.random() - 0.5) * 0.3; g.add(rd); } }

        // last raindrop ripples on the puddle
        this.rings = [];
        for (let i = 0; i < 14; i++) { const r = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.78, 28), new THREE.MeshBasicMaterial({ color: 0xDCEEF8, transparent: true, opacity: 0, side: THREE.DoubleSide, fog: true, blending: THREE.AdditiveBlending })); r.rotation.x = -Math.PI / 2; r.position.set((Math.random() - 0.5) * 44, 0.07, -50 + Math.random() * 70); r.userData = { ph: Math.random() * Math.PI * 2, sp: 0.5 + Math.random() * 0.5 }; g.add(r); this.rings.push(r); }

        this.motes = K.addSparkles(g, { count: 70, area: [120, 26, 120], zoff: -50, maxY: 28, size: 0.5, mix: 0.55, colorA: 0x9FF0E6, colorB: 0xFFF3C8 });
        this.birds = K.addBirds(g, { count: 5, y: 34, z: -86 });
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xB7C3C9);
        this.scene.fog = new THREE.Fog(0xB7C3C9, 68, 225);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        const layout = [
            { x: -12, z: -4 }, { x: 9, z: -8 }, { x: -1, z: 6 },
            { x: 13, z: -2 }, { x: -9, z: -18 }, { x: 4, z: -28 },
        ];
        this.nodes = K.createSongNodes(this.group, layout, songs, { y: 0.05, orbY: 1.0 });
        this.songMarkers = this.nodes.markers;
    }

    update(time) {
        if (this.disposed) return;
        this.water.update(time, (x, z, tt) => Math.sin(x * 0.35 + tt * 0.9) * 0.05 + Math.cos(z * 0.3 + tt * 0.7) * 0.05);
        this.cloudGroup.position.x = Math.sin(time * 0.04) * 2.0; this.motes.update(); this.nodes.update(time); this.birds.update(time);
        this.shaftGroup.children.forEach(c => { c.material.opacity = c.userData.base + Math.sin(time * 0.7 + c.userData.ph) * 0.025; });
        this.glint.material.opacity = 0.28 + Math.sin(time * 0.9) * 0.1;
        this.waterGlints.forEach(gl => { gl.material.opacity = Math.max(0, Math.sin(time * gl.userData.sp + gl.userData.ph)) * 0.5; });
        this.rings.forEach(r => { const k = ((time * r.userData.sp) + r.userData.ph) % 1; const s = 1 + k * 9; r.scale.set(s, s, 1); r.material.opacity = (1 - k) * 0.5; });
        this.sunDisc.update(this.camera);
    }
}
