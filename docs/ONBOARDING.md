# Lake Sonare — 新規メンバー オンボーディング & レビュー手引き

> このドキュメントを最初に読めば、(1) アプリの設計思想、(2) アーキテクチャ、(3) 6曲それぞれの体験設計、(4) レビューのやり方、が分かるようにまとめてある。
> 読み終えたら、末尾の **「7. このアプリをレビューする」** に沿って実際にレビューを始められる。

対象: マジカルミライ2026 プログラミング・コンテスト応募作。TextAlive リリックアプリ。
関連: [README.md](../README.md)（セットアップ） / [AGENTS.md](../AGENTS.md)（エージェント担当割り） / [CHANGELOG_AI.md](../CHANGELOG_AI.md)（変更履歴）

---

## 1. このアプリは何か（コンセプトと方針）

### 1-1. コンセプト
**「夜の湖面」を共通UIとし、6曲がそれぞれ異なる "水と波紋の表現" として現れる体験型リリックアプリ。**
タイトルは **Lake Sonare — 問いが波紋になる世界**。単なる歌詞表示ではなく、`歌詞の意味 × 楽曲の展開 × ユーザー操作` を一体化させた体験を目指している。

- 選曲画面は 3D の湖面（[WorldUI.js](../src/lake/WorldUI.js) / [LakeUI.js](../src/lake/LakeUI.js)）。6曲が波紋として浮かぶ。
- 各曲には「問い（themeQuestion）」が設定され、体験の軸になっている。
- 曲をクリアするごとに湖の世界の **フェーズ（phase）** が進む（[appState.js](../src/core/appState.js) / `PHASES`）。

### 1-2. 貫いている2つの設計方針（ここが一番大事）

新メンバーが提案を出す前に、必ず以下2つの「意図的な決定」を理解しておくこと。これに反する提案（例:「操作を全曲統一しよう」）は方針違反になる。

**方針A: 操作は全曲で統一しない。代わりに導入（オンボーディング）を手厚くする。**
6曲はそれぞれ操作方法が違う。これは各楽曲コンセプトの表現として **意図的に維持する**。
- 一貫性より「曲ごとのユニークさ」を取った（創作文化軸では魅力、遊びやすさ軸では学習負荷、という二律背反をユーザーは多様性側で決定）。
- その負荷を魅力に転換するため、**各曲ごとの導入演出**（コンセプトカード/チュートリアル、初見・再訪の出し分け）を手厚くする。
- 実装: [BaseSong.js](../src/songs/BaseSong.js) `showTutorial()`。各曲の `tutorial.steps`（[songs.js](../src/config/songs.js)）を表示し、`localStorage` の `mm_tut_<songId>` で既読判定。再訪時はチュートリアルを出さず即頭出し再生。

**方針B: 初音ミクの3D表現は「曲ごとに個別設計」する。横展開しない。**
- 原則:「**主役にできないなら出さない**」。3Dモデルを出した瞬間に MMD/ライブ映像と比較されるため、存在感はポリゴンモデルだけでなく、シルエット/タイポグラフィ/色（ティール）/影/パーティクルでも作れる。
- 各曲を「主役化 / 静かな主役 / 脱literal（影・シルエット）/ モデルなし」のどれかに意思決定している（→ 4章の曲別表を参照）。
- kotaete のダンス基盤などを他曲へ安易にコピーしないこと。

### 1-3. 創作文化のループ（lakeMemory）
創作文化軸への回答として、「ユーザーの創作が次の創作を呼ぶ」擬似循環をサーバなし（localStorage 完結）で作っている。
- 基盤: [lakeMemory.js](../src/lake/lakeMemory.js) — `addRipple / getRipples / countRipples / clearRipples`。
- 1つの波紋 = `{ id, songId, type, text, color, meta, createdAt }`。各曲がユーザー創作（問い・色・言葉）をここへ積み、後で同じ曲・湖へ再来させる。
- 縦スライス実装済みの代表例が **「こたえて」**（問いを立てる→湖に堆積→エコー再来）。他曲展開時のテンプレート。

---

## 2. 技術スタックと制約（レギュレーション）

