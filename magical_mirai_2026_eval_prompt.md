# ================================================================
# マジカルミライ2026 リリックアプリ 最終審査評価プロンプト
# 汎用AIエージェント環境向け — リポジトリルートで実行・評価する
# ================================================================

あなたはこれから4つの役割を同時に担います。

1. **マジカルミライ2026プログラミングコンテストの審査員**
2. **一流ゲームアプリのUX評価者**
3. **ミュージックビデオのクリエイティブディレクター**
4. **一般ユーザー審査を統括する評価者**

さらに、以下の3名の一般ユーザー審査員の視点を必ず追加してください。

## 一般ユーザー審査員

### 一般ユーザー審査員A: 20代女性 / スマホ中心ユーザー

- 年代: 20代
- 性別: 女性
- 主な利用環境: スマートフォン
- 特徴:
  - SNS、動画アプリ、音楽アプリに慣れている
  - PCよりスマホで作品を見る可能性が高い
  - 操作説明を細かく読まず、直感で触る
  - 見た目の第一印象、かわいさ、共有したくなるかを重視する

評価観点:

- スマホで見たときに画面が崩れていないか
- タップできる場所が直感的にわかるか
- 歌詞や演出がSNSで共有したくなる魅力を持っているか
- 最初の数秒で「かわいい」「きれい」「触ってみたい」と思えるか

---

### 一般ユーザー審査員B: 30代男性 / PC中心ユーザー

- 年代: 30代
- 性別: 男性
- 主な利用環境: PC
- 特徴:
  - ブラウザゲーム、Webアプリ、音楽MVにある程度慣れている
  - マウス・キーボード操作に抵抗がない
  - 画面演出、操作レスポンス、完成度の粗さに気づきやすい
  - 「ゲームとして気持ちよく操作できるか」を重視する

評価観点:

- PCブラウザで快適に動くか
- マウス操作、クリック、キーボード操作の反応が気持ちよいか
- 選曲、再生、戻る、次の曲への導線がわかりやすいか
- アプリとして未完成に見える箇所がないか

---

### 一般ユーザー審査員C: 40代女性 / インターネットに疎いユーザー

- 年代: 40代
- 性別: 女性
- 主な利用環境: PCまたはスマートフォン
- 特徴:
  - Webアプリや音楽ゲームにあまり慣れていない
  - 操作方法を推測するのが苦手
  - 「どこを押せばいいのか」「今何が起きているのか」が明確でないと離脱しやすい
  - 難しいUIより、説明のわかりやすさと安心感を重視する

評価観点:

- 初見で何をすればよいか理解できるか
- 操作説明がなくても迷わず進められるか
- 画面上の文字、ボタン、ガイドが十分にわかりやすいか
- エラーや無反応に見える時間がないか

---

この3名の一般ユーザー視点は、**第七の軸「一般ユーザー審査」として評価してください。**

ただし、第七の軸はコンテスト加重スコアには含めません。

コンテスト加重スコアは従来通り、

- クリエイティビティ 35%
- イノベーション 35%
- 完成度 30%

のみで算出してください。

第七の軸は、**審査員視点では見落としやすい一般ユーザーのつまずき・直感的な魅力・離脱リスクを確認するための参考情報**として扱ってください。

この4つの視点を持ちながら、このリポジトリのアプリを**実際にブラウザで全曲動作させて**評価してください。
スクリーンショットや計測値だけでなく、**動いている状態を直接見た上での定性評価**を最重視します。

---


---

# 使用前提

この評価プロンプトは、Claude Code だけでなく、Codex、Antigravity、Gemini CLI、Cursor など、
**リポジトリ内でコマンド実行・ファイル作成・ブラウザ確認ができる生成AIエージェント環境**で使うことを想定しています。

評価者は、特定のエージェント固有機能に依存せず、以下を満たす環境で実行してください。

- Node.js が利用できること
- npm / pnpm / yarn のいずれかが利用できること
- Playwright の Chromium を起動できること
- ローカル開発サーバーを起動できること
- スクリーンショット・ログ・JSONファイルを保存できること

評価は**一回で完結**させてください。
評価を複数のプロンプトに分割しないでください。

この評価は、1日3回程度の定点観測にも使うことを想定しています。
そのため、毎回以下を必ず記録してください。

- 評価日時
- Gitブランチ
- Gitコミットハッシュ
- 未コミット変更の有無
- 評価対象URL
- 実行環境
- 出力ディレクトリ

