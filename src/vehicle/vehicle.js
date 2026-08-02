/**
 * VEHICLE — the arcade car model.
 *
 * Every number this file uses comes from a resolved profile in
 * `src/config/tuning.js`. If the car feels wrong, the fix is there, not here.
 *
 * THE MODEL
 * ---------
 * The car is a point mass with a heading. Once per fixed step we express the
 * world-space velocity in the car's own axes:
 *
 *      vLong  — along the car's nose. Engine, brakes and drag act here.
 *      vLat   — out of the car's side. Only grip acts here.
 *
 * Grip is modelled as damping on `vLat`. Plenty of grip and the car goes where
 * it points. Not enough and `vLat` survives the step — that residue *is* the
 * drift. This is why the feel is so sensitive to `lateralGrip` / `slideGrip`.
 *
 * Steering does not produce a force. It produces a yaw rate, using a bicycle
 * model (`yaw = v/L * tan(steer)`), which is what makes the car unable to turn
 * while stationary without any special-casing.
 *
 * COORDINATE CONVENTION — read this before touching any sign in here.
 *
 *   forward = (sin h, 0, cos h)   — matches `mesh.rotation.y = heading` exactly
 *   right   = forward × up        = (-cos h, 0, sin h)
 *
 * `right` is the DRIVER'S right, which is also the player's screen-right when
 * the camera is behind the car. It is not `(cos h, 0, -sin h)` — that is the
 * driver's *left*, and using it silently mirrors the whole game: the car
 * steers the wrong way, body roll leans the wrong way, and sirens pan to the
 * wrong side. Everything downstream of `right` inherits its sign.
 *
 * Because forward rotates toward `-right` as `h` increases, turning right
 * requires the heading to DECREASE. That is why the steering term below is
 * negated: `command.steer > 0` means "turn right", always.
 */

import * as THREE from 'three';
import { resolveProfile, samplePowerCurve, surfaceById, PACE } from '../config/tuning.js';
import { clamp, clamp01, lerp, moveToward, approach, wrapAngle, shortestAngle } from '../core/mathx.js';
import { events } from '../core/events.js';

const _v = new THREE.Vector3();
const _gravityVec = new THREE.Vector3();
const _slope = new THREE.Vector3();
const _tiltQuat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _probe = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();

