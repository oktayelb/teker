/**
 * GLASS — the grazing-angle brightening that makes a pane a pane.
 *
 * Sibling of `psx.js` and `wind.js`, and built the same way: `onBeforeCompile`
 * surgery on a stock three material, so it keeps fog, vertex colours and
 * lighting, and it chains rather than replaces whatever was applied before it.
 *
 * WHY THIS EXISTS
 * ---------------
 * A dome is a pane of glass you stand on, and a flat alpha does not read as one.
 * At eight percent it is invisible; at fifty it is a coloured lid over the world
 * and you cannot see the race underneath, which is the only reason to be up
 * there. The car ended up appearing to drive on nothing at all.
 *
 * Real glass solves this by itself: look straight through it and it is clear,
 * look along it and it goes to a sheet of sky. That is Fresnel, and it is
 * exactly the right behaviour here — the roof under your wheels is at a grazing
 * angle and reads as solid, while the race directly below stays visible through
 * a pane you are looking at square on.
 *
 * PER-VERTEX, ON PURPOSE
 * ----------------------
 * The facing term is computed in the vertex shader and interpolated, rather than
 * read from `vViewPosition` in the fragment stage. It costs a dot product per
 * vertex on a 26×96 lattice instead of per pixel over a shell that fills the
 * screen, and it does not depend on which varyings three's lighting chunks
 * happen to declare this version.
 */

const GLASS_VERTEX_HEAD = /* glsl */ `
  varying float vGlassFacing;
`;

// Injected right after three's <project_vertex>, which is the first point where
// both `transformedNormal` (view space) and `mvPosition` exist.
//
// `abs` rather than a clamp: the shell is DoubleSide, and the back faces you see
// from underneath want the same treatment as the front ones you drive on.
const GLASS_VERTEX_BODY = /* glsl */ `
  vGlassFacing = abs(dot(normalize(transformedNormal), normalize(-mvPosition.xyz)));
`;

const GLASS_FRAGMENT_HEAD = /* glsl */ `
  uniform float uGlassRim;
  uniform float uGlassRimPower;
  varying float vGlassFacing;
`;

// After <dithering_fragment>, which is the last thing in three's fragment
// shaders. Fog has already been applied and only touches rgb, so the alpha we
// are about to change is still the material's own.
const GLASS_FRAGMENT_BODY = /* glsl */ `
  gl_FragColor.a = min(
    1.0,
    gl_FragColor.a * (1.0 + uGlassRim * pow(1.0 - vGlassFacing, uGlassRimPower))
  );
`;

/**
 * Make a transparent material brighten where it is seen edge-on.
 *
 * Safe to call after `applyPsx`: the previous hook is chained and the program
 * cache key is extended rather than replaced. See the note in `wind.js` — two
 * `MeshLambertMaterial`s with the same parameters share a compiled program, so a
 * material that reported the plain PSX key would be handed the terrain's shader.
 *
 * @param {import('three').Material} material
 * @param {{rim:number, power:number}} [opts] `rim` is how many times the base
 *   opacity a fully edge-on pane reaches; `power` is how fast it gets there.
 * @returns {import('three').Material} the same material, for chaining
 */
export function applyGlassFresnel(material, { rim = 5, power = 3 } = {}) {
  const uniforms = {
    uGlassRim: { value: rim },
    uGlassRimPower: { value: power },
  };
  material.userData.glassUniforms = uniforms;

  const prevHook = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prevHook) prevHook(shader, renderer);
    shader.uniforms.uGlassRim = uniforms.uGlassRim;
    shader.uniforms.uGlassRimPower = uniforms.uGlassRimPower;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${GLASS_VERTEX_HEAD}\nvoid main() {`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${GLASS_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${GLASS_FRAGMENT_HEAD}\nvoid main() {`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${GLASS_FRAGMENT_BODY}`);
  };

  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}|glass`;
  material.needsUpdate = true;
  return material;
}
