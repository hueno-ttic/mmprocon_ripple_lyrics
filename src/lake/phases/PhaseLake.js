import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PhaseBase } from './PhaseBase.js';
import * as K from '../sceneKit.js';

// Phase 6「湖」— the journey's end. A calm reflective lake before Mt Fuji and a
// mountain range, sunflower colonies on the lakeside banks. (design scene6)
export class PhaseLake extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this.exposure = 1.12;
        this.bloomParams = { strength: 0.5, radius: 0.5, threshold: 0.84 };
        this.cameraRig = {
            pos: [0, 6.6, 34], lookAt: [0, 6.5, -46],
            drift: { ax: 2.6, fx: 0.11, ay: 0.3, fy: 0.19 },
        };
        this.dpr = Math.min(window.devicePixelRatio, 2);
        this._build();
    }

    _build() {
        const g = this.group;
        K.addSky(g, 0x1E73D4, 0x6FB1EC, 0xDDF0FB, 420);
        const sun = K.addLights(g, { sunPos: [48, 62, 30], sunCol: 0xFFF3DC, sunInt: 2.05, hemi: 0.78, skyCol: 0xBFE3F5, groundCol: 0x3C7030, amb: 0.14 });
        this.sunDisc = K.addSunDisc(g, sun.position, { dist: 185, glow: 90, r: 7 });

        // Mt Fuji (hero) + surrounding range
        const fuji = K.makeMountain({ h: 15, r: 27, radial: 18, rings: 8, concave: 1.02, noise: 0.016, jitter: 0.009, snow: 0.64, topR: 0.05, body0: 0x7E9CC0, body1: 0x52729E, snowCol: 0xF8FCFF });
        fuji.position.set(0, 0, -58); g.add(fuji);
        [[-42, -66, 11, 12], [-60, -74, 9, 11], [42, -68, 12, 13], [60, -76, 9, 11], [32, -82, 8, 10], [-30, -84, 8, 10]].forEach(([x, z, h, r]) => { const m = K.makeMountain({ h, r, radial: 10, rings: 5, concave: 1.35, noise: 0.09, jitter: 0.05, snow: 0.78, body0: 0xA8C0DA, body1: 0x82A0C0, snowCol: 0xEAF2FB }); m.position.set(x, 0, z); g.add(m); });

        // far shore + trees
        const shoreMat = new THREE.MeshStandardMaterial({ color: 0x3F7D34, flatShading: true, roughness: 1 });
        const shore = new THREE.Mesh(new THREE.BoxGeometry(260, 3, 14), shoreMat); shore.position.set(0, -0.6, -50); shore.receiveShadow = true; g.add(shore);
        { const sg = new THREE.PlaneGeometry(260, 14, 40, 4); sg.rotateX(-Math.PI / 2); const sp = sg.attributes.position; for (let i = 0; i < sp.count; i++) { sp.setY(i, 0.9 + Math.sin(sp.getX(i) * 0.3) * 0.4 + Math.cos(sp.getZ(i) * 0.5) * 0.3); } sg.computeVertexNormals(); const sm = new THREE.Mesh(sg, shoreMat.clone()); sm.position.set(0, 0, -49); sm.receiveShadow = true; g.add(sm); }
        const tm = K.treeMats({ a: 0x2E6B34, b: 0x357A3B, c: 0x255A2C });
        for (let i = 0; i < 14; i++) { const x = -120 + i * 17 + (Math.random() - 0.5) * 8; if (Math.abs(x) < 20) continue; const s = 0.8 + Math.random() * 0.5; const t = (i % 3 === 0) ? K.pineTree(s, tm) : K.roundTree(s, tm); t.position.set(x, 0.9, -49 + (Math.random() - 0.5) * 4); g.add(t); }

        // banks (lakeside mounds)
        const bankMat = new THREE.MeshStandardMaterial({ color: 0x52A03E, flatShading: true, roughness: 1 });
        const makeBank = (x, z, sx, sy, sz) => { const geo = new THREE.IcosahedronGeometry(1, 2); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); v.multiplyScalar(1 + 0.08 * Math.sin(v.x * 4 + v.z * 3)); p.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals(); const m = new THREE.Mesh(geo, bankMat); m.scale.set(sx, sy, sz); m.position.set(x, -sy * 0.55, z); m.receiveShadow = true; m.castShadow = true; return m; };
        g.add(makeBank(-15, 9, 12, 3.0, 9)); g.add(makeBank(16, 7, 12, 3.0, 9));
        const bankTopY = -3.0 * 0.55 + 3.0; // ~1.35

        this._buildSunflowers(bankTopY);

        // reflective lake + translucent rippling surface
        this.water = K.addWater(g, { w: 250, len: 108, cz: 4, y: 0.05, dpr: this.dpr, mirrorColor: 0x4878ab, color: 0x3F86D0, opacity: 0.34, roughness: 0.16, metalness: 0.3, segW: 60, segL: 30 });

        this.clouds = K.addClouds(g, [[-46, 38, -90, 1.4], [58, 32, -78, 0.95], [10, 47, -120, 1.15], [-92, 34, -70, 0.78]]);
        this.sparkles = K.addSparkles(g, { count: 90, area: [120, 45, 90], zoff: -60, maxY: 46, size: 0.5, mix: 0.62, colorA: 0x6FF0E4, colorB: 0xFFF6CF });
    }

    _buildSunflowers(bankTopY) {
        const g = this.group;
        const stemMat = new THREE.MeshStandardMaterial({ color: 0x357D2A, flatShading: true, roughness: 1 });
        const petalMat = new THREE.MeshStandardMaterial({ color: 0xF4B400, flatShading: true, roughness: 0.85 });
        const discMat = new THREE.MeshStandardMaterial({ color: 0x6E4A1E, flatShading: true, roughness: 1 });
        const coreMat = new THREE.MeshStandardMaterial({ color: 0x3F2A12, flatShading: true, roughness: 1 });
        const petalGeo = (() => { const arr = []; const base = new THREE.BoxGeometry(0.11, 0.34, 0.05); for (let i = 0; i < 13; i++) { const geo = base.clone(); geo.translate(0, 0.34, 0); geo.rotateZ(i / 13 * Math.PI * 2); arr.push(geo); } return mergeGeometries(arr); })();
        const discGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.08, 16); discGeo.rotateX(Math.PI / 2);
        const coreGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.10, 14); coreGeo.rotateX(Math.PI / 2);
        const leafGeo = new THREE.ConeGeometry(0.14, 0.5, 5);
        const makeSunflower = s => {
            const grp = new THREE.Group(); const H = 1.7;
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, H, 6), stemMat); stem.position.y = H / 2; stem.castShadow = true; grp.add(stem);
            const leaf = new THREE.Mesh(leafGeo, stemMat); leaf.position.set(0.18, H * 0.45, 0); leaf.rotation.z = -1.2; leaf.rotation.y = 0.4; grp.add(leaf);
            const head = new THREE.Group(); head.position.y = H; head.rotation.x = -1.0;
            const petals = new THREE.Mesh(petalGeo, petalMat); petals.castShadow = true;
            const disc = new THREE.Mesh(discGeo, discMat); disc.position.z = 0.02;
            const core = new THREE.Mesh(coreGeo, coreMat); core.position.z = 0.05;
            head.add(petals, disc, core); grp.add(head); grp.scale.setScalar(s); grp.userData = { head, ph: Math.random() * 6.28 }; return grp;
        };
        this.flowers = [];
        const colony = (cx, cz, n, spread) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()); const x = cx + Math.cos(a) * spread * d, z = cz + Math.sin(a) * spread * d * 0.7; const f = makeSunflower(0.85 + Math.random() * 0.5); f.position.set(x, bankTopY - 0.1, z); f.rotation.y = Math.random() * Math.PI * 2; f.userData.head.rotation.z = (Math.random() - 0.5) * 0.3; g.add(f); this.flowers.push(f); } };
        const n = K.isMobile() ? 8 : 13;
        colony(-15, 10, n, 7.5); colony(16, 8, n, 7.5);
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xBFE3F5);
        this.scene.fog = new THREE.Fog(0xBFE3F5, 64, 220);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        // nodes resting on the lake surface
        const layout = [
            { x: -10, z: -6 }, { x: 8, z: -8 }, { x: -1, z: 4 },
            { x: 13, z: 0 }, { x: -14, z: 2 }, { x: 5, z: 9 },
        ];
        this.nodes = K.createSongNodes(this.group, layout, songs, { y: 0.08, orbY: 1.1 });
        this.songMarkers = this.nodes.markers;
    }

    update(time) {
        if (this.disposed) return;
        this.water.update(time, (x, z) => Math.sin(x * 0.25 + time * 0.9) * 0.12 + Math.cos(z * 0.3 + time * 0.7) * 0.12);
        this.clouds.update(time);
        this.flowers.forEach(f => { f.userData.head.rotation.z = Math.sin(time * 1.1 + f.userData.ph) * 0.12; });
        this.nodes.update(time); this.sparkles.update(); this.sunDisc.update(this.camera);
    }
}
