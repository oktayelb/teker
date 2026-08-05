/**
 * WEATHER — rain and snow, as a property of the place you are in.
 *
 * A level's map says `weather: { kind: 'rain', amount: 0.9 }` and gets this.
 * Nothing schedules it, nothing turns it on and off: on bölüm 5 it is raining
 * because bölüm 5 is a wet place, the same way bölüm 3 is a dark one.
 *
 * NOTHING MOVES ON THE CPU
 * -----------------------
 * Same argument as the grass (`render/wind.js`) and the same shape of answer.
 * Two thousand falling drops means two thousand matrices a frame, composed and
 * uploaded, to animate something the player sees for a tenth of a second each.
 * So the instances never move at all: each one is a fixed random point in a
 * box, and the vertex shader does the falling, the wrapping and the billboard.
 * The whole system costs one uniform write per frame, forever.
 *
 * THE BOX FOLLOWS THE CAMERA
 * --------------------------
 * Precipitation is not scattered across the world — it is a column that travels
 * with the viewer, wrapped modulo its own size. Rain everywhere would be a
 * million particles to fill a valley you can only ever see forty metres of in
 * this fog. Wrapping is what makes a small population look like weather: a drop
 * that falls out of the bottom of the box arrives at the top, and one that gets
 * left behind reappears ahead, both of them at a position nobody was looking at.
 *
 * WHY IT IS NOT LIT
 * -----------------
 * Rain is not a surface, it is a smear of the sky, and the theme's fog colour
 * is what the sky is doing. Drops take their colour from it, brightened a
 * little, and fade out at the edge of the box so the column has no wall.
 */

import * as THREE from 'three';

/** Per-kind character. The two are the same system with different physics. */
export const PRECIP = {
  rain: {
    /** Drops in the column at the stated `amount`. */
    count: 2200,
    /** Half-extents of the column, metres. */
    box: { x: 46, y: 26, z: 46 },
    /** Fall speed, m/s. Real rain is 8–9; faster reads as harder weather. */
    fall: 22,
    /** Sideways drift, m/s — the wind, and what makes it slant. */
    drift: { x: 4.5, z: 2.2 },
    /** Streak size, metres: across, and along the fall. */
    size: { x: 0.055, y: 1.5 },
    /** Blend toward white from the fog colour, and how solid a drop is. */
    tint: 0.45,
    opacity: 0.5,
  },
  snow: {
    count: 1500,
    box: { x: 40, y: 24, z: 40 },
    /** Snow does not fall so much as give up. */
    fall: 2.6,
    drift: { x: 1.5, z: 0.9 },
    size: { x: 0.13, y: 0.13 },
    tint: 0.92,
    opacity: 0.75,
    /** Flakes wander on the way down; drops do not. Metres of sway. */
    wander: 1.6,
  },
};

