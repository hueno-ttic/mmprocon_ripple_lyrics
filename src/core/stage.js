// ─────────────────────────────────────────────────────────────
// STAGE — アプリ全体を「横向き(16:9)」に強制固定するステージ。
//
// 目的: スマホは縦持ち/横持ちが混在し、ブラウザUIで可視領域も端末ごとに
//       バラつく。本アプリは横向き前提の演出なので、プレイ領域を 16:9 の
//       固定アスペクトに収め、縦持ち時はコンテンツごと 90° 回転させて
//       「常に横向き」に見せる。余白は黒帯で埋める。
//
// 設計のキモ: 既存のシーン/UIは全面的に「window=画面全体」を前提に
//   window.innerWidth/innerHeight、clientX/clientY、getBoundingClientRect を
//   直接使っている。これらを個別に書き換えると数百箇所＋6つのゲームを壊しかねない。
//   そこで座標系そのものを「ステージ(論理)相対」に一括シムする:
//     - window.innerWidth/innerHeight       → 論理ステージ寸法(常に横長)を返す
//     - MouseEvent/Touch の clientX/clientY  → 論理ステージ座標に変換(回転込み)
//     - Element.getBoundingClientRect        → 同上(回転込みで論理矩形へ)
//   ゲームロジックは「横向きの素の画面」で動いているかのように振る舞い、無改変で動く。
//
//   縦持ち時は #app を CSS transform で 90° 回転＋平行移動してデバイス画面に貼る。
//   回転は軸整列を保つ(90°)ので getBoundingClientRect の AABB も軸整列のまま、
//   座標は単純な線形変換で論理↔デバイスを往復できる(下記 toLocal / rect パッチ)。
//
//   シムは active(=端末の短辺がスマホ幅)時のみ作用。PC は完全に素のまま(挙動不変)。
// ─────────────────────────────────────────────────────────────

const LANDSCAPE_RATIO = 16 / 9;  // 論理ステージの 幅/高さ (常に横長)
const MOBILE_MAX_WIDTH = 768;    // responsive.css と同じスマホ境界(短辺で判定)

// モバイル時の論理ステージは固定の基準解像度(16:9)にする。
// こうすると固定px(フォント/パネル幅など)が画面に占める割合がPCと揃い、
// 「スマホだけ文字やウィンドウが大きい」現象を解消できる。実寸へは scale で縮小。
const REF_W = 1280, REF_H = 720;

// 論理ステージ寸法(innerWidth/innerHeight が返す値。常に横長)
let SW = 0, SH = 0;
// デバイス画面上でステージが占める矩形(黒帯と #app 配置/回転に使う)
let dL = 0, dT = 0, dW = 0, dH = 0;
// 論理→デバイス の一様スケール(論理ステージ寸法 → 画面上の実寸)
let scale = 1;
let rotated = false;             // 縦持ち時に true (#app を 90° 回転)
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
    // 短辺がスマホ幅以下なら「モバイル」とみなす(縦横どちらの持ち方でも)
    active = Math.min(vw, vh) <= MOBILE_MAX_WIDTH;
    if (!active) { SW = vw; SH = vh; dL = 0; dT = 0; dW = vw; dH = vh; rotated = false; scale = 1; return; }

    // モバイルは論理寸法を固定基準(16:9)にし、画面へは scale で縮小して内接させる。
    SW = REF_W; SH = REF_H;

    if (vw >= vh) {
        // 既に横向き → 回転不要。16:9 を画面に内接させる
        rotated = false;
        if (vw / vh > LANDSCAPE_RATIO) { dH = vh; dW = Math.round(vh * LANDSCAPE_RATIO); }
        else { dW = vw; dH = Math.round(vw / LANDSCAPE_RATIO); }
        scale = dW / SW;                  // 論理幅 → 画面上の実幅
        dL = Math.round((vw - dW) / 2);
        dT = Math.round((vh - dH) / 2);
    } else {
        // 縦持ち → 90° 回転して横向き 16:9 ステージにする。
        // 回転後はステージの論理幅(SW)が画面の縦に、論理高(SH)が画面の横に並ぶ。
        rotated = true;
        // ステージを画面(縦横入替)に内接させたときの「画面上の実寸」(横向き基準)
        let onW, onH;                     // onW=ステージ幅方向の実寸, onH=高さ方向の実寸
        if (vh / vw > LANDSCAPE_RATIO) { onW = vw; onH = Math.round(vw / LANDSCAPE_RATIO); }
        else { onW = vh; onH = Math.round(vh / LANDSCAPE_RATIO); }
        scale = onW / SW;                 // 論理幅 → 画面上の実寸
        dW = onH; dH = onW;               // デバイス空間でのフットプリント(回転後)
        dL = Math.round((vw - dW) / 2);
        dT = Math.round((vh - dH) / 2);
    }
}

