import { SONGS } from '../config/songs.js';
import { stageRoot } from '../core/stage.js';

export class CompletionScreen {
    constructor() {
        this.el = null;
    }

    show() {
        if (this.el) return;

        // Inject keyframe styles once
        if (!document.getElementById('completion-keyframes')) {
            const style = document.createElement('style');
            style.id = 'completion-keyframes';
            style.textContent = `
                @keyframes cs-ripple {
                    0%   { transform: translate(-50%,-50%) scale(0.4); opacity: 0.9; }
                    100% { transform: translate(-50%,-50%) scale(3.0); opacity: 0; }
                }
                @keyframes cs-fadeup {
                    from { opacity: 0; transform: translateY(18px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }

        this.el = document.createElement('div');
        this.el.id = 'completion-screen';
        this.el.style.cssText = `
            position: absolute; top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(2, 8, 15, 0);
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            z-index: 1000;
            transition: background 1.2s ease;
            overflow: hidden;
        `;
        stageRoot().appendChild(this.el);

        // Fade in background
        requestAnimationFrame(() => {
            this.el.style.background = 'rgba(2, 8, 15, 0.93)';
        });

        setTimeout(() => this._buildContent(), 700);

        // Close on Enter or Escape
        this._boundKeydown = (e) => {
            if (e.code === 'Enter' || e.code === 'Escape') this.hide();
        };
        window.addEventListener('keydown', this._boundKeydown);
    }

    _buildContent() {
        if (!this.el) return;

        // Ripple decoration
        const rippleWrap = document.createElement('div');
        rippleWrap.style.cssText = 'position:relative; width:80px; height:80px; margin-bottom:28px; flex-shrink:0;';
        [0, 0.6, 1.2].forEach(delay => {
            const ring = document.createElement('div');
            ring.style.cssText = `
                position: absolute; top: 50%; left: 50%;
                width: 36px; height: 36px;
                border-radius: 50%;
                border: 1px solid rgba(255,255,255,0.55);
                animation: cs-ripple 2.4s ${delay}s infinite ease-out;
            `;
            rippleWrap.appendChild(ring);
        });
        this.el.appendChild(rippleWrap);

        // Title
        const title = document.createElement('h1');
        title.textContent = '湖のソナーレ';
        title.style.cssText = `
            color: #fff; font-size: clamp(20px, 5vw, 34px);
            font-weight: 300; letter-spacing: 0.35em;
            margin: 0 0 10px; text-align: center;
            animation: cs-fadeup 0.7s ease both;
            text-shadow: 0 0 28px rgba(255,255,255,0.25);
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
        `;
        this.el.appendChild(title);

        const subtitle = document.createElement('p');
        subtitle.textContent = '晴れた空の一滴は、湖になった ── 6つの問いすべてに向き合いました';
        subtitle.style.cssText = `
            color: rgba(255,255,255,0.55); font-size: clamp(11px, 2.2vw, 13px);
            letter-spacing: 0.3em; margin: 0 0 36px; text-align: center;
            animation: cs-fadeup 0.7s 0.15s ease both;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
        `;
        this.el.appendChild(subtitle);

        // Song list
        const list = document.createElement('div');
        list.style.cssText = `
            display: flex; flex-direction: column; gap: 10px;
            margin-bottom: 40px; padding: 0 16px;
            max-width: 340px; width: 100%;
        `;

        SONGS.forEach((song, i) => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex; align-items: center; gap: 12px;
                opacity: 0;
                animation: cs-fadeup 0.5s ${0.35 + i * 0.1}s ease forwards;
            `;

            const check = document.createElement('span');
            check.textContent = '✓';
            check.style.cssText = `
                color: #D4AF37; font-size: 13px;
                width: 18px; text-align: center; flex-shrink: 0;
                filter: drop-shadow(0 0 4px #D4AF37);
            `;

            const name = document.createElement('span');
            name.textContent = song.title;
            name.style.cssText = `
                color: rgba(255,255,255,0.82); font-size: clamp(11px, 2.8vw, 13px);
                letter-spacing: 0.12em;
                text-shadow: 0 0 8px ${song.color};
                font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            `;

            row.appendChild(check);
            row.appendChild(name);
            list.appendChild(row);
        });
        this.el.appendChild(list);

        // Close button
        const btn = document.createElement('button');
        btn.textContent = '湖のソナーレへ';
        btn.style.cssText = `
            padding: 11px 30px;
            border: 1px solid rgba(255,255,255,0.35);
            background: transparent; color: rgba(255,255,255,0.75);
            font-size: 12px; letter-spacing: 0.25em; cursor: pointer;
            border-radius: 2px; transition: all 0.25s ease;
            animation: cs-fadeup 0.7s 1.2s ease both; opacity: 0;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
        `;
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(255,255,255,0.1)';
            btn.style.borderColor = 'rgba(255,255,255,0.75)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'transparent';
            btn.style.borderColor = 'rgba(255,255,255,0.35)';
        });
        btn.addEventListener('click', () => this.hide());
        this.el.appendChild(btn);

        // SNS Share button
        const shareText = encodeURIComponent('マジカルミライ2026「湖のソナーレ」で6つの問いすべてに向き合いました！ #マジカルミライ2026 #初音ミク');
        const shareUrl = encodeURIComponent(location.href);
        const shareBtn = document.createElement('a');
        shareBtn.href = `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`;
        shareBtn.target = '_blank';
        shareBtn.rel = 'noopener noreferrer';
        shareBtn.textContent = 'X（Twitter）でシェア';
        shareBtn.style.cssText = `
            display: inline-block;
            margin-top: 16px;
            padding: 9px 22px;
            border: 1px solid rgba(29,161,242,0.6);
            background: rgba(29,161,242,0.12); color: rgba(29,161,242,0.9);
            font-size: 11px; letter-spacing: 0.2em; cursor: pointer;
            border-radius: 2px; text-decoration: none;
            transition: all 0.25s ease;
            animation: cs-fadeup 0.7s 1.35s ease both; opacity: 0;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
        `;
        shareBtn.addEventListener('mouseenter', () => {
            shareBtn.style.background = 'rgba(29,161,242,0.25)';
            shareBtn.style.borderColor = 'rgba(29,161,242,0.9)';
        });
        shareBtn.addEventListener('mouseleave', () => {
            shareBtn.style.background = 'rgba(29,161,242,0.12)';
            shareBtn.style.borderColor = 'rgba(29,161,242,0.6)';
        });
        this.el.appendChild(shareBtn);

        const keyHint = document.createElement('p');
        keyHint.textContent = 'Enter / Esc でも閉じられます';
        keyHint.style.cssText = `
            color: rgba(255,255,255,0.25); font-size: 11px;
            letter-spacing: 0.15em; margin-top: 14px;
            animation: cs-fadeup 0.7s 1.5s ease both; opacity: 0;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
        `;
        this.el.appendChild(keyHint);
    }

    hide() {
        if (!this.el) return;
        window.removeEventListener('keydown', this._boundKeydown);
        this.el.style.transition = 'opacity 0.8s ease';
        this.el.style.opacity = '0';
        setTimeout(() => {
            if (this.el?.parentNode) this.el.parentNode.removeChild(this.el);
            this.el = null;
        }, 800);
    }
}
