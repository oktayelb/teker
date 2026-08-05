/**
 * DOME — the glass over a parkour.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The open world has one hole in it that no amount of scenery fixes: once the
 * player is free, nothing stops them driving straight back onto parkur 1 and
 * head-on into a race that is still running. Fencing it off is a lie, and
 * emptying the track throws away the best line in the game ("they are still
 * racing, round and round, without you").
 *
 * So: every parkour is under glass, and always was. You cannot get back on the
 * track because the track has a roof. You can stand on the roof and watch.
 *
 * THE ONE RULE
 * ------------
 * A dome is solid for a car only once that car has been *outside* it.
 *
 * That single asymmetry is what makes the whole thing work, and it is not a
 * fudge — it is the fiction stated exactly. You escape from *under* parkur 3's
 * dome, so while you are under it the dome is nothing to you: no collision, no
 * surface, not drawn. The instant you clear the rim it closes behind you, and
 * from then on it is sixty metres of glass you can drive on and never get
 * beneath again. Parkurs 1 and 2 you were never under after the break, so they
 * seal silently the moment the domes are armed.
 *
 * `DomeField` owns the latch, per car, in a WeakMap. Nothing else has to know.
 *
 * SHAPE
 * -----
 * A height field over a disc: `ground(x,z) - bite + (H + bite) * (1 - u²)^p`,
 * where u is the fraction of the way out to the rim. The exponent matters at
 * both ends. At the apex it gives a rounded cap rather than a spike; at the rim
 * the slope goes to zero, which is what lets a car drive up onto a dome from
 * the forest instead of meeting a wall.
 *
 * The shell is sampled onto a polar lattice once, at build time, and BOTH the
 * mesh and `heightAt` read that lattice. The glass you can see and the glass
 * you are driving on are therefore the same surface by construction. There is
 * no second copy of the shape to keep in sync.
 */

