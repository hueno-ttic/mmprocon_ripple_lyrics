# CHANGELOG - トリツクロジー (SongTricktology)

本ファイルでは、楽曲『トリツクロジー』（`song-tricktology.js`）専用の演出強化、バグ修正、および機能拡張の歴史を記録・管理します。

---

## 📅 2026-05-26: [Vocal Pulse & Climax Illusion Polish] 歌い出し連動パルスおよびサビ反転演出の最適化

### 変更内容
* **歌唱ビートに同期した「発話連動パルス」演出の実装**:
  * 鏡音リンの歌い出しに合わせて、対応する3D歌詞スプライトが **1.25倍に脈動拡大し、純白に強くグロウ自発光** する演出を実装。
  * 歌詞のフェードイン時間を **150ms** に、フェードアウトを **200ms** に短縮し、感覚的な描画ラグを根絶。

---

## 📅 2026-05-25: [Quality Up & findChorus Crash Fix] アニメーションループ内での例外クラッシュ完全解決

### 変更内容
* **`findChorus` 例外クラッシュの完全修正**:
  * アニメーションループ内で発生していた `TypeError: ...findChorus is not a function` バグを解決。
  * TextAlive App APIの仕様に基づき、`.video.findChorus(position)` から `.findChorus(position)` への安全な呼び出しに修正し、`playerManager.player` インスタンスが存在しない場合の安全なフォールバックを完備。

---

## 📅 2026-05-25: [Resource Cleanup & Leak Prevention] WebGLリソース及びイベント監視の安全な解放の徹底

### 変更内容
* **鉄壁のクリーンアップ処理の整備**:
  * 曲シーン切り替え時のメモリリークを防ぐため、Three.js の `Reflector` 鏡面ジオメトリ、`LineSegments`、`MeshBasicMaterial`、テクスチャの完全な `dispose()` 解放を実装。
  * 画面ドラッグ用の `pointerdown`, `pointermove`, `pointerup` およびウィンドウの `resize` イベントリスナーの完全な削除を `destroy()` メソッドに実装。