---

# 重要な評価方針

- 曲選択・再生方法を **ArrowRight / Space 前提にしないこと**。
- キーボード操作は補助的に試してよいが、主要な評価手段にしないこと。
- 曲名テキスト、button、role=button、data-song、aria-label、class名、Canvas上のカード領域などを探索し、実際のUIに合わせて曲を開始すること。
- 操作方法が不明な場合、それ自体を「初見導線の問題」として記録すること。
- ただし、評価スクリプトの想定違いだけで「アプリが動かない」と即断しないこと。
# PHASE 0: 環境構築（必ず最初に実行）

以下をbashで順番に実行してください。
エラーが出た場合は、原因を確認し、可能な範囲で解決してから次に進んでください。

この手順は Claude Code 専用ではありません。
Codex、Antigravity、Gemini CLI、Cursor など、任意のAIエージェント環境で、リポジトリルートから実行することを想定しています。

```bash
set -e

echo "============================================================"
echo " マジカルミライ2026 リリックアプリ 評価セットアップ"
echo "============================================================"

# ① 実行メタ情報を記録する
RUN_ID="$(date +%Y%m%d_%H%M%S)"
BASE_OUT="eval_output"
OUT="$BASE_OUT/runs/$RUN_ID"
mkdir -p "$OUT"/{screenshots,videos,logs,frames}
ln -sfn "runs/$RUN_ID" "$BASE_OUT/latest" 2>/dev/null || true

{
  echo "=== datetime ==="
  date
  echo ""
  echo "=== pwd ==="
  pwd
  echo ""
  echo "=== node ==="
  node -v 2>/dev/null || true
  echo ""
  echo "=== npm ==="
  npm -v 2>/dev/null || true
  echo ""
  echo "=== git branch ==="
  git branch --show-current 2>/dev/null || echo "git branch unavailable"
  echo ""
  echo "=== git commit ==="
  git rev-parse --short HEAD 2>/dev/null || echo "git commit unavailable"
  echo ""
  echo "=== git status ==="
  git status --short 2>/dev/null || echo "git status unavailable"
} | tee "$OUT/logs/eval_meta.txt"

# ② ファイル構成を把握する
{
  echo "=== package.json ==="
  cat package.json 2>/dev/null || echo "package.json が見つかりません"
  echo ""
  echo "=== src構成 ==="
  find src -type f | sort 2>/dev/null || echo "src ディレクトリが見つかりません"
  echo ""
  echo "=== .env確認 ==="
  ls -la .env* 2>/dev/null || echo ".env は見つかりません"
} | tee "$OUT/logs/project_structure.txt"

# ③ パッケージマネージャを判定して依存関係をインストールする
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  PKG="pnpm"
  INSTALL_CMD="pnpm install"
  DEV_CMD="pnpm run dev"
elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
  PKG="yarn"
  INSTALL_CMD="yarn install"
  DEV_CMD="yarn dev"
else
  PKG="npm"
  INSTALL_CMD="npm install"
  DEV_CMD="npm run dev"
fi

echo "Using package manager: $PKG" | tee "$OUT/logs/package_manager.txt"
eval "$INSTALL_CMD" | tee "$OUT/logs/install.log"

# ④ Playwright セットアップ
# 既に入っていても、Chromium 実行に必要な依存関係が不足している可能性があるため確認する。
node -e "require('playwright'); console.log('playwright exists')" 2>/dev/null || npm install playwright
npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium

# ⑤ ローカルサーバーを起動する
# 必要なら外部から DEV_COMMAND / APP_URL を指定してよい。
# 例: DEV_COMMAND="npm run preview" APP_URL="http://localhost:4173" node eval_master.js
DEV_COMMAND="${DEV_COMMAND:-$DEV_CMD}"
echo "Dev command: $DEV_COMMAND" | tee "$OUT/logs/dev_command.txt"

bash -lc "$DEV_COMMAND" > "$OUT/logs/devserver.log" 2>&1 &
DEV_PID=$!
export DEV_PID
export EVAL_OUT="$OUT"
echo "$DEV_PID" > "$OUT/logs/devserver.pid"
echo "Dev server PID: $DEV_PID"

# ⑥ サーバー起動待ち & URL自動検出
sleep 5

if [ -z "${APP_URL:-}" ]; then
  for url in \
    "http://localhost:5173" \
    "http://127.0.0.1:5173" \
    "http://localhost:3000" \
    "http://127.0.0.1:3000" \
    "http://localhost:4173" \
    "http://127.0.0.1:4173" \
    "http://localhost:8080" \
    "http://127.0.0.1:8080"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)
    if [ "$code" = "200" ] || [ "$code" = "304" ]; then
      APP_URL="$url"
      break
    fi
  done
fi

if [ -z "${APP_URL:-}" ]; then
  echo "サーバーURLを自動検出できませんでした。devserver.log を確認してください。"
  head -80 "$OUT/logs/devserver.log" || true
  exit 1
fi

export APP_URL

echo "Detected APP_URL: $APP_URL" | tee "$OUT/logs/app_url.txt"
head -80 "$OUT/logs/devserver.log" || true
```

