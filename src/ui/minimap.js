/**
 * MINIMAP — a canvas the player can open with H.
 *
 * Works in the races and in the open world, off the same data either way: it is
 * handed the player, the other cars and the world, and it draws whatever of
 * those it can see. It holds no rules and no tuning — every number it uses comes
 * from `src/config/minimap.js`, and every *kind of thing* it can draw comes from
 * `MINIMAP_ICONS` there. Adding a landmark to the world does not mean editing
 * this file; it means giving the landmark a `map.icon` key.
 *
 * WHY A CANVAS AND NOT DOM
 * ------------------------
 * The rest of the HUD is DOM because the rest of the HUD is a dozen nodes that
 * change a few times a second. At the widest zoom this draws several hundred
 * blips, thirty times a second, and every one of them moves every frame. That is
 * the one job in the UI that a canvas is unambiguously right for.
 *
 * WHAT MAKES IT CHEAP
 * -------------------
 *  1. Static scenery — trees, rocks, track ribbons — is indexed **once**, when
 *     the world arrives, into a coarse grid (`PointIndex`). A frame at 260m
 *     range touches a handful of cells, not 4200 trees.
 *  2. It repaints at `MINIMAP.refreshHz`, not at the game's frame rate.
 *  3. Nothing here allocates per frame. The projection is two multiplies and an
 *     add, written out by hand rather than going through canvas transforms, so
 *     icons can stay upright while the map underneath them turns.
 *
 * THE CONTRACT WITH THE REST OF THE GAME
 * --------------------------------------
 * `setWorld(world)` and `update(dt, { player, vehicles, ... })`. It duck-types
 * both — positions, headings, names — and imports nothing from `world/` or
 * `game/`. The UI still does not know the game exists.
 */

import { MINIMAP, minimapColor, minimapIcon } from '../config/minimap.js';

/** Half a right angle, used often enough to name. */
const TAU = Math.PI * 2;

/**
 * A coarse uniform grid over static points, so "everything within R of here"
 * costs a few cell lookups instead of a scan.
 *
 * Deliberately separate from `world/collision.js`: that grid is sized for the
 * physics query (12m cells, colliders duplicated into every cell they touch)
 * and asking it for a 1500m radius would visit fifteen thousand cells and
 * return most props several times over. This one stores each point once, in one
 * cell, at a size chosen for map queries.
 */
class PointIndex {
  /** @param {number} cellSize metres */
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
    /** @type {Map<number, Float32Array>} packed key → [x0,z0,x1,z1,…] */
    this.cells = new Map();
    this.count = 0;
    this._build = new Map();
  }

  _key(cx, cz) {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  add(x, z) {
    const k = this._key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    let list = this._build.get(k);
    if (!list) this._build.set(k, (list = []));
    list.push(x, z);
    this.count++;
  }

  /** Compact the build lists into typed arrays. Call once, after the last add. */
  seal() {
    for (const [k, list] of this._build) this.cells.set(k, Float32Array.from(list));
    this._build.clear();
    return this;
  }

  /**
   * Visit every indexed point within `radius` of (x, z).
   * @param {number} x @param {number} z @param {number} radius metres
   * @param {number} limit stop after this many visits
   * @param {(px:number, pz:number)=>void} visit
   * @returns {number} how many were visited
   */
  query(x, z, radius, limit, visit) {
    const cs = this.cellSize;
    const c0 = Math.floor((x - radius) / cs);
    const c1 = Math.floor((x + radius) / cs);
    const r0 = Math.floor((z - radius) / cs);
    const r1 = Math.floor((z + radius) / cs);
    const r2 = radius * radius;
    let n = 0;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const arr = this.cells.get(this._key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i += 2) {
          const dx = arr[i] - x;
          const dz = arr[i + 1] - z;
          if (dx * dx + dz * dz > r2) continue;
          visit(arr[i], arr[i + 1]);
          if (++n >= limit) return n;
        }
      }
    }
    return n;
  }

  clear() {
    this.cells.clear();
    this._build.clear();
    this.count = 0;
  }
}