// ── デバイス座標(clientX/Y, rect) → 論理ステージ座標 への変換 ──
// 非回転: ステージ左上を原点に平行移動するだけ。
// 回転(90° 時計回り, origin=top-left, translate(dL+dW, dT)):
//   論理(x,y) → デバイス(rx,ry) = (dL+dW - y, dT + x)
//   その逆写像が下式。
function toLocal(rx, ry) {
    if (!rotated) return { x: (rx - dL) / scale, y: (ry - dT) / scale };
    return { x: (ry - dT) / scale, y: ((dL + dW) - rx) / scale };
}

// ── window.innerWidth / innerHeight を論理ステージ寸法に上書き ──
function installSizeOverride() {
    try {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            get() { return active ? SW : realVW(); },
        });
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            get() { return active ? SH : realVH(); },
        });
    } catch (e) { /* 古い環境では諦めて素の値を使う */ }
}

// ── clientX/clientY を論理ステージ座標に補正(回転込み) ──
// 回転時は X が Y に依存するため、両軸のネイティブ値を読んで変換する。
function patchPointerProto(proto) {
    const dx = Object.getOwnPropertyDescriptor(proto, 'clientX');
    const dy = Object.getOwnPropertyDescriptor(proto, 'clientY');
    if (!dx || !dx.get || !dy || !dy.get) return;
    const getX = dx.get, getY = dy.get;
    Object.defineProperty(proto, 'clientX', {
        configurable: true,
        get() { return active ? toLocal(getX.call(this), getY.call(this)).x : getX.call(this); },
    });
    Object.defineProperty(proto, 'clientY', {
        configurable: true,
        get() { return active ? toLocal(getX.call(this), getY.call(this)).y : getY.call(this); },
    });
}

// ── getBoundingClientRect をステージ相対(回転込み)に補正 ──
function installRectPatch() {
    const native = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
        const r = native.call(this);
        if (!active) return r;
        if (!rotated) {
            if (dL === 0 && dT === 0 && scale === 1) return r;
            return {
                x: (r.x - dL) / scale, y: (r.y - dT) / scale,
                left: (r.left - dL) / scale, top: (r.top - dT) / scale,
                right: (r.right - dL) / scale, bottom: (r.bottom - dT) / scale,
                width: r.width / scale, height: r.height / scale,
                toJSON() { return this; },
            };
        }
        // 回転時: デバイス AABB の四隅を論理座標へ。90° なので軸整列は保たれる。
        // left/right は r.top/r.bottom 由来、top/bottom は r.right/r.left 由来になる。
        const left = (r.top - dT) / scale;
        const top = ((dL + dW) - r.right) / scale;
        const right = (r.bottom - dT) / scale;
        const bottom = ((dL + dW) - r.left) / scale;
        return {
            x: left, y: top, left, top, right, bottom,
            width: right - left, height: bottom - top,
            toJSON() { return this; },
        };
    };
}

function installPointerPatches() {
    patchPointerProto(MouseEvent.prototype);
    if (typeof Touch !== 'undefined' && Touch.prototype) {
        patchPointerProto(Touch.prototype);
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
    if (!active || (dL === 0 && dT === 0)) {
        Object.values(bars).forEach((d) => { d.style.display = 'none'; });
        return;
    }
    const vw = realVW(), vh = realVH();
    const set = (d, css) => { d.style.cssText = 'position:fixed;background:#000;z-index:2147483646;pointer-events:none;' + css; };
    set(bars.top,    `left:0;top:0;width:${vw}px;height:${dT}px;`);
    set(bars.bottom, `left:0;top:${dT + dH}px;width:${vw}px;height:${vh - dT - dH}px;`);
    set(bars.left,   `left:0;top:0;width:${dL}px;height:${vh}px;`);
    set(bars.right,  `left:${dL + dW}px;top:0;width:${vw - dL - dW}px;height:${vh}px;`);
}

function apply() {
    const app = document.getElementById('app');
    if (app) {
        if (active) {
            app.classList.add('is-mobile');
            // #app は常に「論理ステージ寸法(横長)」で配置する。
            app.style.position = 'absolute';
            app.style.width = `${SW}px`;
            app.style.height = `${SH}px`;
            app.style.overflow = 'hidden';
            if (rotated) {
                // 縦持ち: 左上原点で 90° 回転＋scale 縮小し、ステージ占有矩形へ平行移動。
                app.style.left = '0px';
                app.style.top = '0px';
                app.style.transformOrigin = 'top left';
                app.style.transform = `translate(${dL + dW}px, ${dT}px) rotate(90deg) scale(${scale})`;
            } else {
                // 横持ち: 左上原点で scale 縮小し、ステージ占有矩形へ配置。
                app.style.left = `${dL}px`;
                app.style.top = `${dT}px`;
                app.style.transformOrigin = 'top left';
                app.style.transform = `scale(${scale})`;
            }
        } else {
            app.classList.remove('is-mobile');
            app.style.position = '';
            app.style.left = '';
            app.style.top = '';
            app.style.width = '';
            app.style.height = '';
            app.style.overflow = '';
            app.style.transform = '';
            app.style.transformOrigin = '';
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

/** オーバーレイ類の追加先。ステージ(=#app)内に収めて回転/レターボックスに追従させる。 */
export function stageRoot() {
    return document.getElementById('app') || document.body;
}
