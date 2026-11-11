import * as THREE from 'three';
import { sfx } from '../core/sfx.js';
import { quality } from '../core/quality.js';
import { MMDLoader } from '../utils/MMDLoader.js';
import { BaseSong } from './BaseSong.js';
import { playerManager } from '../core/player.js';
import { groupPhraseWords } from '../utils/lyricGroups.js';
import { SHUTTER_DANCE_PRESETS, SHUTTER_DANCE_DEFAULT } from './shutterDancePresets.js';
import { ShutterPoseEditor, loadUserPoses, saveUserPoses, USER_POSE_MAX, BASE_POSE as POSE_EDITOR_BASE } from './shutterPoseEditor.js';

// 「湖／水の循環」要素のオン/オフを束ねる単一フラグ。
// false にすると本ファイルの湖関連（夕暮れ水面・撮影波紋・ベスト決定の締めの一行）は
// すべて初期化・更新・破棄ごと無効化され、従来の挙動に完全に戻る（即リバート用）。
const SHUTTER_LAKE_ENABLED = true;

// カメラズームの値域。スライダー(#shutter-zoom-slider の min/max)・キー・±ボタン・ホイール・ピンチで共通。
const ZOOM_MIN = 1.2;
const ZOOM_MAX = 3.2;

const VRM_TO_MMD_BONES = {
    hips: '下半身',
    spine: '上半身',
    chest: '上半身2',
    upperChest: '上半身2',
    head: '頭',
    neck: '首',
    leftUpperArm: '左腕',
    rightUpperArm: '右腕',
    leftLowerArm: '左ひじ',
    rightLowerArm: '右ひじ',
    leftHand: '左手首',
    rightHand: '右手首',
    leftUpperLeg: '左足',
    rightUpperLeg: '右足',
    leftLowerLeg: '左ひざ',
    rightLowerLeg: '右ひざ',
    leftFoot: '左足首',
    rightFoot: '右足首',
    leftShoulder: '左肩',
    rightShoulder: '右肩'
};

// 被写体ミクのポーズプリセット（正規化ヒューマノイドボーンのオイラー回転）
// 新VRMモデルは上腕/前腕のロール軸(z)が旧モデルと逆。
// 左腕は z=+1.12 で下ろした状態。z 符号反転で挙手になる。
const SHUTTER_MIKU_POSES = [
    { // 0: リラックス（基本姿勢）
        leftUpperArm: { x: 0, y: 0, z: 1.12 }, rightUpperArm: { x: 0, y: 0, z: -1.12 },
        leftLowerArm: { x: 0, y: 0.26, z: 0 }, rightLowerArm: { x: 0, y: -0.26, z: 0 },
        head: { x: 0, y: 0, z: 0 }, spine: { x: 0, y: 0, z: 0 }
    },
    { // 1: 右手を挙げて手を振る
        leftUpperArm: { x: 0, y: 0, z: 1.12 }, rightUpperArm: { x: 0, y: 0, z: 0.55 },
        leftLowerArm: { x: 0, y: 0.26, z: 0 }, rightLowerArm: { x: 0, y: 0, z: 0.85 },
        head: { x: 0, y: -0.18, z: -0.12 }, spine: { x: 0, y: -0.08, z: 0.04 }
    },
    { // 2: 左手を挙げてアピール
        leftUpperArm: { x: 0, y: 0, z: -0.55 }, rightUpperArm: { x: 0, y: 0, z: -1.12 },
        leftLowerArm: { x: 0, y: 0, z: -0.85 }, rightLowerArm: { x: 0, y: -0.26, z: 0 },
        head: { x: 0, y: 0.18, z: 0.12 }, spine: { x: 0, y: 0.08, z: -0.04 }
    },
    { // 3: 両手を挙げてチアー（サビ用）
        leftUpperArm: { x: 0, y: 0, z: -0.7 }, rightUpperArm: { x: 0, y: 0, z: 0.7 },
        leftLowerArm: { x: 0, y: 0, z: -0.35 }, rightLowerArm: { x: 0, y: 0, z: 0.35 },
        head: { x: -0.12, y: 0, z: 0 }, spine: { x: -0.05, y: 0, z: 0 }
    },
    { // 4: 顔の横でピースっぽいカメラ目線ポーズ
        leftUpperArm: { x: 0, y: 0, z: 1.12 }, rightUpperArm: { x: -0.5, y: 0, z: -0.85 },
        leftLowerArm: { x: 0, y: 0.26, z: 0 }, rightLowerArm: { x: -1.25, y: -0.35, z: 0 },
        head: { x: 0, y: -0.1, z: 0.18 }, spine: { x: 0, y: 0, z: -0.05 }
    }
];

// 腕の基調(armStyle)→ 腕の型。ダンスプリセットが参照する。
// relaxed/wave/appeal/cheer/peace は上の SHUTTER_MIKU_POSES を再利用。
const ARM_GESTURES = {
    relaxed: SHUTTER_MIKU_POSES[0],
    wave: SHUTTER_MIKU_POSES[1],
    appeal: SHUTTER_MIKU_POSES[2],
    cheer: SHUTTER_MIKU_POSES[3],
    peace: SHUTTER_MIKU_POSES[4],
    // 両手を顔/胸の前へ（はにかみ・きゅるん）
    faceHands: {
        leftUpperArm: { x: -0.2, y: 0, z: 0.7 }, rightUpperArm: { x: -0.2, y: 0, z: -0.7 },
        leftLowerArm: { x: 0, y: 0.1, z: -1.3 }, rightLowerArm: { x: 0, y: -0.1, z: 1.3 },
        head: { x: 0.05, y: 0, z: 0 }, spine: { x: 0, y: 0, z: 0 }
    },
    // 腰に手を当てる（お澄まし）
    handsOnHips: {
        leftUpperArm: { x: 0, y: 0, z: 1.0 }, rightUpperArm: { x: 0, y: 0, z: -1.0 },
        leftLowerArm: { x: 0, y: 0.6, z: -0.6 }, rightLowerArm: { x: 0, y: -0.6, z: 0.6 },
        head: { x: 0, y: 0, z: 0 }, spine: { x: 0, y: 0, z: 0 }
    },
    // 右手を上げて指さし、左手は腰そえ（キメ）
    point: {
        leftUpperArm: { x: 0, y: 0, z: 1.05 }, rightUpperArm: { x: -0.35, y: 0, z: 0.1 },
        leftLowerArm: { x: 0, y: 0.4, z: -0.3 }, rightLowerArm: { x: 0, y: 0, z: 0.1 },
        head: { x: 0, y: -0.12, z: -0.08 }, spine: { x: 0, y: -0.05, z: 0 }
    },
    // 頭上で両手ハート風（ぶりっ子）
    heart: {
        leftUpperArm: { x: -0.1, y: 0, z: -0.45 }, rightUpperArm: { x: -0.1, y: 0, z: 0.45 },
        leftLowerArm: { x: 0, y: 0, z: -1.45 }, rightLowerArm: { x: 0, y: 0, z: 1.45 },
        head: { x: -0.05, y: 0, z: 0 }, spine: { x: -0.03, y: 0, z: 0 }
    },
};

// idle時に中立(0)へ戻すボーン一覧 RELAX_IDLE_BONES は、ヒューマノイド中立ひな型
// (SHUTTER_BONES_ZERO)とキメポーズ集合(SHUTTER_CUTE_POSES)を土台に「腕以外の全ボーン」を
// 網羅して構築する。定義は両者の宣言後（下方）にある。

// 「かわいいポーズ」ボタン用プリセット（ミク/リン共通。ボタンを押すと数秒ホールド）。
// 既存の ARM_GESTURES を土台に、頭の傾きや胴のひねりを足してキメ顔ポーズへ仕上げた6種。
// 各 pose の値は ARM_GESTURES と同じ規約（leftUpperArm/rightUpperArm は適用時に±0.5補正される）。
// 注: 上腕 z は「左=正で下ろし／右=負で下ろし」。左は z を下げ、右は z を上げると腕が高く挙がる。
// 肘(LowerArm)の z は左=負・右=正で内側に折れる。ちび体型でも読めるよう大きめ＆左右非対称に。
// きゅるん・バンザイは残し、その他は指の形を作れない(手のモーフ非対応)指依存ポーズ
// (ピース/腰ピース✌・ガッツ✊・ゆびさし☝)を外して定番に絞り、合計6種にした。
const SHUTTER_CUTE_POSES = [
    // きゅるん（ポーズエディタ製・全身＋片目ウィンク表情）
    { id: 'kyurun', label: 'きゅるん', emoji: '🥺', pose: { spine: { x: 0, y: 0, z: 0 }, upperChest: { x: 0, y: 0, z: 0 }, neck: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 0 }, leftShoulder: { x: 0, y: 0, z: 0 }, leftUpperArm: { x: 0, y: 0, z: 0 }, leftLowerArm: { x: 0, y: -0.48, z: 0 }, leftHand: { x: 0, y: 0, z: 0 }, rightShoulder: { x: -0.07, y: 0.91, z: -0.11 }, rightUpperArm: { x: 0, y: 0, z: 0 }, rightLowerArm: { x: -1.16, y: 1.58, z: 0.05 }, rightHand: { x: -2.16, y: -0.52, z: -0.83 }, hips: { x: 0, y: 0, z: 0 }, leftUpperLeg: { x: 0.77, y: 0.1, z: 0 }, leftLowerLeg: { x: 0.91, y: 0.13, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 }, rightUpperLeg: { x: 0.28, y: 0.03, z: -0.11 }, rightLowerLeg: { x: 0.25, y: -0.26, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 }, expr: 'ウィンク' } },
    // バンザイ（ポーズエディタで作成・肩/脚まで含む全身ポーズ）
    { id: 'banzai', label: 'バンザイ', emoji: '🙌', pose: { spine: { x: -0.01, y: 0, z: 0 }, leftShoulder: { x: -1.49, y: 0.5, z: 0.12 }, leftUpperArm: { x: -1.94, y: 0.95, z: 0.55 }, leftLowerArm: { x: 1.24, y: -0.94, z: 0.07 }, leftHand: { x: 0.71, y: -0.27, z: 0.7 }, rightShoulder: { x: -1.46, y: 0.01, z: -0.79 }, rightUpperArm: { x: -0.5, y: 0.53, z: 0.08 }, rightLowerArm: { x: 0.19, y: -0.09, z: 0 }, rightHand: { x: 0.17, y: 0.3, z: -0.56 }, leftLowerLeg: { x: 0.56, y: 0.01, z: 0 }, rightLowerLeg: { x: 1.47, y: 0.23, z: 0 }, rightFoot: { x: 0, y: -0.35, z: 0 } } },
    // 泣き（ポーズエディタ製・全身＋涙/困り顔の複数モーフ）
    { id: 'naki', label: '泣き', emoji: '😭', pose: { neck: { x: 0, y: 0.26, z: 0 }, head: { x: 0.19, y: 0, z: 0 }, leftUpperArm: { x: -0.66, y: -0.25, z: 1.01 }, leftLowerArm: { x: -1.62, y: -0.33, z: -1.54 }, leftHand: { x: -1.95, y: 0.99, z: 0 }, rightShoulder: { x: -0.13, y: 0, z: 0 }, rightUpperArm: { x: -0.46, y: 1.12, z: -0.5 }, rightLowerArm: { x: -0.58, y: 1.82, z: 0 }, rightHand: { x: -2.69, y: -0.14, z: -1.32 }, hips: { x: -0.22, y: -0.08, z: 0 }, leftUpperLeg: { x: 0.17, y: -0.02, z: 0.58 }, leftLowerLeg: { x: 1.12, y: 0.71, z: 0.09 }, leftFoot: { x: 0, y: 0.27, z: 0.54 }, rightUpperLeg: { x: -0.7, y: 0.47, z: -0.01 }, rightLowerLeg: { x: 2.47, y: -0.03, z: 0 }, rightFoot: { x: 0, y: -0.86, z: 0 }, expr: { '涙': 1, 'まばたき': 1, '困る': 1, 'びっくり': 0.45 } } },
    // お願い（複数モーフのキメ顔つき）
    // 注: leftUpperArm を明示すること。省くと lerpSubjectPose が左上腕を補間せず、待機グルーヴ/前姿勢の
    //     値が残って左腕の向きが毎回バラつく（右の rightUpperArm のミラー値で左右を揃える）。
    { id: 'pray', label: 'お願い', emoji: '🙏', pose: { spine: { x: 0.91, y: 0.19, z: 0 }, neck: { x: -0.99, y: 0.07, z: 0 }, leftShoulder: { x: -2.33, y: -0.19, z: -0.95 }, leftUpperArm: { x: 0, y: 0.14, z: 0.5 }, leftLowerArm: { x: -0.07, y: -1.1, z: 0 }, leftHand: { x: -0.66, y: -0.57, z: 0.07 }, rightShoulder: { x: -2.27, y: -0.33, z: 0.91 }, rightUpperArm: { x: 0, y: -0.14, z: -0.5 }, rightLowerArm: { x: 0, y: 1.77, z: 0 }, rightHand: { x: -0.53, y: -0.08, z: 0.21 }, expr: { 'ウィンク': 1, 'びっくり': 0.2, '照れ': 1, 'う': 0.45 } } },
    // かんがえ中（ポーズエディタ製・全身＋ツインテール/前髪＋なごみ顔）
    { id: 'thinking', label: 'かんがえ', emoji: '🤔', pose: { neck: { x: 0.07, y: -0.07, z: -0.39 }, leftUpperArm: { x: 0, y: -1.1, z: 0.03 }, rightUpperArm: { x: -1.28, y: 0, z: -0.5 }, rightLowerArm: { x: -0.05, y: 2.23, z: -0.27 }, rightHand: { x: -2.52, y: -0.38, z: -0.83 }, leftLowerLeg: { x: 1.71, y: -0.15, z: 0 }, leftFoot: { x: 1.1, y: 0, z: 0 }, rightLowerLeg: { x: 1.71, y: 0.1, z: 0.13 }, rightFoot: { x: 1.13, y: 0.12, z: 0.02 }, '右髪１': { x: 0, y: 0, z: 0.2 }, '左髪１': { x: 0, y: -0.06, z: 0.18 }, '前髪２': { x: 0, y: 0.09, z: 0 }, expr: 'なごみ' } },
    // ジャンプ（ポーズエディタ製・全身＋ツインテール跳ね＋はぅ顔）
    { id: 'jump', label: 'ジャンプ', emoji: '🦘', pose: { leftShoulder: { x: 0, y: 0, z: -0.12 }, leftUpperArm: { x: -3.03, y: 0, z: 0.5 }, rightShoulder: { x: 0.38, y: 0.23, z: -0.24 }, rightUpperArm: { x: -3.15, y: 0.04, z: -0.62 }, rightLowerArm: { x: 0.04, y: 0.14, z: -0.21 }, leftUpperLeg: { x: 0, y: -0.47, z: 0 }, leftLowerLeg: { x: 0.83, y: 0.01, z: 0 }, leftFoot: { x: 0, y: 0.84, z: 0 }, rightUpperLeg: { x: 0, y: 0.39, z: 0 }, rightLowerLeg: { x: 0.77, y: -0.18, z: 0 }, rightFoot: { x: 0.02, y: -0.63, z: 0 }, '右髪１': { x: -0.28, y: 0.13, z: -0.77 }, '左髪１': { x: 0, y: 0, z: 0.77 }, expr: 'はぅ' } },
];

// キメポーズを切り替える際にいったん戻す先は「ボタン非押下時のアイドル姿勢」。
// 各プリセットは定義するボーン集合が異なるため、前ポーズで動かしたボーンが
// 新ポーズに無いと残留して姿勢が崩れる。そこで全ボーンを網羅した中立ひな型へ
// 現在のアイドルジェスチャ(腕/頭/胴)を重ねた姿勢へ一度戻してから新ポーズへ入る。
// これによりリセット先は T ポーズではなく「ポーズを押していないときの立ち姿」になる。
const SHUTTER_BONES_ZERO = {
    spine: { x: 0, y: 0, z: 0 }, chest: { x: 0, y: 0, z: 0 }, upperChest: { x: 0, y: 0, z: 0 },
    neck: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 0 }, hips: { x: 0, y: 0, z: 0 },
    leftShoulder: { x: 0, y: 0, z: 0 }, leftUpperArm: { x: 0, y: 0, z: 0 }, leftLowerArm: { x: 0, y: 0, z: 0 }, leftHand: { x: 0, y: 0, z: 0 },
    rightShoulder: { x: 0, y: 0, z: 0 }, rightUpperArm: { x: 0, y: 0, z: 0 }, rightLowerArm: { x: 0, y: 0, z: 0 }, rightHand: { x: 0, y: 0, z: 0 },
    leftUpperLeg: { x: 0, y: 0, z: 0 }, leftLowerLeg: { x: 0, y: 0, z: 0 }, leftFoot: { x: 0, y: 0, z: 0 },
    rightUpperLeg: { x: 0, y: 0, z: 0 }, rightLowerLeg: { x: 0, y: 0, z: 0 }, rightFoot: { x: 0, y: 0, z: 0 },
};

// 待機の腕の型(ARM_GESTURES)は腕ボーンを「非ゼロのアイドル姿勢」へ駆動するため、idleで0へ
// 戻してはいけない（戻すと腕が下がって型が崩れる）。それ以外のボーンはすべて中立(0)へ戻す対象。
const GESTURE_DRIVEN_ARM_BONES = new Set([
    'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
]);

// idle時に中立(0)へ戻すボーン。方針: 「ポーズが触りうる全ボーン − 腕」を網羅する。
//  - ヒューマノイド中立ひな型(SHUTTER_BONES_ZERO)の全ボーン … 胴/首/頭/肩/手/脚/足
//  - キメポーズ集合(SHUTTER_CUTE_POSES)が動かす髪等の非ヒューマノイドボーン … 右髪１/左髪１/前髪２ 等
// これを relaxIdleBones で 0 へ寄せ、その後に applySubjectGroove が踊りの駆動軸を上書きする。
// 結果、groove が駆動する軸はダンス値・駆動しない軸(hips.x や chest.z、髪、ポーズ編集で動かした
// 任意の部位)は 0 へ戻る＝待機時に全パラメータが明示的に元へ戻る。腕だけは gesture が別途駆動。
// プリセットから髪等を自動収集するため、将来ポーズが新しいボーンを足しても idleで自動的に戻る。
const RELAX_IDLE_BONES = (() => {
    const set = new Set(
        Object.keys(SHUTTER_BONES_ZERO).filter((b) => !GESTURE_DRIVEN_ARM_BONES.has(b)),
    );
    SHUTTER_CUTE_POSES.forEach((p) => Object.keys(p.pose || {}).forEach((k) => {
        if (k !== 'expr' && !GESTURE_DRIVEN_ARM_BONES.has(k)) set.add(k);
    }));
    return [...set];
})();

// キメポーズの「入り」で全身を寄せる基準テンプレート。エディタの BASE_POSE(=プレビューの
// 土台。腕は z:±1.12 等の自然な下ろし)に、プリセットが動かす髪等の非ヒューマノイドボーンの
// 中立(0)を足したもの。各ポーズが定義しないボーンも必ずこの基準へ寄せることで、直前のポーズや
// 待機グルーヴの残り(肘・手首など)に依存せず、毎回エディタのプレビューと同じ形へ決定論的に
// 収束する。→「ジャンプは上腕しか定義しないのに前腕が前姿勢のまま残って腕角度が崩れる」類の
// 不具合(定義ボーン依存のバラつき)を根絶する。
const POSE_ENTRY_BASE = (() => {
    const out = {};
    Object.keys(POSE_EDITOR_BASE).forEach((k) => {
        if (k !== 'expr') out[k] = POSE_EDITOR_BASE[k];
    });
    SHUTTER_CUTE_POSES.forEach((p) => Object.keys(p.pose || {}).forEach((k) => {
        if (k !== 'expr' && !(k in out)) out[k] = { x: 0, y: 0, z: 0 };
    }));
    return out;
})();

// 「シャッターチャンス」の歌詞フレーズインデックスに対する100%正確な歌唱パートマッピング
const SHUTTER_VOCAL_MAP = {
    0: 'duet',  // 「いつだってシャッターチャンス」 (合唱)
    1: 'miku',  // 「完全無欠flawless」
    2: 'miku',  // 「息を呑むシャッター半押しの合図」
    3: 'rin',   // 「君の決断、ずっと待ってるのに」
    4: 'miku',  // 「レリーズボタンに触れたその指先は」
    5: 'rin',   // 「迷いを隠せないまま」
    6: 'miku',  // 「ファインダー越しに一瞬映る顔も可愛くて当然」
    7: 'rin',   // 「ため息混じりの嫉妬もしょうがないね」
    8: 'miku',  // 「君の世界に焼き付けたいからさ」
    9: 'rin',   // 「今すぐ私に焦点合わせて！」
    10: 'duet', // 「いつだってシャッターチャンス」 (合唱)
    11: 'duet', // サビ (全て君を落とす1枚になるモラトリアム)
    12: 'duet', // サビ (完全無欠flawless)
    13: 'duet', // サビ (過ぎ去っちゃうこの一瞬を)
    14: 'duet', // サビ (切り取り永遠に保存して♡)
    15: 'miku', // 掛け合い (NGテイクなんてない)
    16: 'rin',  // 掛け合い (誰にも真似できない勝てっこない)
    17: 'miku', // 掛け合い (絶対的なフォーカス)
    18: 'rin',  // 掛け合い (どんなテイクだって色褪せない)
    19: 'miku', // 掛け合い (誰もが追いつけない揺るがない)
    20: 'rin',  // 掛け合い (再現出来ないスナップ)
    21: 'miku', // 「その手を止めないで」
    22: 'rin',  // 「もっとバッファにアーカイブして」
    23: 'duet', // 「切り取ってフレームで閉じ込めて」
    24: 'duet', // 「思うがままほらシャッターを切って」
    25: 'miku', // 「この瞬間、残せるのは」
    26: 'rin',  // 「今しかない」
    27: 'rin',  // 「ファインダー越しの無防備な顔も可愛くて当然」 (2番Aメロ)
    28: 'miku', // 「油断してつい照れちゃうのもしょうがないね」
    29: 'rin',  // 「君の世界を彩りたいからさ」
    30: 'miku', // 「今すぐ私にピント合わせて！」
    31: 'duet', // 「いつだってシャッターチャンス」 (合唱)
    32: 'miku', // 「心象のレイヤーパララックス」 (落ちサビ)
    33: 'rin',  // 「今すぐ私に焦点合わせて！」
    34: 'duet', // 「余所見しないで！」
    35: 'duet', // ラストサビ (いつだってシャッターチャンス)
    36: 'duet', // サビ (どれも君を落とす1枚になるモラトリアム)
    37: 'duet', // サビ (完全無欠flawless)
    38: 'duet', // サビ (過ぎ去っちゃうこの一瞬を)
    39: 'duet', // サビ (切り取り永遠に残して♡)
    40: 'duet', // ラスト掛け合い (NGテイクなんてない)
    41: 'duet',
    42: 'duet',
    43: 'duet',
    44: 'duet',
    45: 'duet'  // 再現出来ないストロボ
};

// 「シャッターチャンス」を象徴する歌詞ワード。撮影フレームにこれらが映っていれば、
// 曲の世界観を切り取った“印象的な1枚”として評価を上げる（部分一致／助詞連結に強い）。
// サビの核「いつだってシャッターチャンス」を筆頭に、曲のアイデンティティ語を厳選。
const SHUTTER_SIGNATURE_LYRICS = [
    'シャッターチャンス', 'シャッター', '完全無欠', 'flawless', 'モラトリアム',
    '一瞬', '永遠', 'ファインダー', 'ピント', '焦点', 'フォーカス', 'レリーズ',
    '切り取', '焼き付', 'スナップ', 'ストロボ',
];

