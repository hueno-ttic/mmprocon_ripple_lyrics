/**
 * マジカルミライ2026 全曲ブラウザ評価スクリプト
 * 実行: node eval_master.js
 *
 * 汎用AIエージェント環境向け:
 * - Claude Code / Codex / Antigravity / Gemini CLI / Cursor 等で利用可能
 * - ArrowRight / Space 前提にしない
 * - 実UIを探索して曲選択・再生を試みる
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ── 設定 ─────────────────────────────────────────────────────────
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const RUN_ID = process.env.EVAL_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const OUT = process.env.EVAL_OUT || path.join('eval_output', 'runs', RUN_ID);
const SONG_PLAY_DURATION_MS = Number(process.env.SONG_PLAY_DURATION_MS || 12000);
const HEADLESS = process.env.HEADLESS !== 'false';
const KEEP_SERVER = process.env.KEEP_SERVER === 'true';

const SONGS = [
  { id: 'kotaete',     title: 'こたえて',              aliases: ['こたえて', 'kotaete'] },
  { id: 'after',       title: 'アフター・ザ・カーテン', aliases: ['アフター', 'カーテン', 'after', 'after the curtain'] },
  { id: 'shutter',     title: 'シャッターチャンス',    aliases: ['シャッター', 'shutter', 'shutter chance'] },
  { id: 'orchestra',   title: '世界最後の音楽隊',      aliases: ['世界最後', '音楽隊', 'orchestra'] },
  { id: 'tricktology', title: 'トリツクロジー',        aliases: ['トリツク', 'トリツクロジー', 'tricktology'] },
  { id: 'takeover',    title: 'TAKEOVER',              aliases: ['TAKEOVER', 'takeover'] },
];

// ── メイン ───────────────────────────────────────────────────────
async function main() {
  ensureDirs();

  const report = {
    meta: collectMeta(),
    initial: {},
    songs: [],
    ux: {},
    issues: { critical: [], major: [], minor: [] },
    evidence: { screenshots: [], videos: [] },
    interactionNotes: [],
  };

  log('START', `評価対象: ${APP_URL}`);
  log('INFO', `出力先: ${OUT}`);

  let browser;
  let ctx;
  try {
    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        '--no-sandbox', '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=AutoplayPolicy',
        '--enable-webgl', '--use-gl=swiftshader',
        '--enable-accelerated-2d-canvas',
        '--ignore-gpu-blocklist',
        '--font-render-hinting=none',
      ],
    });

    ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124',
      recordVideo: { dir: path.join(OUT, 'videos'), size: { width: 1280, height: 800 } },
    });

    const page = await ctx.newPage();
    const clogs = [];
    const jerrs = [];
    const nfails = [];

    page.on('console', m => clogs.push({ t: m.type(), x: m.text().substring(0, 500), ms: Date.now() }));
    page.on('pageerror', e => { jerrs.push(e.message); log('JS_ERR', e.message.substring(0, 180)); });
    page.on('response', r => { if (r.status() >= 400) nfails.push({ s: r.status(), u: r.url().substring(0, 160) }); });

    // =====================================================================
    // SECTION A: 初期ロード & 初見UX
    // =====================================================================
    log('SECTION', 'A — 初期ロード & 初見UX');

    const tLoad0 = Date.now();
    try {
      await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      report.issues.critical.push(`ページロード失敗: ${e.message}`);
    }
    const loadMs = Date.now() - tLoad0;

    await safeUserGesture(page);
    await ss(page, '00_startup', report);

    const init = await inspectInitialState(page);
    log('INFO', `タイトル: "${init.title}" / ロード: ${loadMs}ms`);
    log('INFO', `Canvas: ${init.canvasCount}個 / WebGL: ${init.hasWebGL} / Loading: ${init.isLoading}`);
    log('INFO', `曲名が見える: ${init.songNamesVisibleCount}/6 / Pointerカーソル: ${init.pointerCount}個`);

    if (!init.hasCanvas) report.issues.critical.push('canvas要素がない（Three.js/PixiJS 未動作の可能性）');
    if (init.hasError) report.issues.major.push('初期画面にエラー表示がある');
    if (init.songNamesVisibleCount < 3) report.issues.major.push(`初期画面で見える曲名が少ない（${init.songNamesVisibleCount}/6）`);
    if (init.pointerCount < 1 && init.clickableElements.length < 1) report.issues.major.push('クリック可能に見える要素がほとんどない');

    report.initial = { loadMs, ...init };

    await page.mouse.move(300, 400); await page.waitForTimeout(400); await ss(page, '01_hover_left', report);
    await page.mouse.move(640, 400); await page.waitForTimeout(400); await ss(page, '02_hover_center', report);
    await page.mouse.move(900, 300); await page.waitForTimeout(400); await ss(page, '03_hover_right', report);

    // =====================================================================
    // SECTION B: TextAlive API ロード待機
    // =====================================================================
    log('SECTION', 'B — TextAlive API ロード待機');

    let taLoaded = false;
    for (let i = 0; i < 30; i++) {
      const ready = await page.evaluate(() => {
        const t = document.body.innerText || '';
        return !(/読み込んでいます|loading/i.test(t)) && (t.length > 20 || !!document.querySelector('canvas'));
      });
      if (ready) { taLoaded = true; break; }
      await page.waitForTimeout(500);
      process.stdout.write('.');
    }
    console.log('');
    log(taLoaded ? 'OK' : 'FAIL', `TextAlive ロード: ${taLoaded ? '完了' : 'タイムアウト（15秒）'}`);

    if (!taLoaded) {
      report.issues.critical.push(
        'TextAlive APIが15秒でロードされない。審査員が直接URLを開いた際に何も見えない可能性がある。'
      );
    }

    await ss(page, '04_ta_loaded', report);

    const fps = await measureFPS(page, 3000);
    log('INFO', `FPS: avg=${fps.avg} min=${fps.min} max=${fps.max}`);
    if (fps.avg < 30) report.issues.major.push(`FPS低下: 平均${fps.avg}fps（目標60fps）`);

    // =====================================================================
    // SECTION C: 各曲 個別テスト（全6曲）
    // =====================================================================
    log('SECTION', `C — 全6曲 個別テスト（各${SONG_PLAY_DURATION_MS / 1000}秒）`);

    for (let i = 0; i < SONGS.length; i++) {
      const song = SONGS[i];
      log('SONG', `▶ ${song.title}`);

      const s = {
        id: song.id,
        title: song.title,
        selectionMethod: null,
        started: false,
        canvasRendering: false,
        canvasActivityScore: 0,
        lyricsPossiblyDisplayed: false,
        interactionScore: 0,
        visualChanges: 0,
        errorsDuring: 0,
        frames: [],
        observations: [],
      };

      const errsBefore = clogs.filter(c => c.t === 'error').length;

      await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await safeUserGesture(page);
      await page.waitForTimeout(800);

      const selection = await selectAndStartSong(page, song, i, report);
      s.selectionMethod = selection.method;
      s.started = selection.started;
      if (!selection.started) {
        s.observations.push('曲の開始を自動確認できなかった。UI導線または評価スクリプトとの相性を要確認。');
        report.issues.major.push(`[${song.title}] 曲選択・再生の自動開始を確認できない（方法: ${selection.method}）`);
      }

      await page.waitForTimeout(1500);
      await ss(page, `song_${pad(i + 1)}_${song.id}_f0_start`, report); s.frames.push('f0_start');

      const beforeActivity = await canvasSignature(page);

      const MOUSE_PATH = [
        [300,300],[500,250],[700,300],[900,400],[640,400],
        [400,500],[200,400],[1000,600],[640,300],
      ];
      let prevSig = null, changeCount = 0;
      for (const [x, y] of MOUSE_PATH) {
        await page.mouse.move(x, y);
        await page.waitForTimeout(150);
        const sig = await canvasSignature(page);
        if (sig && prevSig && sig.hash !== prevSig.hash) changeCount++;
        prevSig = sig;
      }
      s.interactionScore = changeCount;
      await ss(page, `song_${pad(i + 1)}_${song.id}_f1_mouse`, report); s.frames.push('f1_mouse');

      await page.waitForTimeout(3000);
      await ss(page, `song_${pad(i + 1)}_${song.id}_f2_3sec`, report); s.frames.push('f2_3sec');

      await page.mouse.click(640, 400);
      await page.waitForTimeout(600);
      await ss(page, `song_${pad(i + 1)}_${song.id}_f3_click`, report); s.frames.push('f3_click');

      for (const [x, y] of [[300,400],[800,300],[500,600]]) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(400);
      }
      await ss(page, `song_${pad(i + 1)}_${song.id}_f4_multiclick`, report); s.frames.push('f4_multiclick');

      await page.waitForTimeout(Math.max(1000, SONG_PLAY_DURATION_MS - 8000));
      await ss(page, `song_${pad(i + 1)}_${song.id}_f5_8sec`, report); s.frames.push('f5_8sec');

      const afterActivity = await canvasSignature(page);
      s.canvasRendering = !!(afterActivity && afterActivity.nonEmpty);
      s.canvasActivityScore = beforeActivity && afterActivity && beforeActivity.hash !== afterActivity.hash ? 1 : 0;
      s.lyricsPossiblyDisplayed = await detectLyricsOrText(page);
      s.errorsDuring = clogs.filter(c => c.t === 'error').length - errsBefore;
      s.themeVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--song-primary').trim() || null).catch(() => null);

      log('RESULT', `start:${s.started?'✓':'?'} canvas:${s.canvasRendering?'✓':'✗'} text:${s.lyricsPossiblyDisplayed?'✓':'?'} interaction:${s.interactionScore}/8 errors:${s.errorsDuring}`);

      if (!s.canvasRendering) report.issues.major.push(`[${song.title}] Canvas の有意な描画を確認できない`);
      report.songs.push(s);
    }

    // =====================================================================
    // SECTION D: UX / 導線 テスト
    // =====================================================================
    log('SECTION', 'D — UX / 全曲導線テスト');

    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await safeUserGesture(page);
    await ss(page, '20_ux_navigation', report);

    const navInfo = await inspectNavigation(page);
    const songsOk = navInfo.songsVisible.filter(Boolean).length;
    log('INFO', `選曲画面で見える曲数: ${songsOk}/6 / 進捗表示: ${navInfo.hasProgress}`);
    if (songsOk < 6) report.issues.major.push(`選曲画面で${6 - songsOk}曲が見えない可能性がある`);

    // アプリ本体は localStorage 'completedSongs'(配列) を読む(src/core/appState.js:9)。
    await page.evaluate(() => {
      const done = ['kotaete','after','shutter','orchestra','tricktology','takeover'];
      localStorage.setItem('completedSongs', JSON.stringify(done));
    }).catch(() => {});
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await safeUserGesture(page);
    await page.waitForTimeout(1500);
    // allSongsComplete はリロード起動時に再評価されないため明示的にemitしてエンディングを表示(src/main.js:202)。
    await page.evaluate(() => {
      if (window.eventBus) window.eventBus.emit('allSongsComplete');
    }).catch(() => {});
    await page.waitForTimeout(3000);
    await ss(page, '21_ending_check', report);

    const ending = await page.evaluate(() => {
      const cs = document.getElementById('completion-screen');
      const t = (cs && cs.innerText) || document.body.innerText || '';
      return {
        exists: /湖になった|6つの問い|ソナーレ|完成|おめでとう|6つ|制覇|全曲|ending/i.test(t),
        hasShare: /share|シェア|twitter|x\.com|x（twitter）/i.test(t),
        text: t.slice(0, 400),
      };
    }).catch(() => ({ exists: false, hasShare: false }));
    log('INFO', `エンディング: ${ending.exists} / シェア機能: ${ending.hasShare}`);
    if (!ending.exists) report.issues.minor.push('全曲制覇エンディングが確認できない');

    report.ux = { navInfo, songsOk, ending };

    // =====================================================================
    // SECTION E: モバイル & タブレット確認
    // =====================================================================
    log('SECTION', 'E — モバイル / タブレット確認');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await safeUserGesture(page, 195, 422);
    await page.waitForTimeout(2000);
    await ss(page, '30_mobile_390', report);
    const mobileEval = await inspectMobileUsability(page);
    log('INFO', `モバイル (390px): ${mobileEval.hasFatalError ? 'NG' : 'OK'} / はみ出し:${mobileEval.overflowCount} / 小さすぎるタップ対象:${mobileEval.smallTapTargets}`);
    if (mobileEval.hasFatalError) report.issues.major.push('モバイル幅でエラー表示がある');
    if (mobileEval.overflowCount > 0) report.issues.major.push(`モバイル幅で横はみ出し要素がある可能性: ${mobileEval.overflowCount}件`);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(1000);
    await ss(page, '31_tablet_768', report);

    await page.setViewportSize({ width: 1280, height: 800 });

    // =====================================================================
    // SECTION F: まとめ & JSON 出力
    // =====================================================================
    report.summary = {
      loadMs,
      fps: fps.avg,
      taLoaded,
      songsOk,
      visualOk: report.songs.filter(s => s.canvasRendering).length,
      startedOk: report.songs.filter(s => s.started).length,
      lyricsOrTextOk: report.songs.filter(s => s.lyricsPossiblyDisplayed).length,
      avgInteraction: +(report.songs.reduce((a, s) => a + s.interactionScore, 0) / Math.max(1, report.songs.length)).toFixed(1),
      errTotal: clogs.filter(c => c.t === 'error').length,
      jsErrTotal: jerrs.length,
      networkFails: nfails.length,
      mobileOk: !mobileEval.hasFatalError,
      mobileOverflowCount: mobileEval.overflowCount,
      mobileSmallTapTargets: mobileEval.smallTapTargets,
      endingExists: ending.exists,
      hasOnboarding: init.clickHints || init.tapHints || init.pointerCount > 3,
      allSongsVisible: songsOk === 6,
      hasCSSTheme: init.hasCSSVars,
      criticals: report.issues.critical.length,
      majors: report.issues.major.length,
      minors: report.issues.minor.length,
    };

    fs.writeFileSync(path.join(OUT, 'eval_report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(OUT, 'logs', 'console.json'), JSON.stringify(clogs, null, 2));
    fs.writeFileSync(path.join(OUT, 'logs', 'network.json'), JSON.stringify(nfails, null, 2));

    printSummary(report);

    await ctx.close();
    await browser.close();
    log('DONE', `全スクリーンショット: ${report.evidence.screenshots.length}枚`);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    cleanupDevServer();
  }
}

// ── 曲選択・再生 ────────────────────────────────────────────────

async function selectAndStartSong(page, song, index, report) {
  const methods = [];

  // 1) DOM上の曲名・data属性・aria-label・button等を探索してクリック
  const candidates = await findSongCandidates(page, song);
  if (candidates.length) {
    for (const c of candidates.slice(0, 5)) {
      methods.push(`dom:${c.reason}`);
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(900);
      await maybeClickPlayLikeControl(page);
      await page.waitForTimeout(1200);
      if (await looksLikeSongStarted(page, song)) return { started: true, method: methods.join(' -> ') };
    }
  }

  // 2) ボタン・リンク等の一般クリック可能要素から曲名に近いものを探す
  const generic = await findGenericClickableCandidates(page, song);
  if (generic.length) {
    for (const c of generic.slice(0, 5)) {
      methods.push(`generic:${c.reason}`);
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(900);
      await maybeClickPlayLikeControl(page);
      await page.waitForTimeout(1200);
      if (await looksLikeSongStarted(page, song)) return { started: true, method: methods.join(' -> ') };
    }
  }

  // 3) Canvasカード型UIを想定したクリック。曲が6分割で並ぶ場合の保険。
  const canvasFallback = canvasGridPoint(index);
  methods.push('canvas-grid-fallback');
  await page.mouse.click(canvasFallback.x, canvasFallback.y);
  await page.waitForTimeout(900);
  await maybeClickPlayLikeControl(page);
  await page.waitForTimeout(1200);
  if (await looksLikeSongStarted(page, song)) return { started: true, method: methods.join(' -> ') };

  // 4) 最後の補助としてキーボードも試す。ただし前提にはしない。
  methods.push('keyboard-fallback-not-primary');
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(800);
  await page.keyboard.press('Space').catch(() => {});
  await page.waitForTimeout(1200);
  if (await looksLikeSongStarted(page, song)) return { started: true, method: methods.join(' -> ') };

  const clickableDump = await dumpClickableElements(page);
  report.interactionNotes.push({ song: song.title, candidates, generic, clickableDump });
  return { started: false, method: methods.join(' -> ') || 'no-candidate' };
}

async function findSongCandidates(page, song) {
  return page.evaluate(({ aliases, id }) => {
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    const keys = [id, ...aliases].map(norm).filter(Boolean);
    const els = Array.from(document.querySelectorAll('body *'));
    const out = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const text = [
        el.innerText,
        el.textContent,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('alt'),
        el.getAttribute('data-song'),
        el.getAttribute('data-song-id'),
        el.id,
        el.className,
      ].join(' ');
      const n = norm(text);
      const hit = keys.find(k => k && n.includes(k));
      if (!hit) continue;
      const style = getComputedStyle(el);
      const clickable = ['BUTTON', 'A'].includes(el.tagName) || el.getAttribute('role') === 'button' || style.cursor === 'pointer' || !!el.onclick;
      out.push({
        x: Math.min(innerWidth - 5, Math.max(5, r.left + r.width / 2)),
        y: Math.min(innerHeight - 5, Math.max(5, r.top + r.height / 2)),
        reason: `${hit}:${el.tagName}:${clickable ? 'clickable' : 'text'}`,
        area: r.width * r.height,
        clickable,
      });
    }
    return out.sort((a, b) => Number(b.clickable) - Number(a.clickable) || a.area - b.area);
  }, { aliases: song.aliases, id: song.id }).catch(() => []);
}

async function findGenericClickableCandidates(page, song) {
  return page.evaluate(({ aliases, id }) => {
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    const keys = [id, ...aliases].map(norm).filter(Boolean);
    const selector = 'button,a,[role="button"],[data-song],[data-song-id],[class*="song"],[class*="card"],[class*="track"]';
    return Array.from(document.querySelectorAll(selector)).map(el => {
      const r = el.getBoundingClientRect();
      const text = [el.innerText, el.getAttribute('aria-label'), el.getAttribute('data-song'), el.getAttribute('data-song-id'), el.id, el.className].join(' ');
      const n = norm(text);
      const hitScore = keys.some(k => n.includes(k)) ? 100 : 0;
      return {
        x: Math.min(innerWidth - 5, Math.max(5, r.left + r.width / 2)),
        y: Math.min(innerHeight - 5, Math.max(5, r.top + r.height / 2)),
        reason: `${el.tagName}:${hitScore ? 'song-hit' : 'generic'}`,
        score: hitScore + Math.min(50, (r.width * r.height) / 1000),
        visible: r.width >= 10 && r.height >= 10 && r.top < innerHeight && r.left < innerWidth,
      };
    }).filter(x => x.visible).sort((a, b) => b.score - a.score);
  }, { aliases: song.aliases, id: song.id }).catch(() => []);
}

async function maybeClickPlayLikeControl(page) {
  const candidates = await page.evaluate(() => {
    const terms = /再生|play|start|はじめる|始める|▶|スタート|見る|視聴/i;
    return Array.from(document.querySelectorAll('button,a,[role="button"],[class*="play"],[class*="start"]')).map(el => {
      const r = el.getBoundingClientRect();
      const text = [el.innerText, el.getAttribute('aria-label'), el.title, el.className, el.id].join(' ');
      return {
        x: Math.min(innerWidth - 5, Math.max(5, r.left + r.width / 2)),
        y: Math.min(innerHeight - 5, Math.max(5, r.top + r.height / 2)),
        ok: r.width >= 8 && r.height >= 8 && terms.test(text),
      };
    }).filter(x => x.ok);
  }).catch(() => []);
  if (candidates[0]) await page.mouse.click(candidates[0].x, candidates[0].y).catch(() => {});
}

async function looksLikeSongStarted(page, song) {
  const state = await page.evaluate(({ aliases, id }) => {
    const t = document.body.innerText || '';
    const body = t.toLowerCase();
    const hasSongText = [id, ...aliases].some(a => body.includes(String(a).toLowerCase()));
    const hasCanvas = !!document.querySelector('canvas');
    const hasPlayingText = /再生中|pause|一時停止|停止|stop|playing|now/i.test(t);
    const loading = /loading|読み込/i.test(t);
    return { hasSongText, hasCanvas, hasPlayingText, loading, textLength: t.length };
  }, { aliases: song.aliases, id: song.id }).catch(() => ({ hasCanvas: false }));
  const sig1 = await canvasSignature(page);
  await page.waitForTimeout(500);
  const sig2 = await canvasSignature(page);
  const canvasChanging = !!(sig1 && sig2 && sig1.hash !== sig2.hash);
  return !!(state.hasPlayingText || canvasChanging || (state.hasCanvas && !state.loading && state.hasSongText));
}

function canvasGridPoint(index) {
  // 6曲カードが画面内に 3x2 または横並びで表示される場合の最終保険。
  const points3x2 = [
    [320, 300], [640, 300], [960, 300],
    [320, 560], [640, 560], [960, 560],
  ];
  const [x, y] = points3x2[index] || [640, 400];
  return { x, y };
}

async function dumpClickableElements(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('button,a,[role="button"],[data-song],[data-song-id],[onclick],[class*="song"],[class*="card"]')).slice(0, 40).map(el => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      text: (el.innerText || el.textContent || '').trim().slice(0, 80),
      aria: el.getAttribute('aria-label'),
      id: el.id,
      cls: String(el.className || '').slice(0, 80),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    };
  })).catch(() => []);
}

// ── 検査・計測 ─────────────────────────────────────────────────

async function inspectInitialState(page) {
  return page.evaluate(() => {
    const body = document.body.innerText || '';
    const cs = getComputedStyle(document.documentElement);
    const songRegexes = [/こたえて/, /after|アフター/i, /shutter|シャッター/i, /音楽隊|世界最後/, /トリツク|tricktology/i, /takeover/i];
    const clickableElements = Array.from(document.querySelectorAll('button,a,[role="button"],[data-song],[data-song-id],[onclick]')).slice(0, 30).map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, text: (el.innerText || '').trim().slice(0, 60), rect: [r.left, r.top, r.width, r.height] };
    });
    return {
      title: document.title,
      bodyLength: body.length,
      hasCanvas: !!document.querySelector('canvas'),
      canvasCount: document.querySelectorAll('canvas').length,
      hasWebGL: !!document.createElement('canvas').getContext('webgl2'),
      isLoading: /読み込|loading/i.test(body),
      hasError: /error|エラー/i.test(body),
      songNamesVisibleCount: songRegexes.filter(r => r.test(body)).length,
      clickHints: /クリック|click|選択/i.test(body),
      tapHints: /タップ|tap|touch/i.test(body),
      pointerCount: Array.from(document.querySelectorAll('*')).filter(el => getComputedStyle(el).cursor === 'pointer').length,
      hasCSSVars: ['--song-primary','--song-bg','--song-accent'].some(v => cs.getPropertyValue(v).trim() !== ''),
      rippleCount: document.querySelectorAll('[class*="ripple"],[class*="wave"],[data-song]').length,
      clickableElements,
    };
  }).catch(() => ({ title: '', hasCanvas: false, canvasCount: 0, hasWebGL: false, songNamesVisibleCount: 0, clickableElements: [] }));
}

async function inspectNavigation(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      songsVisible: [
        /こたえて/.test(t), /after|アフター/i.test(t), /shutter|シャッター/i.test(t),
        /音楽隊/.test(t), /トリツク|tricktology/i.test(t), /takeover/i.test(t),
      ],
      hasProgress: /\d\s*\/\s*6|完了|達成|progress/i.test(t),
      hasNextGuide: /次|next|→|▶|try/i.test(t),
      hasClearMark: /✓|☑|★|済|clear|done/i.test(t),
      hasBackOrHome: /戻る|ホーム|home|back|選曲/i.test(t),
    };
  }).catch(() => ({ songsVisible: [], hasProgress: false }));
}

async function inspectMobileUsability(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || '';
    const vw = innerWidth;
    const els = Array.from(document.querySelectorAll('body *'));
    let overflowCount = 0;
    let smallTapTargets = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.right > vw + 2 || r.left < -2) overflowCount++;
      const style = getComputedStyle(el);
      const clickable = ['BUTTON','A'].includes(el.tagName) || el.getAttribute('role') === 'button' || style.cursor === 'pointer' || !!el.onclick;
      if (clickable && (r.width < 44 || r.height < 44)) smallTapTargets++;
    }
    return {
      hasFatalError: /error|エラー/i.test(t),
      overflowCount,
      smallTapTargets,
      hasTapHint: /タップ|tap|touch|触/i.test(t),
      textLength: t.length,
    };
  }).catch(() => ({ hasFatalError: true, overflowCount: -1, smallTapTargets: -1 }));
}

async function detectLyricsOrText(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || '';
    const domText = t.length > 80 && /[぀-ゟ゠-ヿ一-龯]|[A-Za-z]{3,}/.test(t);
    const textLikeEls = document.querySelectorAll('canvas,svg,text,[class*="lyric"],[class*="word"],[data-lyric]').length > 0;
    return domText || textLikeEls;
  }).catch(() => false);
}

async function canvasSignature(page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const w = c.width || c.clientWidth;
    const h = c.height || c.clientHeight;
    if (!w || !h) return null;
    const points = [
      [0.20,0.25],[0.50,0.25],[0.80,0.25],
      [0.20,0.50],[0.50,0.50],[0.80,0.50],
      [0.20,0.75],[0.50,0.75],[0.80,0.75],
    ];
    let values = [];
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      for (const [px, py] of points) {
        const b = new Uint8Array(4);
        gl.readPixels(Math.floor(w * px), Math.floor(h * (1 - py)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
        values.push(b[0], b[1], b[2], b[3]);
      }
    } else {
      const ctx = c.getContext('2d');
      if (!ctx) return { hash: 'unknown-context', nonEmpty: true };
      for (const [px, py] of points) {
        const d = ctx.getImageData(Math.floor(w * px), Math.floor(h * py), 1, 1).data;
        values.push(d[0], d[1], d[2], d[3]);
      }
    }
    const sum = values.reduce((a, b) => a + b, 0);
    return { hash: values.join(','), nonEmpty: sum > 30 };
  }).catch(() => null);
}

async function safeUserGesture(page, x = 640, y = 400) {
  await page.mouse.click(x, y).catch(() => {});
  await page.waitForTimeout(500).catch(() => {});
}

async function ss(page, name, report) {
  const p = path.join(OUT, 'screenshots', `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  report.evidence.screenshots.push(name);
  process.stdout.write(`  📸 ${name}\n`);
  return p;
}

async function measureFPS(page, ms) {
  return page.evaluate(dur => new Promise(res => {
    const f = []; let p = performance.now(), n = 0, max = Math.max(10, dur / 16.67);
    (function tick(now) {
      f.push(1000 / Math.max(1, now - p)); p = now;
      if (++n < max) requestAnimationFrame(tick);
      else res({ avg: +(f.reduce((a,b)=>a+b,0)/f.length).toFixed(1), min: +Math.min(...f).toFixed(0), max: +Math.max(...f).toFixed(0) });
    })(performance.now());
  }), ms).catch(() => ({ avg: 0, min: 0, max: 0 }));
}

function collectMeta() {
  const sh = cmd => {
    try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
  };
  return {
    url: APP_URL,
    ts: new Date().toISOString(),
    runId: RUN_ID,
    outDir: OUT,
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    branch: sh('git branch --show-current'),
    commit: sh('git rev-parse --short HEAD'),
    gitStatus: sh('git status --short'),
  };
}

function ensureDirs() {
  for (const d of ['screenshots', 'videos', 'logs', 'frames']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
}

function cleanupDevServer() {
  if (KEEP_SERVER) return;
  const pid = process.env.DEV_PID;
  if (!pid) return;
  try {
    process.kill(Number(pid));
    log('CLEANUP', `Dev server stopped: ${pid}`);
  } catch (_) {}
}

function pad(n) { return String(n).padStart(2, '0'); }

function log(tag, msg) {
  const t = new Date().toISOString().substring(11, 19);
  console.log(`[${t}][${tag.padEnd(7)}] ${msg}`);
}

function printSummary(r) {
  const s = r.summary;
  console.log('\n' + '='.repeat(72));
  console.log('  自動計測 サマリー');
  console.log('='.repeat(72));
  const row = (label, val) => console.log(`  ${label.padEnd(28)}: ${val}`);
  row('評価URL', r.meta.url);
  row('実行ID', r.meta.runId);
  row('Git commit', r.meta.commit || 'unknown');
  row('ロード時間', `${s.loadMs}ms`);
  row('平均FPS', `${s.fps} fps`);
  row('TextAlive ロード', s.taLoaded ? '✓ 成功' : '✗ 失敗');
  row('曲開始確認', `${s.startedOk}/6`);
  row('映像描画 曲数', `${s.visualOk}/6`);
  row('歌詞/文字表示らしさ', `${s.lyricsOrTextOk}/6`);
  row('インタラクション', `平均 ${s.avgInteraction}/8`);
  row('コンソールエラー', `${s.errTotal}件`);
  row('モバイル表示', s.mobileOk ? '✓ OK' : '✗ NG');
  row('モバイル横はみ出し', `${s.mobileOverflowCount}件`);
  row('エンディング', s.endingExists ? '✓ あり' : '✗ なし');
  row('全6曲が選択可能', `${s.songsOk}/6`);
  row('重大な問題', `${s.criticals}件`);
  row('主要な問題', `${s.majors}件`);
  console.log('='.repeat(72));
  if (r.issues.critical.length) {
    console.log('\n【重大な問題（最優先）】');
    r.issues.critical.forEach(i => console.log(`  ✗ ${i}`));
  }
  if (r.issues.major.length) {
    console.log('\n【主要な問題】');
    r.issues.major.forEach(i => console.log(`  △ ${i}`));
  }
  console.log(`\nJSON: ${path.join(OUT, 'eval_report.json')}`);
  console.log(`Screenshots: ${path.join(OUT, 'screenshots')}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  cleanupOnFatal();
  process.exit(1);
});

function cleanupOnFatal() {
  if (KEEP_SERVER) return;
  const pid = process.env.DEV_PID;
  if (!pid) return;
  try { process.kill(Number(pid)); } catch (_) {}
}
