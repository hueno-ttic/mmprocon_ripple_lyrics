// デザイン検討用スクショ一括取得スクリプト
// 使い方: dev server (npm run dev) を起動した状態で
//   node design/capture-screens.mjs            (既定 http://localhost:5176)
//   BASE=http://localhost:5173 node design/capture-screens.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const BASE = process.env.BASE || 'http://localhost:5176';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
const VW = 1280, VH = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SONGS = [
  { label: 'こたえて', file: '06-song-kotaete', seek: 45000, tutorial: '05-song-tutorial' },
  { label: 'アフター・ザ・カーテン', file: '07-song-after', seek: 20000 },
  { label: 'シャッターチャンス', file: '08-song-shutter', seek: 28000 },
  { label: '世界最後の音楽隊', file: '09-song-orchestra', seek: 15000 },
  { label: 'トリツクロジー', file: '10-song-tricktology', seek: 32000 },
  { label: 'TAKEOVER', file: '11-song-takeover', seek: 26000 },
];

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p });
  console.log('  saved', path.relative(process.cwd(), p));
}

async function enterLake(page) {
  // 新規ユーザー(晴れフェーズ・0/6)の状態に揃える
  await page.goto(BASE + '/');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(BASE + '/');
  await sleep(3200);                 // タイトルのフェードイン待ち
  await shot(page, '01-title');
  await page.mouse.click(VW / 2, VH / 2); // タイトル → プロローグ
  await sleep(1600);
  await shot(page, '02-prologue');
  // プロローグをスキップ
  const skip = page.locator('button', { hasText: '曲を選ぶ' });
  if (await skip.count()) await skip.first().click({ force: true });
  await sleep(1800);
  await shot(page, '03-lake-onboarding'); // 初回ガイドカード
  // ガイドを閉じる
  await page.mouse.click(VW / 2, VH - 40);
  await sleep(800);
  await page.mouse.move(VW / 2, VH / 2); // 音量スライダーを畳む
  await sleep(600);
  await shot(page, '04-lake-selection');
  // 曲をフォーカスして選曲パネル(「この曲をはじめる」CTA)を出した状態
  const focus = page.locator('.song-label', { hasText: 'こたえて' });
  if (await focus.count()) {
    await focus.first().evaluate((el) => el.click());
    await sleep(1800);
    await page.mouse.move(VW / 2, VH / 2);
    await sleep(400);
    await shot(page, '04b-lake-selection-focused');
  }
}

async function selectSong(page, title) {
  const label = page.locator('.song-label', { hasText: title });
  await label.first().evaluate((el) => el.click()); // 回転
  await sleep(1800);
  await label.first().evaluate((el) => el.click()); // ロード
}

async function waitLoad(page) {
  await sleep(2000);
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 45000 }).catch(() => {});
  await sleep(1000);
}

async function captureSong(page, song) {
  console.log('song:', song.label);
  await selectSong(page, song.label);
  await waitLoad(page);
  // チュートリアルモーダル
  const start = page.locator('button', { hasText: 'スタート' });
  if (await start.count()) {
    if (song.tutorial) await shot(page, song.tutorial);
    await start.first().click({ force: true });
    await sleep(800);
  }
  // 再生してイントロをスキップ
  const play = page.locator('#play-pause-btn');
  for (let i = 0; i < 3; i++) {
    const playing = await page.evaluate(() => {
      const pm = window.app && window.app.playerManager;
      return !!(pm && pm.player && pm.player.isPlaying);
    });
    if (playing) break;
    if (await play.count()) await play.first().evaluate((b) => b.click());
    await sleep(1200);
  }
  await page.evaluate((ms) => {
    const pm = window.app && window.app.playerManager;
    if (pm && pm.player) pm.player.requestMediaSeek(ms);
  }, song.seek);
  await sleep(3000);
  await page.mouse.move(VW / 2, VH / 2);
  await shot(page, song.file);
  // 湖へ戻る
  const back = page.locator('#back-to-lake');
  if (await back.count()) await back.first().click({ force: true });
  await sleep(2200);
}

(async () => {
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

  console.log('capturing to', OUT);
  await enterLake(page);
  for (const song of SONGS) {
    try {
      await captureSong(page, song);
    } catch (e) {
      console.log('  ! failed', song.label, e.message);
      // 次の曲のため湖へ戻れているか確認できないので一度リロード
      await enterLake(page).catch(() => {});
    }
  }
  await browser.close();
  console.log('done');
})();
