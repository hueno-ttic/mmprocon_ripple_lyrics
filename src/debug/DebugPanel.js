// ─────────────────────────────────────────────────────────────
// DEBUG PANEL — 開発専用。?debug=1 のときのみ main.js から動的読込される。
//
// 【削除方法】コンテスト提出前にこの2点を消すだけ:
//   1. このファイル(src/debug/DebugPanel.js)を削除
//   2. main.js の「DEBUG MODE」ブロック(数行)を削除
// ─────────────────────────────────────────────────────────────
import { SONGS } from '../config/songs.js';
import { appState } from '../core/appState.js';
import { eventBus } from '../core/eventBus.js';

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

    const completed = appState.completedSongs.length;
    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <b style="letter-spacing:0.15em;">🛠 DEBUG</b>
            <span id="dbg-status">クリア ${completed}/${SONGS.length}・フェーズ ${appState.getPhaseName()}</span>
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

    // クリア数を 0〜6 に直接設定(確定的に再現するためリロード)
    const setRow = panel.querySelector('#dbg-set-row');
    for (let n = 0; n <= SONGS.length; n++) {
        const b = document.createElement('button');
        b.textContent = String(n);
        b.style.cssText = btnCss() + 'width:26px; padding:5px 0;';
        if (n === completed) b.style.background = 'rgba(255,120,120,0.5)';
        b.title = `クリア数を ${n} に設定してリロード`;
        b.addEventListener('click', () => {
            const ids = SONGS.slice(0, n).map(s => s.id);
            localStorage.setItem('completedSongs', JSON.stringify(ids));
            location.reload();
        });
        setRow.appendChild(b);
    }

    function refreshStatus() {
        const c = appState.completedSongs.length;
        panel.querySelector('#dbg-status').textContent =
            `クリア ${c}/${SONGS.length}・フェーズ ${appState.getPhaseName()}`;
        setRow.querySelectorAll('button').forEach((b, i) => {
            b.style.background = i === c ? 'rgba(255,120,120,0.5)' : 'rgba(255,120,120,0.15)';
        });
    }

    // 次の未クリア曲を1曲クリア扱いにし、フェーズ遷移演出を再生する
    panel.querySelector('#dbg-plus').addEventListener('click', () => {
        const next = SONGS.find(s => !appState.isSongComplete(s.id));
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
}
