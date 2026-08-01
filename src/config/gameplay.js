/**
 * GAMEPLAY — rules, timings and pacing.
 *
 * The story beats live in `src/game/intro/beats.js`; this file holds the
 * *systems* numbers the intro (and everything after it) leans on.
 */

// ---------------------------------------------------------------------------
// RACING
// ---------------------------------------------------------------------------

export const RACE = {
  laps: 2,
  countdownSeconds: 3,
  /** Grid spacing, metres. */
  gridRowGap: 7.0,
  gridColumnGap: 4.2,
  /**
   * Extra gap between the player on pole and the first row of rivals.
   *
   * Must exceed the chase camera's pull-back (`CAMERA_RIGS.chase.offset.z`,
   * currently -7.4) plus a car length, or a rival starts *inside the camera*
   * and the first thing the player sees is the underside of somebody's door.
   */
  poleGap: 14.0,
  /** How far off the racing line before "OFF TRACK" shows, in ribbon half-widths. */
  offTrackFactor: 1.15,
  /** Seconds off-track before the game respawns you (0 disables). */
  respawnAfterOffTrack: 0,
  /** Checkpoint radius in metres — generous, they are a safety net not a test. */
  checkpointRadius: 22,
  /** Wrong-way warning after this many seconds heading backwards. */
  wrongWayDelay: 1.2,
  rivals: 3,
  /**
   * Rubber-banding: AI force multiplier when behind (>1) / ahead (<1) of the
   * player. Keeps the first two races close without feeling scripted.
   */
  rubberBand: { maxAhead: 0.9, maxBehind: 1.14, range: 120 },
};

// ---------------------------------------------------------------------------
// THE THIRD PARKOUR — the scripted break-out
// ---------------------------------------------------------------------------
// Race 3 is a real race with a trap in it. The outer sweeper is iced; the
// barrier there is missing. Once the player leaves the ribbon far enough, the
// intro director takes over. All of this is *observed* by the director — race
// mode itself just reports "the player is way off course".

export const BREAKOUT = {
  /** Lap on which the trap is armed. Before this the ice is only slippery. */
  armedOnLap: 1,
  /** Distance beyond the ribbon edge (metres) that counts as "gone". */
  escapeDistance: 55,
  /** …sustained for this long, so a brief excursion is not enough. */
  escapeHoldSeconds: 1.6,
  /** Seconds before the game *would* normally reset you — never fires here. */
  normalResetDelay: 3.0,
  /** How long the "reset failed" glitch plays before control returns. */
  glitchSeconds: 2.4,
};

// ---------------------------------------------------------------------------
// OPEN WORLD
// ---------------------------------------------------------------------------

export const OPEN_WORLD = {
  /** Radius of the generated world, metres. Beyond it: soft fog wall. */
  radius: 1400,
  /** Terrain heightfield resolution. Higher = finer hills, slower to build. */
  terrainResolution: 220,
  /** Metres between terrain samples. resolution * cellSize = world span. */
  terrainCellSize: 13,
  /** Trees, rocks and grass tufts across the whole world. */
  scatterDensity: { trees: 4200, rocks: 900, bushes: 2400, grass: 5200 },
  /** Draw distance for scattered props, metres. Fog hides the pop-in. */
  scatterDrawDistance: 340,
  /** Seed for world generation — same seed, same world, every time. */
  seed: 0x7e4e17,
  /**
   * How long the player wanders before the sirens start.
   * The user asked for "30-ish seconds"; `sirenDelay` is measured from the
   * moment free control is handed over.
   */
  sirenDelay: 30,
  /** Grace between hearing the siren and the cops actually appearing. */
  sirenToSpawn: 6.5,
};

// ---------------------------------------------------------------------------
// THE CHASE
// ---------------------------------------------------------------------------

export const CHASE = {
  copCount: 2,
  /** Cops spawn this far behind the player, metres. */
  spawnDistance: 145,
  spawnSpread: 30,

  /** Cops get a small edge so the chase is threatening, not trivial. */
  speedAdvantage: 1.04,
  /** …but they lose grip more easily off-road, which is the player's out. */
  offroadPenalty: 0.82,

  /** Below this distance the player is "seen". */
  visionRange: 210,
  /** Cone half-angle in degrees for line of sight. */
  visionConeDeg: 62,
  /** Line of sight is blocked by trees/rocks/terrain within this radius. */
  occlusionCheck: true,

  /**
   * HEAT: 1 = fully on your tail, 0 = lost you.
   * Rises while seen, falls while hidden. Escaping is a heat problem,
   * not a distance problem — hiding in the trees works.
   */
  heat: {
    start: 1.0,
    riseRate: 0.5, // per second while seen
    fallRate: 0.2, // per second while unseen
    /** Below this, cops switch from PURSUE to SEARCH. */
    searchThreshold: 0.55,
    /** Below this, they give up. */
    escapeThreshold: 0.08,
    /** Seconds at/below escapeThreshold before the chase formally ends. */
    escapeHold: 4.0,
  },

  /** Cops search the player's last known position for this long. */
  searchSeconds: 14,
  /** Wander radius while searching, metres. */
  searchRadius: 70,

  /** Ramming: cops nudge you when close. */
  ram: { range: 9.0, force: 5200, cooldown: 2.6 },

  /** Minimum chase length so it always feels like a sequence, seconds. */
  minDuration: 45,
  /** After this long the escape thresholds relax — the player always wins. */
  mercyAfter: 150,
  mercyRate: 1.9,

  /** Siren light flash rate, Hz. */
  sirenFlashHz: 2.6,
};

// ---------------------------------------------------------------------------
// PLAYER STATE
// ---------------------------------------------------------------------------

export const PLAYER = {
  /** Reset-to-track key. Disabled once you are out of the system. */
  respawnKey: 'KeyR',
  respawnDelay: 0.6,
  /** Distance the car may fall below terrain before being rescued. */
  fallRescueDepth: 40,
};

// ---------------------------------------------------------------------------
// DEBUG
// ---------------------------------------------------------------------------

export const DEBUG = {
  /** Show the live tuning panel on boot (also toggled with backtick). */
  panelOnBoot: false,
  /** Draw track ribbons, checkpoints and AI targets. */
  drawGizmos: false,
  /** Print the fixed-step loop's health to the console. */
  logPerformance: false,
  /** Force a mode at boot; overridden by ?scene= in the URL. */
  startScene: null,
  /** Skip the intro entirely; overridden by ?skip=intro. */
  skipIntro: false,
  /** Freeze the siren timer so you can explore in peace. */
  noCops: false,
};

/** Read boot options from the URL so you never have to edit code to test. */
export function readBootOptions(search = globalThis.location?.search || '') {
  const q = new URLSearchParams(search);
  const skip = q.get('skip');
  return {
    scene: q.get('scene') || DEBUG.startScene,
    skipIntro: skip === 'intro' || skip === '1' || skip === 'true' || DEBUG.skipIntro,
    theme: q.get('theme') || null,
    renderPreset: q.get('render') || null,
    rig: q.get('cam') || null,
    seed: q.has('seed') ? Number(q.get('seed')) : null,
    noCops: q.has('nocops') || DEBUG.noCops,
    panel: q.has('panel') || DEBUG.panelOnBoot,
    gizmos: q.has('gizmos') || DEBUG.drawGizmos,
    muted: q.has('mute'),
  };
}
