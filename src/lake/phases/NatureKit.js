import * as THREE from 'three';

// Procedural nature props shared by the world phases. Everything is
// generated in code (no external assets — contest regulation safe).
// Quality approach: detail-2 icosahedrons displaced by SMOOTH pseudo-noise
// (random per-vertex jitter reads as cheap spikes), 3-tone foliage for
// volume, faceted rocks with moss, snow-capped twin-layer mountains.

// Smooth radial displacement — lumpy, organic, never spiky
function displaceRadial(geo, amp, freq = 2.1) {
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        const n =
            Math.sin(v.x * freq + v.y * 1.7) * 0.5 +
            Math.cos(v.y * freq * 0.8 + v.z * 2.3) * 0.3 +
            Math.sin(v.z * freq * 1.3 + v.x * 1.1) * 0.2;
        v.multiplyScalar(1 + n * amp);
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

function vary(hex, h = 0.03, l = 0.06) {
    const c = new THREE.Color(hex);
    c.offsetHSL((Math.random() - 0.5) * h, 0, (Math.random() - 0.5) * l);
    return c;
}

function leafMat(hex) {
    return new THREE.MeshLambertMaterial({ color: vary(hex, 0.03, 0.06), flatShading: true });
}

// ── Trees ─────────────────────────────────────────────────────

export function createBroadleafTree(scale = 1, palette = {}) {
    const trunkColor = palette.trunk ?? 0x5E4530;
    const base = palette.leaf ?? 0x2E6E3E;
    // 3-tone canopy: shadow base → mid → sunlit highlight
    const baseC = new THREE.Color(base);
    const midC = baseC.clone().offsetHSL(0.005, 0.02, 0.06);
    const hiC = baseC.clone().offsetHSL(0.01, 0.04, 0.14);

    const tree = new THREE.Group();
    const trunkH = (0.85 + Math.random() * 0.4) * scale;

    const trunkGeo = new THREE.CylinderGeometry(0.05 * scale, 0.11 * scale, trunkH, 8);
    // Gentle bend so trunks never look like straight pipes
    const tp = trunkGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
        const t = (tp.getY(i) / trunkH + 0.5);
        tp.setX(i, tp.getX(i) + Math.sin(t * 2.2) * 0.05 * scale);
    }
    tp.needsUpdate = true;
    trunkGeo.computeVertexNormals();
    const trunkMat = new THREE.MeshLambertMaterial({ color: vary(trunkColor, 0.01, 0.05) });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkH / 2;
    tree.add(trunk);

    // A branch or two reaching into the canopy
    for (let i = 0; i < 2; i++) {
        const bLen = trunkH * 0.45;
        const branch = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02 * scale, 0.04 * scale, bLen, 6),
            trunkMat
        );
        const side = i === 0 ? 1 : -1;
        branch.position.set(side * bLen * 0.3, trunkH * 0.8, (Math.random() - 0.5) * 0.1 * scale);
        branch.rotation.z = side * (0.7 + Math.random() * 0.3);
        tree.add(branch);
    }

    const addBlob = (r, color, x, y, z, squashY = 0.9) => {
        const geo = displaceRadial(new THREE.IcosahedronGeometry(r, 2), 0.12, 2.4 / r);
        const blob = new THREE.Mesh(geo, leafMat(color.getHex()));
        blob.position.set(x, y, z);
        blob.scale.y = squashY;
        blob.rotation.y = Math.random() * Math.PI;
        tree.add(blob);
    };

    const cy = trunkH + 0.32 * scale;
    // Shadowed underside — one wide dark blob
    addBlob(0.42 * scale, baseC, 0, cy - 0.06 * scale, 0, 0.8);
    // Mid-tone volume blobs
    const mids = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < mids; i++) {
        const a = (i / mids) * Math.PI * 2 + Math.random();
        addBlob(
            (0.24 + Math.random() * 0.1) * scale, midC,
            Math.cos(a) * 0.26 * scale,
            cy + (Math.random() * 0.18) * scale,
            Math.sin(a) * 0.26 * scale
        );
    }
    // Sunlit crown
    addBlob((0.2 + Math.random() * 0.08) * scale, hiC, 0.08 * scale, cy + 0.3 * scale, 0.04 * scale);

    return tree;
}

export function createConifer(scale = 1, palette = {}) {
    const trunkColor = palette.trunk ?? 0x4E3826;
    const base = palette.leaf ?? 0x2A5E40;
    const baseC = new THREE.Color(base);

    const tree = new THREE.Group();
    const trunkH = 0.3 * scale;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04 * scale, 0.08 * scale, trunkH + 0.15 * scale, 7),
        new THREE.MeshLambertMaterial({ color: vary(trunkColor, 0.01, 0.04) })
    );
    trunk.position.y = trunkH / 2;
    tree.add(trunk);

    // 4 tiers, each a touch lighter toward the top
    const tiers = 4;
    let y = trunkH;
    for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const r = (0.46 - t * 0.24) * scale;
        const h = (0.46 - t * 0.08) * scale;
        const geo = displaceRadial(new THREE.ConeGeometry(r, h, 9), 0.05, 3.0);
        const color = baseC.clone().offsetHSL(0.004 * i, 0.02 * i, 0.045 * i);
        const cone = new THREE.Mesh(geo, leafMat(color.getHex()));
        cone.position.y = y + h * 0.42;
        cone.rotation.y = Math.random() * Math.PI;
        tree.add(cone);
        y += h * 0.52;
    }
    return tree;
}

