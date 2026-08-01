/**
 * CAMERA — how the game is FRAMED.
 *
 * A "rig" is a complete camera behaviour. `src/render/cameraRig.js` reads these
 * values every frame, so editing a number here (or in the live tuning panel)
 * changes the shot immediately. Press `C` in game to cycle rigs, `V` to look back.
 *
 * All offsets are in the car's LOCAL space:
 *   +x = car's right, +y = up, +z = the direction the car is FACING.
 *   So a chase camera sits behind the car at negative z.
 */

const DEG = Math.PI / 180;

export const CAMERA_RIGS = {
  /** Default third-person chase. The workhorse — tune this one first. */
  chase: {
    label: 'Chase',
    type: 'follow',

    /** Where the camera wants to sit, relative to the car. */
    offset: { x: 0, y: 3.1, z: -7.4 },
    /** Where it looks, relative to the car. */
    lookAt: { x: 0, y: 1.35, z: 3.2 },

    /**
     * Position smoothing, in "units of catch-up per second". Higher = stiffer,
     * more arcade; lower = floatier, more cinematic. 8–14 is a good window.
     */
    positionStiffness: 9.0,
    /** Rotation smoothing for the direction the rig trails from. */
    rotationStiffness: 6.0,
    /** Aim smoothing. Keep above positionStiffness or the horizon swims. */
    lookStiffness: 12.0,

    /**
     * 0 = the rig is welded to the car's heading (rotates instantly with it).
     * 1 = the rig trails the car's VELOCITY instead, which reads drifts much
     *     better because you see the car go sideways.
     */
    velocityFollow: 0.62,
    /** Ignore velocity direction below this speed (avoids jitter at a stop). */
    velocityFollowMinSpeed: 3.5,

    /** Camera pulls back as you go faster: extra metres at max speed. */
    speedPullback: 2.3,
    /** Camera drops slightly at speed for a flatter, faster read. */
    speedDrop: 0.35,

    /** Field of view. */
    fov: 68,
    /** Extra degrees of FOV at top speed — the main "sense of speed" dial. */
    fovSpeedGain: 16,
    fovStiffness: 3.5,

    /** Roll the camera into corners, in degrees at full lateral load. */
    lateralRollDeg: 3.2,
    /** Sideways drift of the rig when cornering — adds weight. */
    lateralLead: 0.55,

    /** Screen shake response. */
    shakeScale: 1.0,
    /** Extra shake per unit of surface rumble (see SURFACES in tuning.js). */
    rumbleShake: 0.22,

    /** Keep the camera above terrain by at least this much. */
    groundClearance: 0.9,
    /** Pull in if terrain or props block the view. */
    collisionAvoidance: true,

    near: 0.3,
    far: 1400,
  },

  /** Tight and aggressive. Good for the chase sequence. */
  chaseTight: {
    label: 'Chase (tight)',
    inherits: 'chase',
    offset: { x: 0, y: 2.4, z: -5.9 },
    lookAt: { x: 0, y: 1.15, z: 4.0 },
    positionStiffness: 13.0,
    velocityFollow: 0.45,
    fov: 74,
    fovSpeedGain: 20,
    speedPullback: 1.4,
    shakeScale: 1.25,
  },

  /** High and far back. Reads the world; good for open-world wandering. */
  chaseWide: {
    label: 'Chase (wide)',
    inherits: 'chase',
    offset: { x: 0, y: 5.2, z: -11.0 },
    lookAt: { x: 0, y: 1.8, z: 2.0 },
    positionStiffness: 6.0,
    velocityFollow: 0.4,
    fov: 62,
    fovSpeedGain: 10,
    lateralRollDeg: 1.6,
  },

  /** Over the bonnet. */
  hood: {
    label: 'Hood',
    inherits: 'chase',
    offset: { x: 0, y: 1.25, z: 0.55 },
    lookAt: { x: 0, y: 1.2, z: 12.0 },
    positionStiffness: 40.0,
    rotationStiffness: 40.0,
    velocityFollow: 0.0,
    speedPullback: 0,
    speedDrop: 0,
    fov: 76,
    fovSpeedGain: 14,
    lateralRollDeg: 1.2,
    lateralLead: 0,
    shakeScale: 1.4,
    collisionAvoidance: false,
    /** Hide the player's car body from this rig. */
    hideOwner: true,
  },

  /** Bumper cam — very fast, very low. */
  bumper: {
    label: 'Bumper',
    inherits: 'hood',
    offset: { x: 0, y: 0.55, z: 1.9 },
    lookAt: { x: 0, y: 0.6, z: 14.0 },
    fov: 84,
    fovSpeedGain: 18,
    shakeScale: 1.7,
  },

  /**
   * Fixed, distant, slightly detached — used by the intro when the game is
   * "watching" you rather than being played. Also a nice photo mode.
   */
  cinematic: {
    label: 'Cinematic',
    inherits: 'chase',
    type: 'cinematic',
    offset: { x: 6.5, y: 3.4, z: -9.0 },
    lookAt: { x: 0, y: 1.0, z: 0 },
    positionStiffness: 1.6,
    lookStiffness: 3.0,
    velocityFollow: 0.0,
    fov: 46,
    fovSpeedGain: 0,
    speedPullback: 0,
    lateralRollDeg: 0,
    shakeScale: 0.4,
    /** Cinematic-only: slowly orbit the subject, degrees per second. */
    orbitSpeedDeg: 5.5,
  },

  /** Free-flying debug camera. WASD + QE, hold shift to sprint. */
  free: {
    label: 'Free (debug)',
    inherits: 'chase',
    type: 'free',
    moveSpeed: 28,
    sprintMultiplier: 4.0,
    lookSensitivity: 0.0026,
    fov: 70,
    fovSpeedGain: 0,
    shakeScale: 0,
    collisionAvoidance: false,
  },
};