export class Minimap {
  /** @param {Element|null} root container supplied by Hud.mount() */
  constructor(root) {
    // No DOM in the constructor — this module must import cleanly in Node.
    this.root = root || null;
    this.el = null;
    this.canvas = null;
    this.ctx = null;

    this.visible = !!MINIMAP.startVisible;
    this.zoomIndex = clampInt(MINIMAP.zoom.default, 0, MINIMAP.zoom.levels.length - 1);

    /** @type {object|null} the resolved theme, for colour tokens */
    this._theme = null;
    /** @type {object|null} whatever `setWorld` was handed */
    this._world = null;

    // -- static, built once per world ---------------------------------------
    this._trees = new PointIndex(64);
    this._rocks = new PointIndex(64);
    /** @type {{id:string, pts:Float32Array}[]} decimated centrelines, world space */
    this._trackLines = [];
    /** @type {{x:number, z:number, icon:string, name:string, discovered:boolean, src:object|null}[]} */
    this._landmarks = [];
    /** Runtime markers, keyed by id. @type {Map<string, object>} */
    this._markers = new Map();
    this._worldRadius = 0;
    this._indexed = false;

    // -- per-frame state ----------------------------------------------------
    this._px = 0;
    this._pz = 0;
    this._heading = 0;
    this._mapAngle = 0;
    this._range = MINIMAP.zoom.levels[this.zoomIndex];
    this._rangeTarget = this._range;
    this._fade = this.visible ? 1 : 0;
    this._pulseT = 0;
    this._sinceDraw = Infinity;
    /** @type {{x:number,z:number,icon:string,heading:number}[]} reused, never re-allocated */
    this._cars = [];
    this._carCount = 0;
    this._activeTrackId = null;
    this._nextCheckpoint = null;
    this._modeAllowed = true;

    // Geometry in CSS pixels, recomputed on resize.
    this._size = 0;
    this._cx = 0;
    this._cy = 0;
    this._radiusPx = 0;
    this._dpr = 1;
    /** Radius the scenery visitor is currently drawing at. */
    this._blipR = 1;
    this._visitScatter = this._visitScatter.bind(this);
  }

  // -- lifecycle ------------------------------------------------------------

  mount() {
    if (this.el || !this.root || !MINIMAP.enabled) return this;

    const wrap = document.createElement('div');
    wrap.className = 'tk-minimap';
    wrap.dataset.anchor = MINIMAP.anchor;
    wrap.dataset.shape = MINIMAP.shape;
    // The HUD is already aria-hidden; be explicit anyway, because a canvas that
    // repaints thirty times a second has nothing to say to a screen reader.
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.setProperty('--tk-map-opacity', String(MINIMAP.opacity));
    wrap.style.setProperty('--tk-map-fade', `${MINIMAP.fadeSeconds}s`);

    const canvas = document.createElement('canvas');
    canvas.className = 'tk-minimap-canvas';
    wrap.append(canvas);

    this.el = wrap;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.root.append(wrap);

    this._applyVisibility();
    this.resize();
    return this;
  }

  unmount() {
    this.el?.remove();
    this.el = null;
    this.canvas = null;
    this.ctx = null;
  }

  dispose() {
    this.unmount();
    this._trees.clear();
    this._rocks.clear();
    this._trackLines.length = 0;
    this._landmarks.length = 0;
    this._markers.clear();
    this._world = null;
    this._indexed = false;
  }

