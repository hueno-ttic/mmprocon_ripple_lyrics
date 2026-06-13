import * as THREE from 'three';

export class PhaseBase {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.group = new THREE.Group();
        this.songMarkers = [];
        this.disposed = false;

        // Renderer-level look applied by WorldUI when this phase becomes active.
        // Subclasses override these to match the design draft per-scene grading.
        this.exposure = 1.12;
        this.bloomParams = { strength: 0.4, radius: 0.5, threshold: 0.85 };

        // Camera parallax driven by WorldUI.animate(): base position + look target
        // with a gentle idle drift. Subclasses set this in enter().
        this.cameraRig = {
            pos: [0, 6, 34],
            lookAt: [0, 4, -40],
            drift: { ax: 2.0, fx: 0.10, ay: 0.25, fy: 0.16 },
        };
    }

    enter(prevPhaseIndex) {
        this.scene.add(this.group);
        return Promise.resolve();
    }

    exit(nextPhaseIndex) {
        return Promise.resolve();
    }

    // Phases build their song nodes via sceneKit.createSongNodes() and assign
    // the result to this.nodes (+ this.songMarkers = this.nodes.markers). The
    // interaction hooks below are uniform across phases, so they live here.
    createSongMarkers(songs) {}

    getSongPosition(index) {
        const m = this.songMarkers[index];
        if (!m) return new THREE.Vector3(0, 0, 0);
        const orbY = this.nodes?.nodes?.[index]?.orbY ?? 1.0;
        // Aim DOM labels just above the floating orb of each node
        return new THREE.Vector3(m.position.x, m.position.y + orbY + 0.4, m.position.z);
    }

    onHover(index) { this.nodes?.setEmphasis(index, 1); }
    onUnhover(index) { this.nodes?.setEmphasis(index, 0); }
    onSelect(index) { this.nodes?.setEmphasis(index, 2); }

    update(time, delta) {}

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        // Reflector-based water holds a render target that group traversal won't free.
        if (this.water?.dispose) this.water.dispose();
        if (this.mirror?.getRenderTarget) this.mirror.getRenderTarget().dispose();
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
