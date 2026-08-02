/**
 * TREES — trunks that remember being hit, and the disguise.
 *
 * A trunk has a capacity. Every impact spends momentum against it — mass times
 * closing speed, in kg·m/s — and the trunk keeps the running total. Worry a
 * tree with three medium hits and it comes down just the same as one big one.
 *
 * When it does come down, it comes down ON THE CAR, and it stays there. That is
 * not a flourish: a car wearing a pine is not a car any more, and getting out
 * of sight of the recovery units is the only thing you have. See
 * `src/game/chase.js` for the half of this that the cops care about. Wearing it
 * is not a life sentence — handbrake and throttle together shrug it off, see
 * `update` — because a disguise that can only be worn while parked would
 * otherwise be a trap.
 *
 * NONE OF IT IS ON AT THE START
 * -----------------------------
 * Two switches, both flipped by events this file never looks for on purpose:
 * `breakable` (a trunk can be hurt at all) and `armed` (a felled one gets worn).
 * Until the first cops are shaken off, neither is set — the forest takes no
 * damage, leans nowhere, and simply stops cars. And only the player's car is
 * ever allowed to hurt a trunk, or the recovery units would fell trees onto
 * themselves. See `TREES.breakableBy` / `armedBy` / `playerOnly`.
 *
 * WHAT A TREE IS, HERE
 * --------------------
 * One collider object out of `Scatter`. It carries its own identity — which
 * InstancedMesh draws it, at which index, from which base matrix — so this file
 * can lean it, darken it, or take it out of the world entirely without owning a
 * parallel registry of trees. See `scatter.js` where those fields are set.
 *
 * A felled tree leaves NO collider behind: it is disabled the moment it falls,
 * both where it stood and where it lands. You cannot crash into your own hat.
 */

import * as THREE from 'three';
import { events, Subscriptions } from '../core/events.js';
import { TREES } from '../config/gameplay.js';
import { clamp01 } from '../core/mathx.js';

