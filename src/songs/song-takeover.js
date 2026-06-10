import * as THREE from 'three';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { groupPhraseWordsByMinLength, findGroupForWord } from '../utils/lyricGroups.js';

export class SongTakeover extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.debris = [];

        // AES-256-GCM key (generated once per scene, non-extractable)
        this._cryptoKey = null;
        this._cryptoReady = false;

        this.phraseTargets = [];
        this.lastPhraseStart = -1;
        this.lastGroupStartTime = -1;
        this.takenCount = 0;
        this.totalCount = 0;

        this.isClimax = false;
        this.prevIsClimax = false;

        this.scoreEl = null;

        this._debrisEdgesGeo = null;
        this._debrisMat = null;

        this.boundOnResize = this.onResize.bind(this);
    }

    init() {
        this.initThree();
        this.initDebris();
        this.initUI();
        this._initCrypto(); // async, completes well before first phrase
        window.addEventListener('resize', this.boundOnResize);
        this.isActive = true;
        super.init();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a0028);
        this.scene.fog = new THREE.FogExp2(0x1a0028, 0.018);

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
        this.camera.position.set(0, 0, 10);

        this.renderer = new THREE.WebGLRenderer({ antialias: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;z-index:1;';
        this.songWrapper.appendChild(this.renderer.domElement);
    }

    initDebris() {
        const tmp = new THREE.TetrahedronGeometry(0.7, 0);
        this._debrisEdgesGeo = new THREE.EdgesGeometry(tmp);
        tmp.dispose();
        this._debrisMat = new THREE.LineBasicMaterial({ color: 0x5a1060, transparent: true, opacity: 0.55 });

        for (let i = 0; i < 18; i++) {
            const m = new THREE.LineSegments(this._debrisEdgesGeo, this._debrisMat);
            m.position.set((Math.random()-0.5)*45, (Math.random()-0.5)*28, -8 - Math.random()*32);
            m.rotation.set(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
            m.userData.rot = new THREE.Vector3(
                (Math.random()-0.5)*0.009, (Math.random()-0.5)*0.009, (Math.random()-0.5)*0.009
            );
            this.scene.add(m);
            this.debris.push(m);
        }
    }

    initUI() {
        if (!document.getElementById('takeover-style')) {
            const style = document.createElement('style');
            style.id = 'takeover-style';
            style.textContent = `
                @keyframes toScramblePulse {
                    0%,100% { opacity:0.75; }
                    50%      { opacity:1;    }
                }
                @keyframes toDecodeFlash {
                    0%   { text-shadow:0 0 30px #ff3a3a, 0 0 60px #ff3a3a; letter-spacing:10px; }
                    100% { text-shadow:0 0 12px #ff3a3a; letter-spacing:2px; }
                }
                @keyframes toFadeOut {
                    to { opacity:0; transform:translateY(-24px); }
                }
                .to-phrase {
                    position:absolute;
                    font-family:"Courier New",monospace;
                    font-weight:bold;
                    text-align:left;
                    padding:10px 24px;
                    background:rgba(0,0,0,0.55);
                    border:1px solid #2a1020;
                    letter-spacing:2px;
                    pointer-events:auto;
                    user-select:none;
                    white-space:nowrap;
                    z-index:15;
                    transition:border-color .12s, box-shadow .12s;
                    font-size: var(--to-font-size, 14px);
                }
                @media (max-width: 768px) {
                    .to-phrase {
                        font-size: calc(var(--to-font-size, 14px) * 0.75) !important;
                        padding: 4px 8px;
                    }
                }
                .to-phrase.scrambled {
                    color:#444;
                    cursor:pointer;
                    animation:toScramblePulse .55s ease-in-out infinite;
                }
                .to-phrase.scrambled:hover {
                    color:#ff8800;
                    border-color:#ff8800;
                    box-shadow:0 0 18px rgba(255,136,0,.45);
                }
                .to-phrase.decoded {
                    color:#ff3a3a;
                    border-color:#ff3a3a;
                    cursor:default;
                    pointer-events:none;
                    animation:toDecodeFlash .35s ease-out forwards;
                }
                .to-phrase.expired {
                    pointer-events:none;
                    animation:toFadeOut .4s ease-out forwards;
                }
                .to-hint {
                    font-size:10px;
                    color:#333;
                    letter-spacing:3px;
                    margin-top:5px;
                    text-align:center;
                }
                @keyframes toMonitorFlicker {
                    0%, 100% { opacity: 0.99; }
                    50% { opacity: 0.96; }
                }
                .to-monitor {
                    position: absolute;
                    top: 12%;
                    left: 5%;
                    width: 90%;
                    height: 72%;
                    background: radial-gradient(circle, rgba(16, 2, 28, 0.88) 0%, rgba(5, 0, 10, 0.96) 100%);
                    border: 2px solid #5a1060;
                    border-radius: 8px;
                    box-shadow: 
                        0 0 25px rgba(90, 16, 96, 0.55),
                        inset 0 0 40px rgba(90, 16, 96, 0.45);
                    z-index: 5;
                    pointer-events: none;
                    overflow: hidden;
                    animation: toMonitorFlicker 0.15s infinite;
                }
                .to-monitor-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    background: rgba(90, 16, 96, 0.15);
                    border-bottom: 1px solid rgba(90, 16, 96, 0.3);
                    font-family: "Courier New", monospace;
                    font-size: 11px;
                    color: #b549c0;
                    letter-spacing: 1px;
                }
                .to-monitor-dot {
                    display: inline-block;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                }
                .to-monitor-dot.red { background: #ff5f56; }
                .to-monitor-dot.yellow { background: #ffbd2e; }
                .to-monitor-dot.green { background: #27c93f; }
                .to-monitor-title {
                    margin-left: 10px;
                    font-weight: bold;
                }
                .to-monitor-scanlines {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(
                        rgba(18, 10, 36, 0) 50%, 
                        rgba(0, 0, 0, 0.25) 50%
                    );
                    background-size: 100% 4px;
                    z-index: 2;
                    pointer-events: none;
                }
                .to-monitor-grid {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-image: 
                        linear-gradient(rgba(90, 16, 96, 0.05) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(90, 16, 96, 0.05) 1px, transparent 1px);
                    background-size: 40px 40px;
                    background-position: center;
                    z-index: 1;
                    pointer-events: none;
                }
                .to-monitor-footer {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 16px;
                    background: rgba(90, 16, 96, 0.08);
                    border-top: 1px solid rgba(90, 16, 96, 0.2);
                    font-family: "Courier New", monospace;
                    font-size: 10px;
                    color: rgba(181, 73, 192, 0.7);
                    letter-spacing: 1px;
                    z-index: 3;
                }
                .to-monitor-status {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .to-monitor-status::before {
                    content: "";
                    display: inline-block;
                    width: 6px;
                    height: 6px;
                    background: #27c93f;
                    border-radius: 50%;
                    box-shadow: 0 0 8px #27c93f;
                }
                @media (max-width: 768px) {
                    .to-monitor-header {
                        padding: 6px 12px;
                        font-size: 9px;
                    }
                    .to-monitor-footer {
                        padding: 6px 12px;
                        font-size: 8px;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // Create Monitor Background Element
        this.monitorEl = document.createElement('div');
        this.monitorEl.className = 'to-monitor';
        this.monitorEl.innerHTML = `
            <div class="to-monitor-header">
                <span class="to-monitor-dot red"></span>
                <span class="to-monitor-dot yellow"></span>
                <span class="to-monitor-dot green"></span>
                <span class="to-monitor-title">DECRYPTION_TERMINAL://SECURE_SESSION</span>
            </div>
            <div class="to-monitor-grid"></div>
            <div class="to-monitor-scanlines"></div>
            <div class="to-monitor-footer">
                <span>PORT: 5174 | AES-256-GCM</span>
                <span class="to-monitor-status">CONNECTION: SECURE</span>
            </div>
        `;
        this.songWrapper.appendChild(this.monitorEl);

        this.scoreEl = document.createElement('div');
        Object.assign(this.scoreEl.style, {
            position:'absolute', top:'14px', left:'50%',
            transform:'translateX(-50%)',
            fontFamily:'"Courier New",monospace',
            fontSize:'15px', fontWeight:'bold',
            letterSpacing:'4px', color:'#cc2244',
            textShadow:'0 0 12px #ff3a3a, 0 0 24px #ff3a3a88',
            pointerEvents:'none', zIndex:'20'
        });
        this.songWrapper.appendChild(this.scoreEl);
        this.updateScore();
    }

    updateScore() {
        if (!this.scoreEl) return;
        this.scoreEl.textContent = `TAKEOVER: ${this.takenCount} / ${this.totalCount}`;
        const ratio = this.totalCount > 0 ? this.takenCount / this.totalCount : 0;
        const r = Math.min(255, 50 + Math.round(ratio * 205));
        this.scoreEl.style.color = `rgb(${r},18,28)`;
        this.scoreEl.style.textShadow = `0 0 ${5 + ratio*18}px #ff3a3a`;
    }

    // ── Crypto helpers (AES-256-GCM via Web Crypto API) ─────────────────

    async _initCrypto() {
        this._cryptoKey = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,            // non-extractable: key never leaves the engine
            ['encrypt', 'decrypt']
        );
        this._cryptoReady = true;
    }

    async _encrypt(plaintext) {
        const iv   = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit random IV
        const data = new TextEncoder().encode(plaintext);
        const buf  = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this._cryptoKey,
            data
        );
        return { iv, ciphertext: new Uint8Array(buf) };
    }

    async _decrypt(iv, ciphertext) {
        const buf = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            this._cryptoKey,
            ciphertext
        );
        return new TextDecoder().decode(buf);
    }

    // Convert ciphertext bytes to a Base64 string for display.
    // Returns a string long enough to slide a window through.
    _ciphertextToBase64(ciphertext) {
        let binary = '';
        for (let i = 0; i < ciphertext.length; i++) {
            binary += String.fromCharCode(ciphertext[i]);
        }
        return btoa(binary);
    }

    // ── Spawn / decode targets ────────────────────────────────────────────

    async spawnGroupTarget(group) {
        if (!this._cryptoReady) return; // key not ready yet (extremely unlikely)

        // Encrypt before touching any state — if this throws or the scene is
        // already destroyed by the time it resolves, nothing gets miscounted.
        let iv, ciphertext;
        try {
            ({ iv, ciphertext } = await this._encrypt(group.text));
        } catch {
            return;
        }
        if (!this.isActive) return; // scene destroyed while awaiting

        this.totalCount++;
        this.updateScore();

        const b64 = this._ciphertextToBase64(ciphertext); // authentic encrypted bytes

        const baseFontSize = this.isClimax ? 20 : 14;
        const winLen = Math.min(Math.max(b64.length, 12), 18);
        const hasHint = this.totalCount <= 3;

        // Estimate size for collision checking
        const isMobile = window.innerWidth <= 768;
        const fontSizeVal = isMobile ? baseFontSize * 0.75 : baseFontSize;
        const scrambledWidth = winLen * (fontSizeVal * 0.65 + (isMobile ? 2.5 : 3.5));
        const plainWidth = group.text.length * (fontSizeVal * (isMobile ? 0.9 : 1.1));
        const widthPx = Math.max(scrambledWidth, plainWidth) + (isMobile ? 16 : 48);
        let heightPx = fontSizeVal * 1.2 + (isMobile ? 8 : 20);
        if (hasHint) {
            heightPx += isMobile ? 18 : 25;
        }

        const W = Math.max(1, window.innerWidth);
        const H = Math.max(1, window.innerHeight);
        const widthPct = (widthPx / W) * 100;
        const heightPct = (heightPx / H) * 100;

        // Dynamic grid layout based on screen orientation
        const isLandscape = W > H;
        const rows = isLandscape ? 4 : 5;
        const cols = isLandscape ? 5 : 3;
        const totalCells = rows * cols;

        const cellW = 84 / cols;
        const cellH = 58 / rows;

        // Find occupied cells
        const occupiedCells = this.phraseTargets
            .filter(t => t.state !== 'expired' && typeof t.cellIndex === 'number')
            .map(t => t.cellIndex);

        // Find available cells
        const availableCells = [];
        for (let i = 0; i < totalCells; i++) {
            if (!occupiedCells.includes(i)) {
                availableCells.push(i);
            }
        }

        let cellIndex;
        if (availableCells.length > 0) {
            cellIndex = availableCells[Math.floor(Math.random() * availableCells.length)];
        } else {
            // Prefer overwriting decoded targets over scrambled ones
            const scrambledOccupied = this.phraseTargets
                .filter(t => t.state === 'scrambled' && typeof t.cellIndex === 'number')
                .map(t => t.cellIndex);
            const nonScrambledCells = [];
            for (let i = 0; i < totalCells; i++) {
                if (!scrambledOccupied.includes(i)) {
                    nonScrambledCells.push(i);
                }
            }
            if (nonScrambledCells.length > 0) {
                cellIndex = nonScrambledCells[Math.floor(Math.random() * nonScrambledCells.length)];
            } else {
                cellIndex = Math.floor(Math.random() * totalCells);
            }
        }

        const r = Math.floor(cellIndex / cols);
        const c = cellIndex % cols;

        const cellLeft = 8 + c * cellW;
        const cellTop = 17 + r * cellH;

        // Position with jitter inside the cell
        const maxJitterX = Math.max(0, cellW - widthPct);
        const maxJitterY = Math.max(0, cellH - heightPct);

        let leftPct = cellLeft + (Math.random() * maxJitterX);
        let topPct = cellTop + (Math.random() * maxJitterY);

        // Clamp to monitor boundaries to prevent overflow
        const minL = 6;
        const maxR = Math.max(minL, 94 - widthPct);
        leftPct = Math.max(minL, Math.min(leftPct, maxR));

        const minT = 16;
        const maxB = Math.max(minT, 81 - heightPct);
        topPct = Math.max(minT, Math.min(topPct, maxB));

        const el = document.createElement('div');
        el.className = 'to-phrase scrambled';
        el.style.top      = `${topPct}%`;
        el.style.left     = `${leftPct}%`;
        el.style.setProperty('--to-font-size', `${baseFontSize}px`);

        // Show a sliding window of the real Base64 ciphertext
        const textNode = document.createTextNode(b64.slice(0, winLen));
        el.appendChild(textNode);

        if (hasHint) {
            const hint = document.createElement('div');
            hint.className = 'to-hint';
            hint.textContent = '[ CLICK TO DECRYPT ]';
            el.appendChild(hint);
        }

        const target = {
            el, textNode,
            iv, ciphertext,        // kept for decryption
            b64,                   // kept for display animation
            state: 'scrambled',
            scrambleTimer: null,
            leftPct,
            topPct,
            widthPct,
            heightPct,
            cellIndex
        };

        // Slide a window through the Base64 string to animate the ciphertext
        let offset = 0;
        const doubled = b64 + b64; // wrap-around source
        target.scrambleTimer = setInterval(() => {
            if (target.state !== 'scrambled') return;
            offset = (offset + 1) % b64.length;
            textNode.nodeValue = doubled.slice(offset, offset + winLen);
        }, 80);

        el.addEventListener('click', async () => {
            if (target.state !== 'scrambled') return;
            target.state = 'decrypting'; // guard against double-click
            clearInterval(target.scrambleTimer);

            // Decrypt with AES-256-GCM using the stored IV + ciphertext
            const plaintext = await this._decrypt(target.iv, target.ciphertext);
            this._revealTarget(target, plaintext);
        });

        this.songWrapper.appendChild(el);
        this.phraseTargets.push(target);
        return target;
    }

    _revealTarget(target, plaintext) {
        if (target.state !== 'decrypting') return; // expired between click and decrypt resolve
        target.state = 'decoded';
        target.textNode.nodeValue = plaintext;
        target.el.className = 'to-phrase decoded';

        this.takenCount++;
        this.updateScore();

        setTimeout(() => {
            if (target.el.parentNode) {
                target.el.className = 'to-phrase expired';
                setTimeout(() => {
                    if (target.el.parentNode) target.el.parentNode.removeChild(target.el);
                }, 400);
            }
        }, 6400);
    }

    // Called externally (phrase boundary expire)
    decodeTarget(target) {
        if (target.state !== 'scrambled') return;
        clearInterval(target.scrambleTimer);
        target.state = 'expired';
        target.el.className = 'to-phrase expired';
        setTimeout(() => {
            if (target.el.parentNode) target.el.parentNode.removeChild(target.el);
        }, 400);
    }

    expireTarget(target) {
        if (target.state === 'expired' || target.state === 'decrypting') return;
        target.state = 'expired';
        clearInterval(target.scrambleTimer);
        target.el.className = 'to-phrase expired';
        setTimeout(() => { if (target.el.parentNode) target.el.parentNode.removeChild(target.el); }, 400);
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    update() {
        if (!playerManager.player || !playerManager.player.video) return;

        // TextAlive公式タイマー(player.timer.position)に完全同期（先行調整を排除）
        const position = (playerManager.player && playerManager.player.timer)
                         ? playerManager.player.timer.position
                         : this.getSmoothedTime();
        const chorus = typeof playerManager.player.findChorus === 'function'
            ? playerManager.player.findChorus(position) : null;
        this.isClimax = !!chorus;

        // Chorus: tighten contrast to signal intensity shift
        if (this.isClimax !== this.prevIsClimax) {
            this.songWrapper.style.filter = this.isClimax ? 'contrast(1.25) saturate(1.6)' : '';
            this.prevIsClimax = this.isClimax;
        }

        // Background debris rotation
        this.debris.forEach(m => {
            m.rotation.x += m.userData.rot.x;
            m.rotation.y += m.userData.rot.y;
            m.rotation.z += m.userData.rot.z;
        });

        // At phrase boundary: expire remaining scrambled targets after a 2-second delay
        // to give the user more time to decrypt them.
        const phrase = playerManager.player.video.findPhrase(position);
        if (phrase && phrase.startTime !== this.lastPhraseStart) {
            this.phraseTargets.forEach(t => {
                if (t.state === 'scrambled') {
                    setTimeout(() => {
                        if (this.isActive && t.state === 'scrambled') {
                            this.expireTarget(t);
                        }
                    }, 2000);
                }
            });
            this.lastPhraseStart = phrase.startTime;
        }

        // Spawn one scrambled target per word-group
        const word = playerManager.player.video.findWord(position)
                  || playerManager.player.video.findChar(position);
        if (word && word.parent) {
            const groups = groupPhraseWordsByMinLength(word.parent, 4);
            const group = findGroupForWord(groups, word);
            if (group && group.startTime !== this.lastGroupStartTime) {
                this.lastGroupStartTime = group.startTime;
                this.spawnGroupTarget(group);
            }
        }
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);

        this.phraseTargets.forEach(t => {
            clearInterval(t.scrambleTimer);
            if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
        });
        this.phraseTargets = [];

        if (this._debrisEdgesGeo) { this._debrisEdgesGeo.dispose(); this._debrisEdgesGeo = null; }
        if (this._debrisMat)      { this._debrisMat.dispose();      this._debrisMat = null; }

        const styleEl = document.getElementById('takeover-style');
        if (styleEl) styleEl.parentNode.removeChild(styleEl);

        if (this.monitorEl && this.monitorEl.parentNode) {
            this.monitorEl.parentNode.removeChild(this.monitorEl);
            this.monitorEl = null;
        }

        this.songWrapper.style.filter = '';

        if (this.renderer) { this.renderer.dispose(); this.renderer = null; }

        super.destroy();
    }
}
