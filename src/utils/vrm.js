/**
 * VRM共通ユーティリティ
 */
import { VRMUtils } from '@pixiv/three-vrm';

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

/**
 * SpringBoneのシミュレーション基準（center）をモデルのルートへ固定する。
 *
 * three-vrmのSpringBoneは既定で「ワールド空間」で揺れを計算するため、
 * `vrm.scene.position` でミクを画面内へ大きく移動（タップ移動など）させると、
 * その並進速度が髪への慣性として働き、ツインテールが逆立つように跳ねてしまう。
 *
 * 各ジョイントの center をモデルのルート（既定で `vrm.scene`）に設定すると、
 * 揺れは center 空間で計算され、モデル全体の並進・回転は揺れに影響しなくなる。
 * これによりタップ移動でツインテールが暴れず、腕や体のローカルなポーズ変化にのみ
 * 自然に追従する。
 *
 * @param {import('@pixiv/three-vrm').VRM} vrm
 * @param {import('three').Object3D} [center] 基準ノード（省略時は vrm.scene）
 */
export function anchorSpringBonesToModel(vrm, center) {
    if (!vrm || !vrm.springBoneManager) return;
    const anchor = center || vrm.scene;
    if (!anchor) return;
    for (const joint of vrm.springBoneManager.joints) {
        joint.center = anchor;
    }
    // center 変更後は前フレーム座標が旧空間のままなので静止状態へスナップし直す
    vrm.springBoneManager.reset();
}

/**
 * マテリアルが参照するテクスチャ（map / normalMap / emissiveMap / MToonの各種マップ等、
 * `.isTexture` な値すべて。ShaderMaterialは uniforms 内のテクスチャも含む）を解放してから
 * マテリアル本体を解放する。
 *
 * @param {import('three').Material} m
 */
function disposeMaterialDeep(m) {
    if (!m) return;
    for (const value of Object.values(m)) {
        if (value && value.isTexture) value.dispose();
    }
    if (m.uniforms) {
        for (const uniform of Object.values(m.uniforms)) {
            const v = uniform && uniform.value;
            if (v && v.isTexture) v.dispose();
        }
    }
    if (typeof m.dispose === 'function') m.dispose();
}

/**
 * VRM（`gltf.userData.vrm`）が保持するGPUリソースを一括解放する共通処理。
 *
 * - `vrm.scene` 配下のジオメトリを解放
 * - 各メッシュのマテリアル（配列/単体）と、シルエット差し替え等で
 *   `userData._origMat` に退避してある元マテリアルも、テクスチャごと解放
 * - `skipMaterials` に含まれるマテリアル（曲側で共有しているシルエット材質など）は
 *   解放しない（呼び出し側の destroy で一度だけ解放する想定）
 * - 最後に three-vrm の `VRMUtils.deepDispose` があれば呼び、スケルトン等の取りこぼしも解放する
 *
 * シーンからの取り外し（`scene.remove(vrm.scene)`）は行わないので呼び出し側で行うこと。
 * null 渡し・二重呼び出しでも安全（three.js の dispose は冪等）。
 *
 * @param {import('@pixiv/three-vrm').VRM | null | undefined} vrm
 * @param {{ skipMaterials?: Array<import('three').Material | null | undefined> }} [options]
 */
export function disposeVRM(vrm, { skipMaterials = [] } = {}) {
    if (!vrm || !vrm.scene) return;
    const skip = new Set(skipMaterials.filter(Boolean));
    const toArray = (v) => (Array.isArray(v) ? v : [v]);

    vrm.scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        const mats = [];
        if (obj.material) mats.push(...toArray(obj.material));
        if (obj.userData && obj.userData._origMat) mats.push(...toArray(obj.userData._origMat));
        mats.forEach((m) => {
            if (!m || skip.has(m)) return;
            disposeMaterialDeep(m);
        });
    });

    // three-vrm の deepDispose でスケルトン（ボーンテクスチャ）等も解放する。
    // deepDispose は obj.material を無条件に解放するため、共有材質（skipMaterials）を
    // 割り当て中のメッシュは一時的に外してから呼び、終わったら元に戻す。
    if (VRMUtils && typeof VRMUtils.deepDispose === 'function') {
        const restore = [];
        if (skip.size) {
            vrm.scene.traverse((obj) => {
                if (!obj.material) return;
                if (Array.isArray(obj.material)) {
                    if (obj.material.some((m) => skip.has(m))) {
                        restore.push([obj, obj.material]);
                        obj.material = obj.material.filter((m) => !skip.has(m));
                    }
                } else if (skip.has(obj.material)) {
                    restore.push([obj, obj.material]);
                    obj.material = null;
                }
            });
        }
        try {
            VRMUtils.deepDispose(vrm.scene);
        } finally {
            restore.forEach(([obj, mat]) => { obj.material = mat; });
        }
    }
}
