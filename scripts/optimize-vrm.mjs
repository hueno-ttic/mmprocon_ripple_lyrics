// ─────────────────────────────────────────────────────────────
// VRM テクスチャ最適化（外科的リパッカー）
//
// 目的: ミク/リンの VRM(17MB/15MB) のロード時間・メモリを削減する。
//   テクスチャの大半が 2048×2048 PNG で、画面表示サイズに対し過剰なため、
//   長辺を 1024px(サムネイルは 256px)へリサイズして再エンコードする。
//
// なぜ gltf-transform を使わないか:
//   この VRM は VRM 0.x(`VRM` 拡張)で、gltf-transform はこの拡張を理解できず、
//   読み書きするだけで MToon マテリアル/スプリングボーン/表情を**破棄**してしまう。
//   そこで JSON(VRM 拡張・テクスチャ index)は一切変更せず、画像バイトだけを
//   差し替える GLB リパッカーを自前で実装している。images/textures/materials/
//   accessors/bufferView の数と index は原本と完全一致を保つ(= 破綻しない)。
//
// 内容の改変はしない: リサイズ(縮小)と PNG ロスレス再エンコードのみ。AI 等で
//   生成・加筆はしていない(レギュレーション: 公式素材・AI生成物を出力に使わない)。
//
// 使い方:
//   npm i -D sharp           # ビルド時のみ・アプリには同梱されない
//   node scripts/optimize-vrm.mjs <input.vrm> <output.vrm> [maxPx=1024]
//   # 例) 原本を別名で保管してから上書き最適化する運用を推奨
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, statSync } from 'fs';
import sharp from 'sharp';

const MAGIC = 0x46546c67, JSON_T = 0x4e4f534a, BIN_T = 0x004e4942;
const pad4 = (n) => (n % 4 ? 4 - (n % 4) : 0);

function parseGLB(path) {
    const buf = readFileSync(path);
    if (buf.readUInt32LE(0) !== MAGIC) throw new Error('not a GLB/VRM');
    let off = 12, json = null, bin = null;
    while (off < buf.length) {
        const cLen = buf.readUInt32LE(off), cType = buf.readUInt32LE(off + 4);
        const data = buf.subarray(off + 8, off + 8 + cLen);
        if (cType === JSON_T) json = JSON.parse(data.toString('utf8'));
        if (cType === BIN_T) bin = Buffer.from(data);
        off += 8 + cLen + pad4(cLen);
    }
    return { json, bin };
}

async function optimize(src, dst, cap = 1024, thumbCap = 256) {
    const { json, bin } = parseGLB(src);
    if ((json.buffers || []).length !== 1 || json.buffers[0].uri) {
        throw new Error('単一の埋め込みバッファ(GLB)を想定');
    }
    const bvs = json.bufferViews;
    const imgBV = new Map();
    json.images.forEach((im, i) => imgBV.set(im.bufferView, i));

    // VRM 0.x のサムネイルは meta.texture(テクスチャ index)→ image index
    let thumbImg = -1;
    const metaTex = json.extensions?.VRM?.meta?.texture;
    if (metaTex != null && json.textures?.[metaTex]) thumbImg = json.textures[metaTex].source;

    const replace = new Map();
    for (const [bvIdx, imgIdx] of imgBV) {
        const v = bvs[bvIdx];
        const bytes = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
        const meta = await sharp(bytes).metadata();
        const limit = imgIdx === thumbImg ? thumbCap : cap;
        let pipe = sharp(bytes);
        if (Math.max(meta.width, meta.height) > limit) {
            pipe = pipe.resize({
                width: meta.width >= meta.height ? limit : null,
                height: meta.height > meta.width ? limit : null,
                fit: 'inside', withoutEnlargement: true,
            });
        }
        // PNG ロスレス維持(アルファ/法線マップを劣化させない)。縮小しても小さくならない
        // 画像は原本バイトを温存する。
        const out = await pipe.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
        replace.set(bvIdx, out.length < bytes.length ? out : Buffer.from(bytes));
    }

    // bufferView 単位で詰め直し(4バイト境界)。accessor は bufferView 相対なので無影響。
    const chunks = []; let cursor = 0;
    for (let i = 0; i < bvs.length; i++) {
        const v = bvs[i];
        const data = replace.has(i)
            ? replace.get(i)
            : bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
        v.byteOffset = cursor;
        v.byteLength = data.length;
        chunks.push(data); cursor += data.length;
        const p = pad4(cursor); if (p) { chunks.push(Buffer.alloc(p)); cursor += p; }
    }
    const newBin = Buffer.concat(chunks);
    json.buffers[0].byteLength = newBin.length;

    let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
    const jpad = pad4(jsonBuf.length); if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
    const bpad = pad4(newBin.length);
    const binOut = bpad ? Buffer.concat([newBin, Buffer.alloc(bpad, 0)]) : newBin;
    const total = 12 + 8 + jsonBuf.length + 8 + binOut.length;
    const head = Buffer.alloc(12);
    head.writeUInt32LE(MAGIC, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(JSON_T, 4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(binOut.length, 0); bh.writeUInt32LE(BIN_T, 4);
    writeFileSync(dst, Buffer.concat([head, jh, jsonBuf, bh, binOut]));

    console.log(`${src} -> ${dst}: ${(statSync(src).size / 1048576).toFixed(2)}MB -> ${(statSync(dst).size / 1048576).toFixed(2)}MB`);
}

const [, , src, dst, cap] = process.argv;
if (!src || !dst) {
    console.error('usage: node scripts/optimize-vrm.mjs <input.vrm> <output.vrm> [maxPx=1024]');
    process.exit(1);
}
await optimize(src, dst, cap ? Number(cap) : 1024);
