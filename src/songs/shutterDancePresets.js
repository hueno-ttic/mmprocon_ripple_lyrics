// ─────────────────────────────────────────────────────────────
// シャッターチャンス: 被写体(ミク/リン)の「可愛い動き」ストック
//
// 各プリセットは applySubjectGroove(song-shutter.js)に渡す grooveConfig と、
// 腕の基調(armStyle)で1つのダンスを定義する。曲開始時に1つ適用する。
//
// 探索手順: 計60体超のサブエージェントで設計→3審査員のルーブリック採点→
// 親(実描画+ルーブリック)で客観検証し、可愛く・自然で・曲(アップテンポな
// アイドルポップ)に合い・互いに重複しない12件を厳選した。
// config キーの意味は song-shutter.js の this.grooveConfig 定義を参照。
// armStyle: relaxed/wave/appeal/cheer/peace/faceHands/handsOnHips/point/heart
// ─────────────────────────────────────────────────────────────

export const SHUTTER_DANCE_PRESETS = [
  // ── cheer(両手上げ・元気)×3: バランス / 跳躍 / 足踏み で性格を分ける ──
  {
    name: 'bouncy_pop',
    label: 'ぴょこぴょこポップ',
    concept: '膝とホップで弾む縦ノリ全開の明るい元気ポップ(汎用基準)',
    armStyle: 'cheer',
    config: { gain: 1.1, climaxGain: 1.45, punch: 0.12, sway: 0.13, twist: 0.18, headNod: 0.16, kneeBounce: 0.30, step: 0.10, hipDrop: 0.09, hop: 0.16, armSway: 0.14, armBob: 0.22, armPump: 0.50, shoulder: 0.10 },
  },
  {
    name: 'pyokopyoko_vertical_cheer',
    label: 'ぴょこぴょこ縦ノリチアー',
    concept: '両手を上げたまま膝の屈伸とホップで真上に弾む縦ノリ全開',
    armStyle: 'cheer',
    config: { gain: 1.12, climaxGain: 1.55, punch: 0.14, sway: 0.10, twist: 0.14, headNod: 0.20, kneeBounce: 0.34, step: 0.07, hipDrop: 0.10, hop: 0.19, armSway: 0.12, armBob: 0.26, armPump: 0.70, shoulder: 0.12 },
  },
  {
    name: 'patapata_dash',
    label: 'ぱたぱた小走りダッシュ',
    concept: 'その場で素早く足踏みする小走り。脚を小気味よく上げ下げして駆け回る元気',
    armStyle: 'cheer',
    config: { gain: 1.12, climaxGain: 1.48, punch: 0.10, sway: 0.12, twist: 0.16, headNod: 0.18, kneeBounce: 0.20, step: 0.30, hipDrop: 0.05, hop: 0.07, armSway: 0.14, armBob: 0.28, armPump: 0.58, shoulder: 0.11 },
  },

  // ── peace(顔の横でピース)×2: その場縦弾み / 横トントンステップ ──
  {
    name: 'genki_peace_bounce',
    label: 'げんきピースバウンス',
    concept: '胸元でピースを構え、膝と腕の弾みを拍ごとに細かく弾ませるその場縦ノリ',
    armStyle: 'peace',
    config: { gain: 1.12, climaxGain: 1.48, punch: 0.13, sway: 0.15, twist: 0.20, headNod: 0.18, kneeBounce: 0.28, step: 0.07, hipDrop: 0.07, hop: 0.15, armSway: 0.13, armBob: 0.27, armPump: 0.64, shoulder: 0.10 },
  },
  {
    name: 'peace_tap_step',
    label: 'ピースでトントンステップ',
    concept: '拍ごとに左右へトントンとつま先ステップ、顔の横でピースを小刻みに弾ませる横ノリ',
    armStyle: 'peace',
    config: { gain: 1.08, climaxGain: 1.45, punch: 0.10, sway: 0.14, twist: 0.20, headNod: 0.20, kneeBounce: 0.16, step: 0.22, hipDrop: 0.05, hop: 0.08, armSway: 0.12, armBob: 0.27, armPump: 0.58, shoulder: 0.11 },
  },

  // ── appeal(腕を差し出す王道) ──
  {
    name: 'idol_lr_appeal_swaystep',
    label: '王道きらきら左右アピール',
    concept: '拍ごとに左右へしっかり重心を運び、開いた手を交互に差し出す王道アイドルアピール',
    armStyle: 'appeal',
    config: { gain: 1.12, climaxGain: 1.52, punch: 0.10, sway: 0.29, twist: 0.20, headNod: 0.19, kneeBounce: 0.21, step: 0.22, hipDrop: 0.06, hop: 0.10, armSway: 0.32, armBob: 0.24, armPump: 0.68, shoulder: 0.11 },
  },

  // ── point(指さしキメ) ──
  {
    name: 'pointing_kimekime',
    label: '指さしキメキメ',
    concept: '小節頭でビシッと指さしを決めるメリハリの効いたキメ系',
    armStyle: 'point',
    config: { gain: 1.05, climaxGain: 1.50, punch: 0.20, sway: 0.16, twist: 0.42, headNod: 0.12, kneeBounce: 0.18, step: 0.08, hipDrop: 0.06, hop: 0.15, armSway: 0.14, armBob: 0.10, armPump: 0.55, shoulder: 0.07 },
  },

  // ── heart(頭上ハート) ──
  {
    name: 'heart_burikko_pop',
    label: 'きゅるんハート全開',
    concept: '顔の横でハートを作りつつ甘く左右に揺れ、サビで両手を高く振り上げる',
    armStyle: 'heart',
    config: { gain: 1.0, climaxGain: 1.55, punch: 0.11, sway: 0.22, twist: 0.42, headNod: 0.16, kneeBounce: 0.15, step: 0.08, hipDrop: 0.05, hop: 0.09, armSway: 0.18, armBob: 0.12, armPump: 0.62, shoulder: 0.07 },
  },

  // ── faceHands(顔の横に手) ──
  {
    name: 'burikko_face_pop',
    label: 'ぶりっ子顔よせポップ',
    concept: '顔の横に手を寄せ、頭・肩・腕を小刻みに弾ませる元気ぶりっ子',
    armStyle: 'faceHands',
    config: { gain: 1.05, climaxGain: 1.50, punch: 0.10, sway: 0.16, twist: 0.30, headNod: 0.20, kneeBounce: 0.20, step: 0.09, hipDrop: 0.05, hop: 0.11, armSway: 0.10, armBob: 0.20, armPump: 0.60, shoulder: 0.11 },
  },

  // ── wave(腕のしなり)×2: しなやか横流し / 脱力ぷよ縦弾み ──
  {
    name: 'flowing_wave',
    label: 'ゆらめきウェーブ',
    concept: '腕と上半身が波打つように左右へ流れるしなやかな横ノリ',
    armStyle: 'wave',
    config: { gain: 1.0, climaxGain: 1.25, punch: 0.09, sway: 0.24, twist: 0.42, headNod: 0.11, kneeBounce: 0.16, step: 0.06, hipDrop: 0.04, hop: 0.05, armSway: 0.34, armBob: 0.12, armPump: 0.40, shoulder: 0.06 },
  },
  {
    name: 'poyopoyo_jelly_bounce',
    label: 'ぽよぽよゼリーバウンス',
    concept: '力を抜いた脱力かわいい。やわらかい膝の屈伸でゼリーのように上下にぽよぽよ揺れる',
    armStyle: 'wave',
    config: { gain: 1.0, climaxGain: 1.40, punch: 0.06, sway: 0.11, twist: 0.14, headNod: 0.18, kneeBounce: 0.32, step: 0.05, hipDrop: 0.06, hop: 0.12, armSway: 0.12, armBob: 0.28, armPump: 0.45, shoulder: 0.08 },
  },

  // ── handsOnHips(腰に手・上品) ──
  {
    name: 'poised_elegance',
    label: 'お澄ましエレガンス',
    concept: '腰に手を当て、ひねりと視線で魅せる落ち着いた上品グルーヴ',
    armStyle: 'handsOnHips',
    config: { gain: 0.85, climaxGain: 1.20, punch: 0.10, sway: 0.20, twist: 0.55, headNod: 0.20, kneeBounce: 0.12, step: 0.05, hipDrop: 0.04, hop: 0.04, armSway: 0.08, armBob: 0.05, armPump: 0.18, shoulder: 0.04 },
  },
];

// 既定で使う最も汎用的に可愛いプリセット
export const SHUTTER_DANCE_DEFAULT = 'bouncy_pop';
