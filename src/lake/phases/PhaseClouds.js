import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';
import { getGlowTexture } from './glowTexture.js';
import { createSkyDome } from './SkyDome.js';
import { createMountainRange, createBirdFlock, updateBirdFlock } from './NatureKit.js';

// Phase 1「雲」— the risen vapor gathers into clouds. The sky dims from
// clear blue to overcast as white puffs drift slowly toward the center.
export class PhaseClouds extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildSky();
        this._buildPaleSun();
        this._buildClouds();
        this._buildLighting();
    }

    _buildSky() {
        this.sky = createSkyDome({
            top: '#5B79A3',
            horizon: '#ADBDD1',
            bottom: '#C9D4E0',
        });
        this.group.add(this.sky);
    }

    _buildPaleSun() {
        // Sun now veiled behind the gathering clouds
        const mat = new THREE.SpriteMaterial({
            map: getGlowTexture(),
            color: 0xF5F0E0,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.paleSun = new THREE.Sprite(mat);
        this.paleSun.position.set(-8, 13, -28);
        this.paleSun.scale.set(16, 16, 1);
        this.group.add(this.paleSun);
    }

    _buildClouds() {
        this.clouds = [];
        const cloudCount = window.innerWidth < 768 ? 6 : 10;

        for (let i = 0; i < cloudCount; i++) {
            const geo = new THREE.IcosahedronGeometry(1.4 + Math.random() * 1.2, 3);
            const positions = geo.attributes.position;
            for (let j = 0; j < positions.count; j++) {
                const x = positions.getX(j);
                const y = positions.getY(j);
                const z = positions.getZ(j);
                const noise = Math.sin(x * 2.3 + y * 1.7) * Math.cos(z * 1.9 + x) * 0.4;
                positions.setXYZ(j, x + noise * x * 0.3, y * 0.45 + noise * 0.2, z + noise * z * 0.3);
            }
            positions.needsUpdate = true;
            geo.computeVertexNormals();

            const mat = new THREE.MeshLambertMaterial({
                color: 0xF4F7FA,
                transparent: true,
                opacity: 0.92,
            });

            const cloud = new THREE.Mesh(geo, mat);
            const angle = (i / cloudCount) * Math.PI * 2 + Math.random();
            const dist = 6 + Math.random() * 8;
            cloud.position.set(
                Math.cos(angle) * dist,
                2.8 + Math.random() * 2.5,
                -3 + Math.sin(angle) * dist * 0.5
            );
            cloud.scale.set(1.2 + Math.random() * 0.6, 0.55, 1.1 + Math.random() * 0.5);
            cloud.userData = {
                angle,
                dist,
                gatherSpeed: 0.05 + Math.random() * 0.06,
                bobSeed: Math.random() * 10,
            };
            this.group.add(cloud);
            this.clouds.push(cloud);
        }
    }

    _buildLighting() {
        const hemi = new THREE.HemisphereLight(0xFFFFFF, 0x8A95A5, 1.15);
        this.group.add(hemi);
        const dir = new THREE.DirectionalLight(0xF0EBDB, 0.7);
        dir.position.set(-8, 13, -5);
        this.group.add(dir);

        // Hazy mountains far below the cloud layer for a sense of altitude
        this.group.add(createMountainRange({
            count: 8, distance: 50, spread: 120,
            color: 0x8A9AB0, height: 10,
        }));
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(220, 220),
            new THREE.MeshLambertMaterial({ color: 0x7E8FA2 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -2.5;
        this.group.add(ground);

        this.birds = createBirdFlock(6, 0x3A434E);
        this.group.add(this.birds);
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0xADBDD1);
        this.scene.fog = new THREE.FogExp2(0xB5C2D4, 0.009);
        this.camera.position.set(0, 3, 8.5);
        this.camera.lookAt(0, 3.2, 0);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        this.songMarkers = [];
        songs.forEach((song, i) => {
            const angle = (i / songs.length) * Math.PI * 2 + 0.4;
            const r = 3.2;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r * 0.6;
            const y = 2.8 + Math.sin(i * 2.1) * 0.8;

            const markerGroup = new THREE.Group();
            markerGroup.position.set(x, y, z);

            const sphereGeo = new THREE.SphereGeometry(0.16, 16, 12);
            const sphereMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(song.color),
            });
            markerGroup.add(new THREE.Mesh(sphereGeo, sphereMat));

            const spriteMat = new THREE.SpriteMaterial({
                map: getGlowTexture(),
                color: new THREE.Color(song.color),
                transparent: true,
                opacity: 0.55,
                blending: THREE.NormalBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.scale.set(0.9, 0.9, 1);
            markerGroup.add(sprite);

            markerGroup.userData = {
                songId: song.id,
                baseY: y,
                sprite,
                spriteMat,
                sphereMat,
            };

            this.group.add(markerGroup);
            this.songMarkers.push(markerGroup);
        });
    }

    getSongPosition(index) {
        if (this.songMarkers[index]) {
            const m = this.songMarkers[index];
            return new THREE.Vector3(m.position.x, m.position.y + 0.65, m.position.z);
        }
        return new THREE.Vector3(0, 3, 0);
    }

    onHover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 0.9;
        marker.userData.sprite.scale.set(1.3, 1.3, 1);
        marker.scale.set(1.25, 1.25, 1.25);
    }

    onUnhover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 0.55;
        marker.userData.sprite.scale.set(0.9, 0.9, 1);
        marker.scale.set(1, 1, 1);
    }

    onSelect(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.spriteMat.opacity = 1.0;
        marker.userData.sprite.scale.set(1.6, 1.6, 1);
        marker.scale.set(1.4, 1.4, 1.4);
    }

    update(time) {
        if (this.disposed) return;

        // Clouds slowly spiral inward — visibly "gathering"
        this.clouds.forEach((cloud) => {
            const u = cloud.userData;
            u.angle += 0.0006;
            u.dist = Math.max(2.5, u.dist - u.gatherSpeed * 0.016);
            cloud.position.x = Math.cos(u.angle) * u.dist;
            cloud.position.z = -3 + Math.sin(u.angle) * u.dist * 0.5;
            cloud.position.y += Math.sin(time * 0.3 + u.bobSeed) * 0.0015;
        });

        updateBirdFlock(this.birds, time);

        this.songMarkers.forEach((m, i) => {
            m.position.y = m.userData.baseY + Math.sin(time * 0.4 + i * 1.5) * 0.2;
        });
    }
}
