/**
 * PARKUR 3 — "Sırt Yolu" (The Ridge Road)
 *
 * The one that breaks.
 *
 * It is a real track and it is meant to be raced. It is faster and wider than
 * the other two, which is exactly what makes the trap work: by the time the
 * player reaches the long left-hand sweeper at roughly two thirds of a lap,
 * they are carrying more speed than they have all game.
 *
 * Two data entries do all the narrative work here — there is no scripting, no
 * invisible hand, no cutscene trigger on a trigger volume:
 *
 *   1. `patches` coats the sweeper in ICE and MUD. `SURFACES.ICE` has a grip
 *      multiplier of 0.16, so the car understeers straight on. The surface is
 *      rendered pale blue, so it is visible and, in hindsight, fair.
 *   2. `barriers.gaps` leaves that stretch of Armco out. Not broken, not
 *      knocked down. Never installed.
 *
 * The player slides wide, finds nothing there, and keeps going.
 *
 * The outside of that corner faces roughly back toward the centre of the
 * valley, so the natural line of the crash carries them *into* the world rather
 * than off its edge — and the first two parkours are a few hundred metres
 * that way, still standing, still lit.
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
   * THE SWEEPER — and the whole reason this track exists.
   *
   * The lap's fastest stretch runs from about 0.47 to 0.52 (radius ~600m, taken
   * flat out), and it feeds straight into the tightest fast corner on the track
   * at 0.52–0.60 (radius ~115m). On tarmac that corner is holdable at roughly
   * 150 km/h. On ICE — grip 0.16, so about 2.5 m/s² of cornering force — it is
   * holdable at about 60.
   *
   * The player arrives at 120 and up.
   *
   * Mud first, briefly, at turn-in: enough to unsettle the car and make them
   * lift, which is the last honest warning they get. Then ice through the apex.
   *
   * If you retune the car, re-run `npm test` — the escape is asserted there,
   * because a faster or grippier car could quietly make this corner survivable
   * and the game would stop working with no error anywhere.
   */
  patches: [
    { from: 0.508, to: 0.523, surface: 'MUD', runoff: 14 },
    // `runoff` is the important half of this. The corner is iced over for 34
    // metres past the tarmac, so a car that runs wide does not find grippy
    // verge a metre later and tuck back in. It just keeps going.
    { from: 0.523, to: 0.612, surface: 'ICE', runoff: 34 },
    { from: 0.612, to: 0.642, surface: 'MUD', runoff: 14 },
  ],

  /**
   * The hole in the world. Wider than the ice on both sides, so a car that
   * lets go early *or* runs on at the exit still finds nothing to hit.
   */
  barriers: {
    enabled: true,
    sides: ['left', 'right'],
    gaps: [{ from: 0.478, to: 0.68 }],
  },

  /**
   * Read by the intro director. Everything outside `src/game/intro/` ignores
   * these fields entirely, so this file is still a plain track without them.
   */
  breakout: {
    /** Normalised lap position where the escape is expected. */
    at: 0.55,
    /** Which side of the ribbon leads out. +1 = right of travel. */
    side: 1,
  },
};
