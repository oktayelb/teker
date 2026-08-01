/**
 * PARKUR 2 — "Dere Geçidi" (The Creek Crossing)
 *
 * The competent one. Narrower, with 34 metres of elevation change and two
 * corners that punish a lazy entry. There is a dirt section on the descent
 * where the tarmac was never finished — the first hint in the game that the
 * world has surfaces other than the one you were given.
 *
 * Still fully barriered. Still no way out. The player should finish this race
 * confident that they understand the rules.
 */

export default {
  id: 'track2',
  name: 'Dere Geçidi',
  subtitle: 'Creek Crossing',
  loop: true,
  laps: 2,
  defaultWidth: 14,
  checkpoints: 14,
  startProgress: 0.0,

  points: [
    { x: 749.1, y: 0, z: -195.5, width: 15 },
    { x: 674.2, y: 4, z: -139, width: 15 },
    { x: 614.8, y: 9, z: -77.8, width: 14 },
    { x: 525, y: 14, z: -34.4, width: 13 },
    { x: 437.5, y: 18, z: -90.8, width: 13 },
    { x: 349.2, y: 20, z: -107.8, width: 14 },
    { x: 265, y: 16, z: -156.2, width: 15 },
    { x: 255.1, y: 9, z: -240.9, width: 15 },
    { x: 255.6, y: 2, z: -323.3, width: 14 },
    { x: 329.6, y: -5, z: -378.4, width: 13 },
    { x: 385.2, y: -11, z: -442.2, width: 14 },
    { x: 474.5, y: -14, z: -489.7, width: 15 },
    { x: 564, y: -12, z: -433.2, width: 14 },
    { x: 654, y: -8, z: -415.4, width: 13 },
    { x: 730.6, y: -4, z: -361.9, width: 14 },
    { x: 730.2, y: -1, z: -277.9, width: 15 },
  ],

  /** Unfinished tarmac on the fast descent. Slower, looser, but survivable. */
  patches: [{ from: 0.58, to: 0.68, surface: 'DIRT' }],

  barriers: { enabled: true, sides: ['left', 'right'], gaps: [] },
};