// ── Rocks / grass ─────────────────────────────────────────────

export function createRock(scale = 1, color = 0x7A8088) {
    const group = new THREE.Group();
    const r = (0.18 + Math.random() * 0.2) * scale;
    const geo = displaceRadial(new THREE.IcosahedronGeometry(r, 2), 0.18, 2.6 / r);
    const rock = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        color: vary(color, 0.01, 0.1),
        flatShading: true,
    }));
    rock.scale.set(1 + Math.random() * 0.6, 0.55 + Math.random() * 0.3, 1 + Math.random() * 0.4);
    rock.rotation.y = Math.random() * Math.PI;
    group.add(rock);

    // Companion pebble for a natural cluster
    if (Math.random() < 0.6) {
        const r2 = r * (0.4 + Math.random() * 0.25);
        const pebble = new THREE.Mesh(
            displaceRadial(new THREE.IcosahedronGeometry(r2, 1), 0.2, 3.0 / r2),
            new THREE.MeshLambertMaterial({ color: vary(color, 0.01, 0.12), flatShading: true })
        );
        pebble.position.set(r * 1.4, -r * 0.25, r * 0.4);
        pebble.scale.y = 0.6;
        group.add(pebble);
    }
    // Moss patch on the shaded top
    if (Math.random() < 0.5) {
        const moss = new THREE.Mesh(
            new THREE.IcosahedronGeometry(r * 0.5, 1),
            new THREE.MeshLambertMaterial({ color: vary(0x4E7E50, 0.03, 0.08), flatShading: true })
        );
        moss.position.set(-r * 0.3, r * 0.45, 0);
        moss.scale.set(1.2, 0.35, 1);
        group.add(moss);
    }
    return group;
}

export function createGrassTuft(scale = 1, color = 0x4E8E55) {
    const tuft = new THREE.Group();
    const blades = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < blades; i++) {
        const h = (0.16 + Math.random() * 0.2) * scale;
        const blade = new THREE.Mesh(
            new THREE.ConeGeometry(0.014 * scale, h, 4),
            new THREE.MeshLambertMaterial({ color: vary(color, 0.05, 0.12) })
        );
        blade.position.set(
            (Math.random() - 0.5) * 0.16 * scale,
            h / 2,
            (Math.random() - 0.5) * 0.16 * scale
        );
        blade.rotation.z = (Math.random() - 0.5) * 0.55;
        blade.rotation.x = (Math.random() - 0.5) * 0.55;
        tuft.add(blade);
    }
    return tuft;
}

// ── Sunflower ─────────────────────────────────────────────────

export function createSunflower(scale = 1) {
    const flower = new THREE.Group();
    const stemH = (0.65 + Math.random() * 0.45) * scale;

    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016 * scale, 0.028 * scale, stemH, 6),
        new THREE.MeshLambertMaterial({ color: vary(0x3E7C3E, 0.02, 0.06) })
    );
    stem.position.y = stemH / 2;
    flower.add(stem);

    for (let i = 0; i < 2; i++) {
        const leaf = new THREE.Mesh(
            new THREE.SphereGeometry(0.1 * scale, 8, 6),
            new THREE.MeshLambertMaterial({ color: vary(0x4E9050, 0.02, 0.07) })
        );
        const side = i === 0 ? 1 : -1;
        leaf.scale.set(1.5, 0.22, 0.7);
        leaf.position.set(side * 0.09 * scale, stemH * (0.38 + 0.22 * i), 0);
        leaf.rotation.z = side * 0.55;
        flower.add(leaf);
    }

    // Head faces +z (toward the camera side), tilted gently upward
    const head = new THREE.Group();
    const center = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085 * scale, 0.085 * scale, 0.035 * scale, 12),
        new THREE.MeshLambertMaterial({ color: vary(0x6B4A2A, 0.01, 0.06) })
    );
    center.rotation.x = Math.PI / 2;
    head.add(center);

    const petalMat = new THREE.MeshLambertMaterial({
        color: vary(Math.random() < 0.5 ? 0xFFC93E : 0xFFD45A, 0.012, 0.04),
        side: THREE.DoubleSide,
    });
    const petalGeo = new THREE.CircleGeometry(0.055 * scale, 5);
    const petals = 12;
    for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2;
        const petal = new THREE.Mesh(petalGeo, petalMat);
        petal.scale.set(0.5, 1.5, 1);
        petal.position.set(Math.cos(a) * 0.125 * scale, Math.sin(a) * 0.125 * scale, 0);
        petal.rotation.z = a - Math.PI / 2;
        head.add(petal);
    }

    head.position.y = stemH + 0.03 * scale;
    head.rotation.x = -0.25;
    head.rotation.y = (Math.random() - 0.5) * 0.5;
    flower.add(head);
    return flower;
}

