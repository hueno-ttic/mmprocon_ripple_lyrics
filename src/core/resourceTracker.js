export class ResourceTracker {
    constructor() {
        this.resources = new Set();
    }

    track(resource) {
        if (!resource) return resource;
        this.resources.add(resource);
        return resource;
    }

    dispose() {
        for (const resource of this.resources) {
            if (resource && typeof resource.dispose === 'function') {
                resource.dispose();
            }
        }
        this.resources.clear();
    }
}
