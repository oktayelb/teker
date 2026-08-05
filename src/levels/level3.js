/**
 * BÖLÜM 3 — "Sırt Yolu" (The Ridge Road)
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
 * Halfway round, the lights fail. The director calls `lighting.blackout()`
 * (see `src/game/intro/introDirector.js`), the player's headlights come on, and
 * for a few seconds the only things in the world are two cones of light and a
 * dirt road that has stopped telling you where it goes. The clay does the rest.
 *
 * WHAT IS OUT THERE
 * -----------------
 * This level's map, and nothing else. The player slides off the ribbon into a
 * forest that goes on for a kilometre in every direction and has one built
 * thing standing in it — the stage they just left, under glass. The parkours
 * from bölüm 1 and 2 are not over the next ridge; they are on their own maps,
 * and getting back to one is a journey the game has to *make*, not a drive.
 * See `src/game/levels.js`.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level3',
  name: 'Sırt Yolu',
  subtitle: 'Ridge Road',

  /**
   * This stage runs at night, and that is not decoration.
   *
   * Everything about bölüm 3 assumes the sun is down: the floodlight rig is the
   * only reason the road is readable, the `gaps` in that rig are the trap, and
   * the blackout at 0.44 is the whole story beat. Under a daytime sky the rig is
   * invisible, the gaps mean nothing, the headlights mean nothing, and the
   * lights going out costs the player exactly zero.
   */
  theme: 'night',
  ambience: 'night',
  race: { laps: 2, rivals: 3 },

  /**
   * The map the player is going to spend the rest of the game on, so it is the
   * one map here that is authored rather than derived: a seed whose ground
   * rolls hard enough that the ridge is a ridge, and the full forest, because
   * everything after the break — the chase, the trees you hide under, the
   * patrols — happens in it.
   */
  map: {
    seed: 0x3d17a9,
  },

  /**
   * The story staged over this level. Read only by `src/game/intro/`; every
   * other reader treats this as a plain race, which is what makes the intro
   * deletable. `breaks` says: the race on this level does not end. Do not
   * queue anything after it.
   */
  story: { breaks: true },

  track: {
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
      { x: 297.1, y: 0, z: 2.4, width: 14 },
      { x: 280.3, y: 2, z: 96.9, width: 14 },
      { x: 201.3, y: 6, z: 165.1, width: 13 },
      { x: 116.8, y: 10, z: 226.1, width: 13 },
      { x: 5.1, y: 12, z: 258.9, width: 14 },
      { x: -95.5, y: 9, z: 203.7, width: 13 },
      { x: -195.3, y: 5, z: 168.4, width: 13 },
      { x: -272.8, y: 1, z: 97.8, width: 14 },
      { x: -286.9, y: -3, z: 2.4, width: 14 },
      { x: -297.1, y: -6, z: -101.3, width: 15 },
      { x: -234.4, y: -9, z: -196.1, width: 16 },
      { x: -122.3, y: -11, z: -252.5, width: 16 },
      { x: 5.1, y: -9, z: -259.0, width: 15 },
      { x: 114.6, y: -5, z: -216.7, width: 14 },
      { x: 211.6, y: -2, z: -168.7, width: 13 },
      { x: 280.3, y: -0.5, z: -92.1, width: 14 },
    ],

    /**
     * NO BARRIERS. Not a gap in them — none at all, anywhere on the lap.
     * Everything that keeps you on this track is information, not steel.
     */
    barriers: { enabled: false },

    /**
     * The plastic posts. `gaps` stops them through the unlit cutting: the rig
     * ran out of posts there, or nobody thought anyone would be going through
     * it in the dark.
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
     * The gap is the trap — and it is a hole in the *lighting plan*, which
     * reads as an oversight rather than as a trap, right up until it isn't.
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
  },
});
