/**
 * CAMERA RIG — turns a rig preset from `src/config/camera.js` into a camera
 * transform, every frame.
 *
 * The rig has no opinions of its own. Every behaviour below is a named field in
 * the preset, so a new shot is a new entry in `CAMERA_RIGS`, never a code change.
 *
 * The one idea worth knowing: the rig trails a *blend* of where the car points
 * and where it is actually going (`velocityFollow`). At 0 the camera is welded
 * behind the nose and drifts are invisible; at 1 it trails the velocity and you
 * watch the car slide sideways across the screen. Around 0.6 reads best.
 */

import * as THREE from 'three';
import { resolveRig, DEFAULT_RIG, CYCLE_ORDER, LOOK_BEHIND, SHAKE_SOURCES } from '../config/camera.js';
import { clamp, clamp01, damp, dampAngle, lerp, shortestAngle, wrapAngle } from '../core/mathx.js';
import { events } from '../core/events.js';

const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} [world] optional; enables ground clearance and view blocking
   */
  constructor(camera, world = null) {
    this.camera = camera;
    this.world = world;
    /** @type {any} the thing being followed — a Vehicle, or anything with .position */
    this.target = null;

    this.rig = resolveRig(DEFAULT_RIG);
    this._rigName = DEFAULT_RIG;

    this._position = new THREE.Vector3(0, 5, -10);
    this._lookAt = new THREE.Vector3();
    this._yaw = 0;
    this._fov = this.rig.fov;
    this._roll = 0;
    this._lookBehind = 0;
    this._orbit = 0;

    /** @type {{amplitude:number,frequency:number,decay:number,phase:number,life:number}[]} */
    this._shakes = [];
    this._shakeOffset = new THREE.Vector3();
    this._time = 0;

    /** Static shot mode, used by the intro. */
    this._static = null;
    /** Free-fly state. */
    this._freeYaw = 0;
    this._freePitch = -0.15;

    /** Player-facing multiplier from the settings menu, on top of each rig's own. */
    this.globalShakeScale = 1;

    /** Extra offsets other systems can push (e.g. a scripted push-in). */
    this.positionBias = new THREE.Vector3();
    this.lookBias = new THREE.Vector3();
    this.fovBias = 0;

    events.on('camera:shake', (p) => this.shake(p?.source || 'collision', p?.scale ?? 1));
  }

  get rigName() {
    return this._rigName;
  }

  setTarget(target) {
    this.target = target;
    if (target?.position) {
      this._position.copy(target.position).add(new THREE.Vector3(0, 4, -8));
      this._lookAt.copy(target.position);
      this._yaw = target.heading ?? 0;
    }
    return this;
  }

  /**
   * @param {string} name a key in CAMERA_RIGS
   * @param {boolean} [snap] jump instantly rather than easing across
   */
  setRig(name, snap = false) {
    this.rig = resolveRig(name);
    this._rigName = name;
    this._static = null;
    if (snap) this._snapNextFrame = true;
    events.emit('camera:rig', { name, label: this.rig.label });
    return this;
  }

  cycleRig(dir = 1) {
    const i = CYCLE_ORDER.indexOf(this._rigName);
    const next = CYCLE_ORDER[(i + dir + CYCLE_ORDER.length) % CYCLE_ORDER.length];
    this.setRig(next);
    return next;
  }

  /** Park the camera. `lookAt` may be a Vector3 or an object with `.position`. */
  setStatic(position, lookAt) {
    this._static = { position: position.clone(), lookAt };
    return this;
  }

  clearStatic() {
    this._static = null;
    return this;
  }

  /** @param {keyof SHAKE_SOURCES} source */
  shake(source, scale = 1) {
    const def = SHAKE_SOURCES[source] || SHAKE_SOURCES.collision;
    this._shakes.push({
      amplitude: def.amplitude * scale * (this.rig.shakeScale ?? 1) * this.globalShakeScale,
      frequency: def.frequency,
      decay: def.decay,
      phase: Math.random() * 100,
      life: 1,
    });
    // Keep the list bounded; the oldest contributes least anyway.
    if (this._shakes.length > 8) this._shakes.shift();
  }

  // -------------------------------------------------------------------------

  update(dt, input = null) {
    this._time += dt;
    this._updateShakes(dt);

    if (this.rig.type === 'free') {
      this._updateFree(dt, input);
      return;
    }
    if (this._static) {
      this._updateStatic(dt);
      return;
    }
    if (!this.target) return;
    this._updateFollow(dt, input);
  }

  _updateShakes(dt) {
    this._shakeOffset.set(0, 0, 0);
    for (let i = this._shakes.length - 1; i >= 0; i--) {
      const s = this._shakes[i];
      s.life -= s.decay * dt;
      if (s.life <= 0) {
        this._shakes.splice(i, 1);
        continue;
      }
      const t = this._time * s.frequency + s.phase;
      const a = s.amplitude * s.life * s.life; // quadratic falloff: snappy, not mushy
      this._shakeOffset.x += Math.sin(t * 1.7) * a;
      this._shakeOffset.y += Math.sin(t * 2.3 + 1.1) * a;
      this._shakeOffset.z += Math.sin(t * 1.3 + 2.7) * a * 0.5;
    }
  }

  _updateFollow(dt, input) {
    const R = this.rig;
    const t = this.target;
    const speed = t.speed ?? t.velocity?.length?.() ?? 0;
    const speedRatio = clamp01(t.speedRatio ?? speed / 50);
    const snap = this._snapNextFrame;
    this._snapNextFrame = false;

    // --- which way is "behind"? ---------------------------------------------
    const heading = t.heading ?? 0;
    let targetYaw = heading;
    if (R.velocityFollow > 0 && speed > (R.velocityFollowMinSpeed ?? 0)) {
      const velYaw = Math.atan2(t.velocity.x, t.velocity.z);
      // Blend by rotating *from* the heading toward the velocity, so the shot
      // never flips when the two are opposed (reversing).
      targetYaw = heading + shortestAngle(heading, velYaw) * R.velocityFollow;
    }
    // Look-behind swings the whole rig, so the car is framed from the front.
    const lb = LOOK_BEHIND;
    const wantBehind = input?.lookBehind ? 1 : 0;
    this._lookBehind = damp(this._lookBehind, wantBehind, 1 / Math.max(lb.transition, 0.01), dt);
    targetYaw += this._lookBehind * lb.yawDeg * (Math.PI / 180);

    if (R.type === 'cinematic' && R.orbitSpeed) {
      this._orbit = wrapAngle(this._orbit + R.orbitSpeed * dt);
      targetYaw += this._orbit;
    }

    this._yaw = snap ? targetYaw : dampAngle(this._yaw, targetYaw, R.rotationStiffness, dt);

    // --- desired position ---------------------------------------------------
    const lateralG = clamp((t.localAccel?.x ?? 0) / (t.tuning?.gravity ?? 24), -2, 2);
    // `applyAxisAngle(Y, yaw)` maps local +X onto (cos, 0, -sin), which is the
    // driver's LEFT. Negate so a positive `offset.x` in a rig preset means what
    // it reads as: move the camera to the right.
    _offset.set(
      -(R.offset.x - lateralG * R.lateralLead),
      R.offset.y - R.speedDrop * speedRatio,
      R.offset.z - R.speedPullback * speedRatio
    );
    _offset.applyAxisAngle(_up, this._yaw);
    _desired.copy(t.position).add(_offset).add(this.positionBias);

    // Never let the camera end up inside a hill.
    if (this.world?.sampleGround) {
      const g = this.world.sampleGround(_desired.x, _desired.z);
      const minY = g.height + R.groundClearance;
      if (_desired.y < minY) _desired.y = minY;
      if (R.collisionAvoidance) this._avoidTerrain(t.position, _desired, R);
    }

    if (snap) {
      this._position.copy(_desired);
    } else {
      this._position.set(
        damp(this._position.x, _desired.x, R.positionStiffness, dt),
        damp(this._position.y, _desired.y, R.positionStiffness, dt),
        damp(this._position.z, _desired.z, R.positionStiffness, dt)
      );
    }

    // --- aim ----------------------------------------------------------------
    _look.set(-R.lookAt.x, R.lookAt.y, R.lookAt.z).applyAxisAngle(_up, this._yaw);
    _look.add(t.position).add(this.lookBias);
    if (snap) this._lookAt.copy(_look);
    else {
      this._lookAt.set(
        damp(this._lookAt.x, _look.x, R.lookStiffness, dt),
        damp(this._lookAt.y, _look.y, R.lookStiffness, dt),
        damp(this._lookAt.z, _look.z, R.lookStiffness, dt)
      );
    }

    // --- lens ---------------------------------------------------------------
    const targetFov =
      R.fov + R.fovSpeedGain * speedRatio + this._lookBehind * lb.fovBoost + this.fovBias;
    this._fov = snap ? targetFov : damp(this._fov, targetFov, R.fovStiffness, dt);

    // Roll into the corner. Small values only — this reads as g-force; large
    // values read as a bug.
    const targetRoll = -lateralG * R.lateralRoll;
    this._roll = damp(this._roll, targetRoll, 4.0, dt);

    // Surface rumble feeds a continuous low-level shake.
    const rumble = (t.surface?.rumble ?? 0) * speedRatio * R.rumbleShake;
    if (rumble > 0.001) {
      this._shakeOffset.x += Math.sin(this._time * 41) * rumble * 0.35;
      this._shakeOffset.y += Math.sin(this._time * 53 + 2) * rumble * 0.35;
    }

    this._commit();
  }

  /**
   * Walk the line from the car to the camera; if the ground rises through it,
   * pull the camera in to that point. Cheap, and terrain is what actually
   * blocks the view in a forest — trees are thin enough to see past.
   */
  _avoidTerrain(from, to, R) {
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const x = lerp(from.x, to.x, k);
      const z = lerp(from.z, to.z, k);
      const y = lerp(from.y, to.y, k);
      const h = this.world.sampleGround(x, z).height + R.groundClearance * 0.6;
      if (y < h) {
        to.set(x, Math.max(y, h), z);
        return;
      }
    }
  }

  _updateStatic(dt) {
    const s = this._static;
    this._position.copy(s.position);
    const look = s.lookAt?.position ?? s.lookAt ?? _tmp.set(0, 0, 0);
    this._lookAt.set(
      damp(this._lookAt.x, look.x, 6, dt),
      damp(this._lookAt.y, look.y, 6, dt),
      damp(this._lookAt.z, look.z, 6, dt)
    );
    this._fov = damp(this._fov, this.rig.fov + this.fovBias, 3, dt);
    this._roll = damp(this._roll, 0, 4, dt);
    this._commit();
  }

  _updateFree(dt, input) {
    const R = this.rig;
    if (input) {
      this._freeYaw -= input.mouseDx * R.lookSensitivity;
      this._freePitch = clamp(this._freePitch - input.mouseDy * R.lookSensitivity, -1.5, 1.5);
      const speed = R.moveSpeed * (input.sprint ? R.sprintMultiplier : 1);
      const fwd = _tmp
        .set(Math.sin(this._freeYaw) * Math.cos(this._freePitch), Math.sin(this._freePitch), Math.cos(this._freeYaw) * Math.cos(this._freePitch))
        .normalize();
      // forward × up, so D strafes right. Same convention as Vehicle#right.
      const right = _desired.set(-Math.cos(this._freeYaw), 0, Math.sin(this._freeYaw));
      this._position.addScaledVector(fwd, input.throttle * speed * dt);
      this._position.addScaledVector(fwd, -input.brake * speed * dt);
      this._position.addScaledVector(right, input.steer * speed * dt);
      this._position.y += (input.lift ?? 0) * speed * dt;
      this._lookAt.copy(this._position).add(fwd);
    }
    this._fov = R.fov;
    this._roll = 0;
    this._commit();
  }

  _commit() {
    const c = this.camera;
    c.position.copy(this._position).add(this._shakeOffset);
    c.up.set(0, 1, 0);
    c.lookAt(this._lookAt);
    if (this._roll !== 0) c.rotateZ(this._roll);
    if (c.fov !== this._fov || c.near !== this.rig.near || c.far !== this.rig.far) {
      c.fov = this._fov;
      c.near = this.rig.near;
      c.far = this.rig.far;
      c.updateProjectionMatrix();
    }
  }

  /** True when the current rig should hide the followed car (cockpit views). */
  get hidesOwner() {
    return !!this.rig.hideOwner;
  }
}
