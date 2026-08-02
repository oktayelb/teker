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
  /**
   * Seconds between crossing the line and the results panel appearing. The car
   * keeps rolling and the camera stays on it — a race that cuts to a menu the
   * instant you finish never lets the finish land.
   */
  resultsDelay: 2.8,
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
  /**
   * Metres past the ribbon edge before a car counts as *out of bounds* rather
   * than merely running wide.
   *
   * These are two different questions and they need two different clocks.
   * `offCourseTime` starts at the first centimetre past the edge, which on a
   * dirt parkur is most of the lap — it is the right clock for a warning light
   * and the wrong one for anything that cares whether a car has actually left.
   */
  outOfBoundsDistance: 20,
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
  /**
   * …and held for this long *while out of bounds*, so a brief excursion is not
   * enough. Timed against `outOfBoundsTime`, never against `offCourseTime`:
   * see RACE.outOfBoundsDistance for why the distinction matters.
   */
  escapeHoldSeconds: 1.6,
  /**
   * The slower path in: not far enough out to be unambiguous, but out of bounds
   * for long enough that the player has plainly stopped racing.
   */
  strandedSeconds: 6.0,
  /** Seconds before the game *would* normally reset you — never fires here. */
  normalResetDelay: 3.0,
  /** How long the "reset failed" glitch plays before control returns. */
  glitchSeconds: 2.4,
};

// ---------------------------------------------------------------------------
// TREES — trunk damage, and the disguise
// ---------------------------------------------------------------------------

/**
 * Hit a tree hard enough and it comes down on top of you, and stays there.
 * A car wearing a tree is a car that is not a car any more, which is the whole
 * point: it is how you get out of sight of the recovery units.
 *
 * Damage is KINETIC ENERGY, in joules — ½·mass·speed², measured along the
 * impact normal. Energy rather than momentum matters more than it sounds:
 * because it goes with the square of speed, doubling your speed does four
 * times the damage, and shunting a trunk at walking pace does almost nothing
 * at all. That is the right shape for "hit it hard enough".
 *
 * Damage ACCUMULATES: a trunk remembers every hit it has taken, so a tree you
 * cannot fell in one go can be worried down in three.
 *
 * None of it is switched on at the start. See `breakableBy`: until the first
 * cops are shaken off, every number below is dormant and a tree is just a thing
 * you should not have driven into.
 */
export const TREES = {
  /** Prop kinds with a trunk worth breaking. Rocks and signs are not trees. */
  fellable: ['pine', 'broadleaf', 'dead'],
  /**
   * Trunk capacity per metre of collider radius, in joules.
   *
   * Sizing, so these numbers mean something: the player masses 1100 kg, and a
   * big pine's collider radius is about 1.45 m, a small one's about 0.78 m.
   * At 165000 that is ~239 kJ and ~129 kJ, which in one clean hit is:
   *
   *     small tree  ~55 km/h
   *     big tree    ~75 km/h
   *
   * Anything slower needs a second or third go at the same trunk.
   */
  capacityPerRadius: 165000,
  /**
   * Below this it was a nudge, not a hit — about 14 km/h in the player's car.
   *
   * This floor is doing more work than it looks. Impacts are sampled on a
   * 0.12s cooldown, so a car simply held at full throttle against a trunk
   * re-collides eight times a second. Energy already punishes that far harder
   * than momentum did (a 3 m/s shunt is 5 kJ, not 3300 kg·m/s), but the floor
   * is what makes leaning on a tree do nothing at all.
   */
  minImpactEnergy: 8000,
  /** Lean of a fully-damaged (but still standing) trunk, radians. */
  maxLean: 0.38,
  /** Damaged trunks darken toward this fraction of their original tint. */
  damageTint: 0.55,
  /**
   * How far the worn cover reaches past the car, as a multiple of the car's
   * half-diagonal. 1 would sit flush with the corners of the bodywork; a little
   * over is enough to hide it. It has to clear 1 by a margin rather than sit on
   * it, because the cover is a cone: it is only at full radius right at the
   * skirt, and the widest part of the car sits a bumper's height above that.
   *
   * Width is the cheap axis. Height is what blinds the player — see wornHeight
   * — so concealment is bought here and vision is protected there.
   */
  wornCover: 1.45,
  /**
   * Fraction of the canopy that comes with you, measured up from where the
   * trunk ended. You wear the SKIRT of the tree, not the whole thing — the top
   * of a pine is a spire, and a spire on the roof is a periscope pointed at
   * nothing. The lower tiers are the wide part, which is the part that hides a
   * car.
   */
  wornCanopy: 0.3,
  /**
   * Height of the worn cover as a multiple of the car's overall height.
   *
   * This is the axis that decides whether the player can still drive. Taller
   * would conceal better — a cone is wider at bumper height the taller it is —
   * but it buys that by filling the screen, so concealment is bought on
   * `wornCover` instead and this stays low. A little bodywork showing under
   * the skirt is the accepted cost, and honestly reads better than a perfectly
   * swallowed car.
   */
  wornHeight: 1.5,
  /**
   * A tree lying over the car only hides it while the car is not obviously a
   * car — i.e. while it is barely moving. A pine doing 90 km/h through the
   * forest is not camouflage, it is a parade.
   */
  disguiseSpeed: 4.0,
  /**
   * Shrugging the cover off: handbrake AND throttle, held together for `hold`
   * seconds. A car that stands on the brake and the loud pedal at once is a car
   * that means it, which is exactly the point — the disguise is a trap as well
   * as a tool (it only works parked), so the way out of it must be deliberate
   * enough never to fire by accident and quick enough to use with sirens
   * closing. Both pedals are already read every step; this needs no new key.
   *
   * The hold is what separates "I want out of this" from "I am pulling away
   * gently while still hidden", which is a thing the player is allowed to do.
   */
  shed: { throttle: 0.5, handbrake: 0.5, hold: 0.35 },
  /**
   * Only the car the human is driving can hurt a trunk.
   *
   * Without this the recovery units plough through the forest during the chase
   * and fell trees themselves — and a felled tree lands on whatever felled it,
   * so the cops end up wearing pines. The disguise is the player's answer to
   * the chase; handing it to the chase is a joke, not a mechanic.
   */
  playerOnly: true,
  /**
   * Trunks are indestructible until the first cops are off you.
   *
   * Before that a tree is furniture: it stops a car, it hides a car, and that
   * is all it does. The whole forest going soft during the races would teach
   * the player that scenery is destructible at exactly the moment the game is
   * pretending to be a racing game — and the first chase is meant to be won by
   * breaking line of sight, not by wearing a hat. So the tree damage model,
   * the lean, the splintering and the disguise all switch on together, once,
   * as the reward for getting away.
   *
   * `intro:finished` is the second entry for the no-story paths (`?skip=intro`,
   * the free-roam menu option), where no chase ever happens and the forest
   * would otherwise stay solid forever. Same reasoning as `WILDLIFE.armedBy`.
   */
  breakableBy: ['chase:escaped', 'intro:finished'],
  /**
   * Wearing a felled tree only becomes possible once there is something to hide
   * from — `chase:started`. Before that, trees still come down when you hit
   * them hard enough; they just do not end up on the roof. Handing the player a
   * disguise during the races would explain a mechanic before the story has
   * given them any reason to want it.
   *
   * In the told story this is strictly earlier than `breakableBy` above, so it
   * is `breakableBy` that decides when the disguise first becomes reachable.
   * It matters on its own in free roam, where no chase has ever started.
   */
  armedBy: 'chase:started',
};