/** The rig the game starts in. */
export const DEFAULT_RIG = 'chase';

/** Order the `C` key cycles through. `free` is intentionally excluded. */
export const CYCLE_ORDER = ['chase', 'chaseTight', 'chaseWide', 'hood', 'bumper', 'cinematic'];

/** Rig used per game mode, if you want a different default per context. */
export const MODE_RIGS = {
  race: 'chase',
  openWorld: 'chaseWide',
  chase: 'chaseTight',
  intro: 'cinematic',
};

/** Look-behind (`V`): swings the rig around the car. */
export const LOOK_BEHIND = {
  yawDeg: 180,
  /** Seconds to swing around and back. */
  transition: 0.14,
  fovBoost: 6,
};

/**
 * Global shake sources. Amplitude is in metres, frequency in Hz.
 * Trigger with `events.emit('camera:shake', { source, scale })`.
 */
export const SHAKE_SOURCES = {
  collision: { amplitude: 0.42, frequency: 24, decay: 5.5 },
  offroad: { amplitude: 0.06, frequency: 17, decay: 1.0 },
  boost: { amplitude: 0.1, frequency: 20, decay: 3.0 },
  siren: { amplitude: 0.05, frequency: 9, decay: 0.9 },
  glitch: { amplitude: 0.55, frequency: 40, decay: 2.0 },
  landing: { amplitude: 0.3, frequency: 18, decay: 6.0 },
};

// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Resolve a rig with its `inherits` chain flattened and angles in radians. */
export function resolveRig(name) {
  const seen = new Set();
  const chain = [];
  let key = name;
  while (key) {
    if (seen.has(key)) throw new Error(`Circular camera rig inheritance at "${key}"`);
    seen.add(key);
    const r = CAMERA_RIGS[key];
    if (!r) throw new Error(`Unknown camera rig "${name}" (missing link: "${key}")`);
    chain.unshift(r);
    key = r.inherits;
  }
  let merged = {};
  for (const r of chain) merged = deepMerge(merged, r);
  delete merged.inherits;
  merged.name = name;
  merged.lateralRoll = (merged.lateralRollDeg || 0) * DEG;
  merged.orbitSpeed = (merged.orbitSpeedDeg || 0) * DEG;
  return merged;
}
