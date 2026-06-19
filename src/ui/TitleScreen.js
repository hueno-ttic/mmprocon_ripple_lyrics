import { Credits } from './Credits.js';
import { stageRoot } from '../core/stage.js';

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
        this.container.style.overflow = 'hidden';

        // 背景の水面レイヤー(はっきり・速めに揺らぐ)
        this.waterLayer = document.createElement('div');
        this.waterLayer.style.cssText = `
            position: absolute; inset: -15%;
            z-index: 0; pointer-events: none;
            background:
                radial-gradient(55% 40% at 28% 32%, rgba(140,205,240,0.30), rgba(140,205,240,0) 70%),
                radial-gradient(50% 45% at 74% 62%, rgba(95,160,220,0.26), rgba(95,160,220,0) 72%),
                repeating-linear-gradient(108deg, rgba(170,220,245,0.05) 0px, rgba(170,220,245,0) 80px, rgba(170,220,245,0.05) 170px);
            background-size: 200% 200%, 220% 220%, 240% 240%;
            background-repeat: no-repeat;
            mix-blend-mode: screen;
            animation: water-drift 16s ease-in-out infinite, water-bob 9s ease-in-out infinite;
            will-change: background-position, transform;
        `;
        this.container.appendChild(this.waterLayer);

        this.title = document.createElement('h1');
        // 揺らぎは内側のspanに分離(フェードインのtransformと競合させない)
        this.titleInner = document.createElement('span');
        this.titleInner.innerText = 'Lake Sonare';
        this.titleInner.style.display = 'inline-block';
        this.titleInner.style.animation = 'title-sway 13s ease-in-out infinite';
        this.titleInner.style.willChange = 'transform';
        this.title.appendChild(this.titleInner);
        this.title.style.position = 'relative';
        this.title.style.zIndex = '1';
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
        this.subtitle.style.position = 'relative';
        this.subtitle.style.zIndex = '1';

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

                /* 背景の水面: 横移動は控えめに、ゆっくり明暗が漂う程度 */
                @keyframes water-drift {
                    0%   { background-position: 42% 48%, 58% 52%, 38% 42%; }
                    50%  { background-position: 52% 58%, 48% 44%, 46% 52%; }
                    100% { background-position: 42% 48%, 58% 52%, 38% 42%; }
                }
                @keyframes water-bob {
                    0%, 100% { transform: translateY(-1.5%) scale(1.06); }
                    50%      { transform: translateY(3.5%)  scale(1.09); }
                }

                /* タイトル: 背景より弱く・ゆっくり水面に乗って揺れる(振幅小・周期長) */
                @keyframes title-sway {
                    0%, 100% { transform: translate(0, 0)        rotate(0deg);    }
                    25%      { transform: translate(3px, -7px)   rotate(-0.5deg); }
                    50%      { transform: translate(0, -9px)     rotate(0deg);    }
                    75%      { transform: translate(-3px, -7px)  rotate(0.5deg);  }
                }

                /* タップ起点から広がる波紋 */
                @keyframes ripple-expand {
                    0%   { transform: translate(-50%, -50%) scale(0);    opacity: 0.85; }
                    60%  {                                                opacity: 0.35; }
                    100% { transform: translate(-50%, -50%) scale(1);    opacity: 0;    }
                }

                /* 波が通過した瞬間、背景の水面が一拍強く明滅(filterのみ＝transformと非干渉) */
                @keyframes water-disturb {
                    0%   { filter: brightness(1)   saturate(1);   }
                    28%  { filter: brightness(1.7) saturate(1.35);}
                    100% { filter: brightness(1)   saturate(1);   }
                }

                /* 波が文字に到達した時の反応(一度だけゆったり盛り上がって戻る) */
                @keyframes title-ripple {
                    0%   { transform: translate(0, 0)     scale(1);     }
                    50%  { transform: translate(0, -10px) scale(1.035); }
                    100% { transform: translate(0, 0)     scale(1);     }
                }
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
            position: absolute;
            right: calc(22px + env(safe-area-inset-right, 0px));
            bottom: calc(22px + env(safe-area-inset-bottom, 0px));
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

        stageRoot().appendChild(this.container);

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

    onClick(e) {
        this.container.removeEventListener('click', this.boundOnClick);

        // タップ座標(無い場合は中央)を起点にする
        const x = e && e.clientX != null ? e.clientX : window.innerWidth / 2;
        const y = e && e.clientY != null ? e.clientY : window.innerHeight / 2;
        this.spawnRipple(x, y);
        this.disturb(x, y);

        // クレジットが開いていれば閉じ、ボタンも隠す
        if (this.credits) this.credits.close();
        this.creditsBtn.style.opacity = '0';
        this.creditsBtn.style.pointerEvents = 'none';

        // 波紋・波打ちの出だしを見せたら、一定の速さで自然にフェードアウト
        const fadeOut = 'opacity 1.1s ease-in-out';
        setTimeout(() => {
            this.title.style.transition = fadeOut;
            this.subtitle.style.transition = fadeOut;
            this.container.style.transition = fadeOut;
            this.title.style.opacity = '0';
            this.subtitle.style.opacity = '0';
            this.container.style.opacity = '0';
        }, 700);

        setTimeout(() => {
            if (this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
            if (this.onComplete) {
                this.onComplete();
            }
        }, 1900);
    }

    // タップ点から広がる単一の波紋
    spawnRipple(x, y) {
        // 画面端まで届くよう、最遠コーナーまでの距離から直径を決める
        const far = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        const diameter = far * 2.2;
        const duration = 1.8;
        const ring = document.createElement('div');
        ring.style.cssText = `
            position: absolute; left: ${x}px; top: ${y}px;
            width: ${diameter}px; height: ${diameter}px;
            margin: 0; border-radius: 50%;
            border: 2px solid rgba(200,235,255,0.55);
            background: radial-gradient(circle, rgba(200,235,255,0.18) 0%, rgba(200,235,255,0) 62%);
            transform: translate(-50%, -50%) scale(0);
            opacity: 0; pointer-events: none; z-index: 3;
            mix-blend-mode: screen;
            animation: ripple-expand ${duration}s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
            will-change: transform, opacity;
        `;
        this.container.appendChild(ring);
        setTimeout(() => { if (ring.parentNode) ring.parentNode.removeChild(ring); }, duration * 1000 + 100);
    }

    // 波の通過に合わせて背景の揺らぎ・文字の揺らぎへ干渉させる
    disturb(x, y) {
        // 背景の水面: 既存のdrift/bobは残したまま明滅を一拍重ねる(filterは非干渉)
        if (this.waterLayer) {
            const base = 'water-drift 16s ease-in-out infinite, water-bob 9s ease-in-out infinite';
            this.waterLayer.style.animation = base + ', water-disturb 1.5s ease-out';
            setTimeout(() => { if (this.waterLayer) this.waterLayer.style.animation = base; }, 1500);
        }

        // 文字: 波がタイトル中心に到達するまでの距離に応じて遅延させ、減衰する波打ちへ差し替える
        if (this.titleInner) {
            const rect = this.title.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dist = Math.hypot(cx - x, cy - y);
            const delay = Math.min(dist / 1100, 0.5); // 遠いほど遅れて反応(秒)
            // ごくゆったり一度だけ波打たせる(ease-in-outで緩急をなだらかに)
            this.titleInner.style.animation = `title-ripple 5s ease-in-out ${delay}s`;
        }
    }
}
