/**
 * STYLE — how the game LOOKS.
 *
 * Two independent layers:
 *   1. RENDER  — the retro pipeline itself (internal resolution, vertex snap,
 *                dithering, scanlines). Change these to move between "PS1",
 *                "N64", "clean low-poly" and "modern".
 *   2. THEMES  — palettes. A theme is a complete colour world. Swapping themes
 *                at runtime is how the game says "you are somewhere else now":
 *                `forest` → `outside` → `night` across the story.
 *
 * Nothing here imports three.js — these are plain numbers so the config stays
 * portable if you ever swap renderers.
 */

// ---------------------------------------------------------------------------
// RENDER PRESETS
// ---------------------------------------------------------------------------

export const RENDER_PRESETS = {
  /** Chunky, wobbly, 1997. The default. */
  psx: {
    label: 'PSX',
    /** Internal render height in pixels; width follows the aspect ratio.
     *  The result is upscaled with nearest-neighbour for hard pixels. */
    internalHeight: 288,
    /** Snap vertices to a virtual pixel grid — the classic PS1 wobble.
     *  Higher = less wobble. 0 disables. */
    vertexSnap: 140,
    /** Affine texture mapping (perspective-incorrect, PS1's famous warp). */
    affineTextures: true,
    /** Quantise output colour to N levels per channel. 0 = off. */
    colorLevels: 32,
    /** Ordered 4x4 Bayer dithering strength, 0..1. */
    dither: 0.55,
    /** CRT scanline darkening, 0..1. */
    scanlines: 0.18,
    /** Corner darkening, 0..1. */
    vignette: 0.35,
    /** Horizontal RGB split in internal pixels. 0 = off. */
    chromaticAberration: 0.35,
    /** Nearest-neighbour upscale (hard pixels) vs linear (soft). */
    pixelated: true,
    /** Flat (faceted) shading instead of smooth normals. */
    flatShading: true,
    /** Vertex lighting only — no per-pixel lights. Cheap and period-correct. */
    vertexLighting: true,
    shadows: false,
    /** Anti-aliasing on the internal buffer. Off is more authentic. */
    antialias: false,
  },

  /** A little cleaner — N64-ish. Smoother, still low-res. */
  n64: {
    label: 'N64',
    internalHeight: 360,
    vertexSnap: 0,
    affineTextures: false,
    colorLevels: 48,
    dither: 0.3,
    scanlines: 0.08,
    vignette: 0.25,
    chromaticAberration: 0,
    pixelated: true,
    flatShading: false,
    vertexLighting: true,
    shadows: false,
    antialias: false,
  },

  /** Full resolution, no filters. Useful while debugging geometry. */
  clean: {
    label: 'Clean',
    internalHeight: 0, // 0 = native resolution
    vertexSnap: 0,
    affineTextures: false,
    colorLevels: 0,
    dither: 0,
    scanlines: 0,
    vignette: 0.15,
    chromaticAberration: 0,
    pixelated: false,
    flatShading: true,
    vertexLighting: false,
    shadows: true,
    antialias: true,
  },
};

export const ACTIVE_RENDER_PRESET = 'psx';

// ---------------------------------------------------------------------------
// THEMES
// ---------------------------------------------------------------------------
// Every colour in the game comes from the active theme. Systems ask for a
// *role* ("road", "foliageA"), never a literal colour, so a new theme restyles
// the whole game without touching a single system file.

/** @typedef {keyof typeof THEMES} ThemeName */