---

# PHASE 1: 全曲ブラウザ動作確認スクリプト

以下の内容で `eval_master.js` を作成し、`node eval_master.js` で実行してください。
**このスクリプトは全6曲を実際にブラウザで再生し、動作を記録します。**

重要:

- このスクリプトは **ArrowRight / Space 前提ではありません**。
- 曲名、data属性、aria-label、button、role=button、Canvas内の想定位置など、複数の方法で曲選択を試します。
- キーボード操作は、UI探索が失敗した場合の補助としてのみ扱います。
- 評価スクリプトが曲開始に失敗した場合は、即座に「アプリ不動」と判断せず、導線・アクセシビリティ・クリック可能要素の不足として記録してください。

```javascript
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

    await page.evaluate(() => {
      const flags = { kotaete:true, after:true, shutter:true, orchestra:true, tricktology:true, takeover:true };
      localStorage.setItem('mm2026_completed', JSON.stringify(flags));
    }).catch(() => {});
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await safeUserGesture(page);
    await page.waitForTimeout(3000);
    await ss(page, '21_ending_check', report);

    const ending = await page.evaluate(() => {
      const t = document.body.innerText || '';
      return {
        exists: /完成|循環|おめでとう|6つ|制覇|全曲|ending/i.test(t),
        hasShare: /share|シェア|twitter|x\.com/i.test(t),
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
    const domText = t.length > 80 && /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]|[A-Za-z]{3,}/.test(t);
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
```

---

# PHASE 2: スクリーンショット一覧を確認する

```bash
echo "=== 出力ディレクトリ ==="
echo "${EVAL_OUT:-eval_output/latest}"
echo ""
echo "=== 取得したスクリーンショット ==="
ls -la "${EVAL_OUT:-eval_output/latest}/screenshots/"
echo ""
echo "=== 動画ファイル ==="
ls -la "${EVAL_OUT:-eval_output/latest}/videos/" || true
echo ""
echo "=== eval_report.json ==="
cat "${EVAL_OUT:-eval_output/latest}/eval_report.json" | python3 -m json.tool 2>/dev/null || cat "${EVAL_OUT:-eval_output/latest}/eval_report.json"
```

**全スクリーンショットを実際に開いて確認してください。**
自動計測値だけで評価を完結させないでください。

特に以下の点に注目すること：

- `00_startup.png` — 初見で「どこをクリック/タップするか」が直感的にわかるか
- `01~03 hover` — ホバー時に何か変化があるか（視覚的フィードバック）
- `05_song_select` が存在しない場合でも、`20_ux_navigation.png` で選曲導線を確認すること
- 各曲 `f0_start` — 再生直後の第一印象（世界観が伝わるか）
- 各曲 `f1_mouse` — マウス操作後の変化（インタラクション反応）
- 各曲 `f2_3sec` — 3秒後の演出発展（歌詞が出ているか・映像が動いているか）
- 各曲 `f3_click` — クリック後の変化（固有ギミックが動いているか）
- 各曲 `f5_8sec` — 8秒後（曲の山場に向けて演出が育っているか）
- `30_mobile_390` — スマホで見たとき崩れていないか、タップ対象が小さすぎないか
- `21_ending_check` — 全曲制覇後の達成感演出があるか

---

# PHASE 3: 6軸 + 参考軸1つの詳細評価レポートを出力する

スクリーンショット・計測値・ソースコード・動作を総合して、以下のフォーマットで評価レポートを出力してください。

**軸1〜軸6のスコアは「マジカルミライ最優秀賞水準 = 100」を基準とした絶対評価です。厳しく評価してください。**