export class SongShutter extends BaseSong {
    constructor(container, songId) {
        super(container, songId);

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        this.activeSprites = [];
        this.frames = [];
        this.transitioningPhotos = []; // 移動・吸い込み中の写真を管理する配列
        this.lastPhrase = null;
        
        // 歌詞の単語レベル（助詞連結）＆被り回避管理
        this.occupiedCells = new Set();
        this.customStyleElement = null;
        
        this.isClimax = false;
        this.climaxTriggered = false;
        
        this.themeColor = '#B9543C';
        
        this.lyricsCacheBuilt = false;
        this.allWordGroups = [];
        this.lyricTexturesCache = null;
        this.lastPosition = -1;

        // --- モバイル負荷分岐 ---
        this.isMobile = window.innerWidth < 768;

        // --- フィルムストリップ（撮影成果の内部記録・最大12枚） ---
        this.photoLog = [];          // { url, candidate, score, timeStr }
        this.MAX_FILM_PHOTOS = 12;
        this.totalShots = 0;         // 累計撮影枚数
        this.starShots = 0;          // ★ベストショット候補の枚数（自動判定）
        this.lockShots = 0;          // ターゲットロック成功回数
        this.filmStripVisible = false;
        this.filmStripEl = null;
        // ベストショットはコンタクトシート上でプレイヤーが「候補」から1枚選ぶ方式。
        this.bestChosenTimeStr = null; // 選定したベストの撮影タイム（結果表示用）
        this._bestChosen = false;    // 選定済みフラグ（多重選択ガード）

        // --- 湖／水の循環（SHUTTER_LAKE_ENABLED で一括ガード。off時は一切生成しない） ---
        this.lakeWater = null;       // 夜の手続き水面メッシュ
        this.lakeWaterUni = null;    // 水面シェーダのuniforms
        this.lakeMoon = null;        // 夜空の月スプライト
        this.lakeStars = null;       // 夜空の星々(Points)
        this.lakeMoonX = -22;        // 月のx位置（水面の月光レーンと一致させる）
        this.lakeRipples = [];       // 撮影時に広がる波紋リング { mesh, t, life }
        this._lakeRingGeo = null;    // 波紋リングの共有ジオメトリ
        this._lakeFade = 0;          // 水面のフェードイン度(0..0.92)
        this._lakeLastT = 0;         // 水面アニメ用の前フレーム時刻(ms)
        this._bestShotSealed = false;  // ベスト決定済み(リザルトに締めの一行を添える)

        // 「かわいいポーズ」ボタンで一時的に指定ポーズをホールドする状態
        this.poseOverride = null;    // { pose, until(performance.now基準のms), id } or null
        this._poseHoldAmt = 0;       // ホールド度の平滑値(0..1。移動抑制に使用)
        // ポーズ・ホールド開始時のうろつきオフセットを凍結する値（被写体を中心へ寄せず“その場で構えさせる”）。
        // null=非ホールド。ホールド中は現在のsx/szをこの凍結値へ blend して座標ズレを防ぐ。
        this._holdSx = null;
        this._holdSz = null;
        this._poseBtnTimer = null;   // ボタンのハイライト解除タイマー

        // --- ユーザー向けポーズ作成エディタ（自作ポーズで撮影） ---
        this.userPoses = loadUserPoses();   // localStorage 永続のマイポーズ
        this.poseEditing = false;           // 編集モード中フラグ(撮影/グルーヴを抑止)
        this.poseEditor = null;             // ShutterPoseEditor 実体(init で生成)

        // --- 被写体VRM（「シャッターチャンス」はミク&リンのデュエット曲。2体を並べる） ---
        this.mikuVRM = null;         // 主役(ミク)。ライティング/破棄の後方互換参照
        this.subjects = [];          // 被写体ランタイム配列 { key, vrm, baseX, baseRotY, poseIndex, forward }
        this.mikuBaseY = -4.2;
        this.mikuBaseX = 0;          // ライト/AFスコープの中心（2体の中間）
        this.mikuBaseZ = -16.5;      // AFターゲットスコープ(z=-15)のすぐ奥のステージ位置
        // ツーショット（横並び）は等身差で違和感が出るため採用しない。
        // 両者をセンターステージの同じ位置に重ねて配置し、歌唱パートに応じて
        // どちらか1体だけを表示する（カメラが被写体を切り替えるイメージ）。
        // 1体ずつ映すので頭身の違いは並んで見えず、身長を揃えてフレーミングを統一する
        // （ミク native≈1.27 / リン(VRoid) native≈1.96 → 画面身長が揃うようスケール調整）。
        // baseRotY=π: このVRM群は素のrotation.y=0だとカメラ(+Z)に背を向けるため、
        // 180°回してカメラ(撮影者)に正面を向ける。
        this.subjectLayout = [
            { key: 'miku', model: 'nendo_miku/nendo_miku.pmx', baseX: 0, baseRotY: 0, scale: 2.0 },
            { key: 'rin',  model: 'nendo_rin/nendo_rin.pmx',  baseX: 0, baseRotY: 0, scale: 2.0 },
        ];
        this.activeVocal = 'none';   // 歌唱中パート（メーター表示などに使用）
        this.shownKey = 'miku';      // 現在表示中の被写体
        this.selectedKey = null;     // 曲開始前に選んだ被写体（ミク/リン）。選択後は曲中固定
        this.swap = null;            // 被写体の切替トランジション { from, to, t }

        // --- ビート同期グルーヴ（こたえての applyGroove を踏襲。被写体を曲に合わせて踊らせる） ---
        this.grooveConfig = {
            gain: 1.0,        // 全体の効き
            climaxGain: 1.0,  // サビでの追加倍率(gainに乗算)
            punch: 0.16,      // 拍頭で胴を前に沈める量(rad)
            sway: 0.17,       // 体重移動の振り幅(rad)
            twist: 0.34,      // 体重移動に合わせた胴のひねり量(swayに対する比)
            headNod: 0.13,    // 頭の頷き量(rad)
            kneeBounce: 0.20, // 拍ごとの膝の屈伸量(rad・左右対称＝接地を保つ)
            step: 0.16,       // ステップ(足踏み)で浮く脚側の持ち上げ量(rad)
            hipDrop: 0.06,    // 拍頭で腰を落とす量(ワールド単位)
            hop: 0.10,        // 小節頭の軽いホップ量(ワールド単位・サビ強調)
            armSway: 0.22,    // 体重移動に合わせた腕の振り(rad)
            armBob: 0.14,     // 拍ごとに腕を弾ませる量(rad)
            armPump: 0.5,     // サビの腕振り上げ量(rad)
            shoulder: 0.06,   // 拍ごとの肩の上下(rad)
        };
        this._groove = 0;     // 拍頭で素早く立ち上がるパルス(0..1)
        this._beatStep = 1;   // 体重移動の向き(±1。拍ごとに反転)
        this._beatIndex = -1; // 直近の拍インデックス(進んだ瞬間の検出)
        this._barAccent = 0;  // 小節頭アクセント(発火→減衰)
        this._swayCur = 0;    // 体重移動の平滑値
        this._climaxAmt = 0;  // サビ強度の平滑値(0..1。振幅スナップ防止)

        // 「可愛い動き」ストックから既定プリセットを適用（grooveConfig と armStyle を設定）
        this.armStyle = 'cheer';
        this.dancePresetName = SHUTTER_DANCE_DEFAULT;
        this.applyDancePreset(SHUTTER_DANCE_DEFAULT);
        this.lastPhraseStartTime = -1;
        this.lastPoseBeatStart = -1;
        this.poseBeatCounter = 0;
        this.lastVrmRealTime = undefined;
        this.vrmUpdateAccum = 0;

        // --- オープニングの掴み（曲頭3秒の「構図が決まる」導入演出） ---
        // 再生開始(position=0)から OPENING_DURATION までを使い、AFが寄って合焦→合焦一閃→
        // 被写体がキメ顔/ポーズ、という流れで「撮る遊び」を最初の一瞬で直感させる。
        this.OPENING_DURATION = 3000;     // 導入演出の長さ(ms)
        this.openingDone = false;         // 導入完了フラグ(以後は通常更新)
        this.openingFocusFlash = 0;       // 合焦の瞬間に走る一閃(0..1で減衰)
        this._recIgnited = false;         // 合焦の瞬間の一回限り発火ガード(一閃/キメ顔/SE)

        // --- AFロック「今だ！」合図（lockShots成立の発見性を上げる） ---
        // スコープ上に被写体ワードが吸着している間 _lockReady=1 へ滑らかに上がり、
        // スコープが赤→緑＋NOW! 表示で「今撮ると高得点」を直感させる。
        this._lockReady = 0;              // ロック可能度(0..1の平滑値)

        // --- ボーカルパート色（歌詞・被写体ハイライトの同期に共通利用） ---
        this.VOCAL_COLORS = {
            miku: new THREE.Color('#39C5BB'),
            rin:  new THREE.Color('#FFEE11'),
            duet: new THREE.Color('#FF7A4D'), // サビ＝サンセット(themeColor寄りの暖色)
        };
        // LEAD先読み補正(ms)。歌詞の発光/被写体ハイライトを実唱より僅かに先取りして
        // サビ(duet)の畳み掛けで遅れて見えないようにする。
        this.vocalLeadMs = 90;

        // --- カメラズーム（写真の拡大縮小範囲）制御システム ---
        this.zoomLevel = 2.2;
        this.targetZoom = 2.2;
        this.touchStartDist = 0;

        this.boundOnWheel = this.onWheel.bind(this);
        this.boundOnTouchStart = this.onTouchStart.bind(this);
        this.boundOnTouchMove = this.onTouchMove.bind(this);
        this.boundOnTouchEnd = this.onTouchEnd.bind(this);
        
        this.boundOnResize = this.onResize.bind(this);
        this.boundOnClick = this.takePhoto.bind(this);
        this.boundOnKeyDown = (e) => { 
            // ポーズ名入力など編集中のフィールドではキー操作を奪わない(W/S/[ ]が打てなくなるため)
            if (e.isComposing) return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
            // シャッターは Enter のみ(チュートリアル表記どおり)。Space は共通の再生/一時停止に任せ、二重動作を防ぐ。
            if (e.code === 'Enter') {
                if (playerManager.player && playerManager.player.isPlaying) {
                    this.takePhoto();
                }
            } else if (e.code === 'KeyW' || e.code === 'ArrowUp') {
                this.targetZoom = Math.min(ZOOM_MAX, this.targetZoom + 0.15);
                e.preventDefault();
            } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
                this.targetZoom = Math.max(ZOOM_MIN, this.targetZoom - 0.15);
                e.preventDefault();
            } else if (e.code === 'BracketRight') {
                this.cycleDancePreset(1);   // ] 次のダンス（ストックをブラウズ）
                e.preventDefault();
            } else if (e.code === 'BracketLeft') {
                this.cycleDancePreset(-1);  // [ 前のダンス
                e.preventDefault();
            }
        };

        this.boundOnSliderInput = (e) => {
            this.targetZoom = parseFloat(e.target.value);
        };

        // --- カメラ回り込み（被写体を中心にオービット）ドラッグ操作システム ---
        // x=仰角(上下の回り込み), y=方位角(左右の回り込み)。被写体を常に画面中央に捉えたまま周回する。
        this.cameraRotation = new THREE.Vector2(0, 0); // 現在の角度
        this.targetCameraRotation = new THREE.Vector2(0, 0); // 目標の角度
        this.orbitPivot = new THREE.Vector3(0, 0, -16.5); // 周回の中心(=被写体ミクの位置。常に中央に保つ)
        this.orbitRadius = 26.5;                          // カメラ初期位置(0,0,10)からの距離
        this._lyricScratch = new THREE.Vector3();         // 歌詞ワールド追従の作業用
        this._scratchVec = new THREE.Vector3();           // 毎フレームの一時計算用（写真トランジション等）
        this._armScratchA = new THREE.Vector3();          // 腕クランプ（胴中心軸の算出）
        this._armScratchB = new THREE.Vector3();
        this._armScratchW = new THREE.Vector3();          // 腕クランプ（手首ワールド座標）
        this._armScratchP = new THREE.Vector3();          // 腕クランプ（上腕の付け根ワールド座標）
        this._armScratchT = new THREE.Vector3();          // 腕クランプ（手首の目標位置）
        this._armScratchV1 = new THREE.Vector3();
        this._armScratchV2 = new THREE.Vector3();
        this._armScratchAxis = new THREE.Vector3();       // 腕クランプ（CCD回転軸）
        this._armScratchFwd = new THREE.Vector3();        // 腕クランプ（被写体の前方ワールド）
        this._armScratchQuat = new THREE.Quaternion();
        this._activeGroupsScratch = [];                   // 表示中ワードグループの再利用バッファ（毎フレーム再構築）
        this._seenTextScratch = new Set();                // 歌詞重複排除用の再利用Set（毎フレームclear）
        this.isDragging = false;
        this.dragStartPos = new THREE.Vector2(0, 0);
        this.previousMousePosition = new THREE.Vector2(0, 0);
        this.draggedDistance = 0; // クリックとドラッグの判定用

        this.boundOnMouseDown = (e) => {
            if (e.target.id === 'shutter-zoom-slider' || e.target.closest('#shutter-zoom-slider-container') || e.target.closest('#shutter-pose-bar')) return;
            this.isDragging = true;
            this.dragStartPos.set(e.clientX, e.clientY);
            this.previousMousePosition.set(e.clientX, e.clientY);
            this.draggedDistance = 0;
        };

        this.boundOnMouseMove = (e) => {
            if (!this.isDragging) return;
            const dx = e.clientX - this.previousMousePosition.x;
            const dy = e.clientY - this.previousMousePosition.y;
            this.previousMousePosition.set(e.clientX, e.clientY);

            // ドラッグ移動距離を累積
            const distFromStart = Math.sqrt(Math.pow(e.clientX - this.dragStartPos.x, 2) + Math.pow(e.clientY - this.dragStartPos.y, 2));
            this.draggedDistance = distFromStart;

            // 回り込み目標を更新（方位角±2.5rad≒143度まで側面〜やや背面へ / 仰角±0.5rad≒28度）
            this.targetCameraRotation.y = Math.min(2.5, Math.max(-2.5, this.targetCameraRotation.y + dx * 0.005));
            this.targetCameraRotation.x = Math.min(0.5, Math.max(-0.5, this.targetCameraRotation.x + dy * 0.004));
        };

        this.boundOnMouseUp = (e) => {
            if (!this.isDragging) return;
            this.isDragging = false;
            
            // マウスの総移動距離が 10 ピクセル未満なら「撮影（クリック）」と判定し、それ以上なら「カメラ操作」として撮影をガード！
            if (this.draggedDistance < 10) {
                if (playerManager.player && playerManager.player.isPlaying) {
                    this.takePhoto();
                }
            }
        };

