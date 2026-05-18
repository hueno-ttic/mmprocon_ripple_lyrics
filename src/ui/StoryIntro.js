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
        await this.showText('ここは、問いが波紋になる世界。', 3000);
        await this.showText('水面に浮かぶ記憶に触れてみてください。', 3500);
        
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
