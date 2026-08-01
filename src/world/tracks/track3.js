/**
 * PARKUR 3 — "Sırt Yolu" (The Ridge Road)
 *
 * The one that breaks.
 *
 * Unlike the first two, this is not a road. It is an unsealed forest track:
 * packed dirt, no paint, no Armco. Its edges are marked with flexible plastic
 * delineator posts, and the only reason it is drivable at all is that somebody
 * rigged floodlights through the trees along it. `src/world/lighting.js` owns
 * those lights, and the whole stage depends on them.
 *
 * WHAT MAKES IT WORK
 *
 *   1. `markers` — plastic posts with NO colliders. You can drive straight
 *      through them. Nothing at the edge of this track will save you; the posts
 *      only tell you where the edge is.
 *   2. `lighting` — the rig. Note the `gaps`: the run through the deep cutting
 *      at 0.50–0.66 was never lit in the first place, which is why the darkness
 *      lands hardest exactly there.
 *   3. `patches` — SLICK, wet clay, through that same unlit stretch.
 *
 * Halfway round, the lights fail. The director calls
 * `lighting.blackout()` (see `src/game/intro/introDirector.js`), the player's
 * headlights come on, and for a few seconds the only things in the world are
 * two cones of light and a dirt road that has stopped telling you where it goes.
 * The clay does the rest.
 *
 * The line of the slide carries out toward the centre of the valley, so the
 * first two parkours are a few hundred metres that way — still standing, still
 * lit, still being raced.
 */

export default {
  id: 'track3',
  name: 'Sırt Yolu',
  subtitle: 'Ridge Road',
  loop: true,
  laps: 2,
  defaultWidth: 14,
  checkpoints: 14,
  startProgress: 0.0,

  /** Packed dirt for the whole stage — this was never paved. */
  defaultSurface: 'DIRT',
  /** No paint of any kind. The posts do the guiding. */
  paint: { centreLine: false, edgeLines: false, kerbs: false },

  points: [
    { x: 572, y: 0, z: 500, width: 14 },
    { x: 555.2, y: 2, z: 594.5, width: 14 },
    { x: 476.2, y: 6, z: 662.6, width: 13 },
    { x: 391.7, y: 10, z: 723.6, width: 13 },
    { x: 280, y: 12, z: 756.5, width: 14 },
    { x: 179.4, y: 9, z: 701.2, width: 13 },
    { x: 79.7, y: 5, z: 666, width: 13 },
    { x: 2.1, y: 1, z: 595.4, width: 14 },
    { x: -12, y: -3, z: 500, width: 14 },
    { x: -22.1, y: -6, z: 396.3, width: 15 },
    { x: 40.5, y: -9, z: 301.5, width: 16 },
    { x: 152.6, y: -11, z: 245.1, width: 16 },
    { x: 280, y: -9, z: 238.6, width: 15 },
    { x: 389.5, y: -5, z: 280.9, width: 14 },
    { x: 486.5, y: -2, z: 328.9, width: 13 },
    { x: 555.2, y: -0.5, z: 405.5, width: 14 },
  ],

  /**
   * NO BARRIERS. Not a gap in them — none at all, anywhere on the lap.
   * Everything that keeps you on this track is information, not steel.
   */
  barriers: { enabled: false },

  /**
   * The plastic posts. `gaps` stops them through the unlit cutting: the rig ran
   * out of posts there, or nobody thought anyone would be going through it in
   * the dark.
   */
  markers: {
    enabled: true,
    spacing: 8,
    offset: 0.9,
    height: 1.05,
    color: 0xe06a2a,
    sides: ['left', 'right'],
    gaps: [{ from: 0.5, to: 0.66 }],
  },

  /**
   * The floodlight rig. Alternating sides, leaning over the road.
   * The gap is the trap — and it is a hole in the *lighting plan*, which reads
   * as an oversight rather than as a trap, right up until it isn't.
   */
  lighting: {
    enabled: true,
    spacing: 34,
    offset: 5.2,
    height: 8.5,
    alternate: true,
    gaps: [{ from: 0.5, to: 0.66 }],
  },

  /**
   * Wet clay through the cutting. Same grip as ice (0.12) — the corner at
   * ~0.55 has a radius of about 115m and needs roughly 12 m/s² to hold; the
   * clay can supply about 1.9. `runoff` continues it past the edge of the
   * track so a car that runs wide does not find grip a metre later.
   *
   * If you retune the car, run `npm test` — the escape is asserted there.
   */
  patches: [
    { from: 0.5, to: 0.523, surface: 'MUD', runoff: 14 },
    { from: 0.523, to: 0.612, surface: 'SLICK', runoff: 34 },
    { from: 0.612, to: 0.655, surface: 'MUD', runoff: 14 },
  ],

  /**
   * Read by the intro director. Everything outside `src/game/intro/` ignores
   * these fields, so this is still a plain track without them.
   */
  breakout: {
    /** Lap position where the lights are cut. Just before the cutting. */
    blackoutAt: 0.44,
    /** How long they stay out. Long enough to lose the road, not to get bored. */
    blackoutSeconds: 9,
    /** Where the escape is expected. */
    at: 0.55,
    side: 1,
  },
};
