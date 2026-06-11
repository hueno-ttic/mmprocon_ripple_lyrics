import * as THREE from 'three';

// Gradient sky dome shared by all world phases. The vertical 3-stop
// gradient (top / horizon / bottom) is what makes each weather state
// instantly recognizable.
export function createSkyDome({ top, horizon, bottom }) {
    const geo = new THREE.SphereGeometry(120, 24, 16);
    const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
            uTop: { value: new THREE.Color(top) },
            uHorizon: { value: new THREE.Color(horizon) },
            uBottom: { value: new THREE.Color(bottom) },
        },
        vertexShader: `
            varying vec3 vPos;
            void main() {
                vPos = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uTop;
            uniform vec3 uHorizon;
            uniform vec3 uBottom;
            varying vec3 vPos;
            void main() {
                float h = normalize(vPos).y;
                vec3 col = h >= 0.0
                    ? mix(uHorizon, uTop, pow(h, 0.65))
                    : mix(uHorizon, uBottom, pow(-h, 0.75));
                gl_FragColor = vec4(col, 1.0);
            }
        `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;
    return mesh;
}
