/**
 * CONTACTS — cars hitting each other.
 *
 * The static `CollisionGrid` only knows about the world: trees, rocks, Armco.
 * Vehicles are moving, so they need their own pass, and without it cars simply
 * drive through each other — which reads as "the AI is a ghost" and takes all
 * the meaning out of a close race.
 *
 * This runs once per fixed step, after every vehicle has integrated. With four
 * to six cars the O(n²) pair loop is free, so there is no broad phase and no
 * spatial structure to keep in sync.
 *
 * The model is an impulse between two circles, resolved on the horizontal plane
 * only. It is not a rigid-body solver and does not try to be: an arcade racer
 * wants contact to feel like a shove with consequences, not like a physics demo.
 */

import * as THREE from 'three';
import { events } from '../core/events.js';
import { clamp01 } from '../core/mathx.js';

/** How car-on-car contact behaves. All of it is feel, none of it is physics law. */
export const CONTACT = {
  /** Bounciness of a car-to-car hit. Lower than a wall: metal absorbs. */
  restitution: 0.22,
  /**
   * Fraction of the overlap resolved per step. Below 1 the separation is
   * gradual, which stops two cars wedged together from flicking apart.
   */
  separation: 0.7,
  /** Speed lost along the contact normal, on top of the bounce. */
  damping: 0.18,
  /**
   * Spin imparted by an off-centre hit. This is what makes a tap on the rear
   * quarter send a car sideways instead of just nudging it along.
   */
  spinGain: 0.055,
  /** Sideways rub between cars running alongside each other. */
  friction: 0.12,
  /** Below this closing speed, resolve position but do not make a sound. */
  quietSpeed: 2.5,
  /** Impacts closer together than this share one event. */
  eventCooldown: 0.25,
  /** Vertical clearance, metres. Above this one car is over the other. */
  verticalClearance: 1.6,
};

const _n = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

/**
 * Resolve every vehicle-vehicle contact in the list.
 * @param {import('./vehicle.js').Vehicle[]} vehicles
 * @param {number} dt
 */
export function resolveVehicleContacts(vehicles, dt) {
  for (let i = 0; i < vehicles.length; i++) {
    const a = vehicles[i];
    if (a.disabled) continue;
    for (let j = i + 1; j < vehicles.length; j++) {
      const b = vehicles[j];
      if (b.disabled) continue;
      resolvePair(a, b, dt);
    }
  }
}

/** Deepest overlap between two cars' probe circles, or null. */
function findOverlap(a, b) {
  let best = null;
  for (let i = 0; i < a.collisionProbes.length; i++) {
    a.probePosition(i, _pa);
    for (let j = 0; j < b.collisionProbes.length; j++) {
      b.probePosition(j, _pb);
      const dx = _pb.x - _pa.x;
      const dz = _pb.z - _pa.z;
      const distSq = dx * dx + dz * dz;
      const minDist = a.collisionRadius + b.collisionRadius;
      if (distSq >= minDist * minDist) continue;
      const dist = Math.sqrt(distSq) || 1e-4;
      const depth = minDist - dist;
      if (!best || depth > best.depth) {
        best = {
          depth,
          nx: dx / dist,
          nz: dz / dist,
          // Lever arms: where on each car the contact landed, along its length.
          leverA: a.collisionProbes[i],
          leverB: b.collisionProbes[j],
        };
      }
    }
  }
  return best;
}

function resolvePair(a, b, dt) {
  // One car airborne over another is not a contact.
  if (Math.abs(a.position.y - b.position.y) > CONTACT.verticalClearance) return;

  const hit = findOverlap(a, b);
  if (!hit) return;

  const invA = 1 / a.tuning.mass;
  const invB = 1 / b.tuning.mass;
  const invSum = invA + invB;
  if (invSum <= 0) return;

  _n.set(hit.nx, 0, hit.nz);

  // -- positional correction ------------------------------------------------
  // Split by inverse mass, so the heavier car barely moves. A cop cruiser
  // shoving a hatchback should look like exactly that.
  const push = hit.depth * CONTACT.separation;
  a.position.addScaledVector(_n, -push * (invA / invSum));
  b.position.addScaledVector(_n, push * (invB / invSum));

  // -- impulse --------------------------------------------------------------
  _rel.subVectors(b.velocity, a.velocity);
  const closing = _rel.dot(_n);
  if (closing > 0) return; // already separating; the push above is enough

  const impulse = (-(1 + CONTACT.restitution) * closing) / invSum;
  a.velocity.addScaledVector(_n, -impulse * invA);
  b.velocity.addScaledVector(_n, impulse * invB);

  // Bleed a little speed so repeated contact does not act as a slingshot.
  const loss = 1 - CONTACT.damping * clamp01(-closing / 20);
  a.velocity.multiplyScalar(loss);
  b.velocity.multiplyScalar(loss);

  // -- tangential rub -------------------------------------------------------
  // Two cars sliding along each other should drag, not glide.
  _rel.addScaledVector(_n, -closing);
  const tangential = _rel.length();
  if (tangential > 0.01) {
    _rel.multiplyScalar(1 / tangential);
    const rub = Math.min(tangential, Math.abs(impulse) * CONTACT.friction * invSum);
    a.velocity.addScaledVector(_rel, rub * invA * a.tuning.mass * 0.5);
    b.velocity.addScaledVector(_rel, -rub * invB * b.tuning.mass * 0.5);
  }

  // -- spin -----------------------------------------------------------------
  // An impulse applied away from the centre rotates the car. `right` gives the
  // sideways component; the probe offset gives the lever arm. Heading decreases
  // when the nose swings right (see the convention note in vehicle.js).
  const sideA = _n.dot(a.right);
  const sideB = _n.dot(b.right);
  const spin = impulse * CONTACT.spinGain;
  a.yawRate += sideA * hit.leverA * spin * invA;
  b.yawRate -= sideB * hit.leverB * spin * invB;

  // -- feedback -------------------------------------------------------------
  const speed = -closing;
  if (speed < CONTACT.quietSpeed) return;
  const now = a._contactAt || 0;
  const t = (globalThis.performance?.now?.() ?? Date.now()) / 1000;
  if (t - now < CONTACT.eventCooldown) return;
  a._contactAt = t;
  b._contactAt = t;

  const intensity = clamp01(speed / 22);
  events.emit('vehicle:contact', {
    a: a.id,
    b: b.id,
    intensity,
    speed,
    position: _pa.clone(),
  });
  // Only shake the camera for a hit the player was part of.
  if (a.isPlayer || b.isPlayer) {
    events.emit('camera:shake', { source: 'collision', scale: intensity * 0.8 });
    events.emit('vehicle:collision', { id: 'contact', intensity, position: _pa.clone() });
  }
}
