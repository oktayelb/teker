/**
 * BÖLÜM 7 — "Kar Hattı" (The Snow Line)
 *
 * Above where the forest bothers. White ground, white sky, snow coming down,
 * and a road that is the only dark thing in the world — which is the entire
 * design: on a map with no colour in it the trees ARE the map, and the corners
 * are read off a treeline rather than off a kerb.
 *
 * WHAT MAKES IT HARD
 * Not the shape. The esses are open and the radii are generous, and on a dry
 * day this would be the easiest lap in the game. It is the ice in the two
 * corners the sun never reaches — the north-facing ones, both of them on the
 * fast side of the plateau — and the fact that snow has taken the edges of the
 * road away, so the only thing telling you where the surface stops is a line of
 * posts somebody drove in before the weather closed.
 *
 * The ICE here is the same 0.12 that takes bölüm 8 away from the player. The
 * difference is that this one is signposted, in daylight, on a corner you can
 * see all the way through.
 */

import { defineLevel } from './defaults.js';

export default defineLevel({
  id: 'level7',
  name: 'Kar Hattı',
  subtitle: 'The Snow Line',
  theme: 'snow',
  ambience: 'outside',
  /** Hirajoshi, iced with whole tone — stillness, and cold. @see src/audio/music/tracks/karHatti.js */
  music: 'karHatti',
  race: { laps: 2, rivals: 3 },

  map: {
    seed: 0x7c0d1e,
    /** Snow, and it does not make the ground wet — it makes it snow. */
    weather: { kind: 'snow', amount: 0.9, wet: false },
    /** A plateau: high, open, and flat enough that the weather is the terrain. */
    terrain: {
      shapes: [{ x: 0, z: 0, radius: 330, height: 14, falloff: 260 }],
    },
    /** Thin, hard country. Half the trees, and almost nothing growing under them. */
    scatter: { trees: 1900, rocks: 1500, bushes: 500, ferns: 200, undergrowth: 300, litter: 400 },
  },

  track: {
    loop: true,
    defaultWidth: 15,
    checkpoints: 14,
    startProgress: 0.02,

    points: [
      { x: 250, y: 20, z: -40, width: 15 },
      { x: 245, y: 21, z: -12.4, width: 14.6 },
      { x: 239.9, y: 21.9, z: 15.2, width: 14.3 },
      { x: 232, y: 23.2, z: 41.6, width: 14 },
      { x: 217.5, y: 24.9, z: 65.7, width: 14 },
      { x: 203.1, y: 26.7, z: 89.7, width: 14 },
      { x: 183.9, y: 28, z: 109.6, width: 14 },
      { x: 161.9, y: 29, z: 127, width: 14 },
      { x: 139.9, y: 29.9, z: 144.4, width: 14 },
      { x: 119.7, y: 29.6, z: 163.8, width: 14 },
      { x: 99.7, y: 29.1, z: 183.4, width: 14 },
      { x: 75.9, y: 28.4, z: 197.2, width: 14 },
      { x: 49.8, y: 27.5, z: 207.3, width: 14 },
      { x: 22.7, y: 26.8, z: 212.2, width: 14 },
      { x: -5.3, y: 26.4, z: 211, width: 14 },
      { x: -33.3, y: 25.9, z: 210, width: 14.1 },
      { x: -61.3, y: 24.7, z: 210.1, width: 14.5 },
      { x: -89.4, y: 23.5, z: 210.1, width: 15 },
      { x: -115.3, y: 20.9, z: 199.5, width: 15 },
      { x: -141.3, y: 18.3, z: 188.9, width: 15 },
      { x: -161.9, y: 15.7, z: 170.3, width: 15 },
      { x: -181.9, y: 13.1, z: 150.6, width: 15 },
      { x: -194.9, y: 11.6, z: 126.2, width: 15 },
      { x: -206, y: 10.4, z: 100.4, width: 15 },
      { x: -203.1, y: 9.3, z: 74.3, width: 14.7 },
      { x: -193.4, y: 8.1, z: 48, width: 14.3 },
      { x: -188.4, y: 6.6, z: 21.1, width: 14 },
      { x: -191.7, y: 4.2, z: -6.7, width: 14 },
      { x: -198.7, y: 2.3, z: -33.2, width: 14 },
      { x: -214.3, y: 1.1, z: -56.5, width: 14 },
      { x: -229.9, y: 0, z: -79.8, width: 14 },
      { x: -225.1, y: -0.6, z: -107.4, width: 14.4 },
      { x: -220.1, y: -1.2, z: -134.9, width: 14.8 },
      { x: -210.8, y: -2.2, z: -161, width: 15 },
      { x: -196.5, y: -3.5, z: -185, width: 15 },
      { x: -182.2, y: -4.9, z: -209.1, width: 15 },
      { x: -161, y: -6.2, z: -227.3, width: 15 },
      { x: -139.1, y: -7.6, z: -244.8, width: 15 },
      { x: -115.4, y: -8.7, z: -259.1, width: 15 },
      { x: -88.8, y: -9.3, z: -267.8, width: 15 },
      { x: -62.2, y: -9.9, z: -276.6, width: 15 },
      { x: -34.4, y: -8.9, z: -279.9, width: 14.7 },
      { x: -6.5, y: -7.5, z: -282.1, width: 14.3 },
      { x: 21.3, y: -5.9, z: -282.9, width: 14 },
      { x: 48.7, y: -3.2, z: -276.5, width: 14 },
      { x: 76, y: -0.6, z: -270.2, width: 14 },
      { x: 101.3, y: 1.2, z: -258.8, width: 14 },
      { x: 125.4, y: 2.6, z: -244.5, width: 14 },
      { x: 149.5, y: 4, z: -230.3, width: 14 },
      { x: 170.7, y: 7, z: -212, width: 14.4 },
      { x: 191.9, y: 10, z: -193.6, width: 14.7 },
      { x: 210, y: 13, z: -172.9, width: 15 },
      { x: 222.2, y: 16, z: -147.6, width: 15 },
      { x: 234.3, y: 19.1, z: -122.3, width: 15 },
      { x: 241.2, y: 20, z: -95.4, width: 15 },
      { x: 245.6, y: 20, z: -67.7, width: 15 },
    ],

    /** The two corners that never see the sun. */
    patches: [
      { from: 0.23, to: 0.3, surface: 'ICE', runoff: 16 },
      { from: 0.6, to: 0.68, surface: 'ICE', runoff: 16 },
    ],

    /**
     * Posts, not Armco, and a rail only where the ground falls away. Snow has
     * covered the verges: the posts are the road's edge, and past them is
     * whatever the mountain is doing.
     */
    barriers: { enabled: true, sides: ['left', 'right'], gaps: [{ from: 0.15, to: 0.62 }] },
    markers: { enabled: true, spacing: 9, offset: 1.0, color: 0xd8483a },
  },
});
