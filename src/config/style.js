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

  // -------------------------------------------------------------------------
  // WEATHER AND TIME OF DAY
  // -------------------------------------------------------------------------
  // One palette per *place*, not per mood: a level names the theme its map is
  // in and never changes it. All of them inherit `forest`, so they are only the
  // colours that differ — and anything added to `forest` later (a new prop, a
  // new animal) arrives in every one of them for free.

  /**
   * RAIN — an overcast afternoon with the water still coming down.
   *
   * The load-bearing colour here is the road: wet tarmac is darker, bluer and
   * shinier than dry, and it is the only thing on screen that tells the player
   * the grip has changed before they find out in a corner. Everything else is
   * desaturated toward the fog, because that is what rain does to a valley.
   */
  rain: {
    label: 'Rain',
    inherits: 'forest',
    fog: { color: 0x8a99a0, near: 24, far: 190, density: 0.0125, exponential: true },
    sky: { top: 0x7e8e98, bottom: 0xa8b2b4, sunColor: 0xb8c2c4, sunSize: 0.0 },
    light: {
      direction: { x: 0.2, y: 0.85, z: 0.3 },
      color: 0xc4d0d6,
      intensity: 2.4,
      ambientColor: 0x6a7a86,
      ambientIntensity: 2.6,
      groundBounce: 0x3e4a3e,
    },
    ground: {
      base: 0x40573a,
      variantA: 0x374c33,
      variantB: 0x4c6442,
      cliff: 0x59564e,
      dirt: 0x4e4132,
      mud: 0x322a20,
      grit: 0x6e6a62,
    },
    /** Standing water: dark, and the paint on it reads brighter than the road. */
    road: {
      surface: 0x33343c,
      shoulder: 0x574a38,
      centreLine: 0xc8c4a8,
      edgeLine: 0xdcd8c0,
      kerbA: 0xa8402f,
      kerbB: 0xdcd8c0,
    },
    foliage: {
      trunk: 0x3a2e22,
      canopyA: 0x27431f,
      canopyB: 0x315227,
      canopyC: 0x1e3519,
      bush: 0x2e4a24,
      grassBlade: 0x4c6636,
      fern: 0x2a4522,
      litter: 0x554427,
    },
    grade: { lift: 0.03, gain: 1.06, saturation: 0.78, tint: 0xcfdae0 },
  },

  /**
   * STORM — the same weather after dark, which is a different problem.
   *
   * Inherits `night` rather than `rain`: the thing that makes a night race hard
   * is that the only light is yours, and rain on top of that is what turns a
   * road into a set of reflections. The road is nearly black and the paint is
   * the brightest thing in the world.
   */
  storm: {
    label: 'Storm',
    inherits: 'night',
    fog: { color: 0x10141c, near: 14, far: 130, density: 0.023, exponential: true },
    sky: { top: 0x070a12, bottom: 0x151c28, sunColor: 0x1e2636, sunSize: 0.0 },
    light: {
      direction: { x: -0.25, y: 0.6, z: -0.4 },
      color: 0x5a6c92,
      intensity: 2.2,
      ambientColor: 0x232f44,
      ambientIntensity: 3.0,
      groundBounce: 0x10160f,
    },
    road: {
      surface: 0x1e1f28,
      shoulder: 0x241f16,
      centreLine: 0x8a8670,
      edgeLine: 0x9a9680,
      kerbA: 0x6a2a22,
      kerbB: 0x9a9680,
    },
    grade: { lift: 0.04, gain: 1.24, saturation: 0.7, tint: 0xa8bcdc },
  },

  /**
   * DUSK — the last twenty minutes of usable light, and the prettiest of them.
   *
   * The sun is nearly on the horizon (`direction.y` is low), which is why this
   * theme looks different from every other one at the same time of day: long
   * shading across the hills, warm on everything facing west and cold in every
   * hollow that is not.
   */
  dusk: {
    label: 'Dusk',
    inherits: 'forest',
    fog: { color: 0xb38a6e, near: 45, far: 340, density: 0.0062, exponential: true },
    /** A big low sun, because the whole level is driving into it. */
    sky: { top: 0x3a4a78, bottom: 0xe8a05a, sunColor: 0xffd8a0, sunSize: 0.075 },
    light: {
      direction: { x: 0.85, y: 0.22, z: -0.35 },
      color: 0xffc890,
      intensity: 3.4,
      ambientColor: 0x5a5878,
      ambientIntensity: 1.7,
      groundBounce: 0x4e4030,
    },
    ground: {
      base: 0x5a6438,
      variantA: 0x4c5630,
      variantB: 0x6b7040,
      cliff: 0x7a6450,
      dirt: 0x7d5c36,
      mud: 0x4a3826,
      grit: 0x9a8468,
    },
    road: {
      surface: 0x54484a,
      shoulder: 0x8a6b46,
      centreLine: 0xe8d0a0,
      edgeLine: 0xf4e2bc,
      kerbA: 0xd05038,
      kerbB: 0xf4e2bc,
    },
    foliage: {
      trunk: 0x53381f,
      canopyA: 0x36501e,
      canopyB: 0x486028,
      canopyC: 0x2a3d18,
      bush: 0x415420,
      grassBlade: 0x6d7a36,
      fern: 0x3c4c22,
      litter: 0x7a5628,
    },
    grade: { lift: 0.02, gain: 1.06, saturation: 1.05, tint: 0xffe4c8 },
  },

  /**
   * MIST — early morning, and you cannot see the next corner.
   *
   * The fog is the level design here: `far` is barely over a hundred metres, so
   * a track in this theme has to be readable at short range and is a memory
   * test at speed. Kept pale rather than dark — being unable to see in daylight
   * is a different and more unsettling thing than being unable to see at night.
   */
  mist: {
    label: 'Mist',
    inherits: 'forest',
    fog: { color: 0xc6ccc4, near: 18, far: 150, density: 0.0165, exponential: true },
    sky: { top: 0xb8c2c0, bottom: 0xdce0d8, sunColor: 0xf0f0e0, sunSize: 0.06 },
    light: {
      direction: { x: 0.35, y: 0.72, z: 0.25 },
      color: 0xe8ecdc,
      intensity: 2.6,
      ambientColor: 0x93a099,
      ambientIntensity: 2.8,
      groundBounce: 0x536046,
    },
    ground: {
      base: 0x5c7048,
      variantA: 0x4f6440,
      variantB: 0x6a7c52,
      cliff: 0x77746a,
      dirt: 0x6f5f45,
      mud: 0x4a4234,
      grit: 0x94908a,
    },
    foliage: {
      trunk: 0x50432f,
      canopyA: 0x3a5c30,
      canopyB: 0x476b3a,
      canopyC: 0x2f4a28,
      bush: 0x436034,
      grassBlade: 0x668a48,
      fern: 0x3d5c32,
      litter: 0x6f5c3a,
    },
    grade: { lift: 0.06, gain: 0.98, saturation: 0.82, tint: 0xe8f0ec },
  },

  /**
   * SNOW — the high ground, above where the forest bothers.
   *
   * Everything pale, and the two things that are not — trunks, and the road —
   * are the only things a player can navigate by. That is the whole idea of the
   * level this belongs to: on white ground with white fog, the trees are the
   * map. The road is deliberately left dark, because a snow-covered road you
   * cannot see the edges of is not a track, it is a field.
   */
  snow: {
    label: 'Snow',
    inherits: 'forest',
    fog: { color: 0xd4dce4, near: 30, far: 230, density: 0.0105, exponential: true },
    sky: { top: 0x9fb4c8, bottom: 0xdfe6ec, sunColor: 0xffffff, sunSize: 0.02 },
    light: {
      direction: { x: 0.3, y: 0.68, z: 0.5 },
      color: 0xeaf0f8,
      intensity: 2.9,
      ambientColor: 0x8fa4bc,
      ambientIntensity: 2.9,
      groundBounce: 0xb8c8d4,
    },
    ground: {
      base: 0xcdd8e0,
      variantA: 0xbecad4,
      variantB: 0xdae2e8,
      cliff: 0x8a8c92,
      dirt: 0xa8a8a4,
      mud: 0x6e737a,
      grit: 0xe8eef2,
    },
    road: {
      surface: 0x3e4248,
      shoulder: 0xaeb6bc,
      centreLine: 0xd8d2b0,
      edgeLine: 0xf0f4f8,
      kerbA: 0xb03a2e,
      kerbB: 0xf0f4f8,
    },
    foliage: {
      trunk: 0x3b3229,
      canopyA: 0x24402a,
      canopyB: 0x2e4c32,
      canopyC: 0x1c3222,
      bush: 0x8fa08c,
      grassBlade: 0xa8b8b0,
      fern: 0x627064,
      litter: 0x9aa09c,
    },
    props: { rock: 0x8e9298, barrier: 0xe8ecf0, barrierAlt: 0xb03a2e, post: 0x6a6a66 },
    dome: { glass: 0xc0d8e4, seam: 0x8fe0d0 },
    grade: { lift: 0.05, gain: 1.05, saturation: 0.72, tint: 0xeaf2fa },
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
