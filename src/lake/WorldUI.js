import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { eventBus } from '../core/eventBus.js';
import { SONGS } from '../config/songs.js';
import { PHASES } from '../config/constants.js';
import { appState } from '../core/appState.js';
import { PHASE_CLASSES } from './phases/index.js';
import { screenFade } from '../ui/ScreenFade.js';
import { quality } from '../core/quality.js';

export class WorldUI {
    constructor(container) {
        this.container = container;
        // 選曲ハブは滞在時間が最も長い画面なので、各曲シーンと同じ基準で
        // モバイル時は重い表現(MSAA・影・bloom)を落として持続フレームレートを優先する。
        this.isMobile = window.innerWidth < 768;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        // 解像度は品質マネージャ(端末性能+実FPSで自動調整)に委ねる。
        // Retina/高DPIでは塗りピクセルがdpr²倍になりfillrate律速になるため上限を抑える。
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        // Cinematic grading to match the redesign (湖のソナーレ scene art direction)
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
        // PCF影はGPUのfillrateを大きく消費するため品質ティアで制御(低スペックは無効)
        this.renderer.shadowMap.enabled = quality.useShadows;
        // PCFSoftShadowMap is deprecated in this three build (falls back to PCF)
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // Post-processing: subtle bloom for luminous water/sun/song-node highlights.
        // フルスクリーンのbloomは重いので品質ティアで制御。無効時は composer を
        // 介さず renderer で直接描画する(animate参照)。
        this.useBloom = quality.useBloom;
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        if (this.useBloom) {
            this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.5, 0.85);
            this.composer.addPass(this.bloomPass);
        }
        this.composer.setSize(window.innerWidth, window.innerHeight);

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
        this._maybeShowEnding();

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
        this._applyPhaseGrading(this.currentPhase);
        this.currentPhase.createSongMarkers(SONGS);
        this.currentPhaseIndex = phaseIndex;
        // Markers are freshly created — re-apply the selection highlight
        this.currentPhase.onHover(this.selectedIndex);
    }

    // Apply the phase's tone-mapping exposure + bloom grading to the shared
    // renderer/composer. Each phase tunes these to its mood (bright meadow,
    // brooding rain, luminous lake).
    _applyPhaseGrading(phase) {
        if (phase.exposure !== undefined) this.renderer.toneMappingExposure = phase.exposure;
        const b = phase.bloomParams;
        if (b && this.bloomPass) {
            this.bloomPass.strength = b.strength;
            this.bloomPass.radius = b.radius;
            this.bloomPass.threshold = b.threshold;
        }
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
                <div class="song-title" style="text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.95), 0 0 14px ${song.color}99;">
                    ${song.title}${completeMark}
                </div>
                <div class="song-artist">${song.artist}</div>
            `;
            this.labelsContainer.appendChild(label);

            const labelData = {
                element: label,
                titleEl: label.querySelector('.song-title'),
                _hovered: false,
                _styleKey: '',
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

    // 全曲(6/6)制覇したときの控えめな達成テキスト。湖面UIに一度だけ表示する。
    // 既に出していれば何もしない(冪等)。過剰演出はせず、静かな完成の合図のみ。
    _maybeShowEnding() {
        if (!appState.areAllSongsComplete()) return;
        if (this._endingShown) return;
        this._endingShown = true;

        const ending = document.createElement('div');
        ending.className = 'world-ending';
        ending.style.cssText = `
            position: absolute; left: 50%; top: 64px; transform: translateX(-50%);
            color: rgba(255,255,255,0.92); z-index: 480; pointer-events: none;
            font-family: "Hiragino Kaku Gothic Pro","Yu Gothic",sans-serif;
            font-size: clamp(13px, 3.2vw, 18px); font-weight: 300; letter-spacing: 0.18em;
            text-align: center; white-space: nowrap;
            text-shadow: 0 0 6px rgba(0,0,0,0.85), 0 0 18px rgba(212,175,55,0.5);
            opacity: 0; transition: opacity 1.4s ease;
        `;
        ending.textContent = 'ソナーレ完成 — すべての水をめぐった';
        this.container.appendChild(ending);
        // ふわっと浮かび上がらせる
        requestAnimationFrame(() => { ending.style.opacity = '1'; });
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
        this.isTransitioning = true;

        if (this.currentPhase) {
            this.currentPhase.onSelect(index);
        }

        // Fade the world out to the curtain, then hand off to the song scene.
        // main.js reveals the scene (fadeIn) once it finishes loading.
        screenFade.fadeOut(450).then(() => {
            appState.setCurrentSong(song.id);
            this.renderer.domElement.style.display = 'none';
            this.labelsContainer.style.display = 'none';
            if (this.selectionPanel) this.selectionPanel.style.display = 'none';
            if (this.thumbCard) this.thumbCard.style.display = 'none';
            eventBus.emit('loadSong', song);
            this.isTransitioning = false;
        });
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
        this._maybeShowEnding();
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
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
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
        this.container.appendChild(overlay);

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
        if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
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

        // Phase-driven camera parallax: drift around a base position and keep
        // looking at the phase's focus point (recreates the redesign's gentle
        // sweep). Falls back gracefully if a phase omits cameraRig.
        const rig = this.currentPhase?.cameraRig;
        if (rig) {
            const d = rig.drift || {};
            this.camera.position.set(
                rig.pos[0] + Math.sin(time * (d.fx ?? 0.10)) * (d.ax ?? 2.0),
                rig.pos[1] + Math.sin(time * (d.fy ?? 0.16) + 1.3) * (d.ay ?? 0.25),
                rig.pos[2]
            );
            this.camera.lookAt(rig.lookAt[0], rig.lookAt[1], rig.lookAt[2]);
            // Refresh matrices now so label projection / picking this frame are accurate
            this.camera.updateMatrixWorld();
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

        // 実FPSに応じて解像度を自動調整(値が変わった時だけ反映されるので軽い)
        quality.maybeApply(this.renderer, this.useBloom ? this.composer : null);

        // bloom 無効時は composer を介さず直接描画(余計なフルスクリーンパスを省く)
        if (this.useBloom) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    _updateLabelPositions() {
        if (!this.currentPhase) return;

        const W = window.innerWidth, H = window.innerHeight;
        const widthHalf = W / 2, heightHalf = H / 2;
        const padTop = 70;
        const padBot = 200; // keep labels clear of the selection panel

        // モバイルは画面が狭く、6曲ぶんの文字を背景に散らすと潰れ合うので、
        // 背景には選択中の曲名だけを残し、他は3Dの光(マーカー)に名前付けを委ねる。
        const mobile = W < 768;
        // 各フェーズが scene.fog / scene.background に設定している大気色。
        // これを「奥行きで溶け込む先の色」として遠いラベルに馴染ませる(空気遠近法)。
        const atmCol = this.scene.fog?.color || this.scene.background;
        const atmStyle = (atmCol && atmCol.getStyle) ? atmCol.getStyle() : 'rgb(205,215,225)';

        // Thumbnail card box (centered, foreground) that labels must avoid.
        const tc = this.thumbCard;
        let card = null;
        if (tc && tc.style.display !== 'none' && tc.offsetWidth) {
            const margin = 18;
            card = {
                cx: W / 2,
                cy: H - (W <= 480 ? 196 : 184) - tc.offsetHeight / 2, // matches CSS bottom
                hw: tc.offsetWidth / 2 + margin,
                hh: tc.offsetHeight / 2 + margin,
            };
        }

        const clampX = (v, hw) => Math.max(hw + 8, Math.min(W - hw - 8, v));
        const clampY = (v) => Math.max(padTop, Math.min(H - padBot, v));

        // Push a label box out of the card (least-penetration axis; never
        // downward, where the selection panel lives).
        const avoidCard = (p) => {
            if (!card) return;
            const dx = p.cx - card.cx, dy = p.cy - card.cy;
            const exX = card.hw + p.hw, exY = card.hh + p.hh;
            const ox = exX - Math.abs(dx), oy = exY - Math.abs(dy);
            if (ox > 0 && oy > 0) {
                if (ox <= oy) p.cx += dx >= 0 ? ox : -ox;
                else if (dy < 0) p.cy -= oy;
                else p.cy = card.cy - exY;
            }
        };

        // Pass 1 — project each visible label to its node and seed a position.
        const items = [];
        this.labels.forEach((labelData, i) => {
            const isSelected = i === this.selectedIndex;
            // モバイル: 選択中以外の曲名は背景から消す(光だけ残す)
            if (mobile && !isSelected) {
                labelData.element.style.opacity = '0';
                labelData.element.style.pointerEvents = 'none';
                labelData.element.classList.remove('song-label--front');
                return;
            }
            const projected = this.currentPhase.getSongPosition(i).project(this.camera);
            if (projected.z >= 1) { labelData.element.style.opacity = '0'; return; }
            labelData.element.style.pointerEvents = 'auto';
            const lw = labelData.element.offsetWidth, lh = labelData.element.offsetHeight;
            const depth = projected.z;
            items.push({
                labelData, i, lw, lh, hw: lw / 2, hh: lh / 2,
                depth,
                cx: clampX((projected.x * widthHalf) + widthHalf, lw / 2),
                cy: clampY(-(projected.y * heightHalf) + heightHalf),
                depthScale: 0.6 + (1 - depth) * 0.5,
                depthOpacity: 0.55 + (1 - depth) * 0.45,
                isSelected,
                isHovered: labelData._hovered,
            });
        });

        // Pass 2 — relax: separate labels from each other and from the card so
        // names stay legible and never sit over the jacket art.
        for (let iter = 0; iter < 6; iter++) {
            for (let a = 0; a < items.length; a++) {
                for (let b = a + 1; b < items.length; b++) {
                    const A = items[a], B = items[b];
                    let dx = B.cx - A.cx, dy = B.cy - A.cy;
                    if (dx === 0 && dy === 0) { dy = 1; }
                    const minX = A.hw + B.hw + 14, minY = A.hh + B.hh + 8;
                    const ox = minX - Math.abs(dx), oy = minY - Math.abs(dy);
                    if (ox > 0 && oy > 0) {
                        if (oy <= ox) { const s = oy / 2; if (dy >= 0) { A.cy -= s; B.cy += s; } else { A.cy += s; B.cy -= s; } }
                        else { const s = ox / 2; if (dx >= 0) { A.cx -= s; B.cx += s; } else { A.cx += s; B.cx -= s; } }
                    }
                }
            }
            for (const p of items) { avoidCard(p); p.cx = clampX(p.cx, p.hw); p.cy = clampY(p.cy); }
        }

        // Normalize depth across the currently-visible labels so the nearest
        // reads as crisp/present and the farthest recedes into the haze —
        // relative aerial perspective that holds regardless of camera distance.
        let minD = Infinity, maxD = -Infinity;
        for (const p of items) { if (p.depth < minD) minD = p.depth; if (p.depth > maxD) maxD = p.depth; }
        const dRange = maxD - minD;

        // Pass 3 — commit styles.
        for (const p of items) {
            const scale = p.depthScale * (p.isHovered ? 1.12 : 1.0) * (p.isSelected ? 1.1 : 1.0);
            const el = p.labelData.element;
            el.style.left = `${p.cx}px`;
            el.style.top = `${p.cy}px`;
            el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
            // 選択中は奥行きに関わらず前面へ引き出す(特にモバイルは唯一の見出し)
            const opacity = p.isSelected ? Math.max(0.94, p.depthOpacity) : p.depthOpacity;
            el.style.opacity = Math.min(1, opacity).toFixed(3);
            el.classList.toggle('song-label--front', p.isSelected);
            const haze = dRange > 0 ? (p.depth - minD) / dRange : 0;
            this._blendLabelWithBackground(p, haze, atmStyle);
        }
    }

    // Tone-blend a label into the phase's atmosphere color by its normalized
    // depth (haze: 0 = nearest/crisp, 1 = farthest). Distant names lighten
    // toward the background, lose their dark halo and pick up a soft haze glow
    // so they sit *in* the scene instead of floating over it. The selected
    // label is always pulled fully forward (crisp white + readable halo).
    // Cached by a coarse style key so we only repaint when the look changes.
    _blendLabelWithBackground(p, haze, atmStyle) {
        const titleEl = p.labelData.titleEl;
        if (!titleEl) return;
        const song = SONGS[p.i];

        if (p.isSelected) {
            if (p.labelData._styleKey === 'sel') return;
            p.labelData._styleKey = 'sel';
            titleEl.style.color = '#ffffff';
            titleEl.style.removeProperty('filter');
            titleEl.style.setProperty('text-shadow',
                `0 0 4px rgba(0,0,0,0.82), 0 1px 4px rgba(0,0,0,0.9), `
                + `0 0 20px rgba(255,255,255,0.6), 0 0 30px ${song.color}aa`,
                'important');
            return;
        }

        // Hover lifts a label partway out of the haze toward the foreground.
        const h = p.isHovered ? haze * 0.35 : haze;
        const bucket = Math.round(h * 10);
        const key = `${atmStyle}|${bucket}`;
        if (p.labelData._styleKey === key) return;
        p.labelData._styleKey = key;

        const tint = Math.round(h * 42);          // % blended toward atmosphere
        const darkA = (0.9 * (1 - h * 0.72)).toFixed(2);
        const darkB = (0.95 * (1 - h * 0.72)).toFixed(2);
        const atmGlow = (10 + h * 16).toFixed(0);  // haze halo grows with distance
        titleEl.style.color = `color-mix(in srgb, ${atmStyle} ${tint}%, #ffffff)`;
        titleEl.style.setProperty('text-shadow',
            `0 0 4px rgba(0,0,0,${darkA}), 0 1px 3px rgba(0,0,0,${darkB}), `
            + `0 0 14px ${song.color}99, 0 0 ${atmGlow}px ${atmStyle}`,
            '');
        titleEl.style.filter = h > 0.04 ? `blur(${(h * 0.9).toFixed(2)}px)` : '';
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

        this.composer?.dispose?.();
        this.bloomPass?.dispose?.();
        this.renderer.dispose();
        // ハブ+6曲で最大7つのWebGLコンテキストが生成されうる。曲↔湖の往復を繰り返しても
        // ブラウザのコンテキスト上限に達しないよう、明示的に解放する。
        this.renderer.forceContextLoss?.();

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
