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
// THE DOMES — what the parkours were always under
// ---------------------------------------------------------------------------

/**
 * Every parkour sits under a glass dome, and always did.
 *
 * While the game is still pretending, the domes are invisible and inert: you
 * are inside one, being raced round it, and nothing about it is available to
 * you. After the break-out they are the answer to a question the open world
 * would otherwise have to fudge — "what stops the player driving back onto a
 * live race?" Nothing stops them. The race is simply under sixty metres of
 * glass, and the glass holds their weight.
 *
 * THE ONE RULE THAT MAKES IT WORK
 * ------------------------------
 * A dome is solid for a car only once that car has been *outside* it. You
 * escaped from under parkur 3, so its dome is nothing to you right up until the
 * moment you clear the rim — at which point it closes behind you and you can
 * never get back under. See `src/world/dome.js`.
 */
export const DOME = {
  enabled: true,
  /**
   * Footprint: the parkour's own extent, plus this much forest, metres. The
   * radius is derived from the track rather than authored, so moving a control
   * point moves the dome with it.
   */
  margin: 45,
  /** Apex height as a fraction of the footprint radius. */
  heightFactor: 0.2,
  /**
   * Shape of the shell: `height * (1 - u²)^exponent`, u = radius fraction.
   *
   * ONE is not a placeholder — it is a paraboloid, the flattest shape that still
   * meets the ground at a finite angle, and it is chosen for HEADROOM. A loop
   * parkour sits near the edge of its own footprint (u ≈ 0.86), so this exponent
   * is what decides how much glass there is over the racing line: at 1.0 about
   * seventeen metres, at 1.5 about nine. The pines out here are thirteen. Raise
   * it and the forest starts growing through the roof.
   */
  profileExponent: 1.0,
  /**
   * Blur passes over the shell's terrain base. See `Dome#_sampleShell` — this is
   * what keeps a dome a dome rather than a glass copy of the hills under it.
   *
   * Anchored to the raw heightfield the flanks reach 40–44° and a tenth of the
   * roof is unclimbable. At 30 the median is 10–13°, the 99th percentile is
   * about 30°, and roughly one percent is steeper than that. Past 30 passes the
   * numbers barely move and the dome starts ignoring the valley it sits in.
   */
  basePasses: 30,
  /**
   * No tree is planted where the glass would cut through it. The band that gets
   * cleared is wherever the shell stands less than this far off the ground — a
   * little over the tallest pine. Somebody had to clear a ring to seat the
   * thing, and the alternative is trunks skewering the panes.
   */
  treeClearance: 15,
  /**
   * Shell tessellation. This is also the lattice the *physics* reads, so the
   * glass you can see and the glass you are driving on are the same surface by
   * construction rather than by agreement — see `Dome#heightAt`. Ring spacing
   * wants to stay near the terrain's own cell size (13m) or the shell stops
   * following the ground it is anchored to.
   */
  rings: 26,
  segments: 96,
  /**
   * How far the rim is sunk into the earth, metres.
   *
   * The shell is anchored to the terrain, and the terrain is not flat. Landing
   * the rim exactly on the ground means it hovers a metre or two above every
   * hollow, and a hovering rim is a step you hit at 40 m/s. Sunk, the shell
   * simply emerges out of the hillside wherever it is going to — the ground
   * wins until the glass is genuinely above it, and there is no edge anywhere.
   */
  groundBite: 1.5,
  /**
   * The panels are drawn coarser than the mesh: a seam every this many rings
   * and this many segments. The lines still run along every lattice vertex, so
   * they lie on the surface rather than chording across it.
   */
  seamRingStep: 2,
  seamSegmentStep: 3,
  /**
   * Metres past the rim before the dome counts as closed behind you. Enough
   * that you are clear of it and can see what you just came out of.
   */
  sealMargin: 25,
  /**
   * THE DIAL. Panel opacity, 0..1. At 0.08 the glass is a visible pane you can
   * see the race lights through; drop it toward 0.02 for something nearer to
   * clear glass, where the seams do all the work.
   */
  glassOpacity: 0.13,
  /**
   * How much brighter a pane gets when you are looking ALONG it rather than
   * through it, as a multiple of `glassOpacity`, and how sharply it gets there.
   *
   * This is the other half of the dial above, and the reason the first one can
   * stay low. Flat alpha cannot be both: at 0.13 the roof under the car is
   * invisible, and at 0.5 you cannot see the race you climbed up here to watch.
   * Real glass is clear face-on and a sheet of sky edge-on, and so is this — so
   * the surface you are standing on reads solid while the pane you are looking
   * straight down through stays a window. See `src/render/glass.js`.
   */
  glassRim: 5.0,
  glassRimPower: 3.0,
  /** Seam opacity. The seams are emissive and unfogged — they carry at range. */
  seamOpacity: 0.55,
  /** Seconds the glass takes to resolve when it is finally revealed. */
  revealSeconds: 0.4,
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
  /** Trees, rocks and undergrowth across the whole world. */
  scatterDensity: {
    trees: 4200,
    rocks: 900,
    bushes: 2400,
    /** The understorey. Placed only within `understoreyRadius` of a trunk. */
    ferns: 1600,
    undergrowth: 1500,
    litter: 1700,
    /** Somebody was out here. Sparse on purpose — finding one should register. */
    posters: 140,
    wrecks: 70,
  },
  /**
   * How far from a trunk ferns, undergrowth and leaf litter will grow, metres.
   *
   * This is what makes the understorey an *understorey* rather than a second
   * even scattering: the trees go down first, and everything low is then only
   * offered ground within this radius of one of them. Widen it and the forest
   * floor becomes a meadow; narrow it and you get neat rings around trunks.
   */
  understoreyRadius: 15,
  /** Draw distance for scattered props, metres. Fog hides the pop-in. */
  scatterDrawDistance: 340,

  /**
   * GROUND COVER — grass that is actually there.
   *
   * Grass used to be scattered like trees: 5200 tufts over a 2860m span, one
   * per 1500m², which is a tuft every forty metres and therefore no grass at
   * all. Scattering ten times more would cost ten times the memory to fill a
   * world you can never see one percent of at once.
   *
   * So it is a POOL, the way `WILDLIFE` is. A fixed population lives in bands
   * that follow the camera; anything that falls out of its band is reflected
   * through the camera to the far edge of the same band, where it grows in out
   * of the fog. Nothing is allocated after `build()`, and the numbers below are
   * how much grass is AROUND YOU rather than how much exists.
   *
   * Two bands, because one is either too sparse underfoot or too expensive at
   * distance. The near band is thick and finely bladed; the far band is coarse,
   * larger and cheaper per tuft — level of detail expressed as data.
   */
  groundCover: {
    bands: [
      /** Underfoot: about one tuft per 1.4m², which reads as continuous turf. */
      { count: 1300, radius: 25, blades: 4, scale: [0.7, 1.25], variants: 4 },
      /** Out to the fog: sparser, but each tuft is bigger so it still reads. */
      { count: 1500, radius: 78, blades: 3, scale: [1.15, 2.1], variants: 3 },
    ],
    /**
     * Fraction of a band's radius over which a tuft scales in from nothing.
     * This is the whole anti-pop-in mechanism: recycled tufts always arrive at
     * the band edge, and they arrive at zero size. 0 would make them appear.
     */
    fadeBand: 0.22,
    /** Do not bother rewriting an instance matrix for a smaller change. */
    fadeEpsilon: 0.02,
    /**
     * Nothing grows on a slope steeper than this (Terrain's 0..1 metric).
     *
     * Matched to `GROUND_PAINT.wearFull` in `style.js`, which is the slope at
     * which the terrain's own vertex colours have gone entirely to bare earth.
     * Grass standing on ground that is painted as stripped soil is the kind of
     * contradiction you notice without being able to say why.
     */
    maxSlope: 0.14,
    /** Terrain surfaces grass will root in. CLIFF is bare rock by definition. */
    surfaces: ['GRASS', 'DIRT'],
    /** Extra clearance beyond the road shoulder, metres. Verges stay bare. */
    trackClearance: 2.0,
    /** Metres the tuft origin is sunk, so blades start below the facet seam. */
    sink: 0.06,
    /**
     * WIND — injected into the vertex shader, never computed per instance.
     *
     * Grass that does not move reads as plastic, and moving 2800 instances on
     * the CPU would cost more than everything else in this file put together.
     * See `src/render/wind.js`: the bend is proportional to height above the
     * tuft's own base, so the roots stay welded to the ground.
     */
    wind: {
      /** Sway coefficient. Tip displacement ≈ strength × height², so a 0.8m
       *  blade leans about 14cm at full gust. */
      strength: 0.22,
      /** Radians per second of the main sway. */
      speed: 1.5,
      /** Metres per radian of phase across the ground — the gust wavelength. */
      scale: 0.055,
      /** Direction the wind blows, normalised on use. */
      direction: { x: 0.82, z: 0.57 },
    },
  },

  /**
   * TRAILS — the ruts people wore into this place before you got here.
   *
   * The premise of the whole open world is that it is a real place somebody
   * used to come to, and an untouched forest says the opposite. So there are
   * faint worn routes from each landmark down to the nearest parkour, and a
   * few between the landmarks themselves. They are drawn ENTIRELY as vertex
   * colour on the terrain that already exists — no geometry, no draw call, no
   * texture. See `world/trails.js` and `GROUND_PAINT.trail`.
   *
   * Subtlety is the whole brief. This is atmosphere, not a road network: a
   * trail you can plan a route along is a road, and this world does not have
   * roads outside the three parkours.
   *
   * A NOTE ON WIDTHS. The heightfield has a vertex every
   * `terrainCellSize` (13m), so a two-metre tyre rut cannot be drawn here at
   * all — it would fall between vertices and alias into nothing. What is
   * achievable is a worn band a couple of vertices across, which from a car is
   * what an old forest track looks like anyway.
   */
  trails: {
    /** Metres either side of the centreline that are fully worn. */
    coreWidth: 7,
    /** …and where the wear has faded back into grass. */
    edgeWidth: 17,
    /** Waypoints per route. More = a wigglier path for the same wander. */
    segments: 9,
    /** Metres a route may wander off the straight line between its ends. */
    wander: 90,
    /**
     * Routes between landmarks, as index pairs into `LANDMARK_DEFS`. Every
     * landmark already gets a route down to the nearest parkour; these are the
     * few that also connect to each other, and there are deliberately not many.
     *
     * Adjacent pairs only. The landmarks are 800m apart at best, so linking
     * opposite ones draws a two-kilometre line across the entire map, and a
     * trail long enough to navigate by is a road.
     */
    links: [
      [2, 3],
      [3, 4],
      [0, 4],
    ],
    /**
     * Short routes that leave a parkour, go into the trees, and stop.
     *
     * These do most of the storytelling, and they are the only trails the
     * player is likely to meet, because they are where the player is. A rut
     * that leads off the road and ends in nothing says somebody pulled over
     * here far better than a path between two landmarks does — that one just
     * says the map has a road network, which is the thing to avoid.
     */
    spurs: {
      count: 11,
      length: [110, 320],
      /**
       * How far from ANY parkour the far end has to finish, metres. All three
       * parkours share one terrain, so a spur off one of them can quite easily
       * land next to another — and a rut that leaves the road and rejoins it is
       * a lay-by, which is a tidier and much less interesting story. Spurs that
       * cannot clear this are simply not drawn.
       */
      clearEnd: 90,
    },
    /**
     * Along-route patchiness: below this the route has grown over completely.
     * Without it a trail is a stripe of uniform brown, which reads as painted.
     */
    fadeFrom: 0.3,
    fadeTo: 0.62,
    /** Grid cells per noise cycle for that patchiness. */
    fadeScale: 0.0075,
    /** Wear above which grass stops growing. A path with grass on it is a lawn. */
    grassFreeAbove: 0.45,
  },
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
   * Closer than this and the raycast is skipped entirely. Two cars this near
   * each other are not having their outcome decided by a trunk between them,
   * and the grid walk is the only expensive part of the whole check.
   */
  occlusionMinDistance: 12,

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
// PATROLS — the world does not stop being policed
// ---------------------------------------------------------------------------

/**
 * One cruiser, sometimes, working the old parkour ribbons.
 *
 * The scripted chase is a scene: it starts when the story says so, it is
 * survivable by design, and it ends. A patrol is the opposite of all three. It
 * is not looking for you, it does not know where you are, and if it never sees
 * you it drives off and is deleted. That difference is the entire feature —
 * what it buys is that the open world stops being safe without ever becoming a
 * chase you did not choose.
 *
 * WHY THE OLD TRACKS
 * ------------------
 * Because they are roads, and a police car on a road is not a coincidence that
 * needs explaining. Cruising the parkours you raced this morning also says
 * something the game cannot say any other way: they are checking the road you
 * left. `AiDriver` already races a `track`, so a patrol route costs nothing to
 * implement and reads as intent.
 *
 * COST IS FIXED, NOT CUMULATIVE
 * -----------------------------
 * At most `maxActive` exist at once, and one that has been `despawnDistance`
 * away for `despawnHold` seconds is removed. Roam for an hour and the game is
 * running exactly as much as it was in the first minute.
 */
export const PATROL = {
  /**
   * Patrols arm themselves off the story ending, exactly as the forest and the
   * wildlife do — see `TREES.breakableBy` and `WILDLIFE.armedBy`. Nobody
   * *switches them on*: during the races and the scripted first chase this
   * system is constructed, listening, and doing nothing at all.
   *
   * `intro:finished` is the second entry for the no-story paths (`?skip=intro`,
   * the free-roam menu option), where no chase ever happens and the roads would
   * otherwise stay empty forever.
   */
  armedBy: ['chase:escaped', 'intro:finished'],

  /** Cruisers alive at once. One. Two is an escort, and an escort is a chase. */
  maxActive: 1,
  /** Seconds after arming before the first one can appear, [min, max]. */
  firstDelay: [22, 50],
  /** Seconds between attempts once the road is clear again, [min, max]. */
  interval: [75, 165],
  /**
   * Where one may appear, metres from the player.
   *
   * `min` has to clear `alarm.range` by a margin, or a patrol materialises
   * already audible and the arrival reads as a spawn rather than as a car that
   * drove here. Everything past `visionRange` is automatically out of sight.
   */
  spawnDistance: { min: 300, max: 540 },
  /** Far enough away to stop mattering… */
  despawnDistance: 620,
  /** …and gone for this long, so a player circling the boundary does not thrash it. */
  despawnHold: 10,
  /** Throttle multiplier. They are patrolling, not qualifying. */
  pace: 0.55,

  /**
   * Perception. Deliberately shorter and narrower than `CHASE`: a car sweeping
   * a road is not scanning the treeline for you, and a patrol that spotted you
   * as readily as a unit dispatched to find you would make the whole open world
   * a corridor.
   */
  vision: { range: 165, coneDeg: 52 },
  /**
   * Range multipliers by whether the player is running lit.
   *
   * This is the reason `F` exists. Lights off is the baseline, so nothing is
   * given away for free; switching them on is what costs you, and it costs you
   * half again your visibility. At night that is a genuine trade, because the
   * forest with no lights is close to undrivable — which is the point. Not
   * applied to the scripted chase: those cops were told where you are.
   */
  headlightRange: { lit: 1.5, dark: 1.0 },

  /**
   * THE ALARM. Two states, and the player must never confuse them.
   *
   *   near  — a siren somewhere off to your left, a light bar through the
   *           trunks, the pursuit meter waking up and stopping short.
   *   seen  — the meter fills, the chase system takes the car over, and the
   *           siren is behind you instead of somewhere.
   */
  alarm: {
    /** Inside this you can hear them. Comfortably outside their vision range. */
    range: 285,
    /** The nearby meter never climbs past this. Critical is 0.8 — it must not read as caught. */
    heatCeiling: 0.5,
    /** …and it only appears inside this, so a patrol two fields away is silent. */
    meterFrom: 240,
    /** Closer than this and the siren rattles the camera, as the chase's do. */
    shakeFrom: 45,
  },

  /**
   * THE TREE LESSON.
   *
   * Felling a pine onto the car and sitting still under it is the best thing in
   * the game and nothing has ever told the player it is possible. This is the
   * moment to: trunks became fellable on exactly the event that armed the
   * patrols (`TREES.breakableBy`), so the first time one of them sees you is
   * the first time the answer exists.
   *
   * Said in the world's voice, twice at most, ever, and never when there is no
   * forest within reach to say it about — advice you cannot act on is worse
   * than silence.
   */
  hint: {
    /** Seconds after being spotted. Long enough that the sighting lands first. */
    delay: 4.5,
    /** Times in a save. Two: one to hear it, one to remember it. */
    maxTimes: 2,
    /** Fellable trunks needed within `treeRadius` metres before it will fire. */
    minTrees: 3,
    treeRadius: 70,
    lines: [
      { text: 'Bir ağacı devirecek kadar sert vur.', duration: 3.4 },
      { text: 'Sonra hiç kıpırdama.', duration: 3.0 },
    ],
  },
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
