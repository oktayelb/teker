/**
 * TUNING — how the car FEELS.
 *
 * This is the single place to change acceleration, grip, friction, steering and
 * overall pace. Nothing in `src/vehicle/` contains a hard-coded number; every
 * coefficient below is read live, so you can edit values in the debug panel
 * (backtick key) and feel the change immediately.
 *
 * UNITS
 *   distance  metres
 *   time      seconds
 *   speed     m/s  (multiply by 3.6 for km/h — the HUD does this for you)
 *   angle     radians unless the name ends in `Deg`
 *
 * MENTAL MODEL
 *   The car is a point mass with a heading. Velocity is split into the car's
 *   local axes: `forward` (longitudinal) and `right` (lateral).
 *     - Longitudinal is driven by engine / brake / drag.
 *     - Lateral is killed by grip. Grip that runs out = a slide = drift.
 *     - Steering converts speed into yaw rate, not into a force.
 *   That is an arcade model on purpose: it is predictable and easy to tune.
 */

// ---------------------------------------------------------------------------
// VEHICLE PROFILES
// ---------------------------------------------------------------------------
// A profile is a complete feel. Swap the whole car by changing ACTIVE_PROFILE,
// or clone one and edit. `player`, `racer` and `cop` each pick a profile below.

export const PROFILES = {
  /** The default player car: quick, forgiving, slides if you provoke it. */
  hatchback: {
    label: 'Hatchback',

    // -- Mass & size ------------------------------------------------------
    mass: 1100, // kg — mostly affects collision response, not acceleration
    halfExtents: { x: 0.9, y: 0.65, z: 2.05 }, // metres, half of the car's box
    centreOfMassHeight: 0.35, // lower = less body roll in the visual tilt

    // -- Engine / acceleration -------------------------------------------
    engineForce: 12000, // N at full throttle, before the power curve
    reverseForce: 6000, // N when reversing
    maxSpeed: 52, // m/s ≈ 187 km/h — soft cap, drag does the real limiting
    maxReverseSpeed: 14,
    /**
     * Power curve: multiplier on engineForce as a function of speed ratio
     * (currentSpeed / maxSpeed, 0..1). Front-loaded = punchy off the line.
     * Values are sampled at evenly spaced ratios and interpolated.
     */
    powerCurve: [1.0, 1.0, 0.95, 0.85, 0.7, 0.5, 0.32, 0.18, 0.08, 0.0],
    /** Seconds for the throttle to travel 0→1. 0 = instant/twitchy. */
    throttleRise: 0.14,
    throttleFall: 0.22,

    // -- Braking ----------------------------------------------------------
    brakeForce: 20000, // N — service brake
    handbrakeForce: 9000, // N — weaker, but see handbrakeGripScale
    /** While the handbrake is held, rear grip drops to this fraction. */
    handbrakeGripScale: 0.18,

    // -- Resistance (this is your "friction") ------------------------------
    dragCoefficient: 0.42, // quadratic, air resistance: F = -k * v * |v|
    rollingResistance: 6.5, // linear, tyres: F = -k * v
    /** Extra linear damping applied when coasting (no throttle, no brake). */
    engineBraking: 3.2,

    // -- Steering ---------------------------------------------------------
    maxSteerDeg: 34, // steering lock at a standstill
    /**
     * Steering falls off with speed so the car does not become undriveable.
     * effectiveSteer = maxSteer * lerp(1, steerSpeedFalloff, speedRatio)
     */
    steerSpeedFalloff: 0.32,
    steerRise: 7.5, // rad/s the steering angle moves toward the input
    steerReturn: 11.0, // rad/s it snaps back to centre when released
    /** Yaw response: how eagerly steering angle becomes rotation. */
    turnRate: 2.35,
    /**
     * Peak lateral acceleration the tyres can produce, m/s². THIS IS THE
     * UNDERSTEER DIAL.
     *
     * Turning at yaw rate ω while travelling at v needs a lateral acceleration
     * of ω·v. If the tyres cannot supply it, the car simply does not rotate that
     * fast — it runs wide. Multiplied by the surface's grip, so ICE (0.16) caps
     * cornering at about 2.5 m/s² and the car goes straight on no matter how
     * hard the wheel is turned. That is what happens on parkur 3.
     *
     * Roughly: 15.5 ≈ 0.65 g. Raise it for a car that turns in harder.
     */
    maxLateralAccel: 15.5,
    /** Below this speed the car cannot rotate on the spot. */
    minTurnSpeed: 0.6,
    /** Counter-steer assist. 0 = raw, 1 = the car saves you from every spin. */
    stabilityAssist: 0.35,
    /** Angular damping — how fast a spin bleeds out. */
    yawDamping: 3.4,

    // -- Grip (lateral) ---------------------------------------------------
    /** Base lateral friction. Higher = more stuck to the road, less drift. */
    lateralGrip: 14.0,
    /** Grip while the car is sliding — the "drift plateau". Keep < lateralGrip. */
    slideGrip: 5.5,
    /** Lateral speed (m/s) at which the tyres are considered to have broken away. */
    slipThreshold: 4.2,
    /** How quickly grip recovers after a slide ends. */
    gripRecovery: 4.0,

    // -- Airborne ---------------------------------------------------------
    gravity: 24.0, // m/s² — heavier than real gravity feels better in arcade
    airSteerScale: 0.25, // fraction of steering authority while off the ground
    airDrag: 0.12,

    // -- Suspension / visuals ---------------------------------------------
    rideHeight: 0.42,
    suspensionStiffness: 9.0, // how fast the body settles onto the terrain normal
    bodyRollGain: 0.055, // radians of lean per unit of lateral acceleration
    bodyPitchGain: 0.035, // radians of squat/dive per unit of longitudinal accel
    maxBodyRollDeg: 9,
    maxBodyPitchDeg: 7,

    // -- Collision --------------------------------------------------------
    restitution: 0.28, // bounciness against walls/trees
    collisionSpeedLoss: 0.45, // fraction of speed lost on a solid hit
  },

  /** Slower, heavier, more planted. Good for cop cars. */
  cruiser: {
    label: 'Cruiser',
    inherits: 'hatchback',
    mass: 1650,
    halfExtents: { x: 0.98, y: 0.7, z: 2.35 },
    engineForce: 13600,
    maxSpeed: 49,
    powerCurve: [0.82, 0.92, 1.0, 0.95, 0.82, 0.62, 0.42, 0.24, 0.1, 0.0],
    throttleRise: 0.22,
    brakeForce: 22000,
    dragCoefficient: 0.48,
    maxSteerDeg: 30,
    turnRate: 1.95,
    lateralGrip: 15.5,
    slideGrip: 6.5,
    stabilityAssist: 0.55,
    bodyRollGain: 0.07,
  },

  /** Loose and tail-happy. Try `ACTIVE_PROFILE = 'drifter'`. */
  drifter: {
    label: 'Drifter',
    inherits: 'hatchback',
    engineForce: 13500,
    lateralGrip: 9.5,
    slideGrip: 3.4,
    slipThreshold: 2.6,
    turnRate: 2.9,
    stabilityAssist: 0.1,
    yawDamping: 2.4,
    handbrakeGripScale: 0.1,
  },

  /** AI opponents in the scripted races. Slightly slower than the player. */
  rival: {
    label: 'Rival',
    inherits: 'hatchback',
    engineForce: 11200,
    maxSpeed: 48,
    lateralGrip: 15.0,
    stabilityAssist: 0.7,
  },
};

