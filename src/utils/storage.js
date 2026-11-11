/**
 * localStorage の安全ラッパー。
 *
 * Safari のプライベートブラウズやストレージブロック環境では localStorage への
 * アクセス自体が SecurityError / QuotaExceededError を投げる。また保存値が壊れていると
 * JSON.parse が例外を投げる。どちらもアプリ全体(起動時の appState 初期化や、
 * 暗転カーテン中のコールバック)を止めかねないので、ここで握りつぶして既定値へ倒す。
 * 永続化はあくまで「あれば嬉しい」扱いで、失敗しても体験は継続させる。
 */

/** 値を取得。取得できない環境では fallback(既定 null)を返す。 */
export function safeGet(key, fallback = null) {
    try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
    } catch (e) {
        return fallback;
    }
}

/** 値を保存。成功したら true。失敗(容量超過・ブロック)は false で黙って返す。 */
export function safeSet(key, value) {
    try {
        localStorage.setItem(key, String(value));
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * JSON として取得。未保存・壊れたJSON・ストレージ不可のときは fallback を返す。
 * validate を渡すと、パース結果がそれを満たさない場合も fallback に倒す
 * (例: 配列であるべき値が壊れてオブジェクトになっていた等)。
 */
export function safeGetJSON(key, fallback = null, validate = null) {
    const raw = safeGet(key, null);
    if (raw === null) return fallback;
    try {
        const v = JSON.parse(raw);
        if (validate && !validate(v)) return fallback;
        return v;
    } catch (e) {
        return fallback;
    }
}

/** JSON として保存。成功したら true。 */
export function safeSetJSON(key, value) {
    try {
        return safeSet(key, JSON.stringify(value));
    } catch (e) {
        return false; // 循環参照など stringify 失敗
    }
}
