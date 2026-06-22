/**
 * 忠実ドライバ: タイトル→湖→各曲(チュートリアル「スタート」)→再生 を実際に踏破して撮影する。
 * window.app.lakeUI.selectSong と .song-tutorial-btn を使い、実UIの導線通りに全6曲を再生する。
 * 実行: APP_URL=... EVAL_OUT=... node eval_drive.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const OUT = process.env.EVAL_OUT || path.join('eval_output', 'latest');
const DRIVE = path.join(OUT, 'drive');
fs.mkdirSync(DRIVE, { recursive: true });

const SONGS = [
  { id: 'kotaete', title: 'こたえて' },
  { id: 'after', title: 'アフター・ザ・カーテン' },
  { id: 'shutter', title: 'シャッターチャンス' },
  { id: 'orchestra', title: '世界最後の音楽隊' },
  { id: 'tricktology', title: 'トリツクロジー' },
  { id: 'takeover', title: 'TAKEOVER' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, name) {
  const p = path.join(DRIVE, name + '.png');
  try { await page.screenshot({ path: p, timeout: 8000 }); process.stdout.write(`  📸 ${name}\n`); }
  catch (e) { try { await page.screenshot({ path: p, timeout: 8000, animations: 'disabled' }); process.stdout.write(`  📸 ${name} (retry)\n`); } catch (_) { process.stdout.write(`  ⚠ ${name} 撮影失敗\n`); } }
}

async function canvasSig(page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const w = c.width, h = c.height;
    if (!w || !h) return null;
    const pts = [[.2,.25],[.5,.25],[.8,.25],[.2,.5],[.5,.5],[.8,.5],[.2,.75],[.5,.75],[.8,.75]];
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    let v = [];
    if (gl) { for (const [px,py] of pts){ const b=new Uint8Array(4); gl.readPixels(Math.floor(w*px),Math.floor(h*(1-py)),1,1,gl.RGBA,gl.UNSIGNED_BYTE,b); v.push(b[0],b[1],b[2],b[3]); } }
    else { const x=c.getContext('2d'); if(!x) return {hash:'2d?',nonEmpty:true}; for(const [px,py] of pts){ const d=x.getImageData(Math.floor(w*px),Math.floor(h*py),1,1).data; v.push(d[0],d[1],d[2],d[3]); } }
    return { hash: v.join(','), nonEmpty: v.reduce((a,b)=>a+b,0) > 30 };
  }).catch(() => null);
}

async function state(page) {
  return page.evaluate(() => ({
    isPlaying: !!(window.appState && window.appState.isPlaying),
    currentTime: (window.appState && window.appState.currentTime) || 0,
    currentSongId: (window.appState && window.appState.currentSongId) || null,
    hasLakeUI: !!(window.app && window.app.lakeUI),
    canvases: document.querySelectorAll('canvas').length,
    songTitle: (document.getElementById('song-title') || {}).innerText || '',
    tutorialActive: !!(window.app && window.app.currentSongScene && window.app.currentSongScene.isTutorialActive),
    bodyText: (document.body.innerText || '').slice(0, 400),
  })).catch(() => ({}));
}

async function enterLake(page) {
  await page.goto(APP_URL + '?skipIntro=1', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  // タイトルのクリックリスナーは ~2.5s 後に付く
  await sleep(3000);
  await page.mouse.click(640, 400).catch(() => {});
  // 湖(WorldUI)生成を待つ
  for (let i = 0; i < 40; i++) {
    const s = await state(page);
    if (s.hasLakeUI && s.canvases > 0) return true;
    await sleep(400);
  }
  return false;
}

async function startSong(page, index) {
  const ok = await page.evaluate(async (i) => {
    try {
      const mod = await import('/src/config/songs.js');
      const SONGS = mod.SONGS;
      if (window.app && window.app.lakeUI && SONGS && SONGS[i]) {
        window.app.lakeUI.selectSong(SONGS[i], i);
        return true;
      }
    } catch (e) { return 'err:' + e.message; }
    return false;
  }, index).catch(e => 'evalerr:' + e.message);
  return ok;
}

async function dismissTutorial(page) {
  for (let i = 0; i < 40; i++) {
    const found = await page.evaluate(() => {
      const btn = document.querySelector('.song-tutorial-btn');
      return !!btn;
    }).catch(() => false);
    if (found) return true;
    await sleep(400);
  }
  return false;
}

async function main() {
  const report = { url: APP_URL, songs: [], notes: [] };
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required',
      '--enable-webgl','--use-gl=swiftshader','--ignore-gpu-blocklist','--font-render-hinting=none'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0,160)); });

  try {
    for (let i = 0; i < SONGS.length; i++) {
      const song = SONGS[i];
      console.log(`\n=== [${i+1}/6] ${song.title} ===`);
      const errBefore = errs.length;
      const s = { id: song.id, title: song.title };

      const inLake = await enterLake(page);
      s.enteredLake = inLake;
      if (i === 0) await shot(page, '00_lake_world');
      if (!inLake) { s.note = '湖に到達できず'; report.songs.push(s); continue; }

      const sel = await startSong(page, i);
      s.selectResult = sel;
      await sleep(1500);

      const hadTut = await dismissTutorial(page);
      s.tutorialShown = hadTut;
      if (hadTut) {
        await sleep(300);
        await shot(page, `song_${i+1}_${song.id}_tutorial`);
        await page.click('.song-tutorial-btn', { timeout: 5000 }).catch(() => {});
      } else {
        // チュートリアルが出ない曲もありうる: 念のため中央クリック
        await page.mouse.click(640, 400).catch(() => {});
      }

      // shutter は再生開始直前に被写体セレクト(.shutter-cast-btn)が出る。
      // 未選択だと _autoStartPlayback が曲を始めず time が 0 のままになるため miku を選ぶ。
      if (song.id === 'shutter') {
        let casted = false;
        for (let t = 0; t < 30; t++) {
          const btn = await page.$('.shutter-cast-btn[data-key="miku"]');
          if (btn) { await btn.click().catch(() => {}); casted = true; break; }
          await sleep(200);
        }
        s.castSelected = casted;
        await sleep(800);
      }

      await sleep(2200);
      const st0 = await state(page);
      const sig0 = await canvasSig(page);
      await shot(page, `song_${i+1}_${song.id}_f0_start`);

      // マウス操作でcanvasが変化するか
      const pathPts = [[300,300],[500,250],[700,300],[900,400],[640,400],[400,500],[200,400],[1000,600],[640,300]];
      let prev = null, changes = 0;
      for (const [x,y] of pathPts) { await page.mouse.move(x,y); await sleep(140); const sg = await canvasSig(page); if (sg && prev && sg.hash !== prev.hash) changes++; prev = sg; }
      s.mouseInteraction = changes;
      await shot(page, `song_${i+1}_${song.id}_f1_mouse`);

      await sleep(3000);
      const st2 = await state(page);
      await shot(page, `song_${i+1}_${song.id}_f2_3sec`);

      await page.mouse.click(640, 400); await sleep(500);
      await page.mouse.click(400, 350); await sleep(500);
      await shot(page, `song_${i+1}_${song.id}_f3_click`);

      await sleep(4500);
      const st5 = await state(page);
      const sig5 = await canvasSig(page);
      await shot(page, `song_${i+1}_${song.id}_f5_late`);

      s.playback = {
        isPlaying_f0: st0.isPlaying, isPlaying_f5: st5.isPlaying,
        time_f0: st0.currentTime, time_f2: st2.currentTime, time_f5: st5.currentTime,
        advanced: (st5.currentTime || 0) - (st0.currentTime || 0),
        songTitle: st5.songTitle, currentSongId: st5.currentSongId,
        canvases: st5.canvases,
      };
      s.canvasNonEmpty = !!(sig5 && sig5.nonEmpty);
      s.canvasChangedOverTime = !!(sig0 && sig5 && sig0.hash !== sig5.hash);
      s.errorsDuring = errs.length - errBefore;

      console.log(`  play:${st5.isPlaying?'▶':'⏸'} time ${Math.round(st0.currentTime)}→${Math.round(st5.currentTime)}ms (Δ${Math.round(s.playback.advanced)}) canvas:${s.canvasNonEmpty?'✓':'✗'} mouseΔ:${changes}/8 title:"${st5.songTitle}" err:${s.errorsDuring}`);
      report.songs.push(s);

      // 湖へ戻る(ESC)
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(2500);
    }

    // 全曲制覇エンディング確認
    console.log('\n=== エンディング(全曲制覇) ===');
    await page.goto(APP_URL + '?skipIntro=1', { waitUntil: 'networkidle' }).catch(() => {});
    // アプリ本体は localStorage 'completedSongs'(配列) を読む(src/core/appState.js:9)。
    await page.evaluate(() => {
      const done = ['kotaete','after','shutter','orchestra','tricktology','takeover'];
      localStorage.setItem('completedSongs', JSON.stringify(done));
    }).catch(() => {});
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await sleep(3000);
    // 本番演出と同じく湖の上にエンディングを重ねるため、まず湖UIの生成を待つ。
    await page.mouse.click(640, 400).catch(() => {});
    for (let i = 0; i < 40; i++) {
      const ready = await page.evaluate(
        () => !!(window.app && window.app.lakeUI) && document.querySelectorAll('canvas').length > 0
      ).catch(() => false);
      if (ready) break;
      await sleep(400);
    }
    await sleep(1000);
    // allSongsComplete は markSongComplete 内でしか発火せず、リロード起動時には再評価されない。
    // CompletionScreen を表示させるためイベントを明示的にemitする(src/main.js:202)。
    await page.evaluate(() => {
      if (window.eventBus) window.eventBus.emit('allSongsComplete');
    }).catch(() => {});
    // show()はemitの1200ms後、本文(湖になった/6つの問い)描画は更に700ms後。
    await sleep(4000);
    const endText = await page.evaluate(() => {
      const cs = document.getElementById('completion-screen');
      return ((cs && cs.innerText) || document.body.innerText || '').slice(0, 600);
    }).catch(() => '');
    report.endingText = endText;
    report.endingExists = /湖になった|6つの問い|湖のソナーレ|ソナーレ|完成|制覇|全曲|share|シェア|twitter|x（twitter）/i.test(endText);
    await shot(page, 'zz_ending_allcomplete');
    console.log('  endingExists:', report.endingExists, '|', endText.replace(/\n/g,' ').slice(0,200));

    report.totalErrors = errs.length;
    report.errors = errs.slice(0, 40);
    fs.writeFileSync(path.join(DRIVE, 'drive_report.json'), JSON.stringify(report, null, 2));
    console.log('\nDONE drive_report.json written. errors=' + errs.length);
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
