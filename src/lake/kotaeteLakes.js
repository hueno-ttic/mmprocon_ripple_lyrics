import * as THREE from 'three';

/**
 * こたえて: 到達する「ゴールの湖」背景。
 *
 * design_drafts の Three.js 実装を、回廊シーンのカメラ枠(視点 y≈2 / -z を僅かに見下ろし /
 * FOV75 / group は毎フレーム camera.z へ追従)へ作り直したもの。
 *   - buildBrightLake … 「Three.jsイラスト実装リクエスト（明るい湖）」= 晴天の湖(光の森)
 *   - buildNightLake  … 「夜の湖をThree.jsで表現」= 夜空の湖
 *
 * いずれも env グループに実体(空ドーム/森/水面/草/星/蛍 など)を構築し、
 * items[].update(now, dt, fade) でフェード(0→1)と時間アニメを駆動する。
 * 共有シーンに2台目のレンダラ/反射RTは持ち込めないため、水面の映り込みは
 * 反射RTを使わずシェーダ内で手続き的に近似している(空色の縦グラデ + 月/光の輝線)。
 *
 * group は _buildEnvironment 側で scene へ追加・z追従・破棄される。
 * 各 item に dispose() があれば _disposeEnv が呼ぶ(シェーダ uniform のテクスチャ解放用)。
 */

const WY = -2.0; // 水面の高さ(回廊の床と同じ)

// ---------------------------------------------------------------------------
// テクスチャ生成ヘルパ(design_drafts より移植)
// ---------------------------------------------------------------------------
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const rnd = (a, b) => a + Math.random() * (b - a);

// 幹: 縦に伸びる柔らかな木肌(上下を透過でフェード)
function trunkTex() {
    const c = cv(96, 512), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 96, 0);
    g.addColorStop(0.0, 'rgba(70,100,82,0)');
    g.addColorStop(0.18, 'rgba(120,150,128,0.85)');
    g.addColorStop(0.42, 'rgba(196,214,190,1)');
    g.addColorStop(0.6, 'rgba(170,192,168,1)');
    g.addColorStop(0.82, 'rgba(108,140,116,0.85)');
    g.addColorStop(1.0, 'rgba(70,100,82,0)');
    x.fillStyle = g; x.fillRect(0, 0, 96, 512);
    x.globalAlpha = 0.25; x.strokeStyle = 'rgba(60,90,70,1)'; x.lineWidth = 2;
    for (let i = 0; i < 5; i++) { const px = rnd(20, 76); x.beginPath(); x.moveTo(px, 0); x.bezierCurveTo(px + rnd(-8, 8), 170, px + rnd(-8, 8), 340, px + rnd(-6, 6), 512); x.stroke(); }
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in';
    const gv = x.createLinearGradient(0, 0, 0, 512);
    gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(0.12, 'rgba(0,0,0,1)');
    gv.addColorStop(0.9, 'rgba(0,0,0,1)'); gv.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gv; x.fillRect(0, 0, 96, 512);
    return ctex(c);
}

// 葉の塊(点描を重ねた柔らかな葉群)
function dabCluster(w, h, palette, opts) {
    const c = cv(w, h), x = c.getContext('2d');
    const cx = w / 2, cy = h * (opts.cy ?? 0.5), rx = w * (opts.rx ?? 0.46), ry = h * (opts.ry ?? 0.46);
    const n = opts.n ?? 260;
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.6);
        let dx = Math.cos(a) * r * rx, dy = Math.sin(a) * r * ry;
        if (opts.bottomHeavy) dy = Math.abs(dy) * 0.6 + dy * 0.4;
        const px = cx + dx, py = cy + dy;
        const rad = rnd(opts.minR ?? 10, opts.maxR ?? 30);
        const col = palette[(Math.random() * palette.length) | 0];
        const edge = 1 - r;
        const g = x.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, 'rgba(' + col + ',' + (0.5 * edge + 0.15) + ')');
        g.addColorStop(1, 'rgba(' + col + ',0)');
        x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
    }
    return ctex(c);
}
function canopyTex() { return dabCluster(640, 512, ['90,210,118', '70,190,104', '150,235,160', '46,160,96', '120,224,140'], { n: 340, rx: 0.48, ry: 0.44, minR: 14, maxR: 46 }); }
function bushTex() { return dabCluster(512, 320, ['170,212,92', '130,196,72', '210,232,130', '96,170,70', '188,220,108'], { n: 300, cy: 0.42, rx: 0.48, ry: 0.5, minR: 12, maxR: 40, bottomHeavy: true }); }

