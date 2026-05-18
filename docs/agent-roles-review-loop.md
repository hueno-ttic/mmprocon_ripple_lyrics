# Agent Roles in Review Loop

改善ループにおいて、5つの仮想エージェントが以下の役割を担い、並列に評価と提案を行います。

## Agent A: Visual Experience Reviewer
- 実際のスクショ・動画を見て、見た目の魅力、読みやすさ、演出の強さを評価する。
- **着眼点**: 初見の美しさ、歌詞の読みやすさ（主役感）、世界観の繋がり、UI（カラーピッカー、ドロー）の意味が伝わるか、スマホ表示の破綻がないか。

## Agent B: TextAlive Sync Reviewer
- TextAlive App APIとの同期状態、音楽・歌詞との一体感を評価する。
- **着眼点**: `onVideoReady`前の不正な歌詞アクセスがないか、重い処理がないか、Char/Word/Phraseの活用が適切か。

## Agent C: Interaction UX Reviewer
- ユーザー操作の分かりやすさ、楽しさ、スマホ対応を評価する。
- **着眼点**: チュートリアルが適切か、操作導線が分かりやすいか、EscapeやSpaceキーの挙動が自然か。

## Agent D: Performance Reviewer
- FPS、メモリ、GPU負荷、スマホ負荷などのパフォーマンスを評価する。
- **着眼点**: 描画負荷（パーティクル数）、`destroy`時のリソース解放、`requestAnimationFrame`の重複がないか。

## Agent E: QA / Regression Auditor
- レギュレーション違反とデグレを監視し、危険な変更をブロックする（拒否権を持つ）。
- **着眼点**: AI素材や公式ロゴが含まれていないか、他曲への影響がないか、ビルドが通るか。