// ── Cumulus cloud (bright summer cloud) ───────────────────────

export function createCumulusCloud(scale = 1) {
    const cloud = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
    const lumps = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < lumps; i++) {
        const r = (0.7 + Math.random() * 0.9) * scale;
        const geo = displaceRadial(new THREE.IcosahedronGeometry(r, 2), 0.1, 2.0 / r);
        const lump = new THREE.Mesh(geo, mat);
        lump.position.set(
            (i - lumps / 2) * 0.9 * scale + (Math.random() - 0.5) * 0.5,
            Math.random() * 0.4 * scale,
            (Math.random() - 0.5) * 0.8 * scale
        );
        lump.scale.y = 0.6;
        cloud.add(lump);
    }
    // Flat shaded base gives cumulus its anvil-bottom look
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(lumps * 0.5 * scale, lumps * 0.55 * scale, 0.2 * scale, 12),
        new THREE.MeshLambertMaterial({ color: 0xD8E4EE })
    );
    base.position.y = -0.25 * scale;
    cloud.add(base);
    return cloud;
}

// ── Distant mountains ─────────────────────────────────────────

export function createMountainRange({
    count = 6,
    distance = 60,
    spread = 90,
    color = 0x6E88A8,
    height = 14,
    fog = true,
} = {}) {
    const range = new THREE.Group();
    const nearC = new THREE.Color(color);
    // Far layer fades toward the sky — atmospheric perspective
    const farC = nearC.clone().lerp(new THREE.Color(0xDCE8F4), 0.45);
    const snowMat = new THREE.MeshLambertMaterial({ color: 0xF2F8FC, flatShading: true, fog });

    const buildLayer = (n, dist, c, hMul) => {
        const mat = new THREE.MeshLambertMaterial({ color: c, flatShading: true, fog });
        for (let i = 0; i < n; i++) {
            const h = height * hMul * (0.6 + Math.random() * 0.7);
            const r = h * (1.1 + Math.random() * 0.7);
            const geo = displaceRadial(new THREE.ConeGeometry(r, h, 9), 0.07, 1.8);
            const m = new THREE.Mesh(geo, mat);
            const x = (i / (n - 1) - 0.5) * spread + (Math.random() - 0.5) * 8;
            m.position.set(x, h * 0.3 - 2, -dist - Math.random() * 10);
            range.add(m);

            // Snow cap on the taller peaks
            if (h > height * hMul * 0.95) {
                const cap = new THREE.Mesh(
                    new THREE.ConeGeometry(r * 0.22, h * 0.2, 9),
                    snowMat
                );
                cap.position.set(x, m.position.y + h * 0.41, m.position.z);
                range.add(cap);
            }
        }
    };

    buildLayer(count, distance * 1.35, farC, 1.15);
    buildLayer(count, distance, nearC, 1.0);
    return range;
}

// ── Birds ─────────────────────────────────────────────────────

export function createBirdFlock(count = 5, color = 0x222A33) {
    const flock = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    for (let i = 0; i < count; i++) {
        const bird = new THREE.Group();
        const wingGeo = new THREE.PlaneGeometry(0.34, 0.1);
        const left = new THREE.Mesh(wingGeo, mat);
        left.position.x = -0.16;
        const right = new THREE.Mesh(wingGeo, mat);
        right.position.x = 0.16;
        bird.add(left, right);
        bird.userData = {
            left, right,
            offset: i * 0.9 + Math.random() * 0.5,
            lag: i * 0.35,
        };
        flock.add(bird);
    }
    flock.userData = {
        radius: 18 + Math.random() * 8,
        speed: 0.045 + Math.random() * 0.02,
        baseY: 8 + Math.random() * 3,
        phase: Math.random() * Math.PI * 2,
    };
    return flock;
}

export function updateBirdFlock(flock, time) {
    const u = flock.userData;
    flock.children.forEach((bird) => {
        const b = bird.userData;
        const a = u.phase + time * u.speed - b.lag * 0.06;
        bird.position.set(
            Math.cos(a) * u.radius + Math.sin(b.offset * 5.0) * 1.2,
            u.baseY + Math.sin(time * 0.5 + b.offset) * 0.7,
            -14 + Math.sin(a) * u.radius * 0.45
        );
        bird.rotation.y = -a;
        const flap = Math.sin(time * 7 + b.offset * 4) * 0.65;
        b.left.rotation.y = flap;
        b.right.rotation.y = -flap;
    });
}

// ── Sway helper ───────────────────────────────────────────────

export function swayItems(items, time, strength = 0.018, speed = 0.9) {
    items.forEach(({ obj, seed }) => {
        obj.rotation.z = Math.sin(time * speed + seed) * strength;
    });
}