  /**
   * Match the backing store to the display's pixel ratio and the viewport.
   *
   * The size is computed here rather than measured from CSS, and the element is
   * then told what it is. Two reasons: the map is `display:none` in the cutscene
   * HUD, where measuring returns zero and would silently resize the canvas to
   * nothing; and one clamp in one language beats the same clamp written twice.
   */
  resize() {
    if (!this.canvas || !this.el) return;
    const vmin = Math.min(globalThis.innerWidth || 0, globalThis.innerHeight || 0) || 720;
    const S = MINIMAP.size;
    const css = Math.round(Math.max(S.minPx, Math.min(S.maxPx, (vmin * S.vmin) / 100)));
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (css === this._size && dpr === this._dpr) return;
    this._size = css;
    this._dpr = dpr;
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
    this.el.style.width = `${css}px`;
    this.el.style.height = `${css}px`;
    const M = MINIMAP.margin;
    this.el.style.setProperty(
      '--tk-map-margin',
      `${Math.round(Math.max(M.minPx, Math.min(M.maxPx, (vmin * M.vmin) / 100)))}px`
    );
    this._cx = css / 2;
    this._cy = css / 2;
    this._radiusPx = css / 2 - MINIMAP.frame.width;
    this._sinceDraw = Infinity; // force a repaint at the new size
  }

  // -- what it draws --------------------------------------------------------

  /**
   * Index a world. Call once it is built; calling again re-indexes from scratch,
   * which is what you want after a seed change and never otherwise.
   *
   * Everything read here is read defensively — a headless test world has no
   * scatter and no landmarks, and the map must simply draw less rather than
   * throw inside a render loop.
   *
   * @param {object|null} world a `World`, or anything shaped like one
   */
  setWorld(world) {
    this._world = world || null;
    this._trees.clear();
    this._rocks.clear();
    this._trackLines.length = 0;
    this._landmarks.length = 0;
    this._indexed = false;
    // `setWorld(null)` is a real call, not a defensive one: between two levels
    // there is genuinely no map (see `src/game/levels.js`), and a stale edge
    // ring drawn at the last world's radius would be the map claiming to know
    // where the edge of somewhere is while that somewhere is being built.
    this._worldRadius = 0;
    // Indexing a world nobody will draw is the one cost a disabled map could
    // still impose, so it does not.
    if (!world || !MINIMAP.enabled) return this;

    this._worldRadius = world.terrain?.halfSpan ?? world.halfSpan ?? 0;

    // -- scenery -----------------------------------------------------------
    // One pass over the colliders the forest already produced. `kind` is set by
    // `Scatter#place`, so a new scatter kind shows up here for free once it is
    // named in TREE_KINDS below.
    const colliders = world.scatter?.colliders || [];
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (TREE_KINDS.has(c.kind)) this._trees.add(c.x, c.z);
      else if (ROCK_KINDS.has(c.kind)) this._rocks.add(c.x, c.z);
    }
    this._trees.seal();
    this._rocks.seal();

    // -- tracks ------------------------------------------------------------
    // Decimated hard: the ribbons are resampled every ~2m for the physics query
    // and a map 260 pixels across cannot show that. Every 12th sample is still
    // smoother than the pixels it lands on.
    const tracks = world.tracks instanceof Map ? [...world.tracks.values()] : world.tracks || [];
    for (const t of tracks) {
      if (!t?.count || !t.px || !t.pz) continue;
      const stride = Math.max(1, Math.round(t.count / 220));
      const n = Math.floor(t.count / stride) + 1;
      const pts = new Float32Array(n * 2);
      let k = 0;
      for (let i = 0; i < t.count; i += stride) {
        pts[k++] = t.px[i];
        pts[k++] = t.pz[i];
      }
      // Close the loop back onto its own first sample, or a lap track draws
      // with a gap in it exactly where the start line is.
      if (t.loop !== false && k + 2 <= pts.length) {
        pts[k++] = t.px[0];
        pts[k++] = t.pz[0];
      }
      this._trackLines.push({ id: t.id, pts: pts.subarray(0, k) });
    }

    // -- landmarks ---------------------------------------------------------
    // `map.icon` on the landmark decides how it is drawn; anything without one
    // falls back to the generic ring. This is the seam future landmarks come
    // through — see `LANDMARK_DEFS` in `world/world.js`.
    for (const l of world.landmarks || []) {
      if (!l?.position) continue;
      this._landmarks.push({
        x: l.position.x,
        z: l.position.z,
        icon: l.map?.icon || l.icon || 'landmark',
        name: l.name || '',
        discovered: !!l.discovered,
        src: l,
      });
    }

