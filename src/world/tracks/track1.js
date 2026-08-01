/**
 * PARKUR 1 — "Çam Halkası" (The Pine Ring)
 *
 * The friendly one. A wide, gently banked oval with a single soft chicane, cut
 * through mature pine forest in the south-west of the valley. Nothing here is
 * trying to catch you out: it exists to teach the car and to establish what a
 * normal race in this game looks like, so that the third one can break the rule.
 *
 * Fully barriered. You cannot leave. That is the point.
 */

export default {
  id: 'track1',
  name: 'Çam Halkası',
  subtitle: 'Pine Ring',
  loop: true,
  laps: 2,
  defaultWidth: 16,
  checkpoints: 12,
  /** 0..1 around the lap. Placed on the long south straight. */
  startProgress: 0.0,

  points: [
    { x: -198, y: 0, z: -360, width: 16 },
    { x: -214.5, y: 1.5, z: -264.3, width: 16 },
    { x: -299.9, y: 3, z: -197.6, width: 16 },
    { x: -400.5, y: 4.5, z: -149.2, width: 16 },
    { x: -518.3, y: 5, z: -153.3, width: 16 },
    { x: -613.6, y: 3.5, z: -204.2, width: 16 },
    { x: -703.1, y: 1, z: -265.3, width: 16 },
    { x: -722, y: -1, z: -360, width: 16 },
    { x: -707.9, y: -2.5, z: -456.6, width: 16 },
    { x: -618.5, y: -3, z: -520.8, width: 16 },
    { x: -518.9, y: -2, z: -568.8, width: 16 },
    { x: -401.7, y: -0.5, z: -566.7, width: 16 },
    { x: -303.2, y: 0.5, z: -519.1, width: 16 },
    { x: -219.2, y: 0, z: -453.8, width: 16 },
  ],

  /** No surface tricks. Tarmac all the way round. */
  patches: [],

  barriers: { enabled: true, sides: ['left', 'right'], gaps: [] },
};
