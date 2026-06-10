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
        this.cardMargin = 0; // no extra margin for decoded tiles
        this.allGroups = [];
        this.bgTiles = {};

        this.boundOnResize = this.onResize.bind(this);
    }

    init() {
        this.initThree();
        this.initDebris();
        this.initUI();
        this._initCrypto(); // async, completes well before first phrase
        window.addEventListener('resize', this.boundOnResize);
        this.isActive = true;

        if (playerManager.player && playerManager.player.video) {
            this.buildLyricCard();
        } else {
            this.boundBuildLyricCard = () => {
                this.buildLyricCard();
                eventBus.off('videoReady', this.boundBuildLyricCard);
                eventBus.off('timerReady', this.boundBuildLyricCard);
            };
            eventBus.on('videoReady', this.boundBuildLyricCard);
            eventBus.on('timerReady', this.boundBuildLyricCard);
        }

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
                    0%,100% { opacity:0.45; }
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
                    padding:12px 28px;
                    background:#05000a; /* Solid black/purple background, no transparency */
                    border:1px solid rgba(0, 255, 170, 0.3);
                    letter-spacing:2px;
                    pointer-events:auto;
                    user-select:none;
                    white-space:nowrap;
                    z-index:15;
                    transition:all 0.15s cubic-bezier(0.25, 0.8, 0.25, 1);
                    font-size: var(--to-font-size, 14px);
                    border-radius: 6px;
                }
                @media (max-width: 768px) {
                    .to-phrase {
                        font-size: calc(var(--to-font-size, 14px) * 0.9) !important;
                        padding: 10px 20px; /* Easy-to-tap large padding on mobile */
                    }
                }
                .to-phrase.scrambled {
                    color:#00ffaa;
                    cursor:pointer;
                    border-color: rgba(0, 255, 170, 0.6);
                    text-shadow: 0 0 8px rgba(0, 255, 170, 0.6);
                    box-shadow: 0 0 12px rgba(0, 255, 170, 0.2), inset 0 0 8px rgba(0, 255, 170, 0.1);
                    animation:toScramblePulse .75s ease-in-out infinite;
                }
                .to-phrase.scrambled:hover {
                    color:#ffffff;
                    border-color:#00ffaa;
                    box-shadow: 0 0 25px rgba(0, 255, 170, 0.8), inset 0 0 12px rgba(0, 255, 170, 0.3);
                    text-shadow: 0 0 12px #00ffaa;
                    transform: scale(1.06);
                }
                .to-phrase.scrambled:active {
                    transform: scale(0.95);
                    box-shadow: 0 0 10px rgba(0, 255, 170, 0.5);
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

        this.bgContainer = document.createElement('div');
        this.bgContainer.className = 'to-bg-container';
        this.songWrapper.appendChild(this.bgContainer);

        // Reset card grid layout variables for fresh start
        this.allGroups = [];
        this.bgTiles = {};
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

        this.updateScore();

        const b64 = this._ciphertextToBase64(ciphertext); // authentic encrypted bytes

        const baseFontSize = this.isClimax ? 20 : 14;
        const winLen = Math.min(Math.max(b64.length, 12), 18);
        const hasHint = this.takenCount <= 3; // Show click hint only for the first 3 decryptions

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

        // Shuffled grid placement with jitter for random distribution
        const cellIndices = Array.from({ length: totalCells }, (_, i) => i);
        for (let i = cellIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cellIndices[i], cellIndices[j]] = [cellIndices[j], cellIndices[i]];
        }

        let leftPct, topPct, cellIndex;
        let attempts = 0;
        let placed = false;
        while (!placed && attempts < totalCells) {
            cellIndex = cellIndices[attempts];
            const row = Math.floor(cellIndex / cols);
            const col = (cols - 1) - (cellIndex % cols); // Reversed column order
            
            // Random offset jitter within 55% of cell dimensions to break horizontal alignment
            const jitterX = (Math.random() - 0.5) * cellW * 0.55;
            const jitterY = (Math.random() - 0.5) * cellH * 0.55;

            const cellLeft = 8 + col * cellW + jitterX;
            const cellTop = 17 + row * cellH + jitterY;
            leftPct = Math.max(6, Math.min(cellLeft, Math.max(6, 94 - widthPct)));
            topPct = Math.max(16, Math.min(cellTop, Math.max(16, 81 - heightPct)));

            placed = !this.phraseTargets.some(t => {
                return Math.abs(t.leftPct - leftPct) < widthPct && 
                       Math.abs(t.topPct - topPct) < heightPct;
            });
            attempts++;
        }

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
            cellIndex,
            baseFontSize,
            groupIndex: group.index // Store its unique index
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
            try {
                // Decrypt with AES-256-GCM using the stored IV + ciphertext
                const plaintext = await this._decrypt(target.iv, target.ciphertext);
                this._revealTarget(target, plaintext);
            } catch (e) {
                // Decryption failed – we do not update background tile, it remains empty
                if (target.el && target.el.parentNode) {
                    target.el.parentNode.removeChild(target.el);
                }
            }
        });

        this.songWrapper.appendChild(el);
        this.phraseTargets.push(target);
        return target;
    }

    _revealTarget(target, plaintext) {
        if (target.state !== 'decrypting') return; // expired between click and decrypt resolve
        target.state = 'decoded';

        // Remove decryption hint from target element if it exists
        const hint = target.el.querySelector('.to-hint');
        if (hint && hint.parentNode) {
            hint.parentNode.removeChild(hint);
        }

        target.textNode.nodeValue = plaintext;
        target.el.className = 'to-phrase decoded';

        const tile = this.bgTiles[target.groupIndex];
        if (!tile) {
            // Fallback if background tile wasn't pre-built
            if (target.el && target.el.parentNode) {
                target.el.parentNode.removeChild(target.el);
            }
            this.takenCount++;
            this.updateScore();
            return;
        }

        // Animate fly to the background tile
        const wrapperRect = this.songWrapper.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const elRect = target.el.getBoundingClientRect();

        // Lock to pixel absolute positioning for seamless transition
        target.el.style.left = `${elRect.left - wrapperRect.left}px`;
        target.el.style.top = `${elRect.top - wrapperRect.top}px`;
        target.el.style.width = `${elRect.width}px`;
        target.el.style.height = `${elRect.height}px`;
        target.el.style.margin = '0';
        target.el.style.transform = 'none';

        // Force a layout reflow
        target.el.offsetHeight;

        // Apply transition and fly to final background tile dimensions
        target.el.style.transition = 'all 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
        target.el.style.left = `${tileRect.left - wrapperRect.left}px`;
        target.el.style.top = `${tileRect.top - wrapperRect.top}px`;
        target.el.style.width = `${tileRect.width}px`;
        target.el.style.height = `${tileRect.height}px`;
        target.el.style.fontSize = window.innerWidth <= 768 ? '10px' : '14px';
        target.el.style.padding = window.innerWidth <= 768 ? '2px 4px' : '4px 8px';
        target.el.style.borderColor = '#ff3a3a';
        target.el.style.boxShadow = '0 0 10px rgba(255, 58, 58, 0.5)';

        // Once the transition finishes, remove target element and light up the background tile
        setTimeout(() => {
            if (target.el && target.el.parentNode) {
                target.el.parentNode.removeChild(target.el);
            }
            tile.textContent = plaintext;
            tile.classList.add('decoded');
        }, 500);

        this.takenCount++;
        this.updateScore();
    }

    buildLyricCard() {
        if (!this.isActive || !playerManager.player || !playerManager.player.video) return;

        const video = playerManager.player.video;
        this.allGroups = [];
        this.bgTiles = {};

        if (this.bgContainer) {
            this.bgContainer.innerHTML = '';
        }

        let phrase = video.firstPhrase;
        let index = 0;

        while (phrase) {
            const groups = groupPhraseWordsByMinLength(phrase, 4);
            for (const g of groups) {
                const groupObj = {
                    index: index,
                    text: g.text,
                    startTime: g.startTime,
                    endTime: g.endTime
                };
                this.allGroups.push(groupObj);

                // Create static background tile
                const tile = document.createElement('div');
                tile.className = 'to-tile';
                tile.textContent = g.text;
                tile.setAttribute('data-index', index);

                this.bgContainer.appendChild(tile);
                this.bgTiles[index] = tile;

                index++;
            }
            phrase = phrase.next;
        }

        this.totalCount = index;
        this.updateScore();
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
                
                // Match with pre-built allGroups to get the indexed group
                const matchGroup = this.allGroups.find(g => g.startTime === group.startTime && g.text === group.text);
                if (matchGroup) {
                    const tile = this.bgTiles[matchGroup.index];
                    // Only spawn if the background tile is not already decoded
                    if (tile && !tile.classList.contains('decoded')) {
                        this.spawnGroupTarget(matchGroup);
                    }
                }
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

        if (this.boundBuildLyricCard) {
            eventBus.off('videoReady', this.boundBuildLyricCard);
            eventBus.off('timerReady', this.boundBuildLyricCard);
        }

        if (this.monitorEl && this.monitorEl.parentNode) {
            this.monitorEl.parentNode.removeChild(this.monitorEl);
            this.monitorEl = null;
        }

        this.allGroups = [];
        this.bgTiles = {};

        if (this.bgContainer && this.bgContainer.parentNode) {
            this.bgContainer.parentNode.removeChild(this.bgContainer);
            this.bgContainer = null;
        }

        this.songWrapper.style.filter = '';

        if (this.renderer) { this.renderer.dispose(); this.renderer = null; }

        super.destroy();
    }
}
