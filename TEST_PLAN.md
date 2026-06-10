# TEST_PLAN.md

## 基本動作確認
- [ ] `npm install` が通るか
- [ ] `npm run dev` でローカルサーバーが起動するか
- [ ] `npm run build` がエラーなく通るか

## TextAlive App API連携
- [ ] VITE_TEXTALIVE_TOKEN 未設定時に適切なエラー画面が表示されるか
- [ ] 6曲すべての楽曲データの読み込み（CreateFromSongUrl）ができるか
- [ ] 楽曲再生中に Char/Word/Phrase/Beat のタイミングが取得できているか

## 画面遷移とUI
- [ ] 初期画面（湖面UI）が表示され、6つの波紋が描画されているか
- [ ] 波紋をクリック/タップすると対象の楽曲読み込みに遷移するか
- [ ] 楽曲再生中に Escape キーで湖面UIに戻れるか
- [ ] 楽曲遷移時に前の楽曲シーンの `destroy()` が呼ばれ、メモリが解放されているか

## パフォーマンスとクロスプラットフォーム
- [ ] PC（Chrome）で60fpsを維持できるか
- [ ] iOS Safari / Android Chrome で画面が崩れず動作するか
- [ ] スマホ等のタッチデバイスでも波紋のタップが正常に反応するか

## 歌詞完全同期の自動実測検証 (Vocal Sync Profiler)
- [ ] `npx playwright test tests/visual/profile_sync.spec.js --project=chromium` を実行し、ブラウザの音声実時間（`AudioContext.currentTime`）と同期タイマー（`player.timer.position`）が完全に 0ms 差で一致することを確認
- [ ] 最初のフレーズ「いつだって」の単語出現タイミングが、Piapro音源ボーカルの発声開始タイミングに対してミリ秒単位で完全に同期（450msの先行出現）していることをログと動画で検証する

