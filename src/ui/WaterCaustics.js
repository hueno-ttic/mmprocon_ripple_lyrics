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

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;

// コースティクス(屈折で揺らぐ水面の光) — 反復5回でGPU的に安価。
// time を小さく進める=ゆっくり/低周波。uv のスケールを小さく=大波長。
void main() {
    vec2 uv = gl_FragCoord.xy / uRes.xy;
    uv.x *= uRes.x / uRes.y;            // セルを正方に保つ(縦長でも崩れない)

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
    float bright = pow(abs(c), 7.0);

    // 湖面の配色: 深い青 → 明るいシアンの光条
    vec3 deep  = vec3(0.13, 0.38, 0.58);
    vec3 light = vec3(0.78, 0.93, 1.0);
    vec3 col = mix(deep, light, clamp(bright, 0.0, 1.0));

    // 周辺をわずかに沈めて中央へ視線を集める
    vec2 q = gl_FragCoord.xy / uRes.xy - 0.5;
    float vig = smoothstep(0.95, 0.25, length(q));
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
