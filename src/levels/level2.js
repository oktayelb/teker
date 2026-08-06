/**
 * BÖLÜM 2 — "Dere Geçidi" (The Creek Crossing)
 *
 * The competent one. Narrower, with 34 metres of elevation change and two
 * corners that punish a lazy entry. There is a dirt section on the descent
 * where the tarmac was never finished — the first hint in the game that the
 * world has surfaces other than the one you were given.
 *
 * Still fully barriered. Still no way out. The player should finish this race
 * confident that they understand the rules.
 *
 * THE SHORTEST FILE HERE, DELIBERATELY. Everything this level does not say —
 * its seed, its forest, its landmarks, its trails, the glass over it — comes
 * from `defaults.js`. Copy this one when you add a level.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level2',
  name: 'Dere Geçidi',
  subtitle: 'Creek Crossing',
  theme: 'forest',
  /** Mixolydian — bright, rolling, the b7 keeps it honest. @see src/audio/music/tracks/dereGecidi.js */
  music: 'dereGecidi',
  race: { laps: 2, rivals: 3 },

  /**
   * The one thing this level does say about its map, and the reason worth
   * knowing: this stage climbs 34 metres, so its dome has to stand higher than
   * most to keep a roof over the top of the climb (`DOME.roadClearance`) — and
   * a tall dome on rolling ground grows steep flanks you cannot drive up. This
   * seed is a valley that is quiet enough underneath it. `npm test` measures
   * the glass on every level's map; if a seed makes a dome unclimbable it says
   * so, and the answer is another seed.
   */
  map: {
    seed: 0x6e2f18,
  },

  track: {
    loop: true,
    laps: 2,
    defaultWidth: 14,
    checkpoints: 14,
    startProgress: 0.0,

    points: [
      { x: 247.0, y: 0, z: 66.6, width: 15 },
      { x: 172.1, y: 4, z: 123.1, width: 15 },
      { x: 112.7, y: 9, z: 184.3, width: 14 },
      { x: 22.9, y: 14, z: 227.7, width: 13 },
      { x: -64.6, y: 18, z: 171.3, width: 13 },
      { x: -152.9, y: 20, z: 154.3, width: 14 },
      { x: -237.1, y: 16, z: 105.9, width: 15 },
      { x: -247.0, y: 9, z: 21.2, width: 15 },
      { x: -246.5, y: 2, z: -61.3, width: 14 },
      { x: -172.5, y: -5, z: -116.3, width: 13 },
      { x: -116.9, y: -11, z: -180.1, width: 14 },
      { x: -27.6, y: -14, z: -227.6, width: 15 },
      { x: 61.9, y: -12, z: -171.1, width: 14 },
      { x: 151.9, y: -8, z: -153.3, width: 13 },
      { x: 228.5, y: -4, z: -99.8, width: 14 },
      { x: 228.1, y: -1, z: -15.8, width: 15 },
    ],

    /** Unfinished tarmac on the fast descent. Slower, looser, but survivable. */
    patches: [{ from: 0.58, to: 0.68, surface: 'DIRT' }],

    barriers: { enabled: true, sides: ['left', 'right'], gaps: [] },
  },
});
