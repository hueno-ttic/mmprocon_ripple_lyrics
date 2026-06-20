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

        // ※ タップ演出はSVGの feDisplacementMap(毎フレーム大面積を歪ませる=重い)を使わず、
        //   transformベースのキーフレーム(GPU合成・再描画ゼロ)で軽快に波打たせる。

        // 背景の水面レイヤー(3層)。
        //  動きは transform のみ(translate/scale/rotate/skew) = GPU合成で再描画ゼロ(軽い)。
        //  「波長を大きく・周波数を小さく」=ゆったりした大波のイメージ:
        //   - グラデの塊と縞を大きく取り(大波長)、周期を長く(低周波)してゆっくり動かす。
        //   - skewは控えめにして、鋭い波立ちではなく広い大波のうねりにする。
        //  inset を広めに取り、端が覗いてもグラデは透明へ抜ける。
        //  ※ background-position アニメや mix-blend-mode はCPU再描画/背景合成で重いため不使用。
        const layerDefs = [
            {
                bg: `radial-gradient(78% 60% at 28% 30%, rgba(158,216,248,0.60), rgba(158,216,248,0) 70%),
                     radial-gradient(74% 64% at 76% 68%, rgba(98,168,226,0.56), rgba(98,168,226,0) 72%)`,
                anim: 'water-swell 15s ease-in-out infinite',
            },
            {
                bg: `radial-gradient(70% 58% at 54% 80%, rgba(132,202,242,0.46), rgba(132,202,242,0) 74%),
                     radial-gradient(64% 54% at 16% 64%, rgba(150,212,245,0.42), rgba(150,212,245,0) 72%)`,
                anim: 'water-flow 19s ease-in-out infinite',
            },
            {
                // コントラストのある縞=コースティクス。これが動くと「水が流れている」と知覚できる。
                // 縞は広め(大波長)・周期は11s(ゆったり)・移動量は約1縞分でゆっくり寄せて返す。
                bg: `repeating-linear-gradient(104deg,
                        rgba(205,236,252,0.22) 0px, rgba(205,236,252,0) 90px,
                        rgba(205,236,252,0.22) 190px)`,
                anim: 'water-churn 13s ease-in-out infinite',
            },
        ];
        this.waterLayers = layerDefs.map(({ bg, anim }) => {
            const layer = document.createElement('div');
            layer.style.cssText = `
                position: absolute; inset: -40%;
                z-index: 0; pointer-events: none;
                background: ${bg};
                animation: ${anim};
                will-change: transform;
            `;
            this.container.appendChild(layer);
            return layer;
        });

        this.title = document.createElement('h1');
        // 揺らぎは内側のspanに分離(フェードインのtransformと競合させない)
        this.titleInner = document.createElement('span');
        this.titleInner.innerText = 'Lake Sonare';
        this.titleInner.style.display = 'inline-block';
        // idleは文字を静止させる(波打たせない)。揺らぎ・歪みはタップ時のみ与える。
        this.titleInner.style.willChange = 'transform, filter';
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

                /* 背景の水面: transformのみで波打たせる(GPU合成・再描画なし=軽い)。
                   波長を大きく・周波数を小さく=大きくゆったりした大波。translate/scaleの
                   ストロークは大きめに保ちつつ、skew/rotateは控えめにして鋭さを消す。 */
                @keyframes water-swell {
                    0%, 100% { transform: translate3d(-9%, -6%, 0) scale(1.06) rotate(-1deg) skewX(-1.2deg); }
                    50%      { transform: translate3d(9%,   7%, 0) scale(1.14) rotate(1deg)  skewX(1.2deg);  }
                }
                @keyframes water-flow {
                    0%, 100% { transform: translate3d(10%,  6%, 0) scale(1.14) rotate(1deg)  skewY(-1.1deg); }
                    50%      { transform: translate3d(-10%,-7%, 0) scale(1.06) rotate(-1deg) skewY(1.1deg);  }
                }
                @keyframes water-churn {
                    0%, 100% { transform: translate3d(-7%, -8%, 0) scale(1.08) rotate(-0.8deg) skewX(1deg);  }
                    50%      { transform: translate3d(8%,   8%, 0) scale(1.16) rotate(0.8deg)  skewX(-1deg); }
                }

                /* タップ起点から広がる波紋 */
                @keyframes ripple-expand {
                    0%   { transform: translate(-50%, -50%) scale(0);    opacity: 0.85; }
                    60%  {                                                opacity: 0.35; }
                    100% { transform: translate(-50%, -50%) scale(1);    opacity: 0;    }
                }

                /* タップ時の文字の波打ち: 軽快に一度ブルッと波打って素早く収束(transformのみ=軽い) */
                @keyframes title-ripple {
                    0%   { transform: translateY(0)     scale(1)    skewX(0deg);   }
                    22%  { transform: translateY(-9px)  scale(1.05) skewX(4deg);   }
                    48%  { transform: translateY(3px)   scale(0.99) skewX(-2.6deg);}
                    74%  { transform: translateY(-2px)  scale(1.01) skewX(1.2deg); }
                    100% { transform: translateY(0)     scale(1)    skewX(0deg);   }
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
        this.disturb();

        // クレジットが開いていれば閉じ、ボタンも隠す
        if (this.credits) this.credits.close();
        this.creditsBtn.style.opacity = '0';
        this.creditsBtn.style.pointerEvents = 'none';

        // 波紋の広がりをひと目見せたら、素早くフェードアウト(もたつかせない)
        const fadeOut = 'opacity 0.55s ease-in';
        setTimeout(() => {
            this.title.style.transition = fadeOut;
            this.subtitle.style.transition = fadeOut;
            this.container.style.transition = fadeOut;
            this.title.style.opacity = '0';
            this.subtitle.style.opacity = '0';
            this.container.style.opacity = '0';
        }, 420);

        setTimeout(() => {
            if (this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
            if (this.onComplete) {
                this.onComplete();
            }
        }, 1050);
    }

    // タップ点から広がる単一の波紋
    spawnRipple(x, y) {
        // 画面端まで届くよう、最遠コーナーまでの距離から直径を決める
        const far = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        const diameter = far * 2.2;
        // ゆったり広がって消える。mix-blend-mode は毎フレーム背景合成で重いため不使用。
        // transform/opacityのみ=GPUで軽い。
        const duration = 1.25;
        const ring = document.createElement('div');
        ring.style.cssText = `
            position: absolute; left: ${x}px; top: ${y}px;
            width: ${diameter}px; height: ${diameter}px;
            margin: 0; border-radius: 50%;
            border: 3px solid rgba(220,242,255,0.85);
            background: radial-gradient(circle, rgba(220,242,255,0.22) 0%, rgba(220,242,255,0) 60%);
            transform: translate(-50%, -50%) scale(0);
            opacity: 0; pointer-events: none; z-index: 3;
            animation: ripple-expand ${duration}s cubic-bezier(0.25, 0.5, 0.35, 1) forwards;
            will-change: transform, opacity;
        `;
        this.container.appendChild(ring);
        setTimeout(() => { if (ring.parentNode) ring.parentNode.removeChild(ring); }, duration * 1000 + 100);
    }

    // タップ時、タイトル文字を軽快に一度だけ波打たせる。
    // transformのみ(GPU合成・再描画なし)なのでFPSを落とさない。
    disturb() {
        if (this.titleInner) {
            // 素早い波打ち(skew主体の減衰オシレーション)。0.7秒で収束。
            this.titleInner.style.animation = 'title-ripple 0.7s cubic-bezier(0.2, 0.8, 0.2, 1)';
        }
    }
}