### 2-1. スタック
- ビルド: **Vite**（`npm run dev` / `npm run build` / `npm run preview`）。静的Webアプリ（GitHub Pages デプロイ: `npm run deploy`）。
- 歌詞・タイミング: **TextAlive App API**（`textalive-app-api`）のみ。
- 3D/描画: **Three.js**、**PixiJS**、ミクモデルに **@pixiv/three-vrm**。
- テスト: **Playwright**（`npm run test:visual` / `test:e2e`）。

### 2-2. 絶対に守るレギュレーション（[AGENTS.md](../AGENTS.md) 共通ルール）
レビュー時の **失格チェック**でもある。
- 歌詞・タイミングは **TextAlive App API 以外から取得しない**。歌詞全文をローカルに埋め込まない。
- **AI生成画像・音楽・文章を作品出力に使わない**（開発支援はOK）。
- 公式ロゴ・公式画像・公式SNS素材を使わない。世界の表現はすべてコード生成。
- 課題6曲のみ使用。動的サーバーを追加しない（静的維持）。
- `npm run build` が通ることは必須。
- destroy 処理・イベントリスナー解除・WebGL/PixiJS リソース破棄を必ず行う。
- PC Chrome / iOS Safari / Android Chrome を意識（iOS では AudioContext をユーザー操作後に開始）。

### 2-3. セットアップ
```bash
npm install
cp .env.example .env.local   # VITE_TEXTALIVE_TOKEN を設定
npm run dev
```

---

## 3. アーキテクチャ（コードの歩き方）

### 3-1. 起動フロー
[main.js](../src/main.js) `Application` がエントリ。
1. `PlayerControls` / `VolumeControl` 初期化、`playerManager.init()` で TextAlive Player 生成。
2. プロローグ（[StoryIntro.js](../src/ui/StoryIntro.js)）→ 完了で `WorldUI`（湖の世界）生成。再訪（`mm_seen_intro`）や `?skipIntro=1` でスキップ。
3. 湖で曲を選ぶと、その曲の `Song*` クラスを **動的 `import()` で遅延ロード**してインスタンス化しシーン遷移（[ScreenFade.js](../src/ui/ScreenFade.js) でクロスディゾルブ）。曲チャンク（＋pixi/three-vrm）は初回バンドルに含めず、選択時のみ取得する（`main.js` の `SONG_LOADERS`／`switchToSongScene`）。遷移カーテンがロード待ちを隠す。

`main.js` には、Chrome/iOS のメディア割り込み（AbortError）や TextAlive の並列ロード競合を握りつぶす `unhandledrejection` ハンドラがある（クラッシュ扱いしないため）。

### 3-2. コア基盤（[src/core/](../src/core/)）
| ファイル | 役割 |
|---|---|
| [appState.js](../src/core/appState.js) | グローバル状態。`currentSongId / isPlaying / completedSongs`。曲クリアで `markSongComplete` → phase 進行・`allSongsComplete` 発火。`localStorage('completedSongs')` で永続化。 |
| [eventBus.js](../src/core/eventBus.js) | 最小 pub/sub（`on/off/emit`）。`timeUpdate / songChange / timerReady / songComplete / songResult` などで疎結合。 |
| [player.js](../src/core/player.js) | `PlayerManager`。TextAlive の `onAppReady/onVideoReady/onTimerReady/onPlay…` を eventBus に橋渡し。`seek/play/pause/fadeIn`。チュートリアル中の暴発自動再生を流量制御付きで抑止。 |
| [performance.js](../src/core/performance.js) / [resourceTracker.js](../src/core/resourceTracker.js) | FPS/負荷・リソース追跡。 |
| [constants.js](../src/config/constants.js) / [songs.js](../src/config/songs.js) | フェーズ定義 / 6曲のメタ（後述）。 |

### 3-3. 曲のライフサイクル（[BaseSong.js](../src/songs/BaseSong.js)）
全曲が `BaseSong` を継承。各曲は以下を実装/オーバーライドする。
- `init()` → `timerReady` 後にチュートリアル表示。`animate()`（rAF ループ）内で `update()` → `render()`。
- `update()` は TextAlive 公式タイマー `player.timer.position` に同期して `findWord/findPhrase` で歌詞を更新。
- `getSmoothedTime()`: TextAlive の粗いタイマー（100〜1000ms間隔）を rAF 解像度に補間。**重要**: 補間中に currentTime へ戻すと `age` が負→ opacity=0 で歌詞が消えるバグになるので戻さない。
- `destroy()`: rAF 停止、リスナー解除、`lyricRenderer.destroy()`、DOM除去。**各曲は Three.js/PixiJS リソースの dispose を必ず追加実装すること**。
- `setResultSummary({lines, accentColor, swatch})`: 曲終了オーバーレイに出す成果サマリーを `songResult` で送る。

