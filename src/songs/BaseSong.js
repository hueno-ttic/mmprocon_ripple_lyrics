import { eventBus } from '../core/eventBus.js';
import { LyricRenderer } from '../ui/LyricRenderer.js';
import { SONGS } from '../config/songs.js';

export class BaseSong {
    constructor(container, songId) {
        this.container = container;
        this.songId = songId;
        this.isActive = false;
        
        this.songWrapper = document.createElement('div');
        this.songWrapper.id = `song-wrapper-${songId}`;
        this.songWrapper.style.position = 'absolute';
        this.songWrapper.style.top = '0';
        this.songWrapper.style.left = '0';
        this.songWrapper.style.width = '100%';
        this.songWrapper.style.height = '100%';
        this.container.appendChild(this.songWrapper);

        // Initialize generic LyricRenderer
        this.lyricRenderer = new LyricRenderer(this.songWrapper);
        const songConfig = SONGS.find(s => s.id === songId);
        if (songConfig && songConfig.color) {
            this.lyricRenderer.setThemeColor(songConfig.color);
        }

        // References to clear up on destroy
        this.animationId = null;
        this.boundAnimate = this.animate.bind(this);
        this.boundOnTimeUpdate = this.onTimeUpdate.bind(this);
        this.boundOnClick = this.onClick.bind(this);
        this.boundOnMouseMove = this.onMouseMove.bind(this);
        
        this.currentTime = 0;
        this.mouseX = 0;
        this.mouseY = 0;
        this.targetCameraRotX = 0;
        this.targetCameraRotY = 0;
        
        // Add listeners for interaction
        this.songWrapper.addEventListener('click', this.boundOnClick);
        window.addEventListener('mousemove', this.boundOnMouseMove);
    }

    init() {
        this.isActive = true;
        eventBus.on('timeUpdate', this.boundOnTimeUpdate);
        this.animationId = requestAnimationFrame(this.boundAnimate);
        console.log(`Initialized song scene: ${this.songId}`);
    }

    onTimeUpdate(position) {
        this.currentTime = position;
    }

    onMouseMove(event) {
        if (!this.isActive) return;
        // Normalize mouse coordinates to -1 to +1
        this.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Set target rotation (subtle parallax)
        this.targetCameraRotY = -this.mouseX * 0.05;
        this.targetCameraRotX = this.mouseY * 0.05;
    }

    onClick(event) {
        if (!this.isActive) return;
        
        // Create interactive ripple effect
        const ripple = document.createElement('div');
        ripple.className = 'interactive-ripple';
        
        // Position at click
        const rect = this.songWrapper.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        
        // Apply theme color if available
        const songConfig = SONGS.find(s => s.id === this.songId);
        if (songConfig && songConfig.color) {
            ripple.style.borderColor = songConfig.color;
            ripple.style.boxShadow = `0 0 10px ${songConfig.color}`;
        }
        
        this.songWrapper.appendChild(ripple);
        
        // Clean up
        setTimeout(() => {
            if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
        }, 1000);
    }

    animate(time) {
        if (!this.isActive) return;
        this.animationId = requestAnimationFrame(this.boundAnimate);
        
        // Apply parallax to camera if it exists
        if (this.camera) {
            // Smoothly interpolate current rotation towards target rotation
            // We use a base rotation of 0 if not set
            const currentRotX = this.camera.rotation.x;
            const currentRotY = this.camera.rotation.y;
            this.camera.rotation.x += (this.targetCameraRotX - currentRotX) * 0.1;
            this.camera.rotation.y += (this.targetCameraRotY - currentRotY) * 0.1;
        }

        this.update(time);
        this.render();
    }

    // To be overridden by subclasses
    update(time) {
        if (!this.lyricRenderer) return;
        
        // Dynamic import to avoid circular dependency
        import('../core/player.js').then(({ playerManager }) => {
            if (playerManager.player && playerManager.player.video) {
                const phrase = playerManager.player.video.findPhrase(this.currentTime);
                this.lyricRenderer.update(phrase);
            }
        });
    }

    // To be overridden by subclasses
    render() {
        // Drawing updates
    }

    destroy() {
        this.isActive = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        eventBus.off('timeUpdate', this.boundOnTimeUpdate);
        
        if (this.lyricRenderer) {
            this.lyricRenderer.destroy();
        }
        
        // Subclasses should clear DOM elements, Three.js, PixiJS resources here
        if (this.songWrapper && this.songWrapper.parentNode) {
            this.songWrapper.removeEventListener('click', this.boundOnClick);
            window.removeEventListener('mousemove', this.boundOnMouseMove);
            this.songWrapper.parentNode.removeChild(this.songWrapper);
        }
        console.log(`Destroyed song scene: ${this.songId}`);
    }
}
