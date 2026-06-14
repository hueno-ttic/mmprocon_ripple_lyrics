// ミクのダンス検証: 再生中のkotaeteを録画(webm)＋連番PNG＋VRMボーン数値の時系列サンプリング
// 使い方: dev server 起動状態で  node design/capture-dance.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const BASE = process.env.BASE || 'http://localhost:5176';
const LABEL = process.env.LABEL || 'dance';
const SONG = process.env.SONG || 'こたえて';
const LIGHT = process.env.LIGHT === '1'; // 撮影中マウスを動かしスポットを当て続ける(after用)
const SEEK_OVERRIDE = process.env.SEEK ? parseInt(process.env.SEEK, 10) : null;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), LABEL);
const VW = 1280, VH = 800;
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function enterLake(page) {
  await page.goto(BASE + '/');
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(BASE + '/');
  await sleep(3200);
  await page.mouse.click(VW / 2, VH / 2);
  await sleep(1600);
  const skip = page.locator('button', { hasText: '曲を選ぶ' });
  if (await skip.count()) await skip.first().click({ force: true });
  await sleep(1800);
  await page.mouse.click(VW / 2, VH - 40); // ガイドを閉じる
  await sleep(800);
}

async function selectSong(page, title) {
  const label = page.locator('.song-label', { hasText: title });
  await label.first().evaluate((el) => el.click());
  await sleep(1800);
  await label.first().evaluate((el) => el.click());
}

