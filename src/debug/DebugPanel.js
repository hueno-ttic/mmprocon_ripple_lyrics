// ─────────────────────────────────────────────────────────────
// DEBUG PANEL — 開発専用。?debug=1 のときのみ main.js から動的読込される。
//
// 【削除方法】コンテスト提出前にこの2点を消すだけ:
//   1. このファイル(src/debug/DebugPanel.js)を削除
//   2. main.js の「DEBUG MODE」ブロック(数行)を削除
// ─────────────────────────────────────────────────────────────
import { NORMAL_SONGS, SECRET_SONGS } from '../config/songs.js';
import { appState } from '../core/appState.js';
import { eventBus } from '../core/eventBus.js';
import { quality } from '../core/quality.js';

export function initDebugPanel() {
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText = `
        position: fixed; top: 12px; left: 12px;
        z-index: 99999;
        background: rgba(20, 8, 8, 0.88);
        border: 1px solid rgba(255, 120, 120, 0.6);
        border-radius: 10px;
        padding: 10px 12px;
        font-family: monospace;
        font-size: 11px;
        color: #ffb0b0;
        display: flex; flex-direction: column; gap: 8px;
        max-width: 240px;
        backdrop-filter: blur(6px);
    `;

    // 進行は通常曲(5曲)基準。こたえて(シークレット)は別枠で扱う。
    const completed = NORMAL_SONGS.filter(s => appState.isSongComplete(s.id)).length;
    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <b style="letter-spacing:0.15em;">🛠 DEBUG</b>
            <span id="dbg-status">クリア ${completed}/${NORMAL_SONGS.length}・フェーズ ${appState.getPhaseName()}</span>
        </div>
        <div style="display:flex; gap:4px; flex-wrap:wrap;" id="dbg-set-row"></div>
        <div style="display:flex; gap:6px;">
            <button id="dbg-plus" style="${btnCss()}flex:1;">+1 クリア(遷移演出)</button>
        </div>
        <div style="display:flex; gap:6px;">
            <button id="dbg-onboarding" style="${btnCss()}flex:1;">オンボ再表示</button>
            <button id="dbg-reset" style="${btnCss()}flex:1;">全リセット</button>
        </div>
    `;
    document.body.appendChild(panel);

    function btnCss() {
        return `
            background: rgba(255,120,120,0.15);
            border: 1px solid rgba(255,120,120,0.5);
            border-radius: 6px; color: #ffd0d0;
            font-family: monospace; font-size: 11px;
            padding: 5px 8px; cursor: pointer;
        `;
    }

    // 通常曲のクリア数を 0〜5 に直接設定(確定的に再現するためリロード)。
    // n=5 で通常曲を全クリア=湖到達=こたえて解放の状態を再現できる。
    const setRow = panel.querySelector('#dbg-set-row');
    for (let n = 0; n <= NORMAL_SONGS.length; n++) {
        const b = document.createElement('button');
        b.textContent = String(n);
        b.style.cssText = btnCss() + 'width:26px; padding:5px 0;';
        if (n === completed) b.style.background = 'rgba(255,120,120,0.5)';
        b.title = `通常曲のクリア数を ${n} に設定してリロード`;
        b.addEventListener('click', () => {
            const ids = NORMAL_SONGS.slice(0, n).map(s => s.id);
            localStorage.setItem('completedSongs', JSON.stringify(ids));
            location.reload();
        });
        setRow.appendChild(b);
    }

    function refreshStatus() {
        const c = NORMAL_SONGS.filter(s => appState.isSongComplete(s.id)).length;
        panel.querySelector('#dbg-status').textContent =
            `クリア ${c}/${NORMAL_SONGS.length}・フェーズ ${appState.getPhaseName()}`;
        setRow.querySelectorAll('button').forEach((b, i) => {
            b.style.background = i === c ? 'rgba(255,120,120,0.5)' : 'rgba(255,120,120,0.15)';
        });
    }

    // 次の未クリア曲を1曲クリア扱いにし、フェーズ遷移演出を再生する。
    // 通常曲を優先し、全て終えていればシークレット曲(こたえて)を消化する。
    panel.querySelector('#dbg-plus').addEventListener('click', () => {
        const order = [...NORMAL_SONGS, ...SECRET_SONGS];
        const next = order.find(s => !appState.isSongComplete(s.id));
        if (!next) return;
        appState.markSongComplete(next.id);
        eventBus.emit('songComplete', next.id);
        // backToLake 経由で WorldUI.show() → フェーズ遷移チェックが走る
        eventBus.emit('backToLake');
        refreshStatus();
    });

    panel.querySelector('#dbg-onboarding').addEventListener('click', () => {
        localStorage.removeItem('worldOnboardingShown');
        location.reload();
    });

    panel.querySelector('#dbg-reset').addEventListener('click', () => {
        localStorage.clear();
        location.reload();
    });

    // 動作の重さを可視化するパフォーマンスHUD
    initPerfHud(panel);
}

// ─────────────────────────────────────────────────────────────
// PERF HUD — FPS / フレーム時間 / 描画統計をリアルタイム表示。
// 「どれくらい重いのか」を数値とグラフで可視化する。
// アクティブなレンダラー(選曲ハブ or 再生中の曲)を自動で追従する。
// ─────────────────────────────────────────────────────────────
function initPerfHud(panel) {
    const hud = document.createElement('div');
    hud.style.cssText = `
        border-top: 1px solid rgba(255,120,120,0.3);
        padding-top: 8px; display: flex; flex-direction: column; gap: 6px;
    `;
    hud.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <b style="letter-spacing:0.12em;">📊 PERF</b>
            <span><b id="phud-fps" style="font-size:18px;">--</b><span style="opacity:0.7;"> fps</span></span>
        </div>
        <canvas id="phud-graph" width="216" height="36"
                style="width:100%; height:36px; background:rgba(0,0,0,0.35); border-radius:4px; display:block;"></canvas>
        <div id="phud-stats" style="line-height:1.55; font-size:10px; color:#ffd6d6;"></div>
        <div style="display:flex; gap:4px; align-items:center;">
            <span style="opacity:0.6; font-size:10px;">画質:</span>
            <button data-pr="auto" style="${perfBtnCss()}">auto</button>
            <button data-pr="0.75" style="${perfBtnCss()}">.75</button>
            <button data-pr="1" style="${perfBtnCss()}">1.0</button>
            <button data-pr="1.25" style="${perfBtnCss()}">1.25</button>
            <button data-pr="1.5" style="${perfBtnCss()}">1.5</button>
        </div>
    `;
    panel.appendChild(hud);

    const fpsEl = hud.querySelector('#phud-fps');
    const statsEl = hud.querySelector('#phud-stats');
    const canvas = hud.querySelector('#phud-graph');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    // アクティブなレンダラーを取得(再生中の曲を優先、なければ選曲ハブ)
    const activeRenderer = () => {
        const app = window.app;
        if (!app) return null;
        if (app.currentSongScene && app.currentSongScene.renderer) return app.currentSongScene.renderer;
        if (app.lakeUI && app.lakeUI.renderer) return app.lakeUI.renderer;
        return null;
    };

    // 画質ライブ切替: その場でpixelRatioを変えてFPS変化を体感できる。
    // 手動固定すると自動調整は止まる。autoで自動調整に戻す。
    // 実際の反映は各レンダラーの maybeApply(毎フレーム)が拾う。
    hud.querySelectorAll('button[data-pr]').forEach(b => {
        b.addEventListener('click', () => {
            if (b.dataset.pr === 'auto') {
                quality.clearManual();
            } else {
                quality.setManualPixelRatio(parseFloat(b.dataset.pr));
            }
            hud.querySelectorAll('button[data-pr]').forEach(x =>
                x.style.background = x === b ? 'rgba(255,120,120,0.5)' : 'rgba(255,120,120,0.15)');
        });
    });

    const N = W;                       // グラフ1px=1フレーム
    const frames = new Float32Array(N);
    let head = 0, filled = 0;
    let last = performance.now();
    let acc = 0, accFrames = 0, fpsSmoothed = 60;
    let lastDomUpdate = 0;

    const TARGET_MS = 1000 / 60;       // 緑/黄/赤の閾値基準(60fps)

    function loop(now) {
        const dt = now - last;
        last = now;

        // 異常値(タブ非アクティブ復帰など)はグラフを汚すので除外
        if (dt > 0 && dt < 1000) {
            frames[head] = dt;
            head = (head + 1) % N;
            if (filled < N) filled++;
            acc += dt; accFrames++;
            // 指数移動平均でちらつきを抑えた表示用FPS
            fpsSmoothed += (1000 / dt - fpsSmoothed) * 0.1;
        }

        if (now - lastDomUpdate > 250) {
            lastDomUpdate = now;
            updateReadout(now);
            drawGraph();
        }
        requestAnimationFrame(loop);
    }

    function percentileLow(p) {
        // 1% low = 遅い方からp%の位置のFPS(= 大きいフレーム時間)。カクつきの指標。
        const n = filled;
        if (n < 5) return null;
        const arr = Array.prototype.slice.call(frames, 0, n).sort((a, b) => b - a);
        const idx = Math.min(n - 1, Math.floor(n * p));
        return 1000 / arr[idx];
    }

    function updateReadout(now) {
        const avgFps = accFrames > 0 ? (accFrames * 1000 / acc) : null;
        acc = 0; accFrames = 0;
        const low1 = percentileLow(0.01);
        const fps = Math.round(fpsSmoothed);

        fpsEl.textContent = String(fps);
        fpsEl.style.color = fps >= 50 ? '#7fff9f' : fps >= 30 ? '#ffd86b' : '#ff7676';

        const r = activeRenderer();
        const lines = [];
        lines.push(`<span style="opacity:0.65;">avg</span> ${avgFps != null ? avgFps.toFixed(0) : '--'}  `
                 + `<span style="opacity:0.65;">1%low</span> ${low1 ? low1.toFixed(0) : '--'}  `
                 + `<span style="opacity:0.65;">ms</span> ${(1000 / Math.max(1, fpsSmoothed)).toFixed(1)}`);
        // 自動品質調整の状態(ティア / 実効解像度倍率 / 監視FPS)
        lines.push(`<span style="opacity:0.65;">品質</span> <b>${quality.tier.name}</b>`
                 + (quality.auto ? ` <span style="color:#ffd86b;">↓auto×${quality.runtimeScale.toFixed(2)}</span>` : '')
                 + `  <span style="opacity:0.65;">epr</span> ${quality.effectivePixelRatio().toFixed(2)}`);

        if (r && r.info) {
            const ri = r.info.render, rm = r.info.memory;
            lines.push(`<span style="opacity:0.65;">draws</span> ${ri.calls}  `
                     + `<span style="opacity:0.65;">tris</span> ${formatK(ri.triangles)}`);
            lines.push(`<span style="opacity:0.65;">geo</span> ${rm.geometries}  `
                     + `<span style="opacity:0.65;">tex</span> ${rm.textures}  `
                     + `<span style="opacity:0.65;">prog</span> ${r.info.programs ? r.info.programs.length : '?'}`);
            const c = r.domElement;
            lines.push(`<span style="opacity:0.65;">res</span> ${c.width}×${c.height}  `
                     + `<span style="opacity:0.65;">pr</span> ${r.getPixelRatio().toFixed(2)}/dpr${window.devicePixelRatio}`);
            const scene = r.info.memory && window.app
                ? (window.app.currentSongScene ? '曲' : 'ハブ') : '';
            if (scene) lines[lines.length - 1] += `  <span style="opacity:0.65;">@</span>${scene}`;
        } else {
            lines.push('<span style="opacity:0.5;">renderer待機中…</span>');
        }

        const mem = performance.memory;
        if (mem) {
            lines.push(`<span style="opacity:0.65;">heap</span> `
                     + `${(mem.usedJSHeapSize / 1048576).toFixed(0)}/`
                     + `${(mem.jsHeapSizeLimit / 1048576).toFixed(0)}MB`);
        }
        statsEl.innerHTML = lines.join('<br>');
    }

    function drawGraph() {
        ctx.clearRect(0, 0, W, H);
        // 60fps(16.7ms)と30fps(33.3ms)の基準線
        const msToY = ms => H - Math.min(H, (ms / 50) * H); // 0〜50msを縦軸にマップ
        ctx.strokeStyle = 'rgba(127,255,159,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, msToY(TARGET_MS)); ctx.lineTo(W, msToY(TARGET_MS)); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,216,107,0.3)';
        ctx.beginPath(); ctx.moveTo(0, msToY(33.3)); ctx.lineTo(W, msToY(33.3)); ctx.stroke();

        // フレーム時間バー(古い→新しい、左→右)。閾値で色分け
        for (let i = 0; i < filled; i++) {
            const idx = (head - filled + i + N * 2) % N;
            const ms = frames[idx];
            const x = i;
            const y = msToY(ms);
            ctx.strokeStyle = ms <= 20 ? 'rgba(127,255,159,0.85)'
                            : ms <= 33.3 ? 'rgba(255,216,107,0.85)'
                            : 'rgba(255,118,118,0.9)';
            ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x, y); ctx.stroke();
        }
    }

    function formatK(n) {
        return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M'
             : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
    }

    requestAnimationFrame(loop);
}

function perfBtnCss() {
    return `background: rgba(255,120,120,0.15); border: 1px solid rgba(255,120,120,0.4);
            border-radius: 4px; color: #ffd0d0; font-family: monospace; font-size: 10px;
            padding: 3px 5px; cursor: pointer; flex:1;`;
}
