export class TitleScreen {
    constructor(onComplete) {
        this.onComplete = onComplete;
        
        this.container = document.createElement('div');
        this.container.style.position = 'absolute';
        this.container.style.top = '0';
        this.container.style.left = '0';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
        this.container.style.color = '#ffffff';
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.justifyContent = 'center';
        this.container.style.alignItems = 'center';
        this.container.style.zIndex = '2000';
        this.container.style.opacity = '1';
        this.container.style.transition = 'opacity 2s ease';

        this.title = document.createElement('h1');
        this.title.innerText = 'Lake Sonare';
        this.title.style.fontFamily = '"Inter", sans-serif';
        this.title.style.fontSize = 'min(10vw, 80px)';
        this.title.style.fontWeight = '300';
        this.title.style.letterSpacing = '10px';
        this.title.style.opacity = '0';
        this.title.style.transform = 'translateY(20px)';
        this.title.style.transition = 'all 3s cubic-bezier(0.2, 0.8, 0.2, 1)';
        this.container.appendChild(this.title);

        this.subtitle = document.createElement('div');
        this.subtitle.innerText = '画面をクリックして波紋を起こす';
        this.subtitle.style.marginTop = '40px';
        this.subtitle.style.fontSize = '18px';
        this.subtitle.style.letterSpacing = '4px';
        this.subtitle.style.opacity = '0';
        this.subtitle.style.transition = 'opacity 1s ease';
        
        // Add a pulsing animation via injected style if not present
        if (!document.getElementById('pulse-anim')) {
            const style = document.createElement('style');
            style.id = 'pulse-anim';
            style.innerHTML = `
                @keyframes pulse-opacity {
                    0% { opacity: 0.3; }
                    50% { opacity: 1; }
                    100% { opacity: 0.3; }
                }
                .pulse-text { animation: pulse-opacity 3s infinite ease-in-out; }
            `;
            document.head.appendChild(style);
        }
        
        this.subtitle.className = 'pulse-text';
        this.container.appendChild(this.subtitle);

        document.body.appendChild(this.container);

        this.boundOnClick = this.onClick.bind(this);
    }

    start() {
        // Trigger initial fade-in
        setTimeout(() => {
            this.title.style.opacity = '1';
            this.title.style.transform = 'translateY(0)';
            
            setTimeout(() => {
                this.subtitle.style.opacity = '1';
                this.container.addEventListener('click', this.boundOnClick);
            }, 2000);
        }, 500);
    }

    onClick() {
        this.container.removeEventListener('click', this.boundOnClick);
        
        // Fade out everything
        this.title.style.opacity = '0';
        this.subtitle.style.opacity = '0';
        this.container.style.opacity = '0';
        
        setTimeout(() => {
            if (this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
            if (this.onComplete) {
                this.onComplete();
            }
        }, 2000);
    }
}