/** Which profile the player drives. */
export const ACTIVE_PROFILE = 'hatchback';

// ---------------------------------------------------------------------------
// SURFACES
// ---------------------------------------------------------------------------
// Every point of the world reports a surface id. Surfaces multiply the tuning
// values above, so a slippery patch is just `grip: 0.35` — no special-casing.
//
// `ICE` and `MUD` are what betray the player on the third parkour: the outer
// sweeper is coated in them so the car understeers off the ribbon. See
// `src/world/tracks/track3.js`.

export const SURFACES = {
  TARMAC: { id: 'TARMAC', grip: 1.0, drag: 1.0, power: 1.0, rumble: 0.0, dustColor: null },
  DIRT: { id: 'DIRT', grip: 0.74, drag: 1.25, power: 0.92, rumble: 0.35, dustColor: 0x8a7355 },
  GRASS: { id: 'GRASS', grip: 0.6, drag: 1.7, power: 0.8, rumble: 0.5, dustColor: 0x5f7a44 },
  MUD: { id: 'MUD', grip: 0.42, drag: 2.3, power: 0.68, rumble: 0.7, dustColor: 0x5b4a35 },
  /**
   * ICE is the most consequential number in this file. It is what takes the
   * third parkour away from the player. At 0.12 the tyres can make roughly
   * 1.9 m/s² of cornering force, so the fast left-hander on `track3` — radius
   * ~115m — is holdable at about 50 km/h and is arrived at above 120.
   * Raising this much above 0.15 quietly breaks the game. `npm test` asserts it.
   */
  ICE: { id: 'ICE', grip: 0.12, drag: 0.5, power: 0.35, rumble: 0.08, dustColor: 0xcfe4ee },
  /** Outside the world's intended bounds. Deliberately wrong-feeling. */
  VOID: { id: 'VOID', grip: 0.85, drag: 0.8, power: 1.05, rumble: 0.15, dustColor: 0x2a2f44 },
};

// ---------------------------------------------------------------------------
// GLOBAL PACE
// ---------------------------------------------------------------------------
// One-stop dials for the overall speed of the game. Multiply, don't rewrite.

export const PACE = {
  /** Global time scale. 0.9 = slightly slower, more readable game. */
  timeScale: 1.0,
  /** Scales every engine/brake force at once. */
  forceScale: 1.0,
  /** Scales every grip value at once. */
  gripScale: 1.0,
  /** Scales world size. Affects track and terrain generation only. */
  worldScale: 1.0,
};

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * Resolve a profile, applying `inherits` chains and derived fields.
 * Call once at spawn; the returned object is a flat, plain snapshot.
 */
export function resolveProfile(name) {
  const seen = new Set();
  const chain = [];
  let key = name;
  while (key) {
    if (seen.has(key)) throw new Error(`Circular profile inheritance at "${key}"`);
    seen.add(key);
    const p = PROFILES[key];
    if (!p) throw new Error(`Unknown vehicle profile "${key}"`);
    chain.unshift(p);
    key = p.inherits;
  }
  const merged = Object.assign({}, ...chain);
  delete merged.inherits;

  // Derived, so systems never recompute conversions.
  merged.maxSteer = merged.maxSteerDeg * DEG;
  merged.maxBodyRoll = merged.maxBodyRollDeg * DEG;
  merged.maxBodyPitch = merged.maxBodyPitchDeg * DEG;
  merged.name = name;
  return merged;
}

/** Sample the power curve at a 0..1 speed ratio. */
export function samplePowerCurve(curve, t) {
  if (!curve || curve.length === 0) return 1;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = clamped * (curve.length - 1);
  const i = Math.min(Math.floor(x), curve.length - 2);
  const f = x - i;
  return curve[i] * (1 - f) + curve[i + 1] * f;
}

export function surfaceById(id) {
  return SURFACES[id] || SURFACES.TARMAC;
}
