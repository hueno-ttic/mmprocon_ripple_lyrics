import { Credits } from './Credits.js';

export class TitleScreen {
    constructor(onComplete) {
        this.onComplete = onComplete;
        this.credits = new Credits();
        
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

        // 右下のクレジットボタン(タイトル画面のみの導線)
        this.creditsBtn = document.createElement('button');
        this.creditsBtn.type = 'button';
        this.creditsBtn.textContent = 'クレジット';
        this.creditsBtn.style.cssText = `
            position: absolute; right: 22px; bottom: 22px;
            padding: 9px 20px;
            font-family: 'Noto Sans JP', 'Inter', sans-serif;
            font-size: 13px; letter-spacing: 0.18em;
            color: rgba(255,255,255,0.85);
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.28);
            border-radius: 22px; cursor: pointer;
            opacity: 0; transition: opacity 1s ease, background 0.2s ease, border-color 0.2s ease;
            -webkit-tap-highlight-color: transparent;
        `;
        this.creditsBtn.addEventListener('mouseenter', () => {
            this.creditsBtn.style.background = 'rgba(255,255,255,0.18)';
            this.creditsBtn.style.borderColor = 'rgba(255,255,255,0.55)';
        });
        this.creditsBtn.addEventListener('mouseleave', () => {
            this.creditsBtn.style.background = 'rgba(255,255,255,0.08)';
            this.creditsBtn.style.borderColor = 'rgba(255,255,255,0.28)';
        });
        // クリックがタイトルの画面遷移に伝播しないよう抑止
        this.creditsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.credits.open();
        });
        this.container.appendChild(this.creditsBtn);

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
                this.creditsBtn.style.opacity = '1';
                this.container.addEventListener('click', this.boundOnClick);
            }, 2000);
        }, 500);
    }

    onClick() {
        this.container.removeEventListener('click', this.boundOnClick);

        // クレジットが開いていれば閉じ、ボタンも隠す
        if (this.credits) this.credits.close();
        this.creditsBtn.style.opacity = '0';
        this.creditsBtn.style.pointerEvents = 'none';

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
