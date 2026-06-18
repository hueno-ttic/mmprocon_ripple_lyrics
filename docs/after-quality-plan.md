# アフター・ザ・カーテン クオリティ向上 実装計画書

作成日: 2026-06-18 / 対象: `src/songs/song-after.js`（988行）, 関連: `src/songs/BaseSong.js`, `src/core/player.js`, `src/config/songs.js`

## 0. 前提・現状サマリ

コンセプト（暗闇をスポットライトで照らす → 歌詞を「照らし切る」と客席の灯になって残る → 終演でカーテンが閉じる）は明確。ただし他曲（kotaete 2371行 / orchestra 2100行）に比べ実装が約4〜6割薄く、UX・生命感・音楽同期・見栄えに伸びしろがある。

確認済みの事実:
- `findBeat` 利用可（`design/after/samples.json` の probe: `beatCount:1035, hasFindBeat:true`）。サビは `findChorus` 利用可。**ビート同期はライブAPIで実現でき、samples.json は値チューニングの参考データ**（ベイク不要）。
- 口パク・表情は kotaete が `expressionManager.setValue('aa'|'ih'|'ou'|'ee'|'oh'|'blink'|'happy'|'relaxed', v)` + `_vowelOf()` で実装済（[song-kotaete.js:568-616](../src/songs/song-kotaete.js)）。after には**一切無い**。
- 実尺 `260740ms`（≒4:20）, firstChorus `70500ms`。after の終演は `duration - 7000` ハードコード（[song-after.js:725](../src/songs/song-after.js)）。

---

## 第1段：序盤UX / 自動再生バグ（最優先・他段の前提）

### 1-1. 自動再生バグの確定と堅牢化
- **現状**: 「スタート」→ 共通 `_autoStartPlayback()`（[BaseSong.js:82](../src/songs/BaseSong.js)）。経路は正しく見えるが、`if (!playerManager.isTimerReady) return;` の早期returnに**リトライが無い**。after は最重量シーン（VRM+WebGL）でタイマー準備が遅れやすく、ここで無音化する疑い。
- **対応**:
  1. 実機で after を再生し再現確認（dev サーバ + TextAlive トークン）。
  2. `_autoStartPlayback()` を堅牢化: `isTimerReady` 未達なら `timerReady` を1回待ってから再生（早期return廃止）。フェイルセーフのワンタップ「Play」復帰も用意。
- **対象**: `BaseSong.js`（共通修正のため全曲に裨益）

### 1-2. 序盤の導入フィードバック（真っ暗問題）
- **現状**: `lyricRenderer.update(null)`（[song-after.js:769](../src/songs/song-after.js)）でDOM歌詞を常時抑制。照らせるまで画面がほぼ真っ暗で「何をすればいいか分からない」。
- **対応**:
  1. 冒頭〜初回ヒット前のみ、スポットライト位置に淡い誘導リング/「ここを動かして照らして」ガイドを表示し、最初の照射で消す。
  2. 近接ヒント: 歌詞/ミクにスポットが近づくと微かに予兆発光（“もう少し”のフィードバック）。
- **対象**: `song-after.js`（update描画・新規ガイド要素）

---

## 第2段：音楽同期の深化（第3・4段の土台）

### 2-1. ビート駆動の基盤を追加
- **現状**: サビ判定・歌唱パルスのみ。`beatPulse` 等のリズム情報を未使用。
- **対応**:
  1. update内で `player.findBeat(position)` を取得し、`beatProgress`（拍内位相 0→1）と `onBeat` パルスを算出（kotaete [song-kotaete.js:1226](../src/songs/song-kotaete.js) を参考）。
  2. 既存演出をビートに同期:
     - スポットライトの自動スイープ/明滅に微小な拍ドリブンの脈動。
     - 客席の灯のフリッカに拍成分を加える。
     - バラ落下のフラッターに拍位相を反映。
- **対象**: `song-after.js`

### 2-2. ハードコード値の整理（同期の信頼性向上）
- `finaleStart = duration - 7000` を**実尺ベース**へ（`player.video.duration` を参照、無ければ安全フォールバック）。
- `litThreshold(1400)` / 感知半径 `3.2` / バラ焼込 `900ms` 等をファイル冒頭の名前付き定数（または曲configブロック）に集約しコメント根拠化。
- **対象**: `song-after.js`

---

## 第3段：ミクの生命感

### 3-1. 口パク・表情（最大の体感差）
- **対応**: kotaete の手法を after の世界観（静かな終幕→サビで解放）に合わせて移植。
  1. `currentVRM.expressionManager` で歌唱中の母音口形（`findChar().text` → `_vowelOf()` → `aa/ih/ou/ee/oh`）。
  2. `blink` 自然まばたき。
  3. 表情: 平常は `relaxed` 寄り、サビ（星空を見上げる）で `happy` を上げる。終演で静かに戻す。
- **対象**: `song-after.js`（updateMiku 拡張）

### 3-2. モーション精緻化
- 呼吸・頭部トラッキング（実装済）に、第2段の拍を薄く乗せて“歌っている”自然な揺れを付与。逆光リムライト（実装済）と整合させる。
- **対象**: `song-after.js`

---

## 第4段：演出の見栄え強化

- **照らす演出**: 照射時のボリューム感（淡いゴッドレイ/ダスト粒子）、照らし切り時のフラッシュ強化。
- **客席の灯**: 飛翔軌跡の残光トレイル、点灯時の柔らかなブルーム。
- **終演カーテン**: 閉幕の布の波打ち・影、最後に残る「床のバラ＋客席の灯」のコントラスト演出を磨く。
- **対象**: `song-after.js`（性能はモバイル分岐 `isMobile` を踏襲し粒子数を抑制）

---

## 進め方・検証
- 各段ごとに dev サーバで after を起動し、`eval_drive.cjs`（[eval-harness-song-driving](../../memory/eval-harness-song-driving.md) 参照、`eval_master.js` は0/6誤記録のため不使用）で全曲起動回帰。
- 変更は段ごとに小さくコミットし `changelogs/song-after.md` に追記。
- 回帰: `docs/regression-checklist.md` / `docs/visual-review-checklist.md` を使用。

## リスク / 留意
- 第1段の `BaseSong._autoStartPlayback` 変更は全曲共通 → 回帰必須。
- 口パクは VRM の expression プリセット有無に依存（kotaeteで動作実績あり、同一 `model_miku.vrm` 共有なので可）。
- ビート/サビAPIは `typeof ...=== 'function'` ガードで欠損環境を保護（既存方針踏襲）。