const VERT = /* glsl */ `
  uniform float uTime;
  uniform vec3  uBox;
  uniform vec3  uCam;
  uniform float uFall;
  uniform vec2  uDrift;
  uniform vec2  uSize;
  uniform float uWander;
  varying vec2  vUv;
  varying float vFade;

  void main() {
    // The instance's fixed seed point in the column.
    vec3 seed = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

    // Fall, and drift with the wind. Modulo against the box turns a finite
    // population into weather: leave the bottom, arrive at the top.
    float fallen = uTime * uFall;
    vec3 p;
    p.y = uCam.y + uBox.y - mod(seed.y + fallen, uBox.y * 2.0);
    // …and the column itself is wrapped around the camera, so driving through
    // it never runs out of it.
    p.x = uCam.x + mod(seed.x + uTime * uDrift.x + uBox.x, uBox.x * 2.0) - uBox.x;
    p.z = uCam.z + mod(seed.z + uTime * uDrift.y + uBox.z, uBox.z * 2.0) - uBox.z;

    // Flakes wobble on the way down. Drops have uWander = 0 and skip it.
    if (uWander > 0.0) {
      float phase = seed.x * 3.1 + seed.z * 1.7;
      p.x += sin(uTime * 0.9 + phase) * uWander;
      p.z += cos(uTime * 0.7 + phase * 1.3) * uWander;
    }

    // Billboard in view space: cheap, always edge-on to nobody, and the streak
    // stays vertical on screen because the quad is not rotated into the world.
    vec4 mv = viewMatrix * vec4(p, 1.0);
    mv.xy += position.xy * uSize;

    // Fade at the edge of the column and right on top of the camera, so the
    // box has no visible wall and nothing is drawn across the whole screen.
    float d = length(p.xz - uCam.xz);
    vFade = smoothstep(0.6, 3.0, -mv.z) * (1.0 - smoothstep(uBox.x * 0.55, uBox.x, d));
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uOpacity;
  varying vec2  vUv;
  varying float vFade;

  void main() {
    // Soft ends on the streak — a hard-ended rectangle reads as a scratch on
    // the lens rather than as water moving too fast to see.
    float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float a = uOpacity * vFade * along * across;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Precipitation {
  /**
   * @param {object} opts
   * @param {'rain'|'snow'} [opts.kind]
   * @param {number} [opts.amount] 0..1 — scales the population, not the speed
   * @param {object} opts.theme resolved theme, for the colour
   * @param {number} [opts.seed]
   */
  constructor({ kind = 'rain', amount = 1, theme, seed = 1 }) {
    this.kind = PRECIP[kind] ? kind : 'rain';
    this.cfg = PRECIP[this.kind];
    this.amount = Math.max(0, Math.min(1, amount));
    this.theme = theme;
    this.seed = seed;
    this.root = new THREE.Group();
    this.root.name = `weather:${this.kind}`;
    this.mesh = null;
    this.material = null;
    this._time = 0;
  }

  build() {
    const C = this.cfg;
    const count = Math.max(1, Math.round(C.count * this.amount));

    // A unit quad with its origin in the middle and a v that runs along the
    // fall, so the fragment shader can taper the ends of a streak.
    const geo = new THREE.PlaneGeometry(1, 1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      // Rain in front of a car is between the camera and the world, and it is
      // water: it takes the colour of what is behind it rather than adding to
      // it. Additive would make a downpour glow.
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: new THREE.Vector3(C.box.x, C.box.y, C.box.z) },
        uCam: { value: new THREE.Vector3() },
        uFall: { value: C.fall },
        uDrift: { value: new THREE.Vector2(C.drift.x, C.drift.z) },
        uSize: { value: new THREE.Vector2(C.size.x, C.size.y) },
        uWander: { value: C.wander ?? 0 },
        uColor: { value: new THREE.Color(0xffffff) },
        uOpacity: { value: C.opacity },
      },
    });

    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    // Nothing about this mesh is where three thinks it is — the shader places
    // every instance itself — so culling it against its own bounds would throw
    // the whole column away the moment the camera left the origin.
    this.mesh.frustumCulled = false;
    this.mesh.name = `${this.kind}:column`;

    // Seed points, once. `instanceMatrix` is never written again.
    const m = new THREE.Matrix4();
    let s = this.seed >>> 0 || 1;
    const rnd = () => {
      // xorshift, inline: this is the only random this file needs and it must
      // be deterministic per seed like everything else that builds a world.
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 100000) / 100000;
    };
    for (let i = 0; i < count; i++) {
      m.setPosition(rnd() * C.box.x * 2, rnd() * C.box.y * 2, rnd() * C.box.z * 2);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.root.add(this.mesh);
    this.applyTheme(this.theme);
    return this;
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} [cameraPosition] the column travels with the viewer
   */
  update(dt, cameraPosition = null) {
    if (!this.material) return;
    this._time += dt;
    this.material.uniforms.uTime.value = this._time;
    if (cameraPosition) this.material.uniforms.uCam.value.copy(cameraPosition);
  }

  /**
   * Weather is the colour of the sky it is falling out of, which is the fog.
   * Following the theme means a cross-fade to night takes the rain with it.
   */
  applyTheme(theme) {
    this.theme = theme || this.theme;
    if (!this.material || !this.theme) return;
    const fog = new THREE.Color(this.theme.fog.color);
    const white = new THREE.Color(0xffffff);
    this.material.uniforms.uColor.value.copy(fog).lerp(white, this.cfg.tint);
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.root.clear();
    this.mesh = null;
    this.material = null;
  }
}
