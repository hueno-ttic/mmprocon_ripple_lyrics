# CHANGELOG_AI.md

## [Test & Bug Fix] Playwright導入と離脱バグ修正

### 変更内容
- `src/main.js` にて、ロード中に `Escape` キーで戻った際にローディング画面が消えないバグを修正し、`appState.setLoading(false)` を呼び出すようにしました。
- `@playwright/test` を導入し、ブラウザでの自動UI検証スクリプトを作成しました。
- `tests/visual/orchestra.spec.js` を追加し、「世界最後の音楽隊」のシーン表示、カラーピッカーの操作、ユーザードローの描画、および Escape での離脱を自動テスト・撮影するようにしました。
- `playwright.config.js` を設定し、`evidence/screenshots/` ディレクトリに実行時のスクリーンショットと動画を出力するようにしました。

### 影響範囲
- ローカル環境での `npm run test:visual` により、手動でブラウザを開かずとも主要機能の回帰テストとスクショ撮影が行えるようになりました。
- アプリ本体にはテスト専用の不要なUIやモックデータを一切埋め込まず、クリーンな状態を保っています。


## [Phase 2] 「世界最後の音楽隊」演出実装

### 変更内容
- `src/main.js` で、曲のIDに基づいて動的に `SongOrchestra` などのクラスをインスタンス化するように変更しました。
- `src/songs/BaseSong.js` にて、曲固有のDOMをラップする `songWrapper` を導入し、`LakeUI` のキャンバスを誤って削除しないように安全な破棄ロジックに変更しました。
- `src/lake/LakeUI.js` で、コンテナ全体ではなく自身の `renderer.domElement` のみを隠すように変更しました。
- `src/songs/song-orchestra.js` を実装し、以下の演出を追加しました：
  - 宇宙空間（Pointsを用いた星フィールド）
  - TextAlive APIから取得した文字情報を動的に `CanvasTexture` 化して `THREE.Sprite` で3D配置
  - 「空」「色」のフレーズで発火するカラーピッカー機能と色変更のlocalStorage保存
  - 「形」「カタチ」のフレーズで発火するユーザードローUIと、描かれた線の3D空間への追加
  - サビ（Chorus）および曲終盤における、星が広がるクライマックス演出
- `song-orchestra.js` の `destroy()` メソッド内で、Three.js のリソース（Geometry, Material, Texture, Renderer）と DOM オーバーレイ、イベントリスナーを全て適切に破棄するようにしました。

### 影響範囲
- 湖面UIと曲シーンを切り替える際のDOM管理が堅牢になり、デグレが発生しにくくなりました。
- 「世界最後の音楽隊」を選択した際のみ、専用の演出と操作（カラーピッカー、ドロー）が発動します。
- `npm run build` が正常に通り、本番環境でも静的ファイルとして機能します。

### 動作確認・テスト
- `npm run dev` でローカルサーバーを起動し、対象楽曲の再生、歌詞の表示、カラーピッカーの表示/反映、ドロー機能の軌跡の3D化、およびEscapeキーでの画面戻りを手動で確認できます。

## [Bug Fix] イベントリスナーのメモリリーク修正 (Phase 1 Review)

### 変更内容
- `LakeUI.js` における `resize`, `click`, `mousemove` イベントリスナー登録時に `bind(this)` の戻り値をインスタンス変数として保持するよう修正しました。
- `LakeUI.js` の `destroy()` 内で `click` および `mousemove` の解除処理を追加しました。
- `LyricRenderer.js` における `resize` イベントリスナーについても同様に `bind` の参照を保持し、正確に解除されるよう修正しました。

### 影響範囲
- 曲切り替えや画面サイズ変更時にイベントリスナーが蓄積して多重発火するバグ（メモリリーク）が解消されました。
- パフォーマンスエージェント（Agent 7）が定めたリソース破棄とイベント解除のルールが遵守されるようになりました。

### 確認結果
- 修正後に `npm run build` が正常に通ることを確認しました。
- ユーザー指定の全チェック項目（トークン利用、エラー処理、波紋クリック、TextAlive初期化など）が満たされていることを再確認しました。


## [Phase 1] プロジェクト基盤の構築

### 変更内容
- Vite + Vanilla JS環境の立ち上げ（Three.js, PixiJS, textalive-app-api インストール）
- `package.json`, `vite.config.js`, `.env.example`, `index.html` の作成
- ディレクトリ構成の構築と各プレースホルダーファイルの作成
- TextAlive連携基盤 (`player.js`, `eventBus.js`, `appState.js`) の実装
- 湖面UI (`LakeUI.js`) と曲ベースクラス (`BaseSong.js`) の初期実装
- Canvas 2D を用いた最小限の歌詞表示 (`LyricRenderer.js`) の実装
- 再生コントロール (`PlayerControls.js`) の実装
- AGENTS.md, README.md, TEST_PLAN.md の作成

### 影響範囲
- プロジェクト全体のアーキテクチャが決定しました。
- 共通のイベント管理 (`eventBus`) と状態管理 (`appState`) を用いて全UI・シーンが連動するようになりました。

### 確認結果
- `npm install` および `npm run build` が正常に通ることを確認しました。
- トークン未設定時のエラー表示や、波紋クリック時の画面遷移イベントの発火を確認しました。

### 次フェーズでやるべきこと
- 各曲モジュール（`song-kotaete.js` など）の具体的な演出実装。
- `LakeUI.js` の波紋描画を ShaderMaterial に置き換え。
- パフォーマンスチューニングとリソース管理の厳密化。
