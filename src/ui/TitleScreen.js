import { Credits } from './Credits.js';
import { stageRoot } from '../core/stage.js';
import { WaterCaustics } from './WaterCaustics.js';

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

        // 背景の水面: コースティクス(屈折で揺らぐ水面の光)を WebGL のフラグメント
        //   シェーダで描く。波打ちをピクセル単位でGPU計算するため、CSS feDisplacementMap
        //   のようにCPUで大面積を歪ませず 50–60fps を保てる(参考: AEのCaustics/WaveWorldの質感)。
        this.water = new WaterCaustics();
        if (this.water.ok) {
            this.container.appendChild(this.water.canvas);
        } else {
            // WebGL不可の環境フォールバック: transformのみで漂うCSSグラデ3層(再描画ゼロ)。
            this.water = null;
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
                    bg: `repeating-linear-gradient(104deg,
                            rgba(205,236,252,0.22) 0px, rgba(205,236,252,0) 90px,
                            rgba(205,236,252,0.22) 190px)`,
                    anim: 'water-churn 13s ease-in-out infinite',
                },
            ];
            layerDefs.forEach(({ bg, anim }) => {
                const layer = document.createElement('div');
                layer.style.cssText = `
                    position: absolute; inset: -40%;
                    z-index: 0; pointer-events: none;
                    background: ${bg};
                    animation: ${anim};
                    will-change: transform;
                `;
                this.container.appendChild(layer);
            });
        }

        this.title = document.createElement('h1');
        // 揺らぎは内側のspanに分離(フェードインのtransformと競合させない)
        this.titleInner = document.createElement('span');
        this.titleInner.innerText = 'Ripple Lyrics';
        this.titleInner.style.display = 'inline-block';
        // idleは文字を静止させる(波打たせない)。揺らぎ・歪みはタップ時のみ与える。
        // ※ filter は実際には一度も適用しない。will-change:filter を残すと一部のGPU/ドライバで
        //   文字が専用合成レイヤに昇格し、サブピクセルAA用の背景バッファが透明でなく黒で確保され、
        //   タイトル背後に黒ボックスが出る環境がある。実際に使う transform のみをヒントにして根絶する。
        this.titleInner.style.willChange = 'transform';
        this.title.appendChild(this.titleInner);
        this.title.style.position = 'relative';
        this.title.style.zIndex = '1';
        this.title.style.fontFamily = '"Inter", sans-serif';
        this.title.style.fontSize = 'min(6.67cqw, 80px)';
        this.title.style.fontWeight = '300';
        this.title.style.letterSpacing = '10px';
        this.title.style.opacity = '0';
        this.title.style.transform = 'translateY(20px)';
        this.title.style.transition = 'all 3s cubic-bezier(0.2, 0.8, 0.2, 1)';
        this.container.appendChild(this.title);

        // サブタイトル「水の循環」。フルタイトルは "Ripple Lyrics - 水の循環 -"。
        this.tagline = document.createElement('div');
        this.tagline.innerText = '- 水の循環 -';
        this.tagline.style.marginTop = '18px';
        this.tagline.style.fontSize = 'min(1.67cqw, 20px)';
        this.tagline.style.letterSpacing = '8px';
        this.tagline.style.fontWeight = '300';
        this.tagline.style.opacity = '0';
        this.tagline.style.transition = 'opacity 2s ease';
        this.tagline.style.position = 'relative';
        this.tagline.style.zIndex = '1';
        // タップ時にタイトルと同じく波打たせるため、transform合成のヒントを付ける。
        this.tagline.style.display = 'inline-block';
        this.tagline.style.willChange = 'transform';
        this.container.appendChild(this.tagline);

        this.subtitle = document.createElement('div');
        this.subtitle.innerText = '画面をクリックして波紋を起こす';
        this.subtitle.style.marginTop = '40px';
        this.subtitle.style.fontSize = 'min(1.5cqw, 18px)';
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
            font-size: min(1.08cqw, 13px); letter-spacing: 0.18em;
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
        // 水面シェーダの描画ループ開始(コンテナがステージへ追加され寸法が確定した後)
        if (this.water) this.water.start();

        // クリックは「即」受付する。以前はフェードイン完了(約2.5秒)まで
        // リスナーを付けず、それ以前のクリックが無反応で「壊れた?」と誤解される
        // 初見離脱の主因だった(評価レポート指摘)。最初のクリックから必ず反応させる。
        this.container.addEventListener('click', this.boundOnClick);

        // フェードイン(transitionを確実に走らせるため次フレームで発火)
        requestAnimationFrame(() => {
            this.title.style.opacity = '1';
            this.title.style.transform = 'translateY(0)';
            this.tagline.style.opacity = '0.85';
        });

        // 「画面をクリック」のヒントは早めに提示し、何をすればよいか3秒以内に伝える
        setTimeout(() => {
            this.subtitle.style.opacity = '1';
            this.creditsBtn.style.opacity = '1';
        }, 700);
    }

    onClick(e) {
        this.container.removeEventListener('click', this.boundOnClick);

        // タップ座標(無い場合は中央)を起点にする
        const x = e && e.clientX != null ? e.clientX : window.innerWidth / 2;
        const y = e && e.clientY != null ? e.clientY : window.innerHeight / 2;
        // 水面シェーダがあれば、水面そのものを屈折させる同心円波紋を起こす(参考の水面波紋)。
        // 無い環境ではDOMの拡大リングでフォールバック。
        if (this.water) {
            this.water.addRipple(x / window.innerWidth, y / window.innerHeight);
        } else {
            this.spawnRipple(x, y);
        }
        this.disturb();

        // クレジットが開いていれば閉じ、ボタンも隠す
        if (this.credits) this.credits.close();
        this.creditsBtn.style.opacity = '0';
        this.creditsBtn.style.pointerEvents = 'none';

        // 波紋の広がりを少し見せてから、素早くフェードアウト(もたつかせない)
        const fadeOut = 'opacity 0.55s ease-in';
        setTimeout(() => {
            this.title.style.transition = fadeOut;
            this.subtitle.style.transition = fadeOut;
            this.tagline.style.transition = fadeOut;
            this.container.style.transition = fadeOut;
            this.title.style.opacity = '0';
            this.subtitle.style.opacity = '0';
            this.tagline.style.opacity = '0';
            this.container.style.opacity = '0';
        }, 620);

        setTimeout(() => {
            if (this._titleRaf) { cancelAnimationFrame(this._titleRaf); this._titleRaf = 0; }
            if (this.water) { this.water.stop(); this.water = null; }
            if (this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
            if (this.onComplete) {
                this.onComplete();
            }
        }, 1300);
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

    // タップ時、タイトル文字を波紋に合わせて動かす。
    //  WebGL水面があれば、波紋の波面が文字の位置に到達した瞬間に合わせて
    //  文字をうねらせる(シェーダと同じ波の式をCPUで毎フレーム評価して transform 駆動)。
    //  WebGL不可ならCSSの簡易波打ちでフォールバック。
    disturb() {
        if (this.water) {
            this._syncTextToRipple();
        } else if (this.titleInner) {
            this.titleInner.style.animation = 'title-ripple 0.7s cubic-bezier(0.2, 0.8, 0.2, 1)';
            if (this.tagline) this.tagline.style.animation = 'title-ripple 0.7s cubic-bezier(0.2, 0.8, 0.2, 1)';
        }
    }

    // 要素の中心をキャンバス左上原点の正規化座標(0..1)で返す
    _centerUv(el) {
        const r = el.getBoundingClientRect();
        return [
            (r.left + r.width / 2) / window.innerWidth,
            (r.top + r.height / 2) / window.innerHeight,
        ];
    }

    // 波面の通過に同期して文字を上下/せん断で動かす(波紋の寿命ぶん回す)
    _syncTextToRipple() {
        const tUv = this._centerUv(this.titleInner);
        const gUv = this._centerUv(this.tagline);
        const sUv = this._centerUv(this.subtitle);
        const AMP = 52;      // 上下振幅(px)
        const SKEW = 12;     // せん断(deg)
        const CLAMP = 26;    // 近距離タップでの振れ過ぎを抑える上限(px)
        const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
        const start = performance.now();
        const tick = () => {
            this._titleRaf = 0;
            if (!this.water) return;
            // 文字向けは低周波・広め(うねり)で評価=細かいリングではなく波面の通過を大きく表現
            const ht = this.water.sampleHeight(tUv[0], tUv[1], 10, 5);
            const hg = this.water.sampleHeight(gUv[0], gUv[1], 10, 5);
            const hs = this.water.sampleHeight(sUv[0], sUv[1], 10, 5);
            const yt = clamp(-ht * AMP, CLAMP);
            const yg = clamp(-hg * AMP * 0.85, CLAMP * 0.85);
            const ys = clamp(-hs * AMP * 0.7, CLAMP * 0.7);
            this.titleInner.style.transform =
                `translateY(${yt.toFixed(2)}px) skewX(${clamp(ht * SKEW, 14).toFixed(2)}deg) ` +
                `scale(${(1 + Math.abs(ht) * 0.06).toFixed(3)})`;
            this.tagline.style.transform =
                `translateY(${yg.toFixed(2)}px) skewX(${clamp(hg * SKEW * 0.75, 11).toFixed(2)}deg)`;
            this.subtitle.style.transform =
                `translateY(${ys.toFixed(2)}px) skewX(${clamp(hs * SKEW * 0.6, 9).toFixed(2)}deg)`;
            if (performance.now() - start < 2200) {
                this._titleRaf = requestAnimationFrame(tick);
            } else {
                this.titleInner.style.transform = '';
                this.tagline.style.transform = '';
                this.subtitle.style.transform = '';
            }
        };
        this._titleRaf = requestAnimationFrame(tick);
    }
}
