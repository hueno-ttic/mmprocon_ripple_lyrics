// デプロイ単位で開発者向け機能を出し分けるためのフラグ。対象は2つ:
//   - デバッグモード（?debug=1 で起動する DebugPanel）
//   - 単独ポーズ作成ページ /pose-editor.html へのアクセス可否
// ※ ゲーム内（シャッター曲）のポーズエディタは本フラグの対象外で、常に利用可能。
//
// 判定ルール:
//   - ローカル開発(npm run dev / vite serve)では常に有効 … import.meta.env.DEV
//   - 本番ビルドでは環境変数 VITE_DEV_TOOLS=1 を渡したときのみ有効
//
// 使い方（デプロイ時の出し分け）:
//   公開・提出用ビルド … `npm run build`                 → デバッグ／pose-editor.html を無効化
//   内部・検証用ビルド … `VITE_DEV_TOOLS=1 npm run build` → 両方を有効化
//
// 同じ判定を Node 側（vite.config.js）でも使い、pose-editor.html を
// 本番ビルドに含めるかどうかを切り替えている（loadEnv で VITE_DEV_TOOLS を参照）。
export const DEV_TOOLS_ENABLED =
    import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === '1';
