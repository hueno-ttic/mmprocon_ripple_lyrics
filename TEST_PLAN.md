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
