export class PerformanceTracker {
    constructor() {
        this.lastTime = performance.now();
        this.frameCount = 0;
        this.fps = 60;
    }

    update() {
        const now = performance.now();
        this.frameCount++;
        if (now >= this.lastTime + 1000) {
            this.fps = (this.frameCount * 1000) / (now - this.lastTime);
            this.frameCount = 0;
            this.lastTime = now;
        }
    }
}