        // スマホ用タッチ首振りバインド
        this.boundOnTouchStartCam = (e) => {
            // 2本指目が触れたらピンチ操作とみなし、全指が離れるまで撮影しない(ピンチで誤シャッター防止)
            if (e.touches.length >= 2) {
                this.isMultiTouch = true;
                this.isDragging = false;
                return;
            }
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                if (touch.target.id === 'shutter-zoom-slider' || touch.target.closest('#shutter-zoom-slider-container') || touch.target.closest('#shutter-pose-bar')) return;
                this.isDragging = true;
                this.dragStartPos.set(touch.clientX, touch.clientY);
                this.previousMousePosition.set(touch.clientX, touch.clientY);
                this.draggedDistance = 0;
            }
        };

        this.boundOnTouchMoveCam = (e) => {
            if (!this.isDragging || e.touches.length !== 1) return;
            const touch = e.touches[0];
            const dx = touch.clientX - this.previousMousePosition.x;
            const dy = touch.clientY - this.previousMousePosition.y;
            this.previousMousePosition.set(touch.clientX, touch.clientY);

            const distFromStart = Math.sqrt(Math.pow(touch.clientX - this.dragStartPos.x, 2) + Math.pow(touch.clientY - this.dragStartPos.y, 2));
            this.draggedDistance = distFromStart;

            this.targetCameraRotation.y = Math.min(2.5, Math.max(-2.5, this.targetCameraRotation.y + dx * 0.006));
            this.targetCameraRotation.x = Math.min(0.5, Math.max(-0.5, this.targetCameraRotation.x + dy * 0.005));
        };

        this.boundOnTouchEndCam = (e) => {
            if (this.isMultiTouch) {
                if (e.touches.length === 0) this.isMultiTouch = false;
                return;
            }
            if (!this.isDragging) return;
            this.isDragging = false;
            
            if (this.draggedDistance < 10) {
                if (playerManager.player && playerManager.player.isPlaying) {
                    this.takePhoto();
                }
            }
        };
    }

    init() {
        this.initThree();
        this.initEnvironment();
        this.loadSubjects();
        this.injectCustomStyles();
        this.createViewfinderUI();
        
        // ズームスライダーのイベント登録
        const slider = document.getElementById('shutter-zoom-slider');
        if (slider) {
            slider.addEventListener('input', this.boundOnSliderInput);
        }

        // ズーム +/- トグルボタン。スライダー値域(1.2〜3.2)内で1タップ0.3刻み。
        // targetZoom はスライダーと双方向バインド済みなのでツマミも自動追随する。
        const stepZoom = (delta) => {
            this.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetZoom + delta));
        };
        const zoomInBtn = document.getElementById('shutter-zoom-in');
        const zoomOutBtn = document.getElementById('shutter-zoom-out');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => stepZoom(0.3));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => stepZoom(-0.3));

        // ポーズ作成エディタを用意し、「かわいいポーズ」バー（プリセット＋マイポーズ＋作る）を構築。
        // バーの中身は refreshPoseBar() に集約（保存/削除のたびに再生成・再バインドする）。
        this.poseEditor = new ShutterPoseEditor(this);
        this.refreshPoseBar();

        window.addEventListener('resize', this.boundOnResize);
        window.addEventListener('keydown', this.boundOnKeyDown);
        
        // カメラ首振り ＆ 統合された撮影イベントの登録
        this.songWrapper.addEventListener('mousedown', this.boundOnMouseDown);
        this.songWrapper.addEventListener('mousemove', this.boundOnMouseMove);
        window.addEventListener('mouseup', this.boundOnMouseUp);
        
        // スマホ用首振りタッチイベントの登録
        this.songWrapper.addEventListener('touchstart', this.boundOnTouchStartCam, { passive: true });
        this.songWrapper.addEventListener('touchmove', this.boundOnTouchMoveCam, { passive: false });
        this.songWrapper.addEventListener('touchend', this.boundOnTouchEndCam, { passive: true });
        
        // ズーム用のホイール・タッチイベントを登録
        this.songWrapper.addEventListener('wheel', this.boundOnWheel, { passive: false });
        this.songWrapper.addEventListener('touchstart', this.boundOnTouchStart, { passive: true });
        this.songWrapper.addEventListener('touchmove', this.boundOnTouchMove, { passive: false });
        this.songWrapper.addEventListener('touchend', this.boundOnTouchEnd, { passive: true });
        
        // 重複表示を避けるため、画面中央のデフォルト2D歌詞表示を非表示にする
        if (this.lyricRenderer && this.lyricRenderer.lyricContainer) {
            this.lyricRenderer.lyricContainer.style.display = 'none';
        }
        
        this.isActive = true;
        super.init();

        // 曲終了オーバーレイに表示される撮影成果を初期登録
        this.updateResultSummary();
    }

    // 撮影成果サマリーの登録（撮影のたび／ベスト選定時に最新値で上書き）
    updateResultSummary() {
        const lines = [];
        if (this.bestChosenTimeStr) {
            // プレイヤーが「決定的な1枚」を選んだ後
            lines.push(`★ ベストショット、決定！(${this.bestChosenTimeStr})`);
            lines.push(`撮影 ${this.totalShots}枚 ・ ベスト候補 ${this.starShots}枚`);
            if (SHUTTER_LAKE_ENABLED && this._bestShotSealed) {
                lines.push('この瞬間を、永遠に閉じ込めた');
            }
        } else {
            lines.push(`撮影 ${this.totalShots}枚 ・ ベスト候補 ${this.starShots}枚`);
        }
        this.setResultSummary({
            lines: lines,
            accentColor: '#D85A30',
            swatch: '#D85A30'
        });
    }

    // 再生開始の直前に被写体（ミク/リン）を選ばせる。選択が終わるまで曲は始めない。
    _autoStartPlayback() {
        if (this.selectedKey) {
            super._autoStartPlayback();
            return;
        }
        // 選択中は誤って再生されないよう一時停止
        if (playerManager.player && playerManager.player.isPlaying) playerManager.pause();
        this.showCastSelection((key) => {
            this.selectedKey = key;
            this.shownKey = key;
            // 選んだ1体だけ表示し、曲中の切替は行わない
            if (this.swap) this.swap = null;
            this.subjects.forEach((s) => {
                if (s.key !== key) this.restoreSubjectMaterials(s);
                s.mesh.visible = (s.key === key);
            });
            super._autoStartPlayback();
        });
    }

    // 被写体セレクト画面。ミク or リン を選んでから曲がスタートする。
    showCastSelection(onChosen) {
        this.isSelectingCast = true;
        const overlay = document.createElement('div');
        overlay.className = 'shutter-cast-overlay';
        overlay.style.cssText = `
            position:absolute; inset:0; z-index:60; display:flex; flex-direction:column;
            align-items:center; justify-content:center; gap:26px;
            background:rgba(8,4,3,0.84); backdrop-filter:blur(5px);
            opacity:0; transition:opacity .4s ease; pointer-events:auto;`;
        const castBtn = (key, label, color) => `
            <button class="shutter-cast-btn" data-key="${key}" style="
                min-width:160px; padding:22px 26px; cursor:pointer;
                background:rgba(0,0,0,0.55); color:#fff;
                border:2px solid ${color}; border-radius:12px;
                font-family:'Shippori Mincho',serif; font-size:22px; letter-spacing:.08em;
                box-shadow:0 0 14px ${color}55; text-shadow:0 0 8px ${color};
                transition:transform .15s ease, box-shadow .15s ease, background .15s ease;">
                <div style="font-family:monospace; font-size:10px; letter-spacing:.2em; opacity:.7; margin-bottom:8px;">${key.toUpperCase()}_CH</div>
                ${label}
            </button>`;
        overlay.innerHTML = `
            <div style="font-family:monospace; color:#fff; letter-spacing:.25em; font-size:13px; opacity:.8;">SELECT YOUR SUBJECT</div>
            <div style="font-family:'Shippori Mincho',serif; color:#fff; font-size:21px;">どちらを撮影しますか？</div>
            <div style="font-family:monospace; color:#fff; font-size:12px; letter-spacing:.12em; opacity:.6;">選ぶと撮影(再生)がはじまります</div>
            <div style="display:flex; gap:24px; flex-wrap:wrap; justify-content:center;">
                ${castBtn('miku', '初音ミク', '#39C5BB')}
                ${castBtn('rin', '鏡音リン', '#FFEE11')}
            </div>`;
        this.songWrapper.appendChild(overlay);
        requestAnimationFrame(() => { overlay.style.opacity = '1'; });

        // 選択中は下部の再生ボタンを視覚的にも無効化(押せそうに見せない)。選択確定/破棄時に復帰する。
        this._playBtnEl = document.getElementById('play-pause-btn');
        if (this._playBtnEl) {
            this._playBtnEl.style.opacity = '0.4';
            this._playBtnEl.style.pointerEvents = 'none';
        }

        overlay.querySelectorAll('.shutter-cast-btn').forEach((btn) => {
            btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-3px)'; });
            btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; });
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                this.isSelectingCast = false;
                if (this._playBtnEl) {                 // 再生ボタンを復帰
                    this._playBtnEl.style.opacity = '1';
                    this._playBtnEl.style.pointerEvents = 'auto';
                }
                overlay.style.opacity = '0';
                setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 400);
                onChosen(key);
            });
        });
    }

    // 被写体MMD（ミク&リン）をステージ奥にロードして横並びに配置（orchestraの実績パターンを踏襲）
    loadSubjects() {
        this.subjectLayout.forEach((def) => {
            const modelUrl = import.meta.env.BASE_URL + 'assets/models/' + def.model;
            const loader = new MMDLoader();
            loader.load(
                modelUrl,
                (mesh) => {
                    // Convert MMDToonMaterial to standard MeshPhongMaterial to prevent WebGL shader compilation errors
                    mesh.traverse((child) => {
                        if (child.isMesh && child.material) {
                            const convertMat = (m) => {
                                const newMat = new THREE.MeshPhongMaterial({
                                    name: m.name || '',
                                    color: m.color ? m.color.clone() : (m.diffuse ? m.diffuse.clone() : new THREE.Color(0xffffff)),
                                    specular: m.specular ? m.specular.clone() : new THREE.Color(0x111111),
                                    shininess: m.shininess !== undefined ? m.shininess : 30,
                                    emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000),
                                    transparent: m.transparent !== undefined ? m.transparent : false,
                                    opacity: m.opacity !== undefined ? m.opacity : 1.0,
                                    side: m.side !== undefined ? m.side : THREE.DoubleSide, // double side for clothes/hair
                                    depthWrite: m.depthWrite !== undefined ? m.depthWrite : true,
                                });
                                if (m.map) {
                                    newMat.map = m.map;
                                    // PMXの目パーツ(黒目/白目/ハイライト)などはRGBAテクスチャの透明境界で
                                    // 「白目が黒目の外側から覗く」構造。MMDToonMaterial→Phong変換で
                                    // 透明情報が落ちると黒目(虹彩)が目全体を不透明に覆い、白目が完全に隠れて
                                    // 「白目がない」状態になる。alphaTestで透明画素を切り抜き、奥の白目を見せる。
                                    // 不透明テクスチャ(肌・服など alpha=1)は一切影響を受けない。
                                    newMat.alphaTest = 0.5;
                                }
                                return newMat;
                            };

                            if (Array.isArray(child.material)) {
                                child.material = child.material.map(convertMat);
                            } else {
                                child.material = convertMat(child.material);
                            }
                        }
                    });

                    if (!this.isActive) {
                        this.disposeMMD(mesh);
                        return;
                    }
                    this.scene.add(mesh);
                    mesh.position.set(def.baseX, this.mikuBaseY, this.mikuBaseZ);
                    mesh.rotation.y = def.baseRotY; // カメラ正面

                    // Calculate native model height and auto-scale (target height: 5.6, twice the previous 2.8 size)
                    const box = new THREE.Box3().setFromObject(mesh);
                    const size = new THREE.Vector3();
                    box.getSize(size);

                    const targetHeight = 5.6;
                    let scaleFactor = def.scale;
                    if (size.y > 0.1) {
                        scaleFactor = targetHeight / size.y;
                    }
                    mesh.scale.setScalar(scaleFactor);

                    mesh.visible = (def.key === this.shownKey); // 表示中の1体だけ可視

                    const subject = {
                        key: def.key, mesh, vrm: mesh, baseX: def.baseX, baseRotY: def.baseRotY,
                        poseIndex: 0,
                        smile: 0, smileTimer: 0,      // にっこり（happy表情）のエンベロープ
                        poseExpr: 0, poseExprName: null, poseExprApplied: null,  // ポーズ指定表情（ウィンク等）のエンベロープ
                        matCache: this.buildSubjectMatCache(mesh), // フェード/発光復元用
                    };
                    // 初期ポーズ（リラックス）を即適用
                    this.applySubjectPoseImmediate(subject, SHUTTER_MIKU_POSES[0]);
                    this.subjects.push(subject);
                    if (def.key === 'miku') this.mikuVRM = mesh; // ライト/破棄の後方互換参照
                },
                undefined,
                (error) => {
                    console.error(`[SHUTTER] Failed to load ${def.key} MMD:`, error);
                }
            );
        });
    }

    getMMDBone(subject, vrmBoneName) {
        const mesh = subject.mesh;
        if (!mesh) return null;
        // VRM名→MMD名。未登録の名前は生のMMDボーン名(髪/ツインテール等)として直接解決。
        const mmdBoneName = VRM_TO_MMD_BONES[vrmBoneName] || vrmBoneName;
        return mesh.getObjectByName(mmdBoneName);
    }

    applySubjectPoseImmediate(subject, pose) {
        if (!subject.mesh) return;
        Object.keys(pose).forEach(boneName => {
            const bone = this.getMMDBone(subject, boneName);
            if (bone) {
                let rx = pose[boneName].x;
                let ry = pose[boneName].y;
                let rz = pose[boneName].z;
                // MMDの初期Aポーズに対する補正
                if (boneName === 'leftUpperArm') {
                    rz = rz - 0.5;
                } else if (boneName === 'rightUpperArm') {
                    rz = rz + 0.5;
                }
                bone.rotation.set(rx, ry, rz);
            }
        });
    }

    // 目標ポーズへ毎フレーム滑らかにイージング補間
    lerpSubjectPose(subject, pose, t) {
        if (!subject.mesh) return;
        Object.keys(pose).forEach(boneName => {
            const bone = this.getMMDBone(subject, boneName);
            if (!bone) return;
            let targetX = pose[boneName].x;
            let targetY = pose[boneName].y;
            let targetZ = pose[boneName].z;
            if (boneName === 'leftUpperArm') {
                targetZ = targetZ - 0.5;
            } else if (boneName === 'rightUpperArm') {
                targetZ = targetZ + 0.5;
            }
            bone.rotation.x += (targetX - bone.rotation.x) * t;
            bone.rotation.y += (targetY - bone.rotation.y) * t;
            bone.rotation.z += (targetZ - bone.rotation.z) * t;
        });
    }

    // キメポーズを「全身ぶんの完全なポーズ」へ展開する。基準テンプレート(POSE_ENTRY_BASE)へ
    // ポーズの定義ボーンを上書き＝未定義ボーンも基準姿勢へ明示的に寄せるための目標を作る。
    // これでエディタのプレビュー(mergePose(BASE_POSE, pose))と実機のキメポーズが一致し、
    // 直前のポーズ/待機の残りに依存しない決定論的な形になる。expr は対象外(別経路で適用)。
    buildFullPose(pose) {
        const full = {};
        for (const k in POSE_ENTRY_BASE) full[k] = POSE_ENTRY_BASE[k];
        if (pose) for (const k in pose) { if (k !== 'expr') full[k] = pose[k]; }
        return full;
    }

    // 目標ポーズへクォータニオン球面補間(slerp)で寄せる。オイラー各軸の直線補間と違い、
    // 上腕の大回転(ジャンプの x≈-π 等)でも最短弧で素直に回るため、入りの途中で腕が
    // ねじれて変な角度を通る不具合が出ない。t>=1 で目標へ完全一致(スナップ)。
    slerpSubjectPose(subject, pose, t) {
        if (!subject.mesh) return;
        const e = this._poseEuler || (this._poseEuler = new THREE.Euler());
        const q = this._poseQuat || (this._poseQuat = new THREE.Quaternion());
        Object.keys(pose).forEach((boneName) => {
            const bone = this.getMMDBone(subject, boneName);
            if (!bone) return;
            let tz = pose[boneName].z;
            // MMDの初期Aポーズ補正(lerpSubjectPose と同一)
            if (boneName === 'leftUpperArm') tz -= 0.5;
            else if (boneName === 'rightUpperArm') tz += 0.5;
            e.set(pose[boneName].x, pose[boneName].y, tz, bone.rotation.order);
            q.setFromEuler(e);
            if (t >= 1) bone.quaternion.copy(q);
            else bone.quaternion.slerp(q, t);
        });
    }

    // 切替トランジション用に各マテリアルの基準値（不透明度・発光色）を記録
    buildSubjectMatCache(mesh) {
        const cache = [];
        mesh.traverse((o) => {
            if (!o.material) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => {
                cache.push({
                    material: m,
                    baseOpacity: m.opacity,
                    baseTransparent: m.transparent,
                    baseDepthWrite: m.depthWrite,
                    baseEmissive: m.emissive ? m.emissive.clone() : null,
                });
            });
        });
        return cache;
    }

    // マテリアルを基準値へ戻す（トランジション終了時）
    restoreSubjectMaterials(subject) {
        subject.matCache.forEach((c) => {
            const m = c.material;
            m.transparent = c.baseTransparent;
            m.depthWrite = c.baseDepthWrite;
            m.opacity = c.baseOpacity;
            if (c.baseEmissive && m.emissive) m.emissive.copy(c.baseEmissive);
        });
    }

    // 「可愛い動き」ストックからプリセットを適用（grooveConfig と armStyle を切替）
    applyDancePreset(name) {
        const preset = SHUTTER_DANCE_PRESETS.find(p => p.name === name) || SHUTTER_DANCE_PRESETS[0];
        this.grooveConfig = { ...preset.config };
        this.armStyle = preset.armStyle;
        this.dancePresetName = preset.name;
        return preset;
    }

    // 次/前のプリセットへ切替（ストックのブラウズ用）。delta=+1/-1
    cycleDancePreset(delta) {
        const idx = SHUTTER_DANCE_PRESETS.findIndex(p => p.name === this.dancePresetName);
        const n = SHUTTER_DANCE_PRESETS.length;
        const next = SHUTTER_DANCE_PRESETS[((idx + delta) % n + n) % n];
        const preset = this.applyDancePreset(next.name);
        this.showDanceToast(preset.label);
        return preset;
    }

    // 切替時に現在のプリセット名を一瞬表示
    showDanceToast(label) {
        let el = document.getElementById('shutter-dance-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'shutter-dance-toast';
            el.style.cssText = `position:absolute; top:96px; left:50%; transform:translateX(-50%);
                z-index:40; font-family:'Shippori Mincho',serif; font-size:16px; color:#fff;
                background:rgba(8,4,3,0.7); border:1px solid ${this.themeColor}; border-radius:8px;
                padding:6px 16px; text-shadow:0 0 8px ${this.themeColor}; pointer-events:none;
                transition:opacity .3s; opacity:0;`;
            this.songWrapper.appendChild(el);
        }
        el.textContent = `♪ ${label}`;
        el.style.opacity = '1';
        clearTimeout(this._danceToastTimer);
        this._danceToastTimer = setTimeout(() => { if (el) el.style.opacity = '0'; }, 1400);
    }

    // プリセット(SHUTTER_CUTE_POSES)＋ユーザー自作(userPoses)を結合した全ポーズ。
    // ポーズバーの描画と triggerCutePose の検索はこれを単一の真実として参照する。
    getAllCutePoses() {
        return [...SHUTTER_CUTE_POSES, ...(this.userPoses || [])];
    }

    // ポーズバー（かわいいポーズ）の中身を再生成・再バインド。
    // プリセット → マイポーズ(削除×付き) → 「＋作る」(エディタ起動) の順。
    refreshPoseBar() {
        const bar = this.viewfinder && this.viewfinder.querySelector('#shutter-pose-bar');
        if (!bar) return;
        const esc = (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const btn = (p) => `
            <button class="shutter-pose-btn${p.user ? ' is-user' : ''}" data-pose="${esc(p.id)}" title="${esc(p.label)}">
                <span class="pose-emoji">${esc(p.emoji || '⭐')}</span>
                <span class="pose-label">${esc(p.label)}</span>
                ${p.user ? `<span class="pose-del" data-del="${esc(p.id)}" title="削除">×</span>` : ''}
            </button>`;
        bar.innerHTML = `<span class="pose-bar-label">POSE</span>` +
            this.getAllCutePoses().map(btn).join('') +
            `<button class="shutter-pose-btn shutter-pose-create" data-create="1" title="自分のポーズを作る">
                <span class="pose-emoji">＋</span>
                <span class="pose-label">作る</span>
            </button>`;
        // 撮影/カメラ首振りへ巻き込まれないよう伝播を止めて再バインド
        bar.querySelectorAll('.shutter-pose-btn').forEach((b) => {
            b.addEventListener('pointerdown', (e) => e.stopPropagation());
            b.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        });
        bar.querySelectorAll('.shutter-pose-btn[data-pose]').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation(); e.preventDefault();
                const del = e.target.closest('.pose-del');
                if (del) { this.deleteUserPose(del.getAttribute('data-del')); return; }
                this.triggerCutePose(b.getAttribute('data-pose'));
            });
        });
        const createBtn = bar.querySelector('.shutter-pose-create');
        if (createBtn) createBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); this.openPoseEditor(); });
    }

    // エディタを開く（撮影モードのサブモードへ）。
    openPoseEditor(baseId) {
        if (this.poseEditor) this.poseEditor.open(baseId);
    }

    // エディタから渡された自作ポーズを永続化し、ポーズバーへ反映。
    saveUserPose(entry) {
        if (!entry || !entry.id || !entry.pose) return;
        this.userPoses = [...(this.userPoses || []), entry].slice(-USER_POSE_MAX);
        saveUserPoses(this.userPoses);
        this.refreshPoseBar();
    }

    // 自作ポーズを削除し、ポーズバーへ反映。
    deleteUserPose(id) {
        this.userPoses = (this.userPoses || []).filter((p) => p.id !== id);
        saveUserPoses(this.userPoses);
        this.refreshPoseBar();
    }

    // 「かわいいポーズ」ボタン: 指定ポーズを一定時間ホールドする（ホールド中はグルーヴ抑制＆移動も抑制）。
    triggerCutePose(poseId) {
        const cp = this.getAllCutePoses().find((p) => p.id === poseId);
        if (!cp) return;
        const now = performance.now();
        const holdMs = 3200;
        const resetMs = 240;
        // 直前のキメポーズがまだホールド中に別ポーズを押した場合は、いったん基本姿勢へ
        // 戻す「リセット相」を挟む。プリセットごとに定義ボーンが異なるため、前ポーズの
        // 未定義ボーンが残って姿勢が崩れるのを防ぐ(デフォルトに戻ってから新ポーズへ)。
        const switching = !!(this.poseOverride && now < this.poseOverride.until);
        const resetUntil = switching ? now + resetMs : 0;
        this.poseOverride = {
            pose: cp.pose,
            id: poseId,
            resetUntil,                                       // この時刻までは基本姿勢へ戻す相
            startedAt: now,                                   // 実ポーズ入りの起点(リセット相終了時に更新)
            until: (switching ? resetUntil : now) + holdMs,   // ホールド長はリセット分を足して保つ
        };
        // 表情も笑顔に寄せて可愛さを強調
        const shown = this.subjects.find((s) => s.key === this.shownKey);
        if (shown) shown.smileTimer = holdMs;
        // ポーズ切替で髪の物理が暴れないようリセット
        if (shown && shown.mesh && shown.mesh.springBoneManager) shown.mesh.springBoneManager.reset();
        this.highlightPoseButton(poseId, holdMs);
        try { sfx.play('shutter_click'); } catch (e) { /* SE未定義でも無害 */ }
    }

    // 選択中ポーズのボタンをハイライト。ホールド終了で解除。
    highlightPoseButton(poseId, holdMs) {
        if (!this.viewfinder) return;
        this.viewfinder.querySelectorAll('.shutter-pose-btn').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-pose') === poseId);
        });
        clearTimeout(this._poseBtnTimer);
        this._poseBtnTimer = setTimeout(() => {
            if (this.viewfinder) {
                this.viewfinder.querySelectorAll('.shutter-pose-btn.active').forEach((b) => b.classList.remove('active'));
            }
        }, holdMs);
    }

    // ビート同期グルーヴ: 腰の体重移動・拍の沈み込み・膝バウンス・頭ノリ・腕振りを
    // 腕の型(armStyle)の上に重ねて踊らせる。毎フレーム絶対値で代入し累積を防ぐ。
    // （song-kotaete.js の applyGroove を被写体1体構成向けに移植・調整）
    // 待機モーション(ARM_GESTURES + applySubjectGroove)が制御しないボーンを中立(0)へ戻す。
    // groove は腕・胴・頭・脚の主要軸を絶対値で上書きするが、肩のx/y・手首・首・足首・脚のyは
    // 触らないため、それらを動かすキメポーズ(お願い/きゅるん/バンザイ等)の解除後に値が残って
    // 待機姿勢が破綻する。idleブランチで groove の前にこれらを中立へイージングして根絶する。
    // groove が扱う軸(肩z・脚x/z 等)はこの後 groove が上書きするので 0 へ寄せても安全。
    // ボタン非押下時(アイドル)の腕の型ジェスチャ。armStyle とサビ状態で決まる。
    // 待機ブランチとキメポーズ切替時のリセット先で共有し、ロジックを一致させる。
    idleGesture() {
        const calmStyles = ['relaxed', 'faceHands', 'handsOnHips'];
        const gestureName = (this.isClimax && calmStyles.includes(this.armStyle)) ? 'cheer' : this.armStyle;
        return ARM_GESTURES[gestureName] || ARM_GESTURES.cheer;
    }

    relaxIdleBones(subject, t) {
        // 腕以外の「ポーズが触りうる全ボーン」を中立(0)へ寄せる(RELAX_IDLE_BONES の構築方針を参照)。
        // この後 applySubjectGroove が踊りの駆動軸を上書きするため、駆動軸はダンス値・非駆動軸
        // (hips.x/chest.z/髪/ポーズ編集で動かした任意の部位)は0へ戻る。ツインテールが上を向いたまま
        // 残る等の「ポーズ解除後にパラメータが戻らない」不具合を一括で解消する。
        for (const name of RELAX_IDLE_BONES) {
            const bone = this.getMMDBone(subject, name);
            if (!bone) continue;
            bone.rotation.x += (0 - bone.rotation.x) * t;
            bone.rotation.y += (0 - bone.rotation.y) * t;
            bone.rotation.z += (0 - bone.rotation.z) * t;
        }
    }

    applySubjectGroove(subject, t, deltaSec, beatPulse) {
        if (!subject.mesh) return;
        const cfg = this.grooveConfig;
        const get = (n) => this.getMMDBone(subject, n);
        const hips = get('hips'), spine = get('spine'), chest = get('upperChest') || get('chest') || get('spine'), head = get('head');
        if (!spine && !hips) return;
        // サビ強度を 0→1 で平滑化（isClimaxの真偽が切り替わる瞬間に振幅がスナップして
        // 腕がガクッと跳ねるのを防ぐ。ダンス全体がサビへ滑らかに盛り上がる）。
        this._climaxAmt += ((this.isClimax ? 1 : 0) - this._climaxAmt) * Math.min(1, deltaSec * 2.5);
        const cx = this._climaxAmt;
        const gain = cfg.gain * (1 + (cfg.climaxGain * 1.5 - 1) * cx);
        const g = this._groove;

        // 拍頭で胴を前に沈めて跳ね返す（スクワッシュ＆ストレッチ）。小節頭は踏み込みを強調
        const punch = (g + this._barAccent * 0.5) * cfg.punch * gain;
        if (spine) spine.rotation.x = punch;
        if (chest) chest.rotation.x = -punch * 0.5;

        // 体重移動: 拍ごとに左右へ振る振り子（_beatStepで反転）。腰・胴でSカーブ＋ひねり
        const swayTarget = this._beatStep * cfg.sway * gain;
        this._swayCur += (swayTarget - this._swayCur) * Math.min(1, deltaSec * 6);
        const s = this._swayCur;
        const swayN = Math.max(-1, Math.min(1, s / Math.max(0.001, cfg.sway * gain))); // -1..1
        // 脇を締めた(腕を下ろした)振付では、胴の傾き/ひねりが大きいと下ろした肘が幅広の胴(特にリン)へ
        // 寄って貫通する。上体の傾き・ひねりは一定上限でクランプし、どのプリセット(大振りのappeal等)でも
        // 脇締めの肘が体へ寄り過ぎないようにする。
        const sB = Math.max(-0.13, Math.min(0.13, s));       // 体の傾きに使う上限付きsway
        const twN = Math.max(-0.55, Math.min(0.55, swayN * cfg.twist)); // ひねり上限
        if (hips) { hips.rotation.z = sB * 0.6; hips.rotation.y = twN * 0.3; }
        if (spine) { spine.rotation.z = -sB * 0.4; spine.rotation.y = twN * 0.34; }
        if (chest) chest.rotation.y = twN * 0.18;

        // 頭: 拍で頷き＋体重移動に追従した傾き＆こちらを見るような向き
        if (head) {
            head.rotation.x = g * cfg.headNod * gain + Math.sin(t * 1.2) * 0.03;
            head.rotation.z = s * 0.5;
            head.rotation.y = -swayN * 0.12;
        }

        // 脚: 両膝の屈伸（接地を保つ）＋ステップ(足踏み)で体重が抜けた側の足を軽く上げる
        const lUL = get('leftUpperLeg'), rUL = get('rightUpperLeg');
        const lLL = get('leftLowerLeg'), rLL = get('rightLowerLeg');
        const knee = g * cfg.kneeBounce * gain;
        const stepL = Math.max(0, -swayN) * cfg.step * gain; // 左に体重→右足が上がる…の対で交互に
        const stepR = Math.max(0, swayN) * cfg.step * gain;
        if (lUL) { lUL.rotation.z = Math.PI / 40; lUL.rotation.x = knee * 0.5 + stepR; }
        if (rUL) { rUL.rotation.z = -Math.PI / 40; rUL.rotation.x = knee * 0.5 + stepL; }
        if (lLL) lLL.rotation.x = -knee - stepR * 1.2;
        if (rLL) rLL.rotation.x = -knee - stepL * 1.2;

        // 肩: 拍ごとに軽く上下させて弾み感
        const lSh = get('leftShoulder'), rSh = get('rightShoulder');
        if (lSh) lSh.rotation.z = g * cfg.shoulder * gain;
        if (rSh) rSh.rotation.z = -g * cfg.shoulder * gain;

        // 腕: 脇を締めて両手を胸の前で揃える可愛いポーズ。
        // 実機で腕角度マップを撮影しユーザが選定(チャートA/B)。確定した正しいボーン軸の対応:
        //  - 上腕Z(luaZ)を**マイナス(≈ -0.35)にすると脇が締まって腕が下りる**。
        //    0で真横(Tポーズ・脇全開)、プラスで腕が上がり +1.6 でバンザイ。以前の「≈1.8で脇締め」は誤り。
        //  - 上腕を脇に下ろした(luaZ -0.35)まま、やや前(luaX≈0.20)へ出し、
        //    前腕(肘)を深く折る(llaZ≈-1.6)と、脇を締めたまま手が胸の前で揃う。
        //  - 肘の曲げは肘位置(肩からの距離)を変えないので深く折っても貫通しない＝可愛さと動きの主役。
        //  - 両手対称。ゆっくり呼吸(手が胸↔やや下を往復)＋小首かしげで、脇を締めたまま躍動と表情を出す。
        //  - 上体の傾き/ひねりは下流で上限クランプ済みなので、脇を締めた肘が幅広の胴(リン)へ寄っても貫通しない。
        const lUA = get('leftUpperArm'), rUA = get('rightUpperArm');
        const lLA = get('leftLowerArm'), rLA = get('rightLowerArm');
        const breathe = Math.sin(t * 1.4);                       // ゆっくりした呼吸(両手同位相＝対称)
        const rise = breathe * 0.5 + 0.5;                        // 0..1
        const uaZ = 0.35 - swayN * 0.03;                         // 脇締め維持。体重移動で僅かに
        const uaX = 0.20 + rise * 0.06;                          // 手をやや前後に
        if (lUA) lUA.rotation.set(uaX, 0, -uaZ);                 // 左: 脇締め(z負)
        if (rUA) rUA.rotation.set(uaX, 0,  uaZ);                 // 右: 脇締め(z正・左右対称)
        // 前腕: 深く折って手を胸の前へ。呼吸で胸↔やや下をゆっくり往復(サビで少し大きく)。
        const fold = 1.55 + rise * 0.22 * (1 + 0.25 * cx);
        if (lLA) lLA.rotation.set(0, 0, -fold);
        if (rLA) rLA.rotation.set(0, 0,  fold);
        // 小首かしげ(可愛さを添える)。グルーヴが設定した頭の傾きに加算
        const headB = get('head');
        if (headB) headB.rotation.z += 0.12 * Math.sin(t * 0.5);

        // 小節頭アクセントの減衰
        this._barAccent = Math.max(0, this._barAccent - deltaSec * 2.2);
    }

    // 腕の体内貫通を「絶対に」防ぐ幾何クランプ。体に寄せるキメポーズ(ホールド中)だけ呼ぶ。
    // 通常ダンスは applySubjectGroove が腕を安全包絡(脇)で動かすため呼ばない＝毎フレーム補正
    // による細かい振動を出さない。ホールドは静止しているのでこのクランプも安定し振動しない。
    // ねんどろ(チビ)体型は胴が深く腕が短いため、ポーズ値だけ見ても合成結果が胴へ食い込む
    // （実測: 胴の前面はz≈0.95・側面はx≈0.7まで張り出し、踊ると肘がd≈0.66まで埋まる）。
    // 手首だけ逃がすと前腕・肘が残って貫通するため、肘・手首・手先の3点をワールド座標で判定し、
    // 「胴の縦バンド内」かつ「胴中心軸から水平半径R未満」なら、その点を制御する関節
    // （肘=上腕／手首・手先=上腕→前腕）を1関節CCDで回し、軸から半径R以上の外側へ押し出す。
    // 押し出し方向は胴中心軸からの放射(=最寄りの胴表面の外)。上腕ローカル軸の単純回転は腕姿勢で
    // 前方へ動かないため、目標方向をワールド空間で与えて rotateOnWorldAxis で寄せる(姿勢非依存)。
    clampArmsWorld(subject) {
        const mesh = subject.mesh;
        if (!mesh) return;
        const spine = this.getMMDBone(subject, 'spine');     // 上半身
        const hips = this.getMMDBone(subject, 'hips');       // 下半身
        if (!spine || !hips) return;
        const chest = mesh.getObjectByName('上半身2') || spine;
        mesh.updateMatrixWorld(true);   // 読み取り前にボーン回転をワールド行列へ反映
        const a = this._armScratchA, b = this._armScratchB, w = this._armScratchW;
        const P = this._armScratchP, T = this._armScratchT, fwd = this._armScratchFwd;
        const v1 = this._armScratchV1, v2 = this._armScratchV2, axis = this._armScratchAxis;
        spine.getWorldPosition(a);
        hips.getWorldPosition(b);
        const axisX = (a.x + b.x) / 2, axisZ = (a.z + b.z) / 2;  // 胴の中心軸(x,z)
        chest.getWorldPosition(a);
        const bandLow = b.y - 0.45, bandHigh = a.y + 1.3;        // 胴の縦バンド(下半身〜胸〜首/顔下)
        // 被写体の前方(ワールド)。near-center時のフォールバック方向に使う。
        mesh.getWorldQuaternion(this._armScratchQuat);
        fwd.set(0, 0, 1).applyQuaternion(this._armScratchQuat); fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1); else fwd.normalize();
        // 胴の水平断面を楕円でモデル化(実測: 側面x≈0.7・前面z≈0.95と前後に深い)。
        // 半径Aₓ(左右)・B_z(前後)＋余裕。点が楕円の内側(e2<1)なら貫通とみなし外周へ押す。
        const A0 = 0.82, B0 = 1.05;
        const MAX_ITER = 20, MAX_STEP = 0.2, STEP_LEN = 0.4;

        // joint を回して point(関数で w に取得)を 胴楕円の外側へCCDで押し出す。scaleで余裕量を調整。
        const pushOut = (joint, getPoint, scale, ownSign) => {
            const A = A0 * scale, B = B0 * scale;
            joint.getWorldPosition(P);
            for (let it = 0; it < MAX_ITER; it++) {
                getPoint(w);
                if (w.y <= bandLow || w.y >= bandHigh) return;        // バンド外なら貫通しない
                const dx = w.x - axisX, dz = w.z - axisZ;
                const e2 = (dx / A) * (dx / A) + (dz / B) * (dz / B);
                if (e2 >= 1.08) return;                                // 楕円の外側(余裕込み)＝クリア
                // 楕円の外向き法線方向(∝ dx/A², dz/B²)。軸近傍は前方＋肩側へ逃がす
                let nx = dx / (A * A), nz = dz / (B * B);
                let nl = Math.hypot(nx, nz);
                if (nl < 1e-4) { nx = fwd.x + ownSign * 0.6; nz = fwd.z; nl = Math.hypot(nx, nz) || 1; }
                nx /= nl; nz /= nl;
                T.set(w.x + nx * STEP_LEN, w.y + 0.03, w.z + nz * STEP_LEN);
                v1.copy(w).sub(P); v2.copy(T).sub(P);
                if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) return;
                v1.normalize(); v2.normalize();
                axis.crossVectors(v1, v2);
                const len = axis.length();
                if (len < 1e-5) return;
                axis.divideScalar(len);
                joint.rotateOnWorldAxis(axis, Math.min(MAX_STEP, Math.asin(Math.min(1, len))));
                joint.getWorldPosition(P);   // 関節も動くので再取得
            }
        };

        const arms = [
            ['leftUpperArm', 'leftLowerArm', 'leftHand'],
            ['rightUpperArm', 'rightLowerArm', 'rightHand'],
        ];
        for (const [uaName, faName, handName] of arms) {
            const ua = this.getMMDBone(subject, uaName);     // 上腕(左腕/右腕)
            const fa = this.getMMDBone(subject, faName);     // 前腕(左ひじ/右ひじ)
            const wrist = this.getMMDBone(subject, handName);// 手首(左手首/右手首)
            if (!ua || !fa || !wrist) continue;
            ua.getWorldPosition(P);
            const ownSign = Math.sign(P.x - axisX) || 1;
            const getElbow = (o) => fa.getWorldPosition(o);
            const getWrist = (o) => wrist.getWorldPosition(o);
            // 手先(手首の少し先): 肘→手首方向へ延長した点
            const getHand = (o) => {
                wrist.getWorldPosition(o);
                fa.getWorldPosition(a);             // a=肘
                b.copy(o).sub(a);                   // 前腕方向
                if (b.lengthSq() > 1e-8) o.add(b.normalize().multiplyScalar(0.35));
                return o;
            };
            // 肘→手首→手先 の順に、上腕(肘)・前腕(手首/手先)で楕円外へ押し出す
            pushOut(ua, getElbow, 1.0, ownSign);    // 肘を上腕で外へ
            pushOut(ua, getWrist, 1.0, ownSign);    // 手首を上腕で外へ
            pushOut(fa, getWrist, 1.0, ownSign);    // 手首を前腕で外へ
            pushOut(fa, getHand, 1.05, ownSign);    // 手先を前腕で外へ(やや余裕)
        }
    }

    disposeMMD(mesh) {
        if (!mesh) return;
        mesh.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((m) => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    });
                } else {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                }
            }
        });
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    onWheel(e) {
        e.preventDefault();
        // スクリュー方向で拡大・縮小
        const delta = -e.deltaY * 0.0015;
        this.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetZoom + delta));
    }

    onTouchStart(e) {
        if (e.touches.length === 2) {
            // 2本指の距離を測定
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this.touchStartDist = Math.sqrt(dx * dx + dy * dy);
        }
    }

    onTouchMove(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (this.touchStartDist > 0) {
                const ratio = dist / this.touchStartDist;
                // ピンチ比率に基づいて目標ズームを変更
                this.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetZoom * (ratio > 1 ? 1.03 : 0.97)));
                this.touchStartDist = dist; // 次回更新用
            }
        }
    }

    onTouchEnd(e) {
        if (e.touches.length < 2) {
            this.touchStartDist = 0;
        }
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x110805, 0.01); // Reduced fog density so frames are visible
        this.scene.background = new THREE.Color(0x110805);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0, 10);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(quality.effectivePixelRatio());
        this.renderer.__qpr = quality.effectivePixelRatio();
        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.pointerEvents = 'none'; // allow clicks to pass through to songWrapper
        this.songWrapper.appendChild(this.renderer.domElement);

        // 被写体ミクVRM用ライティング（既存のワイヤーフレーム・スプライトは無灯影響なし）
        // 「撮影されるアイドル」として映えるよう三点照明にする。暗い背景に立体感と輪郭を出す。
        this.ambientLight = new THREE.AmbientLight(0x40342e, 1.0); // コントラストのため控えめに
        this.scene.add(this.ambientLight);
        // キーライト: 前・斜め上から顔と身体にモデリング(陰影)を作る
        this.dirLight = new THREE.DirectionalLight(0xffe8d0, 2.0);
        this.dirLight.position.set(2, 5, 10);
        this.scene.add(this.dirLight);
        this.keyLight = new THREE.SpotLight(0xfff4ea, 70, 60, Math.PI / 5, 0.55, 1.3);
        this.keyLight.position.set(4.5, 4, -9);
        this.keyLight.target.position.set(this.mikuBaseX, this.mikuBaseY + 1.2, this.mikuBaseZ);
        this.scene.add(this.keyLight);
        this.scene.add(this.keyLight.target);
        // リムライト: 背後からティールで輪郭を光らせ、暗い背景から被写体を分離する
        this.rimLight = new THREE.SpotLight(new THREE.Color(this.themeColor), 90, 55, Math.PI / 6, 0.6, 1.2);
        this.rimLight.position.set(-4.5, 3.5, this.mikuBaseZ - 7);
        this.rimLight.target.position.set(this.mikuBaseX, this.mikuBaseY + 1.2, this.mikuBaseZ);
        this.scene.add(this.rimLight);
        this.scene.add(this.rimLight.target);
    }

    updateFramePosition(frame) {
        const ud = frame.userData;
        const cosA = Math.cos(ud.orbitAngle);
        const sinA = Math.sin(ud.orbitAngle);
        
        // 3D空間におけるパースペクティブ楕円軌道座標の計算
        const baseValX = sinA * ud.orbitWidth;
        const baseValZ = -cosA * ud.orbitDepth + ud.centerZ;
        const baseValY = Math.sin(ud.orbitAngle * 2) * (ud.orbitHeight * 0.2) + cosA * (ud.orbitHeight * 0.3);
        
        const pos = new THREE.Vector3(baseValX, baseValY, baseValZ);
        
        // 軌道全体の3次元傾斜の適用
        pos.applyAxisAngle(new THREE.Vector3(1, 0, 0), ud.tiltX);
        pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), ud.tiltY);
        
        frame.position.copy(pos);
    }

    initEnvironment() {
        // Create flying polaroid frames (wireframe)。枠サイズは 4×3 の1.5倍 = 6×4.5。
        const boxGeo = new THREE.BoxGeometry(6, 4.5, 0.15);
        const edges = new THREE.EdgesGeometry(boxGeo);
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(this.themeColor) });

        for (let i = 0; i < 20; i++) {
            const frame = new THREE.LineSegments(edges, mat);
            
            // 3D周回（楕円軌道）パラメータの設定
            const angle = Math.random() * Math.PI * 2;
            const orbitWidth = 10 + Math.random() * 10;
            const orbitHeight = 6 + Math.random() * 8;
            const orbitDepth = 22 + Math.random() * 6;
            const centerZ = -25 - Math.random() * 5;
            const orbitSpeed = 0.0015 + Math.random() * 0.002;
            const tiltX = (Math.random() - 0.5) * 0.4;
            const tiltY = (Math.random() - 0.5) * 0.4;

            frame.userData = {
                orbitAngle: angle,
                orbitWidth: orbitWidth,
                orbitHeight: orbitHeight,
                orbitDepth: orbitDepth,
                centerZ: centerZ,
                orbitSpeed: orbitSpeed,
                tiltX: tiltX,
                tiltY: tiltY,
                rotSpeed: new THREE.Vector3((Math.random()-0.5)*0.015, (Math.random()-0.5)*0.015, (Math.random()-0.5)*0.015),
                hasPhoto: false,
                photoMesh: null,
                photoImage: null,
                photoSpawnTime: 0,
                fadeOpacity: 1.0,
                isFadingOut: false
            };

            // 固有の初期姿勢を設定
            frame.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );

            // 初期位置を軌道パラメータから計算して設定
            this.updateFramePosition(frame);

            this.scene.add(frame);
            this.frames.push(frame);
        }

        // 中央のAFターゲットレティクルは廃止。
        // 旧実装は z=-15 の3Dリングだったが、被写体ミクが手前(z>-15)へ動くと
        // リングがミクの背後に回り込んで見えるレイヤー破綻があり、かつ実際のピント合わせ機能も
        // 持たない飾りだったため撤去する。これに依存していたロック判定/「NOW!」合図は
        // すべて `if (this.targetScope)` ガードで自動的に無効化される。
        this.targetScope = null;

        // 夜空の湖: 被写体の足元に手続き水面を敷き、月と星空をその上に映す（反射RT不使用）
        this.initLakeNightSky();
        this.initLakeSurface();
    }

    // --- 夜空: 月＋星々を被写体の奥・上空に配置（水面の映り込みの“光源”になる） -----
    // 反射はRTを使わず水面シェーダ側で手続き的に近似するが、実体としても月・星を置くことで
    // 「夜空の湖」として画面に夜空そのものが見える。フラグoff時は生成しない。
    initLakeNightSky() {
        if (!SHUTTER_LAKE_ENABLED) return;
        const pivotZ = this.mikuBaseZ;
        // 月: 柔らかい円盤スプライト（常にカメラを向く）。x位置は水面の月光レーンと一致させる。
        const moonTex = this.makeMoonTexture();
        const moonMat = new THREE.SpriteMaterial({
            map: moonTex, transparent: true, depthWrite: false, fog: false,
            blending: THREE.AdditiveBlending, opacity: 0.95,
        });
        const moon = new THREE.Sprite(moonMat);
        moon.scale.set(26, 26, 1);
        moon.position.set(this.lakeMoonX, 30, pivotZ - 86);
        this.scene.add(moon);
        this.lakeMoon = moon;

        // 星々: 被写体の奥〜上空に散らした点群（フォグ無効でくっきり）。
        const N = this.isMobile ? 110 : 180;
        const pos = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
            const az = (Math.random() * 2 - 1) * 1.35;       // 前方(-z)を中心に左右へ
            const el = 0.07 + Math.random() * 0.92;          // 地平〜頭上
            const R = 110 + Math.random() * 45;
            const ce = Math.cos(el);
            pos[i * 3] = Math.sin(az) * R * ce;
            pos[i * 3 + 1] = 6 + Math.sin(el) * R * 0.8;
            pos[i * 3 + 2] = pivotZ - Math.cos(az) * R * ce;
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const starMat = new THREE.PointsMaterial({
            color: 0xcdd8ff, size: 0.9, sizeAttenuation: true,
            transparent: true, opacity: 0.9, depthWrite: false, fog: false,
            blending: THREE.AdditiveBlending,
        });
        const stars = new THREE.Points(starGeo, starMat);
        stars.frustumCulled = false;
        this.scene.add(stars);
        this.lakeStars = stars;
    }

    // 月の柔らかい円盤テクスチャ（中心ほど明るい放射グラデ）を生成
    makeMoonTexture() {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
        grd.addColorStop(0, 'rgba(248,250,255,1)');
        grd.addColorStop(0.42, 'rgba(214,226,255,0.9)');
        grd.addColorStop(0.72, 'rgba(150,175,235,0.35)');
        grd.addColorStop(1, 'rgba(120,150,220,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, 128, 128);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    // --- A-1: 夜の湖面 -------------------------------------------------------
    // 被写体の足元(y=mikuBaseY)に水平な水面プレーンを1枚敷く。空のRTを使わず、
    // フラグメントシェーダ内で「手前=深い藍／奥(水際)=群青」「月光が立つ銀色のレーン」
    // 「反射してまたたく星々」「さざ波のきらめき」を手続き的に近似して夜空の湖を作る。
    initLakeSurface() {
        if (!SHUTTER_LAKE_ENABLED) return;
        const uni = {
            uTime: { value: 0 }, uOpacity: { value: 0 }, uCam: { value: new THREE.Vector3() },
            uMoonReflX: { value: this.lakeMoonX },
        };
        const geo = new THREE.PlaneGeometry(180, 260, 1, 1);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, uniforms: uni,
            vertexShader: `
              varying vec3 vW; varying vec2 vLoc;
              void main(){ vLoc = position.xz; vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz;
                gl_Position = projectionMatrix * viewMatrix * wp; }`,
            fragmentShader: `
              varying vec3 vW; varying vec2 vLoc;
              uniform float uTime, uOpacity, uMoonReflX; uniform vec3 uCam;
              float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1))) * 43758.5453); }
              float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
                float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
                return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
              // 反射した星空: 格子状に疎な星を置き、時間でまたたかせる
              float starField(vec2 uv, float t){
                vec2 g = floor(uv); vec2 f = fract(uv);
                float present = step(0.90, hash(g + vec2(7.1, 3.3)));
                vec2 sp = vec2(hash(g + vec2(1.0, 0.0)), hash(g));
                float d = length(f - sp);
                float tw = 0.45 + 0.55 * sin(t * 2.2 + hash(g) * 40.0);
                return present * smoothstep(0.16, 0.0, d) * max(tw, 0.0);
              }
              void main(){
                float t = uTime;
                vec2 p = vLoc;
                float dist = length(vW.xz - uCam.xz);
                float far = clamp(dist*0.012, 0.0, 1.0);          // 0=手前 1=遠く(水際)
                float n1 = vnoise(p*0.10 + vec2(t*0.04, t*0.025));
                float n2 = vnoise(p*0.40 - vec2(t*0.05, t*0.04));
                vec2 ripple = vec2(n1-0.5, n2-0.5);
                // 夜の水: 手前は深い藍、奥(水際)はやや明るい群青
                vec3 deep    = vec3(0.010, 0.018, 0.045);
                vec3 horizon = vec3(0.035, 0.060, 0.130);
                vec3 col = mix(deep, horizon, far);
                // 反射した星々(水際ほど密。さざ波で揺らぐ)
                vec2 sUv = (vW.xz + ripple * 6.0) * 0.32;
                float stars = starField(sUv, t) + starField(sUv * 1.9 + 13.0, t * 1.3) * 0.6;
                col += vec3(0.78, 0.84, 1.0) * stars * far * 0.95;
                // 月光のレーン(uMoonReflX 付近に立つ銀色の輝き)
                float lane = smoothstep(22.0, 0.0, abs(vW.x - uMoonReflX));
                float shimmer = 0.55 + 0.45*sin(t*0.8 + vW.z*0.3 + n1*6.0);
                col += vec3(0.55, 0.65, 0.88) * lane * far * shimmer * 0.7;
                // 月のきらめき(さざ波のスペキュラ)
                vec3 nrm = normalize(vec3(ripple.x*1.7, 1.0, ripple.y*1.7));
                vec3 vd = normalize(uCam - vW);
                float spec = pow(max(nrm.y * max(dot(nrm, vd), 0.0), 0.0), 10.0);
                col += vec3(0.90, 0.95, 1.0) * spec * lane * 0.5;
                // 遠いほど暗背景へ溶けるアルファ(フォグ代わり)
                float a = uOpacity * mix(0.92, 0.0, smoothstep(0.55, 1.0, far));
                gl_FragColor = vec4(col, a);
              }`,
        });
        const water = new THREE.Mesh(geo, mat);
        water.position.set(0, this.mikuBaseY - 0.02, this.mikuBaseZ - 40);
        water.frustumCulled = false;
        this.scene.add(water);
        this.lakeWater = water;
        this.lakeWaterUni = uni;
    }

    // 水面のアニメ更新＋撮影波紋(A-2)のライフサイクル。毎フレーム update() から呼ぶ。
    updateLakeSurface() {
        if (!SHUTTER_LAKE_ENABLED || !this.lakeWater) return;
        const now = performance.now();
        const dt = this._lakeLastT ? Math.min(0.05, (now - this._lakeLastT) / 1000) : 0.016;
        this._lakeLastT = now;
        this.lakeWaterUni.uTime.value = now * 0.001;
        if (this.camera) this.lakeWaterUni.uCam.value.copy(this.camera.position);
        this._lakeFade = Math.min(0.92, this._lakeFade + dt * 0.8);
        this.lakeWaterUni.uOpacity.value = this._lakeFade;

        // 星々をゆっくりまたたかせる（全体のopacityを微振動）
        if (this.lakeStars) {
            this.lakeStars.material.opacity = (0.72 + 0.22 * Math.sin(now * 0.0017)) * this._lakeFade / 0.92;
        }
        if (this.lakeMoon) this.lakeMoon.material.opacity = 0.95 * this._lakeFade / 0.92;

        for (let i = this.lakeRipples.length - 1; i >= 0; i--) {
            const r = this.lakeRipples[i];
            r.t += dt;
            const k = r.t / r.life;
            if (k >= 1) {
                this.scene.remove(r.mesh);
                r.mesh.material.dispose();
                this.lakeRipples.splice(i, 1);
                continue;
            }
            const s = 0.5 + k * 16;
            r.mesh.scale.set(s, s, s);
            r.mesh.material.opacity = (1 - k) * 0.55;
        }
    }

    // --- A-2: 撮影のたびに足元の水面へ波紋を一つ広げる ------------------------
    spawnLakeRipple() {
        if (!SHUTTER_LAKE_ENABLED || !this.lakeWater) return;
        if (!this._lakeRingGeo) {
            this._lakeRingGeo = new THREE.RingGeometry(0.45, 0.6, 40);
            this._lakeRingGeo.rotateX(-Math.PI / 2);
        }
        const mat = new THREE.MeshBasicMaterial({
            color: 0xbcd2ff, transparent: true, opacity: 0.55,
            depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(this._lakeRingGeo, mat);
        ring.position.set((Math.random() - 0.5) * 2, this.mikuBaseY + 0.06, this.mikuBaseZ + (Math.random() - 0.5) * 2);
        this.scene.add(ring);
        this.lakeRipples.push({ mesh: ring, t: 0, life: 1.9 });
        // リング数が増えすぎないよう古いものから間引く
        if (this.lakeRipples.length > 6) {
            const old = this.lakeRipples.shift();
            this.scene.remove(old.mesh);
            old.mesh.material.dispose();
        }
    }

    injectCustomStyles() {
        this.customStyleElement = document.createElement('style');
        this.customStyleElement.innerHTML = `
            #shutter-zoom-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #FFEE11;
                border: 2px solid #B9543C;
                cursor: pointer;
                box-shadow: 0 0 8px #FFEE11;
                transition: transform 0.1s;
            }
            #shutter-zoom-slider::-webkit-slider-thumb:hover {
                transform: scale(1.2);
            }
            #shutter-zoom-slider::-moz-range-thumb {
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #FFEE11;
                border: 2px solid #B9543C;
                cursor: pointer;
                box-shadow: 0 0 8px #FFEE11;
            }
            /* タッチ端末(スマホ・タブレット)では指で押しやすいよう拡大縮小トグルを大きくする。
               +/- ボタンは最小44pxの指タップ域を確保し、スライダーは透明な幅広トラックで
               当たり判定を広げつつ中央に細い見た目のレールとイエローの大ツマミを描画する。 */
            @media (pointer: coarse) {
                .shutter-zoom-btn {
                    min-width: 48px;
                    min-height: 48px;
                    font-size: 26px !important;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 12px !important;
                    background: rgba(185, 84, 60, 0.18) !important;
                    border: 1px solid rgba(185, 84, 60, 0.5) !important;
                }
                .shutter-zoom-btn:active {
                    background: rgba(255, 238, 17, 0.35) !important;
                }
                #shutter-zoom-slider {
                    width: 44px !important;
                    background:
                        linear-gradient(to right, transparent calc(50% - 3px),
                            rgba(185, 84, 60, 0.5) calc(50% - 3px),
                            rgba(185, 84, 60, 0.5) calc(50% + 3px),
                            transparent calc(50% + 3px)) !important;
                    border: none !important;
                }
                #shutter-zoom-slider::-webkit-slider-thumb {
                    width: 34px;
                    height: 34px;
                }
                #shutter-zoom-slider::-moz-range-thumb {
                    width: 34px;
                    height: 34px;
                }
            }
            /* --- シャッターチャンス: 終盤フィナーレ（コンタクトシート集約） --- */
            #shutter-contactsheet {
                position: absolute;
                inset: 0;
                z-index: 60;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.6s ease;
            }
            #shutter-contactsheet.cs-in { opacity: 1; }
            #shutter-contactsheet .cs-backdrop {
                position: absolute;
                inset: 0;
                background:
                    radial-gradient(ellipse at center, rgba(20, 9, 5, 0.55) 0%, rgba(4, 2, 1, 0.94) 78%);
                backdrop-filter: blur(3px);
            }
            #shutter-contactsheet .cs-sheet {
                position: relative;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                width: min(92vw, 880px);
                /* 最初から大きい固定サイズ。写真選択でヒーロー(拡大写真)が出ても外枠は変化させない
                   （中身は下のグリッドが flex で伸縮＆内部スクロールして吸収する）。 */
                height: min(90%, 680px);
                padding: 22px 20px 16px;
                background:
                    repeating-linear-gradient(90deg, rgba(255,210,120,0.5) 0 7px, transparent 7px 24px) top 7px left / 100% 9px no-repeat,
                    repeating-linear-gradient(90deg, rgba(255,210,120,0.5) 0 7px, transparent 7px 24px) bottom 7px left / 100% 9px no-repeat,
                    linear-gradient(160deg, #15100c 0%, #0c0806 100%);
                border: 1px solid rgba(216, 90, 48, 0.55);
                border-radius: 4px;
                box-shadow: 0 18px 60px rgba(0,0,0,0.7), 0 0 0 8px rgba(0,0,0,0.35);
                transform: scale(0.9) rotate(-0.6deg);
                opacity: 0;
                transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.6s ease;
                overflow: hidden;
            }
            #shutter-contactsheet.cs-in .cs-sheet { transform: scale(1) rotate(-0.6deg); opacity: 1; }
            .cs-header {
                display: flex;
                align-items: baseline;
                justify-content: center;
                gap: 12px;
                margin: 6px 0 14px;
            }
            .cs-title {
                font-family: monospace;
                font-size: clamp(18px, 3.6vw, 30px);
                font-weight: bold;
                letter-spacing: 6px;
                color: #FFEE11;
                text-shadow: 0 0 12px rgba(255, 238, 17, 0.6), 0 0 3px #000;
            }
            .cs-sub {
                font-family: monospace;
                font-size: clamp(9px, 1.6vw, 12px);
                letter-spacing: 3px;
                color: #D85A30;
                text-shadow: 0 0 8px #D85A30;
            }
            .cs-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                /* 固定サイズのシート内で余った縦スペースを埋める。min-height:0 は flex 子の内部スクロール許可に必須。 */
                flex: 1 1 auto;
                min-height: 0;
                align-content: start;
                /* 散開アニメ中はクリップ。整列後に JS が .cs-scroll を付けてスクロール可能化し、
                   写真が多くて入りきらなくても全部スクロールして選べるようにする（クリップで見切れない）。 */
                overflow: hidden;
                overscroll-behavior: contain;
            }
            .cs-grid.cs-scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
            .cs-grid.cs-scroll::-webkit-scrollbar { width: 7px; }
            .cs-grid.cs-scroll::-webkit-scrollbar-thumb { background: rgba(255,238,17,0.5); border-radius: 4px; }
            .cs-cell {
                position: relative;
                aspect-ratio: 1 / 1;
                border: 2px solid #f1ece3;
                background: #000;
                box-shadow: 0 2px 10px rgba(0,0,0,0.6);
                /* 散らばり初期位置（インラインで --sx/--sy/--srot を付与）→ settle で整列 */
                transform: translate(var(--sx, 0), var(--sy, 0)) rotate(var(--srot, 0deg)) scale(1.25);
                opacity: 0;
                transition: transform 0.85s cubic-bezier(0.18, 0.9, 0.28, 1), opacity 0.45s ease;
            }
            .cs-cell.cs-settled {
                transform: translate(0, 0) rotate(var(--tilt, 0deg)) scale(1);
                opacity: 1;
            }
            .cs-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .cs-frame-no {
                position: absolute;
                top: 2px;
                left: 3px;
                font-family: monospace;
                font-size: 9px;
                font-weight: bold;
                color: #FF9A3C;
                text-shadow: 0 0 3px #000, 0 0 6px rgba(255,154,60,0.7);
            }
            .cs-time {
                position: absolute;
                bottom: 1px;
                right: 3px;
                font-family: monospace;
                font-size: 8px;
                color: rgba(255,255,255,0.85);
                text-shadow: 0 0 3px #000;
            }
            /* どの写真もタップで選べる（カーソル/ホバーで分かるように）。金枠は“おすすめ”の目印。 */
            .cs-cell.cs-settled { cursor: pointer; }
            .cs-cell.cs-settled:hover { transform: translate(0,0) rotate(var(--tilt,0deg)) scale(1.05); }
            /* ベストショット候補（おすすめ・金色に脈動するリング） */
            .cs-cell.cs-candidate { border-color: #FFEE11; cursor: pointer; pointer-events: auto; }
            .cs-cell.cs-candidate:hover { transform: translate(0,0) rotate(var(--tilt,0deg)) scale(1.06); }
            .cs-cand-ring {
                position: absolute;
                inset: -6%;
                border: 3px solid #FFEE11;
                border-radius: 6px;
                box-shadow: 0 0 12px rgba(255, 238, 17, 0.85), inset 0 0 8px rgba(255, 238, 17, 0.5);
                pointer-events: none;
                animation: cs-cand-pulse 1.1s ease-in-out infinite;
            }
            @keyframes cs-cand-pulse {
                0%, 100% { opacity: 0.45; transform: scale(0.97); }
                50%      { opacity: 1;    transform: scale(1.02); }
            }
            /* 選定後: 選ばれなかった写真はモノクロに沈む */
            .cs-cell.cs-loser { filter: grayscale(1) brightness(0.42); transition: filter 0.5s ease; }
            /* 選択を促すプロンプト */
            .cs-prompt {
                position: relative; z-index: 7;
                min-height: 18px; margin: -4px 0 10px; text-align: center;
                font-family: monospace; font-size: clamp(11px, 1.9vw, 14px); letter-spacing: 1px;
                color: #FFEE11; text-shadow: 0 0 8px rgba(255,238,17,0.55), 0 0 2px #000;
            }
            .cs-header, .cs-footer { position: relative; z-index: 7; }
            /* スポットライトの暗幕 */
            .cs-veil {
                position: absolute; inset: 0; z-index: 5;
                background: radial-gradient(ellipse at center, rgba(4,2,1,0.50) 0%, rgba(2,1,0,0.86) 70%);
                opacity: 0; transition: opacity 0.45s ease; pointer-events: none;
            }
            .cs-veil.on { opacity: 1; }
            /* 主役化した決定的1枚 */
            .cs-hero {
                position: absolute; left: 50%; top: 48%; z-index: 6;
                width: min(64%, 460px); aspect-ratio: 1 / 1;
                transform: translate(-50%, -50%) scale(0.55) rotate(-4deg);
                opacity: 0; pointer-events: none;
                border: 4px solid #fff; border-radius: 3px;
                box-shadow: 0 0 0 3px #FFEE11, 0 0 34px 6px rgba(255,238,17,0.7), 0 16px 40px rgba(0,0,0,0.8);
                transition: transform 0.55s cubic-bezier(0.18, 1.3, 0.4, 1), opacity 0.35s ease;
                overflow: visible;
            }
            .cs-hero.on { transform: translate(-50%, -50%) scale(1) rotate(-2deg); opacity: 1; }
            .cs-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
            /* 「★ BEST SHOT」スタンプ（写真の左上角に斜めに押す。中央を潰さない） */
            .cs-stamp {
                position: absolute; left: -10px; top: 8px;
                transform-origin: center;
                transform: rotate(-15deg) scale(2.4);
                padding: 4px 10px;
                font-family: monospace; font-weight: bold; font-size: clamp(12px, 2vw, 17px);
                letter-spacing: 1.5px; white-space: nowrap;
                color: #ff3b30; border: 2.5px solid #ff3b30; border-radius: 4px;
                background: rgba(255,255,255,0.08);
                text-shadow: 0 0 6px rgba(255,59,48,0.6); box-shadow: 0 0 14px rgba(255,59,48,0.5);
                opacity: 0;
            }
            .cs-hero.on .cs-stamp { animation: cs-stamp-slam 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) 0.35s both; }
            @keyframes cs-stamp-slam {
                0%   { opacity: 0; transform: rotate(-15deg) scale(2.4); }
                70%  { opacity: 1; transform: rotate(-15deg) scale(0.92); }
                100% { opacity: 1; transform: rotate(-15deg) scale(1); }
            }
            /* 火花バースト */
            .cs-spark {
                position: absolute; left: 50%; top: 50%; width: 7px; height: 7px;
                margin: -3.5px 0 0 -3.5px; border-radius: 50%;
                background: #FFEE11; box-shadow: 0 0 8px 2px rgba(255,238,17,0.9);
                opacity: 0; pointer-events: none;
            }
            .cs-hero.on .cs-spark { animation: cs-spark-burst 0.6s ease-out 0.3s both; }
            @keyframes cs-spark-burst {
                0%   { opacity: 1; transform: translate(0, 0) scale(1); }
                100% { opacity: 0; transform: translate(var(--dx, 0), var(--dy, 0)) scale(0.3); }
            }
            /* 「次へ」ボタン */
            .cs-next {
                position: relative; z-index: 8;
                display: block; margin: 14px auto 2px; padding: 9px 26px;
                font-family: monospace; font-weight: bold; font-size: clamp(13px, 2vw, 16px);
                letter-spacing: 2px; cursor: pointer; pointer-events: auto;
                color: #fff; background: rgba(216,90,48,0.85);
                border: 1px solid #FF9A3C; border-radius: 6px;
                text-shadow: 0 0 6px rgba(0,0,0,0.6); box-shadow: 0 0 14px rgba(216,90,48,0.5);
                transition: transform 0.12s ease, background 0.12s ease;
            }
            .cs-next:hover { transform: translateY(-2px); background: rgba(216,90,48,1); }
            .cs-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-top: 14px;
                padding-top: 10px;
                border-top: 1px dashed rgba(216, 90, 48, 0.45);
                font-family: monospace;
            }
            .cs-stats {
                font-size: clamp(10px, 1.8vw, 13px);
                letter-spacing: 1px;
                color: #f3ede1;
            }
            .cs-stats b { color: #FFEE11; }
            .cs-sign {
                font-size: clamp(12px, 2.2vw, 16px);
                font-weight: bold;
                color: #D85A30;
                text-shadow: 0 0 8px rgba(216, 90, 48, 0.7);
            }
            .cs-empty {
                grid-column: 1 / -1;
                text-align: center;
                color: rgba(216, 90, 48, 0.9);
                font-family: monospace;
                font-size: 13px;
                letter-spacing: 2px;
                padding: 40px 10px;
            }
            /* かわいいポーズ・ボタンのバー（画面下中央） */
            #shutter-pose-bar {
                position: absolute; left: 50%; bottom: 70px; transform: translateX(-50%);
                display: flex; align-items: center; gap: 7px; z-index: 40;
                pointer-events: auto; padding: 6px 10px;
                background: rgba(8, 4, 3, 0.55); border: 1px solid rgba(185, 84, 60, 0.45);
                border-radius: 12px; backdrop-filter: blur(2px);
                max-width: 94%; overflow-x: auto; overflow-y: hidden;
                -webkit-overflow-scrolling: touch; scrollbar-width: none;
            }
            #shutter-pose-bar::-webkit-scrollbar { display: none; height: 0; }
            #shutter-pose-bar .pose-bar-label {
                font-family: monospace; font-size: 10px; letter-spacing: 2px; font-weight: bold;
                color: rgba(255, 210, 180, 0.8); margin-right: 2px; user-select: none;
                flex: 0 0 auto; position: sticky; left: 0;
                background: rgba(8, 4, 3, 0.85); padding-right: 4px;
            }
            .shutter-pose-btn {
                display: flex; flex-direction: column; align-items: center; gap: 1px;
                flex: 0 0 auto;
                min-width: 50px; padding: 5px 7px; cursor: pointer;
                background: rgba(0, 0, 0, 0.4); color: #fff;
                border: 1px solid rgba(216, 90, 48, 0.55); border-radius: 8px;
                transition: transform 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
            }
            .shutter-pose-btn .pose-emoji { font-size: 18px; line-height: 1; }
            .shutter-pose-btn .pose-label {
                font-family: 'Shippori Mincho', serif; font-size: 10px; letter-spacing: 1px;
                color: rgba(255, 230, 220, 0.92); white-space: nowrap;
            }
            .shutter-pose-btn:hover {
                transform: translateY(-2px); background: rgba(216, 90, 48, 0.35);
                box-shadow: 0 0 10px rgba(216, 90, 48, 0.4);
            }
            .shutter-pose-btn.active {
                background: rgba(216, 90, 48, 0.8); border-color: #FFEE11;
                box-shadow: 0 0 14px rgba(255, 238, 17, 0.6);
            }
            /* マイポーズ（自作）と「＋作る」ボタン */
            .shutter-pose-btn.is-user { position: relative; border-color: rgba(255, 238, 17, 0.55); }
            .shutter-pose-btn .pose-del {
                position: absolute; top: -6px; right: -6px; width: 16px; height: 16px;
                display: flex; align-items: center; justify-content: center;
                font-size: 12px; line-height: 1; color: #fff; background: rgba(180, 40, 30, 0.95);
                border: 1px solid #ffd; border-radius: 50%; cursor: pointer;
            }
            .shutter-pose-btn.shutter-pose-create {
                border-style: dashed; border-color: rgba(255, 238, 17, 0.7);
                background: rgba(255, 238, 17, 0.08);
            }
            .shutter-pose-btn.shutter-pose-create .pose-emoji { color: #FFEE11; font-weight: 700; }
            @container (max-width: 767px) {
                #shutter-contactsheet .cs-sheet { width: 92cqw; padding: 16px 12px 12px; }
                /* スマホは2列にして1枚を大きく（小さすぎ防止）。入りきらない分はスクロールで選ぶ。
                   高さは固定シート内で flex が伸縮させるので max-height は指定しない。 */
                .cs-grid { grid-template-columns: repeat(2, 1fr); gap: 9px; }
                .cs-title { letter-spacing: 4px; }
                #shutter-pose-bar { bottom: 58px; gap: 4px; padding: 5px 7px; }
                .shutter-pose-btn { min-width: 42px; padding: 4px 5px; }
                .shutter-pose-btn .pose-emoji { font-size: 16px; }
                .shutter-pose-btn .pose-label { font-size: 9px; }
            }
        `;
        document.head.appendChild(this.customStyleElement);
    }

    createViewfinderUI() {
        this.viewfinder = document.createElement('div');
        this.viewfinder.style.position = 'absolute';
        this.viewfinder.style.top = '0';
        this.viewfinder.style.left = '0';
        this.viewfinder.style.width = '100%';
        this.viewfinder.style.height = '100%';
        this.viewfinder.style.pointerEvents = 'none';
        this.viewfinder.style.zIndex = '30';
        this.viewfinder.style.boxSizing = 'border-box';
        
        // Target bracket styles
        const bracketStyle = `
            position: absolute;
            width: 50px;
            height: 50px;
            border: 4px solid ${this.themeColor};
            opacity: 0.7;
        `;
        
        // 液晶インジケーターのスタイル
        const indicatorContainerStyle = `
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            width: 130px;
            padding: 10px;
            background: rgba(17, 8, 5, 0.75);
            border: 1px solid rgba(185, 84, 60, 0.4);
            border-radius: 4px;
            font-family: 'Courier New', Courier, monospace;
            color: ${this.themeColor};
            font-size: 11px;
            box-sizing: border-box;
            backdrop-filter: blur(4px);
            transition: all 0.2s ease;
        `;
        
        this.viewfinder.innerHTML = `
            <!-- Brackets -->
            <div style="${bracketStyle}; top: 40px; left: 40px; border-right: none; border-bottom: none;"></div>
            <div style="${bracketStyle}; top: 40px; right: 40px; border-left: none; border-bottom: none;"></div>
            <div style="${bracketStyle}; bottom: 40px; left: 40px; border-right: none; border-top: none;"></div>
            <div style="${bracketStyle}; bottom: 40px; right: 40px; border-left: none; border-top: none;"></div>

            <!-- CAMERA SETTINGS (Zoom & Aperture) — 曲名/湖面へ戻るボタンの下へ(top:50px だと見出しに隠れて読めない) -->
            <div style="position: absolute; top: 118px; left: 44px; color: ${this.themeColor}; font-family: monospace; font-size: 11px; font-weight: bold; text-shadow: 0 0 5px ${this.themeColor}; transition: all 0.1s;" id="shutter-zoom-label">ZOOM 1.0x</div>
            <div style="position: absolute; top: 118px; right: 44px; color: ${this.themeColor}; font-family: monospace; font-size: 11px; font-weight: bold; text-shadow: 0 0 5px ${this.themeColor}; transition: all 0.1s;" id="shutter-aperture-label">F2.8 [OPEN]</div>

            <!-- 中央のAFフォーカスマーク(クロスヘア＋AUTO FOCUS表示)は廃止。
                 画面中央に貼り付くだけで実際のピント合わせには連動しておらず、
                 3Dのターゲットレティクル撤去に合わせてこの飾りも削除した。 -->

            <!-- MIKU CH-1 Indicator (Left) -->
            <div style="${indicatorContainerStyle}; left: 40px;" id="miku-indicator-container">
                <div style="font-weight: bold; margin-bottom: 5px; color: #39C5BB; text-shadow: 0 0 4px #39C5BB;" id="miku-vocal-label">MIKU CH-1</div>
                <div style="display: flex; gap: 2px;" id="miku-meter-blocks">
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(57, 197, 187, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                </div>
                <div style="font-size: 8px; margin-top: 5px; opacity: 0.8; color: #39C5BB;" id="miku-status-txt">STANDBY</div>
            </div>
            
            <!-- RIN CH-2 Indicator (Right) -->
            <div style="${indicatorContainerStyle}; right: 40px;" id="rin-indicator-container">
                <div style="font-weight: bold; margin-bottom: 5px; color: #FFEE11; text-shadow: 0 0 4px #FFEE11;" id="rin-vocal-label">RIN CH-2</div>
                <div style="display: flex; gap: 2px;" id="rin-meter-blocks">
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                    <span style="width: 14px; height: 12px; background: rgba(255, 238, 17, 0.15); border-radius: 1px; transition: background 0.1s;"></span>
                </div>
                <div style="font-size: 8px; margin-top: 5px; opacity: 0.8; color: #FFEE11;" id="rin-status-txt">STANDBY</div>
            </div>
            
            <!-- Alert Display -->
            <div id="shutter-alert-display" style="position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%); font-family: monospace; font-size: 14px; font-weight: bold; color: #ff3333; background: rgba(0,0,0,0.85); padding: 6px 16px; border: 1px solid #ff3333; border-radius: 3px; display: none; text-shadow: 0 0 5px #ff3333; letter-spacing: 2px; transition: all 0.1s;">ALERT: EXPOSURE</div>

            <!-- NOW! Lock Cue (AFロック圏内で「今撮ると高得点」を直感させる合図) -->
            <div id="shutter-now-cue" style="position: absolute; top: calc(50% - 64px); left: 50%; transform: translate(-50%, -50%) scale(0.6); font-family: 'Inter', monospace; font-size: 30px; font-weight: 900; color: #22FF66; opacity: 0; letter-spacing: 4px; text-shadow: 0 0 12px #22FF66, 0 0 26px #00ff88; pointer-events: none; transition: opacity 0.12s ease, transform 0.12s ease;">NOW!</div>

            <!-- Vertical Zoom Slider (Right Side)。+/- は実際に押せるトグルボタン。
                 スマホ・タブレット(coarse pointer)では指タップ域を大きく広げる(injectCustomStyles) -->
            <div style="position: absolute; right: 200px; top: 50%; transform: translateY(-50%); height: 250px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; pointer-events: auto; z-index: 35;" id="shutter-zoom-slider-container">
                <button type="button" id="shutter-zoom-in" class="shutter-zoom-btn" aria-label="ズームイン" style="color: ${this.themeColor}; font-family: monospace; font-size: 14px; font-weight: bold; text-shadow: 0 0 4px ${this.themeColor}; background: none; border: none; cursor: pointer; padding: 0; user-select: none; touch-action: manipulation;">[+]</button>
                <input type="range" id="shutter-zoom-slider" min="1.2" max="3.2" step="0.01" value="2.2" style="
                    -webkit-appearance: none;
                    appearance: none;
                    width: 6px;
                    height: 180px;
                    background: rgba(185, 84, 60, 0.2);
                    border: 1px solid rgba(185, 84, 60, 0.4);
                    outline: none;
                    border-radius: 3px;
                    cursor: pointer;
                    writing-mode: bt-lr;
                    -webkit-writing-mode: vertical-lr;
                    direction: rtl;
                ">
                <button type="button" id="shutter-zoom-out" class="shutter-zoom-btn" aria-label="ズームアウト" style="color: ${this.themeColor}; font-family: monospace; font-size: 14px; font-weight: bold; text-shadow: 0 0 4px ${this.themeColor}; background: none; border: none; cursor: pointer; padding: 0; user-select: none; touch-action: manipulation;">[-]</button>
            </div>

            <!-- かわいいポーズ・バー（中身は refreshPoseBar() が生成: プリセット＋マイポーズ＋「作る」） -->
            <div id="shutter-pose-bar"></div>
        `;

        this.songWrapper.appendChild(this.viewfinder);
    }
 
    buildLyricsCache() {
        if (!playerManager.isTimerReady || !playerManager.player || !playerManager.player.video || !playerManager.player.video.firstPhrase) {
            return false;
        }
        
        this.allWordGroups = [];
        this.lyricTexturesCache = new Map(); // text -> { texture, aspect }
        
        let phrase = playerManager.player.video.firstPhrase;
        let index = 0;
        let phraseIndex = 0;
        
        while (phrase) {
            // フレーズインデックスから、100%精密な歌い分けマッピングを取得
            const vocal = SHUTTER_VOCAL_MAP[phraseIndex] || 'miku';
            
            const groups = groupPhraseWords(phrase);
            groups.forEach(group => {
                this.allWordGroups.push({
                    index: index++,
                    text: group.text,
                    startTime: group.startTime,
                    endTime: group.endTime,
                    phraseEndTime: phrase.endTime,
                    phraseIndex: phraseIndex,
                    vocal: vocal // 精密アノテーション
                });
                
                // 歌詞単語のテクスチャを事前にレンダリングしてキャッシュに蓄積
                if (!this.lyricTexturesCache.has(group.text)) {
                    this.lyricTexturesCache.set(group.text, this.createTextTexture(group.text));
                }
            });
            phrase = phrase.next;
            phraseIndex++;
        }
        
        this.allWordGroups.sort((a, b) => a.startTime - b.startTime);
        this.lyricsCacheBuilt = true;
        return true;
    }

    createTextTexture(text) {
        const charCount = Math.max(1, text.length);
        const canvas = document.createElement('canvas');
        
        // 1文字あたり 90px + 左右余白 64px
        const canvasWidth = Math.min(1024, charCount * 90 + 64);
        canvas.width = canvasWidth;
        canvas.height = 128;
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 文字数が多い場合はフォントサイズをやや小さくして隣接被りを排除
        const fontSize = charCount > 6 ? 54 : 72;
        ctx.font = `bold ${fontSize}px "Inter", "Noto Sans JP", sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = this.themeColor;
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        
        return {
            texture: texture,
            aspect: canvas.width / 128
        };
    }

    spawnWordText(group, wordEndTime, startTime, groupIndex) {
        const text = group.text;
        let texData = this.lyricTexturesCache ? this.lyricTexturesCache.get(text) : null;
        if (!texData) {
            texData = this.createTextTexture(text);
            if (this.lyricTexturesCache) {
                this.lyricTexturesCache.set(text, texData);
            }
        }
        const { texture, aspect } = texData;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        
        // 中心（ターゲットスコープ）のZ深度位置を基準に初期配置
        const targetPos = this.targetScope ? this.targetScope.position : new THREE.Vector3(0, 0, -15);
        
        // 出現位置が重なって被るのを防ぐため、画面内の広い範囲から衝突しない安全な座標を探索
        let posX = targetPos.x;
        let posY = targetPos.y;
        let posZ = targetPos.z;
        
        let bestX = posX;
        let bestY = posY;
        let bestZ = posZ;
        let minOverlapScore = Infinity;
        
        const candidateScale = 2.25;
        const newWidth = candidateScale * aspect;
        const newHeight = candidateScale;
        
        for (let attempt = 0; attempt < 30; attempt++) {
            // 探索範囲内でランダムに座標候補を生成
            const testX = targetPos.x + (Math.random() - 0.5) * 12.5;
            const testY = targetPos.y + (Math.random() - 0.5) * 8.5;
            const testZ = targetPos.z - Math.random() * 1.5;
            
            let overlaps = false;
            let overlapScore = 0;
            
            for (const other of this.activeSprites) {
                // すでにフレームに収められて落下中のものは位置判定から除外
                if (other.userData.frameTarget) continue;
                
                const otherWidth = other.scale.x;
                const otherHeight = other.scale.y;
                
                const dx = Math.abs(testX - other.position.x);
                const dy = Math.abs(testY - other.position.y);
                
                // 横方向・縦方向の最小マージン（少しの重なりは許容するよう安全係数 0.45 = 90% で計算）
                const minXDist = (newWidth + otherWidth) * 0.45;
                const minYDist = (newHeight + otherHeight) * 0.45;
                
                if (dx < minXDist && dy < minYDist) {
                    overlaps = true;
                    // 不透明度で重みを付け、消えかかっている歌詞との重なりは許容度を上げる
                    const opacity = other.material ? other.material.opacity : 1;
                    overlapScore += (minXDist - dx) * (minYDist - dy) * opacity;
                }
            }
            
            if (!overlaps) {
                bestX = testX;
                bestY = testY;
                bestZ = testZ;
                break;
            } else {
                if (overlapScore < minOverlapScore) {
                    minOverlapScore = overlapScore;
                    bestX = testX;
                    bestY = testY;
                    bestZ = testZ;
                }
            }
        }
        
        posX = bestX;
        posY = bestY;
        posZ = bestZ;
        
        sprite.position.set(posX, posY, posZ);
        
        // 四方八方に散るための角度をランダムに決定 (0〜2PI)
        const angle = Math.random() * Math.PI * 2;
        
        // 散る速度を「ゆっくり」設定 (1秒間で 0.6 〜 1.6 単位程度)
        const speed = 0.6 + Math.random() * 1.0;
        
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        sprite.userData = {
            birthTime: startTime,
            deathTime: wordEndTime,
            text: text,
            baseScale: 2.0 + Math.random() * 0.5, // 飛び散るため少しだけコンパクトにして読みやすさとのバランスをとる
            aspect: aspect,
            groupIndex: groupIndex,
            vocal: group.vocal,
            dirX: dirX,
            dirY: dirY,
            scatterSpeed: speed,
            startPosition: new THREE.Vector3(posX, posY, posZ)
        };
        
        const scale = sprite.userData.baseScale;
        sprite.scale.set(scale * aspect, scale, 1);
        
        this.scene.add(sprite);
        this.activeSprites.push(sprite);
    }

    update(time) {
        if (!playerManager.player || !playerManager.player.video) return;

        // Use high-precision smoothed time to ensure ultra-smooth transitions
        const position = this.getSmoothedTime();
        this.lastPosition = position;

        // --- オープニングの掴み（曲頭の「構図が決まる」導入。zoom/scope/合焦一閃を駆動） ---
        this.updateOpening(position);

        // --- 夕暮れの湖面アニメ＋撮影波紋のライフサイクル（フラグoff時は即return） ---
        this.updateLakeSurface();

        // --- ズーム制御とイージング補間 ---
        this.zoomLevel += (this.targetZoom - this.zoomLevel) * 0.15;
        if (this.camera) {
            this.camera.fov = 75 / this.zoomLevel;
            this.camera.updateProjectionMatrix();
            
            // 回り込み: 被写体(orbitPivot)を中心にカメラをオービットさせ、常に被写体を画面中央に捉える。
            // ドラッグ角度を方位角(az)・仰角(el)として滑らかに反映する。
            this.cameraRotation.lerp(this.targetCameraRotation, 0.1);
            const az = this.cameraRotation.y;
            const el = this.cameraRotation.x;
            const P = this.orbitPivot, R = this.orbitRadius;
            const ce = Math.cos(el);
            this.camera.position.set(
                P.x + R * Math.sin(az) * ce,
                P.y + R * Math.sin(el),
                P.z + R * Math.cos(az) * ce
            );
            this.camera.up.set(0, 1, 0);
            this.camera.lookAt(P);
        }

        // スライダーのツマミを現在のズーム目標値に自動追随させる（双方向バインド）
        const slider = document.getElementById('shutter-zoom-slider');
        if (slider && document.activeElement !== slider) {
            slider.value = this.targetZoom.toFixed(2);
        }

        // --- ズーム ＆ 絞り液晶表示の更新 ---
        const zoomLabel = document.getElementById('shutter-zoom-label');
        const apertureLabel = document.getElementById('shutter-aperture-label');
        if (zoomLabel) {
            zoomLabel.innerText = `ZOOM ${this.zoomLevel.toFixed(1)}x`;
            // ズームしている時はカラーをイエロー系にして警告感を出す
            zoomLabel.style.color = this.zoomLevel > 2.2 ? '#FFEE11' : this.themeColor;
            zoomLabel.style.textShadow = this.zoomLevel > 2.2 ? '0 0 5px #FFEE11' : `0 0 5px ${this.themeColor}`;
        }
        if (apertureLabel) {
            // ズームするほどF値が開き（小さく）、引くほど絞られる（大きく）リアルな設定
            // ズーム範囲 1.2 〜 3.2 ➔ F値 8.0 〜 1.8
            const fVal = (8.0 - (this.zoomLevel - 1.2) * (6.2 / 2.0)).toFixed(1);
            const clampedF = Math.min(8.0, Math.max(1.4, parseFloat(fVal))).toFixed(1);
            let stateStr = 'NORMAL';
            if (clampedF <= 2.0) stateStr = 'OPEN';
            else if (clampedF >= 5.6) stateStr = 'SHARP';
            apertureLabel.innerText = `F${clampedF} [${stateStr}]`;
            apertureLabel.style.color = clampedF <= 2.0 ? '#39C5BB' : this.themeColor;
            apertureLabel.style.textShadow = clampedF <= 2.0 ? '0 0 5px #39C5BB' : `0 0 5px ${this.themeColor}`;
        }
        
        // Climax state detection based on smoothed playhead position
        const isPlaying = playerManager.player && playerManager.player.isPlaying;
        const chorus = (isPlaying && position > 1500 && typeof playerManager.player.findChorus === 'function') 
                       ? playerManager.player.findChorus(position) 
                       : null;
        this.isClimax = !!chorus;
        
        if (this.isClimax && !this.climaxTriggered) {
            this.climaxTriggered = true;
        } else if (!this.isClimax && this.climaxTriggered) {
            this.climaxTriggered = false;
        }

        // --- 液晶ライブメーターのアニメーション制御 ---
        // LEAD先読み: 実唱より僅かに先取りして判定し、サビ(duet)で遅れて見えないようにする。
        const lead = this.vocalLeadMs || 0;
        const leadPos = position + lead;
        const currentWord = isPlaying ? (playerManager.player.video.findWord(leadPos) || playerManager.player.video.findChar(leadPos)) : null;
        let activeVocal = 'none';

        if (currentWord) {
            const cached = this.allWordGroups.find(g => g.startTime - lead <= position && position <= g.endTime);
            if (cached) {
                activeVocal = this.isClimax ? 'duet' : cached.vocal;
            } else {
                activeVocal = this.isClimax ? 'duet' : 'miku'; // fallback
            }
        } else if (this.isClimax) {
            activeVocal = 'duet';
        }
        
        this.activeVocal = activeVocal; // 被写体ポーズの強調に使用
        this.animateVocalMeters(activeVocal, position);

        // 1. 動いている赤い背景ワイヤーフレームのアニメーション
        for (let i = 0; i < this.frames.length; i++) {
            const frame = this.frames[i];
            
            // 軌道の進行と位置の更新
            frame.userData.orbitAngle += frame.userData.orbitSpeed;
            this.updateFramePosition(frame);

            // 自転アニメーション
            frame.rotation.x += frame.userData.rotSpeed.x;
            frame.rotation.y += frame.userData.rotSpeed.y;
            frame.rotation.z += frame.userData.rotSpeed.z;

            // はめ込まれている写真があれば、位置と回転を完全に追従させ、さらにフェードアウト処理を行う
            if (frame.userData.hasPhoto && frame.userData.photoMesh) {
                frame.userData.photoMesh.position.copy(frame.position);
                frame.userData.photoMesh.quaternion.copy(frame.quaternion);

                // 古い写真のフェードアウト消去ライフサイクル
                if (frame.userData.isFadingOut) {
                    frame.userData.fadeOpacity -= 0.02; // 約1秒かけてフェードアウト
                    if (frame.userData.fadeOpacity <= 0) {
                        const photo = frame.userData.photoMesh;
                        this.scene.remove(photo);
                        if (photo.geometry) photo.geometry.dispose();
                        if (photo.material) {
                            if (photo.material.map) photo.material.map.dispose();
                            photo.material.dispose();
                        }
                        frame.userData.hasPhoto = false;
                        frame.userData.photoMesh = null;
                        frame.userData.photoImage = null;
                        frame.userData.isFadingOut = false;
                        frame.userData.fadeOpacity = 1.0;
                    } else {
                        frame.userData.photoMesh.material.opacity = frame.userData.fadeOpacity;
                    }
                } else {
                    frame.userData.photoMesh.material.opacity = 1.0;
                }
            }
        }

        // 2. 吸い込み移動・トランジション中の写真メッシュのアニメーション
        for (let i = this.transitioningPhotos.length - 1; i >= 0; i--) {
            const photo = this.transitioningPhotos[i];
            const data = photo.userData;

            // 最初のフレームがレンダリングされた瞬間に時間をリセットし、テクスチャ転送ラグを完璧に相殺！
            if (data.startTime === 0) {
                data.startTime = Date.now();
            }
            const elapsed = Date.now() - data.startTime;
            const holdDur = data.holdDuration || 0;
            const targetFrame = data.targetFrame;
            
            if (elapsed < holdDur) {
                // 【フェーズ1：目前でのホールド表示 (一瞬大きく表示する提示機能)】
                // 回り込み中もカメラ前方3に出すため、視線方向に沿って配置する。
                photo.position.copy(this.camera.position)
                    .add(this.camera.getWorldDirection(this._scratchVec).multiplyScalar(3));
                photo.quaternion.copy(this.camera.quaternion);
                
                // 出現時のわずかなズームアップ演出 (0.8から1.2倍へ) ＆ ズームレベルに反比例させて一定の見かけサイズに保つ
                const zoomProgress = Math.min(1.0, elapsed / 300);
                const currentScale = (0.8 + 0.4 * zoomProgress) / this.zoomLevel;
                photo.scale.set(currentScale, currentScale, currentScale);
                
                data.startPos.copy(photo.position);
                data.startRot.copy(photo.quaternion);
                continue;
            }
            
            // 【フェーズ2：赤い枠（targetFrame）への吸い込み】
            const travelTime = elapsed - holdDur;
            const progress = Math.min(1.0, travelTime / data.duration);
            const t = progress * progress * (3 - 2 * progress);
            
            if (progress < 1.0 && targetFrame && !targetFrame.userData.dropSpeed) {
                photo.position.lerpVectors(data.startPos, targetFrame.position, t);
                photo.quaternion.slerpQuaternions(data.startRot, targetFrame.quaternion, t);
                
                // 開始時の一定見かけスケール (1.2 / zoomLevel) から、最終的な本来の枠のスケール (1.0) へ滑らかに遷移させる
                const startScale = 1.2 / this.zoomLevel;
                const endScale = 1.0;
                const scaleT = startScale + (endScale - startScale) * t;
                photo.scale.set(scaleT, scaleT, scaleT);
            } else {
                this.transitioningPhotos.splice(i, 1);
                
                if (targetFrame && !targetFrame.userData.dropSpeed) {
                    // シーンから削除せず、直接シーン直下でtargetFrameに追従させる
                    photo.position.copy(targetFrame.position);
                    photo.quaternion.copy(targetFrame.quaternion);
                    photo.scale.set(1, 1, 1);
                    // 21枚目以降は最古(フェード中)の枠を再利用する。旧写真を確実に破棄し、
                    // フェード完了処理が新しい写真を消さないよう hasPhoto を立て直す。
                    const oldPhoto = targetFrame.userData.photoMesh;
                    if (oldPhoto && oldPhoto !== photo) {
                        this.scene.remove(oldPhoto);
                        if (oldPhoto.geometry) oldPhoto.geometry.dispose();
                        if (oldPhoto.material) {
                            if (oldPhoto.material.map) oldPhoto.material.map.dispose();
                            oldPhoto.material.dispose();
                        }
                    }
                    targetFrame.userData.hasPhoto = true;
                    targetFrame.userData.photoMesh = photo;
                    targetFrame.userData.photoSpawnTime = Date.now(); // 写真登録時刻を記録
                    targetFrame.userData.fadeOpacity = 1.0;
                    targetFrame.userData.isFadingOut = false;
                } else {
                    this.scene.remove(photo);
                    if (photo.geometry) photo.geometry.dispose();
                    if (photo.material) {
                        if (photo.material.map) photo.material.map.dispose();
                        photo.material.dispose();
                    }
                }
            }
        }

        // 3. DETERMINISTIC lyric sprite spawning and deletion
        if (!this.lyricsCacheBuilt) {
            this.buildLyricsCache();
        }

        // 表示中ワードグループを単一パスで構築（再利用バッファでGC負荷を回避）。
        // 「画面表示の可視ウィンドウ判定(startTime-600〜endTime+2500)」と「テキスト重複排除（先勝ち）」を
        // allWordGroupsの並び順を維持したまま一度に行い、従来の2回の.filter()と同一の集合・順序を得る。
        const activeGroups = this._activeGroupsScratch;
        activeGroups.length = 0;
        const seenText = this._seenTextScratch;
        seenText.clear();
        for (let gi = 0; gi < this.allWordGroups.length; gi++) {
            const g = this.allWordGroups[gi];
            if (position >= g.startTime - 600 && position <= g.endTime + 2500) {
                if (!seenText.has(g.text)) {
                    seenText.add(g.text);
                    activeGroups.push(g);
                }
            }
        }

        // First, remove out-of-bounds sprites immediately to keep the scene pristine and free grid cells
        for (let i = this.activeSprites.length - 1; i >= 0; i--) {
            const s = this.activeSprites[i];
            const groupIndex = s.userData.groupIndex;
            
            // Check if this sprite is still in the active groups list
            const isStillActive = activeGroups.some(g => g.index === groupIndex);
            
            if (!isStillActive) {
                if (s.userData.cellIdx !== undefined) {
                    this.occupiedCells.delete(s.userData.cellIdx);
                }
                this.scene.remove(s);
                s.material.dispose();
                this.activeSprites.splice(i, 1);
            }
        }

        // Build a map of currently active sprites keyed by their group index
        const currentSpritesMap = new Map();
        this.activeSprites.forEach(s => {
            if (s.userData && typeof s.userData.groupIndex === 'number') {
                currentSpritesMap.set(s.userData.groupIndex, s);
            }
        });

        // Spawn missing active sprites
        activeGroups.forEach(g => {
            if (!currentSpritesMap.has(g.index)) {
                this.spawnWordText(g, g.endTime, g.startTime, g.index);
            }
        });

        // Animate remaining active sprites
        for (let i = 0; i < this.activeSprites.length; i++) {
            const s = this.activeSprites[i];

            // Opacity management (birthTime is startTime, deathTime is endTime)
            const birthTime = s.userData.birthTime;
            const deathTime = s.userData.deathTime;

            // 歌詞をターゲット（中心）から四方八方にゆっくりと散らせる
            const elapsedSeconds = Math.max(0, (position - birthTime) / 1000);
            
            if (s.userData.startPosition && s.userData.dirX !== undefined) {
                const startPos = s.userData.startPosition;
                const dirX = s.userData.dirX;
                const dirY = s.userData.dirY;
                const speed = s.userData.scatterSpeed;
                const P = this.orbitPivot;

                // 散布レイアウトはピボット基準の「局所オフセット」として扱う(スコープ周りの広がり)。
                const lx = (startPos.x - P.x) + dirX * speed * elapsedSeconds;
                const ly = (startPos.y - P.y) + dirY * speed * elapsedSeconds;
                // キャラクターの奥（-Z方向）に配置し、さらに奥へと流れていくように変更
                const lz = (startPos.z - P.z) - 4.5 - elapsedSeconds * 0.2;

                // カメラの回り込みに合わせて局所オフセットを回転 → 歌詞は常にカメラ正面に居続ける。
                // スプライトなので向きは自動でカメラ正面(ビルボード)。world座標のままなので写真描画も正しい。
                this._lyricScratch.set(lx, ly, lz).applyQuaternion(this.camera.quaternion);
                s.position.set(P.x + this._lyricScratch.x, P.y + this._lyricScratch.y, P.z + this._lyricScratch.z);
            }
            
            const fadeStart = birthTime - 600;
            const fadeEnd = birthTime - 450;
            
            if (position < fadeStart) {
                s.material.opacity = 0;
            } else if (position < fadeEnd) {
                s.material.opacity = (position - fadeStart) / (fadeEnd - fadeStart);
            } else if (position > deathTime + 2000) {
                // Keep fully visible for 2000ms after singing, then fade out smoothly over 500ms (total 2500ms)
                const fadeOutStart = deathTime + 2000;
                const fadeProgress = (position - fadeOutStart) / 500;
                s.material.opacity = Math.max(0, 1 - fadeProgress);
            } else {
                s.material.opacity = 1;
            }

            // Vocal singing pulse (bounce & color transition based on singer)
            // 先読み補正で「今まさに歌っている単語」を僅かに先取りハイライト。
            const wLead = this.vocalLeadMs || 0;
            const isWordActive = (position + wLead) >= birthTime - 450 && (position + wLead) <= deathTime - 450;
            if (!s.userData.pulseProgress) s.userData.pulseProgress = 0;
            const targetPulse = isWordActive ? 1.0 : 0.0;
            s.userData.pulseProgress += (targetPulse - s.userData.pulseProgress) * 0.2;
            const pulse = s.userData.pulseProgress;
            const pulseScaleFactor = 1.0 + pulse * 0.25; // 1.25x bounce

            const baseScale = s.userData.baseScale || 3.0;
            const aspect = s.userData.aspect || 1.0;
            s.scale.set(baseScale * aspect * pulseScaleFactor, baseScale * pulseScaleFactor, 1);

            // 歌い手に応じた発光色（パート色に統一: ミク=シアン / リン=イエロー / サビduet=サンセット）。
            // 非歌唱中は白(=可読性)、歌唱中はパート色へ寄せて「誰が歌っているか」を一目で示す。
            const vocal = this.isClimax ? 'duet' : (s.userData.vocal || 'miku');
            const partCol = this.VOCAL_COLORS[vocal] || this.VOCAL_COLORS.miku;
            const tint = pulse * (this.isClimax ? 0.95 : 0.8); // サビは更に色を強く乗せる
            s.material.color.setRGB(
                1.0 - (1.0 - partCol.r) * tint,
                1.0 - (1.0 - partCol.g) * tint,
                1.0 - (1.0 - partCol.b) * tint
            );
        }

        // --- AFロック判定（「今だ！」合図用）: 歌詞ワードがスコープに吸着しているか毎フレーム評価 ---
        let lockHot = false;
        if (this.targetScope) {
            for (let i = 0; i < this.activeSprites.length; i++) {
                const sprite = this.activeSprites[i];
                if (sprite.userData.frameTarget) continue;
                const offset = sprite.userData.targetOffset;
                const ox = offset ? offset.x : 0;
                const oy = offset ? offset.y : 0;
                const dx = sprite.position.x - (this.targetScope.position.x + ox);
                const dy = sprite.position.y - (this.targetScope.position.y + oy);
                // takePhoto と同じ判定基準(距離1.5・不透明0.5超)に合わせる
                if (dx * dx + dy * dy <= 1.5 * 1.5 && sprite.material && sprite.material.opacity > 0.5) {
                    lockHot = true;
                    break;
                }
            }
        }
        this._lockReady += ((lockHot ? 1 : 0) - this._lockReady) * 0.25;

        // ターゲットスコープのパルス脈動（Beatシンクロ） ＆ 回転 ＆ パート色/ロック合図
        if (this.targetScope) {
            const beat = playerManager.player ? playerManager.player.findBeat(position) : null;
            let pulseScale = 1.0;
            if (beat) {
                const beatElapsed = position - beat.startTime;
                const beatProgress = Math.min(1.0, beatElapsed / beat.duration);
                pulseScale = 1.0 + 0.25 * Math.exp(-beatProgress * 4.0); // 拍の頭でパッと広がり、指数減衰で縮む
            }
            // ロック圏内は更にキュッと締まる(寄って合焦している感)
            pulseScale *= 1.0 - this._lockReady * 0.12;
            this.targetScope.scale.set(pulseScale, pulseScale, 1.0);

            // ターゲットサークル自体をゆっくり回転させてSFチックにする(ロック時は加速して喰い付き感)
            this.targetScope.rotation.z += 0.01 + this._lockReady * 0.05;

            // スコープ色: 通常はパート色(待機状態)、ロック圏内では赤系→緑へ切替えて「今だ！」を強調。
            // ベース色 = 待機時のパート色 / ロック色 = グリーン(GO!)
            const baseCol = activeVocal !== 'none'
                ? (this.VOCAL_COLORS[activeVocal] || this.VOCAL_COLORS.miku)
                : this.VOCAL_COLORS.rin; // 待機時はリンイエロー(元実装色)
            const lockCol = this._lockGreenScratch || (this._lockGreenScratch = new THREE.Color('#22FF66'));
            const r = this._lockReady;
            this.targetScope.material.color.setRGB(
                baseCol.r + (lockCol.r - baseCol.r) * r,
                baseCol.g + (lockCol.g - baseCol.g) * r,
                baseCol.b + (lockCol.b - baseCol.b) * r
            );
            // ロック圏内は明滅で目立たせる(発見性)
            this.targetScope.material.opacity = 0.8 + this._lockReady * (0.15 + 0.05 * Math.sin(position * 0.02));
        }

        // 「NOW!」合図ラベルの表示制御（ロック圏内に入った瞬間に出す）
        this.updateNowCue();

        // --- 被写体VRM（ミク&リン）のポーズ切替＆アイドルアニメーション ---
        if (this.subjects.length > 0) {
            const nowReal = performance.now();
            if (this.lastVrmRealTime === undefined) this.lastVrmRealTime = nowReal;
            const deltaTime = Math.min(0.05, (nowReal - this.lastVrmRealTime) / 1000);
            this.lastVrmRealTime = nowReal;

            // フレーズ切替でポーズチェンジ
            const currentPhrase = playerManager.player.video.findPhrase(position);
            let poseChanged = false;
            if (currentPhrase && currentPhrase.startTime !== this.lastPhraseStartTime) {
                this.lastPhraseStartTime = currentPhrase.startTime;
                poseChanged = true;
            }

            // ビート4拍ごとにもポーズチェンジ（間奏などフレーズが無い区間用）
            const poseBeat = playerManager.player ? playerManager.player.findBeat(position) : null;
            if (poseBeat && poseBeat.startTime !== this.lastPoseBeatStart) {
                this.lastPoseBeatStart = poseBeat.startTime;
                this.poseBeatCounter++;
                if (!currentPhrase && this.poseBeatCounter % 4 === 0) {
                    poseChanged = true;
                }
            }

            // --- ビート同期グルーヴの状態更新（こたえてのビート検出を踏襲） ---
            const floatT = position / 1000;
            let beatPulse = 0;
            if (poseBeat && poseBeat.duration > 0) {
                const p = Math.min(1, Math.max(0, (position - poseBeat.startTime) / poseBeat.duration));
                beatPulse = Math.pow(1 - p, 2.2);  // 拍頭で跳ねて減衰
                if (poseBeat.index !== this._beatIndex) {
                    this._beatIndex = poseBeat.index;
                    this._beatStep = -this._beatStep;                       // 体重移動の向きを反転
                    if ((poseBeat.position || 1) === 1) this._barAccent = 1; // 小節頭でアクセント発火
                }
            }
            // 拍頭で素早く立ち上がるグルーヴパルス（キレ＋余韻）
            {
                const atk = beatPulse > this._groove ? deltaTime * 45 : deltaTime * 9;
                this._groove += (beatPulse - this._groove) * Math.min(1, atk);
            }

            // VRM内部更新（スプリングボーン等）。モバイルは約30fpsに間引いて負荷削減
            let runVrmUpdate = true;
            let vrmStep = deltaTime;
            if (this.isMobile) {
                this.vrmUpdateAccum += deltaTime;
                if (this.vrmUpdateAccum >= 1 / 30) {
                    vrmStep = this.vrmUpdateAccum;
                    this.vrmUpdateAccum = 0;
                } else {
                    runVrmUpdate = false;
                }
            }

            // --- 表示する被写体は曲開始前に選んだ1体で固定（曲中の切替はしない） ---
            if (this.selectedKey) this.shownKey = this.selectedKey;
            this.subjects.forEach(s => { s.mesh.visible = (s.key === this.shownKey); });

            // 表示中の被写体（トランジション中は両方）をアニメーション
            const animateList = this.subjects.filter(s => s.mesh.visible);
            // 「かわいいポーズ」ホールド中か判定（ホールド中はグルーヴ抑制＆移動も抑える）
            const posing = !!(this.poseOverride && performance.now() < this.poseOverride.until);
            if (this.poseOverride && !posing) this.poseOverride = null;
            this._poseHoldAmt += ((posing ? 1 : 0) - this._poseHoldAmt) * Math.min(1, deltaTime * 5);
            animateList.forEach((subject) => {
                const isShown = subject.key === this.shownKey;

                // ポーズ編集中: エディタが被写体を中央へ据えて editPose をライブ反映する。
                // グルーヴ・うろつき・サビ発光は止め、形を確認しやすくする。
                if (this.poseEditing && this.poseEditor) {
                    this.poseEditor.applyToSubject(subject, deltaTime);
                    return;
                }

                // 腕の型: ポーズ・ホールド中は指定ポーズ最優先。通常はプリセットの armStyle を基調に
                // （穏やか系はサビで cheer へ切替えて盛り上げる）
                if (posing) {
                    const ov = this.poseOverride;
                    if (ov.resetUntil && performance.now() < ov.resetUntil) {
                        // リセット相: ボタン非押下時のアイドル姿勢へ戻し、前ポーズの残留ボーンを解消する。
                        // 全ボーン網羅のひな型に現在のアイドルジェスチャ(腕/頭/胴)を重ねた姿勢へ寄せ、
                        // gesture/groove 管理外のボーン(肩・手首・首・足首・脚)は relaxIdleBones で中立へ。
                        // → リセット先は T ポーズではなく「ポーズを押していないときの立ち姿」。
                        // 注: ここで clampArmsWorld は呼ばない。リセット先(腕を下ろした立ち姿)は
                        //     体貫通しないので不要なうえ、毎フレームの lerp 引き寄せ⇔クランプ押し戻しの
                        //     綱引きで腕がプルプル振動する原因になる(待機分岐もクランプせず滑らか)。
                        this.lerpSubjectPose(subject, { ...SHUTTER_BONES_ZERO, ...this.idleGesture() }, 0.35);
                        this.relaxIdleBones(subject, 0.35);
                    } else {
                        // リセット相を抜けたら、ここから実ポーズの「入り」を開始する。
                        if (ov.resetUntil) { ov.resetUntil = 0; ov.startedAt = performance.now(); ov.settled = false; }
                        // 目標は「全身ぶんの完全なポーズ」(基準姿勢へ当該ポーズを重ねたもの)。
                        // 未定義ボーンも基準へ寄せるので、前ポーズ/待機の残りに依らず形が一定になる。
                        const target = ov.fullPose || (ov.fullPose = this.buildFullPose(ov.pose));
                        const elapsed = performance.now() - (ov.startedAt || 0);
                        if (elapsed < 320) {
                            // 入り: クォータニオンslerpで最短弧を滑らかに。大回転(ジャンプの上腕等)でも
                            // 腕がねじれた角度を通らない。swing中はクランプしない＝楕円を横切る瞬間の
                            // 押し出しが累積して最終的な腕角度を狂わせるのを防ぐ。
                            this.slerpSubjectPose(subject, target, 0.28);
                        } else if (!ov.settled) {
                            // 入り完了: 目標へスナップ→一度だけ貫通クランプ(エディタのプレビューと一致)
                            // →以後は凍結＝かっちり静止。クランプを毎フレーム続けないので振動も出ない。
                            this.slerpSubjectPose(subject, target, 1);
                            this.clampArmsWorld(subject);
                            ov.settled = true;
                        }
                        // settled後: 何もしない＝補正済みポーズで固定（振動なし）
                    }
                } else {
                    const gesture = this.idleGesture();
                    // 腕の型へ補間 → 待機が扱わないボーンを中立へ戻す → その上にビートグルーヴ
                    this.lerpSubjectPose(subject, gesture, 0.08);
                    // キメポーズ(お願い等)が動かした「gesture/groove 管理外」のボーン
                    // (肩のx/y・手首・首・足首・脚のy)を待機姿勢へ戻す。これが無いと
                    // ポーズ解除後にそれらが残って待機モーションが破綻する。
                    this.relaxIdleBones(subject, 0.18);
                    if (isShown) this.applySubjectGroove(subject, floatT, deltaTime, beatPulse);
                }

                // ポーズ指定の表情モーフ（ウィンク等）。expr は文字列 or {モーフ名:重み}。
                // ウィンク等は片目だけ閉じるので、両目を閉じる自動笑顔(笑い)は表情指定中は抑制する。
                const dict = subject.mesh.morphTargetDictionary;
                const infl = subject.mesh.morphTargetInfluences;
                const rawExpr = (posing && this.poseOverride.pose && this.poseOverride.pose.expr) ? this.poseOverride.pose.expr : null;
                const exprObj = !rawExpr ? null : (typeof rawExpr === 'string' ? { [rawExpr]: 1 } : rawExpr);
                // にっこり笑顔（happy表情）のエンベロープ。ビート同期撮影で smileTimer がセットされる
                if (subject.smileTimer > 0) subject.smileTimer -= deltaTime * 1000;
                const smileTarget = (subject.smileTimer > 0 && !exprObj) ? 1 : 0;
                subject.smile += (smileTarget - subject.smile) * 0.25;
                if (dict) {
                    const morphIndex = dict['笑い'] || dict['にっこり'] || dict['E_Happy'];
                    if (morphIndex !== undefined) infl[morphIndex] = subject.smile;
                    // 表情の切替/解除: 前回適用したモーフを0へ戻す
                    const exprKey = exprObj ? JSON.stringify(exprObj) : null;
                    if (subject.poseExprApplied && subject.poseExprName !== exprKey) {
                        Object.keys(subject.poseExprApplied).forEach(n => { const i = dict[n]; if (i !== undefined) infl[i] = 0; });
                        subject.poseExpr = 0; subject.poseExprApplied = null; subject.poseExprName = null;
                    }
                    if (exprObj) {
                        subject.poseExprName = exprKey; subject.poseExprApplied = exprObj;
                        subject.poseExpr += (1 - subject.poseExpr) * 0.25;
                        Object.entries(exprObj).forEach(([n, w]) => { const i = dict[n]; if (i !== undefined) infl[i] = w * subject.poseExpr; });
                    }
                }

                // サビでも被写体は発光させない（ユーザー要望で撤去）。常に素のマテリアルを保つ。
                // ※万一以前のフレームで発光状態が残っていたら一度だけ元へ戻す（保険）。
                if (isShown && subject._wasGlowing) {
                    this.restoreSubjectMaterials(subject);
                    subject._wasGlowing = false;
                }

                // ステージ内を動き回る（撮影者が追って構図を作れるよう画面内を移動）。
                // ※以前は「ポーズ中はwanderを縮小」→ 中心へ寄る動きが出て、ポーズを切り替えるたびに
                //   被写体がスッとズレて見えていた(#1)。代わりにポーズ開始時のオフセットを凍結し、
                //   ホールド度に応じて現在位置をその場へ blend する＝“動かさず構えさせる”。
                const rawSx = Math.sin(floatT * 0.55) * 3.8 + Math.sin(floatT * 0.27 + 1.3) * 1.8; // 横移動 ~±5.6
                const rawSz = Math.sin(floatT * 0.37) * 2.4 + Math.sin(floatT * 0.19) * 1.1;        // 前後移動 ~±3.5
                if (posing) {
                    if (this._holdSx === null) { this._holdSx = rawSx; this._holdSz = rawSz; } // 入った瞬間の位置で固定
                } else {
                    this._holdSx = null; this._holdSz = null;
                }
                const hold = this._poseHoldAmt;
                const sx = (this._holdSx !== null) ? rawSx + (this._holdSx - rawSx) * hold : rawSx;
                const sz = (this._holdSz !== null) ? rawSz + (this._holdSz - rawSz) * hold : rawSz;
                const px = subject.baseX + sx;
                const pz = this.mikuBaseZ + sz;
                subject.mesh.position.x = px;
                // 浮遊bob ＋ 拍頭で腰を落とす沈み込み（膝バウンス連動）＋ 小節頭の軽いホップ
                subject.mesh.position.y = this.mikuBaseY + Math.sin(floatT * 1.8) * 0.05
                    - beatPulse * this.grooveConfig.hipDrop * (this.isClimax ? 1.4 : 1.0)
                    + this._barAccent * this.grooveConfig.hop * (this.isClimax ? 1.4 : 0.6);
                subject.mesh.position.z = pz;
                // 常にカメラ（撮影者）の方へ正面を向ける（既定カメラでは π=正面。回り込んでも正面を維持）
                subject.mesh.rotation.y =
                    Math.atan2(this.camera.position.x - px, this.camera.position.z - pz);
                subject.mesh.rotation.z = Math.sin(floatT * 0.7) * 0.012;

                // 被写体ライトを追従させ、移動中も立体的に照らす
                if (this.keyLight) this.keyLight.target.position.set(px, this.mikuBaseY + 1.2, pz);
                if (this.rimLight) this.rimLight.target.position.set(px, this.mikuBaseY + 1.2, pz);
            });
        }

        // フィルムストリップ（コンタクトシート＝写真選択）は曲が自然終了してから出す。
        // かつては曲終了12秒前に割り込み表示していたが「楽曲が終わる前に写真選択が出る」ため、
        // songEnd（自然終了）後の runEndInterlude() に移した。ここでは早出しトリガを持たない。
    }

    // オープニングの掴み: 曲頭3秒で「カメラを構える→AFが寄って合焦→合焦一閃→被写体キメ」流れを作る。
    // position(再生ヘッド)で駆動するので、シーク/一時停止にも自然に追従する。
    updateOpening(position) {
        if (this.openingDone) {
            // 終了後も合焦一閃の残りを減衰させる
            if (this.openingFocusFlash > 0) {
                this.openingFocusFlash *= 0.85;
                if (this.openingFocusFlash < 0.01) this.openingFocusFlash = 0;
            }
            return;
        }
        // 再生前(=ヘッドが進んでいない)は構え状態。少し引いた画角で待機。
        if (position <= 0) {
            this.targetZoom = 1.6;
            return;
        }
        const t = Math.min(1, position / this.OPENING_DURATION); // 0..1

        // フェーズA(0〜55%): AFが寄って合焦。引き(1.6)→寄り(2.4)へズームイン。
        // フェーズB(合焦の瞬間=55%付近): 合焦一閃＆被写体キメ。
        // フェーズC(55〜100%): 規定ズーム(2.2)へ落ち着き、被写体がキメ顔/ポーズ。
        const focusPoint = 0.55;
        if (t < focusPoint) {
            const a = t / focusPoint;
            const eased = a * a * (3 - 2 * a); // smoothstep
            this.targetZoom = 1.6 + (2.4 - 1.6) * eased;
        } else {
            const b = (t - focusPoint) / (1 - focusPoint);
            const eased = b * b * (3 - 2 * b);
            this.targetZoom = 2.4 + (2.2 - 2.4) * eased;
            // 合焦の瞬間に一度だけ 合焦一閃＆被写体キメ顔（録画ではないので[REC]表示は出さない）
            if (!this._recIgnited) {
                this._recIgnited = true;
                this.openingFocusFlash = 1.0;
                // 被写体が一瞬キメ顔＋キメポーズ(peace)
                const shown = this.subjects && this.subjects.find(s => s.key === this.shownKey);
                if (shown) shown.smileTimer = 1200;
                this.armStyle = 'peace';
                try { sfx.play('shutter_click'); } catch (e) { /* SE未定義でも無害 */ }
            }
        }

        // 合焦一閃の減衰
        if (this.openingFocusFlash > 0) {
            this.openingFocusFlash *= 0.9;
            if (this.openingFocusFlash < 0.01) this.openingFocusFlash = 0;
        }

        if (t >= 1) {
            this.openingDone = true;
            // 既定ダンス(armStyle)へ戻して通常更新へ。
            const preset = SHUTTER_DANCE_PRESETS.find(p => p.name === this.dancePresetName);
            this.armStyle = (preset && preset.armStyle) || 'cheer';
        }
    }

    // AFロック圏内で「NOW!」合図を出し、撮ると高得点であることを直感させる。
    updateNowCue() {
        const cue = document.getElementById('shutter-now-cue');
        if (!cue) return;
        const r = this._lockReady;
        if (r > 0.4) {
            // ロック度に応じて出現＆軽く鼓動
            const beat = 1.0 + 0.12 * Math.sin(this.lastPosition * 0.02);
            cue.style.opacity = Math.min(1, (r - 0.4) / 0.4).toFixed(2);
            cue.style.transform = `translate(-50%, -50%) scale(${(0.8 + 0.4 * r * beat).toFixed(3)})`;
        } else {
            cue.style.opacity = '0';
            cue.style.transform = 'translate(-50%, -50%) scale(0.6)';
        }
    }

    animateVocalMeters(activeVocal, position) {
        const mikuContainer = document.getElementById('miku-indicator-container');
        const rinContainer = document.getElementById('rin-indicator-container');

        if (!mikuContainer || !rinContainer) return;

        let mikuIntensity = 0;
        let rinIntensity = 0;
        
        if (activeVocal === 'miku') {
            mikuIntensity = 2 + Math.floor(Math.sin(position * 0.05) * 2) + Math.floor(Math.random() * 2);
            mikuIntensity = Math.max(1, Math.min(5, mikuIntensity));
            
            document.getElementById('miku-status-txt').innerText = 'VOCAL_ACTIVE';
            document.getElementById('rin-status-txt').innerText = 'STANDBY';
            mikuContainer.style.borderColor = 'rgba(57, 197, 187, 0.7)';
            mikuContainer.style.boxShadow = '0 0 10px rgba(57, 197, 187, 0.25)';
            rinContainer.style.borderColor = 'rgba(185, 84, 60, 0.2)';
            rinContainer.style.boxShadow = 'none';
        } else if (activeVocal === 'rin') {
            rinIntensity = 2 + Math.floor(Math.sin(position * 0.05) * 2) + Math.floor(Math.random() * 2);
            rinIntensity = Math.max(1, Math.min(5, rinIntensity));
            
            document.getElementById('miku-status-txt').innerText = 'STANDBY';
            document.getElementById('rin-status-txt').innerText = 'VOCAL_ACTIVE';
            rinContainer.style.borderColor = 'rgba(255, 238, 17, 0.7)';
            rinContainer.style.boxShadow = '0 0 10px rgba(255, 238, 17, 0.25)';
            mikuContainer.style.borderColor = 'rgba(185, 84, 60, 0.2)';
            mikuContainer.style.boxShadow = 'none';
        } else if (activeVocal === 'duet') {
            mikuIntensity = 3 + Math.floor(Math.sin(position * 0.08) * 2) + Math.floor(Math.random() * 2);
            mikuIntensity = Math.max(2, Math.min(5, mikuIntensity));
            
            rinIntensity = 3 + Math.floor(Math.cos(position * 0.08) * 2) + Math.floor(Math.random() * 2);
            rinIntensity = Math.max(2, Math.min(5, rinIntensity));
            
            document.getElementById('miku-status-txt').innerText = 'DUET_MAX';
            document.getElementById('rin-status-txt').innerText = 'DUET_MAX';
            
            mikuContainer.style.borderColor = 'rgba(57, 197, 187, 0.8)';
            mikuContainer.style.boxShadow = '0 0 12px rgba(57, 197, 187, 0.35)';
            rinContainer.style.borderColor = 'rgba(255, 238, 17, 0.8)';
            rinContainer.style.boxShadow = '0 0 12px rgba(255, 238, 17, 0.35)';
        } else {
            document.getElementById('miku-status-txt').innerText = 'STANDBY';
            document.getElementById('rin-status-txt').innerText = 'STANDBY';
            mikuContainer.style.borderColor = 'rgba(185, 84, 60, 0.2)';
            mikuContainer.style.boxShadow = 'none';
            rinContainer.style.borderColor = 'rgba(185, 84, 60, 0.2)';
            rinContainer.style.boxShadow = 'none';
        }
        
        // Miku メーターブロックの点灯
        const mikuBlocks = document.getElementById('miku-meter-blocks').children;
        for (let i = 0; i < 5; i++) {
            if (i < mikuIntensity) {
                mikuBlocks[i].style.background = '#39C5BB';
            } else {
                mikuBlocks[i].style.background = 'rgba(57, 197, 187, 0.15)';
            }
        }
        
        // Rin メーターブロックの点灯
        const rinBlocks = document.getElementById('rin-meter-blocks').children;
        for (let i = 0; i < 5; i++) {
            if (i < rinIntensity) {
                rinBlocks[i].style.background = '#FFEE11';
            } else {
                rinBlocks[i].style.background = 'rgba(255, 238, 17, 0.15)';
            }
        }
    }

    // 撮影写真をフィルムストリップ用に内部記録（最大12枚で古い順に間引き）。
    // コンタクトシートの選択セル(#3)＆選んだベスト1枚の拡大表示(#4)をどちらも鮮明にするため、
    // 元の撮影キャンバス(1024)から十分な解像度で保存する（dataURL文字列なので軽量・GPU不使用）。
    recordPhotoToFilm(canvas, candidate, score, timeStr) {
        sfx.play('shutter_click');
        if (candidate) sfx.play('shutter_star');
        const thumbSize = this.isMobile ? 384 : 512;
        const thumb = document.createElement('canvas');
        thumb.width = thumbSize;
        thumb.height = thumbSize;
        const tctx = thumb.getContext('2d');
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(canvas, 0, 0, thumbSize, thumbSize);
        const url = thumb.toDataURL('image/jpeg', 0.86);

        this.photoLog.push({ url: url, candidate: candidate, score: score || 0, timeStr: timeStr });
        while (this.photoLog.length > this.MAX_FILM_PHOTOS) {
            this.photoLog.shift(); // 超過分は古い順に間引く
        }

        // すでにフィルムストリップ表示中なら即時反映
        if (this.filmStripVisible) {
            this.renderFilmStripPhotos();
        }
    }

    // 曲が自然終了（songEnd）したときに main.js から呼ばれる「締めの間」。
    // 撮った写真があればコンタクトシート（ベスト選定＝写真選択）を出し、選び終えて
    // 「次へ」を押したら done() で通常のリザルト（エンドカード→湖へ）へ繋ぐ。
    // 写真が無ければ間を置かずそのまま done()。
    // ※「写真選択が楽曲終了前に出る」不具合を避けるため、曲を最後まで聴かせてから出す。
    runEndInterlude(done) {
        const finish = (typeof done === 'function') ? done : () => {};
        if (!this.isActive || !this.photoLog || this.photoLog.length === 0) {
            finish();
            return;
        }
        this.showFilmStrip(finish);
    }

    // 曲が終わったら、撮った写真を画面全体に散らしてから1枚の
    // コンタクトシート（印画紙）へ整列させるフィナーレ（写真選択）を表示。
    // onDone: ベストを選び「次へ」を押したときに呼ぶ完了コールバック（通常リザルトへ繋ぐ）。
    showFilmStrip(onDone) {
        if (this.filmStripVisible || !this.songWrapper) return;
        this.filmStripVisible = true;
        this._endInterludeDone = (typeof onDone === 'function') ? onDone : null;

        // 現像ラボ風の一閃でコンタクトシートへ切り替わる印象を作る
        try { this.triggerShutterFlash(); } catch (e) { /* 無害 */ }

        // ここに来る時点で曲は自然終了済み（songEnd後）。早出し時代のような再生一時停止は不要。

        // ミク/リンは「被写体(Model)」。撮影したのはプレイヤー自身なので Photo by YOU。
        const shownName = this.shownKey === 'rin' ? 'リン⚡' : 'ミク♡';
        const sheet = document.createElement('div');
        sheet.id = 'shutter-contactsheet';
        sheet.innerHTML = `
            <div class="cs-backdrop"></div>
            <div class="cs-sheet">
                <div class="cs-header">
                    <span class="cs-title">CONTACT SHEET</span>
                    <span class="cs-sub">— BEST MOMENTS —</span>
                </div>
                <div class="cs-prompt" id="shutter-cs-prompt"></div>
                <div class="cs-grid" id="shutter-cs-grid"></div>
                <div class="cs-footer">
                    <span class="cs-stats" id="shutter-cs-stats"></span>
                    <span class="cs-sign">Model ${shownName}　·　Photo by YOU</span>
                </div>
                <button class="cs-next" id="shutter-cs-next" style="display:none;">次へ ▶</button>
            </div>
        `;
        this.songWrapper.appendChild(sheet);
        this.filmStripEl = sheet;

        // コンタクトシートは songWrapper(=#scene-container, z-index:1 の内側)に属するため、
        // z-index:60 を持たせても #ui-container(z-index:10) 配下のフッター再生バーより前面に
        // 来られない。結果、画面下端の再生シークバーがコンタクトシートの上に描画され、
        // スマホでは中央シートの「次へ」ボタンと重なっていた。曲は自然終了済みで
        // シークバーは操作不能なため、コンタクトシート表示中はフッターごと退避する。
        // 復帰は不要: backToLake で隠れ、次曲の songChange で表示し直される。
        const footerControls = document.getElementById('player-controls');
        if (footerControls) footerControls.style.display = 'none';

        // コンタクトシート内の入力を songWrapper（カメラ首振り/ピンチズーム/ホイール＝onWheelは常にpreventDefault）
        // へ伝播させない。これらが touch/wheel を奪うと写真グリッドがスクロールできない。
        // すべて passive（preventDefaultしない）で stopPropagation だけ行い、ネイティブスクロール/タップは活かす。
        ['pointerdown', 'mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'click']
            .forEach((ev) => sheet.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));

        // 「次へ」: 通常のリザルト（エンドカード→楽曲選択へ復帰）に繋ぐ。
        // 曲は既に自然終了しているので、再生再開ではなく完了コールバックを呼ぶ。
        const nextBtn = sheet.querySelector('#shutter-cs-next');
        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                nextBtn.disabled = true;
                nextBtn.textContent = '♪';
                const done = this._endInterludeDone;
                this._endInterludeDone = null;
                if (done) done();
            });
        }

        this.renderFilmStripPhotos();

        requestAnimationFrame(() => sheet.classList.add('cs-in'));
    }

    // コンタクトシートに「ベストショット候補」を決定する。
    // 自動判定の候補(candidate)を基本にし、少なすぎる場合は構図スコア上位で補完。
    computeBestCandidates() {
        const cand = new Set();
        this.photoLog.forEach((p, i) => { if (p.candidate) cand.add(i); });
        if (cand.size < 2 && this.photoLog.length >= 2) {
            [...this.photoLog.keys()]
                .sort((a, b) => (this.photoLog[b].score || 0) - (this.photoLog[a].score || 0))
                .forEach((i) => { if (cand.size < 2) cand.add(i); });
        }
        if (cand.size === 0 && this.photoLog.length > 0) cand.add(0);
        return cand;
    }

    renderFilmStripPhotos() {
        if (!this.filmStripEl) return;
        const grid = this.filmStripEl.querySelector('#shutter-cs-grid');
        const stats = this.filmStripEl.querySelector('#shutter-cs-stats');
        const prompt = this.filmStripEl.querySelector('#shutter-cs-prompt');
        const nextBtn = this.filmStripEl.querySelector('#shutter-cs-next');
        if (!grid) return;

        if (stats) {
            stats.innerHTML = `撮影 <b>${this.totalShots}</b>枚 ・ 候補 <b>${this.starShots}</b>枚`
                + (this.lockShots > 0 ? ` ・ ロック <b>${this.lockShots}</b>回` : '');
        }

        if (this.photoLog.length === 0) {
            grid.innerHTML = `<div class="cs-empty">NO FILM — 1枚も撮れませんでした</div>`;
            if (prompt) prompt.textContent = '';
            if (nextBtn) nextBtn.style.display = '';   // 撮影ゼロなら選択不要、すぐ次へ
            return;
        }

        const candSet = this.computeBestCandidates();

        // 各セルは画面外〜近傍にランダムに散らばった状態で生成し、整列させる
        const cells = this.photoLog.map((p, i) => {
            const sx = (Math.random() * 2 - 1) * 90;   // vw
            const sy = (Math.random() * 2 - 1) * 80 - 10; // vh（やや上方から舞い込む）
            const srot = (Math.random() * 2 - 1) * 40;
            const tilt = ((i % 2 === 0) ? -1 : 1) * (1 + (i % 3));
            const frameNo = String(i + 1).padStart(2, '0');
            const isCand = candSet.has(i);
            return `
                <div class="cs-cell${isCand ? ' cs-candidate' : ' cs-noncand'}" data-idx="${i}"
                     style="--sx:${sx.toFixed(1)}vw; --sy:${sy.toFixed(1)}vh; --srot:${srot.toFixed(1)}deg; --tilt:${tilt}deg;">
                    <img src="${p.url}" alt="">
                    <span class="cs-frame-no">${frameNo}</span>
                    <span class="cs-time">${p.timeStr}</span>
                    ${isCand ? '<span class="cs-cand-ring"></span>' : ''}
                </div>
            `;
        }).join('');
        grid.innerHTML = cells;

        // 散らばり → 整列（インデックス順にスタッガー）
        const cellEls = grid.querySelectorAll('.cs-cell');
        cellEls.forEach((el, i) => {
            el.style.transitionDelay = `${i * 0.07}s`;
            requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('cs-settled')));
        });

        // 整列が終わったら「1枚を選ぶ」操作を有効化。
        // 候補(金枠)は“おすすめ”の目印に留め、撮った写真ならどれでもタップして選べるようにする。
        this._bestChosen = false;
        const enableDelay = 250 + cellEls.length * 70 + 300;
        if (!this._csMarkTimers) this._csMarkTimers = [];
        this._csMarkTimers.forEach(clearTimeout);
        this._csMarkTimers = [];
        this._csMarkTimers.push(setTimeout(() => {
            if (this._bestChosen) return;
            grid.classList.add('cs-scroll'); // 整列完了→スクロール可能に（多くても全写真を選べる／見切れない）
            if (prompt) {
                const more = grid.scrollHeight > grid.clientHeight + 4;
                prompt.textContent = '★ ベストの1枚を選ぼう — 好きな写真をタップ（光るのはおすすめ）' + (more ? '／スクロールで全部表示' : '');
            }
            cellEls.forEach((el) => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(el.getAttribute('data-idx'), 10);
                    this.chooseBestShot(idx, el);
                });
            });
        }, enableDelay));
    }

    // プレイヤーが候補から1枚を選んだ時の「スポットライト＆スタンプ」昇格演出。
    chooseBestShot(index, cellEl) {
        if (this._bestChosen || !this.filmStripEl) return;
        this._bestChosen = true;
        const p = this.photoLog[index];
        this.bestChosenTimeStr = p ? p.timeStr : null;
        try { sfx.play('shutter_star'); } catch (e) { /* 無害 */ }
        try { sfx.play('shutter_click'); } catch (e) { /* 無害 */ }

        const sheet = this.filmStripEl.querySelector('.cs-sheet');
        const grid = this.filmStripEl.querySelector('#shutter-cs-grid');
        const prompt = this.filmStripEl.querySelector('#shutter-cs-prompt');
        const stats = this.filmStripEl.querySelector('#shutter-cs-stats');
        const nextBtn = this.filmStripEl.querySelector('#shutter-cs-next');
        if (!sheet || !grid) return;

        // 周囲をモノクロ＆沈ませ、選んだ1枚を主役に（クリックは以後無効）
        grid.querySelectorAll('.cs-cell').forEach((el) => {
            el.style.pointerEvents = 'none';
            el.classList.remove('cs-candidate');
            if (el !== cellEl) el.classList.add('cs-loser');
        });

        // スポットライトの暗幕
        const veil = document.createElement('div');
        veil.className = 'cs-veil';
        sheet.appendChild(veil);

        // ヒーロー（拡大した決定的1枚）＋ スタンプ ＋ 火花
        const hero = document.createElement('div');
        hero.className = 'cs-hero';
        hero.innerHTML = `<img src="${p.url}" alt=""><div class="cs-stamp">★ BEST SHOT</div>`;
        for (let k = 0; k < 12; k++) {
            const ang = (k / 12) * Math.PI * 2;
            const sp = document.createElement('span');
            sp.className = 'cs-spark';
            sp.style.setProperty('--dx', `${Math.round(Math.cos(ang) * 150)}px`);
            sp.style.setProperty('--dy', `${Math.round(Math.sin(ang) * 150)}px`);
            hero.appendChild(sp);
        }
        sheet.appendChild(hero);
        requestAnimationFrame(() => { veil.classList.add('on'); hero.classList.add('on'); });

        if (prompt) prompt.textContent = '';
        if (stats) stats.innerHTML = `★ <b>BEST SHOT 決定！</b> ・ 撮影 <b>${this.totalShots}</b>枚`;

        // ベスト決定をリザルトの締めの一行に反映させる
        if (SHUTTER_LAKE_ENABLED) this._bestShotSealed = true;

        // 最終リザルトにも反映
        this.updateResultSummary();

        // 演出が落ち着いたら「次へ」を提示
        if (!this._csMarkTimers) this._csMarkTimers = [];
        this._csMarkTimers.push(setTimeout(() => {
            if (nextBtn) nextBtn.style.display = '';
        }, 1200));
    }

    triggerShutterFlash() {
        const flash = document.createElement('div');
        flash.style.position = 'absolute';
        flash.style.top = '0';
        flash.style.left = '0';
        flash.style.width = '100%';
        flash.style.height = '100%';
        flash.style.background = '#ffffff';
        flash.style.zIndex = '50';
        flash.style.pointerEvents = 'none';
        flash.style.transition = 'opacity 0.2s ease-out';
        this.songWrapper.appendChild(flash);
        
        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => {
                if (flash.parentNode) flash.parentNode.removeChild(flash);
            }, 300);
        }, 50);
    }
    
    // 実際の3D背景（夜空の月・星・湖面＋シーン背景）を写真の画像エリアへ焼き付ける。
    // 浮遊フレーム/歌詞/AFスコープ/被写体は別レイヤー(2D投影・被写体焼き込み)で重ねるため、
    // ここでは隠して「背景だけ」をレンダリングする。被写体焼き込み(burnMikuIntoPhoto)と
    // 同じ中央クロップで描くのでフレーミングが揃う。成功で true、フラグoff/未準備で false。
    renderSceneBackdropIntoPhoto(ctx, photoX, photoY, photoW, photoH) {
        if (!SHUTTER_LAKE_ENABLED || !this.renderer) return false;

        const toHide = [];
        this.frames.forEach(f => {
            toHide.push(f);
            if (f.userData.photoMesh) toHide.push(f.userData.photoMesh);
        });
        this.activeSprites.forEach(s => toHide.push(s));
        this.transitioningPhotos.forEach(p => toHide.push(p));
        if (this.targetScope) toHide.push(this.targetScope);
        this.subjects.forEach(s => { if (s.mesh) toHide.push(s.mesh); });

        const prevVisibility = toHide.map(o => o.visible);
        toHide.forEach(o => { o.visible = false; });

        let ok = false;
        try {
            // シーン背景・フォグはそのまま（実際の夜の背景を写し込む）
            this.renderer.render(this.scene, this.camera);

            const srcCanvas = this.renderer.domElement;
            const srcW = srcCanvas.width;
            const srcH = srcCanvas.height;

            // 写真エリアのアスペクト比に合わせて中央クロップ（焼き込み被写体と同じ規約）
            const photoAspect = photoW / photoH;
            let sw = srcW;
            let sh = srcW / photoAspect;
            if (sh > srcH) {
                sh = srcH;
                sw = srcH * photoAspect;
            }
            const sx = (srcW - sw) / 2;
            const sy = (srcH - sh) / 2;

            ctx.drawImage(srcCanvas, sx, sy, sw, sh, photoX, photoY, photoW, photoH);
            ok = true;
        } catch (err) {
            console.warn('[SHUTTER] backdrop render skipped:', err);
        }

        toHide.forEach((o, i) => { o.visible = prevVisibility[i]; });
        return ok;
    }

    // 被写体ミクVRMだけを透過レンダリングし、ポラロイド写真の中央に焼き付ける
    burnMikuIntoPhoto(ctx, photoX, photoY, photoW, photoH) {
        if (!this.mikuVRM || !this.renderer) return;

        // ミク以外のオブジェクトを一時的に非表示にする
        const toHide = [];
        this.frames.forEach(f => {
            toHide.push(f);
            if (f.userData.photoMesh) toHide.push(f.userData.photoMesh);
        });
        this.activeSprites.forEach(s => toHide.push(s));
        this.transitioningPhotos.forEach(p => toHide.push(p));
        if (this.targetScope) toHide.push(this.targetScope);
        // 湖面・月・星・波紋は焼き込み写真には写し込まない（従来のポラロイドの見た目を保つ）
        if (this.lakeWater) toHide.push(this.lakeWater);
        if (this.lakeMoon) toHide.push(this.lakeMoon);
        if (this.lakeStars) toHide.push(this.lakeStars);
        this.lakeRipples.forEach(r => toHide.push(r.mesh));

        const prevVisibility = toHide.map(o => o.visible);
        toHide.forEach(o => { o.visible = false; });

        const prevBackground = this.scene.background;
        const prevFog = this.scene.fog;
        this.scene.background = null;
        this.scene.fog = null;

        try {
            // ミクのみを透過背景でレンダリングし、その場でCanvasへ転写
            this.renderer.render(this.scene, this.camera);

            const srcCanvas = this.renderer.domElement;
            const srcW = srcCanvas.width;
            const srcH = srcCanvas.height;

            // 写真エリアのアスペクト比に合わせて中央クロップ
            const photoAspect = photoW / photoH;
            let sw = srcW;
            let sh = srcW / photoAspect;
            if (sh > srcH) {
                sh = srcH;
                sw = srcH * photoAspect;
            }
            const sx = (srcW - sw) / 2;
            const sy = (srcH - sh) / 2;

            ctx.save();
            ctx.globalAlpha = 0.96;
            ctx.drawImage(srcCanvas, sx, sy, sw, sh, photoX, photoY, photoW, photoH);
            ctx.restore();
        } catch (err) {
            console.warn('[SHUTTER] Miku burn-in skipped:', err);
        }

        // すべての可視状態と背景・フォグを復元
        toHide.forEach((o, i) => { o.visible = prevVisibility[i]; });
        this.scene.background = prevBackground;
        this.scene.fog = prevFog;
    }

    // 撮影瞬間に「被写体(ミク/リン)が画面内に良く収まっているか」を構図評価する。
    // 表示中の被写体の足元/頭をNDC(-1..1)へ投影し、画面内・中央寄り・適切な大きさ・
    // 頭が切れていないか をスコア化(0..1)。score>=0.5 かつ顔が破綻していなければ wellFramed。
    evaluateSubjectComposition() {
        const subject = this.subjects && this.subjects.find(s => s.key === this.shownKey);
        if (!subject || !subject.mesh || !this.camera) {
            return { score: 0, wellFramed: false, reason: 'no-subject' };
        }
        const mesh = subject.mesh;
        mesh.updateMatrixWorld(true);

        // ねんどろ体型(頭が大きい)を正しく捉えるため、頭ボーンではなく実バウンディング
        // ボックスから 頭頂(max.y)/足元(min.y)/中心 を取り、画面内の収まりを評価する。
        // ※頭ボーンは胴体並みに低く、頭頂は遥か上にあるため、ボーン基準だと過小評価になる。
        const box = new THREE.Box3().setFromObject(mesh);
        if (box.isEmpty()) return { score: 0, wellFramed: false, reason: 'empty' };
        const center = box.getCenter(new THREE.Vector3());
        const crown = new THREE.Vector3(center.x, box.max.y, center.z);
        const foot  = new THREE.Vector3(center.x, box.min.y, center.z);

        const cNdc = center.clone().project(this.camera);
        const crownNdc = crown.clone().project(this.camera);
        const footNdc = foot.clone().project(this.camera);

        // カメラ背面(被写体が後ろ)ならベスト不可
        if (cNdc.z >= 1) {
            return { score: 0, wellFramed: false, reason: 'behind' };
        }

        // 1) 横位置の中央寄り（三分割法を許容）
        const ax = Math.abs(cNdc.x);
        const centerScore = ax <= 0.34 ? 1 : Math.max(0, 1 - (ax - 0.34) / 0.5);

        // 2) 画面に占める大きさ（頭頂〜足元のNDC高さ / 全画面高2.0）
        const frac = Math.abs(crownNdc.y - footNdc.y) / 2; // 0..1
        let sizeScore;
        if (frac < 0.25) sizeScore = (frac / 0.25) * 0.4;                  // 小さすぎ(遠い)
        else if (frac <= 1.0) sizeScore = 0.4 + (frac - 0.25) / (0.6 - 0.25) * 0.6; // 良好(寄るほど高評価)
        else sizeScore = 1 - (frac - 1.0) / 0.6;                           // 寄りすぎ/見切れ
        sizeScore = Math.max(0, Math.min(1, sizeScore));

        // 3) 顔/頭の破綻チェック（頭頂の見切れ・被写体が画面横に外れる）
        let faceScore = 1;
        if (crownNdc.y > 1.0) faceScore = 0.25;        // 頭頂が画面上端より上＝頭が切れている
        else if (crownNdc.y > 0.94) faceScore = 0.6;   // ギリギリ
        if (ax > 1.0) faceScore *= 0.2;                // 被写体が画面横外

        // 被写体そのものの写り(サイズ＋顔の破綻なさ)に、中央寄り係数を掛ける。
        // 端に寄った絵は大きく/くっきり写っていても良い構図とは見なさない。
        const framingQuality = 0.55 * sizeScore + 0.45 * faceScore;
        const centerFactor = 0.4 + 0.6 * centerScore;
        const score = Math.max(0, Math.min(1, framingQuality * centerFactor));
        const wellFramed = score >= 0.5 && faceScore >= 0.5;
        return { score, wellFramed, centerScore, sizeScore, faceScore, reason: 'ok' };
    }

    // 評価軸その2: 撮影フレームに「この曲を象徴する歌詞」が映っているかを判定。
    // 表示中(不透明)かつ画面内のスプライトのうち、象徴ワードを含むものを探し、
    // 最も中央寄りの1件を採用する。映っていれば印象的な1枚として評価を上げる。
    evaluateSignatureLyric() {
        if (!this.activeSprites || !this.activeSprites.length || !this.camera) {
            return { has: false };
        }
        let best = null;
        for (const sprite of this.activeSprites) {
            const text = sprite.userData && sprite.userData.text;
            if (!text) continue;
            if (sprite.material && sprite.material.opacity <= 0.4) continue; // ほぼ消えかけは除外
            const keyword = SHUTTER_SIGNATURE_LYRICS.find(k => text.includes(k));
            if (!keyword) continue;
            const ndc = sprite.position.clone().project(this.camera);
            if (ndc.z >= 1) continue;                                         // カメラ背面
            if (Math.abs(ndc.x) > 0.92 || Math.abs(ndc.y) > 0.92) continue;  // 画面外
            const centrality = 1 - Math.min(1, Math.hypot(ndc.x, ndc.y) / 0.92);
            if (!best || centrality > best.centrality) best = { text, keyword, centrality };
        }
        return best ? { has: true, text: best.text, keyword: best.keyword, centrality: best.centrality }
                    : { has: false };
    }

    takePhoto() {
        // ポーズ編集中は撮影入力をすべて無効化（編集の「このポーズで撮る」で閉じてから撮る）
        if (this.poseEditing) {
            return;
        }
        if (!playerManager.player || !playerManager.player.isPlaying || !playerManager.player.timer) {
            return;
        }

        // 写真のトランジション中（正面ホールド中および赤い枠への吸い込み移動中）は連射撮影をガード！
        if (this.transitioningPhotos && this.transitioningPhotos.length > 0) {
            return;
        }

        // 高精度に補間された描画時間（smoothed time）を使用し、画面描画とミリ秒レベルで同期させる
        const position = this.getSmoothedTime();
        if (position <= 0) {
            return;
        }

        // Ensure camera and scene world matrices are completely up-to-date before projections
        this.camera.updateMatrixWorld(true);
        this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
        this.scene.updateMatrixWorld(true);

        this.triggerShutterFlash();

        // 一瞬を切り取る = 水面に一滴。足元の湖面へ波紋を広げる（A-2）。
        this.spawnLakeRipple();

        // 撮影瞬間のボーカル（ミク / リン / サビならduet）をキャッシュデータおよびアクティブスプライトから判定
        let activeVocal = 'none';
        
        const cached = this.allWordGroups.find(g => g.startTime <= position && position <= g.endTime);
        if (cached) {
            activeVocal = this.isClimax ? 'duet' : cached.vocal;
        } else if (this.isClimax) {
            activeVocal = 'duet';
        } else {
            // アクティブな表示スプライトから多数決で判別
            const mikuCount = this.activeSprites.filter(s => s.userData.vocal === 'miku').length;
            const rinCount = this.activeSprites.filter(s => s.userData.vocal === 'rin').length;
            if (mikuCount > 0 || rinCount > 0) {
                activeVocal = mikuCount >= rinCount ? 'miku' : 'rin';
            } else {
                activeVocal = 'miku'; // fallback
            }
        }

        // 【★ベストショット判定】タイミング(サビ/デュエット)だけでは人は納得しない。
        // 被写体(ミク/リン)が画面内に良く収まっている=構図が良いことを必須条件にする。
        const goodTiming = this.isClimax || activeVocal === 'duet';
        const composition = this.evaluateSubjectComposition();
        const isWellFramed = composition.wellFramed;
        // 評価軸その2: 曲を象徴する歌詞が映っていれば“印象的な1枚”として加点する。
        const signatureLyric = this.evaluateSignatureLyric();
        // 構図が良いことが大前提。その上で「良い瞬間(サビ/デュエット)」「象徴歌詞が映る」
        // 「構図が極上」のいずれかを満たせば★。
        const isBestShot = isWellFramed && (goodTiming || signatureLyric.has || composition.score >= 0.82);

        // 【フォトスポット・ターゲットロック判定 (案B)】
        let isTargetLocked = false;
        let lockedWordText = '';
        if (this.targetScope) {
            this.activeSprites.forEach(sprite => {
                // 各スプライト固有のオフセットターゲット座標を取得
                const offset = sprite.userData.targetOffset || new THREE.Vector2(0, 0);
                const targetPos = new THREE.Vector3(
                    this.targetScope.position.x + offset.x,
                    this.targetScope.position.y + offset.y,
                    sprite.position.z // Z座標は同じ深度
                );
                
                const dist = sprite.position.distanceTo(targetPos);
                // 各自の指定ピント位置へ十分に吸着しているか（距離が 1.5 以内かつある程度不透明）を判定！
                if (dist <= 1.5 && sprite.material && sprite.material.opacity > 0.5) {
                    isTargetLocked = true;
                    lockedWordText = sprite.userData.text;
                }
            });
        }

        // 液晶画面に [SHOT!] アラート表示をトリガー
        const alertDisp = document.getElementById('shutter-alert-display');
        if (alertDisp) {
            alertDisp.style.display = 'block';
            if (isTargetLocked) {
                alertDisp.innerText = '★ TARGET LOCKED ★';
                alertDisp.style.color = '#FFEE11';
                alertDisp.style.borderColor = '#FFEE11';
                alertDisp.style.textShadow = '0 0 15px #FFEE11, 0 0 5px #ffffff';
            } else if (isWellFramed && signatureLyric.has) {
                // 被写体も歌詞も決まった“名フレーズ”の1枚
                alertDisp.innerText = `♪ 名フレーズ「${signatureLyric.keyword}」激写 ♪`;
                alertDisp.style.color = '#FFEE11';
                alertDisp.style.borderColor = '#FFEE11';
                alertDisp.style.textShadow = '0 0 12px #FFEE11, 0 0 4px #fff';
            } else if (goodTiming && !isWellFramed) {
                // 絶好の瞬間なのに被写体が見切れ/小さすぎ＝★を逃した理由を伝える
                alertDisp.innerText = 'FRAMING MISS — 被写体を画面に！';
                alertDisp.style.color = '#FF7A4D';
                alertDisp.style.borderColor = '#FF7A4D';
                alertDisp.style.textShadow = '0 0 8px #FF7A4D';
            } else {
                alertDisp.innerText = activeVocal === 'miku' ? 'SHOT: MIKU_CH' : (activeVocal === 'rin' ? 'SHOT: RIN_CH' : 'SHOT: DUET_MAX');
                const alertColor = activeVocal === 'miku' ? '#39C5BB' : (activeVocal === 'rin' ? '#FFEE11' : '#B9543C');
                alertDisp.style.color = alertColor;
                alertDisp.style.borderColor = alertColor;
                alertDisp.style.textShadow = `0 0 8px ${alertColor}`;
            }
            
            setTimeout(() => {
                alertDisp.style.display = 'none';
            }, 600);
        }

        // 1. 古い写真の枚数制限処理を実行
        // 浮かぶ写真の同時枚数はフレーム数(20)と一致させる（FPS≥40を実機確認のうえ確定）。
        const activePhotoFrames = this.frames.filter(f => f.userData.hasPhoto && !f.userData.isFadingOut);
        const MAX_PHOTOS = 20;
        if (activePhotoFrames.length >= MAX_PHOTOS) {
            activePhotoFrames.sort((a, b) => a.userData.photoSpawnTime - b.userData.photoSpawnTime);
            const oldest = activePhotoFrames[0];
            oldest.userData.isFadingOut = true;
            oldest.userData.fadeOpacity = 1.0;
        }

        // 2. 背景を浮遊している赤いワイヤーフレームの中から、まだ写真が入っていない(hasPhoto = false)ものを抽出し、奥の方（Z座標がより小さくカメラから遠い）順にソートする
        const availableFrames = this.frames.filter(f => !f.userData.hasPhoto && !f.userData.dropSpeed);
        
        // Z座標の昇順でソート（最も奥にあるフレームが先頭にくる）
        availableFrames.sort((a, b) => a.position.z - b.position.z);
        
        // できるだけ背景の奥の方にある赤い枠（最も遠い上位3つ）からランダムに選択することで、自然な分散を持たせつつ奥へ吸い込まれる演出にする
        const candidates = availableFrames.slice(0, Math.min(3, availableFrames.length));
        const targetFrame = candidates.length > 0 
            ? candidates[Math.floor(Math.random() * candidates.length)]
            // 空き枠が無い(21枚目以降)ときは最古の写真枠(=フェード中の枠)を再利用する
            : this.frames.filter(f => !f.userData.dropSpeed)
                .sort((a, b) => (b.userData.isFadingOut ? 1 : 0) - (a.userData.isFadingOut ? 1 : 0)
                    || (a.userData.photoSpawnTime || 0) - (b.userData.photoSpawnTime || 0))[0];

        if (!targetFrame) return; // 浮遊フレームが万が一見つからない場合は処理をスキップ

        // 2. メモリ上に Canvas を作成し、スナップショットを描画
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // 【Beat同期判定に応じたポラロイド台紙（枠）カラー】
        const player = playerManager.player;
        let isBeatSynced = false;
        if (player && typeof player.findBeat === 'function') {
            const beat = player.findBeat(position);
            if (beat) {
                const diff = Math.abs(position - beat.startTime);
                if (diff <= 150) {
                    isBeatSynced = true;
                }
            }
        }

        // ビートにタイミングよく撮れたら、表示中の被写体がにっこり笑う
        if (isBeatSynced && this.subjects && this.subjects.length) {
            const shown = this.subjects.find(s => s.key === this.shownKey);
            if (shown) shown.smileTimer = 900; // 約0.9秒の笑顔
        }

        // 【フォトスポット ＆ Beat同期のカラー台紙マージ判定】
        const hasColorBorder = isBeatSynced || isTargetLocked;

        // ポラロイドの枠（台紙）の描画
        if (isTargetLocked) {
            // 最上位アワード：ターゲットロックオン成功（極上のネオ・パステルレインボー）
            const bgGrad = ctx.createLinearGradient(0, 0, 1024, 1024);
            bgGrad.addColorStop(0, '#39C5BB'); // シアン
            bgGrad.addColorStop(0.4, '#FFEE11'); // イエロー
            bgGrad.addColorStop(0.7, '#FF3366'); // ネオンピンク
            bgGrad.addColorStop(1, '#9B5DE5'); // パープル
            ctx.fillStyle = bgGrad;
        } else if (isBeatSynced) {
            // Beat同期成功：歌唱パートに合わせてカラー化
            const bgGrad = ctx.createLinearGradient(0, 0, 1024, 1024);
            if (activeVocal === 'miku') {
                // ミク：さわやかなシアン
                bgGrad.addColorStop(0, '#39C5BB');
                bgGrad.addColorStop(1, '#20857E');
            } else if (activeVocal === 'rin') {
                // リン：鮮やかなイエロー
                bgGrad.addColorStop(0, '#FFEE11');
                bgGrad.addColorStop(1, '#B5A500');
            } else {
                // デュエット・合唱：シアンとイエローの美しいグラデーション
                bgGrad.addColorStop(0, '#39C5BB');
                bgGrad.addColorStop(0.5, '#99DA66');
                bgGrad.addColorStop(1, '#FFEE11');
            }
            ctx.fillStyle = bgGrad;
        } else {
            // 通常（失敗またはタイミング外し）：白色の台紙
            ctx.fillStyle = '#ffffff';
        }
        ctx.fillRect(0, 0, 1024, 1024);

        // 特別アワード刻印
        if (isTargetLocked) {
            // ターゲットロックオン刻印
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 28px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#FF3366';
            ctx.shadowBlur = 10;
            ctx.fillText('★ TARGET LOCKED & PERFECT AF ★', 512, 42);
            ctx.shadowBlur = 0; // シャドウをリセット
        } else if (isBeatSynced) {
            // 通常ビート同期刻印
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 28px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = activeVocal === 'miku' ? '#115450' : (activeVocal === 'rin' ? '#6E6300' : '#883300');
            ctx.shadowBlur = 8;
            ctx.fillText('★ PERFECT BEAT SYNC ★', 512, 42);
            ctx.shadowBlur = 0; // シャドウをリセット
        }

        const photoX = 80;
        const photoY = 80;
        const photoW = 864;
        const photoH = 700;

        // 【ボイスカラー・プリント (提案A)】
        // 歌唱タイミングに応じて、背景の焼き込みカラーグラデーションを変化
        const gradient = ctx.createLinearGradient(photoX, photoY, photoX + photoW, photoY + photoH);
        if (activeVocal === 'miku') {
            // ミク: さわやかで深みのあるシアン〜ネイビー
            gradient.addColorStop(0, '#092120');
            gradient.addColorStop(0.5, '#194D4A');
            gradient.addColorStop(1, '#02100F');
        } else if (activeVocal === 'rin') {
            // リン: 温かみのあるアンバーイエロー〜ゴールドダーク
            gradient.addColorStop(0, '#241D09');
            gradient.addColorStop(0.5, '#524314');
            gradient.addColorStop(1, '#100C02');
        } else {
            // デュエット・合唱: シアンとゴールドが溶け合うサンセット色
            gradient.addColorStop(0, '#092120');
            gradient.addColorStop(0.5, '#303612');
            gradient.addColorStop(1, '#1A1D05');
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(photoX, photoY, photoW, photoH);

        // 実際の3D背景（夜空の月・星・湖面）を写真に反映する。
        // 成功時はボイスカラー台紙を薄いウォッシュとして上掛けし、曲パートの色味だけ残す。
        if (this.renderSceneBackdropIntoPhoto(ctx, photoX, photoY, photoW, photoH)) {
            ctx.save();
            ctx.globalAlpha = 0.20;
            ctx.fillStyle = gradient;
            ctx.fillRect(photoX, photoY, photoW, photoH);
            ctx.restore();
        }

        // カメラのファインダー（ビューファインダー）と、湖面の波紋を模したサークルエンブレムを薄く焼き付ける
        ctx.strokeStyle = activeVocal === 'miku' ? 'rgba(57, 197, 187, 0.12)' : (activeVocal === 'rin' ? 'rgba(255, 238, 17, 0.12)' : 'rgba(185, 84, 60, 0.15)');
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(photoX + photoW / 2, photoY + photoH / 2, 220, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(photoX + photoW / 2, photoY + photoH / 2, 120, 0, Math.PI * 2);
        ctx.stroke();

        // 四隅のファインダー枠
        ctx.strokeStyle = activeVocal === 'miku' ? 'rgba(57, 197, 187, 0.35)' : (activeVocal === 'rin' ? 'rgba(255, 238, 17, 0.35)' : 'rgba(185, 84, 60, 0.45)');
        ctx.lineWidth = 4;
        const pad = 35;
        // 左上
        ctx.beginPath();
        ctx.moveTo(photoX + pad, photoY + pad + 30);
        ctx.lineTo(photoX + pad, photoY + pad);
        ctx.lineTo(photoX + pad + 30, photoY + pad);
        ctx.stroke();
        // 右上
        ctx.beginPath();
        ctx.moveTo(photoX + photoW - pad, photoY + pad + 30);
        ctx.lineTo(photoX + photoW - pad, photoY + pad);
        ctx.lineTo(photoX + photoW - pad - 30, photoY + pad);
        ctx.stroke();
        // 左下
        ctx.beginPath();
        ctx.moveTo(photoX + pad, photoY + photoH - pad - 30);
        ctx.lineTo(photoX + pad, photoY + photoH - pad);
        ctx.lineTo(photoX + pad + 30, photoY + photoH - pad);
        ctx.stroke();
        // 右下
        ctx.beginPath();
        ctx.moveTo(photoX + photoW - pad, photoY + photoH - pad - 30);
        ctx.lineTo(photoX + photoW - pad, photoY + photoH - pad);
        ctx.lineTo(photoX + photoW - pad - 30, photoY + photoH - pad);
        ctx.stroke();

        // 中央の照準（クロスヘア）
        ctx.beginPath();
        ctx.moveTo(photoX + photoW / 2 - 15, photoY + photoH / 2);
        ctx.lineTo(photoX + photoW / 2 + 15, photoY + photoH / 2);
        ctx.moveTo(photoX + photoW / 2, photoY + photoH / 2 - 15);
        ctx.lineTo(photoX + photoW / 2, photoY + photoH / 2 + 15);
        ctx.stroke();

        // 現在の3D空間の背景（すべての浮遊フレーム ＆ AFターゲットサークル ＆ 歌詞スプライト）を Canvas に焼き付ける
        ctx.save();
        
        // 写真の画像表示エリア（photoX, photoY, photoW, photoH）でクリップを設定し、枠外はみ出しを防ぐ
        ctx.beginPath();
        ctx.rect(photoX, photoY, photoW, photoH);
        ctx.clip();

        // --- 1. 背景のすべての浮遊フレーム（ワイヤーフレーム ＆ 過去の写真）の焼き付け ---
        ctx.save();
        ctx.strokeStyle = activeVocal === 'miku' ? 'rgba(57, 197, 187, 0.22)' : (activeVocal === 'rin' ? 'rgba(255, 238, 17, 0.22)' : 'rgba(185, 84, 60, 0.25)');
        ctx.lineWidth = 2.0;
        
        this.frames.forEach(frame => {
            const frameV = new THREE.Vector3();
            frameV.copy(frame.position);
            
            // カメラの背面にあるものは写り込まないので除外
            const localPos = frame.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
            if (localPos.z >= 0) return;
            
            frameV.project(this.camera);
            
            // 画面外にはみ出しすぎているフレームはスキップ
            if (frameV.x < -1.5 || frameV.x > 1.5 || frameV.y < -1.5 || frameV.y > 1.5) return;
            
            const fx = photoX + (frameV.x + 1) / 2 * photoW;
            const fy = photoY + (1 - (frameV.y + 1) / 2) * photoH;
            
            // カメラからの距離（遠近法）に応じて大きさを決定
            const dist = this.camera.position.distanceTo(frame.position);
            const fovRad = ((75 / this.zoomLevel) * Math.PI) / 180;
            const visibleFrustumHeight = 2 * dist * Math.tan(fovRad / 2);
            // 物理的に正確なパースペクティブ投影によるサイズ計算（枠の世界高さ 3.0→4.5＝1.5倍）
            const frameSizeH = photoH * (4.5 / visibleFrustumHeight);
            const frameSizeW = frameSizeH * (4.0 / 3.0); // 4:3 アスペクト比
            
            ctx.save();
            ctx.translate(fx, fy);
            
            // フレームの回転角度を擬似的に表現
            const rotZ = frame.rotation ? frame.rotation.z : 0;
            ctx.rotate(rotZ);
            
            // フレーム枠（ワイヤーフレーム）を描画
            ctx.strokeRect(-frameSizeW / 2, -frameSizeH / 2, frameSizeW, frameSizeH);
            
            // 既に写真がはめ込まれている場合は、その写真画像を焼き付ける！
            if (frame.userData.hasPhoto && frame.userData.photoImage) {
                ctx.drawImage(frame.userData.photoImage, -frameSizeW / 2, -frameSizeH / 2, frameSizeW, frameSizeH);
            } else if (frame.userData.hasPhoto) {
                ctx.fillStyle = activeVocal === 'miku' ? 'rgba(57, 197, 187, 0.08)' : (activeVocal === 'rin' ? 'rgba(255, 238, 17, 0.08)' : 'rgba(185, 84, 60, 0.1)');
                ctx.fillRect(-frameSizeW / 2, -frameSizeH / 2, frameSizeW, frameSizeH);
            }
            
            ctx.restore();
        });
        ctx.restore();

        // --- 1.5. トランジション中（飛行中・ホールド中）の写真の焼き付け ---
        ctx.save();
        this.transitioningPhotos.forEach(photo => {
            // カメラの背面にあるものは写り込まないので除外
            const localPos = photo.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
            if (localPos.z >= 0) return;
            
            const photoV = photo.position.clone().project(this.camera);
            
            // 画面外にはみ出しすぎているものはスキップ
            if (photoV.x < -1.5 || photoV.x > 1.5 || photoV.y < -1.5 || photoV.y > 1.5) return;
            
            const px = photoX + (photoV.x + 1) / 2 * photoW;
            const py = photoY + (1 - (photoV.y + 1) / 2) * photoH;
            
            const dist = this.camera.position.distanceTo(photo.position);
            const fovRad = ((75 / this.zoomLevel) * Math.PI) / 180;
            const visibleFrustumHeight = 2 * dist * Math.tan(fovRad / 2);
            // 物理的に正確なパースペクティブ投影によるサイズ計算（現在のスケールを適用）
            const currentScale = photo.scale.x;
            const sizeH = photoH * ((4.35 * currentScale) / visibleFrustumHeight); // 写真世界高さ 2.9→4.35（1.5倍）
            const sizeW = sizeH * (3.9 / 2.9);
            
            ctx.save();
            ctx.translate(px, py);
            
            // クォータニオンからZ軸周りの回転を計算
            const euler = new THREE.Euler().setFromQuaternion(photo.quaternion, 'YXZ');
            ctx.rotate(euler.z);
            
            // 写真画像を焼き付ける
            if (photo.material && photo.material.map && photo.material.map.image) {
                ctx.drawImage(photo.material.map.image, -sizeW / 2, -sizeH / 2, sizeW, sizeH);
            }
            
            // 白い枠線を描画（ポラロイド感を強調）
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-sizeW / 2, -sizeH / 2, sizeW, sizeH);
            
            ctx.restore();
        });
        ctx.restore();

        // --- 2. 3D AFターゲットサークル（照準器）の焼き付け ---
        if (this.targetScope) {
            ctx.save();
            const scopeV = new THREE.Vector3();
            scopeV.copy(this.targetScope.position);
            
            // カメラの背面にあるものは除外
            const localPos = this.targetScope.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
            if (localPos.z < 0) {
                scopeV.project(this.camera);
                
                const sx = photoX + (scopeV.x + 1) / 2 * photoW;
                const sy = photoY + (1 - (scopeV.y + 1) / 2) * photoH;
                
                const scopeDist = this.camera.position.distanceTo(this.targetScope.position);
                const fovRad = ((75 / this.zoomLevel) * Math.PI) / 180;
                const visibleFrustumHeight = 2 * scopeDist * Math.tan(fovRad / 2);
                // 物理的に正確なパースペクティブ投影による半径計算（現在のスケールを適用）
                const currentScale = this.targetScope.scale.x;
                const scopeRadius = photoH * ((0.9 * currentScale) / visibleFrustumHeight);
                
                ctx.strokeStyle = isTargetLocked ? 'rgba(255, 238, 17, 0.35)' : 'rgba(57, 197, 187, 0.22)';
                ctx.lineWidth = 3;
                ctx.shadowColor = isTargetLocked ? '#FFEE11' : '#39C5BB';
                ctx.shadowBlur = 10;
                
                // AFサークルの円形を描画
                ctx.beginPath();
                ctx.arc(sx, sy, scopeRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
        }

        // --- 3. 現在画面に表示されている歌詞（activeSprites）を Canvas に焼き付ける ---
        this.activeSprites.forEach(sprite => {
            if (sprite.userData.frameTarget) return; // 落下中のものは除く
            
            // 不透明度がほぼゼロのものは画面に映っていないため、描画を完全にスキップ
            const opacity = sprite.material ? sprite.material.opacity : 1;
            if (opacity < 0.05) return;
            
            const spriteText = sprite.userData.text;
            if (!spriteText) return;
            
            // 【3D世界座標からのスクリーン投影 (projectメソッドによる完全な画面一致)】
            const spriteV = new THREE.Vector3();
            spriteV.copy(sprite.position);
            
            // カメラの背面にある場合は除外
            const localPos = sprite.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
            if (localPos.z >= 0) return;
            
            spriteV.project(this.camera);
            
            // 投影座標が画面からはみ出しすぎているものはスキップ
            if (spriteV.x < -1.15 || spriteV.x > 1.15 || spriteV.y < -1.15 || spriteV.y > 1.15) return;
            
            const textX = photoX + (spriteV.x + 1) / 2 * photoW;
            const textY = photoY + (1 - (spriteV.y + 1) / 2) * photoH; // Y軸反転
            
            // カメラからの距離（遠近法深度）をフォントサイズに完全反映！
            const dist = this.camera.position.distanceTo(sprite.position);
            const fovRad = ((75 / this.zoomLevel) * Math.PI) / 180;
            const visibleFrustumHeight = 2 * dist * Math.tan(fovRad / 2);
            
            const currentScaleY = sprite.scale ? sprite.scale.y : (sprite.userData.baseScale || 2.5);
            // 物理的に正確なパースペクティブ投影によるフォントサイズ（高さピクセル）計算
            const fontSize = Math.round(photoH * (currentScaleY / visibleFrustumHeight));
            
            ctx.save();
            ctx.globalAlpha = opacity; // 画面上の不透明度をそのまま写真に適用！
            
            ctx.font = `bold ${fontSize}px "Inter", "Noto Sans JP", sans-serif`;
            ctx.fillStyle = '#ffffff';
            
            // 文字の色とシャドウはスプライトに設定されている実際の発光色をリアルタイムに反映
            let glowColor = activeVocal === 'miku' ? '#39C5BB' : (activeVocal === 'rin' ? '#FFEE11' : '#B9543C');
            if (sprite.material && sprite.material.color) {
                const r = Math.round(sprite.material.color.r * 255);
                const g = Math.round(sprite.material.color.g * 255);
                const b = Math.round(sprite.material.color.b * 255);
                glowColor = `rgb(${r}, ${g}, ${b})`;
            }
            
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 15;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(spriteText, textX, textY);
            ctx.restore();
        });

        // --- 4. 被写体ミクVRMの焼き付け（実際のWebGLレンダリングをミクのみ表示で抽出） ---
        // 歌詞の描画の後に重ねることで、モデルが一番手前に描画され、歌詞が隠れるようにする
        this.burnMikuIntoPhoto(ctx, photoX, photoY, photoW, photoH);
        
        ctx.restore(); // クリップ設定を復元

        // タイムスタンプの描画
        const mins = Math.floor(position / 60000).toString().padStart(2, '0');
        const secs = Math.floor((position % 60000) / 1000).toString().padStart(2, '0');
        const centis = Math.floor((position % 1000) / 10).toString().padStart(2, '0');
        const timeStr = `${mins}:${secs}.${centis}`;
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = hasColorBorder ? '#ffffff' : '#B9543C';
        ctx.font = 'bold 28px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`[ ${timeStr} ]  SNAP_${Date.now().toString().slice(-4)}`, photoX + 30, 850);

        // 【ステッカーコラージュ描画 (案A)】
        const keyword = lockedWordText || (this.activeSprites.length > 0 ? this.activeSprites[0].userData.text : '');
        if (keyword) {
            ctx.save();
            ctx.shadowBlur = 0;
            
            if (keyword.includes('シャッター') || keyword.includes('チャンス') || keyword.includes('スナップ') || keyword.includes('撮')) {
                // 1. レトロカメラスタンプの描画
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : '#B9543C';
                ctx.fillStyle = hasColorBorder ? 'rgba(255,255,255,0.15)' : 'rgba(185, 84, 60, 0.08)';
                ctx.lineWidth = 6;
                const cx = photoX + 150;
                const cy = photoY + 150;
                
                // カメラボディ
                ctx.beginPath();
                ctx.roundRect(cx - 80, cy - 40, 160, 90, 8);
                ctx.stroke();
                ctx.fill();
                
                // レンズマウント
                ctx.beginPath();
                ctx.arc(cx, cy + 5, 35, 0, Math.PI * 2);
                ctx.stroke();
                
                // ペンタプリズム（上部の出っ張り）
                ctx.beginPath();
                ctx.moveTo(cx - 30, cy - 40);
                ctx.lineTo(cx, cy - 65);
                ctx.lineTo(cx + 30, cy - 40);
                ctx.closePath();
                ctx.stroke();
                
                // シャッターボタン
                ctx.fillRect(cx - 65, cy - 50, 15, 10);
                
                // 「SNAP!」のコミックロゴ
                ctx.fillStyle = hasColorBorder ? '#ffffff' : '#B9543C';
                ctx.font = 'bold 22px monospace';
                ctx.fillText('[ SNAP! ]', cx - 45, cy + 85);
                
            } else if (keyword.includes('可愛い') || keyword.includes('当然') || keyword.includes('嫉妬') || keyword.includes('照れ') || keyword.includes('指先')) {
                // 2. ハート＆キラキラスタンプの描画
                ctx.fillStyle = hasColorBorder ? 'rgba(255,255,255,0.9)' : 'rgba(255, 50, 120, 0.8)';
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : 'rgba(255, 50, 120, 0.8)';
                ctx.lineWidth = 3;
                
                // キラキラ星（✨）を3箇所に描画
                const drawStar = (x, y, r) => {
                    ctx.beginPath();
                    for (let i = 0; i < 4; i++) {
                        ctx.lineTo(x + r * Math.cos(i * Math.PI / 2), y + r * Math.sin(i * Math.PI / 2));
                        ctx.lineTo(x + (r/3) * Math.cos(i * Math.PI / 2 + Math.PI / 4), y + (r/3) * Math.sin(i * Math.PI / 2 + Math.PI / 4));
                    }
                    ctx.closePath();
                    ctx.fill();
                };
                
                drawStar(photoX + 120, photoY + 120, 25);
                drawStar(photoX + photoW - 120, photoY + 120, 30);
                drawStar(photoX + 100, photoY + photoH - 120, 20);
                
                // ハート（♡）の描画
                const drawHeart = (x, y, size) => {
                    ctx.beginPath();
                    ctx.arc(x - size/2, y - size/2, size/2, Math.PI, 0);
                    ctx.arc(x + size/2, y - size/2, size/2, Math.PI, 0);
                    ctx.lineTo(x, y + size);
                    ctx.closePath();
                    ctx.fill();
                };
                
                drawHeart(photoX + 170, photoY + 180, 18);
                drawHeart(photoX + photoW - 180, photoY + 180, 22);
                
            } else if (keyword.includes('完全無欠') || keyword.includes('フォーカス') || keyword.includes('ピント') || keyword.includes('焦点')) {
                // 3. レンズ絞り羽根スタンプの描画
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : '#39C5BB';
                ctx.lineWidth = 4;
                const cx = photoX + photoW - 150;
                const cy = photoY + 150;
                
                ctx.beginPath();
                ctx.arc(cx, cy, 60, 0, Math.PI * 2);
                ctx.stroke();
                
                // 絞り羽根の線
                for (let i = 0; i < 6; i++) {
                    const angle = (i * Math.PI) / 3;
                    ctx.beginPath();
                    ctx.moveTo(cx + 60 * Math.cos(angle), cy + 60 * Math.sin(angle));
                    ctx.lineTo(cx + 20 * Math.cos(angle + 0.5), cy + 20 * Math.sin(angle + 0.5));
                    ctx.stroke();
                }
                
                ctx.fillStyle = hasColorBorder ? '#ffffff' : '#39C5BB';
                ctx.font = 'bold 20px monospace';
                ctx.fillText('[ FOCUS ]', cx - 50, cy + 90);
                
            } else if (keyword.includes('NG') || keyword.includes('テイク') || keyword.includes('迷') || keyword.includes('勝て')) {
                // 4. 手書きカチンコスタンプの描画
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : '#B9543C';
                ctx.fillStyle = hasColorBorder ? 'rgba(255,255,255,0.15)' : 'rgba(185, 84, 60, 0.08)';
                ctx.lineWidth = 5;
                const cx = photoX + 150;
                const cy = photoY + photoH - 180;
                
                // カチンコのベース
                ctx.beginPath();
                ctx.rect(cx - 70, cy - 20, 140, 70);
                ctx.stroke();
                ctx.fill();
                
                // カッパー（叩く上の棒。斜めに傾ける）
                ctx.save();
                ctx.translate(cx - 70, cy - 20);
                ctx.rotate(-0.2); // 少し開いている演出
                ctx.beginPath();
                ctx.rect(0, -20, 140, 20);
                ctx.stroke();
                ctx.fill();
                
                // 縞模様のドローイング
                ctx.lineWidth = 3;
                for (let i = 0; i < 5; i++) {
                    ctx.beginPath();
                    ctx.moveTo(20 + i * 25, -20);
                    ctx.lineTo(10 + i * 25, 0);
                    ctx.stroke();
                }
                ctx.restore();
                
                ctx.fillStyle = hasColorBorder ? '#ffffff' : '#B9543C';
                ctx.font = 'bold 18px monospace';
                ctx.fillText('NG_TAKE_✖', cx - 45, cy + 80);
                
            } else if (keyword.includes('一瞬') || keyword.includes('永遠') || keyword.includes('アーカイブ') || keyword.includes('思い出') || keyword.includes('残')) {
                // 5. 時計盤 / 砂時計スタンプの描画
                ctx.strokeStyle = hasColorBorder ? '#ffffff' : '#FFEE11';
                ctx.lineWidth = 4;
                const cx = photoX + photoW - 150;
                const cy = photoY + photoH - 180;
                
                // 時計盤の円
                ctx.beginPath();
                ctx.arc(cx, cy, 50, 0, Math.PI * 2);
                ctx.stroke();
                
                // 時計の針（10時10分を指す）
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx - 25, cy - 20); // 短針
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + 35, cy - 10); // 長針
                ctx.stroke();
                
                ctx.fillStyle = hasColorBorder ? '#ffffff' : '#FFEE11';
                ctx.font = 'bold 18px monospace';
                ctx.fillText('[ TIME_LOCK ]', cx - 60, cy + 80);
            }
            
            ctx.restore();
        }

        // 【手書きサイン＆メッセージ現像 (提案B)】
        // ポラロイドの余白（白い下部エリア）に、手書き落書き＆メッセージがじわじわ現像される
        const textYPos = 940; // 余白の中央位置
        ctx.shadowBlur = 0;
        
        if (activeVocal === 'miku') {
            // ミクサイン ＋ ネギ星マーク
            ctx.fillStyle = hasColorBorder ? '#ffffff' : 'rgba(57, 197, 187, 0.85)';
            ctx.font = 'bold 36px "Brush Script MT", "Caveat", "Comic Sans MS", cursive, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('Miku ♡', photoX + photoW - 50, textYPos);
            
            // ネギ／星マークのドローイング
            ctx.strokeStyle = hasColorBorder ? '#ffffff' : 'rgba(57, 197, 187, 0.7)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            const cx = photoX + photoW - 200;
            const cy = textYPos;
            ctx.moveTo(cx, cy - 15);
            ctx.lineTo(cx + 4, cy - 4);
            ctx.lineTo(cx + 15, cy - 4);
            ctx.lineTo(cx + 6, cy + 4);
            ctx.lineTo(cx + 10, cy + 15);
            ctx.lineTo(cx, cy + 8);
            ctx.lineTo(cx - 10, cy + 15);
            ctx.lineTo(cx - 6, cy + 4);
            ctx.lineTo(cx - 15, cy - 4);
            ctx.lineTo(cx - 4, cy - 4);
            ctx.closePath();
            ctx.stroke();
            
            // ミク一言メッセージ
            ctx.fillStyle = hasColorBorder ? '#ffffff' : '#110805';
            ctx.font = 'bold 24px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('キレイに撮れたね！ 😊💚', photoX + 30, textYPos);
            
        } else if (activeVocal === 'rin') {
            // リンサイン ＋ イナズママーク
            ctx.fillStyle = hasColorBorder ? '#ffffff' : 'rgba(235, 218, 10, 0.9)';
            ctx.font = 'bold 36px "Brush Script MT", "Caveat", "Comic Sans MS", cursive, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('Rin ⚡', photoX + photoW - 50, textYPos);
            
            // イナズマのドローイング
            ctx.strokeStyle = hasColorBorder ? '#ffffff' : 'rgba(235, 218, 10, 0.75)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            const cx = photoX + photoW - 180;
            const cy = textYPos;
            ctx.moveTo(cx - 10, cy - 15);
            ctx.lineTo(cx + 10, cy - 5);
            ctx.lineTo(cx - 8, cy + 2);
            ctx.lineTo(cx + 8, cy + 15);
            ctx.stroke();
            
            // リン一言メッセージ
            ctx.fillStyle = hasColorBorder ? '#ffffff' : '#110805';
            ctx.font = 'bold 24px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('イェイ！最高のシャッターチャンス！ 🍊💛', photoX + 30, textYPos);
            
        } else {
            // デュエットサイン ＋ ダブルハート
            ctx.fillStyle = hasColorBorder ? '#ffffff' : '#B9543C';
            ctx.font = 'bold 32px "Brush Script MT", "Caveat", "Comic Sans MS", cursive, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('Miku & Rin ✨', photoX + photoW - 50, textYPos - 15);
            
            ctx.fillStyle = hasColorBorder ? 'rgba(255, 255, 255, 0.8)' : 'rgba(185, 84, 60, 0.6)';
            ctx.font = 'bold 18px monospace';
            ctx.fillText('MAGICAL MIRAI 2026', photoX + photoW - 50, textYPos + 25);
            
            // ハートマークのドローイング
            ctx.strokeStyle = hasColorBorder ? '#ffffff' : 'rgba(185, 84, 60, 0.7)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            const cx = photoX + photoW - 320;
            const cy = textYPos;
            ctx.arc(cx - 10, cy - 8, 8, Math.PI, 0);
            ctx.arc(cx + 10, cy - 8, 8, Math.PI, 0);
            ctx.lineTo(cx, cy + 12);
            ctx.closePath();
            ctx.stroke();
            
            // デュエット一言メッセージ
            ctx.fillStyle = hasColorBorder ? '#ffffff' : '#110805';
            ctx.font = 'bold 24px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('終わらない瞬間を、いつまでも。 ✨', photoX + 30, textYPos);
        }

        // 【★ベストショット刻印】構図が良く、かつ良い瞬間に撮れた1枚だけ左上に★マークを付与
        if (isBestShot) {
            ctx.save();
            ctx.shadowColor = '#FFEE11';
            ctx.shadowBlur = 16;
            ctx.fillStyle = '#FFEE11';
            ctx.font = 'bold 64px "Inter", "Noto Sans JP", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('★', 22, 48);
            ctx.shadowBlur = 0;
            ctx.font = 'bold 16px monospace';
            ctx.fillText('BEST', 24, 92);
            // 象徴歌詞が映っていた1枚は、その名フレーズを焼き込んで“印象的な瞬間”を明示
            if (signatureLyric.has) {
                ctx.shadowColor = '#FFEE11';
                ctx.shadowBlur = 10;
                ctx.font = 'bold 30px "Inter", "Noto Sans JP", sans-serif';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(`♪ ${signatureLyric.text}`, 22, 138);
            }
            ctx.restore();
        }

        // 【フィルムストリップ記録 ＆ 撮影成果サマリー更新】
        this.totalShots++;
        if (isBestShot) this.starShots++;
        if (isTargetLocked) this.lockShots++;
        this.recordPhotoToFilm(canvas, isBestShot, composition.score, timeStr);
        this.updateResultSummary();

        // 3. 空中ポラロイドのテクスチャ生成。1024フルのままだとGPU/CPUメモリが重く、
        //    新規撮影ごとに既存の全ポラロイドを再焼き付け(drawImage)するため動作が重くなる(#2)。
        //    見栄えを保てる範囲へ縮小したオフキャンバスをテクスチャ＆再焼き付け用に使い、
        //    元1024キャンバスは関数を抜けたらGCされるようにする。
        //    （コンタクトシート用サムネは直前の recordPhotoToFilm が元1024から取得済みで無影響）
        const TEX_SIZE = this.isMobile ? 512 : 768;
        const texCanvas = document.createElement('canvas');
        texCanvas.width = TEX_SIZE;
        texCanvas.height = TEX_SIZE;
        const texCtx = texCanvas.getContext('2d');
        texCtx.imageSmoothingQuality = 'high';
        texCtx.drawImage(canvas, 0, 0, TEX_SIZE, TEX_SIZE);
        const texture = new THREE.CanvasTexture(texCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        const photoMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 1.0, side: THREE.DoubleSide });
        const photoGeo = new THREE.PlaneGeometry(5.85, 4.35); // 枠1.5倍に合わせて 3.9×2.9 ×1.5
        const photoMesh = new THREE.Mesh(photoGeo, photoMat);

        // 撮影の瞬間、カメラの正面(視線方向3)に配置(回り込み対応)
        photoMesh.position.copy(this.camera.position)
            .add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(3));
        photoMesh.quaternion.copy(this.camera.quaternion);
        this.scene.add(photoMesh);

        targetFrame.userData.hasPhoto = true;
        targetFrame.userData.photoImage = texCanvas; // 再焼き付けも縮小版で十分（メモリ・描画コスト削減）

        // 4. 写真がターゲットフレーム（赤い枠）に向けて「スーッと吸い込まれる」トランジションデータを設定
        this.transitioningPhotos.push(photoMesh);
        
        // 撮影の瞬間は目の前に大きく表示させるために初期スケールを拡大（ズームレベルに反比例させて一定の大きさに保つ）
        const initialScale = 1.2 / this.zoomLevel;
        photoMesh.scale.set(initialScale, initialScale, initialScale);
        
        photoMesh.userData = {
            startTime: 0,       // 最初の update 時に Date.now() で初期化し、テクスチャ転送の強烈な初期ラグを完璧に相殺！
            holdDuration: 1000, // 1.0秒間、目の前に大きく静止させて提示する（認識しやすい絶妙な長さに調整）
            duration: 800,      // その後、0.8秒かけてフレームへ吸い込む
            startPos: photoMesh.position.clone(),
            startRot: photoMesh.quaternion.clone(),
            targetFrame: targetFrame
        };
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        window.removeEventListener('resize', this.boundOnResize);
        window.removeEventListener('keydown', this.boundOnKeyDown);

        // 被写体選択中にESCで湖へ戻った場合でも、無効化した再生ボタンを確実に復帰させる
        this.isSelectingCast = false;
        if (this._playBtnEl) {
            this._playBtnEl.style.opacity = '1';
            this._playBtnEl.style.pointerEvents = 'auto';
            this._playBtnEl = null;
        }

        // カメラ首振り ＆ 撮影イベントの確実な解除
        this.songWrapper.removeEventListener('mousedown', this.boundOnMouseDown);
        this.songWrapper.removeEventListener('mousemove', this.boundOnMouseMove);
        window.removeEventListener('mouseup', this.boundOnMouseUp);

        // タッチ首振りイベントの確実な解除
        this.songWrapper.removeEventListener('touchstart', this.boundOnTouchStartCam);
        this.songWrapper.removeEventListener('touchmove', this.boundOnTouchMoveCam);
        this.songWrapper.removeEventListener('touchend', this.boundOnTouchEndCam);
        
        // ズーム用イベントリスナーの確実な解除
        this.songWrapper.removeEventListener('wheel', this.boundOnWheel);
        this.songWrapper.removeEventListener('touchstart', this.boundOnTouchStart);
        this.songWrapper.removeEventListener('touchmove', this.boundOnTouchMove);
        this.songWrapper.removeEventListener('touchend', this.boundOnTouchEnd);
        
        const slider = document.getElementById('shutter-zoom-slider');
        if (slider) {
            slider.removeEventListener('input', this.boundOnSliderInput);
        }
        
        // CSSスタイルの削除
        if (this.customStyleElement && this.customStyleElement.parentNode) {
            this.customStyleElement.parentNode.removeChild(this.customStyleElement);
        }
        
        this.activeSprites.forEach(s => {
            if (s.material.map) s.material.map.dispose();
            s.material.dispose();
        });
        this.activeSprites = [];
        // 事前生成した歌詞テクスチャ(表示中でないものも含む)を全て解放
        // ※表示中スプライトは同じテクスチャを共有している場合があるが、dispose の重複呼び出しは無害
        if (this.lyricTexturesCache) {
            this.lyricTexturesCache.forEach(d => { if (d && d.texture) d.texture.dispose(); });
            this.lyricTexturesCache.clear();
            this.lyricTexturesCache = null;
        }
        
        this.transitioningPhotos.forEach(photo => {
            if (photo.geometry) photo.geometry.dispose();
            if (photo.material) {
                if (photo.material.map) photo.material.map.dispose();
                photo.material.dispose();
            }
            this.scene.remove(photo);
        });
        this.transitioningPhotos = [];
        
        this.frames.forEach(frame => {
            // フレームにはめ込まれた写真がある場合は先にクリーンアップ
            if (frame.userData.photoMesh) {
                const photo = frame.userData.photoMesh;
                if (photo.geometry) photo.geometry.dispose();
                if (photo.material) {
                    if (photo.material.map) photo.material.map.dispose();
                    photo.material.dispose();
                }
                this.scene.remove(photo); // シーンから確実に削除
            }
            
            frame.geometry.dispose();
            frame.material.dispose();
        });
        this.frames = [];
        
        if (this.viewfinder && this.viewfinder.parentNode) {
            this.viewfinder.parentNode.removeChild(this.viewfinder);
        }

        // コンタクトシートDOM・整列タイマー・写真ログの解放
        if (this._csMarkTimers) { this._csMarkTimers.forEach(clearTimeout); this._csMarkTimers = []; }
        clearTimeout(this._poseBtnTimer);
        this.poseOverride = null;
        if (this.poseEditor) { this.poseEditor.destroy(); this.poseEditor = null; }
        if (this.filmStripEl && this.filmStripEl.parentNode) {
            this.filmStripEl.parentNode.removeChild(this.filmStripEl);
        }
        this.filmStripEl = null;
        this.photoLog = [];

        // 湖面・波紋リングの解放（フラグoff時は生成されていないので何もしない）
        this.lakeRipples.forEach((r) => {
            this.scene.remove(r.mesh);
            if (r.mesh.material) r.mesh.material.dispose();
        });
        this.lakeRipples = [];
        if (this._lakeRingGeo) { this._lakeRingGeo.dispose(); this._lakeRingGeo = null; }
        if (this.lakeWater) {
            this.scene.remove(this.lakeWater);
            if (this.lakeWater.geometry) this.lakeWater.geometry.dispose();
            if (this.lakeWater.material) this.lakeWater.material.dispose();
            this.lakeWater = null;
            this.lakeWaterUni = null;
        }
        if (this.lakeMoon) {
            this.scene.remove(this.lakeMoon);
            if (this.lakeMoon.material.map) this.lakeMoon.material.map.dispose();
            this.lakeMoon.material.dispose();
            this.lakeMoon = null;
        }
        if (this.lakeStars) {
            this.scene.remove(this.lakeStars);
            if (this.lakeStars.geometry) this.lakeStars.geometry.dispose();
            if (this.lakeStars.material) this.lakeStars.material.dispose();
            this.lakeStars = null;
        }

        // 被写体MMD（ミク&リン）の完全解放
        this.subjects.forEach((subject) => {
            if (subject.mesh) {
                this.scene.remove(subject.mesh);
                this.disposeMMD(subject.mesh);
            }
        });
        this.subjects = [];
        this.mikuVRM = null;

        // ライトの解放
        if (this.ambientLight) {
            this.scene.remove(this.ambientLight);
            this.ambientLight = null;
        }
        if (this.dirLight) {
            this.scene.remove(this.dirLight);
            this.dirLight = null;
        }

        if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss?.(); }

        super.destroy();
    }
}
