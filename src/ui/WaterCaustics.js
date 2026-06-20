// ─────────────────────────────────────────────────────────────
// WaterCaustics — タイトル背景の水面(コースティクス)を WebGL の
//   フラグメントシェーダで描く。屈折で揺らぐ水面の「波打ち」を
//   ピクセル単位でGPU計算するため、CSSの feDisplacementMap のように
//   毎フレーム大面積をCPUで歪ませる必要がなく、50–60fps を保てる。
//
// ・パターンはコースティクス(TDM系)を低速・大波長に調整=ゆったり波打つ。
// ・バッキングストアを縮小(SCALE)してフラグメント数を抑える(水面は少し
//   ぼけても自然)。
// ・WebGL不可の環境では ok=false を返し、呼び出し側でCSSフォールバック。
// ─────────────────────────────────────────────────────────────

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const RIPPLES = 5;   // 同時に走らせられるタップ波紋の最大数

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec2  uRippleOrigin[${RIPPLES}];  // 波紋の中心(uv, y上向き)
uniform float uRippleStart[${RIPPLES}];   // 波紋の発生時刻(uTime基準/秒)

// コースティクス(屈折で揺らぐ水面の光) — 反復5回でGPU的に安価。
// time を小さく進める=ゆっくり/低周波。uv のスケールを小さく=大波長。
float caustic(vec2 uv) {
    float time = uTime * 0.16 + 23.0;   // 0.16 = ゆったりした流れ(低周波)
    vec2 p = mod(uv * 6.28318530718 * 0.95, 6.28318530718) - 250.0; // 0.95 = 大波長
    vec2 i = p;
    float c = 1.0;
    const float inten = 0.0045;
    for (int n = 0; n < 5; n++) {
        float t = time * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(t - i.x) + sin(t + i.y),
                     sin(t - i.y) + cos(t + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten),
                               p.y / (cos(i.y + t) / inten)));
    }
    c /= 5.0;
    c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 7.0);
}