export const THEMES = {
  /** The sanctioned game world: warm, green, safe, slightly too tidy. */
  forest: {
    label: 'Forest',
    fog: { color: 0x9fb98a, near: 40, far: 300, density: 0.0075, exponential: true },
    sky: { top: 0xbcd7e8, bottom: 0xe4e2c8, sunColor: 0xfff3d0, sunSize: 0.04 },
    light: {
      // Direction the sun points FROM, normalised on use.
      direction: { x: 0.45, y: 0.75, z: 0.3 },
      color: 0xfff0cc,
      intensity: 3.2,
      ambientColor: 0x6d8a9c,
      ambientIntensity: 1.55,
      /** Cheap hemisphere tint used by the vertex-lit material. */
      groundBounce: 0x4a5c33,
    },
    ground: {
      base: 0x53703c,
      variantA: 0x455f33,
      variantB: 0x62804a,
      cliff: 0x6b6455,
      /** Bare earth, where the slope has worn the turf off it. */
      dirt: 0x6b5537,
      /** Wet ground down where the streams are. Darker than dirt, and greyer. */
      mud: 0x453a2c,
      /** Stones and sand in the soil — the pale speckle over bare ground. */
      grit: 0x8c8272,
    },
    road: {
      surface: 0x4a4a52,
      shoulder: 0x7d6f52,
      centreLine: 0xd8d2b0,
      edgeLine: 0xe8e4cc,
      kerbA: 0xc44a3a,
      kerbB: 0xe8e4cc,
    },
    foliage: {
      trunk: 0x4a3a2a,
      canopyA: 0x2f5426,
      canopyB: 0x3d6630,
      canopyC: 0x26421f,
      bush: 0x395c2c,
      grassBlade: 0x5f8040,
      /** Ferns and the low stuff under the canopy — deeper and bluer than turf,
       *  because almost nothing down there is in direct sun. */
      fern: 0x33552a,
      /** Fallen leaves. The one warm colour on the forest floor. */
      litter: 0x6a5330,
    },
    props: {
      rock: 0x6e6a60,
      barrier: 0xd8d4c0,
      barrierAlt: 0xb03a2e,
      sign: 0xd9c98a,
      post: 0x7a6a52,
      water: 0x3f6a7a,
      /** Paper on a stake. Bleached by however long it has been out there. */
      paper: 0xe8e2d0,
      paperInk: 0x2e2c28,
      /** Bodywork that has been sitting in a forest for years. */
      rust: 0x8a4a2c,
      rustDark: 0x5c3320,
    },
    /**
     * The glass over the parkours. `glass` is the pane, which is fogged and
     * almost transparent; `seam` is the panel edge, which is emissive and
     * ignores fog, so a dome three hundred metres away still reads as a
     * structure on a night you cannot see a hundred. See `src/world/dome.js`.
     */
    dome: { glass: 0xa8d0dc, seam: 0x8fe0d0 },
    /**
     * Fur and wings. Every theme inherits these from `forest`, so the open
     * world is populated in all of them without four copies of the palette.
     */
    animals: {
      cat: 0x4a4038,
      catAlt: 0xc8a878,
      fox: 0xc4622a,
      foxTail: 0xe8ddd0,
      bird: 0x2e3138,
      birdAlt: 0x6a7078,
      butterfly: 0xf0c850,
      butterflyAlt: 0xd8683a,
    },
    vehicles: {
      player: 0xd8483a,
      playerAccent: 0x2a2a30,
      glass: 0x1e2a33,
      tyre: 0x1a1a1c,
      rivals: [0x3f6fb5, 0xe0b040, 0x7a4fa8, 0x40a070],
      cop: 0x1c1c22,
      copAccent: 0xe8e8e8,
      copLightA: 0xff2a2a,
      copLightB: 0x2a6aff,
    },
    ui: {
      ink: 0xe8e4d4,
      inkDim: 0x9a9684,
      accent: 0xd8483a,
      accentAlt: 0x54c8b0,
      panel: 0x141a18,
      panelEdge: 0x39463c,
      good: 0x7ec850,
      bad: 0xd8483a,
    },
    /** Screen-space grade applied in the post pass. */
    grade: { lift: 0.02, gain: 1.03, saturation: 1.0, tint: 0xffffff },
  },

  /** Outside the track bounds: colder, emptier, slightly wrong. */
  outside: {
    label: 'Outside',
    inherits: 'forest',
    fog: { color: 0x7d94a5, near: 55, far: 420, density: 0.0052, exponential: true },
    sky: { top: 0x8fa9bd, bottom: 0xc3c9c4, sunColor: 0xe8ecf0, sunSize: 0.03 },
    light: {
      direction: { x: 0.3, y: 0.68, z: 0.42 },
      color: 0xdfe8f0,
      intensity: 3.1,
      ambientColor: 0x5f7285,
      ambientIntensity: 2.2,
      groundBounce: 0x3e4a3a,
    },
    ground: {
      base: 0x4a6440,
      variantA: 0x3d5638,
      variantB: 0x577049,
      cliff: 0x605a4e,
      dirt: 0x5e5140,
      mud: 0x35302a,
      grit: 0x7d7a70,
    },
    ui: { accent: 0x54c8b0, accentAlt: 0xd8483a },
    grade: { lift: 0.03, gain: 1.12, saturation: 0.86, tint: 0xdce8f2 },
  },

  /** The chase. Dusk collapsing into night, sirens the only warm light. */
  night: {
    label: 'Night',
    inherits: 'forest',
    fog: { color: 0x14161f, near: 20, far: 180, density: 0.017, exponential: true },
    sky: { top: 0x0a0d16, bottom: 0x1d2433, sunColor: 0x2a3348, sunSize: 0.0 },
    light: {
      direction: { x: -0.3, y: 0.55, z: -0.5 },
      color: 0x6a7ea8,
      intensity: 2.6,
      ambientColor: 0x2b3a52,
      ambientIntensity: 2.9,
      groundBounce: 0x141a14,
    },
    ground: {
      base: 0x2c3d28,
      variantA: 0x243422,
      variantB: 0x36482e,
      cliff: 0x3a3a34,
      dirt: 0x332a1e,
      mud: 0x221d17,
      grit: 0x424036,
    },
    road: {
      surface: 0x2a2a33,
      shoulder: 0x2a2418,
      centreLine: 0x7a7660,
      edgeLine: 0x8a8670,
      kerbA: 0x6a2a22,
      kerbB: 0x8a8878,
    },
    foliage: {
      trunk: 0x1d1712,
      canopyA: 0x122010,
      canopyB: 0x182914,
      canopyC: 0x0e1a0c,
      bush: 0x16240f,
      grassBlade: 0x1f2c16,
      fern: 0x121f0e,
      litter: 0x2a2216,
    },
    ui: { ink: 0xdfe6f0, accent: 0xff2a2a, accentAlt: 0x2a6aff },
    /** Cold glass under a cold sky. The seam stays bright; it has to. */
    dome: { glass: 0x5f7a92, seam: 0x8fe0d0 },
    grade: { lift: 0.035, gain: 1.2, saturation: 0.78, tint: 0xb8c6e0 },
  },

  /** The moment the illusion cracks. Used in short bursts, never for long. */
  glitch: {
    label: 'Glitch',
    inherits: 'outside',
    fog: { color: 0x101418, near: 30, far: 260, density: 0.009, exponential: true },
    sky: { top: 0x0b0f14, bottom: 0x18202a, sunColor: 0x54c8b0, sunSize: 0.02 },
    light: {
      direction: { x: 0.2, y: 0.8, z: 0.2 },
      color: 0x9fffe8,
      intensity: 2.3,
      ambientColor: 0x203040,
      ambientIntensity: 1.9,
      groundBounce: 0x14342c,
    },
    ground: {
      base: 0x1b3a34,
      variantA: 0x15302c,
      variantB: 0x21453c,
      cliff: 0x2a3540,
      dirt: 0x21403a,
      mud: 0x122622,
      grit: 0x33564e,
    },
    ui: { ink: 0x9fffe8, accent: 0x54c8b0, accentAlt: 0xff2a6a },
    grade: { lift: 0.03, gain: 1.12, saturation: 0.7, tint: 0x9fffe8 },
  },
};

