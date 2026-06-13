import * as THREE from 'three';
import { eventBus } from '../core/eventBus.js';
import { SONGS } from '../config/songs.js';
import { PHASES } from '../config/constants.js';
import { appState } from '../core/appState.js';
import { PHASE_CLASSES } from './phases/index.js';

export class WorldUI {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.selectedIndex = 0;
        this.currentPhase = null;
        this.currentPhaseIndex = appState.getPhase();
        this.isTransitioning = false;
        this.hoveredIndex = -1;

        // DOM labels
        this.labelsContainer = document.createElement('div');
        this.labelsContainer.className = 'lake-labels-container';
        this.container.appendChild(this.labelsContainer);
        this.labels = [];

        // Progress counter with phase name
        this.progressCounter = document.createElement('div');
        this.progressCounter.className = 'lake-progress-counter';
        this.labelsContainer.appendChild(this.progressCounter);

        // Phase name indicator
        this.phaseIndicator = document.createElement('div');
        this.phaseIndicator.className = 'world-phase-indicator';
        this.labelsContainer.appendChild(this.phaseIndicator);

        this._initPhase(this.currentPhaseIndex);
        this._createLabels();
        this._createSelectionPanel();
        this._updateProgressCounter();
        this._setSelected(0);
        this._maybeShowOnboarding();

