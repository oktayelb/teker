/**
 * BÖLÜM 4 — "Taşocağı" (The Quarry)
 *
 * The first level that is not a road through a forest. Somebody took this hill
 * apart for its stone and left the benches they cut behind, and the parkour is
 * simply the haul route: a floor, two hairpins, and a rim.
 *
 * WHAT IT TEACHES
 * The first three levels are about a car on a surface. This one is about
 * ALTITUDE. Forty-six metres separate the floor from the rim, the hairpins are
 * the price of every one of them, and the plunge back down is the first time
 * the game asks the player to brake for something they cannot see over.
 *
 * The gravel on the plunge is the quarry's own spoil, washed across the road,
 * and it is placed where the temptation is worst: the outside line, halfway
 * down, exactly where a car carrying too much speed goes looking for grip.
 *
 * The barriers stop at the rim. Nothing beyond that edge but the pit you were
 * driving round ten seconds ago — the level can be *seen* from inside itself,
 * which is the whole reason to cut a track into a hole in the ground.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level4',
  name: 'Taşocağı',
  subtitle: 'The Quarry',
  theme: 'dusk',
  ambience: 'outside',
  race: { laps: 2, rivals: 3 },

  map: {
    seed: 0x4a3d21,
    /**
     * The pit. Without this the level is a loop on a hillside — a quarry is a
     * hole, and a hole has to be dug rather than hoped for. The floor sits
     * fourteen metres under the surrounding ground and the rim road runs round
     * the top of the falloff.
     */
    terrain: {
      shapes: [{ x: -10, z: -70, radius: 165, height: -14, falloff: 190 }],
    },
    /**
     * Forty-six metres of relief between the pit floor and the rim, so the
     * glass over it has to reach further out to stay climbable. Even then the
     * roof is steep where it crosses the quarry wall — which is honest: that
     * is a cliff, and there is glass over it.
     */
    domes: { margin: 130 },
    /** Stone country: thin trees, and rocks everywhere the machines left them. */
    scatter: { trees: 1500, rocks: 2800, bushes: 1500, ferns: 700, undergrowth: 700 },
  },

  track: {
    loop: true,
    defaultWidth: 14,
    checkpoints: 14,
    startProgress: 0.02,

    points: [
      { x: -240, y: -12, z: -192, width: 15 },
      { x: -211.9, y: -11.9, z: -192, width: 15 },
      { x: -183.8, y: -11.8, z: -192, width: 15 },
      { x: -155.8, y: -11.6, z: -192, width: 15 },
      { x: -127.7, y: -11.3, z: -192, width: 15 },
      { x: -99.6, y: -11, z: -192, width: 15 },
      { x: -71.5, y: -10.6, z: -192, width: 15 },
      { x: -43.5, y: -10.2, z: -192, width: 15 },
      { x: -15.4, y: -9.9, z: -192, width: 15 },
      { x: 12.7, y: -9.5, z: -192, width: 15 },
      { x: 40.8, y: -9.1, z: -192, width: 15 },
      { x: 68.9, y: -8.8, z: -192, width: 15 },
      { x: 96.9, y: -8.5, z: -192, width: 15 },
      { x: 125, y: -8.3, z: -192, width: 15 },
      { x: 153.1, y: -8.2, z: -192, width: 15 },
      { x: 181.2, y: -8, z: -192, width: 15 },
      { x: 208.7, y: -6.6, z: -188, width: 12 },
      { x: 230.9, y: -4.5, z: -171.6, width: 12 },
      { x: 241.5, y: -2.4, z: -146, width: 12 },
      { x: 237.3, y: -0.4, z: -118.5, width: 12 },
      { x: 219.4, y: 1.7, z: -97.3, width: 12 },
      { x: 193.1, y: 3.8, z: -88.5, width: 12 },
      { x: 165.2, y: 5.2, z: -86.1, width: 12.4 },
      { x: 137.2, y: 6.6, z: -83.9, width: 12.9 },
      { x: 109.2, y: 8, z: -81.7, width: 13 },
      { x: 81.2, y: 9.4, z: -79.5, width: 13 },
      { x: 53.2, y: 10.8, z: -77.4, width: 13 },
      { x: 25.2, y: 12.2, z: -75.2, width: 13 },
      { x: -2.8, y: 13.6, z: -73, width: 13 },
      { x: -30.8, y: 15, z: -70.8, width: 13 },
      { x: -58.8, y: 16.4, z: -68.6, width: 13 },
      { x: -86.8, y: 17.8, z: -66.5, width: 13 },
      { x: -114.8, y: 19.2, z: -64.3, width: 13 },
      { x: -142.8, y: 20.6, z: -62.1, width: 13 },
      { x: -170.8, y: 22, z: -59.9, width: 13 },
      { x: -198.5, y: 23, z: -55.8, width: 13 },
      { x: -224.5, y: 23.9, z: -45.8, width: 13 },
      { x: -247.7, y: 24.9, z: -30.4, width: 13 },
      { x: -267.1, y: 25.9, z: -10.5, width: 13 },
      { x: -281.9, y: 26.8, z: 13.4, width: 13 },
      { x: -289.3, y: 27.8, z: 40.5, width: 13 },
      { x: -290.6, y: 28.7, z: 68.3, width: 13 },
      { x: -286, y: 29.7, z: 95.7, width: 13 },
      { x: -275.6, y: 30.6, z: 121.6, width: 13 },
      { x: -259.6, y: 31.6, z: 144.7, width: 13 },
      { x: -237.8, y: 32.5, z: 162.4, width: 13 },
      { x: -213, y: 33.5, z: 174.9, width: 13 },
      { x: -186, y: 33.9, z: 180.7, width: 13.2 },
      { x: -157.9, y: 33.8, z: 181.5, width: 13.6 },
      { x: -129.8, y: 33.7, z: 182.2, width: 13.9 },
      { x: -101.8, y: 33.4, z: 182.9, width: 14 },
      { x: -73.7, y: 33.2, z: 183.7, width: 14 },
      { x: -45.6, y: 32.9, z: 184.4, width: 14 },
      { x: -17.6, y: 32.5, z: 185.1, width: 14 },
      { x: 10.5, y: 32.2, z: 185.8, width: 14 },
      { x: 38.6, y: 31.9, z: 186.6, width: 14 },
      { x: 66.7, y: 31.6, z: 187.3, width: 14 },
      { x: 94.7, y: 31.3, z: 188, width: 14 },
      { x: 122.8, y: 31.2, z: 188.8, width: 14 },
      { x: 150.9, y: 31.1, z: 189.5, width: 14 },
      { x: 178.7, y: 30.7, z: 191.9, width: 13.2 },
      { x: 206.5, y: 29.8, z: 193.4, width: 12 },
      { x: 232.9, y: 28.9, z: 184.6, width: 12 },
      { x: 253.7, y: 27.9, z: 166.2, width: 12 },
      { x: 266.9, y: 27, z: 141.7, width: 12 },
      { x: 270.2, y: 26.1, z: 114.1, width: 12 },
      { x: 262.3, y: 25.2, z: 87.4, width: 12 },
      { x: 245.8, y: 24.2, z: 65, width: 12 },
      { x: 222.2, y: 23.3, z: 50.4, width: 12 },
      { x: 194.7, y: 22.4, z: 46.1, width: 12 },
      { x: 166.8, y: 20.8, z: 48.9, width: 12.5 },
      { x: 139, y: 18.8, z: 53.1, width: 13.3 },
      { x: 111.2, y: 16.8, z: 56.9, width: 14 },
      { x: 83.2, y: 14.7, z: 59, width: 14 },
      { x: 55.2, y: 12.6, z: 61.2, width: 14 },
      { x: 27.2, y: 10.5, z: 60.1, width: 14 },
      { x: -0.8, y: 8.3, z: 58.3, width: 14 },
      { x: -28.4, y: 6.2, z: 53.6, width: 14 },
      { x: -55.6, y: 4, z: 46.7, width: 14 },
      { x: -82.2, y: 1.8, z: 38.1, width: 14 },
      { x: -107.8, y: -0.4, z: 26.4, width: 14 },
      { x: -133.1, y: -2.5, z: 14.3, width: 14 },
      { x: -156.7, y: -4.6, z: -0.8, width: 14 },
      { x: -180.4, y: -6.7, z: -16, width: 14 },
      { x: -203.1, y: -8.7, z: -32.4, width: 14 },
      { x: -225.6, y: -10.7, z: -49.2, width: 14 },
      { x: -250, y: -12, z: -61.4, width: 14.5 },
      { x: -276.1, y: -12, z: -70.9, width: 15 },
      { x: -295.2, y: -12, z: -91.1, width: 15 },
      { x: -305.3, y: -12, z: -117, width: 15 },
      { x: -302.6, y: -12, z: -144.7, width: 15 },
      { x: -289.7, y: -12, z: -169.4, width: 15 },
      { x: -267, y: -12, z: -185.5, width: 15 },
    ],

    /**
     * Spoil washed down onto the plunge, and the loose stuff on the floor of
     * the pit where the water collects. Neither is a trap — both are visible,
     * and both are on the line you want.
     */
    patches: [
      { from: 0.79, to: 0.9, surface: 'DIRT', runoff: 8 },
      { from: 0.02, to: 0.08, surface: 'DIRT', runoff: 6 },
    ],

    /** Armco on the pit side, and nothing at all along the rim. */
    barriers: { enabled: true, sides: ['left', 'right'], gaps: [{ from: 0.5, to: 0.73 }] },
    markers: { enabled: true, spacing: 11, offset: 1.1, color: 0xe8c84a, gaps: [{ from: 0.0, to: 0.5 }, { from: 0.73, to: 1 }] },
  },
});