    this._indexed = true;
    this._sinceDraw = Infinity;
    return this;
  }

  /**
   * Put a marker on the map from outside — a future landmark, a mission target,
   * anything that is not in `LANDMARK_DEFS`. Same id twice updates in place.
   *
   * @param {object} m
   * @param {string} m.id
   * @param {number} m.x @param {number} m.z world metres
   * @param {string} [m.icon] key into `MINIMAP_ICONS`
   * @param {string} [m.name] drawn beside it if the icon asks for a label
   */
  addMarker({ id, x, z, icon = 'landmark', name = '' }) {
    if (!id) return this;
    this._markers.set(id, { id, x, z, icon, name });
    return this;
  }

  removeMarker(id) {
    this._markers.delete(id);
    return this;
  }

  clearMarkers() {
    this._markers.clear();
    return this;
  }

  // -- visibility -----------------------------------------------------------

  setVisible(v) {
    const next = !!v && MINIMAP.enabled;
    if (next === this.visible) return this.visible;
    this.visible = next;
    this._applyVisibility();
    // Opening from a hidden state means the element had no measurable size.
    if (next) this.resize();
    return this.visible;
  }

  toggle() {
    return this.setVisible(!this.visible);
  }

  /** @param {number} [dir] +1 zooms out a step, -1 in. Wraps. */
  cycleZoom(dir = 1) {
    const levels = MINIMAP.zoom.levels;
    this.zoomIndex = (this.zoomIndex + dir + levels.length * 2) % levels.length;
    this._rangeTarget = levels[this.zoomIndex];
    if (MINIMAP.zoom.easeSeconds <= 0) this._range = this._rangeTarget;
    return this._rangeTarget;
  }

  get range() {
    return this._rangeTarget;
  }

  /**
   * Which HUD personality is on screen. The map hides itself in modes it is not
   * listed for, without forgetting that the player had it open — flip back to a
   * permitted mode and it is there again.
   * @param {string} mode
   */
  setMode(mode) {
    this._modeAllowed = MINIMAP.modes.includes(mode);
    this._applyVisibility();
  }

  applyTheme(theme) {
    this._theme = theme || this._theme;
    this._sinceDraw = Infinity;
  }

  _applyVisibility() {
    const on = this.visible && this._modeAllowed;
    this.el?.classList.toggle('is-open', on);
  }

  // -- frame ----------------------------------------------------------------

  /**
   * @param {number} dt seconds
   * @param {object} [state]
   * @param {object} [state.player] anything with `.position` and `.heading`
   * @param {object[]} [state.vehicles] the rest of the cars
   * @param {string|null} [state.activeTrack] track id the current mode races on
   * @param {number|null} [state.nextCheckpoint] index of the one to reach next
   */
  update(dt, state = null) {
    if (!this.el) return;
    const d = Number(dt) || 0;

    // The fade itself is CSS; this mirrors it only so we know when to stop
    // drawing. Linear, and over exactly `fadeSeconds`, so it hits zero when the
    // CSS transition does rather than asymptotically a second later.
    const wantOpen = this.visible && this._modeAllowed;
    const step = d / Math.max(1e-3, MINIMAP.fadeSeconds);
    this._fade = wantOpen ? Math.min(1, this._fade + step) : Math.max(0, this._fade - step);
    if (this._fade <= 0 && !wantOpen) return;

    if (state) this._sample(state, d);

    // Zoom easing, in log space so 130→1500 does not spend most of its time
    // crawling through the last hundred metres, and on the same `1 - exp(-dt/τ)`
    // curve as the heading so neither changes feel with the frame rate.
    if (MINIMAP.zoom.easeSeconds > 0 && this._range !== this._rangeTarget) {
      const k = 1 - Math.exp(-d / MINIMAP.zoom.easeSeconds);
      const next = Math.exp(lerp(Math.log(this._range), Math.log(this._rangeTarget), k));
      this._range = Math.abs(next - this._rangeTarget) < 0.5 ? this._rangeTarget : next;
    }

    this._pulseT += d;

    const interval = MINIMAP.refreshHz > 0 ? 1 / MINIMAP.refreshHz : 0;
    this._sinceDraw += d;
    if (this._sinceDraw < interval) return;
    this._sinceDraw = 0;
    this._draw();
  }

  /** Pull the mutable per-frame numbers out of live game objects, once. */
  _sample(state, dt) {
    const p = state.player;
    if (p?.position) {
      this._px = p.position.x;
      this._pz = p.position.z;
      this._heading = p.heading || 0;
    }

    // Map rotation, smoothed. In heading mode the arrow points up and the world
    // turns; the maths is in `_project`.
    //
    // `1 - exp(-dt/τ)` rather than a fixed per-frame fraction, so the map lags
    // by the same wall-clock time at 30fps as at 144 — a smoothing constant
    // that is really "0.15 per frame" changes feel with the frame rate, which
    // is the sort of thing you only notice on someone else's machine.
    if (MINIMAP.orientation === 'heading') {
      const tau = MINIMAP.headingSmoothing;
      const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
      this._mapAngle = angleApproach(this._mapAngle, this._heading, k);
    } else {
      this._mapAngle = 0;
    }

    // Other cars, into a pooled array so a frame allocates nothing.
    this._carCount = 0;
    const list = state.vehicles || [];
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v || v === p || v.isPlayer || !v.position) continue;
      const slot = this._cars[this._carCount] || (this._cars[this._carCount] = { x: 0, z: 0, icon: '', heading: 0 });
      slot.x = v.position.x;
      slot.z = v.position.z;
      slot.heading = v.heading || 0;
      // `kind` is stamped on by `Game#spawnVehicle`. A cop that has line of
      // sight is a different icon, not a different colour of the same one.
      slot.icon = v.kind === 'cop' ? (v.pursuing ? 'copActive' : 'cop') : 'rival';
      this._carCount++;
    }

    this._activeTrackId = state.activeTrack ?? null;
    this._nextCheckpoint = state.nextCheckpoint ?? null;

    // Landmark discovery is written on the world's own objects by the open
    // world mode; re-read it rather than caching a stale copy.
    for (const l of this._landmarks) if (l.src) l.discovered = !!l.src.discovered;
  }

  /**
   * World metres → canvas pixels, into `_p`.
   *
   * Written out rather than done with `ctx.rotate` on purpose: the map turns but
   * the icons on it must not, and a canvas transform would take them with it.
   */
  _project(wx, wz, out) {
    // In heading mode the map is rotated so the car's forward — which is
    // `(sin h, cos h)` in world XZ, and therefore `(sin h, cos h)` in screen
    // (right, down) — ends up pointing at (0, -1). Solving that gives an angle
    // of `h - π`, which is the whole derivation.
    const a = MINIMAP.orientation === 'heading' ? this._mapAngle - Math.PI : 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const scale = this._radiusPx / this._range;
    const dx = (wx - this._px) * scale;
    const dz = (wz - this._pz) * scale;
    out.x = this._cx + dx * c - dz * s;
    out.y = this._cy + dx * s + dz * c;
    return out;
  }

  _color(token) {
    return minimapColor(token, this._theme);
  }

  _draw() {
    const ctx = this.ctx;
    if (!ctx || this._size <= 0) return;
    const size = this._size;

    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Clip to the map's shape once; everything after this is free to overdraw.
    ctx.beginPath();
    if (MINIMAP.shape === 'circle') ctx.arc(this._cx, this._cy, this._radiusPx, 0, TAU);
    else ctx.rect(0, 0, size, size);
    ctx.clip();

    if (MINIMAP.frame.background) {
      ctx.fillStyle = this._color(MINIMAP.frame.background);
      ctx.fillRect(0, 0, size, size);
    }

    const L = MINIMAP.layers;
    if (L.ground?.enabled) this._drawGround(ctx);
    if (L.tracks?.enabled) this._drawTracks(ctx);
    if (L.trees?.enabled) this._drawScatter(ctx, this._trees, L.trees, 'tree');
    if (L.rocks?.enabled) this._drawScatter(ctx, this._rocks, L.rocks, 'rock');
    if (L.raceFurniture?.enabled) this._drawRaceFurniture(ctx);
    if (L.landmarks?.enabled) this._drawLandmarks(ctx);
    if (L.custom?.enabled) this._drawCustomMarkers(ctx);
    if (L.vehicles?.enabled) this._drawVehicles(ctx);

    ctx.restore();

    // Chrome sits outside the clip so the frame is not half-eaten by it.
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    if (L.player?.enabled) this._drawPlayer(ctx);
    this._drawChrome(ctx);
    ctx.restore();
  }

  _drawGround(ctx) {
    const g = MINIMAP.layers.ground;
    ctx.fillStyle = this._color(g.fill);
    ctx.beginPath();
    if (MINIMAP.shape === 'circle') ctx.arc(this._cx, this._cy, this._radiusPx, 0, TAU);
    else ctx.rect(0, 0, this._size, this._size);
    ctx.fill();

    // The edge of the world, if it is anywhere near. This is the one piece of
    // information the map exists to eventually give you: that there is an end.
    if (!this._worldRadius || !g.edgeWidth) return;
    const scale = this._radiusPx / this._range;
    const rPx = this._worldRadius * scale;
    const dFromCentre = Math.hypot(this._px, this._pz) * scale;
    if (rPx - dFromCentre > this._radiusPx * 1.6) return;
    const p = _p0;
    this._project(0, 0, p);
    ctx.strokeStyle = this._color(g.edgeColor);
    ctx.lineWidth = g.edgeWidth;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rPx, 0, TAU);
    ctx.stroke();
  }

  _drawTracks(ctx) {
    const cfg = MINIMAP.layers.tracks;
    for (const line of this._trackLines) {
      const active = line.id === this._activeTrackId;
      ctx.strokeStyle = this._color(active ? cfg.activeColor : cfg.color);
      ctx.lineWidth = active ? cfg.activeWidth : cfg.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      const pts = line.pts;
      for (let i = 0; i < pts.length; i += 2) {
        const p = this._project(pts[i], pts[i + 1], _p0);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  /**
   * Trees and rocks. Thousands of candidates, one `fill()`: every dot goes into
   * a single path and is filled once, because four hundred separate fills is
   * four hundred state changes and this runs thirty times a second.
   */
  _drawScatter(ctx, index, layer, iconKey) {
    if (index.count === 0) return;
    if (layer.hideAboveZoom != null && this.zoomIndex > layer.hideAboveZoom) return;
    const range = Math.min(layer.range ?? Infinity, this._range);
    if (!Number.isFinite(range) || range <= 0) return;
    const icon = minimapIcon(iconKey);
    // The visitor is bound once in the constructor and reads these, rather than
    // being a closure built per call — see `_visitScatter`.
    this._blipR = icon.size;
    ctx.fillStyle = this._color(icon.color);
    ctx.beginPath();
    index.query(this._px, this._pz, range, layer.maxBlips ?? 400, this._visitScatter);
    ctx.fill();
  }

  /** Adds one scenery dot to the open path. Bound; never re-created. */
  _visitScatter(x, z) {
    const p = this._project(x, z, _p0);
    const r = this._blipR;
    // `moveTo` before each `arc`, or consecutive dots are joined by a chord.
    this.ctx.moveTo(p.x + r, p.y);
    this.ctx.arc(p.x, p.y, r, 0, TAU);
  }

  _drawRaceFurniture(ctx) {
    if (!this._activeTrackId) return;
    const track = this._world?.tracks?.get?.(this._activeTrackId);
    if (!track) return;

    for (const cp of track.checkpoints || []) {
      if (!cp.position) continue;
      const isNext = this._nextCheckpoint === cp.index || this._nextCheckpoint === cp;
      this._blip(ctx, cp.position.x, cp.position.z, isNext ? 'checkpointNext' : 'checkpoint', '');
    }
    if (track.startLine?.position) {
      this._blip(ctx, track.startLine.position.x, track.startLine.position.z, 'finish', 'FINISH');
    }
  }

  _drawLandmarks(ctx) {
    const cfg = MINIMAP.layers.landmarks;
    let labels = 0;
    for (const l of this._landmarks) {
      if (!l.discovered && !cfg.showUndiscovered) continue;
      const alpha = l.discovered ? 1 : cfg.undiscoveredOpacity;
      const labelled = MINIMAP.labels.enabled && labels < MINIMAP.labels.maxAtOnce;
      if (this._blip(ctx, l.x, l.z, l.icon, labelled ? l.name : '', alpha, cfg.range)) {
        if (labelled && minimapIcon(l.icon).label) labels++;
      }
    }
  }

  _drawCustomMarkers(ctx) {
    const range = MINIMAP.layers.custom.range;
    for (const m of this._markers.values()) {
      this._blip(ctx, m.x, m.z, m.icon, m.name, 1, range);
    }
  }

  _drawVehicles(ctx) {
    const range = MINIMAP.layers.vehicles.range;
    for (let i = 0; i < this._carCount; i++) {
      const c = this._cars[i];
      this._blip(ctx, c.x, c.z, c.icon, '', 1, range, c.heading);
    }
  }

  _drawPlayer(ctx) {
    const icon = minimapIcon('player');
    // In heading mode the arrow is nailed to the centre pointing up; there is
    // no projection to do, because the projection was defined to make it so.
    const angle = MINIMAP.orientation === 'heading' ? 0 : this._heading - this._mapAngle + Math.PI;
    ctx.save();
    ctx.translate(this._cx, this._cy);
    ctx.rotate(angle);
    ctx.fillStyle = this._color(icon.color);
    ctx.strokeStyle = this._color('panel');
    ctx.lineWidth = 1;
    const s = icon.size;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.3);
    ctx.lineTo(s * 0.85, s);
    ctx.lineTo(0, s * 0.5);
    ctx.lineTo(-s * 0.85, s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawChrome(ctx) {
    const f = MINIMAP.frame;
    if (f.enabled) {
      ctx.strokeStyle = this._color(f.color);
      ctx.lineWidth = f.width;
      ctx.beginPath();
      if (MINIMAP.shape === 'circle') {
        ctx.arc(this._cx, this._cy, this._radiusPx, 0, TAU);
      } else {
        const h = f.width / 2;
        ctx.rect(h, h, this._size - f.width, this._size - f.width);
      }
      ctx.stroke();
    }

    if (MINIMAP.compass.enabled) {
      const c = MINIMAP.compass;
      const y = this._cy - this._radiusPx;
      ctx.fillStyle = this._color(c.color);
      ctx.beginPath();
      ctx.moveTo(this._cx, y + c.size);
      ctx.lineTo(this._cx - c.size * 0.6, y - c.size * 0.2);
      ctx.lineTo(this._cx + c.size * 0.6, y - c.size * 0.2);
      ctx.closePath();
      ctx.fill();
    }

    if (MINIMAP.scaleLabel.enabled) {
      const s = MINIMAP.scaleLabel;
      ctx.fillStyle = this._color(s.color);
      ctx.font = `${s.fontPx}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${Math.round(this._rangeTarget)}m`, this._cx, this._cy + this._radiusPx - s.fontPx - 2);
    }
  }

  /**
   * One marker: cull it, or clamp it to the rim, then draw its shape.
   *
   * @returns {boolean} whether anything was drawn
   */
  _blip(ctx, wx, wz, iconKey, label = '', alpha = 1, layerRange = Infinity, heading = 0) {
    const icon = minimapIcon(iconKey);
    if (icon.hideAboveZoom != null && this.zoomIndex > icon.hideAboveZoom) return false;

    const dist = Math.hypot(wx - this._px, wz - this._pz);
    if (dist > layerRange) return false;

    const p = this._project(wx, wz, _p0);
    let x = p.x;
    let y = p.y;

    // Off the edge: either clamp it to the rim (so a cop closing in is visible
    // before it arrives) or drop it.
    const dx = x - this._cx;
    const dy = y - this._cy;
    const d = Math.hypot(dx, dy);
    const rim = this._radiusPx - MINIMAP.clampInset;
    if (d > rim) {
      if (!MINIMAP.clampToEdge.includes(iconKey)) return false;
      const k = rim / (d || 1);
      x = this._cx + dx * k;
      y = this._cy + dy * k;
      label = '';
    }

    let a = alpha;
    if (icon.pulse > 0) {
      // Triangle rather than sine: a hard edge reads as a warning light, a sine
      // reads as a breathing decoration.
      const phase = (this._pulseT * icon.pulse) % 1;
      a *= 0.45 + 0.55 * (phase < 0.5 ? phase * 2 : 2 - phase * 2);
    }

    ctx.globalAlpha = a;
    const color = this._color(icon.color);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = icon.lineWidth ?? 1.5;
    const r = icon.size;
    const rot = icon.rotates ? heading - this._mapAngle : 0;

    drawShape(ctx, icon.shape, x, y, r, rot, !!icon.filled);

    if (label && icon.label && MINIMAP.labels.enabled) {
      const l = MINIMAP.labels;
      ctx.fillStyle = this._color(l.color);
      ctx.font = `${l.fontPx}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, x, y - l.offset);
    }

    ctx.globalAlpha = 1;
    return true;
  }
}

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

/** Every icon shape, in one switch. Add a case, add a `shape` value. */
function drawShape(ctx, shape, x, y, r, rot, filled) {
  ctx.beginPath();
  switch (shape) {
    case 'dot':
      ctx.arc(x, y, r, 0, TAU);
      break;
    case 'ring':
      ctx.arc(x, y, r, 0, TAU);
      break;
    case 'square': {
      if (rot) {
        // Rotated by hand rather than with `ctx.rotate`, because the transform
        // would also have to be undone before the label is drawn and a
        // save/restore pair per blip is the expensive way to spell a cosine.
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        for (let i = 0; i < 4; i++) {
          const ox = _SQUARE[i * 2] * r;
          const oy = _SQUARE[i * 2 + 1] * r;
          const px = x + ox * c - oy * s;
          const py = y + ox * s + oy * c;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      } else {
        ctx.rect(x - r, y - r, r * 2, r * 2);
      }
      break;
    }
    case 'diamond':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.9, y + r * 0.8);
      ctx.lineTo(x - r * 0.9, y + r * 0.8);
      ctx.closePath();
      break;
    case 'cross':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.stroke();
      return;
    case 'mast': {
      // A tower: a stem with a lamp on it. The one landmark you can see from
      // the ground, so it gets the one icon that is not a primitive.
      ctx.moveTo(x, y + r);
      ctx.lineTo(x, y - r);
      ctx.moveTo(x - r * 0.55, y + r);
      ctx.lineTo(x + r * 0.55, y + r);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - r, r * 0.36, 0, TAU);
      ctx.fill();
      return;
    }
    default:
      ctx.arc(x, y, r, 0, TAU);
      break;
  }
  if (filled) ctx.fill();
  else ctx.stroke();
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Scatter kinds that count as a tree on the map. */
const TREE_KINDS = new Set(['pine', 'broadleaf', 'dead']);
/** …and as a rock. `mast` is here so the tower's collider is not drawn twice. */
const ROCK_KINDS = new Set(['rock', 'log', 'wreck']);

/** Reused projection result. The draw path must not allocate. */
const _p0 = { x: 0, y: 0 };
/** Unit corners of a square, for the rotated case in `drawShape`. */
const _SQUARE = [-1, -1, 1, -1, 1, 1, -1, 1];

function clampInt(n, lo, hi) {
  const v = Math.round(Number(n) || 0);
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Lerp along the short way round, so crossing ±π does not spin the map. */
function angleApproach(from, to, k) {
  let d = to - from;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return from + d * (k < 0 ? 0 : k > 1 ? 1 : k);
}