        this.bindEvents();
        // Relative clock: Date.now()*0.001 (~1.8e9) exceeds float32
        // precision in shader uniforms and freezes all GPU animation
        this._clockStart = Date.now();
        this.animate = this.animate.bind(this);
        this.animationId = requestAnimationFrame(this.animate);
    }

    _initPhase(phaseIndex) {
        if (this.currentPhase) {
            this.currentPhase.dispose();
        }

        const PhaseClass = PHASE_CLASSES[phaseIndex] || PHASE_CLASSES[0];
        this.currentPhase = new PhaseClass(this.scene, this.camera, this.renderer);
        this.currentPhase.enter(null);
        // Base position for the gentle idle camera drift in animate()
        this.cameraBasePos = this.camera.position.clone();
        this.currentPhase.createSongMarkers(SONGS);
        this.currentPhaseIndex = phaseIndex;
        // Markers are freshly created — re-apply the selection highlight
        this.currentPhase.onHover(this.selectedIndex);
    }

    _createLabels() {
        this.labels.forEach(l => {
            if (l.element.parentNode) l.element.parentNode.removeChild(l.element);
        });
        this.labels = [];

        SONGS.forEach((song, i) => {
            const isCompleted = appState.isSongComplete(song.id);
            const completeMark = isCompleted
                ? `<span class="complete-mark" style="color:#D4AF37;margin-left:5px;filter:drop-shadow(0 0 4px #D4AF37)">✓</span>`
                : '';

            const label = document.createElement('div');
            label.className = 'song-label';
            label.innerHTML = `
                <div class="song-title" style="text-shadow: 0 0 15px ${song.color}, 0 1px 2px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.7);">
                    ${song.title}${completeMark}
                </div>
                <div class="song-artist">${song.artist}</div>
            `;
            this.labelsContainer.appendChild(label);

            const labelData = {
                element: label,
                _hovered: false,
            };
            this.labels.push(labelData);

            label.style.pointerEvents = 'auto';
            label.style.cursor = 'pointer';

            label.addEventListener('mouseenter', () => {
                label.classList.add('song-label--hovered');
                labelData._hovered = true;
                if (this.currentPhase && i !== this.selectedIndex) this.currentPhase.onHover(i);
                this.hoveredIndex = i;
            });

            label.addEventListener('mouseleave', () => {
                label.classList.remove('song-label--hovered');
                labelData._hovered = false;
                if (this.currentPhase && i !== this.selectedIndex) this.currentPhase.onUnhover(i);
                this.hoveredIndex = -1;
            });

            label.addEventListener('click', (e) => {
                e.stopPropagation();
                if (i === this.selectedIndex) {
                    this.selectSong(song, i);
                } else {
                    this._setSelected(i);
                }
            });
        });
    }

    // Central selection state: highlights the marker, focuses the label,
    // and updates the confirmation panel. Starting a song always goes
    // through an explicit second action (panel button / repeat tap / Enter).
    _setSelected(index) {
        const prev = this.selectedIndex;
        if (this.currentPhase) {
            if (prev !== index) this.currentPhase.onUnhover(prev);
            this.currentPhase.onHover(index);
        }
        this.selectedIndex = index;
        this._updateSelectionPanel();
    }

    _createSelectionPanel() {
        // 選択中の曲のサムネイル(課題曲の公式MVサムネイル)を大きく表示
        this.thumbCard = document.createElement('div');
        this.thumbCard.className = 'world-thumb-card';
        this.thumbCard.innerHTML = `<img class="world-thumb-img" alt="" />`;
        this.container.appendChild(this.thumbCard);
        this.thumbImg = this.thumbCard.querySelector('.world-thumb-img');

        this.selectionPanel = document.createElement('div');
        this.selectionPanel.className = 'world-selection-panel';
        this.selectionPanel.innerHTML = `
            <div class="world-selection-nav">
                <button class="world-nav-btn world-nav-prev" aria-label="前の曲">&#9664;</button>
                <div class="world-selection-info">
                    <div class="world-selection-title"></div>
                    <div class="world-selection-artist"></div>
                </div>
                <button class="world-nav-btn world-nav-next" aria-label="次の曲">&#9654;</button>
            </div>
            <button class="world-selection-start">この曲をはじめる&nbsp;▶</button>
        `;
        this.container.appendChild(this.selectionPanel);

        const N = SONGS.length;
        this.selectionPanel.querySelector('.world-nav-prev').addEventListener('click', (e) => {
            e.stopPropagation();
            this._setSelected((this.selectedIndex - 1 + N) % N);
        });
        this.selectionPanel.querySelector('.world-nav-next').addEventListener('click', (e) => {
            e.stopPropagation();
            this._setSelected((this.selectedIndex + 1) % N);
        });
        this.selectionPanel.querySelector('.world-selection-start').addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectSong(SONGS[this.selectedIndex], this.selectedIndex);
        });

        // Lock the panel width to the longest title (incl. the ✓ mark)
        // so it doesn't resize every time the selection changes
        const titleEl = this.selectionPanel.querySelector('.world-selection-title');
        const artistEl = this.selectionPanel.querySelector('.world-selection-artist');
        let maxWidth = 0;
        SONGS.forEach((song) => {
            titleEl.innerHTML = `${song.title} <span>✓</span>`;
            artistEl.textContent = song.artist;
            maxWidth = Math.max(maxWidth, this.selectionPanel.offsetWidth);
        });
        if (maxWidth > 0) this.selectionPanel.style.width = `${Math.ceil(maxWidth)}px`;
    }

    _updateSelectionPanel() {
        if (!this.selectionPanel) return;
        const song = SONGS[this.selectedIndex];
        if (!song) return;
        const titleEl = this.selectionPanel.querySelector('.world-selection-title');
        const artistEl = this.selectionPanel.querySelector('.world-selection-artist');
        const isCompleted = appState.isSongComplete(song.id);
        titleEl.innerHTML = `${song.title}${isCompleted ? ' <span style="color:#D4AF37">✓</span>' : ''}`;
        artistEl.textContent = song.artist;
        this.selectionPanel.style.setProperty('--selection-color', song.color);

        // 選択中の曲のサムネイルを更新(曲のテーマ色の縁取り付き)
        if (this.thumbCard && this.thumbImg && song.thumbnail) {
            const src = import.meta.env.BASE_URL + song.thumbnail;
            if (this.thumbImg.getAttribute('src') !== src) {
                this.thumbImg.src = src;
                this.thumbImg.alt = `${song.title} ジャケット`;
                // 切り替え時にふわっと差し替え
                this.thumbCard.classList.remove('swap');
                void this.thumbCard.offsetWidth;
                this.thumbCard.classList.add('swap');
            }
            this.thumbCard.style.setProperty('--selection-color', song.color);
        }

        // Draw the eye to the start button right after a new song is focused
        const startBtn = this.selectionPanel.querySelector('.world-selection-start');
        startBtn.classList.remove('world-selection-start--attention');
        // Force reflow so the animation can restart
        void startBtn.offsetWidth;
        startBtn.classList.add('world-selection-start--attention');
    }

    // One-time guide for first-time visitors: explains that the lights are
    // songs and how selection works. Dismissed by any tap or after 9s.
    _maybeShowOnboarding() {
        if (localStorage.getItem('worldOnboardingShown')) return;

        const overlay = document.createElement('div');
        overlay.className = 'world-onboarding';
        overlay.innerHTML = `
            <div class="world-onboarding-card">
                <div class="world-onboarding-icon">✦</div>
                <p class="world-onboarding-main">浮かんでいる光は、6つの楽曲です</p>
                <p class="world-onboarding-sub">光にふれて選び、「この曲をはじめる ▶」で旅がはじまります</p>
                <p class="world-onboarding-cycle">曲をクリアするたび、晴れた空に雲が集まり、雨が降り──やがて湖がうまれます</p>
                <p class="world-onboarding-dismiss">タップして閉じる</p>
            </div>
        `;
        this.container.appendChild(overlay);

        const dismiss = () => {
            if (!overlay.parentNode) return;
            localStorage.setItem('worldOnboardingShown', '1');
            overlay.classList.add('world-onboarding--hide');
            setTimeout(() => overlay.parentNode?.removeChild(overlay), 600);
        };
        overlay.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
        setTimeout(dismiss, 9000);
    }

    _updateProgressCounter() {
        if (!this.progressCounter) return;
        const completed = SONGS.filter(s => appState.isSongComplete(s.id)).length;
        const total = SONGS.length;
        this.progressCounter.textContent = `クリア ${completed} / ${total}`;

        if (this.phaseIndicator) {
            const phase = PHASES[this.currentPhaseIndex];
            const hint = completed < total
                ? '<span class="world-phase-hint">曲をクリアすると、水は次の姿へ</span>'
                : '';
            this.phaseIndicator.innerHTML = phase
                ? `<span class="world-phase-name">${phase.name}</span>${hint}`
                : '';
        }
    }

    selectSong(song, index) {
        if (this.isTransitioning) return;

        if (this.currentPhase) {
            this.currentPhase.onSelect(index);
        }

        appState.setCurrentSong(song.id);
        this.renderer.domElement.style.display = 'none';
        this.labelsContainer.style.display = 'none';
        if (this.selectionPanel) this.selectionPanel.style.display = 'none';
        if (this.thumbCard) this.thumbCard.style.display = 'none';
        eventBus.emit('loadSong', song);
    }

    show() {
        this.renderer.domElement.style.display = 'block';
        this.labelsContainer.style.display = 'block';
        if (this.selectionPanel) this.selectionPanel.style.display = 'flex';
        if (this.thumbCard) this.thumbCard.style.display = 'block';

        const playerControls = document.getElementById('player-controls');
        const backBtn = document.getElementById('back-to-lake');
        if (playerControls) playerControls.style.display = 'none';
        if (backBtn) backBtn.style.display = 'none';

        const newPhase = appState.getPhase();
        if (newPhase !== this.currentPhaseIndex) {
            this._transitionToPhase(newPhase);
        }

        this._refreshLabels();
        this._updateProgressCounter();
        this._updateSelectionPanel();
    }

    _refreshLabels() {
        SONGS.forEach((song, i) => {
            const isCompleted = appState.isSongComplete(song.id);
            const titleEl = this.labels[i].element.querySelector('.song-title');
            if (isCompleted && titleEl && !titleEl.querySelector('.complete-mark')) {
                const mark = document.createElement('span');
                mark.className = 'complete-mark';
                mark.textContent = '✓';
                mark.style.cssText = 'color:#D4AF37; margin-left:5px; filter:drop-shadow(0 0 4px #D4AF37);';
                titleEl.appendChild(mark);
            }
        });
    }

    async _transitionToPhase(newPhaseIndex) {
        if (this.isTransitioning) return;
        this.isTransitioning = true;

        // Create transition overlay
        const overlay = document.createElement('div');
        overlay.className = 'world-phase-transition';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0); z-index: 500;
            transition: background 1.2s ease;
            display: flex; align-items: center; justify-content: center;
            pointer-events: none;
        `;
        const phaseText = document.createElement('div');
        phaseText.style.cssText = `
            color: rgba(255,255,255,0); font-size: clamp(16px, 4vw, 28px);
            letter-spacing: 0.5em; font-weight: 300;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            transition: color 1s ease 0.5s;
        `;
        const phaseName = PHASES[newPhaseIndex]?.name || '';
        phaseText.textContent = `水は ${phaseName} になった`;
        overlay.appendChild(phaseText);
        document.body.appendChild(overlay);

        // Fade in
        requestAnimationFrame(() => {
            overlay.style.background = 'rgba(0,0,0,0.85)';
            phaseText.style.color = 'rgba(255,255,255,0.9)';
        });

        await new Promise(r => setTimeout(r, 2000));

        // Switch phase
        this._initPhase(newPhaseIndex);

        // Fade out
        overlay.style.transition = 'background 1s ease, opacity 1s ease';
        phaseText.style.transition = 'color 0.5s ease';
        phaseText.style.color = 'rgba(255,255,255,0)';
        overlay.style.background = 'rgba(0,0,0,0)';

        await new Promise(r => setTimeout(r, 1200));

        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        this.isTransitioning = false;
        this._updateProgressCounter();
    }

    bindEvents() {
        this.boundOnWindowResize = this.onWindowResize.bind(this);
        this.boundOnKeyDown = this.onKeyDown.bind(this);
        this.boundOnClick = this.onClick.bind(this);
        this.boundOnMouseMove = this.onMouseMove.bind(this);
        this.boundOnSongComplete = this.onSongComplete.bind(this);

        window.addEventListener('resize', this.boundOnWindowResize);
        window.addEventListener('keydown', this.boundOnKeyDown);
        this.container.addEventListener('click', this.boundOnClick);
        this.container.addEventListener('mousemove', this.boundOnMouseMove);
        eventBus.on('songComplete', this.boundOnSongComplete);
    }

    onMouseMove(event) {
        if (appState.currentSongId !== null || this.renderer.domElement.style.display === 'none') return;
        const picked = this._pickMarker(event.clientX, event.clientY);
        this.renderer.domElement.style.cursor = picked !== -1 ? 'pointer' : 'default';

        if (picked === this.markerHoverIndex) return;
        // Selected marker keeps its highlight; only transient hovers toggle
        if (this.markerHoverIndex !== undefined && this.markerHoverIndex !== -1
            && this.markerHoverIndex !== this.selectedIndex && this.currentPhase) {
            this.currentPhase.onUnhover(this.markerHoverIndex);
        }
        if (picked !== -1 && picked !== this.selectedIndex && this.currentPhase) {
            this.currentPhase.onHover(picked);
        }
        this.markerHoverIndex = picked;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    onClick(event) {
        if (appState.currentSongId !== null || this.renderer.domElement.style.display === 'none') return;
        if (event.target.closest('.song-label')) return;
        if (event.target.closest('.world-selection-panel')) return;

        // Screen-space pick: find the marker nearest to the tap point.
        // Tapping empty space does nothing — songs never start by accident.
        const picked = this._pickMarker(event.clientX, event.clientY);
        if (picked === -1) return;

        if (picked === this.selectedIndex) {
            this.selectSong(SONGS[picked], picked);
        } else {
            this._setSelected(picked);
        }
    }

    _pickMarker(clientX, clientY) {
        if (!this.currentPhase) return -1;
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        // Generous tap target (~64px radius) for mobile friendliness
        const threshold = Math.max(64, window.innerWidth * 0.06);

        let best = -1;
        let bestDist = Infinity;
        SONGS.forEach((song, i) => {
            const worldPos = this.currentPhase.getSongPosition(i);
            const projected = worldPos.clone().project(this.camera);
            if (projected.z >= 1) return;
            const x = (projected.x * widthHalf) + widthHalf;
            const y = -(projected.y * heightHalf) + heightHalf;
            const dist = Math.hypot(clientX - x, clientY - y);
            if (dist < threshold && dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        });
        return best;
    }

    onKeyDown(e) {
        if (appState.currentSongId !== null || this.renderer.domElement.style.display === 'none') return;
        const N = SONGS.length;
        if (e.code === 'ArrowRight') {
            e.preventDefault();
            this._setSelected((this.selectedIndex + 1) % N);
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            this._setSelected((this.selectedIndex - 1 + N) % N);
        } else if (e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            this.selectSong(SONGS[this.selectedIndex], this.selectedIndex);
        }
    }

    onSongComplete(songId) {
        this._refreshLabels();
        this._updateProgressCounter();
    }

    animate() {
        this.animationId = requestAnimationFrame(this.animate);
        if (this.renderer.domElement.style.display === 'none') return;

        const time = (Date.now() - this._clockStart) * 0.001;

        // Gentle idle drift — the world breathes even when nothing is touched
        if (this.cameraBasePos) {
            this.camera.position.x = this.cameraBasePos.x + Math.sin(time * 0.12) * 0.18;
            this.camera.position.y = this.cameraBasePos.y + Math.sin(time * 0.17 + 1.3) * 0.09;
        }

        if (this.currentPhase) {
            this.currentPhase.update(time);

            // For PhaseLake, handle carousel rotation
            if (this.currentPhase.targetRotation !== undefined) {
                const N = SONGS.length;
                this.currentPhase.targetRotation = Math.PI / 2 - this.selectedIndex * (2 * Math.PI / N);
            }
        }

        // Update label positions from phase
        this._updateLabelPositions();

        this.renderer.render(this.scene, this.camera);
    }

    _updateLabelPositions() {
        if (!this.currentPhase) return;

        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        const N = SONGS.length;

        this.labels.forEach((labelData, i) => {
            const worldPos = this.currentPhase.getSongPosition(i);
            const projected = worldPos.clone().project(this.camera);

            if (projected.z < 1) {
                const x = (projected.x * widthHalf) + widthHalf;
                const y = -(projected.y * heightHalf) + heightHalf;

                // Clamp by the label's actual half-width so long titles
                // never get cut off at the screen edges
                const halfW = labelData.element.offsetWidth / 2 + 8;
                const padTop = 70;
                const padBot = 200; // keep labels clear of the selection panel
                const cx = Math.max(halfW, Math.min(window.innerWidth - halfW, x));
                const cy = Math.max(padTop, Math.min(window.innerHeight - padBot, y));

                // Depth-based scale/opacity — keep a readable floor so
                // far-away songs are still legible for first-time users
                const depth = projected.z;
                const depthScale = 0.6 + (1 - depth) * 0.5;
                const depthOpacity = 0.55 + (1 - depth) * 0.45;

                const isSelected = i === this.selectedIndex;
                const isHovered = labelData._hovered;
                const scale = depthScale * (isHovered ? 1.12 : 1.0) * (isSelected ? 1.1 : 1.0);

                labelData.element.style.left = `${cx}px`;
                labelData.element.style.top = `${cy}px`;
                labelData.element.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
                labelData.element.style.opacity = Math.min(1, depthOpacity).toFixed(3);

                if (isSelected) {
                    labelData.element.classList.add('song-label--front');
                } else {
                    labelData.element.classList.remove('song-label--front');
                }
            } else {
                labelData.element.style.opacity = '0';
            }
        });
    }

    destroy() {
        cancelAnimationFrame(this.animationId);
        window.removeEventListener('resize', this.boundOnWindowResize);
        window.removeEventListener('keydown', this.boundOnKeyDown);
        this.container.removeEventListener('click', this.boundOnClick);
        this.container.removeEventListener('mousemove', this.boundOnMouseMove);
        eventBus.off('songComplete', this.boundOnSongComplete);

        if (this.currentPhase) {
            this.currentPhase.dispose();
        }

        this.renderer.dispose();

        if (this.labelsContainer?.parentNode) {
            this.labelsContainer.parentNode.removeChild(this.labelsContainer);
        }
        if (this.selectionPanel?.parentNode) {
            this.selectionPanel.parentNode.removeChild(this.selectionPanel);
        }
        if (this.thumbCard?.parentNode) {
            this.thumbCard.parentNode.removeChild(this.thumbCard);
        }
    }
}