// ---------------------------------------------------------------------------
// WILDLIFE — the open world with things living in it
// ---------------------------------------------------------------------------

/**
 * Animals are a POOL, not scenery.
 *
 * Scattering cats across a 1400m disc the way trees are scattered would put
 * roughly none of them where the player is ever looking. Instead a fixed
 * population lives in a ring that follows the camera: anything that falls too
 * far behind is recycled to somewhere ahead. The counts below are therefore how
 * many are near you at any moment, not how many exist in the world — which is
 * why they are small numbers. Seeing a fox should be an event.
 *
 * None of them has a collider. You drive through a butterfly.
 */
export const WILDLIFE = {
  /**
   * Nothing living appears until the cops are off you.
   *
   * The forest holds its breath for the whole chase and only comes back once
   * you are alone in it — which makes the wildlife the reward for getting away
   * rather than set dressing you drove past during the race.
   *
   * `intro:finished` is the second entry for the no-story paths (`?skip=intro`,
   * the free-roam menu option), where no chase ever happens and the world would
   * otherwise stay empty forever.
   */
  armedBy: ['chase:escaped', 'intro:finished'],
  /**
   * Default distance animals live within, metres. Each kind overrides it,
   * because "near enough to see" is not one number: a butterfly is 15cm across
   * and invisible past about forty metres, so spreading butterflies over the
   * same ring as birds spends the whole population where nobody can see it.
   * Small things live close and crowded; birds get the whole sky.
   */
  radius: 140,
  /** Recycled once they fall this far past the radius — hysteresis, so a car
   *  hovering at the boundary does not thrash the pool. */
  margin: 60,
  /** Recycled animals reappear no closer than this, so nothing pops in view. */
  minSpawn: 90,
  kinds: {
    butterfly: {
      count: 15,
      variants: 3,
      radius: 46,
      /** Metres above the ground it hovers. */
      hover: [0.4, 2.2],
      speed: [0.7, 1.6],
      /** How often it changes its mind, seconds. */
      turn: [0.3, 1.1],
      /** Radians per second of body wobble — this is the flutter. */
      wobble: 9,
    },
    bird: {
      count: 6,
      variants: 3,
      radius: 260,
      hover: [16, 34],
      speed: [7, 12],
      /** Birds orbit rather than wander: metres. */
      orbit: [22, 55],
      bank: 0.5,
    },
    cat: { count: 5, variants: 3, radius: 80, hover: [0, 0], speed: [0.8, 1.5], turn: [2.5, 7], idle: [3, 9] },
    fox: { count: 3, variants: 3, radius: 130, hover: [0, 0], speed: [2.2, 4.0], turn: [1.8, 5], idle: [1, 4] },
  },
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
  scatterDensity: {
    trees: 4200,
    rocks: 900,
    bushes: 2400,
    grass: 5200,
    /** Somebody was out here. Sparse on purpose — finding one should register. */
    posters: 140,
    wrecks: 70,
  },
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
    /**
     * Skip the title menu and start the story at a given point.
     * `?start=race3` is the one you want when testing the stage that breaks:
     * unlike `?scene=race3` it runs the *director*, so the blackout, the
     * breakout, the sirens and the chase all still happen.
     */
    start: q.get('start') || null,
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
