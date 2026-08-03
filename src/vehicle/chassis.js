/**
 * CHASSIS — the visible car.
 *
 * Deliberately crude: a wedge, a greenhouse, four cylinders. Around 300
 * triangles, which is roughly what a PS1 racer could afford for the car you
 * were actually looking at. All colours come from the theme, so cars restyle
 * with the world.
 *
 * The chassis is purely cosmetic. It reads the vehicle each frame; it never
 * writes to it.
 */

import * as THREE from 'three';
import { GeomBuilder, shade } from '../render/geometry.js';
import { clamp01, lerp } from '../core/mathx.js';
import { CHASE } from '../config/gameplay.js';

const WHEEL_SIDES = 8;

/**
 * @param {object} opts
 * @param {import('../render/materials.js').MaterialLibrary} opts.materials
 * @param {object} opts.theme resolved theme
 * @param {'player'|'rival'|'cop'} [opts.kind]
 * @param {number} [opts.color] body colour override
 * @param {{x:number,y:number,z:number}} opts.halfExtents from the tuning profile
 */
export function createChassis({
  materials,
  theme,
  kind = 'rival',
  color = null,
  halfExtents,
  lightPool = null,
  /**
   * Whether this car gets a real headlight beam. Spot lights are the scarcest
   * thing in the light budget, so only cars the player will actually watch in
   * the dark get one: their own, and the two chasing them.
   *
   * The rivals deliberately do NOT. When the rig fails they keep lapping at
   * racing speed through pitch darkness with their lights off, because they
   * were never using their eyes.
   */
  headlights = kind === 'player' || kind === 'cop',
}) {
  const V = theme.vehicles;
  const bodyColor = color ?? (kind === 'cop' ? V.cop : kind === 'player' ? V.player : V.rivals[0]);
  const accent = kind === 'cop' ? V.copAccent : V.playerAccent;

  const hx = halfExtents.x;
  const hz = halfExtents.z;
  const wheelRadius = 0.34;
  const wheelWidth = 0.26;

  const root = new THREE.Group();
  root.name = `chassis:${kind}`;
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);

  // -- hull ------------------------------------------------------------------
  const b = new GeomBuilder();
  const lowTop = shade(bodyColor, 0.06);
  const lowSide = bodyColor;
  const lowDark = shade(bodyColor, -0.1);

  // Main tub, tapering slightly toward the roof.
  b.addFrustumBox(
    { x: 0, y: 0.32, z: 0 },
    { x: hx * 2, y: 0.62, z: hz * 2 },
    { x: 0.94, z: 0.97 },
    { top: lowTop, side: lowSide, front: lowSide, back: lowDark, bottom: 0x1a1a1c }
  );

  // Nose wedge — the single silhouette cue that says "car" at this poly count.
  b.addFrustumBox(
    { x: 0, y: 0.63, z: hz * 0.62 },
    { x: hx * 1.82, y: 0.16, z: hz * 0.72 },
    { x: 0.9, z: 0.62, offsetZ: 0.12 },
    { top: lowTop, side: lowSide, bottom: lowDark }
  );

  // Greenhouse.
  const glass = V.glass;
  b.addFrustumBox(
    { x: 0, y: 0.86, z: -hz * 0.12 },
    { x: hx * 1.62, y: 0.46, z: hz * 1.02 },
    { x: 0.82, z: 0.7, offsetZ: -0.1 },
    { top: shade(bodyColor, 0.1), side: glass, front: glass, back: glass }
  );

  // Rear deck.
  b.addBox(
    { x: 0, y: 0.7, z: -hz * 0.86 },
    { x: hx * 1.75, y: 0.12, z: hz * 0.3 },
    { all: lowDark, top: lowTop }
  );

  const bodyMesh = new THREE.Mesh(b.build(), materials.carBody(0xffffff));
  bodyMesh.name = 'hull';
  body.add(bodyMesh);

  // -- lights ----------------------------------------------------------------
  // Separate mesh on the emissive material so they punch through fog and night.
  const lightBuilder = new GeomBuilder();
  const headY = 0.6;
  for (const side of [-1, 1]) {
    lightBuilder.addBox(
      { x: side * hx * 0.6, y: headY, z: hz * 0.98 },
      { x: 0.34, y: 0.14, z: 0.08 },
      0xfff3d0
    );
  }
  const brakeStart = lightBuilder.triangleCount;
  for (const side of [-1, 1]) {
    lightBuilder.addBox(
      { x: side * hx * 0.62, y: 0.66, z: -hz * 0.99 },
      { x: 0.3, y: 0.12, z: 0.06 },
      0x7a1410
    );
  }
  const lightGeom = lightBuilder.build();
  const lights = new THREE.Mesh(lightGeom, materials.get('emissive').clone());
  lights.userData.ownsMaterial = true;
  lights.name = 'lights';
  body.add(lights);

  // Brake lights brighten by rewriting their vertex colours — cheaper and more
  // period-appropriate than a second draw call.
  const colorAttr = lightGeom.getAttribute('color');
  const brakeVertexStart = brakeStart * 3;
  const brakeVertexCount = colorAttr.count - brakeVertexStart;

  // -- wheels ----------------------------------------------------------------
  const wheelGeomBuilder = new GeomBuilder();
  wheelGeomBuilder.addCylinder(
    { x: 0, y: 0, z: 0 },
    wheelRadius,
    wheelRadius,
    wheelWidth,
    WHEEL_SIDES,
    { side: V.tyre, top: shade(accent, 0.25), bottom: shade(accent, 0.25) },
    'x'
  );
  // A single bright spoke so wheel rotation is legible at low resolution.
  wheelGeomBuilder.addBox(
    { x: 0, y: 0, z: 0 },
    { x: wheelWidth * 1.04, y: wheelRadius * 1.5, z: wheelRadius * 0.22 },
    shade(accent, 0.35)
  );
  const wheelGeom = wheelGeomBuilder.build();
  const wheelMat = materials.get('prop');

  const wheels = [];
  const wheelX = hx * 0.92;
  const wheelZ = hz * 0.66;
  for (const [ix, iz] of [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    const w = new THREE.Mesh(wheelGeom, wheelMat);
    w.position.set(ix * wheelX, wheelRadius, iz * wheelZ);
    w.userData.front = iz > 0;
    w.name = `wheel${wheels.length}`;
    root.add(w);
    wheels.push(w);
  }

  // -- headlights ------------------------------------------------------------
  // One spot light per car, aimed down the nose. Positioned in world space each
  // frame rather than parented, so the pool can keep every light in the scene
  // root and the light count never changes.
  const headlightLease = headlights ? lightPool?.acquireSpot() ?? null : null;
  if (headlightLease) {
    const L = headlightLease.light;
    L.color.set(0xfff0cc);
    L.distance = 95;
    L.angle = 0.62;
    L.penumbra = 0.55;
    L.decay = 1.25;
  }
  // A faint visible beam. In fog this is most of what sells "headlights on",
  // and it costs one additive cone.
  // ConeGeometry points along +Y with its apex at +h/2. Move the apex to the
  // origin, then swing +Y onto +Z — NEGATIVE quarter turn. A positive one puts
  // the cone behind the car, where it swallows the chase camera and fills the
  // screen with an additive haze that is very hard to recognise as a beam.
  const beamGeom = new THREE.ConeGeometry(4.6, 30, 10, 1, true);
  beamGeom.translate(0, -15, 0);
  beamGeom.rotateX(-Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff0cc,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // BackSide, not DoubleSide: seen from behind the car you look straight down
    // the cone's axis, and drawing both walls doubles the additive contribution
    // into a flat grey disc instead of a beam. The real light on the ground
    // comes from the spot light — this is only the haze around it.
    side: THREE.BackSide,
    fog: true,
  });
  const beam = new THREE.Mesh(beamGeom, beamMat);
  beam.name = 'headlightBeam';
  beam.position.set(0, 0.62, hz);
  beam.visible = false;
  beam.renderOrder = 5;
  body.add(beam);

  // -- cop light bar ---------------------------------------------------------
  let sirenLeft = null;
  let sirenRight = null;
  let leaseA = null;
  let leaseB = null;
  if (kind === 'cop') {
    const barBuilder = new GeomBuilder();
    barBuilder.addBox({ x: 0, y: 1.14, z: -hz * 0.1 }, { x: hx * 1.5, y: 0.07, z: 0.22 }, 0x16161a);
    body.add(new THREE.Mesh(barBuilder.build(), materials.get('prop')));

    const mkLamp = (side, col) => {
      const g = new GeomBuilder();
      g.addBox({ x: side * hx * 0.42, y: 1.21, z: -hz * 0.1 }, { x: hx * 0.6, y: 0.16, z: 0.2 }, col);
      const m = new THREE.Mesh(g.build(), materials.get('emissive').clone());
      m.userData.ownsMaterial = true;
      body.add(m);
      return m;
    };
    sirenLeft = mkLamp(-1, V.copLightA);
    sirenRight = mkLamp(1, V.copLightB);

    // Real light spill from the bar. Leased from the pool rather than created,
    // so two cops arriving does not recompile every material in the world.
    // These are positioned in world space each frame by `update()`.
    leaseA = lightPool?.acquirePoint() ?? null;
    leaseB = lightPool?.acquirePoint() ?? null;
    if (leaseA) leaseA.light.color.set(V.copLightA);
    if (leaseB) leaseB.light.color.set(V.copLightB);
    if (leaseA) leaseA.light.distance = 34;
    if (leaseB) leaseB.light.distance = 34;
    sirenLeft.userData.lease = leaseA;
    sirenRight.userData.lease = leaseB;

    // White door panels so the silhouette reads as police, not just "a dark car".
    const doorBuilder = new GeomBuilder();
    for (const side of [-1, 1]) {
      doorBuilder.addBox(
        { x: side * (hx * 0.95), y: 0.42, z: 0 },
        { x: 0.04, y: 0.3, z: hz * 0.9 },
        V.copAccent
      );
    }
    body.add(new THREE.Mesh(doorBuilder.build(), materials.get('prop')));
  }

  // -- contact shadow --------------------------------------------------------
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(hx * 2.4, hz * 2.2),
    materials.get('shadowBlob')
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  // -- runtime ---------------------------------------------------------------
  let wheelSpin = 0;
  let sirenPhase = 0;
  // NB: three's BufferAttribute has no `userData`. Cache the last written glow
  // level here so we only touch the colour buffer when it actually changes.
  let brakeGlow = -1;

  const chassis = {
    root,
    body,
    wheels,
    kind,
    sirenActive: false,

    /** @param {import('./vehicle.js').Vehicle} v */
    update(v, dt) {
      // Wheels: spin from real distance travelled so they never look detached.
      wheelSpin -= (v.longSpeed / wheelRadius) * dt;
      // NEGATED, and it has to be. `steerAngle > 0` means "turn right" (see the
      // convention note at the top of `vehicle.js`), but the car's object is
      // yawed by `setFromAxisAngle(up, heading)`, which maps local +X onto the
      // driver's LEFT. A positive rotation about local Y therefore points the
      // wheel the opposite way to the one the car is going — the front tyres
      // visibly scrubbed outward through every corner.
      const steer = -v.steerAngle;
      for (const w of wheels) {
        w.rotation.set(0, w.userData.front ? steer : 0, 0);
        w.rotateX(wheelSpin);
      }

      // Brake lights.
      const braking = v.brake > 0.05 || (v.throttle < 0.02 && v.longSpeed > 1);
      const glow = braking ? 1 : 0;
      if (brakeGlow !== glow) {
        brakeGlow = glow;
        const r = lerp(0.16, 1.0, glow);
        const g = lerp(0.02, 0.1, glow);
        for (let i = 0; i < brakeVertexCount; i++) {
          colorAttr.setXYZ(brakeVertexStart + i, r, g, g * 0.6);
        }
        colorAttr.needsUpdate = true;
      }

      // Contact shadow fades as the car leaves the ground.
      const air = clamp01((v.position.y - v.groundHeight - v.tuning.rideHeight) / 3);
      shadow.material.opacity = 0.28 * (1 - air);
      shadow.position.y = v.groundHeight - v.position.y + 0.05;

      if (sirenLeft) {
        sirenPhase += dt * CHASE.sirenFlashHz * Math.PI * 2;
        // Hard alternation, not a sine — sirens strobe, they do not breathe.
        const left = this.sirenActive && Math.sin(sirenPhase) > 0 ? 1 : 0;
        const right = this.sirenActive && Math.sin(sirenPhase) <= 0 ? 1 : 0;
        setLampGlow(sirenLeft, left, V.copLightA);
        setLampGlow(sirenRight, right, V.copLightB);
      }

      // Pooled lights live in the scene root, so drive them from the car's
      // world transform every frame.
      if (leaseA?.inUse || leaseB?.inUse) {
        body.getWorldPosition(_wp);
        if (leaseA?.inUse) leaseA.light.position.set(_wp.x - hx * 0.6, _wp.y + 1.2, _wp.z);
        if (leaseB?.inUse) leaseB.light.position.set(_wp.x + hx * 0.6, _wp.y + 1.2, _wp.z);
      }
      if (headlightLease?.inUse && chassis.headlightsOn) {
        root.getWorldPosition(_wp);
        _fwd.set(Math.sin(v.visualYaw ?? v.heading), 0, Math.cos(v.visualYaw ?? v.heading));
        const L = headlightLease.light;
        L.position.set(_wp.x + _fwd.x * hz, _wp.y + 0.62, _wp.z + _fwd.z * hz);
        // Aim slightly down so the beam lands on the road ahead rather than
        // sailing over it.
        L.target.position.set(
          L.position.x + _fwd.x * 30,
          _wp.y - 1.2,
          L.position.z + _fwd.z * 30
        );
        L.target.updateMatrixWorld();
      }
    },

    setSiren(on) {
      chassis.sirenActive = !!on;
      if (!on && sirenLeft) {
        setLampGlow(sirenLeft, 0, V.copLightA);
        setLampGlow(sirenRight, 0, V.copLightB);
      }
    },

    /** Headlights, and the visible beam that goes with them. */
    headlightsOn: false,
    setHeadlights(on, { intensity = 1 } = {}) {
      chassis.headlightsOn = !!on;
      if (headlightLease?.inUse) headlightLease.light.intensity = on ? 1500 * intensity : 0;
      beam.visible = !!on;
      beamMat.opacity = on ? 0.03 * intensity : 0;
      // The headlight bulbs themselves brighten too, or the car looks unlit
      // from behind.
      const lit = on ? 1 : 0.34;
      for (let i = 0; i < brakeVertexStart; i++) {
        colorAttr.setXYZ(i, lit, lit * 0.96, lit * 0.84);
      }
      colorAttr.needsUpdate = true;
    },

    setVisible(v) {
      root.visible = v;
    },

    /** Hand the leased lights back. Call before discarding the chassis. */
    dispose() {
      leaseA?.release();
      leaseB?.release();
      headlightLease?.release();
      beamGeom.dispose();
      beamMat.dispose();
    },
  };

  // Start dim, so a car with no headlights does not glow in the dark.
  chassis.setHeadlights(false);
  return chassis;
}

const _wp = new THREE.Vector3();
const _fwd = new THREE.Vector3();

const _lampColor = new THREE.Color();
function setLampGlow(mesh, amount, hex) {
  const attr = mesh.geometry.getAttribute('color');
  // Stashed on the mesh, not the attribute — BufferAttribute has no userData.
  if (mesh.userData.glow === amount) return;
  mesh.userData.glow = amount;
  _lampColor.set(hex);
  const dim = 0.12;
  const r = lerp(_lampColor.r * dim, _lampColor.r, amount);
  const g = lerp(_lampColor.g * dim, _lampColor.g, amount);
  const b = lerp(_lampColor.b * dim, _lampColor.b, amount);
  for (let i = 0; i < attr.count; i++) attr.setXYZ(i, r, g, b);
  attr.needsUpdate = true;
  const lease = mesh.userData.lease;
  if (lease?.inUse) lease.light.intensity = amount * 22;
}
