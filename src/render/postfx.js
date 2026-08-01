/**
 * POSTFX — the single fullscreen pass that turns a modern framebuffer into
 * something that looks like it came out of a 1997 console, plus the two
 * narrative effects the story needs (`glitch` and `fade`).
 *
 * Order matters and is deliberate:
 *   chromatic split → glitch displacement → grade → dither → quantise →
 *   scanlines → vignette → fade
 * Dithering must happen *before* quantisation, otherwise it does nothing.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2  uResolution;
  uniform float uTime;

  uniform float uColorLevels;
  uniform float uDither;
  uniform float uScanlines;
  uniform float uVignette;
  uniform float uChroma;

  uniform float uLift;
  uniform float uGain;
  uniform float uSaturation;
  uniform vec3  uTint;

  uniform float uGlitch;      // 0..1 master glitch amount
  uniform float uGlitchSeed;
  uniform float uFade;        // 0..1, 1 = fully covered
  uniform vec3  uFadeColor;

  varying vec2 vUv;

  // Ordered Bayer dithering, closed form — no arrays, no dynamic indexing.
  // bayer2 reproduces [[0,2],[3,1]]/4; bayer4 nests it for the 4x4 pattern.
  float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(a * 0.5) * 0.25 + bayer2(a) - 0.5; }

  float hash11(float n) { return fract(sin(n * 78.233) * 43758.5453); }
  float hash21(vec2 p)  { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    vec2 px = uv * uResolution;

    // -- glitch: horizontal band displacement -----------------------------
    float glitchShift = 0.0;
    if (uGlitch > 0.001) {
      float bandCount = mix(6.0, 34.0, uGlitch);
      float band = floor(uv.y * bandCount);
      float noise = hash21(vec2(band, floor(uTime * 18.0) + uGlitchSeed));
      // Only some bands tear, so it reads as damage rather than static.
      // Named "torn" because "active" is a reserved word in GLSL ES.
      float torn = step(1.0 - uGlitch * 0.65, noise);
      glitchShift = (hash11(band + uGlitchSeed) - 0.5) * 0.22 * uGlitch * torn;
      uv.x += glitchShift;

      // Occasional whole-frame vertical roll.
      float roll = step(0.986, hash11(floor(uTime * 6.0) + uGlitchSeed));
      uv.y = fract(uv.y + roll * uGlitch * 0.18);
    }

    // -- chromatic aberration ---------------------------------------------
    float chroma = uChroma + uGlitch * 6.0;
    vec3 color;
    if (chroma > 0.001) {
      vec2 dir = (uv - 0.5);
      vec2 off = dir * (chroma / uResolution.x) * 4.0 + vec2(glitchShift * 0.35, 0.0);
      color.r = texture2D(tDiffuse, uv + off).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - off).b;
    } else {
      color = texture2D(tDiffuse, uv).rgb;
    }

    // -- glitch: value corruption -----------------------------------------
    if (uGlitch > 0.001) {
      float blockSize = mix(64.0, 8.0, uGlitch);
      vec2 block = floor(px / blockSize);
      float n = hash21(block + floor(uTime * 12.0) + uGlitchSeed);
      if (n > 1.0 - uGlitch * 0.28) {
        color = mix(color, vec3(n, 1.0 - n, hash11(n * 7.0)), 0.55 * uGlitch);
      }
      // Scanline dropout.
      float drop = step(1.0 - uGlitch * 0.06, hash21(vec2(floor(px.y), floor(uTime * 30.0))));
      color = mix(color, vec3(0.0), drop * 0.8);
    }

    // -- linear → sRGB ------------------------------------------------------
    // The scene is rendered into a linear buffer, but every filter below is a
    // *display* effect: banding, dithering and scanlines only look right on
    // perceptual values. Convert here so the numbers in style.js behave the
    // way they look. Nothing after this point is in linear space.
    color = max(color, vec3(0.0));
    color = mix(color * 12.92,
                1.055 * pow(color, vec3(0.4166667)) - 0.055,
                step(vec3(0.0031308), color));

    // -- colour grade -------------------------------------------------------
    color = (color + uLift) * uGain;
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, uSaturation);
    color *= uTint;

    // -- dither, then quantise ---------------------------------------------
    if (uColorLevels > 0.0) {
      if (uDither > 0.0) color += bayer4(px) * (uDither / uColorLevels);
      color = floor(color * uColorLevels + 0.5) / uColorLevels;
    } else if (uDither > 0.0) {
      color += bayer4(px) * uDither * 0.02;
    }

    // -- CRT dressing -------------------------------------------------------
    if (uScanlines > 0.0) {
      float s = 0.5 + 0.5 * cos(px.y * 3.14159265);
      color *= 1.0 - uScanlines * s;
    }
    if (uVignette > 0.0) {
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.4;
      color *= clamp(v, 0.0, 1.0);
    }

    color = mix(color, uFadeColor, clamp(uFade, 0.0, 1.0));
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

export class PostFx {
  constructor(preset, theme) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.uniforms = {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(320, 240) },
      uTime: { value: 0 },
      uColorLevels: { value: preset.colorLevels },
      uDither: { value: preset.dither },
      uScanlines: { value: preset.scanlines },
      uVignette: { value: preset.vignette },
      uChroma: { value: preset.chromaticAberration },
      uLift: { value: theme.grade.lift },
      uGain: { value: theme.grade.gain },
      uSaturation: { value: theme.grade.saturation },
      uTint: { value: new THREE.Color(theme.grade.tint) },
      uGlitch: { value: 0 },
      uGlitchSeed: { value: 0 },
      uFade: { value: 0 },
      uFadeColor: { value: new THREE.Color(0x000000) },
    };

    // ShaderMaterial (not Raw) so three injects the `uv`/`position` attributes
    // and the precision boilerplate for us.
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this._quad = quad;
  }

  applyPreset(preset) {
    this.uniforms.uColorLevels.value = preset.colorLevels;
    this.uniforms.uDither.value = preset.dither;
    this.uniforms.uScanlines.value = preset.scanlines;
    this.uniforms.uVignette.value = preset.vignette;
    this.uniforms.uChroma.value = preset.chromaticAberration;
  }

  applyTheme(theme) {
    this.uniforms.uLift.value = theme.grade.lift;
    this.uniforms.uGain.value = theme.grade.gain;
    this.uniforms.uSaturation.value = theme.grade.saturation;
    this.uniforms.uTint.value.set(theme.grade.tint);
  }

  setSize(w, h) {
    this.uniforms.uResolution.value.set(w, h);
  }

  /** 0 = clean, 1 = the system is coming apart. */
  setGlitch(amount) {
    this.uniforms.uGlitch.value = amount;
    if (amount > 0) this.uniforms.uGlitchSeed.value = Math.floor(Math.random() * 1000);
  }

  /** 0 = visible, 1 = fully covered by `color`. */
  setFade(amount, color = 0x000000) {
    this.uniforms.uFade.value = amount;
    this.uniforms.uFadeColor.value.set(color);
  }

  update(dt) {
    this.uniforms.uTime.value += dt;
  }

  render(renderer, inputTexture) {
    this.uniforms.tDiffuse.value = inputTexture;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
  }

  dispose() {
    this._quad.geometry.dispose();
    this.material.dispose();
  }
}