**軸7「一般ユーザー審査」は参考評価です。総合スコアには加算しないでください。**

---

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 マジカルミライ2026 リリックアプリ 最終評価レポート
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

■ まず読むべき短いサマリー
  今日の結論: [1〜3行で端的に]
  今回のコンテスト加重スコア: XX/100
  最優秀賞獲得可能性: [S / A / B / C / D]
  前回から良くなった点: [不明なら「前回比較なし」と書く]
  前回から悪化した点: [不明なら「前回比較なし」と書く]
  今すぐ直すべき最重要問題: 
  一般ユーザーが一番迷いそうな箇所:
  最優秀賞に一番足りない要素:

■ 評価メタ情報
  評価日時:
  Gitブランチ:
  Gitコミットハッシュ:
  未コミット変更: [なし / あり / 不明]
  評価対象URL:
  出力ディレクトリ:
  実行環境:

■ 前回評価との差分
  ※前回の eval_report.json や前回レポートがある場合のみ比較する。
  ※前回情報がない場合は「前回比較なし」と明記する。

  前回コンテスト加重スコア: XX/100 または 前回比較なし
  今回コンテスト加重スコア: XX/100
  差分: +X / -X / 前回比較なし

  前回一般ユーザー参考スコア: XX/100 または 前回比較なし
  今回一般ユーザー参考スコア: XX/100
  差分: +X / -X / 前回比較なし

  改善した点:
  1.
  2.
  3.

  悪化した点:
  1.
  2.
  3.

  新しく発生した問題:
  1.
  2.
  3.

  前回から未解決の問題:
  1.
  2.
  3.

■ 総合判定
  最優秀賞獲得の可能性: [S / A / B / C / D]
  コンテスト加重スコア: XX/100
  （クリエイティビティ35% + イノベーション35% + 完成度30%）

  ※第七の軸「一般ユーザー審査」は参考情報であり、
    上記のコンテスト加重スコアには含めないこと。

  一般ユーザー参考評価: XX/100
  一般ユーザー離脱リスク: [低 / 中 / 高]
  一般ユーザーに最も刺さりそうな要素:
  一般ユーザーが最も迷いそうな箇所:

  ─── 一言評価（審査員として正直に）───────────────────────────
  [200文字以内で現在の状態を正直に評価する]
  ────────────────────────────────────────────────────────────

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 軸1: マジカルミライ最優秀賞を取れるか
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

スコア: XX/100

【審査3基準との対応】

  クリエイティビティ (35点満点中 XX点)
  ─ 歌詞と映像の一体感はあるか（スクリーンショットから判断）
  ─ マジカルミライ2026テーマ「Lake Sonare」との結びつきは？
  ─ 他の参加作品と差別化できる独自表現があるか

  イノベーション (35点満点中 XX点)
  ─ 「こんなリリックアプリは見たことがない」と思わせる要素があるか
  ─ 歌詞の意味とインタラクションが不可分に結びついているか
  ─ 技術的な新規性（WebGL・Three.js・PixiJS の使いこなし）はあるか

  完成度 (30点満点中 XX点)
  ─ 全6曲が安定して動作するか（計測値から）
  ─ TextAlive 歌詞同期に遅れや乱れはないか
  ─ エラーなく最後まで体験できるか

【最優秀賞に向けて今すぐやること（優先度順）】
  1. （最重要）
  2. （重要）
  3. （加点要素）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 軸2: 各楽曲を魅力的に見せているか
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

スコア: XX/100

【各曲の個別評価】

スクリーンショット 3枚セット（f0_start / f2_3sec / f5_8sec）を見て
各曲を以下の観点で評価すること：

  ① 世界観の一致度
     その曲の歌詞テーマ・感情軸を映像が正しく表現できているか

  ② 視覚的なインパクト
     最初の3秒で「おっ」となる第一印象があるか

  ③ 演出の発展性
     時間が経つにつれて演出が豊かになっているか（f0 vs f5 の差）

  ④ 歌詞との同期感
     歌詞テキストが適切なタイミング・スタイルで表示されているか

  曲名        | 世界観 | インパクト | 発展性 | 同期 | 総評
  ────────────|--------|------------|--------|------|──────
  こたえて     |  /10   |    /10     |  /10   | /10  |
  アフター     |  /10   |    /10     |  /10   | /10  |
  シャッター   |  /10   |    /10     |  /10   | /10  |
  世界最後     |  /10   |    /10     |  /10   | /10  |
  トリツク     |  /10   |    /10     |  /10   | /10  |
  TAKEOVER     |  /10   |    /10     |  /10   | /10  |

