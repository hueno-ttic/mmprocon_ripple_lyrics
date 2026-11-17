// Web Audio の解錠(iOS Safari 等はユーザー操作内で AudioContext を resume する必要がある)。
// 以前は押下のたびに使い捨ての AudioContext を new して close せず、端末の同時生成上限
// (Chrome/Safari は概ね数個)に近づいてリークしていた。解錠用の文脈はアプリ全体で1つだけ
// 遅延生成して使い回し、以後は resume() するだけにする。
import { playerManager } from './player.js';

let sharedCtx = null;

export function unlockAudio() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !sharedCtx) sharedCtx = new AC();
        if (sharedCtx && sharedCtx.state === 'suspended') {
            const p = sharedCtx.resume();
            // 解錠できたら止めておく(音を出さない文脈を鳴らしっぱなしにするとノイズフロアが残る。
            // sfx/bgm が鳴っていない間 suspend しているのと同じ理由)
            if (p && p.then) p.then(() => { sharedCtx.suspend().catch(() => {}); }, () => { /* ジェスチャ外などで失敗しても無害 */ });
        }
        const ctx = playerManager.player && playerManager.player.audioContext;
        if (ctx && ctx.state === 'suspended') {
            const p = ctx.resume();
            if (p && p.catch) p.catch(() => {});
        }
    } catch (err) {
        console.warn('[Ripple Lyrics] Web Audio unlock failed safely: ', err);
    }
}