import * as THREE from 'three';
import { GeomBuilder, shade } from '../render/geometry.js';
import { DOME } from '../config/gameplay.js';
import { clamp01 } from '../core/mathx.js';
import { events } from '../core/events.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Dome {
  /**
   * @param {object} opts
   * @param {import('./track.js').Track} opts.track the parkour underneath
   * @param {import('./terrain.js').Terrain} opts.terrain
   * @param {number} opts.index position in the field's bitmask
   */
  constructor({ track, terrain, index, cfg = DOME }) {
    this.id = track.id;
    this.index = index;
    this.cfg = cfg;

    const over = track.data.dome || {};

    // Footprint, derived from the ribbon rather than authored: move a control
    // point and the dome moves with it.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.count; i++) {
      if (track.px[i] < minX) minX = track.px[i];
      if (track.px[i] > maxX) maxX = track.px[i];
      if (track.pz[i] < minZ) minZ = track.pz[i];
      if (track.pz[i] > maxZ) maxZ = track.pz[i];
    }
    this.centerX = over.x ?? (minX + maxX) / 2;
    this.centerZ = over.z ?? (minZ + maxZ) / 2;

    let reach = 0;
    for (let i = 0; i < track.count; i++) {
      const d = Math.hypot(track.px[i] - this.centerX, track.pz[i] - this.centerZ) + track.halfWidth[i];
      if (d > reach) reach = d;
    }
    this.radius = over.radius ?? reach + (cfg.margin ?? 45);
    this.height = over.height ?? this.radius * (cfg.heightFactor ?? 0.2);

    this.rings = cfg.rings;
    this.segments = cfg.segments;
    /** Shell height per lattice vertex, ring-major. See `heightAt`. */
    this._shell = new Float32Array((this.rings + 1) * this.segments);
    this._sampleShell(terrain);
    this._clearTheRoad(track, terrain);

    /** Where the camera looks when this one is revealed. */
    this.apex = new THREE.Vector3(this.centerX, this._shell[0], this.centerZ);
    /** @type {THREE.Group|null} */
    this.group = null;
  }

  /** `(1 - u²)^p`, the profile from apex (u=0) to rim (u=1). */
  _profile(u) {
    const a = 1 - u * u;
    return a <= 0 ? 0 : Math.pow(a, this.cfg.profileExponent ?? 1.5);
  }

  /**
   * Sample the terrain onto the lattice, smooth it, and lift it into a shell.
   *
   * THE SMOOTHING IS NOT COSMETIC. The shell is anchored to the ground, and the
   * ground rolls; anchored to the raw heightfield, a dome's flank inherits every
   * hillside it passes over and reaches forty degrees, which is a wall. So the
   * base is blurred across the lattice — and then blended *back* toward the raw
   * terrain as it approaches the rim, weighted by u³.
   *
   * Both halves of that matter. Smooth in the middle is where you drive, and it
   * has to be a shell rather than a landscape. Raw at the rim is where the glass
   * meets the earth, and out there smoothing would float the rim over every
   * hollow — which does not matter for driving (the ground wins under a sunken
   * shell) but does for looking at it.
   */
  _sampleShell(terrain) {
    const rings = this.rings;
    const segs = this.segments;
    const n = (rings + 1) * segs;
    const raw = new Float32Array(n);
    for (let i = 0; i <= rings; i++) {
      const r = (i / rings) * this.radius;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        raw[i * segs + j] = terrain.heightAt(this.centerX + Math.cos(a) * r, this.centerZ + Math.sin(a) * r);
      }
    }

    // Box blur over the lattice, wrapping in the angular direction and clamping
    // in the radial one. Cheap, and this runs once at build.
    let base = raw.slice();
    let scratch = new Float32Array(n);
    for (let pass = 0; pass < (this.cfg.basePasses ?? 6); pass++) {
      for (let i = 0; i <= rings; i++) {
        const im = Math.max(0, i - 1) * segs;
        const ip = Math.min(rings, i + 1) * segs;
        const ic = i * segs;
        for (let j = 0; j < segs; j++) {
          const jm = (j + segs - 1) % segs;
          const jp = (j + 1) % segs;
          scratch[ic + j] =
            (base[ic + j] * 2 + base[ic + jm] + base[ic + jp] + base[im + j] + base[ip + j]) / 6;
        }
      }
      const t = base;
      base = scratch;
      scratch = t;
    }

    const bite = this.cfg.groundBite ?? 1.5;
    const lift = this.height + bite;
    for (let i = 0; i <= rings; i++) {
      const u = i / rings;
      const p = this._profile(u);
      const toRaw = Math.pow(u, this.cfg.rimBlend ?? 5);
      for (let j = 0; j < segs; j++) {
        const k = i * segs + j;
        const ground = base[k] + (raw[k] - base[k]) * toRaw;
        this._shell[k] = ground - bite + lift * p;
      }
    }
  }

  /**
   * Raise the shell until there is genuinely a roof over the racing line.
   *
   * WHY THIS IS NOT LEFT TO THE AUTHOR. A dome's height is derived from its
   * footprint (`radius * heightFactor`), and its footprint is derived from the
   * ribbon — but the *clearance* over the road is neither, because the shell is
   * anchored to ground that rolls and a loop parkour runs near the edge of its
   * own footprint, which is the lowest part of the shell. So a level whose
   * stage climbs thirty metres and sits on a rise can end up with nine metres
   * of glass over the racing line, and the pines out here are thirteen: trees
   * grow through the roof, and the roof is a ceiling the player can hit.
   *
   * Left as a rule about seeds ("try another one until it looks right") this
   * would be a trap laid for every level anybody adds next. So the dome simply
   * measures itself against the road it covers and lifts until it clears —
   * a handful of resamples at build time, once, and never a surprise.
   *
   * Iterated rather than solved because the profile is not linear in height at
   * the point of worst clearance: raising the apex raises that point by
   * `profile(u)` of the lift, and u there is whatever it is.
   */
  _clearTheRoad(track, terrain) {
    const want = this.cfg.roadClearance ?? 0;
    if (!want || !track?.count) return;
    for (let attempt = 0; attempt < 5; attempt++) {
      let worst = Infinity;
      for (let i = 0; i < track.count; i++) {
        const gap = this.heightAt(track.px[i], track.pz[i]) - track.py[i];
        if (gap < worst) worst = gap;
      }
      if (worst >= want || !Number.isFinite(worst)) return;
      // Overshoot slightly: the lift arrives at the road multiplied by the
      // profile there, which is always less than one.
      this.height += (want - worst) * 1.35 + 0.5;
      this._sampleShell(terrain);
    }
  }

  /** World position of lattice vertex (ring i, segment j). */
  _vertex(i, j, out = new THREE.Vector3()) {
    const r = (i / this.rings) * this.radius;
    const a = (j / this.segments) * Math.PI * 2;
    return out.set(
      this.centerX + Math.cos(a) * r,
      this._shell[i * this.segments + (j % this.segments)],
      this.centerZ + Math.sin(a) * r
    );
  }

  /** Metres from the centre, on the ground plane. */
  distanceTo(x, z) {
    return Math.hypot(x - this.centerX, z - this.centerZ);
  }

  /**
   * Would a tree standing here be run through by the glass?
   *
   * True in the band where the shell is low enough to cut a trunk but not yet
   * sunk clear beneath it. Under the middle of a dome the answer is no — the
   * roof is sixty metres up and the forest under there is untouched.
   *
   * @param {number} groundY the terrain height at (x, z), which the caller
   *   already has and this would otherwise sample again per attempt
   */
  wouldSkewer(x, z, groundY, treeHeight) {
    const h = this.heightAt(x, z);
    if (h === -Infinity) return false;
    const gap = h - groundY;
    return gap > -(this.cfg.groundBite ?? 1.5) - 2 && gap < treeHeight;
  }

  /**
   * Height of the glass above (x, z), or `-Infinity` outside the footprint.
   *
   * Bilinear over the same lattice the mesh is built from, in polar coordinates
   * — which is why this is a lookup rather than a re-evaluation of the profile.
   * Re-evaluating would be cheaper to write and would put the physics surface a
   * couple of metres off the drawn one wherever the terrain underneath rolls.
   */
  heightAt(x, z) {
    const dx = x - this.centerX;
    const dz = z - this.centerZ;
    const r = Math.hypot(dx, dz);
    if (r > this.radius) return -Infinity;

    const fi = (r / this.radius) * this.rings;
    const i0 = Math.min(Math.floor(fi), this.rings - 1);
    const ti = fi - i0;

    // atan2 is in (-π, π]; shift into [0, segments).
    let fj = (Math.atan2(dz, dx) / (Math.PI * 2)) * this.segments;
    if (fj < 0) fj += this.segments;
    const j0 = Math.floor(fj) % this.segments;
    const j1 = (j0 + 1) % this.segments;
    const tj = fj - Math.floor(fj);

    const s = this._shell;
    const a = s[i0 * this.segments + j0];
    const b = s[i0 * this.segments + j1];
    const c = s[(i0 + 1) * this.segments + j0];
    const d = s[(i0 + 1) * this.segments + j1];
    const top = a + (b - a) * tj;
    const bot = c + (d - c) * tj;
    return top + (bot - top) * ti;
  }

  /**
   * Surface normal of the glass at (x, z), by central difference over
   * `heightAt`. The flanks of a dome reach about seventeen degrees, which is a
   * real hill — handing the car a flat normal there would let it climb the
   * outside of the glass as though the glass were a car park.
   */
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = Math.max(this.radius / this.rings, 1) * 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    // At the rim one of the four probes can fall outside the footprint; a
    // -Infinity difference is not a slope, it is the edge of the disc.
    if (!Number.isFinite(hx) || !Number.isFinite(hz)) return out.set(0, 1, 0);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  // -- geometry -------------------------------------------------------------

  /**
   * Panes and seams. Two objects: a transparent shell that is fogged like
   * everything else, and a line cage that is not.
   */
  buildMesh(materials, theme) {
    const g = new THREE.Group();
    g.name = `dome:${this.id}`;
    g.visible = false;

    const glass = theme.dome?.glass ?? 0xa8d0dc;
    const seamColor = theme.dome?.seam ?? 0x8fe0d0;
    const rStep = Math.max(1, this.cfg.seamRingStep ?? 3);
    const sStep = Math.max(1, this.cfg.seamSegmentStep ?? 6);

    const panes = new GeomBuilder();
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();

    for (let i = 0; i < this.rings; i++) {
      for (let j = 0; j < this.segments; j++) {
        // Chequered by PANEL, not by lattice cell, so the tint reads as glazing
        // bars rather than as a wire grid.
        const tone = (Math.floor(i / rStep) + Math.floor(j / sStep)) % 2 === 0 ? 0.04 : -0.03;
        const color = shade(glass, tone);
        this._vertex(i, j, p0);
        this._vertex(i, j + 1, p1);
        this._vertex(i + 1, j + 1, p2);
        this._vertex(i + 1, j, p3);
        if (i === 0) {
          // The apex ring collapses to a point; a quad there is a degenerate
          // triangle and picks up a garbage normal.
          panes.addTriangle(p0, p2, p3, color);
        } else {
          panes.addQuadFacing(p0, p1, p2, p3, color, UP);
        }
      }
    }

    const shell = new THREE.Mesh(panes.build(), materials.get('domeGlass'));
    shell.name = 'domeGlass';
    // Big, transparent, and never the thing you are trying to look at.
    shell.renderOrder = 2;
    g.add(shell);

    const seams = this._buildSeams(materials.get('domeSeam'), seamColor, sStep, rStep);
    seams.renderOrder = 3;
    g.add(seams);

    this.group = g;
    return g;
  }

  _buildSeams(material, color, sStep, rStep) {
    const pos = [];
    const col = [];
    const c = new THREE.Color(color);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const push = (p, q) => {
      pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };

    // Rings. Every lattice segment, so the line lies on the shell.
    for (let i = rStep; i <= this.rings; i += rStep) {
      for (let j = 0; j < this.segments; j++) {
        push(this._vertex(i, j, a), this._vertex(i, j + 1, b));
      }
    }
    // Ribs, apex to rim. Stopped short of the hub or they converge into a star.
    const from = Math.max(0, this.cfg.hubRings ?? 2);
    for (let j = 0; j < this.segments; j += sStep) {
      for (let i = from; i < this.rings; i++) {
        push(this._vertex(i, j, a), this._vertex(i + 1, j, b));
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const lines = new THREE.LineSegments(geo, material);
    lines.name = 'domeSeams';
    return lines;
  }

  dispose() {
    this.group?.traverse((o) => o.geometry?.dispose());
  }
}

/**
 * Every dome in the world, plus the latch that says which of them have closed
 * behind which car.
 *
 * Armed by `OpenWorldMode` rather than by the intro: the open world *is* the
 * moment the game stops pretending, whichever way the player got there —
 * through the story, through `?skip=intro`, or through `?scene=open`. Delete
 * `src/game/intro/` and the domes still work; you just do not get the shot.
 */
export class DomeField {
  /**
   * @param {object} opts
   * @param {import('./track.js').Track[]} opts.tracks
   * @param {import('./terrain.js').Terrain} opts.terrain
   */
  constructor({ tracks, terrain, cfg = DOME }) {
    this.cfg = cfg;
    /** @type {Dome[]} */
    this.domes = [];
    this.root = new THREE.Group();
    this.root.name = 'domes';

    if (cfg.enabled !== false) {
      for (const t of tracks) {
        if (t.data.dome?.enabled === false) continue;
        this.domes.push(new Dome({ track: t, terrain, index: this.domes.length, cfg }));
      }
    }

    this.armed = false;
    this.revealed = false;
    /** 0..1 — how far the glass has resolved. Drives the materials' opacity. */
    this.presence = 0;
    /** @type {WeakMap<object, {inside:number, sealed:number}>} */
    this._state = new WeakMap();
    this._glassMaterial = null;
    this._seamMaterial = null;
  }

  get count() {
    return this.domes.length;
  }

  byId(id) {
    return this.domes.find((d) => d.id === id) || null;
  }

  /**
   * A predicate that rejects anywhere a tree would be run through by glass.
   * Same shape as `World#_trackAvoidance` — true means do not plant here.
   * @returns {(x:number, z:number)=>boolean}
   */
  skewerAvoidance(terrain, treeHeight = this.cfg.treeClearance ?? 15) {
    if (this.domes.length === 0) return () => false;
    return (x, z) => {
      for (const d of this.domes) {
        if (d.distanceTo(x, z) > d.radius) continue;
        if (d.wouldSkewer(x, z, terrain.heightAt(x, z), treeHeight)) return true;
      }
      return false;
    };
  }

  build(materials, theme) {
    // One shared material per role across every dome, so the reveal is two
    // opacity writes rather than one per shell.
    this._glassMaterial = materials.get('domeGlass');
    this._seamMaterial = materials.get('domeSeam');
    // The material library does not read `gameplay.js` — see the note on
    // `MaterialLibrary#configureWind`, which hands its numbers over the same way.
    const u = this._glassMaterial.userData.glassUniforms;
    if (u) {
      u.uGlassRim.value = this.cfg.glassRim ?? 5;
      u.uGlassRimPower.value = this.cfg.glassRimPower ?? 3;
    }
    for (const d of this.domes) this.root.add(d.buildMesh(materials, theme));
    this._applyPresence();
    return this.root;
  }

  // -- the latch ------------------------------------------------------------

  /**
   * Start watching. Anything already outside a dome seals against it silently:
   * a car that was never under the glass did not break out of anything.
   */
  arm() {
    this.armed = true;
  }

  /**
   * First sight of a car: work out where it is, without firing anything.
   *
   * "Inside" is under the glass, and that is a question about height as well as
   * radius. Footprint alone gets a cop spawned on top of a dome — which is what
   * `ChaseSystem` does, deliberately, when the player is up there — marked as
   * being *underneath* it, and dropped sixty metres through a floor it was
   * standing on. Anything at or above the shell has already been outside it.
   */
  _stateFor(agent) {
    let s = this._state.get(agent);
    if (!s) {
      s = { inside: 0, sealed: 0 };
      const { x, y, z } = agent.position;
      for (const d of this.domes) {
        const under = d.distanceTo(x, z) <= d.radius && y < d.heightAt(x, z) - 1;
        if (under) s.inside |= 1 << d.index;
        else s.sealed |= 1 << d.index;
      }
      this._state.set(agent, s);
    }
    return s;
  }

  /**
   * Advance the latch for every car. Called once a frame from `World#update`.
   *
   * A dome only ever seals on an inside→outside transition, which is why the
   * player's escape produces exactly one event and the three cars still lapping
   * parkur 1 produce none: they never leave.
   *
   * @param {{position: THREE.Vector3, isPlayer?: boolean}[]} agents
   */
  sync(agents) {
    if (!this.armed || this.domes.length === 0 || !agents) return;
    for (const agent of agents) {
      if (!agent?.position) continue;
      const s = this._stateFor(agent);
      for (const d of this.domes) {
        const bit = 1 << d.index;
        if (!(s.inside & bit)) continue;
        if (d.distanceTo(agent.position.x, agent.position.z) <= d.radius + this.cfg.sealMargin) continue;
        s.inside &= ~bit;
        s.sealed |= bit;
        events.emit('world:domeSealed', { trackId: d.id, isPlayer: !!agent.isPlayer });
        // The player coming out from under one is the only thing that has ever
        // shown a dome to anybody.
        if (agent.isPlayer) this.reveal(d);
      }
    }
  }

  /** Is this dome solid for this car? */
  sealedFor(agent, dome) {
    const s = this._state.get(agent);
    return !!s && (s.sealed & (1 << dome.index)) !== 0;
  }

  /**
   * The highest dome this car is standing on at (x, z), or null. Only domes
   * that have closed behind it count; everything else it is under.
   *
   * Domes do not overlap — `npm test` asserts it — so in practice this returns
   * on the first hit. The loop is there so that adding a fourth parkour on top
   * of a third cannot silently produce two floors.
   */
  domeAt(x, z, agent) {
    if (!this.armed || !agent) return null;
    const s = this._state.get(agent);
    if (!s || s.sealed === 0) return null;
    let best = null;
    let bestH = -Infinity;
    for (const d of this.domes) {
      if (!(s.sealed & (1 << d.index))) continue;
      const h = d.heightAt(x, z);
      if (h > bestH) {
        bestH = h;
        best = d;
      }
    }
    return best;
  }

  /** Just the height, for the fore-and-aft probes. @see World#groundHeightAt */
  heightAt(x, z, agent) {
    const d = this.domeAt(x, z, agent);
    return d ? d.heightAt(x, z) : -Infinity;
  }

  // -- being seen -----------------------------------------------------------

  /** @param {Dome} [dome] the one that did it, for whoever wants to stage it */
  reveal(dome = null) {
    if (this.revealed) return false;
    this.revealed = true;
    for (const d of this.domes) if (d.group) d.group.visible = true;
    events.emit('world:domesRevealed', { trackId: dome?.id ?? null, dome });
    return true;
  }

  update(dt) {
    const target = this.revealed ? 1 : 0;
    if (this.presence === target) return;
    const rate = 1 / Math.max(this.cfg.revealSeconds ?? 0.4, 0.001);
    this.presence = clamp01(this.presence + (target - this.presence > 0 ? rate : -rate) * dt);
    this._applyPresence();
  }

  _applyPresence() {
    if (this._glassMaterial) this._glassMaterial.opacity = this.cfg.glassOpacity * this.presence;
    if (this._seamMaterial) this._seamMaterial.opacity = this.cfg.seamOpacity * this.presence;
  }

  applyTheme(theme) {
    // Panes are tinted by the material library like everything else. The seams
    // are not — see the note in `ROLE_TINT_SOURCE`.
    void theme;
  }

  dispose() {
    for (const d of this.domes) d.dispose();
    this.domes.length = 0;
    this.root.clear();
  }
}