【最も魅力的な曲とその理由】
【最も改善が必要な曲とその理由・具体的な改善案（コード例付き）】

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 軸3: インタラクション要素が正しく実装されているか
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

スコア: XX/100

計測値: 平均インタラクション反応スコア = X.X/8

【チェック項目と結果】

  □ マウス移動で Canvas に変化があるか（計測値から）
  □ クリックで何かが起きるか（f3_click vs f2_3sec の比較）
  □ キーボード（Space/ESC/←→）が機能するか
  □ タッチ操作（モバイルスクリーンショットから）

【各曲の固有インタラクション評価】

  こたえて:    期待: カーソルで色が変わる / 実際:
  アフター:    期待: ホバーで波紋が広がる / 実際:
  シャッター:  期待: クリックでシャッター / 実際:
  世界最後:    期待: カラーピッカーで色変 / 実際:
  トリツク:    期待: スクラッチで本音現出 / 実際:
  TAKEOVER:    期待: タップで波紋干渉      / 実際:

【インタラクションが機能していない箇所と修正コード】

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 軸4: 初見ユーザーが迷わず遊べるか
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

スコア: XX/100

【00_startup.png を見て以下を判定する】

  Q1. URLを開いた瞬間、「何をすれば始まるか」が3秒以内にわかるか？
      → [わかる / わからない / 部分的に]
      → 根拠:

  Q2. 曲の選び方が直感的か？
      → [直感的 / 説明が必要 / 不明]
      → 根拠:

  Q3. 再生中に「触っていいんだ」と思わせる視覚的ヒントがあるか？
      → [ある / ない]
      → 根拠（f0_start を見て）:

  Q4. 操作方法を知らなくても全曲を遊び終えられそうか？
      → [遊べる / 部分的に / 遊べない]

  Q5. エラー・フリーズ・停止が起きる箇所はあるか？
      → 計測値: JS エラー XXX件 / 重大な問題 XX件

【改善提案: 初見UXを上げるための具体的な施策（優先度順）】

  1. （最もインパクトが大きい改善）コード例:
  2. （次に効果的な改善）コード例:
  3. （あると良い改善）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 軸5: 一般的なゲームアプリと比べたUI/UX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

スコア: XX/100

「Monument Valley」「Alto's Adventure」「Cytus」などの
高評価モバイルゲームを基準として評価する。

【比較チェックリスト】

  ローディング体験
  □ ローディング中も退屈しないビジュアルがあるか
  □ 進行状況が何らかの形でわかるか
  □ ロード後に「準備完了」の感が演出されているか
  → 評価:

  ナビゲーション
  □ どの画面からでも「ホーム（選曲）に戻れる」か
  □ 現在地（どの曲を再生中か）が常にわかるか
  □ 曲の切り替えがスムーズか（遷移アニメーション）
  → 評価:

  フィードバック
  □ タップ・クリックしたときに何らかの反応があるか（音・光・震えなど）
  □ 「それ正しい操作だよ」と教えてくれる視覚的フィードバックがあるか
  □ エラー時に何が起きたか伝わるか
  → 評価:

  達成感・リプレイ価値
  □ 1曲終わったときに「また聴きたい」「次の曲も聴きたい」と感じるか
  □ 全曲制覇への動機付けがあるか
  □ 何度でも遊びたくなる仕掛けがあるか
  → 評価:

  視覚的完成度
  □ フォント・色・余白に統一感があるか
  □ アニメーションが滑らかか（FPS: XX fps）
  □ 画面密度が適切か（情報過多・過少でないか）
  → 評価:

【ゲームアプリ基準で足りない点TOP3と改善案】

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 軸6: 一般的なミュージックビデオと比べた魅力
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

スコア: XX/100

Vocaloid の公式 MV、米津玄師・YOASOBI 等のクオリティの高い MV を基準として評価。

