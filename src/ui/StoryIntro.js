export class StoryIntro {
    constructor(onComplete) {
        this.onComplete = onComplete;
        
        this.container = document.createElement('div');
        this.container.style.position = 'absolute';
        this.container.style.top = '0';
        this.container.style.left = '0';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.backgroundColor = 'transparent'; // Shows LakeUI behind if it is already there
        this.container.style.color = '#ffffff';
        this.container.style.display = 'flex';
        this.container.style.justifyContent = 'center';
        this.container.style.alignItems = 'center';
        this.container.style.zIndex = '1500';
        this.container.style.pointerEvents = 'none'; // Don't block clicks

        this.textElement = document.createElement('div');
        this.textElement.style.fontSize = 'min(4vw, 32px)';
        this.textElement.style.letterSpacing = '2px';
        this.textElement.style.fontWeight = '300';
        this.textElement.style.textAlign = 'center';
        this.textElement.style.opacity = '0';
        this.textElement.style.transition = 'opacity 2s ease';
        this.container.appendChild(this.textElement);

        document.body.appendChild(this.container);
    }

    async start() {
        this._skipped = false;
        this._skipResolve = null;

        // Enable pointer events so clicks are captured
        this.container.style.pointerEvents = 'auto';
        this.container.style.cursor = 'pointer';

        const skipHint = document.createElement('div');
        skipHint.textContent = 'タップでスキップ';
        skipHint.style.cssText = `
            position: absolute; bottom: 32px; left: 50%;
            transform: translateX(-50%);
            font-size: 11px; letter-spacing: 0.2em;
            color: rgba(255,255,255,0.35);
            pointer-events: none;
            transition: opacity 1s ease;
        `;
        this.container.appendChild(skipHint);
        setTimeout(() => { skipHint.style.opacity = '1'; }, 800);

        const skipPromise = new Promise(resolve => { this._skipResolve = resolve; });
        const onSkip = () => {
            this._skipped = true;
            if (this._skipResolve) this._skipResolve();
        };
        this.container.addEventListener('click', onSkip, { once: true });

        const raceOrText = (text, duration) => Promise.race([this.showText(text, duration), skipPromise]);

        await raceOrText('ここは、問いが波紋になる世界。', 3000);
        if (!this._skipped) await raceOrText('水面に浮かぶ記憶に触れてみてください。', 3500);

        this.container.style.transition = 'opacity 0.4s ease';
        this.container.style.opacity = '0';
        await new Promise(r => setTimeout(r, 400));

        if (this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        if (this.onComplete) {
            this.onComplete();
        }
    }

    showText(text, duration) {
        return new Promise(resolve => {
            this.textElement.innerText = text;
            this.textElement.style.opacity = '1';
            
            setTimeout(() => {
                this.textElement.style.opacity = '0';
                setTimeout(resolve, 2000); // Wait for fade out to complete before next step
            }, duration);
        });
    }
}
