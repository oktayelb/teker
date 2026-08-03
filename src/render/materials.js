/**
 * MATERIALS — every surface in the game, derived from the active theme.
 *
 * Geometry is baked with per-face vertex colours (see `src/world/`), and the
 * materials multiply those by a *tint*. That means a theme swap — forest to
 * night, say — is a handful of uniform writes rather than a world rebuild.
 *
 * Ask for materials by ROLE, never by colour:
 *     materials.get('foliage')      ✅
 *     new MeshLambertMaterial(...)  ❌
 */

import * as THREE from 'three';
import { applyPsx, setPsxSnap } from './psx.js';
import { applyVertexWind } from './wind.js';
import { applyGlassFresnel } from './glass.js';

/** Roles that exist in every theme, and where their representative colour lives. */
const ROLE_TINT_SOURCE = {
  terrain: ['ground', 'base'],
  road: ['road', 'surface'],
  foliage: ['foliage', 'canopyA'],
  grass: ['foliage', 'grassBlade'],
  trunk: ['foliage', 'trunk'],
  prop: ['props', 'rock'],
  barrier: ['props', 'barrier'],
  water: ['props', 'water'],
  domeGlass: ['dome', 'glass'],
  carBody: null, // per-instance colour, never tinted by theme
  unlit: null,
  // `domeSeam` is deliberately absent: the seams are the one thing in the world
  // that must read identically in every theme, because they are the only part
  // of a dome you can see from far enough away to understand what it is.
};

function readPath(obj, path) {
  return path ? path.reduce((o, k) => (o ? o[k] : undefined), obj) : undefined;
}

/** Per-channel ratio between two 0xrrggbb colours, clamped to something sane. */
function tintRatio(from, to) {
  const c = new THREE.Color();
  const a = new THREE.Color(from);
  const b = new THREE.Color(to);
  c.setRGB(
    a.r > 0.004 ? Math.min(b.r / a.r, 4) : b.r,
    a.g > 0.004 ? Math.min(b.g / a.g, 4) : b.g,
    a.b > 0.004 ? Math.min(b.b / a.b, 4) : b.b
  );
  return c;
}

