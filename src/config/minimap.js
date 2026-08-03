/**
 * MINIMAP — every number the map has, in one file.
 *
 * `src/ui/minimap.js` contains no tuning constants at all. If you want the map
 * bigger, in another corner, showing further, in different colours, or drawing a
 * kind of thing it does not draw yet, this is the only file you have to open.
 *
 * THE FOUR THINGS YOU ARE MOST LIKELY TO WANT
 * -------------------------------------------
 *   MINIMAP.startVisible  — true makes it on by default instead of H-to-open.
 *   MINIMAP.anchor        — which corner it sits in.
 *   MINIMAP.zoom.levels   — how far it sees, in metres. Player cycles with H+.
 *   MINIMAP.icons         — add an entry, and a new kind of thing can be drawn.
 *
 * A NOTE ON WHY IT STARTS HIDDEN
 * ------------------------------
 * See DESIGN.md §4.2. The open world is meant to be navigated by landmark, so
 * the map is something the player opens rather than something the game hands
 * them. Flip `startVisible` if you disagree; nothing else has to change.
 */

// ---------------------------------------------------------------------------
// ICONS — the extension point
// ---------------------------------------------------------------------------

/**
 * How one *kind of thing* is drawn on the map.
 *
 * Adding a new one is an entry here plus something that references it by key —
 * either `map.icon` on a landmark in `world/world.js` (`LANDMARK_DEFS`), or a
 * runtime `minimap.addMarker({ icon: 'yourKey', ... })`. The drawing code never
 * learns the key; it looks it up.
 *
 * @typedef {object} MinimapIcon
 * @property {'dot'|'ring'|'triangle'|'diamond'|'square'|'cross'|'mast'} shape
 * @property {string} color        CSS colour, or `'accent'|'accentAlt'|'ink'|
 *                                 'inkDim'|'bad'|'good'` to take the live theme's.
 * @property {number} size         radius in map pixels at 1x scale
 * @property {number} [lineWidth]  outline weight for hollow shapes
 * @property {boolean} [filled]    solid rather than outlined
 * @property {boolean} [label]     print the marker's name beside it
 * @property {number} [hideAboveZoom] index into `zoom.levels` past which this
 *                                 icon is not drawn (0 = closest zoom only)
 * @property {number} [pulse]      Hz of an opacity pulse; 0 = steady
 * @property {number} [rotates]    1 = icon spins with the map, 0 = stays upright
 */

/** @type {Record<string, MinimapIcon>} */
export const MINIMAP_ICONS = {
  // -- the player ----------------------------------------------------------
  player: { shape: 'triangle', color: 'ink', size: 5.5, filled: true, rotates: 1 },

  // -- other cars ----------------------------------------------------------
  cop: { shape: 'square', color: 'bad', size: 3.6, filled: true, pulse: 0 },
  /** A cop that has actually seen you. The map should feel worse. */
  copActive: { shape: 'square', color: 'bad', size: 4.4, filled: true, pulse: 3.2 },
  rival: { shape: 'diamond', color: 'accentAlt', size: 3.4, filled: true },

  // -- scenery -------------------------------------------------------------
  /** Thousands of these. Keep it cheap: a filled dot and nothing else. */
  tree: { shape: 'dot', color: 'rgba(90, 132, 96, 0.85)', size: 1.5, filled: true },
  rock: { shape: 'dot', color: 'rgba(122, 122, 118, 0.7)', size: 1.4, filled: true },

  // -- landmarks -----------------------------------------------------------
  /** Used when a landmark names an icon that does not exist here. */
  landmark: { shape: 'ring', color: 'accent', size: 4.5, lineWidth: 1.5, label: true },
  mast: { shape: 'mast', color: 'accent', size: 5.5, lineWidth: 1.5, label: true, pulse: 0.8 },
  water: { shape: 'ring', color: '#4a7fa8', size: 5, lineWidth: 1.5, filled: true, label: true },
  stones: { shape: 'cross', color: 'inkDim', size: 4.5, lineWidth: 1.5, label: true },
  ridge: { shape: 'triangle', color: 'inkDim', size: 5, lineWidth: 1.5, label: true },
  valley: { shape: 'diamond', color: 'inkDim', size: 4.5, lineWidth: 1.5, label: true },
  edge: { shape: 'cross', color: 'bad', size: 4.5, lineWidth: 1.5, label: true, pulse: 0.5 },

  // -- race furniture ------------------------------------------------------
  /** Every checkpoint, at the closest zoom only — a lap's worth is clutter. */
  checkpoint: { shape: 'dot', color: 'accentAlt', size: 2, filled: true, hideAboveZoom: 0 },
  /** The next checkpoint you actually have to reach. */
  checkpointNext: { shape: 'ring', color: 'accentAlt', size: 5, lineWidth: 2, pulse: 2 },
  finish: { shape: 'square', color: 'ink', size: 4, lineWidth: 1.5, label: true },
};

