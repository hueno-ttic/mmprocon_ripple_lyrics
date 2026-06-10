import { groupPhraseWords, findGroupForWord } from '../utils/lyricGroups.js';

export class LyricRenderer {
    constructor(container) {
        this.container = container;
        this.lyricContainer = document.createElement('div');
        this.lyricContainer.style.position = 'absolute';
        this.lyricContainer.style.top = '0';
        this.lyricContainer.style.left = '0';
        this.lyricContainer.style.width = '100%';
        this.lyricContainer.style.height = '100%';
        this.lyricContainer.style.pointerEvents = 'none';
        this.lyricContainer.style.zIndex = '5';
        this.lyricContainer.style.display = 'flex';
        this.lyricContainer.style.justifyContent = 'center';
        this.lyricContainer.style.alignItems = 'center';
        this.lyricContainer.style.overflow = 'hidden';

        this.container.appendChild(this.lyricContainer);

        this.currentPhraseText = '';
        this.currentElement = null;
    }

    update(unit) {
        if (!unit) {
            if (this.currentElement) {
                this.currentElement.style.opacity = '0';
                this.currentElement.style.filter = 'blur(10px)';
                this.currentElement.style.transform = 'scale(1.1)';
                this.currentElement = null;
                this.currentPhraseText = '';
            }
            return;
        }

        let displayText;

        // Word objects from findWord() have a parent IPhrase with a firstWord chain.
        if (unit.parent && unit.parent.firstWord) {
            const groups = groupPhraseWords(unit.parent);
            const group = findGroupForWord(groups, unit);
            displayText = group ? group.text : unit.text;
        } else {
            displayText = unit.text;
        }

        if (displayText !== this.currentPhraseText) {
            this.currentPhraseText = displayText;

            if (this.currentElement) {
                const oldEl = this.currentElement;
                oldEl.style.opacity = '0';
                oldEl.style.filter = 'blur(10px)';
                oldEl.style.transform = 'scale(1.1)';
                setTimeout(() => {
                    if (oldEl.parentNode) oldEl.parentNode.removeChild(oldEl);
                }, 1000);
            }

            const el = document.createElement('div');
            el.innerText = displayText;
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
            el.style.transition = 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)';

            this.lyricContainer.appendChild(el);
            void el.offsetWidth;

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
