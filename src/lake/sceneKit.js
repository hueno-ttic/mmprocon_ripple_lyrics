// Shared low-poly 3D toolkit for the 楽曲選択画面「Ripple Lyrics」water-cycle world.
//
// Adapted from the design draft's scenelib.js (design_drafts/湖のソナーレ_extracted/).
// Unlike the draft, these builders do NOT own a renderer/scene/camera/loop:
// the app shares a single renderer + scene + camera across all phases
// (see WorldUI.js). Each builder adds meshes to a passed-in `parent`
// (a phase's THREE.Group) and returns an `update(t)` callback the phase
// calls from its own update().
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const isMobile = () => window.innerWidth < 768;

/* ---------- textures (cached by key) ---------- */
const _glowCache = new Map();
export function glowTex(inner, outer) {
    const key = inner + '|' + outer;
    if (_glowCache.has(key)) return _glowCache.get(key);
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const x = cv.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner); g.addColorStop(0.4, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    _glowCache.set(key, t);
    return t;
}

let _streakTex = null;
export function streakTex() {
    if (_streakTex) return _streakTex;
    const w = 128, h = 32, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(232,245,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    _streakTex = new THREE.CanvasTexture(cv); _streakTex.colorSpace = THREE.SRGBColorSpace;
    return _streakTex;
}

/* ---------- gradient sky dome ---------- */
export function addSky(parent, top, mid, bot, radius = 440) {
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 16),
        new THREE.ShaderMaterial({
            side: THREE.BackSide, fog: false,
            uniforms: {
                top: { value: new THREE.Color(top) },
                mid: { value: new THREE.Color(mid) },
                bot: { value: new THREE.Color(bot) },
            },
            vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
            fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){ float h=normalize(vP).y; vec3 c = h>0.0 ? mix(mid,top,clamp(h*1.15,0.0,1.0)) : mix(mid,bot,clamp(-h*3.0,0.0,1.0)); gl_FragColor=vec4(c,1.0);} `,
        })
    );
    parent.add(sky); return sky;
}

/* ---------- lights + sun disc ---------- */
export function addLights(parent, o = {}) {
    parent.add(new THREE.HemisphereLight(o.skyCol ?? 0xCDE8F6, o.groundCol ?? 0x37642C, o.hemi ?? 0.66));
    const sun = new THREE.DirectionalLight(o.sunCol ?? 0xFFEFD2, o.sunInt ?? 2.3);
    sun.position.set(...(o.sunPos ?? [-40, 64, 26]));
    sun.castShadow = o.shadow !== false;
    if (sun.castShadow) {
        const ms = isMobile() ? 512 : 1024;
        sun.shadow.mapSize.set(ms, ms);
        const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 20; sc.far = 210;
        sun.shadow.bias = -0.0004;
    }
    parent.add(sun);
    parent.add(new THREE.AmbientLight(0xffffff, o.amb ?? 0.16));
    return sun;
}

export function addSunDisc(parent, dir, o = {}) {
    const d = dir.clone().normalize();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(o.r ?? 7, 32), new THREE.MeshBasicMaterial({ color: o.color ?? 0xFFFEF6, fog: false }));
    disc.position.copy(d.clone().multiplyScalar(o.dist ?? 195)); parent.add(disc);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(o.inner ?? 'rgba(255,253,238,0.95)', o.outer ?? 'rgba(255,242,200,0.32)'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    glow.position.copy(disc.position); glow.scale.setScalar(o.glow ?? 95); parent.add(glow);
    return { disc, glow, update(camera) { disc.lookAt(camera.position); } };
}

/* ---------- faceted low-poly mountain ---------- */
function lerpC(a, b, t) { return a.clone().lerp(b, t); }
export function makeMountain(o) {
    const { h, r, radial = 12, rings = 7, concave = 1.5, noise = 0.07, jitter = 0.04, snow = 0.7, topR = 0,
        body0 = 0x9FB8D2, body1 = 0x6F90B8, snowCol = 0xF6FAFF } = o;
    const g = new THREE.CylinderGeometry(Math.max(r * topR, 0.001), r, h, radial, rings, false);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position, n = p.count;
    const cA = new THREE.Color(body0), cB = new THREE.Color(body1), cS = new THREE.Color(snowCol);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const t = Math.min(Math.max(y / h, 0), 1);
        if (Math.hypot(x, z) > 1e-4) { const cur = r * (1 - (1 - topR) * t); const target = r * ((1 - topR) * Math.pow(1 - t, concave) + topR); const f = target / (cur + 1e-6); x *= f; z *= f; }
        const ang = Math.atan2(z, x);
        const nf = 1 + noise * Math.sin(ang * 5 + t * 9) + jitter * Math.sin(ang * 11 + t * 4); x *= nf; z *= nf;
        p.setX(i, x); p.setY(i, y + jitter * h * 0.35 * Math.sin(ang * 7 + t * 5)); p.setZ(i, z);
        const sl = snow + 0.06 * Math.sin(ang * 6);
        const c = t > sl ? cS : lerpC(cA, cB, Math.min(t / sl, 1));
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 }));
}

/* ---------- trees ---------- */
export function treeMats(o = {}) {
    return {
        trunk: new THREE.MeshStandardMaterial({ color: o.trunk ?? 0x4A3325, flatShading: true, roughness: 1 }),
        a: new THREE.MeshStandardMaterial({ color: o.a ?? 0x2E6B34, flatShading: true, roughness: 1 }),
        b: new THREE.MeshStandardMaterial({ color: o.b ?? 0x357F39, flatShading: true, roughness: 1 }),
        c: new THREE.MeshStandardMaterial({ color: o.c ?? 0x255A2C, flatShading: true, roughness: 1 }),
    };
}
export function roundTree(s, m) {
    const g = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 1.5 * s, 6), m.trunk); tr.position.y = 0.75 * s; tr.castShadow = true; g.add(tr);
    const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0 * s, 0), m.a); c1.position.y = 2.0 * s; c1.castShadow = true;
    const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72 * s, 0), m.b); c2.position.set(0.5 * s, 1.7 * s, 0.2 * s);
    const c3 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62 * s, 0), m.c); c3.position.set(-0.45 * s, 1.6 * s, -0.1 * s);
    g.add(c1, c2, c3); return g;
}
export function pineTree(s, m) {
    const g = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 1.0 * s, 6), m.trunk); tr.position.y = 0.5 * s; tr.castShadow = true; g.add(tr);
    for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry((1.05 - k * 0.24) * s, 1.25 * s, 7), k === 1 ? m.b : (k === 2 ? m.c : m.a)); c.position.y = (1.0 + k * 0.82) * s; c.castShadow = true; g.add(c); }
    return g;
}

/* ---------- volumetric clouds (wide soft billows) ---------- */
export function addClouds(parent, defs, o = {}) {
    const mat = new THREE.MeshStandardMaterial({ color: o.color ?? 0xFDFEFF, flatShading: false, roughness: 1 });
    const sphere = new THREE.IcosahedronGeometry(1, 4);
    const lumps = [[0, 0.55, 0.6], [-1.0, 0.35, 0.5], [1.0, 0.32, 0.5], [-0.05, 0.1, 0.72], [-1.7, 0.05, 0.42], [1.7, 0.0, 0.42], [0.7, 0.18, 0.55], [-0.75, 0.2, 0.55], [0, -0.18, 0.78]];
    const clouds = defs.map((d, di) => {
        const g = new THREE.Group();
        lumps.forEach(l => { const s = new THREE.Mesh(sphere, mat); s.position.set(l[0] * 5, l[1] * 5, 0); s.scale.set(l[2] * 6.2, l[2] * 4.2, l[2] * 5); g.add(s); });
        g.position.set(d[0], d[1], d[2]); g.scale.setScalar(d[3]); g.rotation.y = (di * 1.7 % 1 - 0.5) * 0.5;
        g.userData = { ph: di * 0.9, base: d[3] }; parent.add(g); return g;
    });
    function update(t) { clouds.forEach((c, i) => { const s = c.userData.base * (1 + Math.sin(t * 0.25 + c.userData.ph) * 0.02); c.scale.setScalar(s); c.position.x += Math.sin(t * 0.05 + i) * 0.002; }); }
    return { clouds, update };
}

/* ---------- reflective water surface (with per-frame wave callback) ---------- */
export function addWater(parent, o = {}) {
    const { w = 36, len = 150, cz = -30, y = 0.06, dpr = 2, mirrorColor = 0x1d3a57, segW = 48, segL = 110,
        colors, opacity = 0.74, roughness = 0.36, metalness = 0.14 } = o;
    const texSize = isMobile() ? 512 : Math.min(1024 * dpr, 2048);
    const mirror = new Reflector(new THREE.PlaneGeometry(w, len), { clipBias: 0.004, textureWidth: texSize, textureHeight: texSize, color: mirrorColor });
    mirror.rotateX(-Math.PI / 2); mirror.position.set(o.x ?? 0, y - 0.08, cz); parent.add(mirror);
    const geo = new THREE.PlaneGeometry(w, len, segW, segL); geo.rotateX(-Math.PI / 2);
    let mat;
    if (colors) {
        const p = geo.attributes.position; const cols = new Float32Array(p.count * 3);
        const deep = new THREE.Color(colors[0]), mid = new THREE.Color(colors[1]), shallow = new THREE.Color(colors[2]);
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i);
            const edge = Math.min(Math.abs(x) / (w / 2), 1); const far = Math.min(Math.max((-(z)) / (len / 2), 0), 1);
            let c = mid.clone().lerp(deep, (1 - edge) * 0.7); c.lerp(shallow, Math.max(edge - 0.55, 0) * 1.6 + far * 0.25);
            cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity, flatShading: true, roughness, metalness });
    } else {
        mat = new THREE.MeshStandardMaterial({ color: o.color ?? 0x2E72BE, transparent: true, opacity, flatShading: true, roughness, metalness });
    }
    const surf = new THREE.Mesh(geo, mat); surf.position.set(o.x ?? 0, y, cz); parent.add(surf);
    const base = geo.attributes.position.array.slice();
    function update(t, waveFn) {
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = base[i * 3], z = base[i * 3 + 2]; p.setY(i, waveFn(x, z, t)); }
        p.needsUpdate = true; geo.computeVertexNormals();
    }
    function dispose() { mirror.getRenderTarget?.().dispose?.(); }
    return { mirror, surf, geo, base, update, dispose, W: w, LEN: len };
}

/* ---------- rising sparkle motes (Mirai teal/cream) ---------- */
export function addSparkles(parent, o = {}) {
    let N = o.count ?? 80; if (isMobile()) N = Math.round(N * 0.55);
    const area = o.area ?? [70, 30, 90], zoff = o.zoff ?? -60, maxY = o.maxY ?? 32;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), spd = new Float32Array(N);
    const A = new THREE.Color(o.colorA ?? 0x6FF0E4), B = new THREE.Color(o.colorB ?? 0xFFF6CF);
    for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * area[0]; pos[i * 3 + 1] = Math.random() * area[1]; pos[i * 3 + 2] = zoff + Math.random() * area[2];
        const c = Math.random() < (o.mix ?? 0.6) ? A : B; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; spd[i] = 1.4 + Math.random() * 2.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: o.size ?? 0.5, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTex('rgba(255,255,255,1)', 'rgba(255,255,255,0.4)'), fog: false }));
    parent.add(pts);
    function update() { const p = geo.attributes.position; for (let i = 0; i < N; i++) { let y = p.getY(i) + spd[i] * 0.016; if (y > maxY) y = 0; p.setY(i, y); } p.needsUpdate = true; }
    return { pts, update };
}

/* ---------- birds (simple flapping V) ---------- */
export function addBirds(parent, o = {}) {
    const group = new THREE.Group(); parent.add(group);
    const mat = new THREE.MeshBasicMaterial({ color: o.color ?? 0x2A3340, fog: true });
    const n = o.count ?? 6, y = o.y ?? 40, z = o.z ?? -78;
    for (let i = 0; i < n; i++) {
        const b = new THREE.Group(); const wg = new THREE.BoxGeometry(1.4, 0.06, 0.4);
        const w1 = new THREE.Mesh(wg, mat); w1.position.x = -0.6; w1.rotation.z = 0.4;
        const w2 = new THREE.Mesh(wg, mat); w2.position.x = 0.6; w2.rotation.z = -0.4;
        b.add(w1, w2); b.position.set(-14 + i * 5 + (i % 2) * 2, y + (i % 3) * 3, z + (i % 2) * 4);
        b.userData = { w1, w2, ph: i * 0.5 }; group.add(b);
    }
    function update(t) { group.children.forEach(b => { const f = Math.sin(t * 6 + b.userData.ph) * 0.5; b.userData.w1.rotation.z = 0.4 + f; b.userData.w2.rotation.z = -0.4 - f; b.position.x += 0.02; if (b.position.x > 26) b.position.x = -26; }); }
    return { group, update };
}

/* ---------- song nodes (glowing ripple markers, SONGS-driven + interactive) ----------
 * layout: [{x, z}, ...] authored per-phase (resting spots on water/cloud/brook).
 * songs:  config/songs.js entries — colour comes from each song's theme color.
 * Returns markers (the THREE.Group per song, in songs order) for WorldUI to
 * project for DOM labels / picking, plus update(t) and setEmphasis(i, level).
 *   level 0 = idle, 1 = hovered/selected-focus, 2 = chosen (starting)
 */
export function createSongNodes(parent, layout, songs, o = {}) {
    const baseY = o.y ?? 0.1, ringR = o.ringR ?? 1.15, orbY = o.orbY ?? 1.1;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const nodes = songs.map((song, i) => {
        // Use the authored spot when available; otherwise fan out by golden angle.
        let spot = layout[i];
        if (!spot) { const a = goldenAngle * i, r = 3 + (i % 2); spot = { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.7 }; }
        const grp = new THREE.Group(); grp.position.set(spot.x, baseY, spot.z);
        const col = new THREE.Color(song.color);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.055, 8, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, fog: false })); ring.rotation.x = -Math.PI / 2; grp.add(ring);
        const exp = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.04, 8, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, fog: false })); exp.rotation.x = -Math.PI / 2; grp.add(exp);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,255,255,0.7)', `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0.4)`), color: col, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(1.3); glow.position.y = 0.25; grp.add(glow);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), new THREE.MeshBasicMaterial({ color: col, fog: false })); orb.position.y = orbY; grp.add(orb);
        parent.add(grp);
        return { grp, ring, exp, glow, orb, baseY, orbY, ph: i * 0.4, driftPh: (i * 1.37) % 6.28, emph: 0, grpScale: 1, orbScale: 1, glowScale: 1.3 };
    });

    function setEmphasis(i, level) {
        const nd = nodes[i]; if (!nd) return;
        nd.emph = level;
        nd.grpScale = level === 2 ? 1.28 : level === 1 ? 1.14 : 1.0;
        nd.orbScale = level === 2 ? 1.6 : level === 1 ? 1.28 : 1.0;
        nd.glowScale = level === 2 ? 2.2 : level === 1 ? 1.8 : 1.3;
        nd.ring.material.opacity = level ? 1.0 : 0.95;
    }

    function update(t) {
        nodes.forEach(nd => {
            const k = ((t + nd.ph) % 2.2) / 2.2; const s = 0.5 + k * 2.1;
            nd.exp.scale.set(s, s, 1); nd.exp.material.opacity = 0.85 * (1 - k);
            nd.orb.position.y = nd.orbY + Math.sin(t * 1.6 + nd.ph * 3) * 0.14;
            nd.grp.position.y = nd.baseY + Math.sin(t * 1.3 + nd.driftPh) * 0.07;
            // ease scales toward emphasis targets for smooth hover/select feedback
            const g = nd.grp.scale.x + (nd.grpScale - nd.grp.scale.x) * 0.18; nd.grp.scale.setScalar(g);
            const os = nd.orb.scale.x + (nd.orbScale - nd.orb.scale.x) * 0.18; nd.orb.scale.setScalar(os);
            const gs = nd.glow.scale.x + (nd.glowScale - nd.glow.scale.x) * 0.18; nd.glow.scale.setScalar(gs);
        });
    }

    const markers = nodes.map(n => n.grp);
    return { nodes, markers, update, setEmphasis };
}
