import * as THREE from 'three';

export class PhaseBase {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.group = new THREE.Group();
        this.songMarkers = [];
        this.disposed = false;
    }

    enter(prevPhaseIndex) {
        this.scene.add(this.group);
        return Promise.resolve();
    }

    exit(nextPhaseIndex) {
        return Promise.resolve();
    }

    createSongMarkers(songs) {}

    getSongPosition(index) {
        if (this.songMarkers[index]) {
            return this.songMarkers[index].position.clone();
        }
        return new THREE.Vector3(0, 0, 0);
    }

    onHover(index) {}
    onUnhover(index) {}
    onSelect(index) {}

    update(time, delta) {}

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scene.remove(this.group);
        this.group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
    }
}
