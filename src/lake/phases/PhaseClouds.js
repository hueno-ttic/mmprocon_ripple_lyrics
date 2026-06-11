import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';

export class PhaseClouds extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildClouds();
        this._buildAtmosphere();
    }

    _buildClouds() {
        this.clouds = [];
        const cloudCount = window.innerWidth < 768 ? 3 : 5;

        for (let i = 0; i < cloudCount; i++) {
            const geo = new THREE.IcosahedronGeometry(1.5 + Math.random(), 3);
            const positions = geo.attributes.position;
            // Displace vertices for lumpy cloud shape
            for (let j = 0; j < positions.count; j++) {
                const x = positions.getX(j);
                const y = positions.getY(j);
                const z = positions.getZ(j);
                const noise = Math.sin(x * 2.3 + y * 1.7) * Math.cos(z * 1.9 + x) * 0.4;
                positions.setXYZ(j, x + noise * x * 0.3, y * 0.5 + noise * 0.2, z + noise * z * 0.3);
            }
            positions.needsUpdate = true;
            geo.computeVertexNormals();

            const mat = new THREE.MeshStandardMaterial({
                color: 0x8899aa,
                transparent: true,
                opacity: 0.6,
                roughness: 1.0,
                metalness: 0,
                depthWrite: false,
            });

            const cloud = new THREE.Mesh(geo, mat);
            cloud.position.set(
                (Math.random() - 0.5) * 12,
                2 + Math.random() * 2,
                -2 + (Math.random() - 0.5) * 8
            );
            cloud.scale.set(1 + Math.random() * 0.5, 0.6, 1 + Math.random() * 0.5);
            this.group.add(cloud);
            this.clouds.push(cloud);
        }
    }

    _buildAtmosphere() {
        // Dim directional light from above
        this.topLight = new THREE.DirectionalLight(0x667799, 0.8);
        this.topLight.position.set(0, 10, 2);
        this.group.add(this.topLight);

        this.ambientLight = new THREE.AmbientLight(0x334455, 0.4);
        this.group.add(this.ambientLight);
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);
        this.scene.background = new THREE.Color(0x0a1525);
        this.scene.fog = new THREE.FogExp2(0x0a1525, 0.025);
        this.camera.position.set(0, 4, 6);
        this.camera.lookAt(0, 2.5, 0);
        return Promise.resolve();
    }

    createSongMarkers(songs) {
        this.songMarkers = [];
        songs.forEach((song, i) => {
            const angle = (i / songs.length) * Math.PI * 2;
            const r = 3;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            const y = 2.5 + Math.sin(i * 2.1) * 0.5;

            const markerGroup = new THREE.Group();
            markerGroup.position.set(x, y, z);

            const spriteMat = new THREE.SpriteMaterial({
                color: new THREE.Color(song.color),
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.scale.set(1.5, 1.5, 1);
            markerGroup.add(sprite);

            const light = new THREE.PointLight(new THREE.Color(song.color), 0.5, 6);
            markerGroup.add(light);

            markerGroup.userData = {
                songId: song.id,
                baseY: y,
                light,
                sprite,
                spriteMat,
            };

            this.group.add(markerGroup);
            this.songMarkers.push(markerGroup);
        });
    }

    getSongPosition(index) {
        if (this.songMarkers[index]) {
            const m = this.songMarkers[index];
            return new THREE.Vector3(m.position.x, m.position.y + 0.7, m.position.z);
        }
        return new THREE.Vector3(0, 3, 0);
    }

    onHover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.light.intensity = 1.5;
        marker.userData.spriteMat.opacity = 0.9;
        marker.userData.sprite.scale.set(2.2, 2.2, 1);
    }

    onUnhover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.light.intensity = 0.5;
        marker.userData.spriteMat.opacity = 0.6;
        marker.userData.sprite.scale.set(1.5, 1.5, 1);
    }

    onSelect(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.light.intensity = 3.0;
        marker.userData.spriteMat.opacity = 1.0;
    }

    update(time) {
        if (this.disposed) return;
        // Gentle cloud drift
        this.clouds.forEach((cloud, i) => {
            cloud.position.x += Math.sin(time * 0.1 + i) * 0.002;
            cloud.rotation.y = time * 0.02 + i;
        });

        this.songMarkers.forEach((m, i) => {
            m.position.y = m.userData.baseY + Math.sin(time * 0.4 + i * 1.5) * 0.2;
        });
    }
}
