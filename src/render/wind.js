/**
 * WIND — vertex sway, injected into a stock three material.
 *
 * Sibling of `psx.js`, and deliberately built the same way: `onBeforeCompile`
 * surgery so the material keeps fog, instancing, vertex colours and lighting.
 *
 * WHY IT IS IN THE SHADER
 * -----------------------
 * Ground cover is ~2800 instances that never otherwise move (see
 * `world/groundCover.js` — an instance's matrix is only rewritten when it is
 * recycled). Animating that on the CPU would mean composing and uploading 2800
 * matrices every frame to make blades of grass wobble. The GPU is already
 * transforming every one of those vertices; bending them costs two sines.
 *
 * IT DOES NOT FIGHT THE PSX SNAP
 * ------------------------------
 * The snap in `psx.js` quantises `gl_Position` at the very end of the vertex
 * shader, after `#include <fog_vertex>`. This runs at `#include <begin_vertex>`,
 * on the object-space `transformed` vertex, long before projection. The two
 * never touch the same variable, and the sway simply arrives pre-snapped — the
 * grass wobbles on the same pixel grid as everything else, which is the look.
 *
 * THE ROOTS DO NOT MOVE
 * ---------------------
 * Displacement is scaled by `transformed.y²`, and every prop factory puts its
 * origin at ground level. At y = 0 the bend is exactly zero, so the base of a
 * blade is welded to the terrain no matter how hard it is blowing. Sway a card
 * uniformly and it visibly slides across the ground instead of bending.
 */

const WIND_VERTEX_HEAD = /* glsl */ `
  /** Accumulated PHASE in radians, not seconds — see MaterialLibrary#setWindTime. */
  uniform float uWindTime;
  uniform float uWindStrength;
  uniform float uWindScale;
  uniform vec2  uWindDir;
`;

// Injected right after three's <begin_vertex>, which declares `transformed`.
//
// The phase comes from the instance's own translation column, so neighbouring
// tufts are at different points in the gust instead of moving as one sheet.
// Two sines at incommensurate rates keep it from reading as a metronome.
const WIND_VERTEX_BODY = /* glsl */ `
  #ifdef USE_INSTANCING
    vec2 windAnchor = instanceMatrix[3].xz;
  #else
    vec2 windAnchor = vec2(0.0);
  #endif
  float windPhase = dot(windAnchor, vec2(uWindScale, uWindScale * 0.87));
  float windWave = sin(uWindTime + windPhase) * 0.72
                 + sin(uWindTime * 1.73 + windPhase * 1.9) * 0.28;
  // y² rather than y: the bend accelerates up the blade, so the tip whips and
  // the bottom third barely leaves. Linear reads as a rigid pole hinging.
  float windBend = max(transformed.y, 0.0);
  transformed.xz += uWindDir * (windWave * uWindStrength * windBend * windBend);
`;

/**
 * Make a material's geometry bend in the wind.
 *
 * Safe to call after `applyPsx` — the previous `onBeforeCompile` is chained,
 * and the program cache key is extended rather than replaced. That second part
 * matters: two `MeshLambertMaterial`s with the same parameters share a compiled
 * program, so a wind material that reported the plain PSX cache key would be
 * handed the terrain's shader (or hand the terrain *its* shader, and the ground
 * would start waving).
 *
 * @param {import('three').Material} material
 * @param {object} uniforms shared uniform objects — one set per library, so a
 *   single write per frame animates every wind material at once
 * @returns {import('three').Material} the same material, for chaining
 */
export function applyVertexWind(material, uniforms) {
  material.userData.windUniforms = uniforms;

  const prevHook = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prevHook) prevHook(shader, renderer);
    shader.uniforms.uWindTime = uniforms.uWindTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uWindScale = uniforms.uWindScale;
    shader.uniforms.uWindDir = uniforms.uWindDir;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${WIND_VERTEX_HEAD}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX_BODY}`);
  };

  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}|wind`;
  material.needsUpdate = true;
  return material;
}