// 神々しい光の筋(縦に伸びる発光帯)
function rayTex() {
    const c = cv(128, 512), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 512);
    x.globalCompositeOperation = 'destination-in';
    const gv = x.createLinearGradient(0, 0, 0, 512);
    gv.addColorStop(0, 'rgba(0,0,0,1)'); gv.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gv; x.fillRect(0, 0, 128, 512);
    return ctex(c);
}

// 草の葉(夜の湖の手前に立つ草むら)
function grassTex() {
    const s = 64, c = cv(s, s), x = c.getContext('2d');
    x.filter = 'blur(0.5px)'; x.strokeStyle = '#fff'; x.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
        const x0 = 8 + Math.random() * 48, tip = x0 + (Math.random() - 0.5) * 26, ty = 3 + Math.random() * 14;
        x.lineWidth = 1.3 + Math.random() * 1.1; x.beginPath(); x.moveTo(x0, s);
        x.quadraticCurveTo((x0 + tip) / 2 + (Math.random() - 0.5) * 8, (s + ty) / 2, tip, ty); x.stroke();
    }
    return new THREE.CanvasTexture(c);
}
function softSprite() {
    const s = 64, c = cv(s, s), x = c.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
}
function blobTex() {
    const s = 128, c = cv(s, s), x = c.getContext('2d');
    x.filter = 'blur(7px)'; x.fillStyle = '#fff';
    for (let i = 0; i < 16; i++) { x.beginPath(); x.arc(s / 2 + (Math.random() - 0.5) * 46, s * 0.45 + (Math.random() - 0.5) * 46, 16 + Math.random() * 22, 0, 7); x.fill(); }
    return new THREE.CanvasTexture(c);
}

// 共有GLSLスニペット ----------------------------------------------------------
const NOISE = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y); }
  float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.0; a*=0.5; } return v; }
