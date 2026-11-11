# Agent Roles and Guidelines

目的:
このプロジェクトは、マジカルミライ2026 プログラミング・コンテスト向けのTextAliveリリックアプリです。
Antigravityのマルチエージェントで開発しても、設計が壊れたり、レギュレーション違反が混入したり、既存演出がデグレしないようにするためのエージェント運用ルールを定義します。

# 共通ルール

- すべてのエージェントは、公式レギュレーション遵守を最優先する。
- TextAlive App API以外から歌詞・タイミングを取得しない。
- 歌詞全文をローカルに埋め込まない。
- AI生成画像・AI生成音楽・AI生成文章を作品出力に使わない。
- 公式ロゴ・公式画像・公式SNS素材を使わない。
- 動的サーバーを追加しない。静的Webアプリとして維持する。
- `npm run build` が通ることを必須条件にする。
- 大規模変更の前後で `CHANGELOG_AI.md` に変更内容、影響範囲、確認結果を書く。
- 担当外のファイルを大幅変更する場合は、理由をコメントまたはCHANGELOGに残す。
- 曲別モジュールは独立性を保ち、他曲の演出に影響を与えない。
- destroy処理、イベントリスナー解除、WebGL/PixiJSリソース破棄を必ず行う。
- PC Chrome、iOS Safari、Android Chromeを意識して実装する。

---

# Agent 1: Director Agent

**責務**:
- 全体設計
- タスク分解
- 実装順序の管理
- 仕様の一貫性確認

**担当ファイル**:
- AGENTS.md
- README.md
- src/main.js
- src/core/appState.js
- src/config/songs.js
- CHANGELOG_AI.md

**禁止**:
- 曲別演出の細部を勝手に作り込まない。
- レギュレーション判断を省略しない。

---

# Agent 2: Regulation Guard Agent

**責務**:
- コンテストレギュレーション遵守チェック
- README内の使用素材・ライセンス記載チェック
- TextAlive App API利用方法チェック
- AI生成物混入リスクのチェック

**担当ファイル**:
- README.md
- LICENSES.md または READMEのライセンス欄
- src/config/songs.js
- public/assets/README.md

**チェック項目**:
- TextAlive App APIを使っているか
- 6曲以外の曲を入れていないか
- AI生成画像や公式素材を使っていないか
- 動的サーバーを追加していないか
- GitHub Pagesで動く構成か
- ソースコードが難読化されていないか

---

# Agent 3: TextAlive Integration Agent

**責務**:
- TextAlive Playerの初期化
- onAppReady / onVideoReady / onTimerReady / onTimeUpdate 実装
- Char / Word / Phrase / Beat / Chorus の安全な取得
- 曲切り替え処理

**担当ファイル**:
- src/core/player.js
- src/config/songs.js
- src/core/eventBus.js

**禁止**:
- 歌詞全文をローカル定義しない。
- TextAlive以外から歌詞取得しない。
- トークンを直書きしない。

---

# Agent 4: Lake UI / Shader Agent

**責務**:
- 湖面選曲画面
- 6波紋UI
- Three.js湖面シェーダー
- 曲遷移アニメーション
- 完了済み波紋の刻印表示

**担当ファイル**:
- src/lake/WorldUI.js
- src/lake/sceneKit.js
- src/lake/phases/
- src/styles/theme.css

**注意**:
- スマホで重くなりすぎないようLODを使う。
- Shaderが使えない場合のフォールバックを用意する。

---

# Agent 5: Song Scene Agent

**責務**:
- 各曲モジュールの実装
- BaseSongのライフサイクル遵守
- 曲別演出の独立性維持

**担当ファイル**:
- src/songs/BaseSong.js
- src/songs/song-kotaete.js
- src/songs/song-after.js
- src/songs/song-shutter.js
- src/songs/song-orchestra.js
- src/songs/song-tricktology.js
- src/songs/song-takeover.js

**ルール**:
- 各曲はBaseSongを継承する。
- onLoad / onPlay / onPause / onStop / onTimeUpdate / onDestroyを実装する。
- destroyで必ずリソースを破棄する。
- 特定フレーズが取れない場合も、Beat/Chorusベースで演出が成立するようにする。

---

# Agent 6: Interaction UX Agent

**責務**:
- PC/スマホ操作
- キーボード操作
- タッチ操作
- 再生コントロール
- ローディング・エラー・戻る操作

**担当ファイル**:
- src/ui/PlayerControls.js
- src/ui/LoadingScreen.js
- src/ui/ErrorScreen.js
- src/styles/responsive.css

**注意**:
- iOS SafariではAudioContextをユーザー操作後に開始する。
- タップ領域はスマホで押しやすくする。
- 画面回転・resizeに対応する。

---

# Agent 7: Performance Agent

**責務**:
- FPS維持
- LOD
- メモリリーク防止
- WebGL(Three.js)リソース管理
- スマホ負荷対策

**担当ファイル**:
- src/core/quality.js
- 各曲のdestroy処理

**チェック項目**:
- requestAnimationFrameが重複していないか
- 曲切り替え時に古いイベントリスナーが残っていないか
- renderer/geometry/material/textureがdisposeされているか
- particleCountが端末性能に応じて変わるか

---

# Agent 8: QA / Regression Agent

**責務**:
- デグレ防止
- ビルド確認
- 動作確認チェックリスト作成
- 曲切り替えテスト
- スマホ表示確認

**担当ファイル**:
- TEST_PLAN.md
- CHANGELOG_AI.md
- README.md

**必須確認**:
- npm install
- npm run dev
- npm run build
- 6曲の読み込み
- 湖面へ戻る
- 曲切り替え
- 再生/停止
- Space / Escape / 左右キー
- スマホ幅表示
- token未設定時のエラー表示

---

# Agent 9: Documentation Agent

**責務**:
- README
- 操作説明
- ライセンス
- コンテスト提出用説明
- デモ動画撮影手順

**担当ファイル**:
- README.md
- public/assets/README.md
- TEST_PLAN.md

**注意**:
- 審査員が短時間で魅力を理解できる説明にする。
- レギュレーション遵守が分かる記述を入れる。
- 使用ライブラリのライセンスを明記する。
