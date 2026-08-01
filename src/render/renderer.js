/**
 * RENDERER — owns the WebGL context, the scene, the lights, the sky and the
 * retro pipeline. Modes do not touch three.js setup; they add a root Group to
 * `renderer.scene` and remove it on exit.
 *
 * Pipeline:  scene → low-res render target → PostFx → canvas
 *
 * The low-res target is the single biggest contributor to the look. Everything
 * about it is in `style.js` → `internalHeight`.
 */

import * as THREE from 'three';
import { resolveTheme, resolveRenderPreset } from '../config/style.js';
import { MaterialLibrary } from './materials.js';
import { PostFx } from './postfx.js';
import { events } from '../core/events.js';
import { clamp01, lerp } from '../core/mathx.js';

/**
 * Keys in a theme whose numeric values are plain scalars. Everything else that
 * is a number is a colour, and gets interpolated per channel during a theme
 * transition. Keeping the *scalar* list explicit is safer than guessing which
 * numbers are colours — there are only a dozen of them and they never grow.
 */
const SCALAR_KEYS = new Set([
  'near', 'far', 'density', 'sunSize', 'intensity', 'ambientIntensity',
  'lift', 'gain', 'saturation', 'x', 'y', 'z',
]);

const _cA = new THREE.Color();
const _cB = new THREE.Color();
const _cOut = new THREE.Color();

function lerpColorHex(a, b, t) {
  _cA.set(a);
  _cB.set(b);
  _cOut.setRGB(lerp(_cA.r, _cB.r, t), lerp(_cA.g, _cB.g, t), lerp(_cA.b, _cB.b, t));
  return _cOut.getHex();
}

/** Blend two resolved themes. Used for smooth narrative transitions. */
export function lerpTheme(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const walk = (x, y) => {
    if (typeof y === 'number') return y; // replaced per-key below
    if (Array.isArray(y)) return y;
    if (y && typeof y === 'object') {
      const out = {};
      for (const k of Object.keys(y)) {
        const av = x?.[k];
        const bv = y[k];
        if (typeof bv === 'number' && typeof av === 'number') {
          out[k] = SCALAR_KEYS.has(k) ? lerp(av, bv, t) : lerpColorHex(av, bv, t);
        } else {
          out[k] = walk(av, bv);
        }
      }
      return out;
    }
    return y;
  };
  const merged = walk(a, b);
  merged.name = t < 0.5 ? a.name : b.name;
  merged.label = t < 0.5 ? a.label : b.label;
  return merged;
}