export class MaterialLibrary {
  /**
   * @param {object} theme resolved theme (see config/style.js)
   * @param {object} preset resolved render preset
   */
  constructor(theme, preset) {
    this.theme = theme;
    /** The theme the world geometry's vertex colours were baked with. */
    this.bakedTheme = theme;
    this.preset = preset;
    /** @type {Map<string, THREE.Material>} */
    this._cache = new Map();
    /** @type {THREE.Material[]} materials that want PSX treatment */
    this._psx = [];
    /** @type {Map<number, THREE.Material>} car body materials by colour */
    this._carCache = new Map();
    /**
     * Shared wind uniforms. One set for the whole library, so animating every
     * blade of grass in the world is a single float write per frame.
     * `uWindTime` is an accumulated PHASE, not elapsed seconds — the caller
     * integrates `dt * speed` so retuning the speed never jumps the animation.
     */
    this._wind = {
      uWindTime: { value: 0 },
      uWindStrength: { value: 0 },
      uWindScale: { value: 0.05 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
    };
  }

  /** Base constructor for lit surfaces — swappable if you want PBR later. */
  _lit(options = {}) {
    const Mat = this.preset.vertexLighting ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;
    const mat = new Mat({
      vertexColors: true,
      flatShading: this.preset.flatShading,
      fog: true,
      ...options,
    });
    applyPsx(mat, this.preset);
    this._psx.push(mat);
    return mat;
  }

  /** @returns {THREE.Material} */
  get(role) {
    let mat = this._cache.get(role);
    if (mat) return mat;
    mat = this._build(role);
    mat.name = `mat:${role}`;
    this._cache.set(role, mat);
    this._applyTintToRole(role, mat);
    return mat;
  }

  _build(role) {
    switch (role) {
      case 'terrain':
        return this._lit({ dithering: true });

      case 'road':
        // polygonOffset stops the road ribbon z-fighting with the terrain.
        return this._lit({ polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

      case 'roadDecal':
        // Lines and kerbs sit on top of the road.
        return this._lit({ polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });

      case 'foliage':
        return this._lit({ side: THREE.DoubleSide });

      case 'grass':
        // Foliage that bends. Double-sided because a blade is one triangle
        // strip and you are as likely to be looking at its back as its front.
        return applyVertexWind(this._lit({ side: THREE.DoubleSide }), this._wind);

      case 'trunk':
      case 'prop':
      case 'barrier':
        return this._lit();

      case 'water':
        return this._lit({ transparent: true, opacity: 0.82 });

      case 'domeGlass':
        // The panes. Double-sided because you look at a dome from underneath
        // for the whole first half of the game and from on top afterwards, and
        // `depthWrite: false` because a dome is a single convex shell that
        // cannot be sorted against itself — writing depth makes the far half
        // punch holes in the near half. `opacity` is owned by the caller; see
        // `DOME.glassOpacity`. The Fresnel is what stops a low opacity reading
        // as nothing at all when you are stood on it — see `render/glass.js`.
        return applyGlassFresnel(
          this._lit({
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.13,
            depthWrite: false,
          })
        );

      case 'domeSeam':
        // Panel edges, drawn as lines. Unfogged on purpose — the reveal happens
        // at night, three hundred metres out, in fog that eats everything else.
        return new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          fog: false,
        });

      case 'carBody':
        return this._lit();

      case 'unlit':
        return applyPsx(
          new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
          this.preset
        );

      case 'emissive':
        // Siren bulbs, brake lights, the glitch. Ignores fog on purpose so it
        // punches through the murk.
        return new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });

      case 'shadowBlob':
        return new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -8,
          polygonOffsetUnits: -8,
          fog: true,
        });

      default:
        return this._lit();
    }
  }

  /**
   * A per-car body material. Cars are the one place a literal colour is right,
   * because a car's colour is its identity, not its style.
   */
  carBody(color) {
    const key = color >>> 0;
    let mat = this._carCache.get(key);
    if (mat) return mat;
    mat = this._lit({ vertexColors: true, color: new THREE.Color(color) });
    mat.name = `mat:car:${key.toString(16)}`;
    this._carCache.set(key, mat);
    return mat;
  }

  /** Sky dome: vertical gradient plus an optional sun disc. Never fogged. */
  skyMaterial() {
    if (this._cache.has('sky')) return this._cache.get('sky');
    const t = this.theme;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(t.sky.top) },
        uBottom: { value: new THREE.Color(t.sky.bottom) },
        uFog: { value: new THREE.Color(t.fog.color) },
        uSunColor: { value: new THREE.Color(t.sky.sunColor) },
        uSunDir: { value: new THREE.Vector3(0.45, 0.75, 0.3).normalize() },
        uSunSize: { value: t.sky.sunSize },
        uBands: { value: this.preset.colorLevels || 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w; // pin to the far plane
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uBottom, uFog, uSunColor, uSunDir;
        uniform float uSunSize, uBands;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          // Blend into the fog colour near the horizon so the world's edge
          // dissolves instead of ending.
          vec3 col = mix(uBottom, uTop, smoothstep(0.5, 0.95, h));
          col = mix(uFog, col, smoothstep(0.48, 0.72, h));
          if (uSunSize > 0.0) {
            float s = dot(d, normalize(uSunDir));
            col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.25, s);
            col += uSunColor * 0.16 * pow(max(s, 0.0), 22.0);
          }
          if (uBands > 0.0) col = floor(col * uBands + 0.5) / uBands;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    mat.name = 'mat:sky';
    this._cache.set('sky', mat);
    return mat;
  }

  // -- theme swapping -------------------------------------------------------

  _applyTintToRole(role, mat) {
    const path = ROLE_TINT_SOURCE[role];
    if (!path) return;
    const from = readPath(this.bakedTheme, path);
    const to = readPath(this.theme, path);
    if (from === undefined || to === undefined) return;
    mat.color.copy(tintRatio(from, to));
  }

  /**
   * Restyle everything without rebuilding a single mesh.
   * @param {object} theme a resolved theme
   */
  applyTheme(theme) {
    this.theme = theme;
    for (const [role, mat] of this._cache) {
      if (role === 'sky') {
        mat.uniforms.uTop.value.set(theme.sky.top);
        mat.uniforms.uBottom.value.set(theme.sky.bottom);
        mat.uniforms.uFog.value.set(theme.fog.color);
        mat.uniforms.uSunColor.value.set(theme.sky.sunColor);
        mat.uniforms.uSunSize.value = theme.sky.sunSize;
        continue;
      }
      this._applyTintToRole(role, mat);
    }
  }

  /** Live-tuning hook: change the PSX look on every material at once. */
  applyRenderPreset(preset) {
    this.preset = preset;
    for (const mat of this._psx) {
      setPsxSnap(mat, preset.vertexSnap);
      if ('flatShading' in mat) {
        mat.flatShading = preset.flatShading;
        mat.needsUpdate = true;
      }
    }
  }

  // -- wind -----------------------------------------------------------------

  /**
   * Set the wind's shape. Called once, by whoever owns the config for it —
   * this file deliberately does not read `gameplay.js`.
   * @param {{strength:number, scale:number, direction:{x:number,z:number}}} cfg
   */
  configureWind(cfg) {
    if (!cfg) return;
    this._wind.uWindStrength.value = cfg.strength ?? 0;
    this._wind.uWindScale.value = cfg.scale ?? 0.05;
    const d = cfg.direction ?? { x: 1, z: 0 };
    this._wind.uWindDir.value.set(d.x, d.z).normalize();
  }

  /**
   * Advance the wind. `phase` is in radians and only ever increases; the caller
   * integrates it so that changing the speed does not discontinuously jump
   * every blade in the world.
   * @param {number} phase radians
   */
  setWindTime(phase) {
    this._wind.uWindTime.value = phase;
  }

  setSunDirection(vec3) {
    const sky = this._cache.get('sky');
    if (sky) sky.uniforms.uSunDir.value.copy(vec3).normalize();
  }

  dispose() {
    for (const m of this._cache.values()) m.dispose();
    for (const m of this._carCache.values()) m.dispose();
    this._cache.clear();
    this._carCache.clear();
    this._psx.length = 0;
  }
}
