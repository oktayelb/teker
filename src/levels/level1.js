/**
 * BÖLÜM 1 — "Çam Halkası" (The Pine Ring)
 *
 * The friendly one. A wide, gently banked oval with a single soft chicane, cut
 * through mature pine forest. Nothing here is trying to catch you out: it exists
 * to teach the car and to establish what a normal race in this game looks like,
 * so that a later one can break the rule.
 *
 * Fully barriered. You cannot leave. That is the point.
 *
 * Its map is its own — flat-ish land, thick forest, nothing on it but this
 * parkour. The other levels are not a few hundred metres away; they are not
 * anywhere, until you go to them.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level1',
  name: 'Çam Halkası',
  subtitle: 'Pine Ring',
  theme: 'forest',
  race: { laps: 2, rivals: 3 },

  /**
   * The first map the player ever sees, so it is the most generous one: the
   * standard size, a heavy forest, and a seed picked (rather than derived) for
   * the rolling ground it puts under the oval.
   */
  map: {
    seed: 0x7e4e17,
  },

  track: {
    loop: true,
    laps: 2,
    defaultWidth: 16,
    checkpoints: 12,
    /** 0..1 around the lap. Placed on the long south straight. */
    startProgress: 0.0,

    points: [
      { x: 262.0, y: 0, z: -1.0, width: 16 },
      { x: 245.5, y: 1.5, z: 94.7, width: 16 },
      { x: 160.1, y: 3, z: 161.4, width: 16 },
      { x: 59.5, y: 4.5, z: 209.8, width: 16 },
      { x: -58.3, y: 5, z: 205.7, width: 16 },
      { x: -153.6, y: 3.5, z: 154.8, width: 16 },
      { x: -243.1, y: 1, z: 93.7, width: 16 },
      { x: -262.0, y: -1, z: -1.0, width: 16 },
      { x: -247.9, y: -2.5, z: -97.6, width: 16 },
      { x: -158.5, y: -3, z: -161.8, width: 16 },
      { x: -58.9, y: -2, z: -209.8, width: 16 },
      { x: 58.3, y: -0.5, z: -207.7, width: 16 },
      { x: 156.8, y: 0.5, z: -160.1, width: 16 },
      { x: 240.8, y: 0, z: -94.8, width: 16 },
    ],

    /** No surface tricks. Tarmac all the way round. */
    patches: [],

    barriers: { enabled: true, sides: ['left', 'right'], gaps: [] },
  },
});
