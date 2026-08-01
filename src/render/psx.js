/**
 * PSX — shader surgery that makes modern three.js look like 1997 hardware.
 *
 * Two effects, both injected into stock three materials via `onBeforeCompile`
 * so we keep fog, instancing, vertex colours and skinning for free:
 *
 *  1. VERTEX SNAP — the PS1 had no sub-pixel precision in its rasteriser, so
 *     vertices jittered onto a coarse grid. This is *the* signature artefact.
 *  2. AFFINE UVs — the PS1 also had no perspective-correct texture mapping, so
 *     textures swim across large polygons. Only matters on textured materials.
 *
 * Both are opt-in per material and driven by `style.js`.
 */

const SNAP_VERTEX_HEAD = /* glsl */ `
  uniform float uSnapResolution;
  uniform float uJitterAmount;
`;

// Runs at the very end of the vertex shader, after gl_Position is final.
const SNAP_VERTEX_BODY = /* glsl */ `
  if (uSnapResolution > 0.0) {
    vec4 snapPos = gl_Position;
    // To NDC, quantise the screen-space position, then back to clip space.
    vec3 ndc = snapPos.xyz / snapPos.w;
    vec2 grid = vec2(uSnapResolution, uSnapResolution * 0.75);
    vec2 quantised = floor(ndc.xy * grid + 0.5) / grid;
    ndc.xy = mix(ndc.xy, quantised, uJitterAmount);
    gl_Position = vec4(ndc * snapPos.w, snapPos.w);
  }
`;

const AFFINE_VERTEX_HEAD = /* glsl */ `
  #ifdef USE_MAP
    varying float vAffineW;
  #endif
`;

// Pre-multiplying by w cancels the GPU's perspective-correct interpolation:
// the fragment shader divides it back out and is left with linear screen-space
// interpolation — exactly the PS1's (incorrect, beloved) behaviour.
const AFFINE_VERTEX_BODY = /* glsl */ `
  #ifdef USE_MAP
    vAffineW = gl_Position.w;
    vMapUv *= gl_Position.w;
  #endif
`;

const AFFINE_FRAGMENT_HEAD = /* glsl */ `
  #ifdef USE_MAP
    varying float vAffineW;
  #endif
`;

// A hand-rolled stand-in for three's <map_fragment>. We cannot write to
// `vMapUv` in the fragment stage (GLSL ES 3.00 `in` variables are read-only),
// so the correction happens at the sample site instead.
const AFFINE_MAP_FRAGMENT = /* glsl */ `
  #ifdef USE_MAP
    diffuseColor *= texture2D( map, vMapUv / vAffineW );
  #endif
`;

/**
 * Apply the PSX pipeline to a material.
 * @param {import('three').Material} material
 * @param {{vertexSnap?:number, affineTextures?:boolean}} preset
 * @returns {import('three').Material} the same material, for chaining
 */
export function applyPsx(material, preset = {}) {
  const snap = preset.vertexSnap || 0;
  const affine = !!preset.affineTextures;
  if (!snap && !affine) return material;

  // Shared uniforms so a whole preset can be retuned at runtime in one write.
  const uniforms = {
    uSnapResolution: { value: snap },
    uJitterAmount: { value: snap > 0 ? 1 : 0 },
  };
  material.userData.psxUniforms = uniforms;

  const prevHook = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prevHook) prevHook(shader, renderer);

    shader.uniforms.uSnapResolution = uniforms.uSnapResolution;
    shader.uniforms.uJitterAmount = uniforms.uJitterAmount;

    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;

    const vsHead = (snap ? SNAP_VERTEX_HEAD : '') + (affine ? AFFINE_VERTEX_HEAD : '');
    const vsBody = (snap ? SNAP_VERTEX_BODY : '') + (affine ? AFFINE_VERTEX_BODY : '');

    vs = vs.replace('void main() {', `${vsHead}\nvoid main() {`);
    // `#include <fog_vertex>` is the last thing in three's vertex shaders, so
    // appending after it guarantees gl_Position is already computed.
    vs = vs.replace('#include <fog_vertex>', `#include <fog_vertex>\n${vsBody}`);

    if (affine) {
      fs = fs.replace('void main() {', `${AFFINE_FRAGMENT_HEAD}\nvoid main() {`);
      fs = fs.replace('#include <map_fragment>', AFFINE_MAP_FRAGMENT);
    }

    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };

  // Force a recompile if the material was already used.
  material.customProgramCacheKey = () => `psx-${snap}-${affine ? 1 : 0}`;
  material.needsUpdate = true;
  return material;
}

/** Retune snapping on an already-built material (live tuning panel). */
export function setPsxSnap(material, resolution) {
  const u = material.userData?.psxUniforms;
  if (!u) return;
  u.uSnapResolution.value = resolution;
  u.uJitterAmount.value = resolution > 0 ? 1 : 0;
}