/** Commands a driver (human or AI) hands to a vehicle. */
export function createDriveCommand() {
  return { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
}

export class Vehicle {
  /**
   * @param {object} opts
   * @param {string} opts.profile  key into PROFILES
   * @param {object} opts.world    must provide sampleGround(x,z) and collide(pos,r)
   * @param {string} [opts.id]
   */
  constructor({ profile = 'hatchback', world = null, id = 'vehicle' } = {}) {
    this.id = id;
    this.tuning = resolveProfile(profile);
    this.world = world;

    // -- state --------------------------------------------------------------
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.yawRate = 0;

    /** Smoothed control state — NOT the raw command. */
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;

    /** What the driver asked for this step. */
    this.command = createDriveCommand();

    // -- derived, readable by cameras / HUD / audio -------------------------
    this.forward = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundHeight = 0;
    this.grounded = true;
    this.surface = surfaceById('TARMAC');
    /** 0..1 — how far past the grip limit the tyres are. Drives squeal + dust. */
    this.slip = 0;
    /** 0..1 — normalised engine speed, for audio and the HUD. */
    this.rpm01 = 0;
    this.gear = 1;
    /** Signed longitudinal / lateral speed, m/s. */
    this.longSpeed = 0;
    this.latSpeed = 0;
    /** Acceleration felt by the body, used for camera shake and body roll. */
    this.localAccel = new THREE.Vector2(0, 0);
    this.airTime = 0;
    this.disabled = false;
    /** A tree came down on this car and is still lying on it. See world/trees.js. */
    this.disguised = false;
    /**
     * When true the car always drives on TARMAC, whatever it is actually on.
     *
     * This is set on the AI rivals. They are part of the track furniture, not
     * competitors: the ice on the third parkour is not there for them, so they
     * take the corner cleanly while the player's car lets go. The player is the
     * only thing in the world the world's own surfaces apply to — which is the
     * point of the whole game, expressed as one boolean.
     */
    this.ignoreSurfaces = false;
    /** True for the car the human is driving. Used to decide whose crashes
     *  shake the camera. */
    this.isPlayer = false;

    // -- render interpolation ----------------------------------------------
    this._prevPosition = new THREE.Vector3();
    this._prevHeading = 0;
    this._bodyRoll = 0;
    this._bodyPitch = 0;
    this._visualNormal = new THREE.Vector3(0, 1, 0);

    /** The Object3D the world sees. Assigned by `attachChassis`. */
    this.object = new THREE.Group();
    this.object.name = `vehicle:${id}`;
    /** The part that leans; separate so wheels/lights can ignore body roll. */
    this.body = null;

    this._collisionCooldown = 0;
    this._wasGrounded = true;

    // -- collision shape ----------------------------------------------------
    // A car is 1.8m wide and 4.1m long. One circle cannot be both, and a single
    // circle sized to the LENGTH (which this used to do) makes the car behave
    // as if it were 3.5m wide — you clip barriers while still comfortably on
    // the tarmac, and the boxes feel invisible because they are not where you
    // are being stopped.
    //
    // Three circles down the centreline approximate a capsule: correct width,
    // correct length, and it costs three cheap grid lookups.
    const T = this.tuning;
    this.collisionRadius = T.halfExtents.x * 1.04;
    const reach = T.halfExtents.z - this.collisionRadius;
    /** Local +Z offsets of each probe, rear to front. */
    this.collisionProbes = [-reach, 0, reach];
    this.collisionHeight = T.halfExtents.y * 2;
  }

  /** World position of collision probe `i`. */
  probePosition(i, out = _probe) {
    return out.copy(this.position).addScaledVector(this.forward, this.collisionProbes[i]);
  }

  get speed() {
    return this.velocity.length();
  }

  /** Speed as a 0..1 fraction of this car's top speed. */
  get speedRatio() {
    return clamp01(this.speed / this.tuning.maxSpeed);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  attachChassis(chassis) {
    this.object.add(chassis.root);
    this.chassis = chassis;
    this.body = chassis.body;
    return this;
  }

  /** Hard reset — used by the grid, respawns, and the intro. */
  reset(position, heading = 0) {
    this.position.copy(position);
    this._prevPosition.copy(position);
    this.velocity.set(0, 0, 0);
    this.heading = heading;
    this._prevHeading = heading;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.slip = 0;
    this.rpm01 = 0;
    this.airTime = 0;
    this._bodyRoll = 0;
    this._bodyPitch = 0;
    this._updateBasis();
    this._sampleGround();
    this.position.y = this.groundHeight + this.tuning.rideHeight;
    this._prevPosition.copy(this.position);
    this._visualNormal.copy(this.groundNormal);
    this.syncVisual(1);
    return this;
  }

  /** Hand the vehicle its controls for this step. */
  setCommand(cmd) {
    this.command.throttle = clamp01(cmd.throttle || 0);
    this.command.brake = clamp01(cmd.brake || 0);
    this.command.steer = clamp(cmd.steer || 0, -1, 1);
    this.command.handbrake = clamp01(cmd.handbrake || 0);
  }

  _updateBasis() {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    this.forward.set(s, 0, c);
    // right = forward × up. See the convention note at the top of this file.
    this.right.set(-c, 0, s);
  }

  _sampleGround() {
    if (!this.world?.sampleGround) {
      this.groundHeight = 0;
      this.groundNormal.set(0, 1, 0);
      this.surface = surfaceById('TARMAC');
      return;
    }
    const g = this.world.sampleGround(this.position.x, this.position.z);
    this.groundHeight = g.height;
    this.groundNormal.copy(g.normal);
    this.surface = surfaceById(this.ignoreSurfaces ? 'TARMAC' : g.surface);
  }

  // -------------------------------------------------------------------------
  // FIXED STEP
  // -------------------------------------------------------------------------

  fixedUpdate(dt) {
    if (this.disabled) return;
    const T = this.tuning;

    this._prevPosition.copy(this.position);
    this._prevHeading = this.heading;
    this._collisionCooldown = Math.max(0, this._collisionCooldown - dt);

    this._updateBasis();
    this._sampleGround();

    // -- ground contact -----------------------------------------------------
    // Ground *sticking*, not a plain height test.
    //
    // A fixed tolerance looks obviously right and is quietly disastrous: going
    // downhill, the ground falls away faster than gravity pulls the car down
    // within a single 8ms step, so the car reads as airborne on every step of
    // every descent — losing drive, losing grip, and losing the yaw ceiling
    // that makes surfaces mean anything. The car does not visibly leave the
    // ground, so it presents as "handling is strangely floaty downhill".
    //
    // The tolerance therefore has to scale with how far the car travels in a
    // step. Capping it there is also what preserves real jumps: a crest sharp
    // enough to drop away faster than this still launches the car.
    const restY = this.groundHeight + T.rideHeight;
    const wasGrounded = this.grounded;
    const gap = this.position.y - restY;
    const stick = 0.12 + this.speed * dt * 0.9;
    const rising = this.velocity.y > 2.0;
    this.grounded = gap <= (wasGrounded ? stick : 0.08) && !rising;
    if (this.grounded) {
      if (gap > 0) {
        this.position.y = restY;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
      this.airTime = 0;
      if (!wasGrounded) this._onLanding();
    } else {
      this.airTime += dt;
    }

    // -- smooth the driver's inputs ----------------------------------------
    // Rate limiting here (not in the input layer) means AI drivers get exactly
    // the same mechanical response as the player.
    this.throttle = approach(this.throttle, this.command.throttle, T.throttleRise, T.throttleFall, dt);
    this.brake = approach(this.brake, this.command.brake, 0.06, 0.1, dt);
    this.handbrake = this.command.handbrake;

    const speedRatio = this.speedRatio;
    // Steering lock shrinks with speed, otherwise the car is undriveable fast.
    const steerLimit = T.maxSteer * lerp(1, T.steerSpeedFalloff, speedRatio);
    const targetSteer = this.command.steer * steerLimit;
    const returning = Math.abs(this.command.steer) < 0.01 ||
      Math.sign(this.command.steer) !== Math.sign(this.steerAngle);
    const steerRate = (returning ? T.steerReturn : T.steerRise) * steerLimit;
    this.steerAngle = moveToward(this.steerAngle, targetSteer, steerRate * dt);

    // -- split velocity into the car's own axes -----------------------------
    const vLong = this.velocity.dot(this.forward);
    const vLat = this.velocity.dot(this.right);
    this.longSpeed = vLong;
    this.latSpeed = vLat;

    const surf = this.surface;
    const forceScale = PACE.forceScale;

    // -- longitudinal -------------------------------------------------------
    // Forces are in newtons; dividing by mass turns each into an acceleration.
    let longAccel = 0;
    if (this.grounded) {
      const reversing = this.brake > 0.1 && vLong < 0.6;
      if (this.throttle > 0.001 && !reversing) {
        const curve = samplePowerCurve(T.powerCurve, clamp01(vLong / T.maxSpeed));
        longAccel += (T.engineForce * this.throttle * curve * surf.power * forceScale) / T.mass;
      }
      if (reversing) {
        // Reverse is a separate, weaker drive rather than negative throttle.
        if (-vLong < T.maxReverseSpeed) {
          longAccel -= (T.reverseForce * this.brake * surf.power * forceScale) / T.mass;
        }
      } else if (this.brake > 0.001 && vLong > 0.2) {
        // Brakes are limited by grip: you cannot stop hard on ice.
        longAccel -= (T.brakeForce * this.brake * surf.grip * forceScale) / T.mass;
      }
      if (this.handbrake > 0.001) {
        longAccel -=
          ((T.handbrakeForce * this.handbrake * surf.grip * forceScale) / T.mass) * Math.sign(vLong);
      }
      // Coasting. `engineBraking` is deceleration in m/s² at top speed, falling
      // off linearly — so lifting off is a decision, not a cliff.
      if (this.throttle < 0.01 && this.brake < 0.01 && this.handbrake < 0.01) {
        longAccel -= T.engineBraking * (vLong / T.maxSpeed);
      }
    }

    // Resistance always applies, on the ground or in the air.
    //   drag    F = -k·v·|v|   (air)
    //   rolling F = -k·v       (tyres, ground only)
    const dragK = this.grounded ? T.dragCoefficient * surf.drag : T.airDrag;
    longAccel -= (dragK * vLong * Math.abs(vLong)) / T.mass;
    if (this.grounded) longAccel -= (T.rollingResistance * surf.drag * vLong) / T.mass;

    // -- lateral (grip) -----------------------------------------------------
    // Grip is damping on vLat. `1 - exp(-k dt)` keeps it stable at any dt and
    // cannot overshoot, which a naive `vLat -= grip * dt` absolutely can.
    let latAccel = 0;
    if (this.grounded) {
      const sliding = Math.abs(vLat) > T.slipThreshold;
      let grip = (sliding ? T.slideGrip : T.lateralGrip) * surf.grip * PACE.gripScale;
      if (this.handbrake > 0.001) grip *= lerp(1, T.handbrakeGripScale, this.handbrake);
      const shed = 1 - Math.exp(-grip * dt);
      latAccel = (-vLat * shed) / dt;
      this.slip = clamp01(Math.abs(vLat) / (T.slipThreshold * 2));
    } else {
      this.slip = 0;
    }

    // -- yaw ----------------------------------------------------------------
    // Bicycle model: turn radius follows wheelbase and steering angle, so the
    // car naturally refuses to rotate when it is not moving.
    const wheelbase = T.halfExtents.z * 1.55;
    const steerAuthority = this.grounded ? 1 : T.airSteerScale;
    // `targetYaw` is a HEADING rate. Steering right (positive) must decrease the
    // heading, because forward rotates toward the driver's *left* as h grows —
    // hence the leading minus. See the convention note at the top of the file.
    let targetYaw = 0;
    if (Math.abs(vLong) > T.minTurnSpeed) {
      targetYaw = -(vLong / wheelbase) * Math.tan(this.steerAngle) * T.turnRate * steerAuthority;
    }

    // Stability assist nudges the nose toward where the car is actually going.
    // At 0 the car will happily spin; at 1 it is on rails. It is scaled by grip
    // because an electronic aid still has to ask the tyres for the force.
    if (this.grounded && T.stabilityAssist > 0 && this.speed > 2) {
      const velHeading = Math.atan2(this.velocity.x, this.velocity.z);
      const drift = shortestAngle(this.heading, velHeading);
      targetYaw += drift * T.stabilityAssist * surf.grip * clamp01(this.speed / 12) * 2.2;
    }

    // THE GRIP CEILING — and this must come last, after every contribution.
    //
    // Rotating at ω while travelling at v demands a lateral acceleration of ω·v
    // from the tyres, and they cannot make more than `maxLateralAccel × grip`.
    // Anything that wants to turn the car — steering, the stability assist, a
    // future handbrake-turn assist — has to pass through here, or it is
    // conjuring grip that the surface does not have.
    //
    // This single clamp is what turns ICE from "the car pirouettes" into "the
    // car goes straight on regardless of what you do with the wheel", which is
    // the entire mechanism of the third parkour.
    if (this.grounded) {
      const maxLatAccel = T.maxLateralAccel * surf.grip * PACE.gripScale;
      const maxYaw = maxLatAccel / Math.max(this.speed, 1);
      targetYaw = clamp(targetYaw, -maxYaw, maxYaw);
    }

    this.yawRate = lerp(this.yawRate, targetYaw, 1 - Math.exp(-T.yawDamping * dt));

    // -- integrate ----------------------------------------------------------
    // Rebuild the world-space velocity from the updated local components.
    _v.copy(this.forward).multiplyScalar(longAccel * dt);
    _v.addScaledVector(this.right, latAccel * dt);
    this.velocity.add(_v);

    const gravity = T.gravity * PACE.forceScale;
    if (this.grounded) {
      // On a slope, gravity's in-plane component pulls you downhill. Without
      // this, hills are decorative.
      _gravityVec.set(0, -gravity, 0);
      _slope.copy(this.groundNormal).multiplyScalar(_gravityVec.dot(this.groundNormal));
      _slope.subVectors(_gravityVec, _slope);
      this.velocity.addScaledVector(_slope, dt);
    } else {
      this.velocity.y -= gravity * dt;
    }

    // Soft top-speed clamp on the horizontal plane only, so falling is free.
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const cap = T.maxSpeed * 1.15;
    if (horizSpeed > cap) {
      const k = cap / horizSpeed;
      this.velocity.x *= k;
      this.velocity.z *= k;
    }

    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    this.position.addScaledVector(this.velocity, dt);

    // -- resolve ground -----------------------------------------------------
    this._updateBasis();
    this._sampleGround();
    const newRestY = this.groundHeight + T.rideHeight;
    const newGap = this.position.y - newRestY;
    // Same sticking rule as above, so `grounded` is already correct when the
    // next step reads it and the two ends of the step cannot disagree.
    if (newGap < 0 || (this.grounded && newGap <= stick && !rising)) {
      this.position.y = newRestY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    }

    this._resolveCollisions(dt);

    // -- readouts for other systems -----------------------------------------
    this.localAccel.set(latAccel, longAccel);
    const revSpeed = Math.abs(vLong);
    // Fake a gearbox: rpm sweeps and resets so the engine note has shape.
    const gearCount = 5;
    const perGear = T.maxSpeed / gearCount;
    this.gear = clamp(Math.floor(revSpeed / perGear) + 1, 1, gearCount);
    const inGear = (revSpeed - (this.gear - 1) * perGear) / perGear;
    this.rpm01 = clamp01(0.18 + inGear * 0.82 + this.throttle * 0.08);
    if (revSpeed < 0.5) this.rpm01 = 0.14 + this.throttle * 0.5;
  }

  _onLanding() {
    const impact = clamp01(-this.velocity.y / 22);
    if (impact > 0.08) {
      events.emit('camera:shake', { source: 'landing', scale: impact });
      events.emit('vehicle:landed', { id: this.id, impact, position: this.position });
    }
  }

  _resolveCollisions(dt) {
    if (!this.world?.collide) return;

    // Test each probe and keep the deepest overlap. Resolving all of them would
    // double-count a corner shared between two probes and fire the car away.
    let best = null;
    let bestProbe = 0;
    for (let i = 0; i < this.collisionProbes.length; i++) {
      const hit = this.world.collide(this.probePosition(i), this.collisionRadius);
      if (hit && (!best || hit.depth > best.depth)) {
        // Keep the collider: what was hit matters, not just that something was.
        // A trunk keeps score of the hits it takes — see world/trees.js.
        best = { normal: _hitNormal.copy(hit.normal), depth: hit.depth, collider: hit.collider };
        bestProbe = this.collisionProbes[i];
      }
    }
    if (!best) return;
    const hit = best;

    const T = this.tuning;
    // Push out of the obstacle.
    this.position.addScaledVector(hit.normal, hit.depth);

    const into = this.velocity.dot(hit.normal);
    if (into < 0) {
      // Reflect the component going into the surface, keep the rest, then bleed
      // speed. Sliding along a wall should be survivable; hitting it head-on
      // should not.
      const headOn = clamp01(-into / Math.max(this.speed, 0.001));
      this.velocity.addScaledVector(hit.normal, -into * (1 + T.restitution));
      this.velocity.multiplyScalar(1 - T.collisionSpeedLoss * headOn * headOn);

      const intensity = clamp01((-into * headOn) / 18);
      if (intensity > 0.05 && this._collisionCooldown <= 0) {
        this._collisionCooldown = 0.12;
        // Report the blow to the world as kinetic energy along the normal,
        // ½mv² in joules — not momentum. Damage that goes with the square of
        // speed is what makes "hard enough" mean anything.
        //
        // The cooldown above is what makes this one *hit* rather than one per
        // physics step: a car leaning on a trunk at 120Hz would otherwise fell
        // it instantly.
        if (hit.collider && this.world.onImpact) {
          this.world.onImpact(this, hit.collider, 0.5 * T.mass * into * into);
        }
        events.emit('camera:shake', { source: 'collision', scale: intensity });
        events.emit('vehicle:collision', {
          id: this.id,
          intensity,
          position: this.position.clone(),
          normal: hit.normal.clone(),
        });
      }
      // A glancing blow should also scrub some rotation, or hits feel weightless.
      this.yawRate *= 1 - 0.5 * headOn;

      // Hitting a wall with the nose should turn the car. Which probe made
      // contact tells us where the impulse was applied, and the lever arm about
      // the centre of mass does the rest — clipping a barrier with a front
      // corner now spins you in, which is what you expect it to do.
      const lever = hit.normal.dot(this.right) * bestProbe;
      this.yawRate -= lever * Math.abs(into) * 0.05;
    }
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  /**
   * Push the physics state onto the Object3D, interpolated between the last two
   * fixed steps so motion is smooth regardless of framerate.
   * @param {number} alpha 0..1 progress through the current fixed step
   * @param {number} [dt] frame time, for body-lean smoothing
   */
  syncVisual(alpha, dt = 0.016) {
    const T = this.tuning;
    const o = this.object;

    o.position.lerpVectors(this._prevPosition, this.position, alpha);
    const yaw = this._prevHeading + shortestAngle(this._prevHeading, this.heading) * alpha;
    this.visualYaw = yaw;

    // Lie the car down on the terrain, lazily — snapping to every polygon
    // normal looks like a bug. Built as a quaternion so the yaw stays exact;
    // an Euler triple would let pitch and roll fight the heading.
    const towards = this.grounded ? this.groundNormal : _up;
    this._visualNormal.lerp(towards, 1 - Math.exp(-(this.grounded ? 6 : 3) * dt)).normalize();
    _tiltQuat.setFromUnitVectors(_up, this._visualNormal);
    o.quaternion.setFromAxisAngle(_up, yaw).premultiply(_tiltQuat);

    if (!this.body) return;

    // Lean into corners and squat under braking. Purely cosmetic, but it is a
    // large part of why a car "has weight". Accelerations are normalised by
    // gravity first, so the gains read as "radians of lean per g".
    const g = T.gravity;
    const targetRoll = clamp((-this.localAccel.x / g) * T.bodyRollGain, -T.maxBodyRoll, T.maxBodyRoll);
    const targetPitch = clamp((-this.localAccel.y / g) * T.bodyPitchGain, -T.maxBodyPitch, T.maxBodyPitch);
    const k = 1 - Math.exp(-T.suspensionStiffness * dt);
    this._bodyRoll += (targetRoll - this._bodyRoll) * k;
    this._bodyPitch += (targetPitch - this._bodyPitch) * k;
    this.body.rotation.set(this._bodyPitch, 0, this._bodyRoll);

    if (this.chassis?.update) this.chassis.update(this, dt);
  }

  /** Where the car will be in `t` seconds, ignoring input. For AI and cameras. */
  predict(t, out = new THREE.Vector3()) {
    return out.copy(this.position).addScaledVector(this.velocity, t);
  }
}
