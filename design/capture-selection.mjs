// README用「各楽曲の選択画面」スクショ取得スクリプト
// 使い方: dev server 起動状態で
//   BASE=http://localhost:5176 node design/capture-selection.mjs
// 出力: docs/screenshots/ (README から参照・コミット対象)
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const BASE = process.env.BASE || 'http://localhost:5176';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
const VW = 1280, VH = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 5曲クリア済み = こたえて(シークレット)も湖に出現する状態
const COMPLETED = ['shutter', 'after', 'orchestra', 'tricktology', 'takeover'];

// タイトル(先頭一致) → 出力ファイル名
const TITLE_TO_FILE = [
  ['シャッターチャンス', 'select-shutter'],
  ['アフター',          'select-after'],
  ['世界最後の音楽隊',   'select-orchestra'],
  ['トリツクロジー',     'select-tricktology'],
  ['TAKEOVER',         'select-takeover'],
  ['こたえて',          'select-kotaete'],
];
function fileForTitle(title) {
  const t = (title || '').replace(/[✓\s]/g, '');
  for (const [key, file] of TITLE_TO_FILE) if (t.includes(key)) return file;
  return 'select-' + t.slice(0, 8);
}

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p });
  console.log('  saved', path.relative(process.cwd(), p));
}

async function enterLake(page) {
  await page.goto(BASE + '/');
  await page.evaluate((completed) => {
    try {
      localStorage.clear();
      localStorage.setItem('completedSongs', JSON.stringify(completed));
      localStorage.setItem('mm_seen_intro', '1'); // プロローグをスキップ
    } catch (e) {}
  }, COMPLETED);
  await page.goto(BASE + '/');
  await sleep(3200);
  // タイトル → 湖
  await page.mouse.click(VW / 2, VH / 2);
  await sleep(2400);
  // 初回ガイドカードが出ていれば閉じる
  await page.mouse.click(VW / 2, VH - 40);
  await sleep(700);
  await page.mouse.move(8, 8); // 音量スライダーを畳む
  await sleep(600);
}

async function currentTitle(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('.world-selection-title');
    return el ? el.textContent.trim() : '';
  });
}
async function nextSong(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('.world-nav-next');
    if (btn) btn.click();
  });
  await sleep(1900);
  await page.mouse.move(8, 8);
  await sleep(400);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

  console.log('capturing to', OUT);
  await enterLake(page);
  await shot(page, 'select-lake-overview'); // 湖の全景（フォーカス済みパネル付き）

  const seen = new Set();
  for (let i = 0; i < 8 && seen.size < 6; i++) {
    const title = await currentTitle(page);
    const file = fileForTitle(title);
    if (title && !seen.has(file)) {
      seen.add(file);
      console.log('focus:', title, '->', file);
      await shot(page, file);
    }
    await nextSong(page);
  }
  console.log('captured', seen.size, 'songs');
  await browser.close();
  console.log('done');
})();
