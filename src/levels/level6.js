/**
 * BÖLÜM 6 — "Viyadük" (The Viaduct)
 *
 * The level where the road leaves the ground.
 *
 * A quarter of the lap is a deck: the ramp climbs out of the forest at the
 * eastern end, the crossing runs level across a gorge nobody has any business
 * being over, and then the road spirals back down through its own shadow —
 * one and a quarter turns at sixty metres of radius, dropping thirty-six.
 *
 * WHY THE SPIRAL IS THE POINT
 * Halfway down it you drive under the piece of road you were on twenty seconds
 * ago, and the game has to be able to say which of the two is the ground you
 * are standing on. That is `Track#query` taking a height, and it is the whole
 * reason a track can cross itself at all — see `_applyElevated` in
 * `src/world/track.js`. Everything visible here (the deck, the soffit, the
 * pillars cut to whatever the ground under them is doing) follows from a level
 * file naming a range of the lap and saying: this part is in the air.
 *
 * AND WHY IT IS IN THE MIST
 * Because a bridge you can see the far end of is a road, and one you cannot is
 * a decision. The fog closes at a hundred and fifty metres here, which is about
 * four seconds at the speed the crossing invites.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level6',
  name: 'Viyadük',
  subtitle: 'The Viaduct',
  theme: 'mist',
  ambience: 'forest',
  /** Lydian — the raised 4th is altitude and wonder. @see src/audio/music/tracks/viyaduk.js */
  music: 'viyaduk',
  race: { laps: 2, rivals: 3 },

  map: {
    seed: 0x6c0d17,
    terrain: {
      shapes: [
        /** The gorge the crossing crosses. Without it, a bridge over nothing. */
        { x: 196, z: 138, radius: 118, height: -34, falloff: 165 },
        /** …and the pan the spiral comes down into, so it lands on a floor. */
        { x: 58, z: 214, radius: 98, height: 0, falloff: 130 },
      ],
    },
    /**
     * The glass has to clear a road forty metres up, so its footprint is
     * widened rather than its height raised: same shell, longer flank, still
     * drivable. @see DOME.roadClearance
     */
    domes: { margin: 130 },
    scatter: { trees: 4600, rocks: 800, bushes: 2600 },
  },

  track: {
    loop: true,
    defaultWidth: 15,
    checkpoints: 16,
    startProgress: 0.02,

    points: [
      { x: -250, y: 0, z: -250, width: 16 },
      { x: -222, y: 0.2, z: -250, width: 16 },
      { x: -194, y: 0.4, z: -250, width: 16 },
      { x: -166, y: 0.7, z: -250, width: 16 },
      { x: -138, y: 1.2, z: -250, width: 16 },
      { x: -110, y: 1.7, z: -250, width: 16 },
      { x: -82, y: 2.3, z: -250, width: 16 },
      { x: -54, y: 2.9, z: -250, width: 16 },
      { x: -26, y: 3.5, z: -250, width: 16 },
      { x: 2, y: 4.1, z: -250, width: 16 },
      { x: 30, y: 4.6, z: -250, width: 16 },
      { x: 58, y: 5.2, z: -250, width: 16 },
      { x: 86, y: 5.5, z: -250, width: 16 },
      { x: 114, y: 5.7, z: -250, width: 16 },
      { x: 142, y: 5.9, z: -250, width: 16 },
      { x: 169.9, y: 6.5, z: -247.4, width: 15.1 },
      { x: 195.8, y: 8.2, z: -237.3, width: 15 },
      { x: 217, y: 10.5, z: -219.2, width: 15 },
      { x: 231.8, y: 12.6, z: -195.7, width: 15 },
      { x: 238.8, y: 13.8, z: -168.8, width: 15 },
      { x: 241, y: 16.1, z: -141, width: 14.5 },
      { x: 242.6, y: 19.1, z: -113, width: 14 },
      { x: 244.1, y: 22.2, z: -85, width: 14 },
      { x: 245.6, y: 25.2, z: -57.1, width: 14 },
      { x: 247.1, y: 28.3, z: -29.1, width: 14 },
      { x: 248.7, y: 31.3, z: -1.1, width: 14 },
      { x: 250.2, y: 34.4, z: 26.8, width: 14 },
      { x: 251.7, y: 37.4, z: 54.8, width: 14 },
      { x: 237.2, y: 38, z: 77.3, width: 14 },
      { x: 219, y: 38, z: 98.5, width: 14 },
      { x: 200.7, y: 38, z: 119.8, width: 14 },
      { x: 182.5, y: 38, z: 141.1, width: 14 },
      { x: 164.3, y: 38, z: 162.3, width: 14 },
      { x: 146.1, y: 38, z: 183.6, width: 14 },
      { x: 127.8, y: 38, z: 204.9, width: 14 },
      { x: 117.3, y: 36.8, z: 229.7, width: 13.2 },
      { x: 104.7, y: 34.7, z: 254.3, width: 13 },
      { x: 82.1, y: 32.7, z: 270.2, width: 13 },
      { x: 54.9, y: 30.6, z: 275.2, width: 13 },
      { x: 28.2, y: 28.5, z: 268.1, width: 13 },
      { x: 8, y: 26.4, z: 249.2, width: 13 },
      { x: -2.5, y: 24.3, z: 223.7, width: 13 },
      { x: -1.1, y: 22.3, z: 196.1, width: 13 },
      { x: 13.2, y: 20.2, z: 172.4, width: 13 },
      { x: 35.9, y: 18.1, z: 156.8, width: 13 },
      { x: 63.2, y: 16, z: 152.4, width: 13 },
      { x: 89.3, y: 13.9, z: 161.5, width: 13 },
      { x: 109.3, y: 11.9, z: 180.5, width: 13 },
      { x: 119.4, y: 9.8, z: 206.3, width: 13 },
      { x: 115.9, y: 7.7, z: 233.8, width: 13 },
      { x: 101.4, y: 5.6, z: 257.2, width: 13 },
      { x: 78.3, y: 3.5, z: 272.5, width: 13 },
      { x: 50.7, y: 2.1, z: 275, width: 13.3 },
      { x: 22.9, y: 2.3, z: 271.1, width: 14.5 },
      { x: -4.8, y: 2.8, z: 267.2, width: 15 },
      { x: -32.5, y: 3.4, z: 263.3, width: 15 },
      { x: -60.3, y: 4.1, z: 259.4, width: 15 },
      { x: -88, y: 4.8, z: 255.5, width: 15 },
      { x: -115.7, y: 5.4, z: 251.6, width: 15 },
      { x: -143.5, y: 5.8, z: 247.7, width: 15 },
      { x: -171.2, y: 6, z: 243.9, width: 15 },
      { x: -199.1, y: 5.9, z: 241.4, width: 15.4 },
      { x: -227, y: 5.8, z: 238.9, width: 15.7 },
      { x: -254.4, y: 5.6, z: 234.5, width: 16 },
      { x: -280.3, y: 5.3, z: 224, width: 16 },
      { x: -306.3, y: 5, z: 213.4, width: 16 },
      { x: -330.4, y: 4.6, z: 199.8, width: 16 },
      { x: -352.1, y: 4.2, z: 182.1, width: 16 },
      { x: -373.8, y: 3.8, z: 164.4, width: 16 },
      { x: -391.6, y: 3.3, z: 143.1, width: 16 },
      { x: -407.1, y: 2.9, z: 119.9, width: 16 },
      { x: -422.7, y: 2.4, z: 96.6, width: 16 },
      { x: -432, y: 2, z: 70.3, width: 16 },
      { x: -440, y: 1.6, z: 43.5, width: 16 },
      { x: -447.8, y: 1.2, z: 16.7, width: 16 },
      { x: -447.6, y: 0.9, z: -11.3, width: 16 },
      { x: -447.4, y: 0.6, z: -39.4, width: 16 },
      { x: -445.4, y: 0.3, z: -67.1, width: 16 },
      { x: -437, y: 0.2, z: -93.8, width: 16 },
      { x: -428.6, y: 0.1, z: -120.5, width: 16 },
      { x: -413.9, y: 0, z: -142.4, width: 16 },
      { x: -390.4, y: 0, z: -157.8, width: 16 },
      { x: -367, y: 0, z: -173.2, width: 16 },
      { x: -343.6, y: 0, z: -188.5, width: 16 },
      { x: -320.2, y: 0, z: -203.9, width: 16 },
      { x: -296.8, y: 0, z: -219.3, width: 16 },
      { x: -273.4, y: 0, z: -234.6, width: 16 },
    ],

    /**
     * THE DECK. Lap fractions, like `patches`. Inside this range the terrain
     * is left alone and the road is built rather than graded; the ends are
     * tapered into abutments by `Track#_applyElevated`, so this wants to start
     * where the road has genuinely left the earth and end where it has landed.
     */
    elevated: [{ from: 0.205, to: 0.535 }],

    /** Nothing on the deck. Damp leaves in the forest at the bottom. */
    patches: [{ from: 0.6, to: 0.66, surface: 'DIRT', runoff: 8 }],

    barriers: { enabled: true, sides: ['left', 'right'], gaps: [{ from: 0.205, to: 0.535 }] },
  },
});