### 3-4. 湖UI（[src/lake/](../src/lake/)）
- [WorldUI.js](../src/lake/WorldUI.js) / [LakeUI.js](../src/lake/LakeUI.js): 3D湖面・6波紋・曲ラベル追従・遷移。
- [LakeShader.js](../src/lake/LakeShader.js) / [RippleSystem.js](../src/lake/RippleSystem.js) / [Transition.js](../src/lake/Transition.js)。
- [phases/](../src/lake/phases/): フェーズごとの自然演出（Lake/Rain/River/Mist/Clouds/Puddles…）。クリア数で湖の景色が育つ。
- [lakeMemory.js](../src/lake/lakeMemory.js): 1-3 の創作ループ基盤。

### 3-5. 共通UI（[src/ui/](../src/ui/)）
`TitleScreen / StoryIntro / LoadingScreen / ErrorScreen / PlayerControls / VolumeControl / LyricRenderer / CompletionScreen / Credits / ScreenFade`。
共通操作: マウス/タッチで波紋選択、**Space**=再生/一時停止、**Escape**=湖へ戻る、**左右キー**=曲送り（※キーボードは補助。主導線はクリック/タップ）。

---

## 4. 6曲それぞれの詳細

共通: 各曲は `themeQuestion`（問い）と `color`（テーマ色）と `waterBehavior`（湖面での水の振る舞い）を持つ。詳細は [songs.js](../src/config/songs.js)、実装は `src/songs/song-<id>.js`。

| 曲 (id) | タイトル / アーティスト | テーマ色 | 水の振る舞い | ミク表現の方針 |
|---|---|---|---|---|
| **kotaete** | こたえて / imie | `#7F77DD` 紫 | boiling | **主役化**（ボーン律動グルーヴで踊る） |
| **after** | アフター・ザ・カーテン / Rulmry | `#1D9E75` 緑 | residue | **脱literal**（逆光シルエット・影絵） |
| **shutter** | シャッターチャンス / 夜未アガリ | `#D85A30` 橙 | freeze | **被写体で主役**（三点照明・回り込み撮影） |
| **orchestra** | 世界最後の音楽隊 / 夏山よつぎ×ど〜ぱみん | `#185FA5` 青 | evaporate | **静かな主役**（ゼロ重力で漂う・踊らせない） |
| **tricktology** | トリツクロジー / 鶴三（Vo.鏡音リン） | `#3C3489` 藍 | mirror | **鏡像が概念**（少数を綺麗に） |
| **takeover** | TAKEOVER / Twinfield | `#FF3A3A` 赤 | explosion | **モデルなし**（UI概念として正しい） |

### 4-1. こたえて（kotaete）— [song-kotaete.js](../src/songs/song-kotaete.js)
- 問い:「あなたが僕ならばどんな答えを出すでしょうか」
- 体験: ミクが先導する回廊を駆け抜ける。流れる歌詞にタッチで共鳴し光がミクへ届く。サビごとに「問い」が届き、答えを選ぶと世界が混色（全3回）。ラストに「あなたの答えの色」が世界を満たす。
- **創作ループの本実装**: フィナーレで「この色はどんな問いへの答え？」入力 → `saveUserQuestion` で `type:'question'` 波紋を [lakeMemory](../src/lake/lakeMemory.js) へ。過去の問いが回廊にエコー波紋として再来し、触れて応えられる（`spawnEchoRipple/updateEchoes/resonateEcho`）。「湖の問い N」カウンタ常設。**他曲展開のテンプレート**。
- ミク: ビートで踊る = ボーン律動（`applyGroove/grooveConfig`）。**ダンス基盤の実装はこの曲のみ**。

