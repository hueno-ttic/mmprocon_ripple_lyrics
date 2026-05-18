export class LyricRenderer {
    constructor(container) {
        this.container = container;
        this.lyricContainer = document.createElement('div');
        this.lyricContainer.style.position = 'absolute';
        this.lyricContainer.style.top = '0';
        this.lyricContainer.style.left = '0';
        this.lyricContainer.style.width = '100%';
        this.lyricContainer.style.height = '100%';
        this.lyricContainer.style.pointerEvents = 'none'; // click through
        this.lyricContainer.style.zIndex = '5';
        this.lyricContainer.style.display = 'flex';
        this.lyricContainer.style.justifyContent = 'center';
        this.lyricContainer.style.alignItems = 'center';
        this.lyricContainer.style.overflow = 'hidden';
        
        this.container.appendChild(this.lyricContainer);
        
        this.currentPhraseText = '';
        this.currentElement = null;
    }

    update(phrase) {
        if (!phrase) {
            if (this.currentElement) {
                this.currentElement.style.opacity = '0';
                this.currentElement.style.filter = 'blur(10px)';
                this.currentElement.style.transform = 'scale(1.1)';
                this.currentElement = null;
                this.currentPhraseText = '';
            }
            return;
        }

        if (phrase.text !== this.currentPhraseText) {
            this.currentPhraseText = phrase.text;
            
            // Fade out old element
            if (this.currentElement) {
                const oldEl = this.currentElement;
                oldEl.style.opacity = '0';
                oldEl.style.filter = 'blur(10px)';
                oldEl.style.transform = 'scale(1.1)';
                setTimeout(() => {
                    if (oldEl.parentNode) oldEl.parentNode.removeChild(oldEl);
                }, 1000);
            }

            // Create new element
            const el = document.createElement('div');
            el.innerText = phrase.text;
            el.style.position = 'absolute';
            el.style.fontSize = 'min(5vw, 64px)';
            el.style.fontWeight = 'bold';
            el.style.color = '#ffffff';
            el.style.textShadow = '0 0 20px rgba(255, 255, 255, 0.5), 0 0 40px var(--theme-color, rgba(255,255,255,0.3))';
            el.style.textAlign = 'center';
            el.style.whiteSpace = 'pre-wrap';
            el.style.opacity = '0';
            el.style.filter = 'blur(10px)';
            el.style.transform = 'scale(0.9)';
            el.style.transition = 'all 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)';
            
            this.lyricContainer.appendChild(el);
            
            // Force reflow
            void el.offsetWidth;
            
            // Fade in with ripple-like unblur
            el.style.opacity = '1';
            el.style.filter = 'blur(0px)';
            el.style.transform = 'scale(1)';
            
            this.currentElement = el;
        }
    }

    setThemeColor(colorHex) {
        this.lyricContainer.style.setProperty('--theme-color', colorHex);
    }

    destroy() {
        if (this.lyricContainer && this.lyricContainer.parentNode) {
            this.lyricContainer.parentNode.removeChild(this.lyricContainer);
        }
    }
}
