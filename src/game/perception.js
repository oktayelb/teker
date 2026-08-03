/**
 * PERCEPTION — the one answer to "can that car see this one?".
 *
 * WHY THIS IS NOT IN chase.js
 * ---------------------------
 * Because two things ask the question now. The scripted chase asks it about
 * cops that already know where you are, and the open-world patrols ask it about
 * a cruiser that does not. If those two ever drifted apart the player would meet
 * a patrol that saw them through a tree the recovery units could not see
 * through, and would read that — correctly — as the game cheating. The only
 * reliable way to keep two sets of rules identical is to have one set.
 *
 * THE THREE GATES, IN ORDER OF COST
 * ---------------------------------
 *   1. the disguise    — a felled tree on a parked car is not a car
 *   2. range and cone  — are you in front of them, and near enough
 *   3. occlusion       — is there a trunk in the way
 * Cheap first: the raycast walks the collision grid and is the only part of
 * this worth avoiding, so nothing reaches it that a subtraction could reject.
 *
 * Every number is a default out of `CHASE`; callers override per observer.
 * Nothing here holds state, allocates, or knows what a chase is.
 */

import { CHASE, TREES } from '../config/gameplay.js';

/**
 * @typedef {object} Seer   anything with a world position and a heading
 * @property {{x:number, z:number}} position
 * @property {number} heading
 */

/**
 * @param {Seer} observer the car doing the looking
 * @param {import('../vehicle/vehicle.js').Vehicle} target the car being looked for
 * @param {import('../world/world.js').World} world for the occlusion raycast
 * @param {object} [opts]
 * @param {number} [opts.range] metres, before any headlight modifier
 * @param {number} [opts.coneDeg] half-angle of the vision cone, degrees
 * @param {boolean} [opts.occlusion] let trunks and rock block sight
 * @param {{lit:number, dark:number}|null} [opts.headlightRange]
 *   Range multipliers by whether the *target* has its lights on. Null (the
 *   default) means lights make no difference — which is what the scripted chase
 *   wants, since those cops were told where you are by something other than
 *   their eyes. See `PATROL.headlightRange` for the version that does care.
 * @returns {boolean}
 */
export function canSee(observer, target, world, opts = {}) {
  const {
    range = CHASE.visionRange,
    coneDeg = CHASE.visionConeDeg,
    occlusion = CHASE.occlusionCheck,
    headlightRange = null,
  } = opts;

  // A tree came down on the car and stayed there. Sitting still under it, you
  // are a fallen pine and they drive past. Moving, you are a fallen pine doing
  // 60 km/h, which is worse than no disguise at all — so this only holds while
  // the car is barely rolling. `TREES.disguiseSpeed` is that line.
  if (target.disguised && target.speed < TREES.disguiseSpeed) return false;

  const reach = range * headlightScale(target, headlightRange);
  const dx = target.position.x - observer.position.x;
  const dz = target.position.z - observer.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > reach) return false;

  // Cone: are you in front of them?
  const invD = 1 / (dist || 1);
  const dot = dx * invD * Math.sin(observer.heading) + dz * invD * Math.cos(observer.heading);
  if (dot < Math.cos((coneDeg * Math.PI) / 180)) return false;

  // Occlusion: trees and rock actually hide you. Skipped at knife range, where
  // a trunk between two touching cars is not what is deciding the outcome.
  if (occlusion && dist > CHASE.occlusionMinDistance) {
    if (world.collision.raycastBlocked(observer.position.x, observer.position.z, target.position.x, target.position.z)) {
      return false;
    }
  }
  return true;
}

/**
 * How much further a lit car can be seen from.
 *
 * Headlights are the loudest thing about a car at night and close to the
 * quietest during the day, but this makes no attempt to know which it is — the
 * penalty is for *running lit*, not for the sun being down, and it is a penalty
 * rather than a bonus for running dark so that the default state of the car
 * (lights off) is never a free gift. Turning them on is the choice with a cost.
 *
 * @param {{chassis?: {headlightsOn?: boolean}}} target
 * @param {{lit:number, dark:number}|null} scale
 * @returns {number}
 */
export function headlightScale(target, scale) {
  if (!scale) return 1;
  return target?.chassis?.headlightsOn ? scale.lit : scale.dark;
}
