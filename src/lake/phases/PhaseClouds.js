import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import * as K from '../sceneKit.js';

// Phase 1「雲」— the risen vapor gathers high among a soft cloud sea, with
// darker rain clouds massing above. A sense of altitude. (design scene1)
export class PhaseClouds extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this.exposure = 1.02;
        this.bloomParams = { strength: 0.22, radius: 0.55, threshold: 0.9 };
        this.cameraRig = {
            pos: [0, 13, 42], lookAt: [0, 9.5, -95],
            drift: { ax: 3.2, fx: 0.08, ay: 0.45, fy: 0.14 },
        };
        // モバイルは雲スプライトの描画コール(全体で500超)が重いので、雲の数・
        // 1雲あたりのパフ数・きらめき粒子を削減してフィルレートを抑える。
        this.isMobile = window.innerWidth < 768;
        this._build();
    }

    _puffTex() {
        const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d');
        for (let i = 0; i < 9; i++) {
            const ang = Math.random() * Math.PI * 2, rad = Math.random() * S * 0.20;
            const cx = S / 2 + Math.cos(ang) * rad, cy = S / 2 + Math.sin(ang) * rad * 0.7, r = S * (0.15 + Math.random() * 0.16);
            const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.55, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g; x.fillRect(0, 0, S, S);
        }
        const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    }

    _makeCloud(cx, cy, cz, w, dark) {
        const g = new THREE.Group();
        const baseCol = dark ? new THREE.Color(0x707a86) : new THREE.Color(0x9aa4b0);
        const topCol = dark ? new THREE.Color(0xb6bdc8) : new THREE.Color(0xeef1f6);
        const n = this.isMobile ? (4 + (Math.random() * 3 | 0)) : (7 + (Math.random() * 5 | 0));
        for (let i = 0; i < n; i++) {
            const ox = (Math.random() - 0.5) * w, oy = (Math.random() - 0.5) * w * 0.34, oz = (Math.random() - 0.5) * w * 0.4;
            const tt = THREE.MathUtils.clamp((oy / (w * 0.34)) + 0.5, 0, 1);
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._puffTexes[(Math.random() * this._puffTexes.length) | 0], color: baseCol.clone().lerp(topCol, tt), transparent: true, opacity: 0.5 + Math.random() * 0.22, depthWrite: false, fog: true }));
            const s = w * (0.42 + Math.random() * 0.4); sp.scale.set(s, s * 0.82, 1); sp.position.set(ox, oy, oz);
            g.add(sp);
        }
        g.position.set(cx, cy, cz); return g;
    }

    _build() {
        const g = this.group;
        K.addSky(g, 0x3C5A82, 0x6E879F, 0xBBC4CC);

        // overcast: light tops, dark heavy undersides → rain clouds
        g.add(new THREE.HemisphereLight(0xE0E7EF, 0x6E7884, 1.0));
        const sun = new THREE.DirectionalLight(0xC7CED6, 1.0); sun.position.set(34, 42, -86); g.add(sun);
        g.add(new THREE.AmbientLight(0xffffff, 0.2));
        // faint hazy sun barely showing through the cloud mass
        const sunDir = sun.position.clone().normalize();
        this.hazeSun = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTex('rgba(238,242,247,0.55)', 'rgba(214,222,230,0.18)'), color: 0xeef2f7, transparent: true, opacity: 0.6, depthWrite: false, fog: false, blending: THREE.NormalBlending }));
        this.hazeSun.position.copy(sunDir.clone().multiplyScalar(230)); this.hazeSun.scale.setScalar(90); g.add(this.hazeSun);

        this._puffTexes = [this._puffTex(), this._puffTex(), this._puffTex(), this._puffTex(), this._puffTex()];

        // cloud sea (soft puff clusters, a defined lower band)
        this.seaGroup = new THREE.Group(); g.add(this.seaGroup);
        const seaCount = this.isMobile ? 30 : 60;
        for (let i = 0; i < seaCount; i++) {
            const r = 10 + Math.random() * 195; const a = Math.random() * Math.PI * 2;
            const x = Math.cos(a) * r, z = -60 + Math.sin(a) * r * 0.95;
            const y = -1.0 - Math.min(r * 0.012, 3.2);
            this.seaGroup.add(this._makeCloud(x, y, z, 10 + Math.random() * 16, false));
        }
        // darker rain clouds gathering high above
        this.ceilGroup = new THREE.Group(); g.add(this.ceilGroup);
        [[-44, 26, -95, 30], [34, 30, -122, 34], [-88, 28, -150, 26], [14, 33, -165, 34]].forEach(([x, y, z, w]) => this.ceilGroup.add(this._makeCloud(x, y, z, w, true)));

        this.vapor = K.addSparkles(g, { count: this.isMobile ? 60 : 110, area: [200, 46, 200], zoff: -100, maxY: 46, size: 0.5, mix: 0.4, colorA: 0x9FF0E6, colorB: 0xCFD8E0 });
        this.birds = K.addBirds(g, { count: 5, y: 5, z: -64 });
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xC4CDD6);
        this.scene.fog = new THREE.Fog(0xC4CDD6, 100, 340);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        const layout = [
            { x: -15, z: -4 }, { x: 12, z: -10 }, { x: -4, z: -22 },
            { x: 18, z: 2 }, { x: -11, z: 6 }, { x: 5, z: -32 },
        ];
        this.nodes = K.createSongNodes(this.group, layout, songs, { y: 0.3, orbY: 1.0 });
        this.songMarkers = this.nodes.markers;
    }

    update(time) {
        if (this.disposed) return;
        this.vapor.update(); this.nodes.update(time); this.birds.update(time);
        this.seaGroup.position.y = Math.sin(time * 0.2) * 0.25;
        this.ceilGroup.position.x = Math.sin(time * 0.05) * 1.6;
        this.hazeSun.material.opacity = 0.5 + Math.sin(time * 0.4) * 0.08;
    }
}