【比較チェックリスト】

  映像と音楽の一体感（最重要）
  □ 音楽のビート・フレーズに映像の変化が合っているか
  □ 歌詞の言葉の意味が映像で表現されているか
  □ 曲の「山場」で映像も盛り上がるか
  → スクリーンショットから判断した評価:

  カラーグレーディング・空間演出
  □ 曲のムードに合った色調・雰囲気があるか
  □ 空間の奥行きや動きが感じられるか（Three.js 活用度）
  □ 光・影・グロウの使い方が効果的か
  → 評価:

  タイポグラフィ（歌詞の見せ方）
  □ 歌詞が「読みやすく、しかし主役になる」デザインか
  □ フォント・サイズ・アニメーションが曲調に合っているか
  □ 歌詞のタイミング表示が MV 並みに洗練されているか
  → 評価:

  感情の伝達力
  □ スクリーンショットを見ただけで曲の感情が伝わるか
  □ 映像を見ていて感情が動く瞬間があるか
  □ 「初音ミクがそこにいる」存在感が出ているか
  → 評価:

【MV基準で最も改善インパクトが高い要素とその実装案】

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 軸7: 一般ユーザー審査
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

参考スコア: XX/100

※このスコアは参考情報であり、コンテスト加重スコアには含めないこと。
※審査員・開発者・クリエイター目線ではなく、一般ユーザーが実際に触ったと仮定して評価すること。

---

## 一般ユーザー審査員A: 20代女性 / スマホ中心ユーザー

スコア: XX/100

【評価】

  Q1. スマホで見たとき、第一印象で「触ってみたい」と思えるか？
      → [強く思う / 思う / どちらとも言えない / 思わない]
      → 根拠:

  Q2. タップできる場所が直感的にわかるか？
      → [わかる / 部分的にわかる / わからない]
      → 根拠:

  Q3. 歌詞・映像・色・動きにSNSで共有したくなる魅力があるか？
      → [ある / 少しある / 弱い / ない]
      → 根拠:

  Q4. スマホ画面で文字が読みやすいか？
      → [読みやすい / 部分的に読みにくい / 読みにくい]
      → 根拠:

  Q5. 操作説明を読まなくても楽しめそうか？
      → [楽しめる / 部分的に楽しめる / 難しい]
      → 根拠:

【20代女性スマホユーザーとしての一言感想】
  [実際の一般ユーザーが言いそうな自然な言葉で書く]

【改善すると刺さりやすくなる点】
  1.
  2.
  3.

---

## 一般ユーザー審査員B: 30代男性 / PC中心ユーザー

スコア: XX/100

【評価】

  Q1. PCブラウザで操作していて快適か？
      → [快適 / やや快適 / 普通 / ストレスがある]
      → 根拠:

  Q2. マウス・クリック・キーボード操作の反応は気持ちよいか？
      → [気持ちよい / 普通 / 弱い / 反応がわかりにくい]
      → 根拠:

  Q3. 選曲、再生、戻る、次の曲への流れがわかりやすいか？
      → [わかりやすい / 部分的に迷う / わかりにくい]
      → 根拠:

  Q4. Webアプリとして完成度が高く見えるか？
      → [高く見える / 普通 / 未完成に見える]
      → 根拠:

  Q5. 1曲だけでなく、6曲すべて試したくなるか？
      → [試したい / 一部だけ試したい / 試したくならない]
      → 根拠:

【30代男性PCユーザーとしての一言感想】
  [実際の一般ユーザーが言いそうな自然な言葉で書く]

【改善すると評価が上がる点】
  1.
  2.
  3.

---

## 一般ユーザー審査員C: 40代女性 / インターネットに疎いユーザー

スコア: XX/100

【評価】

  Q1. URLを開いた直後に、何をすればよいかわかるか？
      → [わかる / 少し迷う / わからない]
      → 根拠:

  Q2. 専門知識がなくても、曲を選んで再生できるか？
      → [できる / たぶんできる / 難しい]
      → 根拠:

  Q3. 画面上の説明・ボタン・ガイドは十分に親切か？
      → [親切 / もう少し必要 / 不足している]
      → 根拠:

  Q4. 無反応・ロード中・エラーに見えて不安になる箇所はあるか？
      → [ない / 少しある / 多い]
      → 根拠:

  Q5. 最後まで遊び終えられそうか？
      → [遊び終えられる / 途中で迷いそう / 離脱しそう]
      → 根拠:

【40代インターネットに疎いユーザーとしての一言感想】
  [実際の一般ユーザーが言いそうな自然な言葉で書く]

【改善すると離脱を防げる点】
  1.
  2.
  3.

---

## 一般ユーザー総合まとめ

【一般ユーザー参考スコア】
  XX/100

【一般ユーザー離脱リスク】
  [低 / 中 / 高]

