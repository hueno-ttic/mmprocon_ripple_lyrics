// README用「水の循環フェーズ背景」スクショ取得スクリプト
// 各フェーズ(晴れ→雲→雨→水たまり→小川→湖)は通常曲のクリア数で進む。
// 使い方: dev server 起動状態で
//   BASE=http://localhost:5173 node design/capture-phases.mjs
// 出力: docs/screenshots/ (README から参照・コミット対象)
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
const VW = 1280, VH = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NORMAL = ['shutter', 'after', 'orchestra', 'tricktology', 'takeover'];

// クリア数 → フェーズ
const PHASES = [
  { done: 0, file: 'phase-0-clear',   name: '晴れ' },
  { done: 1, file: 'phase-1-clouds',  name: '雲' },
  { done: 2, file: 'phase-2-rain',    name: '雨' },
  { done: 3, file: 'phase-3-puddles', name: '水たまり' },
  { done: 4, file: 'phase-4-stream',  name: '小川' },
  { done: 5, file: 'phase-5-lake',    name: '湖' },
];

// 背景の風景だけを写すため、選曲UI等のDOMを伏せる
const HIDE_CSS = `
  .world-selection-panel, .world-thumb-card, .song-label,
  .app-volume-control, .world-phase-indicator,
  .world-onboarding, .world-guide, .first-guide,
  #play-pause-btn, .player-controls { opacity: 0 !important; pointer-events: none !important; }
`;

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p });
  console.log('  saved', path.relative(process.cwd(), p));
}

async function capturePhase(page, phase) {
  await page.goto(BASE + '/');
  await page.evaluate((completed) => {
    try {
      localStorage.clear();
      localStorage.setItem('completedSongs', JSON.stringify(completed));
      localStorage.setItem('mm_seen_intro', '1');
    } catch (e) {}
  }, NORMAL.slice(0, phase.done));
  await page.goto(BASE + '/');
  await sleep(3000);
  await page.mouse.click(VW / 2, VH / 2);  // タイトル → 湖
  await sleep(2600);
  await page.mouse.click(VW / 2, VH - 40); // 初回ガイドを閉じる
  await sleep(800);
  await page.addStyleTag({ content: HIDE_CSS }); // UIを伏せて背景だけに
  await page.mouse.move(8, 8);
  await sleep(2400);                        // 雨/波などのアニメを馴染ませる
  console.log('phase:', phase.name, '(' + phase.done + ' done)');
  await shot(page, phase.file);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
  console.log('capturing to', OUT);
  for (const phase of PHASES) {
    try { await capturePhase(page, phase); }
    catch (e) { console.log('  ! failed', phase.name, e.message); }
  }
  await browser.close();
  console.log('done');
})();
