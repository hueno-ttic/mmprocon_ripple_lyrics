// ─────────────────────────────────────────────────────────────
// シャッターチャンス: 被写体(ミク/リン)の「可愛い動き」ストック
//
// 各プリセットは applySubjectGroove(song-shutter.js)に渡す grooveConfig と、
// 腕の基調(armStyle)で1つのダンスを定義する。複数サブエージェントで設計・
// 審査・統合したものを在庫として保持する。曲開始時に1つ適用する。
//
// config キーの意味は song-shutter.js の this.grooveConfig 定義を参照。
// armStyle: relaxed/wave/appeal/cheer/peace/faceHands/handsOnHips/point/heart
// ─────────────────────────────────────────────────────────────

export const SHUTTER_DANCE_PRESETS = [
  {
    name: 'bouncy_pop',
    label: 'ぴょこぴょこポップ',
    concept: '膝とホップで弾む縦ノリ全開の明るい元気ポップ',
    armStyle: 'cheer',
    config: { gain: 1.1, climaxGain: 1.45, punch: 0.12, sway: 0.13, twist: 0.18, headNod: 0.16, kneeBounce: 0.30, step: 0.10, hipDrop: 0.09, hop: 0.16, armSway: 0.14, armBob: 0.22, armPump: 0.50, shoulder: 0.10 },
  },
  {
    name: 'genki_full_throttle',
    label: '全力げんきジャンプ',
    concept: 'サビで両手を突き上げ弾けるように飛び跳ねるキレッキレ全力アイドル',
    armStyle: 'cheer',
    config: { gain: 1.15, climaxGain: 1.60, punch: 0.20, sway: 0.16, twist: 0.32, headNod: 0.16, kneeBounce: 0.28, step: 0.14, hipDrop: 0.09, hop: 0.17, armSway: 0.22, armBob: 0.20, armPump: 0.72, shoulder: 0.09 },
  },
  {
    name: 'pointing_kimekime',
    label: '指さしキメキメ',
    concept: '小節頭でビシッと指さしを決めるメリハリの効いたキメ系',
    armStyle: 'point',
    config: { gain: 1.05, climaxGain: 1.50, punch: 0.20, sway: 0.16, twist: 0.42, headNod: 0.12, kneeBounce: 0.18, step: 0.08, hipDrop: 0.06, hop: 0.15, armSway: 0.14, armBob: 0.10, armPump: 0.55, shoulder: 0.07 },
  },
  {
    name: 'heart_burikko_pop',
    label: 'きゅるんハート全開',
    concept: '顔の横でハートを作りつつ甘く左右に揺れ、サビで両手を高く振り上げるぶりっ子全開',
    armStyle: 'heart',
    config: { gain: 1.0, climaxGain: 1.55, punch: 0.11, sway: 0.22, twist: 0.42, headNod: 0.16, kneeBounce: 0.15, step: 0.08, hipDrop: 0.05, hop: 0.09, armSway: 0.18, armBob: 0.12, armPump: 0.62, shoulder: 0.07 },
  },
  {
    name: 'flowing_wave',
    label: 'ゆらめきウェーブ',
    concept: '腕と上半身が波打つように左右へ流れるしなやかな揺れ',
    armStyle: 'wave',
    config: { gain: 1.0, climaxGain: 1.25, punch: 0.09, sway: 0.24, twist: 0.42, headNod: 0.11, kneeBounce: 0.16, step: 0.06, hipDrop: 0.04, hop: 0.05, armSway: 0.34, armBob: 0.12, armPump: 0.40, shoulder: 0.06 },
  },
  {
    name: 'fuwafuwa_sway',
    label: 'ふわふわ脱力スウェイ',
    concept: '力を抜いて左右にゆらゆら、風に揺れる花のような脱力かわいい',
    armStyle: 'relaxed',
    config: { gain: 0.85, climaxGain: 1.15, punch: 0.07, sway: 0.26, twist: 0.42, headNod: 0.07, kneeBounce: 0.09, step: 0.03, hipDrop: 0.02, hop: 0.03, armSway: 0.34, armBob: 0.05, armPump: 0.18, shoulder: 0.03 },
  },
  {
    name: 'shy_modest_sway',
    label: 'はにかみ揺れ',
    concept: '顔の前で手を寄せ、控えめに小刻みな頭と肩で照れたように揺れる',
    armStyle: 'faceHands',
    config: { gain: 0.82, climaxGain: 1.15, punch: 0.09, sway: 0.10, twist: 0.42, headNod: 0.10, kneeBounce: 0.11, step: 0.04, hipDrop: 0.03, hop: 0.04, armSway: 0.08, armBob: 0.07, armPump: 0.18, shoulder: 0.10 },
  },
  {
    name: 'poised_elegance',
    label: 'お澄ましエレガンス',
    concept: '腰に手を当て、ひねりと視線で魅せる落ち着いた上品グルーヴ',
    armStyle: 'handsOnHips',
    config: { gain: 0.85, climaxGain: 1.20, punch: 0.10, sway: 0.20, twist: 0.55, headNod: 0.20, kneeBounce: 0.12, step: 0.05, hipDrop: 0.04, hop: 0.04, armSway: 0.08, armBob: 0.05, armPump: 0.18, shoulder: 0.04 },
  },
  // ── ラウンド2(30体探索→審査→実描画検証で採用)──
  {
    name: 'burikko_face_pop',
    label: 'ぶりっ子顔よせポップ',
    concept: '顔の横に手を寄せ、頭・肩・腕を小刻みに弾ませる元気ぶりっ子。サビは手を突き上げて笑顔',
    armStyle: 'faceHands',
    config: { gain: 1.05, climaxGain: 1.50, punch: 0.10, sway: 0.16, twist: 0.30, headNod: 0.20, kneeBounce: 0.20, step: 0.09, hipDrop: 0.05, hop: 0.11, armSway: 0.10, armBob: 0.20, armPump: 0.60, shoulder: 0.11 },
  },
  {
    name: 'cute_step_touch',
    label: 'キュートステップタッチ',
    concept: '左右への足踏みステップで体重を運び、ピースを拍ごとに弾ませてカメラ目線で魅せる横ノリ',
    armStyle: 'peace',
    config: { gain: 1.08, climaxGain: 1.42, punch: 0.11, sway: 0.23, twist: 0.22, headNod: 0.15, kneeBounce: 0.18, step: 0.26, hipDrop: 0.06, hop: 0.10, armSway: 0.16, armBob: 0.24, armPump: 0.56, shoulder: 0.09 },
  },
  {
    name: 'idol_appeal_lr',
    label: 'アイドル王道アピール',
    concept: 'カメラ正面で左右交互に重心を移しながら腕を差し出す王道アイドルのアピール振り',
    armStyle: 'appeal',
    config: { gain: 1.10, climaxGain: 1.50, punch: 0.12, sway: 0.27, twist: 0.24, headNod: 0.18, kneeBounce: 0.24, step: 0.13, hipDrop: 0.07, hop: 0.13, armSway: 0.30, armBob: 0.26, armPump: 0.66, shoulder: 0.09 },
  },
];

// 既定で使う最も汎用的に可愛いプリセット
export const SHUTTER_DANCE_DEFAULT = 'bouncy_pop';