export class RetroRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{theme?:string, preset?:string}} opts
   */
  constructor(canvas, opts = {}) {
    this.theme = resolveTheme(opts.theme || 'forest');
    this.preset = resolveRenderPreset(opts.preset);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(1); // the internal target controls resolution
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.autoClear = true;
    // No tone mapping: the retro grade in PostFx is the whole look.
    this.renderer.toneMapping = THREE.NoToneMapping;

    // A shader that fails to compile otherwise renders as silent black. Since
    // `psx.js` rewrites three's shader source with string surgery, a three
    // upgrade could break it in exactly that invisible way — so make it loud.
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const log = (s) => gl.getShaderInfoLog(s)?.trim();
      const msg = `[tekerlek] SHADER COMPILE FAILED\nvertex: ${log(vs) || 'ok'}\nfragment: ${log(fs) || 'ok'}`;
      console.error(msg);
      events.emit('render:shaderError', { message: msg });
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.3, 1400);

    this.materials = new MaterialLibrary(this.theme, this.preset);
    this.postfx = new PostFx(this.preset, this.theme);

    this._buildEnvironment();

    this.renderTarget = null;
    this.width = 1;
    this.height = 1;
    this.internalWidth = 1;
    this.internalHeight = 1;

    /** Theme transition state. */
    this._themeFrom = null;
    this._themeTo = null;
    this._themeT = 1;
    this._themeDuration = 0;

    this.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
    this._applyThemeNow(this.theme);
  }

  // -- environment ----------------------------------------------------------

  _buildEnvironment() {
    const t = this.theme;

    this.scene.fog = t.fog.exponential
      ? new THREE.FogExp2(t.fog.color, t.fog.density)
      : new THREE.Fog(t.fog.color, t.fog.near, t.fog.far);
    this.scene.background = new THREE.Color(t.fog.color);

    this.sun = new THREE.DirectionalLight(t.light.color, t.light.intensity);
    this.sun.position.set(t.light.direction.x, t.light.direction.y, t.light.direction.z)
      .normalize()
      .multiplyScalar(200);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Hemisphere instead of flat ambient: the ground bounce colour is what
    // sells "under a forest canopy" versus "in a car park".
    this.hemi = new THREE.HemisphereLight(
      t.light.ambientColor,
      t.light.groundBounce,
      t.light.ambientIntensity
    );
    this.scene.add(this.hemi);

    // Sky dome. Huge, unlit, pinned to the far plane by its shader.
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12),
      this.materials.skyMaterial()
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);
  }

  // -- sizing ---------------------------------------------------------------

  resize(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setSize(this.width, this.height, false);

    const targetH = this.preset.internalHeight || this.height;
    const scale = targetH / this.height;
    this.internalHeight = Math.max(1, Math.round(targetH));
    this.internalWidth = Math.max(1, Math.round(this.width * scale));

    if (this.renderTarget) this.renderTarget.dispose();
    const filter = this.preset.pixelated ? THREE.NearestFilter : THREE.LinearFilter;
    this.renderTarget = new THREE.WebGLRenderTarget(this.internalWidth, this.internalHeight, {
      minFilter: filter,
      magFilter: filter,
      depthBuffer: true,
      stencilBuffer: false,
      type: THREE.UnsignedByteType,
      samples: this.preset.antialias ? 4 : 0,
    });
    this.renderTarget.texture.generateMipmaps = false;

    this.postfx.setSize(this.internalWidth, this.internalHeight);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    events.emit('render:resized', {
      width: this.width,
      height: this.height,
      internalWidth: this.internalWidth,
      internalHeight: this.internalHeight,
    });
  }

  // -- theming --------------------------------------------------------------

  _applyThemeNow(theme) {
    this.theme = theme;

    if (theme.fog.exponential) {
      if (!this.scene.fog?.isFogExp2) this.scene.fog = new THREE.FogExp2(0, 0);
      this.scene.fog.color.set(theme.fog.color);
      this.scene.fog.density = theme.fog.density;
    } else {
      if (this.scene.fog?.isFogExp2 || !this.scene.fog) this.scene.fog = new THREE.Fog(0, 1, 100);
      this.scene.fog.color.set(theme.fog.color);
      this.scene.fog.near = theme.fog.near;
      this.scene.fog.far = theme.fog.far;
    }
    this.scene.background.set(theme.fog.color);

    this.sun.color.set(theme.light.color);
    this.sun.intensity = theme.light.intensity;
    this.sun.position
      .set(theme.light.direction.x, theme.light.direction.y, theme.light.direction.z)
      .normalize()
      .multiplyScalar(200);

    this.hemi.color.set(theme.light.ambientColor);
    this.hemi.groundColor.set(theme.light.groundBounce);
    this.hemi.intensity = theme.light.ambientIntensity;

    this.materials.applyTheme(theme);
    this.materials.setSunDirection(this.sun.position);
    this.postfx.applyTheme(theme);
  }

  /**
   * Change the visual world. `duration` of 0 snaps; anything else cross-fades
   * every colour and light in the scene, which is how the game says
   * "something just changed" without a cut.
   * @param {string} name a theme name from style.js
   */
  setTheme(name, duration = 0) {
    const next = resolveTheme(name);
    if (duration <= 0) {
      this._themeFrom = this._themeTo = null;
      this._themeT = 1;
      this._applyThemeNow(next);
      events.emit('render:theme', { name, immediate: true });
      return;
    }
    this._themeFrom = this.theme;
    this._themeTo = next;
    this._themeT = 0;
    this._themeDuration = duration;
    events.emit('render:theme', { name, immediate: false, duration });
  }

  setRenderPreset(name) {
    this.preset = resolveRenderPreset(name);
    this.materials.applyRenderPreset(this.preset);
    this.postfx.applyPreset(this.preset);
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.resize(this.width, this.height);
  }

  // -- narrative effects ----------------------------------------------------

  /** 0 = clean image, 1 = the simulation is visibly failing. */
  setGlitch(amount) {
    this.postfx.setGlitch(clamp01(amount));
  }

  setFade(amount, color) {
    this.postfx.setFade(clamp01(amount), color);
  }

  // -- frame ----------------------------------------------------------------

  update(dt) {
    if (this._themeTo && this._themeT < 1) {
      this._themeT = Math.min(1, this._themeT + dt / this._themeDuration);
      const blended = lerpTheme(this._themeFrom, this._themeTo, this._themeT);
      this._applyThemeNow(this._themeT >= 1 ? this._themeTo : blended);
      if (this._themeT >= 1) {
        this._themeFrom = this._themeTo = null;
        events.emit('render:themeSettled', { name: this.theme.name });
      }
    }
    this.postfx.update(dt);
  }

  render(camera = this.camera) {
    // Keep the sky centred on the viewer so it never has an edge.
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(camera.far * 0.92);

    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(null);
    this.postfx.render(this.renderer, this.renderTarget.texture);
  }

  /** Convenience: add / remove a mode's root group. */
  addRoot(group) {
    this.scene.add(group);
  }

  removeRoot(group) {
    this.scene.remove(group);
    disposeObject(group);
  }

  dispose() {
    this.renderTarget?.dispose();
    this.postfx.dispose();
    this.materials.dispose();
    this.renderer.dispose();
  }
}

/** Recursively free geometry and any material this object solely owns. */
export function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const m = obj.material;
    if (m && obj.userData.ownsMaterial) {
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  });
}
