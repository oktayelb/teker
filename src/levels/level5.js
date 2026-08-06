/**
 * BÖLÜM 5 — "Göl Kıyısı" (The Lake Shore)
 *
 * The wet one, and the fast one. A wide circuit all the way round a lake, with
 * the longest straight in the game up the eastern shore — and it is raining,
 * which turns every number the player has learned so far into the wrong number.
 *
 * WHAT CHANGES IN THE RAIN
 * Tarmac becomes `WET` (see `SURFACES` in `config/tuning.js`): about three
 * quarters of the grip, everywhere, all lap. Nothing about the track is
 * hostile — the corners are long and open and there is room to be wrong in —
 * but the entry speeds that worked on bölüm 1 do not work here, and the way you
 * find that out is the chicane at the end of the straight.
 *
 * THE WATER IS REAL. `map.water` puts a pane at a fixed height and the basin
 * under it does the rest, so the lake has a shoreline nobody drew: it is
 * exactly as big as the hollow the level dug for it. Drive in and you are in
 * mud, in the dark, at the bottom of something.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level5',
  name: 'Göl Kıyısı',
  subtitle: 'The Lake Shore',
  theme: 'rain',
  ambience: 'outside',
  /** Kumoi, with a whole-tone shimmer for the rain. @see src/audio/music/tracks/golKiyisi.js */
  music: 'golKiyisi',
  race: { laps: 2, rivals: 3 },

  map: {
    seed: 0x51ee11,
    /** Falling, and everything it lands on stays wet. @see World#_resolveSpec */
    weather: { kind: 'rain', amount: 0.95, wet: true },
    /** The basin, and the pane that turns it into a lake. */
    terrain: {
      shapes: [{ x: 20, z: 0, radius: 205, height: -26, falloff: 210 }],
    },
    water: { level: -7 },
    /** Wetland: fewer pines, more low cover. */
    scatter: { trees: 3200, rocks: 700, bushes: 3000, ferns: 2100, undergrowth: 1900 },
  },

  track: {
    loop: true,
    defaultWidth: 16,
    checkpoints: 16,
    startProgress: 0.02,

    points: [
      { x: 300, y: 2, z: -190, width: 17 },
      { x: 300.5, y: 2.1, z: -161.8, width: 17 },
      { x: 300.9, y: 2.3, z: -133.7, width: 17 },
      { x: 301.4, y: 2.6, z: -105.5, width: 17 },
      { x: 301.9, y: 2.9, z: -77.4, width: 17 },
      { x: 302.3, y: 3.4, z: -49.2, width: 17 },
      { x: 302.8, y: 3.8, z: -21.1, width: 17 },
      { x: 303.3, y: 4.3, z: 7.1, width: 17 },
      { x: 303.8, y: 4.7, z: 35.2, width: 17 },
      { x: 304.2, y: 5.1, z: 63.4, width: 17 },
      { x: 304.7, y: 5.5, z: 91.6, width: 17 },
      { x: 305.2, y: 5.8, z: 119.7, width: 17 },
      { x: 305.6, y: 5.9, z: 147.9, width: 17 },
      { x: 305.1, y: 6.1, z: 176, width: 16.8 },
      { x: 301, y: 6.3, z: 203.8, width: 16.1 },
      { x: 290.1, y: 7, z: 229.6, width: 16 },
      { x: 274.5, y: 7.8, z: 252.7, width: 16 },
      { x: 254.8, y: 8.7, z: 272.5, width: 16 },
      { x: 230.8, y: 9.6, z: 287.3, width: 16 },
      { x: 204.1, y: 10.3, z: 295.6, width: 16 },
      { x: 176.4, y: 10.8, z: 298.7, width: 16 },
      { x: 148.8, y: 11, z: 295.6, width: 15.9 },
      { x: 123.9, y: 11, z: 282.5, width: 15.1 },
      { x: 98.9, y: 11, z: 269.5, width: 14.3 },
      { x: 72.4, y: 11, z: 261.1, width: 14 },
      { x: 44.6, y: 11, z: 256.3, width: 14 },
      { x: 16.9, y: 11, z: 252.1, width: 14 },
      { x: -11, y: 11, z: 256, width: 14 },
      { x: -38.9, y: 11, z: 259.9, width: 14 },
      { x: -66.1, y: 10.8, z: 266.5, width: 14.3 },
      { x: -92.5, y: 10.4, z: 276.3, width: 14.8 },
      { x: -120.1, y: 9.7, z: 279.2, width: 15 },
      { x: -148.2, y: 8.8, z: 278.4, width: 15 },
      { x: -174.1, y: 8.4, z: 267.5, width: 15 },
      { x: -200.2, y: 8, z: 257.2, width: 15.1 },
      { x: -227.9, y: 7.8, z: 252, width: 15.6 },
      { x: -254.8, y: 7.5, z: 244.5, width: 16 },
      { x: -280.1, y: 7, z: 232, width: 16 },
      { x: -303.3, y: 6.4, z: 216.6, width: 16 },
      { x: -324.3, y: 5.7, z: 197.9, width: 16 },
      { x: -341.7, y: 4.9, z: 176, width: 16 },
      { x: -357, y: 4, z: 152.4, width: 16 },
      { x: -366.8, y: 3, z: 126.2, width: 16 },
      { x: -375.2, y: 2.1, z: 99.3, width: 16 },
      { x: -376.4, y: 1.1, z: 71.2, width: 16 },
      { x: -376.5, y: 0.1, z: 43.1, width: 16 },
      { x: -369.8, y: -0.8, z: 15.8, width: 16 },
      { x: -361.3, y: -1.6, z: -10.9, width: 16 },
      { x: -347.5, y: -2.3, z: -35.4, width: 16 },
      { x: -331.2, y: -3, z: -58.1, width: 16 },
      { x: -311.4, y: -3.5, z: -78.1, width: 16 },
      { x: -288.9, y: -3.8, z: -94.6, width: 16 },
      { x: -264.5, y: -4, z: -108.6, width: 16 },
      { x: -237.4, y: -3.9, z: -114.7, width: 16 },
      { x: -209.5, y: -3.8, z: -118.1, width: 16 },
      { x: -181.5, y: -3.7, z: -121.5, width: 16 },
      { x: -153.8, y: -3.5, z: -126.3, width: 16 },
      { x: -126.2, y: -3.3, z: -131.7, width: 16 },
      { x: -98.5, y: -3, z: -137.1, width: 16 },
      { x: -71.6, y: -2.7, z: -145.3, width: 16 },
      { x: -44.9, y: -2.4, z: -154.2, width: 16 },
      { x: -18.2, y: -2, z: -163.1, width: 16 },
      { x: 7, y: -1.7, z: -175.6, width: 16 },
      { x: 32.1, y: -1.4, z: -188.4, width: 16 },
      { x: 57.1, y: -1, z: -201.4, width: 16 },
      { x: 80.3, y: -0.8, z: -217.3, width: 16 },
      { x: 103.5, y: -0.5, z: -233.3, width: 16 },
      { x: 126.6, y: -0.3, z: -249.4, width: 16 },
      { x: 148.6, y: -0.2, z: -266.9, width: 16 },
      { x: 170.6, y: -0.1, z: -284.5, width: 16 },
      { x: 193.3, y: 0, z: -299.6, width: 16 },
      { x: 221, y: 0.2, z: -295.2, width: 16 },
      { x: 246.8, y: 0.6, z: -283.9, width: 16 },
      { x: 268.8, y: 1, z: -266.5, width: 16 },
      { x: 285.7, y: 1.5, z: -244, width: 16 },
      { x: 296.3, y: 1.9, z: -217.9, width: 16 },
    ],

    /**
     * Standing water. It gathers where the camber gives up — the inside of the
     * long right, and the exit of the chicane — and it is MUD rather than
     * merely wet: forty centimetres of it, and the tyres stop steering.
     */
    patches: [
      { from: 0.24, to: 0.29, surface: 'MUD', runoff: 10 },
      { from: 0.42, to: 0.46, surface: 'MUD', runoff: 12 },
    ],

    barriers: { enabled: true, sides: ['left', 'right'], gaps: [] },
  },
});
