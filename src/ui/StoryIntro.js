import { appState } from '../core/appState.js';
import { stageRoot } from '../core/stage.js';

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

        stageRoot().appendChild(this.container);
    }

    async start() {
        this._skipped = false;
        this._skipResolve = null;

        // Enable pointer events so clicks are captured
        this.container.style.pointerEvents = 'auto';
        this.container.style.cursor = 'pointer';

        const skipPromise = new Promise(resolve => { this._skipResolve = resolve; });
        const onSkip = () => {
            this._skipped = true;
            if (this._skipResolve) this._skipResolve();
        };
        this.container.addEventListener('click', onSkip, { once: true });

        // 明確な「曲を選ぶ」スキップボタン(画面全体クリックでのスキップも従来通り残す)
        const skipBtn = document.createElement('button');
        skipBtn.className = 'story-skip-btn';
        skipBtn.textContent = '曲を選ぶ ▶';
        skipBtn.style.cssText = `
            position: absolute; right: 24px; bottom: 24px;
            min-width: 132px; min-height: 44px; padding: 0 20px;
            border-radius: 22px; border: 1px solid rgba(255,255,255,0.5);
            background: rgba(10,16,30,0.55); backdrop-filter: blur(8px);
            color: #fff; font-size: 13px; letter-spacing: 0.12em;
            cursor: pointer; pointer-events: auto;
            opacity: 0; transition: opacity 0.8s ease;
        `;
        skipBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onSkip();
        });
        this.container.appendChild(skipBtn);
        setTimeout(() => { skipBtn.style.opacity = '1'; }, 600);

        const raceOrText = (text, duration) => Promise.race([this.showText(text, duration), skipPromise]);

        const phase = appState.getPhase();
        const introTexts = [
            ['よく晴れた空の下、一滴の水の旅がはじまる。', '陽にのぼる光のしずくに、触れてみてください。'],
            ['のぼった水蒸気が、雲になって集まりだした。', '雲間に浮かぶ光に、触れてみてください。'],
            ['集まった雲は、ついに雨を降らせた。', '雨の中に浮かぶ光に、触れてみてください。'],
            ['雨があがり、地上に水たまりが残った。', '空を映す水たまりに、触れてみてください。'],
            ['水たまりは流れ出し、小川になった。', '小川のほとりに浮かぶ光に、触れてみてください。'],
            ['小川は合流し、大きな川になった。', '川を流れる光に、触れてみてください。'],
            ['川はついに湖へとたどり着いた。', '湖面に浮かぶ光に、触れてみてください。'],
        ];
        const [line1, line2] = introTexts[phase] || introTexts[0];

        await raceOrText(line1, 2200);
        if (!this._skipped) await raceOrText(line2, 2600);

        // Hand off to the app, which fades the screen curtain over this intro
        // and builds the world behind it. Remove our overlay once it's covered
        // so the cross-dissolve has no flash.
        if (this.onComplete) {
            this.onComplete();
        }
        setTimeout(() => {
            if (this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
        }, 520);
    }

    showText(text, duration) {
        return new Promise(resolve => {
            this.textElement.innerText = text;
            this.textElement.style.opacity = '1';
            
            setTimeout(() => {
                this.textElement.style.opacity = '0';
                setTimeout(resolve, 1000); // Wait for fade out to complete before next step
            }, duration);
        });
    }
}
