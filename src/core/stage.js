// ─────────────────────────────────────────────────────────────
// STAGE — スマホ向けレターボックス/ピラーボックス。
//
// 目的: スマホのブラウザでは画面アスペクト比や上下のブラウザUIが端末ごとに
//       バラつくため、プレイ領域を 9:16 の固定アスペクトに収め、余白を黒帯で
//       埋めて「画面幅(と高さ)を固定」する。
//
// 設計のキモ: 既存のシーン/UIは全面的に「window=画面全体」を前提に
//   window.innerWidth/innerHeight、clientX/clientY、getBoundingClientRect を
//   直接使っている。これらを個別に書き換えると数百箇所＋6つのゲームを壊しかねない。
//   そこで座標系そのものを「ステージ相対」に一括シムする:
//     - window.innerWidth/innerHeight       → ステージ寸法を返す
//     - MouseEvent/Touch の clientX/clientY  → ステージ左上を原点に補正
//     - Element.getBoundingClientRect        → 同上(left/top 等を補正)
//   clientX と rect は両方同じ量だけずらすので `clientX - rect.left` のような
//   相対計算は不変、`clientX / innerWidth` のような絶対計算はステージ内[0,1]に
//   正規化される。結果、ゲームロジックは無改変で正しく動く。
//
//   シムは active(=スマホ幅 かつ オフセットあり)時のみ作用。PC/タブレットは
//   完全に素のまま(挙動不変)。
// ─────────────────────────────────────────────────────────────

const TARGET_RATIO = 9 / 16;     // 幅/高さ(縦持ち基準)
const MOBILE_MAX_WIDTH = 768;    // responsive.css と同じスマホ境界

let W = 0, H = 0, L = 0, T = 0;  // ステージの幅・高さ・左オフセット・上オフセット(px)
let active = false;
let installed = false;
let bars = null;

function realVW() {
    return Math.round((window.visualViewport && window.visualViewport.width) || document.documentElement.clientWidth);
}
function realVH() {
    // visualViewport はブラウザのツールバー表示/非表示に追従する(=可視領域)
    return Math.round((window.visualViewport && window.visualViewport.height) || document.documentElement.clientHeight);
}

function recompute() {
    const vw = realVW(), vh = realVH();
    active = vw <= MOBILE_MAX_WIDTH;
    if (!active) { W = vw; H = vh; L = 0; T = 0; return; }
    if (vw / vh > TARGET_RATIO) {
        // 端末が 9:16 より横長 → 左右に黒帯(ピラーボックス)
        H = vh; W = Math.round(vh * TARGET_RATIO);
    } else {
        // 端末が 9:16 より縦長 → 上下に黒帯(レターボックス)
        W = vw; H = Math.round(vw / TARGET_RATIO);
    }
    L = Math.round((vw - W) / 2);
    T = Math.round((vh - H) / 2);
}

// ── window.innerWidth / innerHeight をステージ寸法に上書き ──
function installSizeOverride() {
    try {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            get() { return active ? W : realVW(); },
        });
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            get() { return active ? H : realVH(); },
        });
    } catch (e) { /* 古い環境では諦めて素の値を使う */ }
}

// ── clientX/clientY をステージ左上原点に補正 ──
function patchClientCoord(proto, prop, axis) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.get) return;
    const nativeGet = desc.get;
    Object.defineProperty(proto, prop, {
        configurable: true,
        get() {
            const v = nativeGet.call(this);
            if (!active) return v;
            return v - (axis === 'x' ? L : T);
        },
    });
}

// ── getBoundingClientRect をステージ相対に補正 ──
function installRectPatch() {
    const native = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
        const r = native.call(this);
        if (!active || (L === 0 && T === 0)) return r;
        return {
            x: r.x - L, y: r.y - T,
            left: r.left - L, top: r.top - T,
            right: r.right - L, bottom: r.bottom - T,
            width: r.width, height: r.height,
            toJSON() { return this; },
        };
    };
}

function installPointerPatches() {
    patchClientCoord(MouseEvent.prototype, 'clientX', 'x');
    patchClientCoord(MouseEvent.prototype, 'clientY', 'y');
    if (typeof Touch !== 'undefined' && Touch.prototype) {
        patchClientCoord(Touch.prototype, 'clientX', 'x');
        patchClientCoord(Touch.prototype, 'clientY', 'y');
    }
    installRectPatch();
}

// ── 黒帯(上下左右の4枚)。最前面・クリック透過で、ステージ外を黒で覆う ──
function ensureBars() {
    if (bars) return;
    bars = {};
    ['top', 'bottom', 'left', 'right'].forEach((k) => {
        const d = document.createElement('div');
        d.className = 'stage-letterbox-bar';
        d.style.cssText = 'position:fixed;background:#000;z-index:2147483646;pointer-events:none;display:none;';
        document.body.appendChild(d);
        bars[k] = d;
    });
}

function layoutBars() {
    ensureBars();
    if (!active || (L === 0 && T === 0)) {
        Object.values(bars).forEach((d) => { d.style.display = 'none'; });
        return;
    }
    const vw = realVW(), vh = realVH();
    const set = (d, css) => { d.style.cssText = 'position:fixed;background:#000;z-index:2147483646;pointer-events:none;' + css; };
    set(bars.top,    `left:0;top:0;width:${vw}px;height:${T}px;`);
    set(bars.bottom, `left:0;top:${T + H}px;width:${vw}px;height:${vh - T - H}px;`);
    set(bars.left,   `left:0;top:0;width:${L}px;height:${vh}px;`);
    set(bars.right,  `left:${L + W}px;top:0;width:${vw - L - W}px;height:${vh}px;`);
}

function apply() {
    const app = document.getElementById('app');
    if (app) {
        if (active) {
            app.style.position = 'absolute';
            app.style.left = `${L}px`;
            app.style.top = `${T}px`;
            app.style.width = `${W}px`;
            app.style.height = `${H}px`;
            app.style.overflow = 'hidden';
        } else {
            app.style.position = '';
            app.style.left = '';
            app.style.top = '';
            app.style.width = '';
            app.style.height = '';
            app.style.overflow = '';
        }
    }
    layoutBars();
}

function onViewportChange(redispatch) {
    recompute();
    apply();
    // visualViewport/orientation 経由の変化は window 'resize' を発火しないので、
    // 各シーンのリサイズ処理(window 'resize' 購読)を確実に走らせるため合成発火する。
    // (この合成 resize は capture リスナで再 recompute されるが冪等なのでループしない)
    if (redispatch) window.dispatchEvent(new Event('resize'));
}

/**
 * スタートアップで一度だけ呼ぶ。座標系シムを仕込み、#app をステージ化する。
 * 各シーン/UI 生成より前に呼ぶこと(カメラ aspect 等が確定するため)。
 */
export function initStage() {
    if (installed) return;
    installed = true;
    installSizeOverride();
    installPointerPatches();
    recompute();
    apply();
    // capture フェーズで先に recompute → 後続(シーンの bubble リスナ)が新寸法を読む
    window.addEventListener('resize', () => onViewportChange(false), true);
    window.addEventListener('orientationchange', () => onViewportChange(true));
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => onViewportChange(true));
    }
}

/** オーバーレイ類の追加先。ステージ(=#app)内に収めてレターボックスでクリップする。 */
export function stageRoot() {
    return document.getElementById('app') || document.body;
}
