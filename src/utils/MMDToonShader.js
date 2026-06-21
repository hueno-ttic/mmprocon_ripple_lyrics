/**
 * MMD Toon Shader
 *
 * This shader is extended from MeshPhongMaterial, and merged algorithms with
 * MeshToonMaterial and MeshMetcapMaterial.
 * Ideas came from https://github.com/mrdoob/three.js/issues/19609
 *
 * Combining steps:
 *  * Declare matcap uniform.
 *  * Add gradientmap_pars_fragment.
 *  * Use gradient irradiances instead of dotNL irradiance from MeshPhongMaterial.
 *    (Replace lights_phong_pars_fragment with lights_mmd_toon_pars_fragment)
 *  * Add mmd_toon_matcap_fragment.
 */

import { UniformsUtils, ShaderLib } from 'three';

const lights_mmd_toon_pars_fragment = /* glsl */`
varying vec3 vViewPosition;

struct BlinnPhongMaterial {

	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;

};

void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {

	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;

	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );

	reflectedLight.directSpecular += irradiance * BRDF_GGX_BlinnPhong( directLight.direction, geometryNormal, geometryViewDir, material.specularColor, material.specularShininess ) * material.specularStrength;

}
`;

const MMDToonShader = {

	defines: {
		TOON: true,
		MATCAP: true
	},

	uniforms: /*@__PURE__*/ UniformsUtils.merge( [
		ShaderLib.phong.uniforms,
		{
			matcap: { value: null }
		}
	] ),

	vertexShader: ShaderLib.phong.vertexShader,

	fragmentShader: ShaderLib.phong.fragmentShader
		.replace(
			'#include <lights_phong_pars_fragment>',
			lights_mmd_toon_pars_fragment
		)
		.replace(
			'#include <envmap_common_pars_fragment>',
			/* glsl */`
			#include <envmap_common_pars_fragment>
			#ifdef MATCAP
				varying vec3 vNormal;
			#endif
			`
		)
		.replace(
			'#include <envmap_pars_fragment>',
			/* glsl */`
			#include <envmap_pars_fragment>
			#ifdef MATCAP
				uniform sampler2D matcap;
			#endif
			`
		)
		.replace(
			'#include <envmap_fragment>',
			/* glsl */`
			#include <envmap_fragment>
			#ifdef MATCAP
				vec3 matcapNormal = geometryNormal;
				#ifdef DOUBLE_SIDE
					if ( vDoubleSided > 0.5 ) {
						matcapNormal = matcapNormal * ( float( gl_FrontFacing ) * 2.0 - 1.0 );
					}
				#endif
				vec3 viewDir = normalize( vViewPosition );
				vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
				vec3 y = cross( viewDir, x );
				vec2 uv = vec2( dot( x, matcapNormal ), dot( y, matcapNormal ) ) * 0.495 + 0.5;
				vec4 matcapColor = texture2D( matcap, uv );
				reflectedLight.indirectDiffuse += matcapColor.rgb * diffuseColor.rgb;
			#endif
			`
		)

};

export { MMDToonShader };

