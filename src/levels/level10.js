/**
 * BÖLÜM 10 — "Son Halka" (The Last Ring)
 *
 * Everything the other nine taught you, in the dark, with snow coming down.
 *
 * There is no new idea in this level and that is deliberate: a climb out of the
 * valley (bölüm 4), a short bridge over the gully at the top (6 and 9), a fast
 * left onto ice (7), a hairpin at the far end taken on the brakes (4 again),
 * and a plunge home in the dark with only the headlights (3). The last level in
 * a game should be an exam, not a surprise.
 *
 * WHY SNOW AT NIGHT RATHER THAN SNOW
 * Bölüm 7 is a white day: the problem there is that everything looks the same.
 * Here the problem is the opposite — nothing is lit but the eight metres in
 * front of the car, and every flake in that cone is picked out by the
 * headlights and moving. The ice is in the same place both times. Only one of
 * them lets you see it coming.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level10',
  name: 'Son Halka',
  subtitle: 'The Last Ring',
  theme: 'night',
  ambience: 'night',
  race: { laps: 2, rivals: 3 },

  map: {
    seed: 0xa17e51,
    /** Light snow: enough to fill the headlights, not enough to hide the road. */
    weather: { kind: 'snow', amount: 0.55, wet: false },
    terrain: {
      /** The gully the bridge crosses, cut across the north-east shoulder. */
      shapes: [{ x: 292, z: -30, radius: 92, height: -26, falloff: 150 }],
    },
    domes: { margin: 110 },
    scatter: { trees: 4800, rocks: 1100, bushes: 2200, ferns: 1400 },
  },

  track: {
    loop: true,
    defaultWidth: 14,
    checkpoints: 16,
    startProgress: 0.02,

    points: [
      { x: -164, y: 0, z: -260, width: 15 },
      { x: -136.1, y: 0.4, z: -261.9, width: 15 },
      { x: -108.3, y: 0.8, z: -263.9, width: 15 },
      { x: -80.4, y: 1.6, z: -265.8, width: 15 },
      { x: -52.5, y: 2.6, z: -267.8, width: 15 },
      { x: -24.6, y: 3.6, z: -269.7, width: 15 },
      { x: 3.2, y: 4.8, z: -271.7, width: 15 },
      { x: 31.1, y: 6, z: -273.6, width: 15 },
      { x: 59, y: 7.1, z: -275.6, width: 15 },
      { x: 86.9, y: 8.1, z: -277.5, width: 15 },
      { x: 114.7, y: 9, z: -279.4, width: 15 },
      { x: 142.6, y: 9.4, z: -281.4, width: 15 },
      { x: 170.5, y: 9.9, z: -283.3, width: 15 },
      { x: 198.2, y: 11.5, z: -281.3, width: 14.4 },
      { x: 224.7, y: 13.7, z: -273.6, width: 14 },
      { x: 248.8, y: 16, z: -259.8, width: 14 },
      { x: 268.9, y: 18.2, z: -240.7, width: 14 },
      { x: 283.6, y: 20.5, z: -216.9, width: 14 },
      { x: 291.4, y: 22.8, z: -190.1, width: 14 },
      { x: 292.6, y: 25, z: -162.4, width: 14 },
      { x: 289.2, y: 26, z: -134.8, width: 13.7 },
      { x: 283.7, y: 26, z: -107.4, width: 13.2 },
      { x: 278.2, y: 26, z: -80, width: 13 },
      { x: 272.6, y: 26, z: -52.6, width: 13 },
      { x: 267.1, y: 26, z: -25.2, width: 13 },
      { x: 261.6, y: 26, z: 2.2, width: 13 },
      { x: 256.1, y: 26, z: 29.6, width: 13 },
      { x: 250.6, y: 26, z: 57, width: 13 },
      { x: 248.2, y: 25.6, z: 84.8, width: 13.5 },
      { x: 245.4, y: 25.2, z: 112.5, width: 14 },
      { x: 234.5, y: 24.2, z: 138.2, width: 14 },
      { x: 221.5, y: 23.1, z: 162.6, width: 14 },
      { x: 202.8, y: 21.7, z: 183.4, width: 14 },
      { x: 181.6, y: 20.4, z: 200.9, width: 14 },
      { x: 157.2, y: 19.1, z: 214.6, width: 14 },
      { x: 130.8, y: 17.9, z: 222.7, width: 14 },
      { x: 103.3, y: 16.9, z: 227.7, width: 14 },
      { x: 75.7, y: 16.4, z: 225.2, width: 14 },
      { x: 48.1, y: 16, z: 221.1, width: 14 },
      { x: 20.4, y: 15.5, z: 217.5, width: 13.5 },
      { x: -7.3, y: 14.9, z: 214, width: 13 },
      { x: -34.9, y: 13.9, z: 218.4, width: 13 },
      { x: -62.3, y: 13, z: 223.5, width: 13 },
      { x: -87.6, y: 12.5, z: 235.4, width: 13 },
      { x: -113.1, y: 12, z: 245.9, width: 12.9 },
      { x: -140.8, y: 11.5, z: 243.7, width: 12 },
      { x: -166.7, y: 10.4, z: 233.6, width: 12 },
      { x: -188.6, y: 9.1, z: 216.7, width: 12 },
      { x: -204.8, y: 7.8, z: 194.2, width: 12 },
      { x: -214, y: 6.7, z: 168.1, width: 12 },
      { x: -215.4, y: 6.1, z: 140.4, width: 12 },
      { x: -217, y: 5.8, z: 112.6, width: 13 },
      { x: -219.5, y: 5.5, z: 84.7, width: 14.3 },
      { x: -222.1, y: 5.1, z: 56.9, width: 15 },
      { x: -224.7, y: 4.4, z: 29.1, width: 15 },
      { x: -227.2, y: 3.7, z: 1.3, width: 15 },
      { x: -229.8, y: 2.9, z: -26.6, width: 15 },
      { x: -232.4, y: 2.1, z: -54.4, width: 15 },
      { x: -235, y: 1.5, z: -82.2, width: 15 },
      { x: -237.5, y: 0.8, z: -110, width: 15 },
      { x: -240.1, y: 0.4, z: -137.8, width: 15 },
      { x: -242.7, y: 0.1, z: -165.7, width: 15 },
      { x: -242.2, y: 0, z: -193.4, width: 15 },
      { x: -233.4, y: 0, z: -219.7, width: 15 },
      { x: -215.2, y: 0, z: -240.7, width: 15 },
      { x: -191.2, y: 0, z: -254.6, width: 15 },
    ],

    /** The bridge over the gully. Short, and taken at speed in the dark. */
    elevated: [{ from: 0.27, to: 0.475 }],

    /**
     * The ice is on the fast left along the top, where the snow melts in the
     * day and freezes again as soon as the light goes.
     */
    patches: [
      { from: 0.53, to: 0.62, surface: 'ICE', runoff: 14 },
      { from: 0.8, to: 0.86, surface: 'DIRT', runoff: 8 },
    ],

    barriers: { enabled: true, sides: ['left', 'right'], gaps: [{ from: 0.27, to: 0.475 }, { from: 0.63, to: 0.73 }] },
    /** A rig on the climb only. The rest of the lap is yours to light. */
    lighting: { enabled: true, spacing: 40, offset: 5.0, height: 8, alternate: true, gaps: [{ from: 0.5, to: 1 }] },
  },
});
