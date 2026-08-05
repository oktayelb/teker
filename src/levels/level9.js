/**
 * BÖLÜM 9 — "Havai Hat" (The Skyway)
 *
 * A road built over a forest by people who had stopped pretending it was a
 * road. Half the lap is deck: up out of the trees at the eastern end, four
 * hundred metres of it straight across the middle of the map at forty metres,
 * and a helix down at the far side that gives back thirty-two of them.
 *
 * THE CROSSING IS OVER YOUR OWN ROAD
 * At (86, 201) the deck passes thirty metres above leg E — the piece of ground
 * road that takes you home. You drive under it on the way round and over it on
 * the way back, and both times the game has to answer "what is the ground
 * here?" with the right one of two answers. That is the whole of `deck` in
 * `src/world/track.js`: from underneath there is forest floor and a ceiling,
 * from on top there is a road and a fall.
 *
 * WHAT IT IS FOR
 * Bölüm 6 used the air to be frightening — narrow, in fog, spiralling. This one
 * uses it to be fast. The deck is straight, it is the quickest part of the lap,
 * and the only thing between the car and the trees a long way down is a
 * parapet the height of a wheel.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level9',
  name: 'Havai Hat',
  subtitle: 'The Skyway',
  theme: 'outside',
  ambience: 'outside',
  race: { laps: 2, rivals: 3 },

  map: {
    seed: 0x9a17e0,
    terrain: {
      /** A shallow bowl under the crossing, so there is a drop to look down. */
      shapes: [{ x: 150, z: 60, radius: 150, height: -18, falloff: 220 }],
    },
    /** Same reason as bölüm 6: the glass has a deck to clear. */
    domes: { margin: 140 },
    scatter: { trees: 4400, rocks: 900, bushes: 2400 },
  },

  track: {
    loop: true,
    defaultWidth: 15,
    checkpoints: 16,
    startProgress: 0.02,

    points: [
      { x: -250, y: 0, z: -256, width: 16 },
      { x: -222, y: 0.1, z: -254.3, width: 16 },
      { x: -193.9, y: 0.3, z: -252.5, width: 16 },
      { x: -165.9, y: 0.4, z: -250.8, width: 16 },
      { x: -137.9, y: 0.7, z: -249.1, width: 16 },
      { x: -109.8, y: 1.1, z: -247.3, width: 16 },
      { x: -81.8, y: 1.4, z: -245.6, width: 16 },
      { x: -53.8, y: 1.8, z: -243.9, width: 16 },
      { x: -25.8, y: 2.2, z: -242.1, width: 16 },
      { x: 2.3, y: 2.6, z: -240.4, width: 16 },
      { x: 30.3, y: 2.9, z: -238.6, width: 16 },
      { x: 58.3, y: 3.3, z: -236.9, width: 16 },
      { x: 86.4, y: 3.6, z: -235.2, width: 16 },
      { x: 114.4, y: 3.7, z: -233.4, width: 16 },
      { x: 142.4, y: 3.9, z: -231.7, width: 16 },
      { x: 170.4, y: 4, z: -229.9, width: 16 },
      { x: 198.3, y: 6.7, z: -226.1, width: 14.1 },
      { x: 224.1, y: 9.4, z: -215.3, width: 14 },
      { x: 246.4, y: 12, z: -198.3, width: 14 },
      { x: 263.6, y: 14.7, z: -176.3, width: 14 },
      { x: 274.7, y: 17.4, z: -150.8, width: 14 },
      { x: 279, y: 20.1, z: -123.2, width: 14 },
      { x: 276.2, y: 22.7, z: -95.6, width: 14 },
      { x: 265.3, y: 24.7, z: -70.2, width: 13.8 },
      { x: 249.8, y: 26, z: -46.8, width: 13.4 },
      { x: 234.3, y: 27.3, z: -23.4, width: 13.1 },
      { x: 218.8, y: 28.6, z: 0.1, width: 13 },
      { x: 203.3, y: 29.9, z: 23.5, width: 13 },
      { x: 187.8, y: 31.2, z: 46.9, width: 13 },
      { x: 172.3, y: 32.5, z: 70.3, width: 13 },
      { x: 156.8, y: 33.8, z: 93.7, width: 13 },
      { x: 141.3, y: 35.1, z: 117.2, width: 13 },
      { x: 125.8, y: 36.4, z: 140.6, width: 13 },
      { x: 110.3, y: 37.8, z: 164, width: 13 },
      { x: 94.8, y: 39.1, z: 187.4, width: 13 },
      { x: 79.3, y: 40.4, z: 210.8, width: 13 },
      { x: 63.8, y: 41.7, z: 234.2, width: 13 },
      { x: 50.9, y: 40.5, z: 259.1, width: 13 },
      { x: 46.1, y: 38.5, z: 286.6, width: 13 },
      { x: 51, y: 36.5, z: 314.1, width: 13 },
      { x: 64.3, y: 34.5, z: 338.5, width: 13 },
      { x: 84.6, y: 32.5, z: 357.5, width: 13 },
      { x: 109.9, y: 30.5, z: 369.1, width: 13 },
      { x: 137.7, y: 28.5, z: 371.8, width: 13 },
      { x: 164.7, y: 26.5, z: 364.6, width: 13 },
      { x: 187.9, y: 24.5, z: 349.2, width: 13 },
      { x: 205.1, y: 22.5, z: 327.3, width: 13 },
      { x: 214.4, y: 20.5, z: 301.1, width: 13 },
      { x: 214.9, y: 18.5, z: 273.2, width: 13 },
      { x: 205.6, y: 16.5, z: 246.9, width: 13 },
      { x: 188.3, y: 14.5, z: 225, width: 13 },
      { x: 165, y: 12.5, z: 209.8, width: 13 },
      { x: 138.1, y: 10.5, z: 202.8, width: 13 },
      { x: 110.1, y: 9.9, z: 201.5, width: 13.9 },
      { x: 82, y: 9.7, z: 201.1, width: 15 },
      { x: 53.9, y: 9.6, z: 200.7, width: 16 },
      { x: 25.8, y: 9.2, z: 200.2, width: 16 },
      { x: -2.3, y: 8.8, z: 199.8, width: 16 },
      { x: -30.3, y: 8.4, z: 199.4, width: 16 },
      { x: -58.4, y: 8, z: 198.9, width: 16 },
      { x: -86.5, y: 7.6, z: 198.5, width: 16 },
      { x: -114.6, y: 7.2, z: 198.1, width: 16 },
      { x: -142.7, y: 6.8, z: 197.6, width: 16 },
      { x: -170.7, y: 6.5, z: 197.2, width: 16 },
      { x: -198.8, y: 6.3, z: 196.8, width: 16 },
      { x: -226.9, y: 6.1, z: 196.4, width: 16 },
      { x: -254.9, y: 6, z: 195.2, width: 16 },
      { x: -282.7, y: 5.9, z: 190.8, width: 16 },
      { x: -310.4, y: 5.9, z: 186.4, width: 16 },
      { x: -336.3, y: 5.7, z: 176.5, width: 16 },
      { x: -361.4, y: 5.5, z: 163.8, width: 16 },
      { x: -385.7, y: 5.3, z: 150, width: 16 },
      { x: -405.5, y: 5.1, z: 130.2, width: 16 },
      { x: -425.4, y: 4.8, z: 110.3, width: 16 },
      { x: -440.8, y: 4.5, z: 87.2, width: 16 },
      { x: -453.5, y: 4.2, z: 62.2, width: 16 },
      { x: -465.4, y: 3.9, z: 36.9, width: 16 },
      { x: -469.8, y: 3.5, z: 9.1, width: 16 },
      { x: -474.2, y: 3.1, z: -18.6, width: 16 },
      { x: -473.4, y: 2.8, z: -46.3, width: 16 },
      { x: -469, y: 2.4, z: -74.1, width: 16 },
      { x: -464, y: 2.1, z: -101.6, width: 16 },
      { x: -451.3, y: 1.8, z: -126.6, width: 16 },
      { x: -438.5, y: 1.4, z: -151.7, width: 16 },
      { x: -421.9, y: 1.1, z: -173.8, width: 16 },
      { x: -402, y: 0.9, z: -193.7, width: 16 },
      { x: -382, y: 0.6, z: -213.3, width: 16 },
      { x: -356.9, y: 0.4, z: -226, width: 16 },
      { x: -331.9, y: 0.3, z: -238.8, width: 16 },
      { x: -305.5, y: 0.1, z: -247.2, width: 16 },
      { x: -277.7, y: 0.1, z: -251.6, width: 16 },
    ],

    /** The deck: out of the ramp, across the middle, and down the helix. */
    elevated: [{ from: 0.205, to: 0.555 }],

    patches: [{ from: 0.75, to: 0.82, surface: 'DIRT', runoff: 7 }],

    barriers: { enabled: true, sides: ['left', 'right'], gaps: [{ from: 0.205, to: 0.555 }] },
  },
});
