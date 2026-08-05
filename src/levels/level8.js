/**
 * BÖLÜM 8 — "Kapak" (The Lid)
 *
 * The one that breaks.
 *
 * Everything the game has taught the player about surfaces arrives here at
 * once, at night, in the rain. It is not a road: it is a haul track of packed
 * dirt, marked with plastic posts and lit by a floodlight rig somebody hung
 * through the trees. In the wet, packed dirt is mud. That is not a trap — the
 * player has driven mud since bölüm 2.
 *
 * WHAT MAKES IT THE LAST ONE
 *
 *   1. `markers` — posts with no colliders. Nothing at the edge will save you.
 *   2. `lighting` — the rig, with a GAP in it. The run through the cutting at
 *      0.50–0.66 was never lit, which reads as an oversight for one lap.
 *   3. `patches` — wet clay, `SLICK`, through exactly that unlit stretch. Same
 *      0.12 of grip as the ice on bölüm 7, and this time in the dark.
 *
 * Halfway round, the rig fails (`breakout.blackoutAt`), the headlights come up,
 * and the road stops telling you where it goes. The clay does the rest. When
 * the car leaves the parkour there is no barrier, and — for the first time in
 * eight levels — no reset either. See `src/game/intro/introDirector.js`; this
 * level's `story.breaks` is what points the whole ending at it.
 *
 * The name is what the player finds out immediately afterwards: there was a lid
 * on all of it, and there always was.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level8',
  name: 'Kapak',
  subtitle: 'The Lid',
  theme: 'storm',
  ambience: 'night',
  race: { laps: 2, rivals: 3 },

  map: {
    seed: 0x3d17a9,
    /** Heavy, and it is what makes the clay clay. */
    weather: { kind: 'rain', amount: 1, wet: true },
    /** Deep forest either side, so what is off the road is not a view. */
    scatter: { trees: 5200, rocks: 900, bushes: 2800, ferns: 2200, undergrowth: 2000 },
  },

  /**
   * The story staged over this level. Read only by `src/game/intro/`; every
   * other reader treats it as a plain race, which is what keeps the intro
   * deletable. `breaks` says: this race does not end. Do not queue anything
   * after it.
   */
  story: { breaks: true },

  track: {
    loop: true,
    defaultWidth: 14,
    checkpoints: 14,
    startProgress: 0.0,

    /** Packed dirt for the whole stage — this was never paved. */
    defaultSurface: 'DIRT',
    /** No paint of any kind. The posts do the guiding. */
    paint: { centreLine: false, edgeLines: false, kerbs: false },

    points: [
      { x: 300, y: 0, z: 0, width: 14 },
      { x: 294.5, y: 0.5, z: 27.5, width: 13.7 },
      { x: 289, y: 1.1, z: 55, width: 13.5 },
      { x: 283.5, y: 1.6, z: 82.5, width: 13.2 },
      { x: 277.2, y: 2.2, z: 109.7, width: 13 },
      { x: 261.5, y: 3.1, z: 133, width: 13 },
      { x: 245.8, y: 4.1, z: 156.2, width: 13 },
      { x: 230.1, y: 5.1, z: 179.5, width: 13 },
      { x: 213.2, y: 6, z: 201.5, width: 13 },
      { x: 189.7, y: 6.5, z: 217, width: 13 },
      { x: 166.3, y: 7.1, z: 232.4, width: 13 },
      { x: 142.9, y: 7.6, z: 247.8, width: 13 },
      { x: 119.5, y: 8, z: 263.3, width: 13.1 },
      { x: 96.4, y: 7.7, z: 279.3, width: 13.5 },
      { x: 73.4, y: 7.5, z: 295.3, width: 13.9 },
      { x: 46.8, y: 7.1, z: 303.3, width: 14 },
      { x: 19.4, y: 6.7, z: 309.2, width: 14 },
      { x: -8.1, y: 6.4, z: 309.2, width: 14 },
      { x: -35.7, y: 6.2, z: 304.3, width: 14 },
      { x: -63.4, y: 6, z: 299.6, width: 13.9 },
      { x: -91.2, y: 5.7, z: 295.9, width: 13.1 },
      { x: -117.3, y: 5.1, z: 285.8, width: 13 },
      { x: -140.6, y: 4.4, z: 270.6, width: 13 },
      { x: -160.4, y: 3.6, z: 250.9, width: 13 },
      { x: -175.6, y: 2.9, z: 227.6, width: 13 },
      { x: -185.8, y: 2.3, z: 201.6, width: 13 },
      { x: -189.5, y: 2, z: 173.8, width: 13 },
      { x: -195.1, y: 1.2, z: 146.3, width: 13.5 },
      { x: -201.1, y: 0.3, z: 118.9, width: 14 },
      { x: -207, y: -1.7, z: 91.4, width: 14 },
      { x: -212.9, y: -3.6, z: 64, width: 14 },
      { x: -218.9, y: -5.6, z: 36.6, width: 14 },
      { x: -224.8, y: -6.9, z: 9.2, width: 14 },
      { x: -230.8, y: -7.8, z: -18.2, width: 14 },
      { x: -238.3, y: -8, z: -45.3, width: 14 },
      { x: -241.5, y: -7.9, z: -72.9, width: 14 },
      { x: -238.6, y: -7.7, z: -100.6, width: 14 },
      { x: -229.6, y: -7.5, z: -127, width: 14 },
      { x: -215, y: -7.2, z: -150.7, width: 14 },
      { x: -195.5, y: -7, z: -170.7, width: 14 },
      { x: -172, y: -6.7, z: -186, width: 14 },
      { x: -145.5, y: -6.5, z: -195.1, width: 14 },
      { x: -117.7, y: -6.2, z: -197.9, width: 14 },
      { x: -90, y: -6.1, z: -194.4, width: 14 },
      { x: -63.8, y: -6, z: -185, width: 14 },
      { x: -36.9, y: -5.7, z: -178.7, width: 14.4 },
      { x: -8.9, y: -5.2, z: -177.2, width: 15 },
      { x: 19.1, y: -4.7, z: -175.7, width: 15.7 },
      { x: 46.8, y: -3.8, z: -178.8, width: 16 },
      { x: 74.1, y: -2.8, z: -185, width: 16 },
      { x: 101.5, y: -1.8, z: -191.2, width: 16 },
      { x: 126.7, y: -1.1, z: -203, width: 16 },
      { x: 151.4, y: -0.6, z: -216.4, width: 16 },
      { x: 176, y: -0.1, z: -229.8, width: 16 },
      { x: 200.2, y: 0, z: -220, width: 15.1 },
      { x: 224, y: 0, z: -205.2, width: 14 },
      { x: 242.8, y: 0, z: -184.4, width: 14 },
      { x: 259.7, y: 0, z: -162.3, width: 14 },
      { x: 271.7, y: 0, z: -136.9, width: 14 },
      { x: 279.5, y: 0, z: -110.3, width: 14 },
      { x: 283.6, y: 0, z: -82.6, width: 14 },
      { x: 288.9, y: 0, z: -55, width: 14 },
      { x: 294.4, y: 0, z: -27.5, width: 14 },
    ],

    /**
     * NO BARRIERS. Not a gap in them — none at all, anywhere on the lap.
     * Everything that keeps you on this track is information, not steel.
     */
    barriers: { enabled: false },

    /** The posts stop through the cutting. Nobody expected anyone in there. */
    markers: {
      enabled: true,
      spacing: 8,
      offset: 0.9,
      height: 1.05,
      color: 0xe06a2a,
      sides: ['left', 'right'],
      gaps: [{ from: 0.48, to: 0.7 }],
    },

    /** …and so does the light. The hole in the lighting plan is the trap. */
    lighting: {
      enabled: true,
      spacing: 34,
      offset: 5.2,
      height: 8.5,
      alternate: true,
      gaps: [{ from: 0.48, to: 0.7 }],
    },

    /**
     * Wet clay through the cutting. Same grip as ice (0.12) — `runoff`
     * continues it past the edge of the track so a car that runs wide does not
     * find grip a metre later. If you retune the car, run `npm test`: the
     * escape is asserted there, and it is the ending of the game.
     */
    patches: [
      { from: 0.52, to: 0.545, surface: 'MUD', runoff: 14 },
      { from: 0.545, to: 0.655, surface: 'SLICK', runoff: 34 },
      { from: 0.655, to: 0.69, surface: 'MUD', runoff: 14 },
    ],

    /** Read by the intro director, ignored by everything else. */
    breakout: {
      /** Lap position where the lights are cut. Just before the cutting. */
      blackoutAt: 0.42,
      /** How long they stay out. Long enough to lose the road, not to get bored. */
      blackoutSeconds: 9,
      /** Where the escape is expected. */
      at: 0.6,
      side: 1,
    },
  },
});
