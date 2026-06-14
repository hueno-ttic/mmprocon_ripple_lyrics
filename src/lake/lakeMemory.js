// 湖のメモリ — ユーザーの創作を「波紋」として湖に堆積・循環させる最小基盤。
//
// 思想: 各曲でユーザーが生んだもの(問い・色・言葉…)を波紋として localStorage に積み、
// あとで同じ曲・湖の中に再来させる。これにより「自分の創作が次の創作を呼ぶ」
// という創作文化の循環を、サーバなし(ローカル完結)で擬似的に成立させる。
//
// 1つの波紋(ripple):
//   { id, songId, type, text, color, meta, createdAt }
//     - songId: どの曲で生まれたか ('kotaete' 等)
//     - type:   波紋の種類 ('question' 等)。曲ごとに自由
//     - text:   ユーザーが綴った言葉(問いなど)
//     - color:  その波紋を象徴する色(#rrggbb)
//     - meta:   曲固有の付随データ(任意)

const STORAGE_KEY = 'lakeSonare.ripples.v1';
const MAX_RIPPLES = 80; // 古いものから捨てる上限(localStorage肥大の保険)

function loadAll() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch (e) {
        console.warn('[lakeMemory] load failed, resetting:', e);
        return [];
    }
}

function saveAll(list) {
    try {
        // 上限を超えたら古いものから捨てる
        const trimmed = list.slice(-MAX_RIPPLES);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn('[lakeMemory] save failed:', e);
    }
}

/**
 * 波紋を湖に流す(堆積させる)。
 * @param {{songId:string, type?:string, text?:string, color?:string, meta?:object}} ripple
 * @returns {object} 保存された波紋(id/createdAt付き)
 */
export function addRipple(ripple) {
    const list = loadAll();
    const entry = {
        id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        createdAt: Date.now(),
        type: 'ripple',
        text: '',
        color: '#7F77DD',
        meta: {},
        ...ripple,
    };
    list.push(entry);
    saveAll(list);
    return entry;
}

/**
 * 湖の波紋を取り出す。
 * @param {{songId?:string, type?:string, limit?:number}} [opts]
 * @returns {Array} 古い順の波紋配列(limit指定時は新しい方からlimit件)
 */
export function getRipples(opts = {}) {
    let list = loadAll();
    if (opts.songId) list = list.filter(r => r.songId === opts.songId);
    if (opts.type) list = list.filter(r => r.type === opts.type);
    if (opts.limit && list.length > opts.limit) list = list.slice(-opts.limit);
    return list;
}

/** 条件に合う波紋の数を返す。 */
export function countRipples(opts = {}) {
    return getRipples(opts).length;
}

/** すべての波紋を消す(デバッグ/リセット用)。 */
export function clearRipples() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.warn('[lakeMemory] clear failed:', e);
    }
}