// ---------------------------------------------------------------------------
// THE MAP
// ---------------------------------------------------------------------------

export const MINIMAP = {
  /** Master switch. `false` and the map is never built, not even hidden. */
  enabled: true,
  /** Visible the moment the game starts, rather than waiting for H. */
  startVisible: false,

  /**
   * Which modes the map is allowed to appear in.
   *
   * These are `Hud#setMode` names. `none` is the cutscene HUD, and letting a map
   * survive into a cutscene would be a mistake — the intro takes the camera off
   * the player entirely and the map would sit there tracking a car nobody is
   * looking at.
   */
  modes: ['race', 'openWorld', 'chase'],

  // -- placement -----------------------------------------------------------

  /**
   * 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right'
   *
   * `right` — vertically centred against the right edge — is the default
   * because it is the one part of the screen no other HUD element uses. The
   * corners are all taken in race mode: timing top-left, standings top-right,
   * wordmark bottom-left, speed bottom-right. Put the map in one of those and
   * the lap counter reads straight through it.
   */
  anchor: 'right',
  /** 'circle' | 'square' */
  shape: 'circle',
  /**
   * Edge length, as a share of the viewport's smaller dimension, then clamped.
   * The clamp is what keeps it usable on a phone and sane on a 4K monitor.
   */
  size: { vmin: 20, minPx: 132, maxPx: 300 },
  /** Gap from the screen edge, same units as `size`. */
  margin: { vmin: 2.2, minPx: 12, maxPx: 40 },
  /** 0..1. The map is furniture; it should not out-shout the road. */
  opacity: 0.88,

  // -- what it sees --------------------------------------------------------

  /**
   * Zoom steps, as the world radius in metres covered by the map's radius.
   * Cycled in order; the player never leaves this list.
   *
   * 130 is "the next corner", 300 is "this part of the forest", 700 is "which
   * parkur am I nearest", 1500 is the whole world (halfSpan is 1430m — see
   * `OPEN_WORLD.terrainResolution * terrainCellSize / 2`).
   */
  zoom: {
    levels: [130, 300, 700, 1500],
    /** Index into `levels` the map opens at. */
    default: 1,
    /** Seconds a zoom change takes to ease in. 0 snaps. */
    easeSeconds: 0.22,
  },

  /**
   * 'heading' — the map turns, the player arrow never does. The classic.
   * 'north'   — the world stays put and the arrow spins. Better for learning
   *             the map's shape, worse for "do I turn left here".
   */
  orientation: 'heading',
  /**
   * Seconds of lag on the map's rotation. Zero is correct and unreadable: a car
   * twitching at 120Hz makes the whole map shiver. ~0.12 reads as smooth.
   */
  headingSmoothing: 0.12,

  /**
   * Redraws per second.
   *
   * The map is the only thing in the UI that repaints a canvas, and at 1500m
   * zoom it can be several hundred blips. 30 is indistinguishable from 120 for
   * something this small and costs a quarter as much. Set 0 for every frame.
   */
  refreshHz: 30,

  // -- layers --------------------------------------------------------------

  /**
   * Draw order is top to bottom of this object, and each entry can be switched
   * off on its own.
   *
   * Two ways to make a layer stop:
   *   `range`         — metres. The layer stops short of the map's edge.
   *   `hideAboveZoom` — an index into `zoom.levels`. The layer is not drawn at
   *                     all beyond it.
   *
   * The scatter layers need both. `range` alone is what turns 4200 trees into a
   * few hundred near ones, but at the widest zoom a 260m disc of dots inside a
   * 1500m map is a green smudge around the player that reads as damage rather
   * than as forest. At that zoom you are looking for a parkur, not a tree.
   */
  layers: {
    /** The ground disc, plus the fog wall at the world's edge. */
    ground: { enabled: true, fill: 'rgba(18, 24, 20, 0.9)', edgeColor: 'rgba(216, 72, 58, 0.5)', edgeWidth: 2 },
    /** Every parkur ribbon, all three, always. They are what the world is for. */
    tracks: { enabled: true, color: 'rgba(232, 228, 212, 0.28)', activeColor: 'accentAlt', width: 2.4, activeWidth: 3.2 },
    /** Checkpoints and the finish line of the *active* track only. */
    raceFurniture: { enabled: true, range: Infinity },
    trees: { enabled: true, range: 260, maxBlips: 420, hideAboveZoom: 2 },
    rocks: { enabled: true, range: 180, maxBlips: 160, hideAboveZoom: 1 },
    landmarks: { enabled: true, range: Infinity, showUndiscovered: true, undiscoveredOpacity: 0.42 },
    /** Anything handed in at runtime via `minimap.addMarker()`. */
    custom: { enabled: true, range: Infinity },
    vehicles: { enabled: true, range: Infinity },
    player: { enabled: true },
  },

  /**
   * Things outside the map's range are clamped to its rim rather than dropped,
   * so a cop closing in is visible before it arrives. Per icon key; anything not
   * listed is simply culled.
   */
  clampToEdge: ['cop', 'copActive'],
  /** How far inside the rim a clamped blip sits, in map pixels. */
  clampInset: 7,

  // -- chrome --------------------------------------------------------------

  frame: {
    enabled: true,
    color: 'panelEdge',
    width: 2,
    /** Backdrop behind the whole thing, drawn under `layers.ground`. */
    background: 'rgba(10, 14, 12, 0.55)',
  },
  /**
   * The fixed tick at the top of the map, i.e. "where the car is pointing" in
   * heading mode and "north" in north mode.
   */
  compass: { enabled: true, color: 'accent', size: 6 },
  /** Small text under the map: the current zoom in metres. */
  scaleLabel: { enabled: true, color: 'inkDim', fontPx: 10 },
  /** Landmark names next to their icons. Costs a text draw each. */
  labels: { enabled: true, fontPx: 9, color: 'ink', offset: 8, maxAtOnce: 4 },

  // -- input ---------------------------------------------------------------

  /**
   * Held with the toggle key to cycle zoom instead of closing the map.
   * (`Shift+H` zooms out a step, `H` alone opens and closes.)
   */
  zoomModifier: 'shift',
  /** Seconds the open/close fade takes. */
  fadeSeconds: 0.18,
  /** Say `HARİTA · AÇIK` in the subtitle line when it is toggled. */
  announceToggle: true,
};

/**
 * Resolve a colour that may be a theme token.
 * @param {string} color a CSS colour, or a key of the theme's `ui` block
 * @param {object|null} theme a `resolveTheme()` result
 * @returns {string} CSS colour
 */
export function minimapColor(color, theme) {
  const ui = theme?.ui;
  if (ui && typeof color === 'string' && color in ui && typeof ui[color] === 'number') {
    return `#${(ui[color] >>> 0).toString(16).padStart(6, '0')}`;
  }
  return color;
}

/**
 * An icon definition by key, never null.
 * @param {string} key
 * @returns {MinimapIcon}
 */
export function minimapIcon(key) {
  return MINIMAP_ICONS[key] || MINIMAP_ICONS.landmark;
}