(async () => {
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: OUT, size: { width: VW, height: VH } },
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

  console.log('entering lake...');
  await enterLake(page);
  console.log('selecting', SONG, '...');
  await selectSong(page, SONG);
  await sleep(2500);
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 45000 }).catch(() => {});
  await sleep(1000);

  // チュートリアル「スタート」
  const start = page.locator('button', { hasText: 'スタート' });
  if (await start.count()) { await start.first().click({ force: true }); await sleep(800); }

  // 再生開始
  const play = page.locator('#play-pause-btn');
  for (let i = 0; i < 4; i++) {
    const playing = await page.evaluate(() => {
      const pm = window.playerManager;
      return !!(pm && pm.player && pm.player.isPlaying);
    });
    if (playing) break;
    if (await play.count()) await play.first().evaluate((b) => b.click());
    await sleep(1200);
  }

  // ビート/サビデータの存在確認 + サビ開始時刻を探す
  const probe = await page.evaluate(() => {
    const pm = window.playerManager;
    const p = pm && pm.player;
    if (!p) return { ok: false };
    const dur = (p.video && p.video.duration) || 0;
    let firstChorus = null, beatCount = 0;
    for (let t = 0; t < dur; t += 250) {
      if (p.findBeat && p.findBeat(t)) beatCount++;
      if (!firstChorus && p.findChorus && p.findChorus(t)) firstChorus = t;
    }
    return { ok: true, dur, beatCount, firstChorus, hasFindBeat: typeof p.findBeat === 'function' };
  });
  console.log('probe:', JSON.stringify(probe));

  // SEEK指定があれば最優先。なければサビ頭の少し後へ(グルーヴが最も効く区間)
  const seekTo = SEEK_OVERRIDE != null
    ? SEEK_OVERRIDE
    : (probe.firstChorus != null ? probe.firstChorus + 800 : 45000);
  await page.evaluate((ms) => {
    const pm = window.playerManager;
    if (pm && pm.player) pm.player.requestMediaSeek(ms);
  }, seekTo);
  await sleep(2500);
  console.log('recording dance from', seekTo, 'ms ...');

  // 8秒間, 約20Hzでボーン数値をサンプリング + 約3.3Hzでフレーム保存
  const samples = [];
  const N = 160; // 8s / 50ms
  for (let i = 0; i < N; i++) {
    const s = await page.evaluate(() => {
      const app = window.app;
      const sc = app && app.currentSongScene;
      const pm = window.playerManager;
      const p = pm && pm.player;
      const vrm = sc && (sc.currentVRM || sc.mikuVRM);
      if (!sc || !vrm || !p) return null;
      const h = vrm.humanoid;
      const b = (n) => { const node = h && h.getNormalizedBoneNode(n); return node ? node.rotation : null; };
      const pos = vrm.scene.position;
      const t = (p.timer && p.timer.position) || 0;
      const beat = p.findBeat ? p.findBeat(t) : null;
      let beatPulse = 0;
      if (beat && beat.duration > 0) {
        const pr = Math.min(1, Math.max(0, (t - beat.startTime) / beat.duration));
        beatPulse = Math.pow(1 - pr, 2.2);
      }
      const hips = b('hips'), spine = b('spine'), chest = b('upperChest') || b('chest');
      const head = b('head'), lleg = b('leftUpperLeg'), lknee = b('leftLowerLeg');
      return {
        t,
        beatPulse,
        beatPos: beat ? beat.position : null,
        climax: !!sc.isClimax,
        roty: +vrm.scene.rotation.y.toFixed(3), // 0=正面, π=背中
        cy: +vrm.scene.position.y.toFixed(4),   // モデルの絶対Y(縦ノリ確認用)
        move: sc._danceMove ?? null,            // 振付けの型(コード進行で切替)
        chord: sc._chordName ?? null,
        groove: sc._groove ?? null,
        sway: sc._swayCur ?? null,
        // モデル全体の平行移動
        px: +pos.x.toFixed(4), py: +pos.y.toFixed(4), pz: +pos.z.toFixed(4),
        // 胴体ボーン回転(rad)
        hipsZ: hips ? +hips.z.toFixed(4) : null,
        spineX: spine ? +spine.x.toFixed(4) : null,
        spineZ: spine ? +spine.z.toFixed(4) : null,
        chestX: chest ? +chest.x.toFixed(4) : null,
        headX: head ? +head.x.toFixed(4) : null,
        headZ: head ? +head.z.toFixed(4) : null,
        // 脚(動いているか検証用)
        llegX: lleg ? +lleg.x.toFixed(4) : null,
        lkneeX: lknee ? +lknee.x.toFixed(4) : null,
      };
    });
    if (s) samples.push(s);
    if (process.env.ZOOM) {
      const z = parseFloat(process.env.ZOOM);
      await page.evaluate((zv) => { const sc = window.app && window.app.currentSongScene; if (sc) sc.targetZoom = zv; }, z);
    }
    if (process.env.ORBIT_AZ || process.env.ORBIT_EL) {
      const az = parseFloat(process.env.ORBIT_AZ || '0'), el = parseFloat(process.env.ORBIT_EL || '0');
      await page.evaluate((v) => { const sc = window.app && window.app.currentSongScene; if (sc && sc.targetCameraRotation) sc.targetCameraRotation.set(v.el, v.az); }, { az, el });
    }
    if (LIGHT && i % 4 === 0) {
      // スポットライトをミク(画面中央やや上)付近で緩く動かして照らし続ける
      const mx = VW / 2 + Math.sin(i * 0.2) * 80;
      const my = VH * 0.42 + Math.cos(i * 0.15) * 40;
      await page.mouse.move(mx, my);
    }
    if (i % 6 === 0) {
      await page.screenshot({ path: path.join(OUT, 'frames', `f${String(i).padStart(3, '0')}.png`) });
    }
    await sleep(50);
  }

  fs.writeFileSync(path.join(OUT, 'samples.json'), JSON.stringify({ probe, seekTo, samples }, null, 2));
  console.log('samples:', samples.length, '-> design/dance/samples.json');

  await context.close(); // 動画を確定
  await browser.close();

  // 動画ファイル名を分かりやすくリネーム
  const vids = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm'));
  if (vids.length) {
    fs.renameSync(path.join(OUT, vids[0]), path.join(OUT, 'dance.webm'));
    console.log('video -> design/dance/dance.webm');
  }
  console.log('done');
})();
