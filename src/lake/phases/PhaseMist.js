import * as THREE from 'three';
import { PhaseBase } from './PhaseBase.js';

export class PhaseMist extends PhaseBase {
    constructor(scene, camera, renderer) {
        super(scene, camera, renderer);
        this._buildFog();
        this._buildParticles();
    }

    _buildFog() {
        this.fogParticleCount = window.innerWidth < 768 ? 100 : 200;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(this.fogParticleCount * 3);
        const sizes = new Float32Array(this.fogParticleCount);
        const opacities = new Float32Array(this.fogParticleCount);

        for (let i = 0; i < this.fogParticleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 20;
            positions[i * 3 + 1] = Math.random() * 6 - 1;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
            sizes[i] = 15 + Math.random() * 25;
            opacities[i] = 0.03 + Math.random() * 0.08;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
            },
            vertexShader: `
                attribute float aSize;
                attribute float aOpacity;
                varying float vOpacity;
                uniform float uTime;
                uniform float uPixelRatio;
                void main() {
                    vOpacity = aOpacity;
                    vec3 pos = position;
                    pos.x += sin(uTime * 0.15 + position.z * 0.3) * 0.5;
                    pos.y += cos(uTime * 0.1 + position.x * 0.2) * 0.3;
                    pos.z += sin(uTime * 0.12 + position.y * 0.25) * 0.4;
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vOpacity;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float alpha = smoothstep(0.5, 0.0, d) * vOpacity;
                    gl_FragColor = vec4(0.6, 0.7, 0.85, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.fogPoints = new THREE.Points(geo, mat);
        this.group.add(this.fogPoints);
    }

    _buildParticles() {
        // Tiny floating dust particles for extra atmosphere
        const count = window.innerWidth < 768 ? 50 : 120;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 16;
            positions[i * 3 + 1] = Math.random() * 5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 16;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.PointsMaterial({
            color: 0x8899bb,
            size: 0.08,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.dustPoints = new THREE.Points(geo, mat);
        this.group.add(this.dustPoints);
    }

    enter(prevPhaseIndex) {
        super.enter(prevPhaseIndex);

        this.scene.background = new THREE.Color(0x020406);
        this.scene.fog = new THREE.FogExp2(0x020406, 0.04);

        this.camera.position.set(0, 2, 5);
        this.camera.lookAt(0, 1, 0);

        return Promise.resolve();
    }

    createSongMarkers(songs) {
        this.songMarkers = [];
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));

        songs.forEach((song, i) => {
            const theta = goldenAngle * i;
            const r = 2.5 + (i % 2) * 0.8;
            const x = Math.cos(theta) * r;
            const z = Math.sin(theta) * r;
            const y = 1.0 + Math.sin(i * 1.7) * 0.8;

            const markerGroup = new THREE.Group();
            markerGroup.position.set(x, y, z);

            // Glowing sprite
            const spriteMat = new THREE.SpriteMaterial({
                color: new THREE.Color(song.color),
                transparent: true,
                opacity: 0.35,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.scale.set(1.2, 1.2, 1);
            markerGroup.add(sprite);

            // Point light
            const light = new THREE.PointLight(new THREE.Color(song.color), 0.3, 5);
            markerGroup.add(light);

            markerGroup.userData = {
                songId: song.id,
                baseY: y,
                baseOpacity: 0.35,
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
            return new THREE.Vector3(m.position.x, m.position.y + 0.6, m.position.z);
        }
        return new THREE.Vector3(0, 1, 0);
    }

    onHover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.light.intensity = 1.2;
        marker.userData.spriteMat.opacity = 0.8;
        marker.userData.sprite.scale.set(1.8, 1.8, 1);
    }

    onUnhover(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.light.intensity = 0.3;
        marker.userData.spriteMat.opacity = 0.35;
        marker.userData.sprite.scale.set(1.2, 1.2, 1);
    }

    onSelect(index) {
        const marker = this.songMarkers[index];
        if (!marker) return;
        marker.userData.light.intensity = 3.0;
        marker.userData.spriteMat.opacity = 1.0;
        marker.userData.sprite.scale.set(3.0, 3.0, 1);
    }

    update(time) {
        if (this.disposed) return;
        this.fogPoints.material.uniforms.uTime.value = time;

        // Gentle bob for song markers
        this.songMarkers.forEach((m, i) => {
            m.position.y = m.userData.baseY + Math.sin(time * 0.5 + i * 1.2) * 0.15;
        });

        // Rotate dust slowly
        if (this.dustPoints) {
            this.dustPoints.rotation.y = time * 0.02;
        }
    }
}