`;

// ===========================================================================
// 夜空の湖
// ===========================================================================
export function buildNightLake(_THREE, ctx, group, items) {
    const isMobile = ctx.isMobile;
    const FOG = new THREE.Color(0x0b2142);
    const moonDir = new THREE.Vector3(0.18, 0.42, -0.86).normalize();
    const moon2D = new THREE.Vector2(moonDir.x, moonDir.y).normalize();
    const moonReflX = 7.0; // 水面の月光の輝線の中心x

    const grass = grassTex();
    const sprite = softSprite();
    const blob = blobTex();
    const owned = [grass, sprite, blob]; // 破棄対象テクスチャ

    // ---- 空ドーム + 月 ----------------------------------------------------
    const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, transparent: true,
        uniforms: { uTime: { value: 0 }, uMoon: { value: moonDir }, uOpacity: { value: 0 } },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: NOISE + `
          varying vec3 vP; uniform float uTime, uOpacity; uniform vec3 uMoon;
          void main(){
            vec3 d = normalize(vP);
            vec3 top = vec3(0.012,0.03,0.10);
            vec3 hor = vec3(0.05,0.12,0.27);
            vec3 col = mix(hor, top, smoothstep(-0.02, 0.62, d.y));
            float md = max(dot(d, uMoon), 0.0);
            col += vec3(0.10,0.13,0.18) * pow(md, 6.0);
            float band = smoothstep(0.0,0.18,d.y)*(1.0-smoothstep(0.30,0.66,d.y));
            float c = fbm(vec2(d.x*3.0 + uTime*0.012, d.z*3.0 + 0.5*d.y));
            float cloud = smoothstep(0.45,0.85,c)*band;
            col += mix(vec3(0.05,0.07,0.12), vec3(0.22,0.26,0.30), pow(md,4.0)) * cloud;
            float halo = pow(md, 150.0)*0.95 + pow(md, 18.0)*0.11;
            col += vec3(0.52,0.60,0.68) * halo;
            float disc = smoothstep(0.9982, 0.9990, md);
            col = mix(col, vec3(1.0,0.99,0.93), disc);
            gl_FragColor = vec4(col, uOpacity);
          }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 24, 16), skyMat);
    sky.renderOrder = -10;
    group.add(sky);
    items.push({ update: (now, dt, fade) => {
        sky.position.set(ctx.camera.position.x, ctx.camera.position.y, 0);
        skyMat.uniforms.uTime.value = now * 0.001;
        skyMat.uniforms.uOpacity.value = fade;
    } });

    // ---- 森のシルエット(月光で立体感のある3層) ---------------------------
    const buildForest = (o) => {
        const mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide,
            uniforms: {
                uTime: { value: 0 }, uOpacity: { value: 0 },
                uSeed: { value: o.seed }, uBaseH: { value: o.base }, uAmp: { value: o.amp },
                uColA: { value: new THREE.Vector3(...o.colA) }, uColB: { value: new THREE.Vector3(...o.colB) },
                uMoon2D: { value: new THREE.Vector2(moon2D.x, moon2D.y) },
                uMoonTint: { value: new THREE.Vector3(...o.moonTint) }, uLit: { value: o.lit },
            },
            vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
            fragmentShader: NOISE + `
              varying vec2 vUv;
              uniform float uTime, uOpacity, uSeed, uBaseH, uAmp, uLit; uniform vec3 uColA, uColB, uMoonTint; uniform vec2 uMoon2D;
              void main(){
                float sx = vUv.x + sin(uTime*0.25 + vUv.x*3.0)*0.006;
                float prof = uBaseH + uAmp*fbm(vec2(sx*5.0 + uSeed, uSeed))
                           + 0.14*fbm(vec2(sx*2.0 + uSeed, uSeed*0.5))
                           + 0.10*fbm(vec2(sx*15.0, uSeed+4.0))
                           + 0.05*fbm(vec2(sx*40.0, uSeed+9.0));
                float edge = smoothstep(prof, prof-0.045, vUv.y);
                if(edge < 0.01) discard;
                float frq = 24.0; float e = 0.014;
                float hx = fbm(vec2((sx+e)*frq, vUv.y*frq)) - fbm(vec2((sx-e)*frq, vUv.y*frq));
                float hy = fbm(vec2(sx*frq,(vUv.y+e)*frq)) - fbm(vec2(sx*frq,(vUv.y-e)*frq));
                vec3 nrm = normalize(vec3(-hx*3.2, -hy*3.2, 1.0));
                float diff = max(dot(nrm.xy, uMoon2D), 0.0);
                float h0 = fbm(vec2(sx*frq, vUv.y*frq));
                vec3 col = mix(uColA, uColB, smoothstep(0.34,0.80,h0));
                col *= 0.62 + 0.42*(vUv.y/max(prof,0.001));
                col += uMoonTint * pow(diff, 1.25) * uLit;
                col += uColB * 0.16 * smoothstep(prof-0.12, prof, vUv.y);
                gl_FragColor = vec4(col, edge * uOpacity);
              }`,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.width, o.height), mat);
        mesh.position.set(0, WY + o.height / 2, o.z);
        group.add(mesh);
        items.push({ update: (now, dt, fade) => { mat.uniforms.uTime.value = now * 0.001; mat.uniforms.uOpacity.value = fade; } });
    };
    buildForest({ width: 320, height: 40, z: -150, seed: 3.7, colA: [0.016, 0.036, 0.044], colB: [0.034, 0.072, 0.074], base: 0.42, amp: 0.28, moonTint: [0.05, 0.08, 0.11], lit: 0.32 });
    buildForest({ width: 290, height: 34, z: -125, seed: 7.1, colA: [0.022, 0.052, 0.054], colB: [0.046, 0.105, 0.098], base: 0.36, amp: 0.32, moonTint: [0.08, 0.12, 0.14], lit: 0.42 });
    buildForest({ width: 255, height: 28, z: -103, seed: 11.2, colA: [0.028, 0.066, 0.062], colB: [0.058, 0.130, 0.112], base: 0.30, amp: 0.34, moonTint: [0.11, 0.16, 0.16], lit: 0.5 });

    // ---- 遠岸 + 水際の光ライン --------------------------------------------
    const bankMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `
          varying vec2 vUv; uniform float uOpacity;
          void main(){
            vec3 grass = vec3(0.05,0.14,0.08);
            vec3 col = grass * (0.45 + 0.55*vUv.y);
            float line = smoothstep(0.0,0.05,vUv.y)*(1.0-smoothstep(0.05,0.15,vUv.y));
            col += vec3(0.12,0.24,0.36)*line*0.9;
            float a = smoothstep(0.0,0.04,vUv.y);
            gl_FragColor = vec4(col, a * uOpacity);
          }`,
    });
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(300, 5), bankMat);
    bank.position.set(0, WY + 1.0, -98);
    group.add(bank);
    items.push({ update: (now, dt, fade) => { bankMat.uniforms.uOpacity.value = fade; } });

    // ---- 額縁の暗い木立(左右手前) ----------------------------------------
    addBillboards(group, items, blob, [
        { x: -55, y: WY + 14, z: -28, w: 64, h: 70, c: [0.012, 0.035, 0.045] },
        { x: 57, y: WY + 13, z: -34, w: 60, h: 64, c: [0.012, 0.035, 0.045] },
        { x: -40, y: WY + 8, z: -16, w: 44, h: 34, c: [0.015, 0.04, 0.05] },
        { x: 44, y: WY + 8, z: -18, w: 46, h: 36, c: [0.015, 0.04, 0.05] },
    ], { sway: 0.05, rim: [0.0, 0.02, 0.04], fog: FOG });

    // ---- 水面 -------------------------------------------------------------
    const waterUni = {
        uTime: { value: 0 }, uOpacity: { value: 0 },
        uCam: { value: new THREE.Vector3() }, uMoon: { value: moonDir },
        uMoonReflX: { value: moonReflX },
    };
    const waterGeo = new THREE.PlaneGeometry(320, 340, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: waterUni,
        vertexShader: `
          varying vec3 vW; varying vec2 vLoc;
          void main(){ vLoc = position.xz; vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz;
            gl_Position=projectionMatrix*viewMatrix*wp; }`,
        fragmentShader: NOISE + `
          varying vec3 vW; varying vec2 vLoc;
          uniform float uTime, uOpacity, uMoonReflX; uniform vec3 uCam, uMoon;
          void main(){
            float t = uTime;
            vec2 p = vLoc;
            float dist = length(vW.xz - uCam.xz);
            float far = clamp(dist*0.014, 0.0, 1.0);          // 0=手前 1=遠く(水際)
            // さざ波(ローカル座標なのでカメラ移動で泳がない)
            float n1 = vnoise(p*0.16 + vec2(t*0.04, t*0.025));
            float n2 = vnoise(p*0.5  - vec2(t*0.06, t*0.05));
            vec2 ripple = vec2(n1-0.5, n2-0.5);
            // 空の映り込み(遠いほど水際の青、手前ほど深い藍)を手続きで近似
            vec3 deep = vec3(0.015,0.05,0.14);
            vec3 mid  = vec3(0.06,0.20,0.40);
            vec3 base = mix(deep, mid, far);
            vec3 skyRefl = mix(vec3(0.018,0.05,0.13), vec3(0.06,0.13,0.28), far);
            float fres = clamp(0.30 + far*0.55, 0.0, 0.9);
            vec3 col = mix(base, skyRefl, fres);
            // 月明かりのにじみ(水面の明るい一帯)
            float gd = length(vec2(vW.x - uMoonReflX, vW.z*0.18));
            float glow = smoothstep(28.0, 0.0, gd) * (0.85 + 0.15*sin(t*0.35));
            col += vec3(0.07,0.22,0.42) * glow * far * 1.2;
            // 月光のきらめき(月の方向に立つ輝線)
            vec2 fineR = vec2(vnoise(p*1.5 + vec2(t*0.2,0.0))-0.5, vnoise(p*1.7 - vec2(0.0,t*0.18))-0.5);
            vec3 nrm = normalize(vec3((ripple.x+fineR.x)*1.7, 1.0, (ripple.y+fineR.y)*1.7));
            vec3 vd = normalize(uCam - vW);
            vec3 hf = normalize(vd + uMoon);
            float spec = pow(max(dot(nrm, hf), 0.0), 48.0);
            float lane = smoothstep(16.0, 0.0, abs(vW.x - uMoonReflX));
            col += vec3(0.82,0.88,0.82) * spec * lane * (0.35 + far*0.5) * 0.9;
            gl_FragColor = vec4(col, uOpacity);
          }`,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(0, WY, -130);
    water.renderOrder = 1;
    group.add(water);
    items.push({ update: (now, dt, fade) => {
        waterUni.uTime.value = now * 0.001;
        waterUni.uOpacity.value = fade;
        waterUni.uCam.value.set(ctx.camera.position.x, ctx.camera.position.y, 0);
    } });

    // ---- 手前の草むら -----------------------------------------------------
    const grassData = [];
    const gN = isMobile ? 70 : 130;
    for (let i = 0; i < gN; i++) {
        const x = -34 + Math.random() * 68, z = -4 - Math.random() * 12;
        const h = 0.9 + Math.random() * 2.0, w = h * (1.0 + Math.random() * 0.6);
        grassData.push({ x, y: WY, z, w, h, c: Math.random() < 0.5 ? [0.05, 0.15, 0.07] : [0.04, 0.11, 0.06] });
    }
    addBillboards(group, items, grass, grassData, { sway: 0.4, rim: [0.03, 0.10, 0.06], fog: FOG });

    // ---- 星 & 蛍 ----------------------------------------------------------
    addPoints(group, items, sprite, starData(isMobile), { color: [0.82, 0.9, 1.0], twinkle: 1.4, base: 130, cap: 5 });
    addPoints(group, items, sprite, flyData(isMobile), { color: [0.6, 0.86, 0.78], twinkle: 0.7, drift: true, base: 46, cap: 11 });

    // ---- シーン全体の空気感(フォグ/既存星空を fade で支配) ----------------
    items.push({
        update: (now, dt, fade) => {
            applyEnvFog(ctx, FOG, 0.0042, fade);
            dimWorldStars(ctx, fade);
        },
        dispose: () => owned.forEach(t => t.dispose()),
    });
}

