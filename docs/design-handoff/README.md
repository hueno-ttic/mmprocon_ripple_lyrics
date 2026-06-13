# Claude Design 連携手順(コピペとドラッグ&ドロップだけでOK)

## レギュレーション安全の仕組み
- Claude Designの成果物は**参考資料**としてのみ使用し、画像・HTMLをアプリに組み込まない
- 受け渡しフォルダ `design_refs/`(現状スクショ)と `design_drafts/`(Design成果物)は
  **gitignore済み** → リポジトリにもビルド成果物にも一切入らない
- 実装は従来どおりThree.jsのコード生成3D(Claude Code側が翻訳して実装)

## 手順

1. ブラウザで **https://claude.ai/design** を開く(Pro/Maxプランでログイン)
2. 新しいデザインを作成
3. `docs/design-handoff/claude-design-prompt.md` の内容を**全文コピーして貼り付け**
4. Finderで `design_refs/` フォルダを開き、**7枚のJPGをチャットにドラッグ&ドロップ**
   - phase0-hare.jpg 〜 phase6-mizuumi.jpg
5. 送信して、出てきたデザイン案に対して気に入るまで指示を返す
   (例:「ひまわりをもっと密集させて」「空をもう少し夕方寄りに」)
6. 気に入った案ができたら、エクスポートで **ZIP をダウンロード**
   (または「Claude Codeに引き継ぐ」があればそれを使用)
7. ダウンロードしたZIPを **`design_drafts/` フォルダにドラッグ&ドロップ**
8. Claude Code(このセッション)に「design_draftsに入れたよ」と一言伝える
   → 中身を読んでThree.js実装に翻訳します

## 現状スクショの再生成
シーンを更新した後に最新のスクショを撮り直したい場合は、
Claude Codeに「design_refsのスクショを撮り直して」と伝えるだけでOK
(開発サーバーの `/__save_shot` エンドポイント経由で自動取得します)
