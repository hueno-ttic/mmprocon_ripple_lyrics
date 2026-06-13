import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import * as K from '../sceneKit.js';

// Phase 2「雨」— wind-driven rain over a wet reflective ground; brooding,
// rain-soaked atmosphere with splashes and drifting mist. (design scene2)
export class PhaseRain extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this.exposure = 1.02;
        this.bloomParams = { strength: 0.34, radius: 0.5, threshold: 0.86 };
        this.cameraRig = {
            pos: [0, 6.5, 36], lookAt: [0, 4.5, -50],
            drift: { ax: 2.0, fx: 0.10, ay: 0.25, fy: 0.16 },
        };
        this.dpr = Math.min(window.devicePixelRatio, 2);
        this._build();
    }

    _puffTex() {
        const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d');
        for (let i = 0; i < 9; i++) {
            const ang = Math.random() * 6.28, rad = Math.random() * S * 0.2; const cx = S / 2 + Math.cos(ang) * rad, cy = S / 2 + Math.sin(ang) * rad * 0.7, r = S * (0.15 + Math.random() * 0.16);
            const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.55, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, S, S);
        }
        const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    }

    _build() {
        const g = this.group;
        K.addSky(g, 0x4C606F, 0x71838F, 0x9DAAB4);
        K.addLights(g, { sunPos: [-20, 60, 30], sunCol: 0xC9D4DC, sunInt: 0.8, hemi: 0.85, groundCol: 0x37463F, amb: 0.32, shadow: false });

        // wet reflective ground
        this.water = K.addWater(g, { w: 220, len: 220, cz: -50, y: 0.05, dpr: this.dpr, mirrorColor: 0x394650, color: 0x33424B, opacity: 0.86, roughness: 0.5, metalness: 0.2, segW: 50, segL: 50 });

        // low rolling dark-green banks at the sides so it reads as land, not sea
        const bankMat = new THREE.MeshStandardMaterial({ color: 0x3E5240, flatShading: true, roughness: 1 });
        [[-1], [1]].forEach(([s]) => {
            const bg = new THREE.PlaneGeometry(70, 200, 12, 28); bg.rotateX(-Math.PI / 2);
            const p = bg.attributes.position;
            for (let i = 0; i < p.count; i++) { const lx = p.getX(i); const edge = (lx + 35) / 70; p.setY(i, Math.pow(edge, 0.8) * 7 + Math.sin(p.getZ(i) * 0.1) * 0.8); }
            bg.computeVertexNormals();
            const m = new THREE.Mesh(bg, bankMat); m.position.set(s * (20 + 35), 0, -50); m.receiveShadow = true; g.add(m);
        });

        this._puffTexes = [this._puffTex(), this._puffTex(), this._puffTex(), this._puffTex()];
        // heavy soft overcast ceiling (low stratus, brooding)
        this.ceilGroup = new THREE.Group(); g.add(this.ceilGroup);
        for (let i = 0; i < 40; i++) {
            const x = (Math.random() - 0.5) * 250, z = -140 + Math.random() * 160, y = 22 + Math.random() * 12;
            const w = 26 + Math.random() * 24;
            const col = new THREE.Color(0x5a6672).lerp(new THREE.Color(0x8893a0), Math.random() * 0.8);
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._puffTexes[i % 4], color: col, transparent: true, opacity: 0.45 + Math.random() * 0.25, depthWrite: false, fog: true }));
            sp.scale.set(w, w * 0.62, 1); sp.position.set(x, y, z); this.ceilGroup.add(sp);
        }

        // distant hazy hills
        [[-50, -100, 16, 32], [44, -108, 18, 36], [0, -120, 20, 44]].forEach(([x, z, h, r]) => {
            const m = K.makeMountain({ h, r, radial: 10, rings: 5, concave: 1.5, noise: 0.08, jitter: 0.05, snow: 1.1, body0: 0x5C7060, body1: 0x445648 });
            m.position.set(x, 0, z); g.add(m);
        });

        // trees bending in wind
        const tm = K.treeMats({ trunk: 0x40342A, a: 0x35543A, b: 0x42613F, c: 0x2B442E });
        this.trees = [];
        for (let i = 0; i < 18; i++) {
            const side = i % 2 ? 1 : -1; const across = 22 + Math.random() * 30;
            const x = side * across + (Math.random() - 0.5) * 4, z = -90 + Math.random() * 120;
            const edge = (across - 20) / 70; const gy = Math.pow(Math.max(edge, 0), 0.8) * 7 - 0.2;
            const t = (Math.random() < 0.5) ? K.pineTree(1.0 + Math.random() * 0.7, tm) : K.roundTree(1.0 + Math.random() * 0.7, tm);
            t.position.set(x, gy, z); t.rotation.y = Math.random() * 6.28; t.userData.ph = Math.random() * 6.28; g.add(t); this.trees.push(t);
        }

        this._buildRain();
        this._buildCurtainsSplashesMist();
    }

    _buildRain() {
        const g = this.group;
        this.RAIN = window.innerWidth < 768 ? 420 : 820; this.RLEN = 2.1; this.rdir = new THREE.Vector3(-0.32, -1, 0.04).normalize();
        this.rainPos = new Float32Array(this.RAIN * 2 * 3); this.anchor = new Float32Array(this.RAIN * 3); this.rlen = new Float32Array(this.RAIN);
        for (let i = 0; i < this.RAIN; i++) this._seedRain(i, true);
        this._writeRain();
        this.rainGeo = new THREE.BufferGeometry(); this.rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
        const rain = new THREE.LineSegments(this.rainGeo, new THREE.LineBasicMaterial({ color: 0xC4D3DF, transparent: true, opacity: 0.4 }));
        rain.frustumCulled = false; g.add(rain);
    }

    _seedRain(i, full) {
        const x = (Math.random() - 0.5) * 150; const y = full ? Math.random() * 56 : 56 + Math.random() * 8; const z = -110 + Math.random() * 135;
        this.anchor[i * 3] = x; this.anchor[i * 3 + 1] = y; this.anchor[i * 3 + 2] = z; this.rlen[i] = this.RLEN * (0.6 + Math.random() * 0.9);
    }

    _writeRain() {
        const { anchor, rdir, rlen, rainPos, RAIN } = this;
        for (let i = 0; i < RAIN; i++) {
            const x = anchor[i * 3], y = anchor[i * 3 + 1], z = anchor[i * 3 + 2]; const L0 = rlen[i];
            rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
            rainPos[i * 6 + 3] = x + rdir.x * L0; rainPos[i * 6 + 4] = y + rdir.y * L0; rainPos[i * 6 + 5] = z + rdir.z * L0;
        }
    }

    _buildCurtainsSplashesMist() {
        const g = this.group;
        // distant rain curtains
        this.curtainGroup = new THREE.Group(); g.add(this.curtainGroup);
        for (let i = 0; i < 4; i++) {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._puffTexes[i % 4], color: 0xAEBCC8, transparent: true, opacity: 0.08, depthWrite: false, fog: true }));
            sp.scale.set(24 + Math.random() * 14, 44 + Math.random() * 18, 1); sp.position.set((Math.random() - 0.5) * 150, 14, -80 - Math.random() * 55); sp.userData = { spd: 0.5 + Math.random() * 0.6 }; this.curtainGroup.add(sp);
        }
        // splash rings on the ground
        const splashMat = new THREE.SpriteMaterial({ map: K.glowTex('rgba(220,235,245,0.0)', 'rgba(200,222,235,0.5)'), color: 0xcfe0ea, transparent: true, opacity: 0, depthWrite: false, fog: true });
        this.splashes = [];
        for (let i = 0; i < 26; i++) { const s = new THREE.Sprite(splashMat.clone()); s.position.set((Math.random() - 0.5) * 60, 0.12, -70 + Math.random() * 90); s.scale.set(2, 1, 1); s.userData = { ph: Math.random() * Math.PI * 2, sp: 1.4 + Math.random() * 1.2 }; g.add(s); this.splashes.push(s); }
        // drifting mist
        const mistMat = new THREE.SpriteMaterial({ map: K.glowTex('rgba(225,233,240,0.5)', 'rgba(210,222,232,0.16)'), color: 0xdfe7ee, transparent: true, opacity: 0, depthWrite: false, fog: true });
        this.mists = [];
        for (let i = 0; i < 12; i++) { const m = new THREE.Sprite(mistMat.clone()); m.position.set((Math.random() - 0.5) * 70, 1.6 + Math.random() * 3, -80 + Math.random() * 100); const base = 16 + Math.random() * 12; m.scale.set(base * 2.4, base * 0.5, 1); m.userData = { spd: 1 + Math.random() * 2 }; g.add(m); this.mists.push(m); }
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0x8C9AA6);
        this.scene.fog = new THREE.Fog(0x8C9AA6, 40, 165);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        const layout = [
            { x: -12, z: 0 }, { x: 9, z: -5 }, { x: -2, z: -12 },
            { x: 13, z: 3 }, { x: -8, z: 8 }, { x: 4, z: -22 },
        ];
        this.nodes = K.createSongNodes(this.group, layout, songs, { y: 0.1, orbY: 1.0 });
        this.songMarkers = this.nodes.markers;
    }

    update(time) {
        if (this.disposed) return;
        const { anchor, rdir, RAIN } = this;
        for (let i = 0; i < RAIN; i++) {
            anchor[i * 3] += rdir.x * 0.8; anchor[i * 3 + 1] += rdir.y * 0.8; anchor[i * 3 + 2] += rdir.z * 0.8;
            if (anchor[i * 3 + 1] < 0.1) this._seedRain(i, false);
        }
        this._writeRain(); this.rainGeo.attributes.position.needsUpdate = true;

        this.water.update(time, (x, z, tt) => Math.sin(x * 1.6 + tt * 7) * 0.03 + Math.cos(z * 1.5 + tt * 6) * 0.03);
        this.splashes.forEach(s => { const k = ((time * s.userData.sp) + s.userData.ph) % 1; s.scale.set(1 + k * 4, 0.5 + k * 2, 1); s.material.opacity = (1 - k) * 0.5; });
        this.mists.forEach(m => { m.position.x += m.userData.spd * 0.016; if (m.position.x > 40) m.position.x = -40; m.material.opacity = 0.22; });
        this.trees.forEach(tr => { tr.rotation.z = -0.06 + Math.sin(time * 1.6 + tr.userData.ph) * 0.05; });
        this.ceilGroup.position.x = Math.sin(time * 0.04) * 2.0;
        this.curtainGroup.children.forEach(c => { c.position.x += c.userData.spd * 0.05; if (c.position.x > 80) c.position.x = -80; });
        this.nodes.update(time);
    }
}
