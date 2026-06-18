/**
 * VRM共通ユーティリティ
 */

/**
 * SpringBone（ツインテール等の揺れ物）を現在のポーズ・スケールの静止状態へ落ち着かせる。
 *
 * VRMロード直後はSpringBoneの初期状態が「スケール1・素のポーズ」で確定している。
 * その後に `vrm.scene.scale.setScalar(...)` で拡大したりポーズを当てると、保持している
 * 静止長と実ワールド座標が食い違い、最初の `vrm.update()` でツインテールが大きく跳ね上がって
 * （逆立って）から徐々に正しい位置へ収束する——という見栄えの悪い挙動になる。
 *
 * 拡大・初期ポーズ適用後にこれを呼ぶと、SpringBoneを最終的なポーズ/スケールの静止状態へ
 * スナップさせ、開幕時の暴れを防ぐ。
 *
 * @param {import('@pixiv/three-vrm').VRM} vrm
 */
export function settleSpringBones(vrm) {
    if (!vrm) return;
    // 法線化ヒューマノイドの初期ポーズを生スケルトンへ反映（時間ステップ0で揺れは動かさない）
    if (typeof vrm.update === 'function') vrm.update(0);
    // 拡大・ポーズ適用後のワールド行列を確定させる
    if (vrm.scene) vrm.scene.updateMatrixWorld(true);
    // SpringBoneを現在の静止状態へスナップ（保持中の前フレーム座標をリセット）
    if (vrm.springBoneManager) vrm.springBoneManager.reset();
}
