// WeakMap caches keyed by phrase objects — automatically GC'd when phrases are released
const _cache = new WeakMap();
const _mergedCache = new WeakMap(); // phrase -> Map<minLength, groups>

function isAttachToPrev(word) {
    if (word.pos) {
        const pos = word.pos;
        if (pos.startsWith('助詞') || pos.startsWith('助動詞')) return true;
        if (pos.startsWith('接尾辞') || pos.startsWith('接尾') || pos.startsWith('記号')) return true;
    }
    const ATTACH = new Set([
        'は', 'が', 'を', 'に', 'で', 'と', 'も', 'か', 'の', 'へ', 'や',
        'から', 'まで', 'より', 'など', 'だけ', 'しか', 'ほど', 'くらい', 'ばかり',
        'て', 'ば', 'ながら', 'ので', 'のに', 'けど', 'けれど', 'けれども',
        'って', 'とか', 'でも', 'なんか', 'なんて', 'たり', 'し',
        'ね', 'よ', 'わ', 'ぞ', 'ぜ', 'さ', 'な', 'よね',
        'た', 'だ', 'ます', 'ません', 'ました', 'です', 'でした', 'ない', 'たい',
    ]);
    return ATTACH.has(word.text);
}

/**
 * Group a phrase's words so that particles / auxiliary verbs attach to the
 * preceding content word.  Returns Array<{text, startTime, endTime}>.
 * Results are cached by phrase object (WeakMap).
 */
export function groupPhraseWords(phrase) {
    if (_cache.has(phrase)) return _cache.get(phrase);

    const groups = [];
    let current = null;
    let w = phrase.firstWord;
    let prev = null;
    while (w && w.parent === phrase) {
        // 名詞の連続（「シャッター」＋「チャンス」など）を結合して1つの複合名詞にする例外処理を追加
        const isNounConnection = prev && prev.pos && prev.pos.startsWith('名詞') && w.pos && w.pos.startsWith('名詞');
        
        if (!current || (!isAttachToPrev(w) && !isNounConnection)) {
            current = { text: w.text, startTime: w.startTime, endTime: w.endTime };
            groups.push(current);
        } else {
            current.text += w.text;
            current.endTime = w.endTime;
        }
        prev = w;
        w = w.next;
    }

    _cache.set(phrase, groups);
    return groups;
}

/**
 * Given a pre-built groups array and a word, return the group that contains
 * the word (matched by startTime range).
 */
export function findGroupForWord(groups, word) {
    // 境界の重なり（前の終了時間と次の開始時間が完全に等しい場合）による誤マッチを回避するため、
    // グループ終了時間の比較を「以下 (<=)」から「未満 (<)」へ変更。これで特定の単語（チャンス、だってなど）が
    // 前の単語グループへ誤って重複判定されスポーンがスキップされてしまう深刻なタイム境界バグを100%解決。
    const hit = groups.find(g => g.startTime <= word.startTime && word.startTime < g.endTime);
    if (hit) return hit;
    // フォールバック: 単語より前に始まった「最後の」グループ(先頭グループを返さないよう末尾から探す。
    // 旧iOS Safari 対応のため Array.prototype.findLast は使わない)
    for (let i = groups.length - 1; i >= 0; i--) {
        if (groups[i].startTime <= word.startTime) return groups[i];
    }
    return null;
}

/**
 * Like groupPhraseWords, but keeps merging adjacent groups until each chunk
 * is at least minLength characters long.  Useful for display systems that
 * look bad with very short strings (e.g. TAKEOVER's scramble targets).
 * Results are cached per (phrase, minLength) pair.
 */
export function groupPhraseWordsByMinLength(phrase, minLength = 8) {
    if (!_mergedCache.has(phrase)) _mergedCache.set(phrase, new Map());
    const byLen = _mergedCache.get(phrase);
    if (byLen.has(minLength)) return byLen.get(minLength);

    const base = groupPhraseWords(phrase);
    const merged = [];
    let current = null;

    for (const g of base) {
        if (!current) {
            current = { text: g.text, startTime: g.startTime, endTime: g.endTime };
        } else if (current.text.length < minLength) {
            current.text += g.text;
            current.endTime = g.endTime;
        } else {
            merged.push(current);
            current = { text: g.text, startTime: g.startTime, endTime: g.endTime };
        }
    }
    if (current) merged.push(current);

    byLen.set(minLength, merged);
    return merged;
}