### 4-2. アフター・ザ・カーテン（after）— [song-after.js](../src/songs/song-after.js)
- 問い:「終わりの後に何が残るのか」
- 体験: 暗闇でスポットライト（指/マウス）を動かし、隠れた歌詞とミクを照らす。照らし切った歌詞は消える時に客席の灯として残る。タップでバラの紙吹雪が床に積もり終演まで残る。
- ミク: **A案=逆光シルエット**を採用。`rimLight`（背後・ティール `themeColor` の SpotLight・castShadow）で輪郭をティール発光＋手前へ長い影。呼吸（breath）とサビ（poseBlend）に同期して脈動。「小さく暗い」を「神秘的に光る影絵＝公演後の孤独な演者」へ転換。

### 4-3. シャッターチャンス（shutter）— [song-shutter.js](../src/songs/song-shutter.js)
- 問い:「この瞬間を永遠にできるか」。Vo. は初音ミク & 鏡音リン（デュエット曲）。
- 体験: クリック/Enter でシャッター。ステージ奥のミクも一緒に写る。サビやデュエット中の撮影は★ベストショット。撮った写真は終盤にフィルムロールで戻る（最大12枚）。
- ミク: **被写体で主役**。ズーム機構 `camera.fov=75/zoomLevel`(0.6〜2.5)。**三点照明**（ambient を抑えコントラスト、`keyLight` で顔/身体、`rimLight`=ティールで輪郭分離）。カメラは被写体中心の **オービット（回り込み）**（`orbitPivot=(0,0,-16.5)`, `orbitRadius=26.5`）。歌詞スプライトは毎フレーム `pivot + localOffset.applyQuaternion(camera.quaternion)` でカメラ追従させ常に正面・読みやすく保つ。
- **実装済**: デュエット2体目の鏡音リン（`model_rin.vrm`）が到着・配線済み。shutter は ミク＋リンの2体を読み込む（`song-shutter.js`）。リンは Vo.鏡音リンの「トリツクロジー」でも使用。

### 4-4. 世界最後の音楽隊（orchestra）— [song-orchestra.js](../src/songs/song-orchestra.js)
- 問い:「空はどんな色？あなたはどんなカタチ？」
- 体験: 浮かぶ歌詞に触れると意味に応じた色のオーブが生まれ、左端ゲージに色の層として積もる。サビでオーブはすべて花火になり、多く集めるほど夜空が大連鎖。
- ミク: **静かな主役**。ゼロ重力で漂う（踊らせない）。

### 4-5. トリツクロジー（tricktology）— [song-tricktology.js](../src/songs/song-tricktology.js)
- 問い:「水面に映るあたしと本物のあたしはどちら？」。Vo. 鏡音リン。
- 体験: 水面をなぞると波紋が走り鏡の世界が歪む（波のピークで明暗反転）。水鏡のミク/リンは呼吸がずれ、たまにこちらを見る。サビで世界ごと反転。終わりに「本物はどっち？」で選んだ世界だけが残る。
- ミク/リン: **鏡像が概念**。モデルは少数を綺麗に見せる方向。

### 4-6. TAKEOVER（takeover）— [song-takeover.js](../src/songs/song-takeover.js)
- 問い:「世界を変えるのは誰か」
- 体験: 暗号化された歌詞をクリック/タップで解読。4秒以内の連続解読でコンボ、解読するほど世界が赤く侵食。解読率100%で `TAKEOVER COMPLETE`。
- ミク: **モデルなし**（UI/概念で表現するのが正しい、と意思決定済み）。

---

## 5. 制作・検証ツール（design/）
- [design/capture-dance.mjs](../design/capture-dance.mjs): 曲シーンの自動キャプチャ。環境変数 `SONG`（曲id）/`LABEL`/`SEEK`/`LIGHT=1`（撮影中マウスでスポット追従）対応。
- `design/<song>/` に検証用の動画・フレームが置かれる。

---

## 6. レビューの前提知識（採点はどう行われるか）
このアプリは [magical_mirai_2026_eval_prompt.md](../magical_mirai_2026_eval_prompt.md) + [eval_master.js](../eval_master.js) による **6軸の絶対評価**（最優秀賞水準=100）で定点観測される。レビューはこの軸に沿って行うと審査と齟齬が出ない。

