import * as THREE from 'three';
import { quality } from '../core/quality.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { settleSpringBones } from '../utils/vrm.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { eventBus } from '../core/eventBus.js';
import { buildNightLake } from '../lake/kotaeteLakes.js';

// =============================================================================
// こたえて 「水鏡(みずかがみ)」
// -----------------------------------------------------------------------------
// 一枚の静かな湖面だけで完結する。回廊もグリッドも選択メニューも捨てる。
// 対岸でミクがシルエットのまま歌い、プレイヤーは「水に触れる」一動作だけで
// 歌詞を波紋に乗せて届ける。触れた位置(手前=静けさ / 奥=光)が無意識のうちに
// 色を決め、曲の終わりに「あなただけの答えの色」が湖面を満たす。
//   - 操作は水に触れる、ただ一つ
//   - 明示の二択UIは出さない(触れた位置の累積で色が決まる)
//   - 夜の湖シェーダ(kotaeteLakes.buildNightLake)を土台に流用
// =============================================================================

const WATER_Y = -2.0;                     // 水面の高さ(kotaeteLakes の WY と一致)
const WARM = new THREE.Color('#F4A86A');  // 奥(光・夜明け)へ触れたときの暖色
const COOL = new THREE.Color('#5E78C8');  // 手前(静けさ)へ触れたときの寒色