void main() {
    float aspect = uRes.x / uRes.y;
    vec2 baseUv = gl_FragCoord.xy / uRes.xy;   // 0..1, y上向き

    // ── タップ波紋: 中心から拡大する同心円波。caustics の uv を屈折させ稜線を光らせる ──
    vec2 disp = vec2(0.0);
    float crest = 0.0;
    for (int k = 0; k < ${RIPPLES}; k++) {
        float age = uTime - uRippleStart[k];
        if (age < 0.0 || age > 2.0) continue;    // 寿命2.0秒
        vec2 d = baseUv - uRippleOrigin[k];
        d.x *= aspect;
        float dist = length(d);
        float radius = age * 0.95;               // 波面の拡大速度(ゆったり)
        float w = dist - radius;                 // 波面からの距離(<0=内側)
        float trail = exp(-age * 1.35);          // 時間減衰
        // 波面の後方に数本の同心リングが連なる波列(前方=外側はすぐ減衰)
        float band = exp(-(w * w) * 11.0) * (w < 0.0 ? 1.0 : 0.35);
        float ripple = sin(w * 50.0) * band * trail;
        vec2 dir = dist > 1e-4 ? d / dist : vec2(0.0);
        disp += dir * ripple;
        crest += max(ripple, 0.0) * trail;
    }

    vec2 uv = baseUv + disp * 0.075;   // 波面でcausticsを屈折(屈折量を強め)
    uv.x *= aspect;                    // セルを正方に保つ(縦長でも崩れない)

    float bright = caustic(uv);

    // 湖面の配色: 深い青 → 明るいシアンの光条
    vec3 deep  = vec3(0.13, 0.38, 0.58);
    vec3 light = vec3(0.78, 0.93, 1.0);
    vec3 col = mix(deep, light, clamp(bright, 0.0, 1.0));

    // 波紋の稜線を発光させる(同心リングの光)
    col += crest * vec3(0.55, 0.74, 0.92) * 1.25;

    // 周辺をわずかに沈めて中央へ視線を集める
    float vig = smoothstep(0.95, 0.25, length(baseUv - 0.5));
    col *= mix(0.82, 1.0, vig);

    gl_FragColor = vec4(col, 0.92);
}
`;

const SCALE = 0.6;        // バッキングストア縮小率(水面は少しぼけても自然)
const MAX_DPR = 1.25;     // 高密度端末での過負荷を抑える

export class WaterCaustics {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText =
            'position:absolute; inset:0; width:100%; height:100%; ' +
            'z-index:0; pointer-events:none; display:block;';

        const opts = { antialias: false, alpha: true, premultipliedAlpha: false,
                       depth: false, stencil: false, powerPreference: 'high-performance' };
        this.gl = this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts);
        this.ok = !!this.gl;
        this._raf = 0;
        this._t0 = 0;
        this._w = 0;
        this._h = 0;
        this._loop = this._loop.bind(this);

        if (this.ok) {
            try { this._init(); }
            catch (e) { this.ok = false; }
        }
    }

    _compile(type, src) {
        const gl = this.gl;
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
        }
        return sh;
    }

    _init() {
        const gl = this.gl;
        const prog = gl.createProgram();
        gl.attachShader(prog, this._compile(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, this._compile(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(prog) || 'program link failed');
        }
        gl.useProgram(prog);
        this.prog = prog;

        // 画面全体を覆う1枚の大三角形
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        this.uRes = gl.getUniformLocation(prog, 'uRes');
        this.uTime = gl.getUniformLocation(prog, 'uTime');

        // タップ波紋のリングバッファ(最大 RIPPLES 個)。startを過去遠方にして全て非アクティブに。
        this.uRippleOrigin = gl.getUniformLocation(prog, 'uRippleOrigin[0]');
        this.uRippleStart = gl.getUniformLocation(prog, 'uRippleStart[0]');
        this._origins = new Float32Array(RIPPLES * 2);
        this._starts = new Float32Array(RIPPLES);
        this._starts.fill(-999);
        this._next = 0;
        gl.uniform2fv(this.uRippleOrigin, this._origins);
        gl.uniform1fv(this.uRippleStart, this._starts);
    }

    // タップ波紋を追加。nx,ny はキャンバス左上原点の正規化座標(0..1)。
    addRipple(nx, ny) {
        if (!this.ok) return;
        const k = this._next;
        this._origins[k * 2] = nx;
        this._origins[k * 2 + 1] = 1.0 - ny;   // GLは下原点なのでyを反転
        this._starts[k] = (performance.now() - this._t0) / 1000;
        this._next = (this._next + 1) % RIPPLES;
        this.gl.uniform2fv(this.uRippleOrigin, this._origins);
        this.gl.uniform1fv(this.uRippleStart, this._starts);
    }

    // 指定点(nx,ny=キャンバス左上原点の0..1)での波の高さをCPU側で再現して返す。
    // シェーダの波紋と同じ式で、DOM(タイトル文字)を波面に合わせて動かすのに使う。
    // freq を小さくすると、細かいリングではなく「波面が通過するうねり」になる(文字向け)。
    sampleHeight(nx, ny, freq, bandK) {
        if (!this.ok) return 0;
        freq = freq || 50.0;
        bandK = bandK || 11.0;
        const aspect = (this._w || 1) / (this._h || 1);
        const T = (performance.now() - this._t0) / 1000;
        let h = 0;
        for (let k = 0; k < RIPPLES; k++) {
            const age = T - this._starts[k];
            if (age < 0 || age > 2.0) continue;
            let dx = nx - this._origins[k * 2];
            let dy = (1 - ny) - this._origins[k * 2 + 1];   // GLは下原点
            dx *= aspect;
            const dist = Math.hypot(dx, dy);
            const w = dist - age * 0.95;                    // 波面からの距離
            const trail = Math.exp(-age * 1.35);
            const band = Math.exp(-(w * w) * bandK) * (w < 0 ? 1.0 : 0.35);
            h += Math.sin(w * freq) * band * trail;
        }
        return h;
    }

    _ensureSize() {
        const gl = this.gl;
        const cw = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 0;
        const ch = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 0;
        if (!cw || !ch) return false;
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const w = Math.max(2, Math.round(cw * dpr * SCALE));
        const h = Math.max(2, Math.round(ch * dpr * SCALE));
        if (w !== this._w || h !== this._h) {
            this._w = w; this._h = h;
            this.canvas.width = w;
            this.canvas.height = h;
            gl.viewport(0, 0, w, h);
            gl.uniform2f(this.uRes, w, h);
        }
        return true;
    }

    _draw(timeSec) {
        const gl = this.gl;
        gl.uniform1f(this.uTime, timeSec);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _loop(now) {
        if (!this.ok) return;
        if (this._ensureSize()) this._draw((now - this._t0) / 1000);
        this._raf = requestAnimationFrame(this._loop);
    }

    start() {
        if (!this.ok || this._raf) return;
        this._t0 = performance.now();
        // 初回は即時に1枚描く(rAFがthrottleされる環境でも静止画は出る)
        if (this._ensureSize()) this._draw(0);
        this._raf = requestAnimationFrame(this._loop);
    }

    // 検証用: 指定時刻のフレームを描画(プレビューでの位相スクラブに使う)
    renderAt(timeSec) {
        if (!this.ok) return;
        if (this._ensureSize()) this._draw(timeSec);
    }

    stop() {
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        if (this.gl) {
            const lose = this.gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        }
    }
}