コンテスト加重スコア = **クリエイティビティ35% + イノベーション35% + 完成度30%**。

| 軸 | 観点 |
|---|---|
| 軸1 | マジカルミライ最優秀賞を取れるか |
| 軸2 | 各楽曲を魅力的に見せているか |
| 軸3 | インタラクション要素が正しく実装されているか |
| 軸4 | 初見ユーザーが迷わず遊べるか |
| 軸5 | 一般的なゲームアプリと比べた UI/UX |
| 軸6 | 一般的なミュージックビデオと比べた魅力 |
| 軸7 | 一般ユーザー審査（参考・加点しない） |

評価方針の注意: **選曲・再生を ArrowRight/Space 前提にしない**（クリック/タップが主導線）。操作不明は「初見導線の問題」として記録する。

---

## 7. このアプリをレビューする（実践手順）

### 7-1. まず動かす
```bash
npm install
npm run build      # ★ build が通ることは必須条件。落ちたら即・重大
npm run dev        # または npm run preview
```
ブラウザで開き、コンソールにエラーが出ないことを確認。

### 7-2. 機能レビュー（毎回・全曲）
[regression-checklist.md](./regression-checklist.md) と [visual-review-checklist.md](./visual-review-checklist.md) を使う。要点:
1. **湖UI**: 水面シェーダー/波紋が動く、6曲ラベルが波紋に追従、ホバー拡大→クリックでロード開始。
2. **ロード/初期化**: ローディング表示が破綻しない、TextAlive 初期化でクラッシュや強制戻りがない。
3. **再生中**: Space/ボタンで再生・一時停止、歌詞が**主役として読める**、曲固有演出が同期、描画バグ（黒背景と同化/opacity=0）がない、パララックス/波紋が動く。
4. **破棄**: Escape/戻るで完全破棄→湖へ。曲切替で前曲のリスナー（Space競合）/Three.jsリソースが残らない。最後まで再生で `onStop` → 完了状態に。
5. **モバイル**: スマホ幅でUIが破綻しない、タップ領域が押しやすい、回転/resize対応。
6. **異常系**: token 未設定時にエラー表示。

### 7-3. 方針レビュー（コードを変える/提案する時）
3章のコードマップで該当箇所を読み、以下を満たすか:
- **方針A**: 操作統一の提案になっていないか。導入演出（チュートリアル/初見・再訪出し分け）を壊していないか。
- **方針B**: ミク表現が「曲ごとの個別設計」を崩していないか（kotaete のダンスを安易に横展開していないか）。「主役にできないなら出さない」に反していないか。
- **創作ループ**: lakeMemory を使う曲で、波紋の堆積/再来が成立しているか。
- **独立性**: 曲別モジュールが他曲の演出に影響していないか。`destroy` でリソース破棄しているか。

### 7-4. レギュレーション・チェック（失格防止／2-2 と対応）
- TextAlive 以外から歌詞取得していない / 歌詞全文埋め込みなし。
- AI生成物・公式素材を出力に使っていない。
- 6曲のみ・静的構成・トークン直書きなし。

### 7-5. 採点レビュー（任意・定点観測）
審査と同形式で評価したい場合は eval ハーネスを使う:
```bash
node eval_master.js   # APP_URL / DEV_COMMAND を環境変数で上書き可
```
6軸スコアと差分レポートが出る。レビューコメントは 6章の軸に紐づけて書くと審査基準と揃う。

### 7-6. 大きめの変更をしたら
- [CHANGELOG_AI.md](../CHANGELOG_AI.md) に変更内容・影響範囲・確認結果を記録（[AGENTS.md](../AGENTS.md) 共通ルール）。
- `npm run build` が通ること、6曲ロード/湖へ戻る/曲切替/再生停止/モバイル幅を再確認。

---

### 参考リンク
- 設計思想の補足: [docs/review-loop.md](./review-loop.md) / [docs/agent-roles-review-loop.md](./agent-roles-review-loop.md)
- 担当割り: [AGENTS.md](../AGENTS.md)（Director / Regulation Guard / TextAlive / Lake UI / Song Scene / Interaction / Performance / QA / Documentation の9ロール）
- テスト計画: [TEST_PLAN.md](../TEST_PLAN.md)