export class SongKotaete extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.isMobile = window.innerWidth < 768;

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // ---- 湖(夜の湖を group へ構築) ----
        this.lakeGroup = null;
        this.lakeItems = [];
        this.lakeFade = 0;            // 0→1 でフェードイン

        // ---- ミク ----
        this.currentVRM = null;
        this.mikuLoaded = false;
        this.mikuGlow = null;
        this.mikuPulse = 0;          // 歌唱/反応のパルス(0..1, 毎フレーム減衰)
        // 対岸だが「ミクだと分かる」近さに置く(遠すぎるとシルエットが潰れる)
        this.mikuPos = new THREE.Vector3(0, WATER_Y, -19);
        this.mikuScale = 3.5;

        // ---- 演出の生きているもの ----
        this.ripples = [];           // 水面に広がる波紋リング
        this.lyricSprites = [];      // 水面を漂い対岸へ向かう歌詞
        this.lightMotes = [];        // ミクへ吸い込まれる光の粒

        // ---- テクスチャ ----
        this.glowTexture = null;
        this.ringTexture = null;

        // ---- 色(答え) ----
        this.worldColor = new THREE.Color('#9FB0EE');   // 歌詞・波紋の着色
        this.answerColor = new THREE.Color('#6E7CC8');  // 触れて積もる「答えの色」
        this.touchCount = 0;
        this.tintOverlay = null;     // 画面全体を答えの色で染めるCSSオーバーレイ
        this.tintOpacity = 0;

        this.finaleActive = false;

        // ---- 進行検出 ----
        this._lastPhraseStart = -1;
        this._lastWordStart = -1;
        this._lastFrameReal = performance.now();
        // 連打で歌詞が乱発されないようにするクールダウン/重複ガード
        this._lastTouchLyricAt = -Infinity;
        this._lastLyricText = null;

        // ---- レイキャスト(水面ヒット) ----
        this._raycaster = new THREE.Raycaster();
        this._ndc = new THREE.Vector2();
        this._waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
        this._hit = new THREE.Vector3();

        this._white = new THREE.Color(0xffffff);

        this.boundOnResize = this.onResize.bind(this);
        this.boundOnPointerDown = this.onPointerDown.bind(this);
        this.boundOnSongEnd = () => this.startFinale();
    }

    // =====================================================================
    // init / teardown
    // =====================================================================
    init() {
        this.createTextures();
        this.initThree();
        this.buildLake();
        this.loadMiku();
        this.createTintOverlay();

        window.addEventListener('resize', this.boundOnResize);
        this.songWrapper.addEventListener('pointerdown', this.boundOnPointerDown);
        eventBus.on('songEnd', this.boundOnSongEnd);

        super.init();

        // 初回誘導: 画面下寄り(手前の水面)を「水面にふれて」で示す。
        // 一度でも触れたら onPointerDown 側で dismiss する。
        this.highlightFirstInteractable(() => {
            if (this.touchCount > 0) return null;
            return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.66 };
        }, { label: '水面にふれて、歌詞をミクへ', autoDismissMs: 10000 });
    }

    initThree() {
        this.scene = new THREE.Scene();
        // 夜の湖シェーダがフォグ色/密度を毎フレーム lerp で支配する。初期値だけ与える。
        this.scene.fog = new THREE.FogExp2(0x0b2142, 0.0045);
        this.scene.background = new THREE.Color(0x0a1330);

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 2.2, 9);

        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        this.songWrapper.appendChild(this.renderer.domElement);

        // 静かな夜だが、ミクが「誰か」分かる程度には起こす。
        this.ambientLight = new THREE.AmbientLight(0x33406e, 1.4);
        this.scene.add(this.ambientLight);

        // 月の方向からのリムライト(輪郭を立てる)
        this.rimLight = new THREE.DirectionalLight(0xbcccF0, 2.0);
        this.rimLight.position.set(3, 9, -45);
        this.scene.add(this.rimLight);

        // カメラ側からの柔らかいフィル(シルエットを潰しすぎず顔/衣装をうっすら見せる)
        this.fillLight = new THREE.DirectionalLight(0x9fb0d8, 0.9);
        this.fillLight.position.set(0, 4, 14);
        this.scene.add(this.fillLight);
    }

    buildLake() {
        this.lakeGroup = new THREE.Group();
        this.scene.add(this.lakeGroup);
        this.lakeItems = [];
        // 中央の前景草は歌詞の視認性を下げるので抑制する
        this.skipForegroundGrass = true;
        // ctx として this を渡す(isMobile / camera / scene / starField を参照する)
        buildNightLake(THREE, this, this.lakeGroup, this.lakeItems);
    }

    createTextures() {
        // 柔らかな光(グロー)
        const g = document.createElement('canvas');
        g.width = g.height = 128;
        const gx = g.getContext('2d');
        const grad = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        gx.fillStyle = grad;
        gx.fillRect(0, 0, 128, 128);
        this.glowTexture = new THREE.CanvasTexture(g);

        // 波紋リング(中心が空いた淡いリング)
        const r = document.createElement('canvas');
        r.width = r.height = 256;
        const rx = r.getContext('2d');
        const rg = rx.createRadialGradient(128, 128, 70, 128, 128, 128);
        rg.addColorStop(0, 'rgba(255,255,255,0)');
        rg.addColorStop(0.72, 'rgba(255,255,255,0)');
        rg.addColorStop(0.85, 'rgba(255,255,255,0.85)');
        rg.addColorStop(0.97, 'rgba(255,255,255,0.12)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        rx.fillStyle = rg;
        rx.fillRect(0, 0, 256, 256);
        this.ringTexture = new THREE.CanvasTexture(r);
    }

    createTintOverlay() {
        const el = document.createElement('div');
        el.style.cssText =
            'position:absolute;inset:0;pointer-events:none;mix-blend-mode:soft-light;' +
            'opacity:0;z-index:5;transition:none;';
        el.style.background = '#' + this.answerColor.getHexString();
        this.songWrapper.appendChild(el);
        this.tintOverlay = el;
    }

    // =====================================================================
    // ミク(対岸で佇み、歌うシルエット)
    // =====================================================================
    loadMiku() {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        loader.load(
            import.meta.env.BASE_URL + 'assets/models/model_miku.vrm',
            (gltf) => {
                if (!this.isActive) { this._disposeVRM(gltf.userData.vrm); return; }
                const vrm = gltf.userData.vrm;
                this.currentVRM = vrm;
                this.scene.add(vrm.scene);
                vrm.scene.scale.setScalar(this.mikuScale);
                vrm.scene.position.set(this.mikuPos.x, WATER_Y, this.mikuPos.z);
                vrm.scene.rotation.y = 0; // カメラ(プレイヤー)の方を向いて歌う
                this.setupStandPose(vrm);
                settleSpringBones(vrm);
                this.mikuLoaded = true;

                // 背後のほのかな光輪(答えの色に追従)
                const glowMat = new THREE.SpriteMaterial({
                    map: this.glowTexture,
                    color: new THREE.Color('#cfe0ff'),
                    transparent: true,
                    opacity: 0.3,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
                this.mikuGlow = new THREE.Sprite(glowMat);
                this.mikuGlow.scale.set(10, 10, 1);
                this.mikuGlow.position.set(this.mikuPos.x, WATER_Y + 4.0, this.mikuPos.z - 0.5);
                this.mikuGlow.renderOrder = 2;   // 水面より上に描く
                this.scene.add(this.mikuGlow);

                console.log('[KOTAETE] Miku VRM loaded (mizukagami).');
            },
            undefined,
            (error) => console.error('[KOTAETE] Failed to load VRM:', error),
        );
    }

    // 自然な立ち姿(腕を体側に下ろす)。踊らせず、静かに佇ませる。
    setupStandPose(vrm) {
        if (!vrm || !vrm.humanoid) return;
        const get = (n) => vrm.humanoid.getNormalizedBoneNode(n);
        const lu = get('leftUpperArm'), ru = get('rightUpperArm');
        const ll = get('leftLowerArm'), rl = get('rightLowerArm');
        if (lu) lu.rotation.z = Math.PI / 2.6;
        if (ru) ru.rotation.z = -Math.PI / 2.6;
        if (ll) ll.rotation.y = Math.PI / 14;
        if (rl) rl.rotation.y = -Math.PI / 14;
    }

    updateMiku(now, deltaSec) {
        if (!this.currentVRM) return;
        const t = now * 0.001;

        // 呼吸のような上下、歌唱パルスでの一瞬の伸び上がり
        this.mikuPulse = Math.max(0, this.mikuPulse - deltaSec * 2.0);
        const breathe = Math.sin(t * 1.4) * 0.045;
        this.currentVRM.scene.position.y = WATER_Y + breathe + this.mikuPulse * 0.16;
        // ごくゆるい左右の揺れ
        this.currentVRM.scene.rotation.y = Math.sin(t * 0.5) * 0.05;
        // 胸を少し起こして歌っている気配
        const spine = this.currentVRM.humanoid.getNormalizedBoneNode('spine');
        if (spine) spine.rotation.x = this.mikuPulse * 0.06;

        if (this.mikuGlow) {
            this.mikuGlow.position.set(this.mikuPos.x, WATER_Y + 4.0, this.mikuPos.z - 0.5);
            this.mikuGlow.material.opacity = 0.32 + this.mikuPulse * 0.4;
            this.mikuGlow.material.color.copy(this.answerColor).lerp(this._white, 0.5);
        }

        this.currentVRM.update(deltaSec); // SpringBone(ツインテール)更新
    }

    reactMiku(strength = 1) {
        this.mikuPulse = Math.min(1, this.mikuPulse + strength);
    }

    // =====================================================================
    // 入力: 水に触れる(唯一の操作)
    // =====================================================================
    onClick() { /* BaseSong の汎用CSSリップルは出さない(水面の波紋に一本化) */ }

    onPointerDown(event) {
        if (!this.isActive || !this.camera || this.isTutorialActive) return;
        if (event.target && event.target.closest &&
            event.target.closest('button, a, input, .song-tutorial-overlay, .mizukagami-reveal')) {
            return;
        }

        this._ndc.set(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1,
        );
        this._raycaster.setFromCamera(this._ndc, this.camera);
        const hit = this._raycaster.ray.intersectPlane(this._waterPlane, this._hit);
        if (!hit || hit.z > this.camera.position.z - 1.5) return; // 水面より手前/真下は無視

        this.touchCount++;
        this.dismissFirstInteractable();

        this.spawnRipple(hit);
        this.accumulateColor(hit);
        this.spawnMote(hit);
        this.reactMiku(0.7);

        // 近くに漂う歌詞があれば共鳴(明るく・速く対岸へ)。
        // 無いときだけ今の歌詞を立ち上げるが、連打での乱発を防ぐため
        // クールダウン(0.9秒)＋同一フレーズの再発射禁止でゲートする。
        const near = this.pickNearLyric(event.clientX, event.clientY);
        if (near) {
            this.resonateLyric(near);
        } else {
            const text = this.currentLyricText();
            const tnow = performance.now();
            if (text && text !== this._lastLyricText && tnow - this._lastTouchLyricAt > 900) {
                this.spawnLyric(text, hit, { dur: 4.2, resonated: true });
                this._lastTouchLyricAt = tnow;
                this._lastLyricText = text;
            }
        }
    }

    accumulateColor(hit) {
        // 手前(0)→奥/対岸(1)。奥へ触れるほど光・夜明けの暖色へ寄る。
        const nz = THREE.MathUtils.clamp((this.camera.position.z - hit.z) / 30, 0, 1);
        const tc = COOL.clone().lerp(WARM, nz);
        this.answerColor.lerp(tc, 0.16);          // 触れるたびに少しずつ移ろう移動平均
        this.worldColor.copy(this.answerColor).lerp(this._white, 0.28);
    }

    // =====================================================================
    // 波紋 / 歌詞 / 光の粒
    // =====================================================================
    spawnRipple(point) {
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
            map: this.ringTexture,
            transparent: true,
            opacity: 0.75,
            depthWrite: false,
            depthTest: false,                  // 水面(renderOrder 1, ほぼ不透明)の上に必ず描く
            blending: THREE.AdditiveBlending,
            color: this.answerColor.clone().lerp(this._white, 0.55),
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(point.x, WATER_Y + 0.03, point.z);
        mesh.scale.setScalar(1.6);
        mesh.renderOrder = 3;                  // 水面より後(=上)に描画
        this.scene.add(mesh);
        this.ripples.push({ mesh, mat, geo, life: 0, dur: 1.9 });
    }

    updateRipples(dt) {
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const r = this.ripples[i];
            r.life += dt;
            const t = r.life / r.dur;
            if (t >= 1) {
                this.scene.remove(r.mesh);
                r.geo.dispose(); r.mat.dispose();
                this.ripples.splice(i, 1);
                continue;
            }
            r.mesh.scale.setScalar(1.6 + t * 17);
            r.mat.opacity = 0.55 * (1 - t);
        }
    }

    spawnLyric(text, point, opts = {}) {
        if (this.lyricSprites.length > 7) {
            // 古いものから片付けて溢れさせない
            const old = this.lyricSprites.shift();
            this.scene.remove(old.spr); old.mat.dispose(); old.texture.dispose();
        }
        const { texture, aspect } = this.createTextTexture(text, '#' + this.worldColor.getHexString());
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
        const spr = new THREE.Sprite(mat);
        const h = 1.7;
        spr.scale.set(h * aspect, h, 1);
        spr.position.set(point.x, WATER_Y + 0.7, point.z);
        spr.renderOrder = 4;                 // 水面より上に描く
        this.scene.add(spr);

        // 対岸のミクの少し手前・上を目標に流す(吸い込まれていくように)
        const target = new THREE.Vector3(this.mikuPos.x, WATER_Y + 2.4, this.mikuPos.z + 3.0);
        this.lyricSprites.push({
            spr, mat, texture,
            from: spr.position.clone(), target,
            life: 0,
            dur: opts.dur != null ? opts.dur : 7.5,
            maxOpacity: opts.resonated ? 1.0 : 0.55,
            resonated: !!opts.resonated,
        });
    }

    updateLyrics(dt) {
        for (let i = this.lyricSprites.length - 1; i >= 0; i--) {
            const l = this.lyricSprites[i];
            l.life += dt;
            const t = l.life / l.dur;
            if (t >= 1) {
                if (l.resonated) this.reactMiku(0.5); // 届いた言葉にミクが応える
                this.scene.remove(l.spr);
                l.mat.dispose(); l.texture.dispose();
                this.lyricSprites.splice(i, 1);
                continue;
            }
            const ease = 1 - Math.pow(1 - t, 2); // ease-out で対岸へ
            l.spr.position.lerpVectors(l.from, l.target, ease);
            // 立ち上がり→保持→消え際でフェード
            const fadeIn = Math.min(1, t / 0.12);
            const fadeOut = 1 - Math.max(0, (t - 0.7) / 0.3);
            l.mat.opacity = l.maxOpacity * fadeIn * fadeOut;
        }
    }

    resonateLyric(l) {
        if (l.resonated) return;
        l.resonated = true;
        l.maxOpacity = 1.0;
        // 残り距離を一気に詰める(波紋に押されて対岸へ)
        l.dur = Math.min(l.dur, l.life + 2.6);
        this.spawnMote(l.spr.position);
    }

    pickNearLyric(clientX, clientY) {
        let best = null, bestD = 150; // px
        for (const l of this.lyricSprites) {
            if (l.resonated) continue;
            const p = this.worldToScreen(l.spr.position.clone());
            if (!p) continue;
            const d = Math.hypot(p.x - clientX, p.y - clientY);
            if (d < bestD) { bestD = d; best = l; }
        }
        return best;
    }

    spawnMote(from) {
        const mat = new THREE.SpriteMaterial({
            map: this.glowTexture,
            color: this.answerColor.clone().lerp(this._white, 0.6),
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const s = new THREE.Sprite(mat);
        s.position.set(from.x, WATER_Y + 0.6, from.z);
        s.scale.set(1.2, 1.2, 1);
        s.renderOrder = 4;                   // 水面より上に描く
        this.scene.add(s);
        const target = new THREE.Vector3(this.mikuPos.x, WATER_Y + 2.6, this.mikuPos.z);
        this.lightMotes.push({ s, mat, from: s.position.clone(), target, life: 0, dur: 1.3 });
    }

    updateMotes(dt) {
        for (let i = this.lightMotes.length - 1; i >= 0; i--) {
            const m = this.lightMotes[i];
            m.life += dt;
            const t = m.life / m.dur;
            if (t >= 1) {
                this.reactMiku(0.5);
                this.scene.remove(m.s); m.mat.dispose();
                this.lightMotes.splice(i, 1);
                continue;
            }
            const ease = 1 - Math.pow(1 - t, 3);
            m.s.position.lerpVectors(m.from, m.target, ease);
            m.s.position.y += Math.sin(t * Math.PI) * 1.4; // ふわりと弧を描く
            m.s.scale.setScalar(1.2 * (1 - t * 0.6));
            m.mat.opacity = 0.9 * (1 - t);
        }
    }

    // =====================================================================
    // 歌詞テクスチャ(白文字 + 色の影。暗い水面でも読める)
    // =====================================================================
    createTextTexture(text, colorStr) {
        const FONT = 'bold 80px "Inter", "Noto Sans JP", "Hiragino Kaku Gothic Pro", sans-serif';
        const PAD = 56;
        const LINE_H = 116;
        const MAX_LINE = 1100;

        const meas = document.createElement('canvas').getContext('2d');
        meas.font = FONT;
        const fullW = meas.measureText(text).width;

        let lines = [text];
        if (fullW > MAX_LINE && text.length >= 4) {
            let best = Math.ceil(text.length / 2);
            for (let off = 0; off <= 3; off++) {
                const c = text[best + off];
                if (c && '、。　 はがにをのとへもや'.includes(c)) { best = best + off + 1; break; }
            }
            lines = [text.slice(0, best), text.slice(best)];
        }

        const lineWidths = lines.map(l => meas.measureText(l).width);
        const w = Math.ceil(Math.min(MAX_LINE, Math.max(...lineWidths)) + PAD);
        const h = LINE_H * lines.length + PAD;

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.font = FONT;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = colorStr;
        ctx.shadowBlur = 22;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        lines.forEach((line, i) => {
            const lw = lineWidths[i];
            const y = (h / 2) - (LINE_H * (lines.length - 1)) / 2 + i * LINE_H;
            if (lw > MAX_LINE) {
                ctx.save();
                ctx.translate(w / 2, y);
                ctx.scale(MAX_LINE / lw, 1);
                ctx.fillText(line, 0, 0);
                ctx.restore();
            } else {
                ctx.fillText(line, w / 2, y);
            }
        });

        return { texture: new THREE.CanvasTexture(canvas), aspect: w / h };
    }

    currentLyricText() {
        const p = playerManager.player;
        if (!p || !p.video) return null;
        const pos = p.timer ? p.timer.position : this.currentTime;
        const ph = p.video.findPhrase(pos);
        if (ph && ph.text) return ph.text;
        const w = p.video.findWord(pos) || p.video.findChar(pos);
        return (w && w.text) ? w.text : null;
    }

    // =====================================================================
    // メインループ
    // =====================================================================
    update() {
        const realNow = performance.now();
        let dt = (realNow - this._lastFrameReal) / 1000;
        this._lastFrameReal = realNow;
        dt = Math.min(dt, 0.05);
        const now = realNow;

        // 湖をやわらかくフェードイン
        this.lakeFade += (1 - this.lakeFade) * Math.min(1, dt * 0.6);
        for (const item of this.lakeItems) item.update(now, dt, this.lakeFade);

        this.updateMiku(now, dt);
        this.updateRipples(dt);
        this.updateLyrics(dt);
        this.updateMotes(dt);

        // 歌詞の自動流れ + 歌唱パルス(チュートリアル中は止める)
        if (!this.isTutorialActive) {
            this.trackLyricFlow();
        }

        // 答えの色で画面全体をそっと染める(進行 + 触れた回数 + フィナーレ)
        this.updateTint(dt);
    }

    trackLyricFlow() {
        const p = playerManager.player;
        if (!p || !p.video) return;
        const pos = p.timer ? p.timer.position : this.currentTime;

        // 新しいフレーズが始まったら、手前の水面から淡い歌詞を立ち上げ対岸へ漂わせる
        const ph = p.video.findPhrase(pos);
        if (ph && ph.startTime !== this._lastPhraseStart) {
            this._lastPhraseStart = ph.startTime;
            if (ph.text) {
                const sx = (Math.random() - 0.5) * 9;
                const sz = this.camera.position.z - (9 + Math.random() * 7);
                this.spawnLyric(ph.text, new THREE.Vector3(sx, WATER_Y + 0.7, sz), { dur: 8.0, resonated: false });
                // この行は既に流れているので、タップでの重複発射を抑止する
                this._lastLyricText = ph.text;
            }
        }

        // 新しい語が歌い出されるたびにミクが小さく息づく
        const w = p.video.findWord(pos);
        if (w && w.startTime !== this._lastWordStart) {
            this._lastWordStart = w.startTime;
            this.reactMiku(0.3);
        }
    }

    updateTint(dt) {
        const p = playerManager.player;
        const dur = (p && p.video && p.video.duration) || 0;
        const pos = (p && p.timer) ? p.timer.position : this.currentTime;
        const prog = dur > 0 ? THREE.MathUtils.clamp(pos / dur, 0, 1) : 0;

        let target = 0.04 + 0.12 * prog + Math.min(this.touchCount * 0.004, 0.06);
        if (this.finaleActive) target = 0.36;
        this.tintOpacity += (target - this.tintOpacity) * Math.min(1, dt * 1.2);

        if (this.tintOverlay) {
            this.tintOverlay.style.opacity = this.tintOpacity.toFixed(3);
            this.tintOverlay.style.background = '#' + this.answerColor.getHexString();
        }
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // =====================================================================
    // フィナーレ: あなただけの答えの色を明かす
    // =====================================================================
    startFinale() {
        if (this.finaleActive) return;
        this.finaleActive = true;
        this.reactMiku(1);

        const hex = '#' + this.answerColor.getHexString();
        this.showFinaleReveal(hex);
        this.setResultSummary({
            lines: ['あなたが触れた水面から', '生まれた答えの色'],
            accentColor: hex,
            swatch: hex,
        });
    }

    showFinaleReveal(hex) {
        if (this._revealEl) return;
        const el = document.createElement('div');
        el.className = 'mizukagami-reveal';
        el.style.cssText =
            'position:absolute;left:50%;top:50%;transform:translate(-50%,-46%);' +
            'display:flex;flex-direction:column;align-items:center;gap:14px;' +
            'pointer-events:none;opacity:0;transition:opacity 1.6s ease, transform 1.6s ease;' +
            'z-index:20;text-align:center;font-family:"Inter","Noto Sans JP",sans-serif;';
        el.innerHTML =
            `<div style="width:96px;height:96px;border-radius:50%;background:${hex};` +
            `box-shadow:0 0 46px ${hex},0 0 12px rgba(255,255,255,0.6);` +
            `border:2px solid rgba(255,255,255,0.55);"></div>` +
            `<div style="color:#fff;font-size:15px;letter-spacing:2px;font-weight:600;` +
            `text-shadow:0 2px 10px rgba(0,0,0,0.6);">あなたの答えの色</div>` +
            `<div style="color:rgba(255,255,255,0.78);font-size:12px;letter-spacing:1px;` +
            `text-shadow:0 2px 8px rgba(0,0,0,0.6);">${hex.toUpperCase()}</div>`;
        this.songWrapper.appendChild(el);
        this._revealEl = el;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translate(-50%,-50%)';
        }));
    }

    // =====================================================================
    // resize / destroy
    // =====================================================================
    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
    }

    _disposeVRM(vrm) {
        try {
            vrm?.scene?.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose && m.dispose());
                }
            });
        } catch (_) { /* noop */ }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        this.songWrapper.removeEventListener('pointerdown', this.boundOnPointerDown);
        eventBus.off('songEnd', this.boundOnSongEnd);

        // 生きている演出を破棄
        this.ripples.forEach(r => { this.scene.remove(r.mesh); r.geo.dispose(); r.mat.dispose(); });
        this.lyricSprites.forEach(l => { this.scene.remove(l.spr); l.mat.dispose(); l.texture.dispose(); });
        this.lightMotes.forEach(m => { this.scene.remove(m.s); m.mat.dispose(); });
        this.ripples = []; this.lyricSprites = []; this.lightMotes = [];

        // 湖(group + items の dispose)
        this.lakeItems.forEach(it => { if (it.dispose) try { it.dispose(); } catch (_) {} });
        if (this.lakeGroup) {
            this.lakeGroup.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose && m.dispose());
                }
            });
            this.scene.remove(this.lakeGroup);
        }

        if (this.currentVRM) { this.scene.remove(this.currentVRM.scene); this._disposeVRM(this.currentVRM); this.currentVRM = null; }
        if (this.mikuGlow) { this.scene.remove(this.mikuGlow); this.mikuGlow.material.dispose(); }
        this.glowTexture && this.glowTexture.dispose();
        this.ringTexture && this.ringTexture.dispose();

        if (this.tintOverlay && this.tintOverlay.parentNode) this.tintOverlay.parentNode.removeChild(this.tintOverlay);
        if (this._revealEl && this._revealEl.parentNode) this._revealEl.parentNode.removeChild(this._revealEl);

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        super.destroy();
    }
}