// ===========================================================================
// 晴天の湖(光の森)
// ===========================================================================
export function buildBrightLake(_THREE, ctx, group, items) {
    const isMobile = ctx.isMobile;
    const FOG = new THREE.Color(0xcdeccb);
    const LIGHT = 0xeafff0;
    const sunX = 0.0; // 光は正面奥(木々の間から差す)

    const TRUNK = trunkTex(), CANOPY = canopyTex(), BUSH = bushTex(), RAY = rayTex();
    const GLOW = ctx.glowTexture; // 共有(破棄しない)
    const owned = [TRUNK, CANOPY, BUSH, RAY];

    // ---- 空ドーム(柔らかな緑〜クリーム + 中央の眩い光) --------------------
    const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, transparent: true,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `
          varying vec3 vP; uniform float uOpacity;
          void main(){
            vec3 d = normalize(vP);
            vec3 top = vec3(0.50,0.74,0.52);
            vec3 bot = vec3(0.84,0.96,0.86);
            vec3 col = mix(bot, top, smoothstep(-0.1, 0.7, d.y));
            // 正面奥(木々の間)から差す眩い光
            float center = max(d.z < 0.0 ? -d.z : 0.0, 0.0);
            float low = smoothstep(0.5, -0.2, d.y);
            float beam = pow(center, 3.0) * low;
            col = mix(col, vec3(1.0,1.0,0.97), beam*0.85);
            gl_FragColor = vec4(col, uOpacity);
          }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 24, 16), skyMat);
    sky.renderOrder = -10;
    group.add(sky);
    items.push({ update: (now, dt, fade) => {
        sky.position.set(ctx.camera.position.x, ctx.camera.position.y, 0);
        skyMat.uniforms.uOpacity.value = fade;
    } });

    // 平面ビルボードの共通追加(色フェード)
    const mats = []; // { mat, op }
    const addPlane = (tex, x, y, z, w, h, op, opt = {}) => {
        const m = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
            color: new THREE.Color(opt.color ?? 0xffffff),
            blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            fog: opt.fog !== false,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
        mesh.position.set(x, y, z);
        if (opt.rotZ) mesh.rotation.z = opt.rotZ;
        if (opt.faceCam) mesh.lookAt(ctx.camera.position.x, y, ctx.camera.position.z + 2);
        mesh.renderOrder = opt.order ?? 0;
        group.add(mesh);
        mats.push({ mat: m, op });
        return mesh;
    };

    // ---- 幹(遠岸の森) ----------------------------------------------------
    const trunks = [
        [-30, -78, 6, 46], [-19, -92, 4.6, 46], [-11, -104, 3.4, 44],
        [27, -74, 6.4, 46], [16, -96, 4.2, 46], [38, -84, 5, 46],
        [6, -112, 2.6, 42], [-3, -116, 2.4, 40],
    ];
    trunks.forEach(t => addPlane(TRUNK, t[0], WY + t[3] * 0.5, t[1], t[2], t[3], 1, { color: 0xffffff, order: 2 }));

    // ---- 葉群(上部を埋める) ---------------------------------------------
    const canopies = [
        [-22, 30, -56, 34], [-6, 33, -72, 36], [10, 31, -64, 34], [26, 32, -50, 33],
        [-30, 25, -42, 24], [34, 26, -56, 26], [0, 36, -100, 30], [17, 20, -86, 22], [-14, 21, -94, 20],
    ];
    canopies.forEach(c => addPlane(CANOPY, c[0], WY + c[1], c[2], c[3] * 1.25, c[3], 1, { color: 0xffffff, faceCam: true, order: 3 }));

    // ---- 茂み / 岸(左右の縁) --------------------------------------------
    addPlane(BUSH, 30, WY + 4.5, -22, 30, 14, 1, { color: 0xffffff, rotZ: -0.12, order: 4 });
    addPlane(BUSH, -28, WY + 3, -16, 26, 11, 1, { color: 0xffffff, rotZ: 0.1, order: 4 });
    addPlane(BUSH, -24, WY + 2, 6, 30, 15, 1, { color: 0xffffff, order: 4 });
    addPlane(BUSH, 25, WY + 1.8, 4, 32, 16, 1, { color: 0xffffff, order: 4 });
    addPlane(BUSH, -34, WY + 1, -2, 22, 13, 1, { color: 0xffffff, order: 4 });
    addPlane(BUSH, 34, WY + 1, -3, 24, 14, 1, { color: 0xffffff, order: 4 });

    // ---- 中央の地平の光 ---------------------------------------------------
    addPlane(GLOW, 0, WY + 6, -96, 56, 38, 0.4, { color: LIGHT, additive: true, fog: false, order: 1 });
    addPlane(GLOW, 1.6, WY + 3, -78, 26, 26, 0.42, { color: LIGHT, additive: true, fog: false, order: 1 });

    // ---- 木漏れ日(光の筋) ------------------------------------------------
    const rays = [];
    const rN = isMobile ? 4 : 6;
    for (let i = 0; i < rN; i++) {
        const m = addPlane(RAY, rnd(-18, 22), WY + 24, -56 - i * 2.6, rnd(3, 8), 70, 0.1,
            { color: LIGHT, additive: true, fog: false, order: 1, rotZ: rnd(0.12, 0.32) });
        rays.push(m);
    }
    items.push({ update: (now, dt, fade) => {
        const t = now * 0.001;
        for (let i = 0; i < rays.length; i++) rays[i].material.opacity = (0.045 + 0.075 * (0.5 + 0.5 * Math.sin(t * 0.5 + i))) * fade;
    } });

    // ---- 塵(光の中を漂う粒子) -------------------------------------------
    const dust = makeDust(group, GLOW, isMobile);
    items.push(dust);

    // ---- 水面(シアンの湖・きらめき・木々の映り込みを手続きで) -------------
    const waterUni = {
        uTime: { value: 0 }, uOpacity: { value: 0 }, uCam: { value: new THREE.Vector3() },
        uDeep: { value: new THREE.Vector3(0.10, 0.52, 0.72) },
        uBright: { value: new THREE.Vector3(0.55, 0.88, 0.86) },
        uGlow: { value: new THREE.Vector3(0.72, 0.92, 0.80) },
        uSunX: { value: sunX },
    };
    const waterGeo = new THREE.PlaneGeometry(320, 340, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: waterUni,
        vertexShader: `
          varying vec3 vW; varying vec2 vLoc;
          void main(){ vLoc = position.xz; vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz;
            gl_Position=projectionMatrix*viewMatrix*wp; }`,
        fragmentShader: NOISE + `
          varying vec3 vW; varying vec2 vLoc;
          uniform float uTime, uOpacity, uSunX; uniform vec3 uCam, uDeep, uBright, uGlow;
          void main(){
            float t = uTime;
            vec2 p = vLoc;
            float dist = length(vW.xz - uCam.xz);
            float far = clamp(dist*0.014, 0.0, 1.0);            // 0=手前 1=水際
            // 縦のシアングラデ(手前=深いシアン 奥=明るい水際)
            vec3 cyan = mix(uDeep, uBright, far);
            // 木々/空の映り込み(奥ほど明るい緑白)を手続き近似
            vec2 ripple = vec2(vnoise(p*0.18 + vec2(t*0.05,0.0))-0.5, vnoise(p*0.22 - vec2(0.0,t*0.04))-0.5);
            float refl = far*far;
            vec3 col = mix(cyan, vec3(0.30,0.85,0.78)*(0.6+0.4*far), refl*0.5);
            // 中央(光源)直下の眩い映り込み
            float cx = 1.0 - smoothstep(0.0, 40.0, abs(vW.x - uSunX));
            col += uGlow * cx * far * 0.5;
            // きらめき(細かな白い点滅)
            vec2 cid = floor((p + ripple*8.0) * vec2(2.2, 1.6));
            float h = hash(cid);
            float spark = smoothstep(0.90, 1.0, h);
            float tw = 0.45 + 0.55*sin(t*3.2 + h*40.0);
            float spMask = smoothstep(0.05, 0.5, far) * smoothstep(1.0, 0.5, far);
            col += spark*max(tw,0.0)*spMask * vec3(0.6,0.97,0.95) * 0.7;
            gl_FragColor = vec4(col, uOpacity);
          }`,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(0, WY, -130);
    water.renderOrder = 1;
    group.add(water);
    items.push({ update: (now, dt, fade) => {
        waterUni.uTime.value = now * 0.001;
        waterUni.uOpacity.value = fade;
        waterUni.uCam.value.set(ctx.camera.position.x, ctx.camera.position.y, 0);
    } });

    // ---- 色フェード + シーンの空気感 --------------------------------------
    items.push({
        update: (now, dt, fade) => {
            for (const e of mats) e.mat.opacity = e.op * fade;
            applyEnvFog(ctx, FOG, 0.0045, fade);
            dimWorldStars(ctx, fade);
        },
        dispose: () => owned.forEach(t => t.dispose()),
    });
}

// ---------------------------------------------------------------------------
// 共通: ビルボード群 / 点群 / 塵 / 星・蛍データ / フォグ支配
// ---------------------------------------------------------------------------
function addBillboards(group, items, tex, data, opt) {
    opt = opt || {};
    const sway = opt.sway != null ? opt.sway : 0.14;
    const rim = opt.rim || [0.0, 0.02, 0.04];
    const FOG = opt.fog || new THREE.Color(0x0b2142);
    const n = data.length;
    const pos = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2);
    const ph = new Float32Array(n * 4), col = new Float32Array(n * 4 * 3);
    const idx = [];
    for (let i = 0; i < n; i++) {
        const d = data[i], hw = d.w / 2, b = i * 4;
        const verts = [[d.x - hw, d.y, d.z, 0, 0], [d.x + hw, d.y, d.z, 1, 0], [d.x + hw, d.y + d.h, d.z, 1, 1], [d.x - hw, d.y + d.h, d.z, 0, 1]];
        const cc = d.c || [0.06, 0.14, 0.10];
        const phase = Math.random() * 6.28;
        for (let v = 0; v < 4; v++) {
            pos[(b + v) * 3] = verts[v][0]; pos[(b + v) * 3 + 1] = verts[v][1]; pos[(b + v) * 3 + 2] = verts[v][2];
            uv[(b + v) * 2] = verts[v][3]; uv[(b + v) * 2 + 1] = verts[v][4];
            ph[b + v] = phase; col[(b + v) * 3] = cc[0]; col[(b + v) * 3 + 1] = cc[1]; col[(b + v) * 3 + 2] = cc[2];
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    const uniforms = { uTime: { value: 0 }, uOpacity: { value: 0 }, uTex: { value: tex }, uSway: { value: sway }, uRim: { value: new THREE.Vector3(rim[0], rim[1], rim[2]) } };
    const mat = new THREE.ShaderMaterial({
        uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        vertexShader: `
          attribute float aPhase; attribute vec3 aColor; varying vec2 vUv; varying vec3 vC;
          uniform float uTime, uSway;
          void main(){ vUv=uv; vC=aColor; vec3 p=position;
            p.x += sin(uTime*0.5 + aPhase)*uSway*pow(uv.y,2.0);
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
        fragmentShader: `
          varying vec2 vUv; varying vec3 vC; uniform sampler2D uTex; uniform vec3 uRim; uniform float uOpacity;
          void main(){ vec4 t=texture2D(uTex,vUv); if(t.a<0.02) discard;
            vec3 col = vC + uRim*pow(vUv.y,3.0);
            gl_FragColor = vec4(col, t.a * uOpacity); }`,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = opt.order ?? 5;
    group.add(mesh);
    items.push({ update: (now, dt, fade) => { uniforms.uTime.value = now * 0.001; uniforms.uOpacity.value = fade; } });
}

function addPoints(group, items, sprite, data, opt) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(data.size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(data.phase, 1));
    g.setAttribute('aSpd', new THREE.BufferAttribute(data.spd, 1));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const uniforms = { uTime: { value: 0 }, uOpacity: { value: 0 }, uTex: { value: sprite }, uScale: { value: dpr }, uColor: { value: new THREE.Vector3(opt.color[0], opt.color[1], opt.color[2]) }, uTw: { value: opt.twinkle }, uBase: { value: opt.base }, uCap: { value: opt.cap } };
    const drift = opt.drift ? `
        p.x += sin(uTime*0.06*aSpd + aPhase)*1.3;
        p.y += sin(uTime*0.05*aSpd + aPhase*1.7)*0.7;
        p.z += cos(uTime*0.045*aSpd + aPhase)*1.0;` : '';
    const mat = new THREE.ShaderMaterial({
        uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
        vertexShader: `
          attribute float aSize; attribute float aPhase; attribute float aSpd;
          uniform float uTime, uScale, uTw, uBase, uCap; varying float vB;
          void main(){ vec3 p=position; ${drift}
            float fl = 0.4 + 0.6*pow(0.5+0.5*sin(uTime*uTw + aPhase*6.2831), 2.0);
            vB = fl;
            vec4 mv=modelViewMatrix*vec4(p,1.0);
            gl_PointSize = min(aSize*uScale*uBase*(0.6+0.6*fl)/max(-mv.z,1.0), uCap*uScale);
            gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `
          uniform sampler2D uTex; uniform vec3 uColor; uniform float uOpacity; varying float vB;
          void main(){ float a=texture2D(uTex, gl_PointCoord).a; gl_FragColor=vec4(uColor, a*vB*0.8*uOpacity); }`,
    });
    const mesh = new THREE.Points(g, mat);
    mesh.renderOrder = 7;
    group.add(mesh);
    items.push({ update: (now, dt, fade) => { uniforms.uTime.value = now * 0.001; uniforms.uOpacity.value = fade; } });
}

function makeDust(group, glow, isMobile) {
    const PN = isMobile ? 60 : 110;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(PN * 3), seed = new Float32Array(PN);
    for (let i = 0; i < PN; i++) {
        pos[i * 3] = rnd(-34, 34); pos[i * 3 + 1] = WY + rnd(1, 26); pos[i * 3 + 2] = rnd(-90, -4); seed[i] = Math.random() * 10;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: glow, size: 0.7, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, color: 0xffffff, fog: false });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 6;
    group.add(points);
    return {
        update: (now, dt, fade) => {
            const a = geo.attributes.position.array;
            for (let i = 0; i < PN; i++) {
                a[i * 3 + 1] += dt * (0.3 + 0.1 * Math.sin(seed[i]));
                a[i * 3] += dt * 0.13 * Math.sin(now * 0.0003 + seed[i]);
                if (a[i * 3 + 1] > WY + 27) { a[i * 3 + 1] = WY + 1; a[i * 3] = rnd(-34, 34); }
            }
            geo.attributes.position.needsUpdate = true;
            mat.opacity = 0.5 * fade;
        },
    };
}

function starData(isMobile) {
    const n = isMobile ? 80 : 130, pos = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), spd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, el = 0.18 + Math.random() * 0.8, r = 200;
        pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
        pos[i * 3 + 1] = Math.sin(el) * r * 0.7 + 10;
        pos[i * 3 + 2] = -Math.abs(Math.sin(a)) * Math.cos(el) * r - 20;
        size[i] = 0.7 + Math.random() * 1.7; phase[i] = Math.random(); spd[i] = 1;
    }
    return { pos, size, phase, spd };
}
function flyData(isMobile) {
    const n = isMobile ? 20 : 34, pos = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), spd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        pos[i * 3] = -26 + Math.random() * 52;
        pos[i * 3 + 1] = WY + 1.2 + Math.random() * 6;
        pos[i * 3 + 2] = -16 - Math.random() * 34;
        size[i] = 1.2 + Math.random() * 1.6; phase[i] = Math.random(); spd[i] = 0.6 + Math.random() * 0.9;
    }
    return { pos, size, phase, spd };
}

// 環境フォグ(色/密度)を fade で支配し、回廊の暗いフォグを湖の空気感へ置き換える。
// updateEnvironment は global の fog 上書き後に走るため、ここで上書きできる。
function applyEnvFog(ctx, color, density, fade) {
    if (!ctx.scene || !ctx.scene.fog) return;
    ctx.scene.fog.color.lerp(color, fade);
    ctx.scene.fog.density += (density - ctx.scene.fog.density) * fade;
}
// 回廊の汎用星空(worldColor着色)は湖では邪魔なので fade で消す。
function dimWorldStars(ctx, fade) {
    if (ctx.starField && ctx.starField.material) {
        ctx.starField.material.opacity *= (1 - fade);
    }
}