export const DEFAULT_THEME = 'forest';

// ---------------------------------------------------------------------------
// GROUND PAINT
// ---------------------------------------------------------------------------

/**
 * How the terrain's vertex colours are mixed out of the theme's ground palette.
 *
 * These are the *rules*; the colours themselves are per-theme above. The whole
 * point is that ground reads as ground rather than as tinted noise: turf wears
 * off as the land tips over, the low places go damp and dark, and there is grit
 * in the soil everywhere. All of it is free — the terrain mesh already carries
 * a colour attribute, so this costs nothing at runtime and nothing to draw.
 *
 * Thresholds that describe a *slope* are fractions of `TERRAIN_SHAPE.cliffSlope`
 * rather than absolute numbers, so retuning what counts as a cliff drags the
 * bare earth along with it instead of leaving a green cliff face behind.
 */
export const GROUND_PAINT = {
  /** Broad patches of grass shade — grid cells per noise cycle. */
  patchScale: 0.09,
  /** Finer speckle mixed into the patch choice. */
  speckScale: 0.61,

  /**
   * WEAR — where the turf gives up, on Terrain's 0..1 slope metric.
   *
   * Absolute, and NOT a fraction of `TERRAIN_SHAPE.cliffSlope`, which is the
   * obvious thing to do and produces nothing at all. This valley is gentle:
   * measured over the built world the median slope is 0.004, the 90th
   * percentile is 0.056, the 99th is 0.099 and the steepest vertex anywhere is
   * 0.43. `cliffSlope` is 0.55, so not one square metre of the map is a cliff
   * and only 78 vertices out of 48,841 even classify as DIRT. Hang the paint
   * off that number and the whole world stays green.
   *
   * At these values roughly a tenth of the ground shows real earth, all of it
   * on the faces of the hills, which is where you would expect to find it.
   */
  wearStart: 0.018,
  /** …and where it is bare earth and nothing else. */
  wearFull: 0.12,
  /**
   * How far a noise field is allowed to move the wear line. Without it, bare
   * earth appears along a perfect contour and the hillside looks like a
   * topographic map.
   */
  wearNoise: 0.03,
  wearNoiseScale: 0.17,

  /** Metres above `TERRAIN_SHAPE.waterLevel` where the ground starts to damp. */
  dampAbove: 9,
  /** Metres below it by which the ground is entirely mud. */
  dampBelow: 2,

  /** Grit amplitude on turf — soil barely shows through grass. */
  gritOnGrass: 0.06,
  /** …and on bare earth, where it is most of what you are looking at. */
  gritOnEarth: 0.2,
  /** Grid cells per grit cycle. Near 1 = per-vertex, which is the finest the
   *  heightfield can carry. */
  gritScale: 1.37,

  /** Higher ground catches more light — a free, cheap sense of relief. */
  lift: { from: 10, range: 260, min: -0.1, max: 0.16 },

  /**
   * How a worn trail marks the ground it runs over. See `world/trails.js`;
   * the SHAPE of the network is `OPEN_WORLD.trails`, this is only its colour.
   *
   * Toward the theme's own dirt, then darkened — a rut is bare earth AND it is
   * in shadow, because it is a groove. Both, or it reads as a painted stripe.
   */
  trail: {
    /** How far toward `ground.dirt` a fully worn vertex goes, 0..1. */
    toDirt: 0.8,
    /** …and how much darker on top of that. */
    darken: 0.24,
    /** Extra grit, because a used path is where the stones end up. */
    grit: 0.12,
  },
};

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Resolve a theme with its `inherits` chain flattened. */
export function resolveTheme(name) {
  const seen = new Set();
  const chain = [];
  let key = name;
  while (key) {
    if (seen.has(key)) throw new Error(`Circular theme inheritance at "${key}"`);
    seen.add(key);
    const t = THEMES[key];
    if (!t) throw new Error(`Unknown theme "${name}" (missing link: "${key}")`);
    chain.unshift(t);
    key = t.inherits;
  }
  let merged = {};
  for (const t of chain) merged = deepMerge(merged, t);
  delete merged.inherits;
  merged.name = name;
  return merged;
}

export function resolveRenderPreset(name = ACTIVE_RENDER_PRESET) {
  const p = RENDER_PRESETS[name];
  if (!p) throw new Error(`Unknown render preset "${name}"`);
  return { ...p, name };
}

/** `0xrrggbb` → `#rrggbb`, for the DOM-side UI. */
export function hexToCss(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6);
}