const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _lean = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _color = new THREE.Color();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class Trees {
  constructor() {
    /** Trees currently lying on a vehicle, so they can be cleaned up. */
    this._worn = new Map();
    /** Covers the player has shrugged off, left standing in the world. */
    this._dropped = [];
    /** Canopy geometries we built ourselves, and therefore have to dispose. */
    this._canopies = [];
    /**
     * Until this is true a trunk cannot be hurt at all: no damage kept, no
     * lean, no splintering, nothing comes down. The forest is scenery you
     * should not drive into and nothing more. Armed by `TREES.breakableBy` —
     * see the config for why the whole model waits for the first escape.
     */
    this.breakable = false;
    /**
     * Until this is true, trees fall but nobody wears them. Armed by an event
     * (`TREES.armedBy`, currently `chase:started`) rather than by a call, so
     * this file needs to know nothing about the chase — or that a story exists.
     */
    this.armed = false;
    /** The shed prompt is a one-time thing. See `_wear`. */
    this._toldHowToShed = false;
    this.subs = new Subscriptions();
    for (const ev of [].concat(TREES.breakableBy)) this.subs.on(ev, () => this.allowDamage());
    for (const ev of [].concat(TREES.armedBy)) this.subs.on(ev, () => this.arm());
  }

  /** Let trunks start taking damage. Nothing before this point marks them. */
  allowDamage() {
    this.breakable = true;
    return this;
  }

  /** Allow felled trees to be worn from here on. */
  arm() {
    this.armed = true;
    return this;
  }

  /** Is this collider something with a trunk? */
  static isFellable(collider) {
    return !!collider && TREES.fellable.includes(collider.kind);
  }

  /** How much punishment this particular trunk can take, in joules. */
  static capacity(collider) {
    const r = collider.type === 'cylinder' ? collider.radius : Math.hypot(collider.halfX, collider.halfZ);
    return Math.max(1, r) * TREES.capacityPerRadius;
  }

  /**
   * Spend an impact against a trunk.
   *
   * @param {object} vehicle the thing that hit it
   * @param {object} collider the tree, from the collision grid
   * @param {number} energy joules — ½·mass·closingSpeed²
   * @returns {'none'|'damaged'|'felled'}
   */
  impact(vehicle, collider, energy) {
    // Nothing marks a tree before the forest is armed — see `TREES.breakableBy`.
    // The collider is untouched either way, so the trunk still stops the car and
    // still hides it; it simply does not remember being hit.
    if (!this.breakable) return 'none';
    // And only ever the player. A cop that fells a tree ends up wearing it.
    if (TREES.playerOnly && !vehicle?.isPlayer) return 'none';
    if (!Trees.isFellable(collider) || collider.felled) return 'none';
    if (!(energy > TREES.minImpactEnergy)) return 'none';

    const capacity = collider.capacity ?? (collider.capacity = Trees.capacity(collider));
    collider.damage = (collider.damage || 0) + energy;

    if (collider.damage < capacity) {
      this._showDamage(collider, clamp01(collider.damage / capacity));
      events.emit('tree:damaged', {
        kind: collider.kind,
        damage: collider.damage,
        capacity,
        x: collider.x,
        z: collider.z,
      });
      return 'damaged';
    }

    this._fell(collider, vehicle);
    return 'felled';
  }

  /**
   * A hit trunk leans and darkens, and both scale with how close it is to
   * going. The player has to be able to read "this one is nearly down" from
   * the car, at speed, without a health bar.
   */
  _showDamage(collider, t) {
    const mesh = collider.mesh;
    if (!mesh || collider.instance < 0) return;

    collider.baseMatrix.decompose(_pos, _q, _scl);
    // Lean about a fixed per-tree axis so repeated hits bend it further the
    // same way rather than wobbling it around.
    if (collider.leanAxis === undefined) {
      const a = Math.atan2(collider.z, collider.x) + collider.instance * 1.7;
      collider.leanAxis = a;
    }
    _axis.set(Math.cos(collider.leanAxis), 0, Math.sin(collider.leanAxis));
    _lean.setFromAxisAngle(_axis, t * TREES.maxLean);
    _q.premultiply(_lean);
    mesh.setMatrixAt(collider.instance, _m.compose(_pos, _q, _scl));
    mesh.instanceMatrix.needsUpdate = true;

    const shade = collider.tint * (1 - t * (1 - TREES.damageTint));
    _color.setRGB(shade, shade * 0.94, shade * 0.88); // browner as it splinters
    mesh.setColorAt(collider.instance, _color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Take it out of the world where it stood, and put it on the car. */
  _fell(collider, vehicle) {
    collider.felled = true;
    // No hitbox, either as a stump or as a hat.
    collider.disabled = true;
    collider.blocksSight = false;

    const mesh = collider.mesh;
    if (mesh && collider.instance >= 0) {
      mesh.setMatrixAt(collider.instance, _hidden);
      mesh.instanceMatrix.needsUpdate = true;
    }

    // Before the chase there is nothing to hide from, so the tree just goes.
    if (vehicle && this.armed) this._wear(vehicle, collider);

    events.emit('tree:felled', {
      kind: collider.kind,
      x: collider.x,
      z: collider.z,
      vehicleId: vehicle?.id ?? null,
    });
  }

  /**
   * Drape the tree over the car. Parented to the vehicle's visual root, so it
   * rides along with the body — including the roll and pitch, which is what
   * sells it as resting on the roof rather than pinned to the screen.
   */
  _wear(vehicle, collider) {
    const src = collider.mesh;
    if (!src || !vehicle.object) return;

    // Only one tree fits. A second is a waste of a draw call and looks silly.
    if (this._worn.has(vehicle)) {
      this._worn.get(vehicle).spare = true;
      return;
    }

    const canopy = this._canopyGeometry(src, collider);
    if (!canopy) return;

    const tree = new THREE.Mesh(canopy.geometry, src.material);
    tree.name = `fallen:${collider.kind}`;

    // Sized to the CAR, not to the tree it came from — and in both axes
    // separately, because the two directions are solving different problems.
    //
    //   WIDTH  has to conceal: fitted to the car's DIAGONAL rather than its
    //          longest side, since the cover is only at its full radius right
    //          at the skirt and narrows above. Size to the long side alone and
    //          the corners of the bodywork poke out at bumper height.
    //   HEIGHT has to not blind the player: pinned to a low multiple of the
    //          car's own height so the chase camera looks over the top of it.
    //
    // Doing this per-axis is what lets the same cover fit whether it came off a
    // sapling or a thirteen-metre pine.
    const half = vehicle.tuning?.halfExtents ?? { x: 0.9, y: 0.6, z: 2.1 };
    const ride = vehicle.tuning?.rideHeight ?? half.y;
    const wantR = Math.hypot(half.x, half.z) * TREES.wornCover;
    const wantH = (half.y * 2 + ride) * TREES.wornHeight;
    tree.scale.set(
      wantR / Math.max(0.001, canopy.radius),
      wantH / Math.max(0.001, canopy.height),
      wantR / Math.max(0.001, canopy.radius)
    );

    // UPRIGHT, and deliberately so. No pitch, no roll — a canopy sitting level
    // is the whole illusion; tilt it and it reads as debris on a car instead of
    // a tree in a forest. Yaw is free: it changes nothing about the silhouette
    // from the side and stops every disguise looking identical.
    tree.rotation.set(0, (collider.instance % 8) * (Math.PI / 4), 0);
    // Sit the skirt on the GROUND, not on the sills. The vehicle origin rides
    // `rideHeight` above the terrain, so this puts the bottom of the canopy
    // level with the ground the car is standing on and nothing shows beneath
    // it — which is the difference between a car with a bush on it and a tree.
    tree.position.set(0, -(vehicle.tuning?.rideHeight ?? half.y), 0);

    vehicle.object.add(tree);
    this._worn.set(vehicle, { tree, collider, spare: false, shedHold: 0 });

    // The flag the rest of the game reads. See chase.js `_canSee`.
    vehicle.disguised = true;
    events.emit('vehicle:disguised', { id: vehicle.id, kind: collider.kind });
    // A mechanic with no way out is a bug as far as the player is concerned, and
    // nothing else in the game would ever mention this one. Said once, in the
    // same register as the other control prompts (see `FARLAR`, `KAMERA`).
    if (vehicle.isPlayer && !this._toldHowToShed) {
      this._toldHowToShed = true;
      events.emit('ui:subtitle', {
        text: 'GİZLENDİN · ATMAK İÇİN BOŞLUK + GAZ',
        duration: 3.4,
        tone: 'system',
      });
    }
  }

  /**
   * The skirt of the canopy — the tree with its trunk cut off AND its spire cut
   * off, leaving the wide lower tiers.
   *
   * Neither cut is cosmetic. The trunk has to go because a spar sticking out
   * sideways reads as wreckage rather than as a tree. The top has to go because
   * it is the narrow part: it hides nothing, and every metre of it is screen the
   * player cannot see past. What is left is the only part that was ever doing
   * the concealing.
   *
   * The source geometry is a non-indexed triangle soup in the variant's local
   * space, so both cuts are just dropping triangles by the height of their
   * centroid, then rebasing what survives onto y=0.
   *
   * Cached on the source mesh: one InstancedMesh is one variant, so every tree
   * that shares it also shares this cover.
   *
   * @returns {{geometry: THREE.BufferGeometry, radius: number, height: number}|null}
   */
  _canopyGeometry(src, collider) {
    if (src.userData.canopy) return src.userData.canopy;

    const pos = src.geometry.getAttribute('position');
    const cut = collider.canopyY;
    if (!pos || cut == null) return null;

    // Pass 1: how tall is the canopy, so the skirt can be taken as a fraction
    // of it rather than as an absolute height that would mean different things
    // on a sapling and on a thirteen-metre pine.
    let top = -Infinity;
    let base = Infinity;
    for (let t = 0; t < pos.count; t += 3) {
      const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
      if (cy < cut) continue;
      for (let k = 0; k < 3; k++) {
        const y = pos.getY(t + k);
        if (y > top) top = y;
        if (y < base) base = y;
      }
    }
    if (!(top > base)) return null;
    const ceiling = base + (top - base) * TREES.wornCanopy;

    // Pass 2: keep the band.
    const nrm = src.geometry.getAttribute('normal');
    const col = src.geometry.getAttribute('color');
    const keepPos = [];
    const keepNrm = [];
    const keepCol = [];
    let minY = Infinity;
    let maxY = -Infinity;
    let radius = 0;
    for (let t = 0; t < pos.count; t += 3) {
      const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
      if (cy < cut || cy > ceiling) continue;
      for (let k = 0; k < 3; k++) {
        const i = t + k;
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        keepPos.push(x, y, z);
        if (nrm) keepNrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
        if (col) keepCol.push(col.getX(i), col.getY(i), col.getZ(i));
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const r = Math.hypot(x, z);
        if (r > radius) radius = r;
      }
    }
    if (keepPos.length === 0) return null;

    // Rebase: the cover's own underside becomes y=0, so the caller positions it
    // by where it should sit rather than by where it grew.
    for (let i = 1; i < keepPos.length; i += 3) keepPos[i] -= minY;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(keepPos, 3));
    if (keepNrm.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(keepNrm, 3));
    if (keepCol.length) g.setAttribute('color', new THREE.Float32BufferAttribute(keepCol, 3));
    g.computeBoundingSphere();

    const built = { geometry: g, radius, height: maxY - minY };
    src.userData.canopy = built;
    this._canopies.push(g);
    return built;
  }

  /**
   * Per-frame, and the only thing it watches for is the player asking to be a
   * car again.
   *
   * The disguise is a trap as much as a tool: it only works while you are
   * barely moving, so a player who has been driven under a tree they no longer
   * want is stuck wearing it. Handbrake and throttle together — both pedals,
   * meant — held for `TREES.shed.hold`, takes it off. The hold is the whole
   * design: it is long enough that pulling away gently from a hiding place
   * (which stays hidden, see `disguiseSpeed`) never sheds by accident, and
   * short enough to be worth doing with a siren behind you.
   */
  update(dt) {
    if (this._worn.size === 0) return;
    const S = TREES.shed;
    // Deleting from a Map while iterating it is safe, which is what `shed` does.
    for (const [vehicle, worn] of this._worn) {
      const cmd = vehicle.command;
      const asking = !!cmd && cmd.handbrake > S.handbrake && cmd.throttle > S.throttle;
      worn.shedHold = asking ? worn.shedHold + dt : 0;
      if (worn.shedHold >= S.hold) this.shed(vehicle);
    }
  }

  /**
   * Take the cover off and leave it where the car was standing.
   *
   * It is reparented rather than deleted, keeping its world transform, so it
   * does not blink out: it stops riding the car and starts being a thing in the
   * forest, at the exact spot it was shrugged off. Its skirt was already sitting
   * on the ground (see `_wear`), so it needs no repositioning to look dropped.
   *
   * Still no collider. It was not one on the roof and it is not one here — a
   * player who sheds a tree onto themselves must not then be parked inside a
   * wall of their own making.
   *
   * @returns {boolean} whether there was anything to take off
   */
  shed(vehicle) {
    const worn = this._worn.get(vehicle);
    if (!worn) return false;

    const parent = vehicle.object?.parent;
    if (parent) {
      // `attach`, not `add`: `add` would keep the local transform and snap the
      // cover to the world origin.
      parent.attach(worn.tree);
      this._dropped.push(worn.tree);
    } else {
      worn.tree.removeFromParent();
    }

    this._worn.delete(vehicle);
    vehicle.disguised = false;
    events.emit('vehicle:undisguised', { id: vehicle.id, kind: worn.collider.kind });
    return true;
  }

  /** Drop a vehicle's tree — used when vehicles are cleared between modes. */
  release(vehicle) {
    const worn = this._worn.get(vehicle);
    if (!worn) return;
    worn.tree.removeFromParent();
    this._worn.delete(vehicle);
    vehicle.disguised = false;
  }

  dispose() {
    this.subs.dispose();
    for (const [vehicle] of this._worn) this.release(vehicle);
    this._worn.clear();
    for (const t of this._dropped) t.removeFromParent();
    this._dropped.length = 0;
    // These are ours — the shared instanced geometry is not, and must be left
    // well alone. See Game#despawnVehicle for the other half of that rule.
    for (const g of this._canopies) g.dispose();
    this._canopies.length = 0;
  }
}