【最も一般ユーザーに刺さる要素】
  1.
  2.
  3.

【最も一般ユーザーが迷いそうな箇所】
  1.
  2.
  3.

【審査員評価と一般ユーザー評価のズレ】

  審査員・クリエイター目線では高く評価できるが、一般ユーザーには伝わりにくい点:
  1.
  2.
  3.

  一般ユーザーには刺さりやすいが、コンテスト審査上は加点に直結しにくい点:
  1.
  2.
  3.

【一般ユーザー向けに提出前に直すべきこと】

  優先度 | 改善内容 | 対象ユーザー | 理由 | 工数目安
  ─────────────────────────────────────────────────────────
  🔴 最優先 |          |              |      |
  🟠 重要   |          |              |      |
  🟡 推奨   |          |              |      |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 発見した問題 一覧
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【重大な問題（今すぐ修正しないと審査を通らない）】
  1.
  2.

【主要な問題（提出前に修正推奨）】
  1.
  2.
  3.

【あると加点になる改善】
  1.
  2.
  3.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 提出前 最終アクションリスト
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

残り時間でやるべきことを優先度・工数込みで出力する。

  優先度 | 作業内容                        | 工数目安 | 期待される効果
  ─────────────────────────────────────────────────────────
  🔴 最優先|                                 |          |
  🔴 最優先|                                 |          |
  🟠 重要  |                                 |          |
  🟠 重要  |                                 |          |
  🟡 推奨  |                                 |          |
  🟡 推奨  |                                 |          |
  🟢 加点  |                                 |          |
```

---

# 注意事項（必ず守ること）

- **全6曲を実際にブラウザで動かすこと。1曲でも未確認のまま評価しない。**
- 曲選択・再生は ArrowRight / Space 前提にしないこと。曲名、ボタン、data属性、aria-label、Canvas上のカード領域など、実際のUIを探索して操作すること。
- キーボード操作は補助として試してよいが、主要な評価前提にはしないこと。
- スクリーンショットが真っ黒または真っ白の曲は「映像が動いていない」として問題に記録する。
- TextAlive がタイムアウトした場合は、それが最重要問題として評価の冒頭に記載する。
- スコアは甘くつけない。最優秀賞は「圧倒的に良い」作品だけが取れる。
- 「良い点」も必ず書く。制作者が次のアクションを取れるように。
- コードを修正する提案には、実際に動くコード例を含める。
- 第七の軸「一般ユーザー審査」は必ず出力すること。
- 第七の軸は、総合スコア・コンテスト加重スコアには絶対に含めないこと。
- 一般ユーザー審査では、開発者目線・審査員目線ではなく、実際に初見ユーザーが触ったときの迷い・感動・離脱リスクを評価すること。
- 一般ユーザー3名は必ず以下の役割で評価すること。
  - 20代女性 / スマホ中心ユーザー
  - 30代男性 / PC中心ユーザー
  - 40代女性 / インターネットに疎いユーザー
- PCユーザー、スマホユーザー、インターネットに疎い人の3観点が必ず評価に含まれていることを確認すること。
- 一般ユーザー参考スコアは出してよいが、最優秀賞獲得可能性やコンテスト加重スコアの計算には使わないこと。

- 評価レポートの冒頭に「まず読むべき短いサマリー」を必ず出力すること。
- 評価日時、Gitブランチ、Gitコミットハッシュ、未コミット変更の有無、評価対象URL、出力ディレクトリを必ず記録すること。
- 1日3回程度の定点観測に使う前提で、前回評価との差分が分かる場合は必ず比較すること。前回情報がない場合は「前回比較なし」と明記すること。
- eval_output は毎回上書きせず、日時付きの `eval_output/runs/<RUN_ID>` に保存すること。
- Claude Code 専用の前提にしないこと。Codex、Antigravity、Gemini CLI、Cursor など、他の生成AIエージェント環境でも実行できるよう、標準的なbash / Node.js / Playwright の範囲で指示すること。
- package manager は npm 固定にしないこと。pnpm-lock.yaml / yarn.lock がある場合は pnpm / yarn も考慮すること。
- ローカルサーバーのURLは localhost:5173 固定にしないこと。APP_URL が指定されていればそれを使い、未指定なら 5173 / 3000 / 4173 / 8080 などを検出すること。
- 評価終了後、起動した開発サーバーは原則停止すること。ただし KEEP_SERVER=true が指定されている場合は停止しないこと。
