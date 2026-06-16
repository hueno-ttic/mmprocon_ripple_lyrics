// ─────────────────────────────────────────────────────────────
// QUALITY MANAGER — 端末性能に応じた描画品質の自動調整。
//
// 目的: 低スペックなスマホでも動くよう、初期ティアを端末ヒューリスティクスで
//       決め、さらに実FPSを監視して重ければ解像度(pixelRatio)を自動で下げる。
//
// 設計方針:
//  - bloom / shadows / antialias は「作成時」にティアで決める(後から安全に
//    切り替えにくいため)。
//  - pixelRatio だけは「実行時」に動的変更しても安全なので、FPSが落ちたら
//    自動で段階的に下げる(=最も効く軽量化レバー)。
//  - 各レンダラーは毎フレーム quality.maybeApply(renderer, composer) を呼ぶだけ。
//    値が変わった時だけ setPixelRatio が走るので軽い。
// ─────────────────────────────────────────────────────────────

class QualityManager {
    constructor() {
        this.dpr = window.devicePixelRatio || 1;
        this.isMobile = window.innerWidth < 768
            || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

        // ティア(0=最高 … 3=最低)。pr は pixelRatio の上限。
        this.tiers = [
            { name: 'high',   pr: 1.5,  bloom: true,  shadows: true,  antialias: true  },
            { name: 'medium', pr: 1.25, bloom: true,  shadows: false, antialias: false },
            { name: 'low',    pr: 1.0,  bloom: false, shadows: false, antialias: false },
            { name: 'min',    pr: 0.8,  bloom: false, shadows: false, antialias: false },
        ];

        // 端末ヒューリスティクスで初期ティアを推定
        const cores = navigator.hardwareConcurrency || 4;
        const mem = navigator.deviceMemory || 4;   // GB(対応ブラウザのみ)
        let t = 0;
        if (this.isMobile) t = 1;                          // モバイルは中から
        if (this.isMobile && (cores <= 4 || mem <= 4)) t = 2;
        if (cores <= 2 || mem <= 2) t = 3;                 // かなり非力
        this.tierIndex = t;

        // 実行時の追加スケール(FPS監視で 0.6〜1.0 を動かす)
        this.runtimeScale = 1;
        this.floorPr = 0.6;          // これ以下には落とさない(可読性の限界)
        this.manualPr = null;        // デバッグ等で手動固定する場合の実効pixelRatio

        // FPS監視の内部状態
        this._lowMs = 0;             // 連続して重い時間
        this._goodMs = 0;            // 連続して軽い時間
        this._lastT = 0;
        this._fps = 60;
        this._monitorOn = false;

        this._startMonitor();
    }

    get tier() { return this.tiers[this.tierIndex]; }
    get fps() { return this._fps; }
    get auto() { return this.runtimeScale < 0.999; }   // 自動で下げ中か

    // 実効pixelRatio = min(dpr, ティア上限) × 実行時スケール、floorで下限クランプ。
    // 手動固定中(manualPr)はそれを優先し、自動調整は止まる。
    effectivePixelRatio() {
        if (this.manualPr != null) return this.manualPr;
        const base = Math.min(this.dpr, this.tier.pr);
        return Math.max(this.floorPr, base * this.runtimeScale);
    }

    // デバッグHUDから手動でpixelRatioを固定/解除する
    setManualPixelRatio(pr) { this.manualPr = pr; }
    clearManual() { this.manualPr = null; }

    get useBloom() { return this.tier.bloom; }
    get useShadows() { return this.tier.shadows; }
    // antialias はコンテキスト属性で後から変えられないので作成時のみ参照
    get antialias() { return this.tier.antialias; }

    // レンダラーに実効pixelRatioを反映。値が変わった時だけ実処理する。
    maybeApply(renderer, composer) {
        if (!renderer) return;
        const pr = this.effectivePixelRatio();
        if (renderer.__qpr === pr) return;
        renderer.__qpr = pr;
        renderer.setPixelRatio(pr);
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (composer && composer.setSize) {
            composer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    // ─── 自動調整: 実FPSを監視し、重ければ段階的に解像度を下げる ───
    _startMonitor() {
        if (this._monitorOn) return;
        this._monitorOn = true;
        const tick = (now) => {
            if (this._lastT) {
                const dt = now - this._lastT;
                // 背景タブ/一時停止(>200ms)は誤判定を招くので無視
                if (dt > 0 && dt < 200 && !document.hidden) {
                    this._fps += (1000 / dt - this._fps) * 0.1;   // 平滑FPS
                    this._evaluate(dt);
                } else {
                    this._lowMs = 0; this._goodMs = 0;
                }
            }
            this._lastT = now;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    _evaluate(dt) {
        if (this.manualPr != null) return;   // 手動固定中は自動調整しない
        const fps = this._fps;
        // 重い: 45fps未満が1.2秒続いたら1段階下げる
        if (fps < 45) {
            this._lowMs += dt; this._goodMs = 0;
            if (this._lowMs > 1200 && this.runtimeScale > this.floorPr) {
                this.runtimeScale = Math.max(0.55, this.runtimeScale - 0.15);
                this._lowMs = 0;
            }
        // 軽い: 57fps超が4秒続いたら少しだけ戻す(振動を避け控えめに)
        } else if (fps > 57) {
            this._goodMs += dt; this._lowMs = 0;
            if (this._goodMs > 4000 && this.runtimeScale < 1) {
                this.runtimeScale = Math.min(1, this.runtimeScale + 0.1);
                this._goodMs = 0;
            }
        } else {
            this._lowMs = 0; this._goodMs = 0;
        }
    }
}

export const quality = new QualityManager();
