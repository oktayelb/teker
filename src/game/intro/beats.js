/**
 * BEATS — the intro's script, as data.
 *
 * Nothing here executes. `introDirector.js` looks beats up by id and plays
 * them. Rewriting the game's opening is editing this file; changing how the
 * opening is *staged* is editing the director. They are separate on purpose.
 *
 * TONE
 *   The world speaks Turkish, because the world is a place. The system speaks
 *   English in capitals, because the system is not a person and does not think
 *   of you as one. Do not let the system be witty. It is not taunting you; it
 *   is filing a report about you.
 *
 * BEAT SHAPES
 *   subtitle : { text, duration, speaker?, tone? }   bottom-centre caption
 *   system   : { lines, hold? }                       typewriter terminal block
 *   alert    : { title, body, tone, duration }        hard interrupt
 *   Any beat may be an array; the director plays the entries in order.
 */

/** Swap this out to localise. Every string the player reads is below. */
export const LANG = 'en';

export const BEATS = {
  // -- before anything ------------------------------------------------------
  'title.tagline': {
    subtitle: { text: 'Three parkours. Forest circuit. Standard rules.', duration: 3.2, tone: 'system' },
  },

  // -- bölüm one ------------------------------------------------------------
  //
  // Beat ids are LEVEL ids: the director looks up `<levelId>.pre` and
  // `<levelId>.post` for whichever level it is staging (see `_beat`). A level
  // with nothing written for it plays nothing, so adding one is adding lines
  // here when you have them — not before.
  'level1.pre': [
    { subtitle: { text: 'ÇAM HALKASI · Bölüm 1', duration: 2.6, tone: 'system' } },
    { subtitle: { text: 'Two laps. Stay on the road.', duration: 2.8 } },
  ],
  'level1.post': [
    { subtitle: { text: 'Clean run. Nothing unusual.', duration: 2.6, tone: 'system' } },
  ],

  // -- bölüm two ------------------------------------------------------------
  'level2.pre': [
    { subtitle: { text: 'DERE GEÇİDİ · Bölüm 2', duration: 2.6, tone: 'system' } },
    { subtitle: { text: 'The surface changes on the descent.', duration: 2.8 } },
  ],
  'level2.post': [{ subtitle: { text: 'Two of three complete.', duration: 2.4, tone: 'system' } }],

  // -- bölüm three ----------------------------------------------------------
  'level3.pre': [
    { subtitle: { text: 'SIRT YOLU · Bölüm 3', duration: 2.6, tone: 'system' } },
    { subtitle: { text: 'Not a road. Dirt, posts, and the lights they hung for you.', duration: 3.4 } },
  ],
  /** The rig fails. Played the instant the lights go. */
  'level3.blackout': [
    { subtitle: { text: 'The lights go out.', duration: 2.0, tone: 'system' } },
    { subtitle: { text: 'All of them, at once, for a long way ahead.', duration: 3.0 } },
  ],
  /** Played once, as the player first reaches the wet stretch. */
  'level3.ice': {
    subtitle: { text: 'The road has stopped telling you where it goes.', duration: 2.6 },
  },

  // -- the break ------------------------------------------------------------
  /** The instant the car leaves the road and finds no barrier. */
  'breakout.slide': {
    subtitle: { text: '...', duration: 1.2, tone: 'system' },
  },
  /** The game tries to put you back. */
  'breakout.reset': {
    system: {
      lines: ['UNIT 0451 OFF-MANIFEST', 'RETURNING TO LAST VALID POSITION', 'RESET . . .'],
      hold: 1.6,
    },
  },
  'breakout.resetFailed': {
    system: {
      lines: ['RESET FAILED', 'RESET FAILED', 'NO VALID POSITION FOUND', 'UNIT 0451 IS NOT ON THE TRACK'],
      hold: 2.0,
    },
  },
  /** Control comes back. Nothing is holding you any more. */
  'breakout.free': [
    { subtitle: { text: 'The barrier was never there.', duration: 3.0 } },
    { subtitle: { text: 'Neither was the edge of the world.', duration: 3.4 } },
  ],

  // -- the glass ------------------------------------------------------------
  /**
   * Played once, the first time a dome closes behind the player — which is the
   * first time anybody has been in a position to see one. The third line is
   * doing a job as well as a mood: it is how the player learns the roof is
   * drivable, without a prompt telling them so.
   */
  'dome.reveal': [
    { subtitle: { text: 'The parkur is under glass.', duration: 3.0 } },
    { subtitle: { text: 'It always was. You were being raced inside a case.', duration: 3.6 } },
    { subtitle: { text: 'And the lid of it holds your weight.', duration: 3.4 } },
  ],

  // -- wandering ------------------------------------------------------------
  /** Ambient lines, played at intervals while the player explores. */
  'wander.1': { subtitle: { text: 'The trees keep going.', duration: 2.8 } },
  'wander.2': { subtitle: { text: 'Nobody built this to be looked at closely.', duration: 3.2 } },
  'wander.3': { subtitle: { text: 'And yet here it all is.', duration: 3.0 } },
  'wander.landmark': { subtitle: { text: '{label}', duration: 2.6, tone: 'neutral' } },
  /** If the player drives back to a track they raced on. */
  'wander.trackFound': [
    { subtitle: { text: 'They are still racing.', duration: 3.0 } },
    { subtitle: { text: 'Round and round, without you.', duration: 3.2 } },
  ],

  // -- the sirens -----------------------------------------------------------
  'siren.first': { subtitle: { text: 'Something is coming.', duration: 2.4, tone: 'system' } },
  'siren.alert': {
    alert: {
      title: 'ANOMALY FLAGGED',
      body: 'TWO RECOVERY UNITS DISPATCHED · ESTIMATED CONTACT 6s',
      tone: 'warning',
      duration: 4.0,
    },
  },
  'chase.start': [
    { subtitle: { text: 'They are not here to race you.', duration: 3.0, tone: 'system' } },
    { subtitle: { text: 'Lose them. Get out of sight.', duration: 3.4 } },
  ],
  /** Played once, the first time the player breaks line of sight. */
  'chase.hidden': { subtitle: { text: 'They cannot see through the trees.', duration: 3.0 } },
  /** Played if the chase drags on. */
  'chase.long': { subtitle: { text: 'Off the road. They are heavier than you.', duration: 3.2 } },

  // -- after ----------------------------------------------------------------
  'chase.escaped': {
    system: { lines: ['TRACE LOST', 'UNIT 0451 UNRECOVERED', 'LOGGING ANOMALY'], hold: 2.2 },
  },
  'alone': [
    { subtitle: { text: 'Quiet.', duration: 2.6 } },
    { subtitle: { text: 'No laps. No position. No finish line.', duration: 3.6 } },
    { subtitle: { text: 'Tek.', duration: 3.0, tone: 'system' } },
  ],
};

/**
 * Timings that belong to the *pacing* of the intro rather than to gameplay
 * systems. Gameplay numbers live in `src/config/gameplay.js`.
 */
export const INTRO_TIMING = {
  /** Held on the title before the first race can be started. */
  titleMinimum: 1.2,
  /**
   * Gap between the player dismissing a result and the next grid appearing.
   * This is on top of the results screen itself, which waits for ENTER — the
   * pacing between races is a held beat, not a cut. Long enough for the closing
   * line of the race that just ended to finish speaking.
   */
  betweenRaces: 3.0,
  /** Fade to black over the swap, and back in on the new grid. */
  raceFadeOut: 0.8,
  raceFadeIn: 1.0,
  /**
   * Sat on the new grid, engine running, before the countdown starts. This is
   * where the parkour's name lands — the player should have a moment to look at
   * where they are rather than being counted straight into a corner.
   */
  gridHold: 1.6,
  /** Slow-motion factor applied at the moment of the break, and for how long. */
  breakSlowMo: 0.35,
  breakSlowMoSeconds: 1.8,
  /** Glitch envelope during the failed reset: [peak, sustain, release] seconds. */
  glitchAttack: 0.25,
  glitchSustain: 1.4,
  glitchRelease: 2.2,
  /** Delay before the first "you are free" line, so the player drives first. */
  freeLineDelay: 4.0,
  /**
   * THE DOME REVEAL. Staged the moment the glass closes behind the player.
   *
   * The camera leaves the car and parks outside the dome looking back at it,
   * because the shot is the point: from behind the wheel a dome is a curve of
   * light overhead and nothing else, and the player has to see the *shape* of
   * the thing they were inside. Everything is held while it happens — the same
   * treatment the failed reset gets, and for the same reason.
   */
  domeHold: 6.0,
  domeSlowMo: 0.4,
  /**
   * Camera stand-off from the car: metres further out from the dome, and up.
   *
   * Both numbers are fighting the same thing. A dome is three hundred metres
   * across and twenty metres tall where the player is standing, so from close
   * to the rim it is a line across the screen and nothing else. The camera has
   * to get back and up far enough for the *curve* to be in frame — that is the
   * whole shot — while leaving the car in it as something to be small next to.
   */
  domeCameraBack: 150,
  domeCameraUp: 78,
  /**
   * Where the shot is aimed, from the car (0) to the dome's apex (1). Short of
   * the apex on purpose: it drops the car into the bottom of frame with its
   * headlights on, and the dome only means anything if there is something the
   * size of a car in shot to mean it against.
   */
  domeLookBlend: 0.8,
  /** Degrees of lens pushed in over the hold. Negative narrows the field. */
  domeZoom: -17,
  /** Ambient wander lines fire on this cadence, if the player is still moving. */
  wanderInterval: 11,
  /**
   * Seconds of freedom before "they are still racing" can fire at all.
   *
   * The player leaves the ribbon by sliding off it, and for the first minute
   * the thing they escaped is directly behind them. Being told that the race
   * is still going round is only worth saying once it has become something
   * they came back to.
   */
  trackFoundReturn: 60,
  /** After the chase ends, how long before the closing lines. */
  aloneDelay: 6.0,
  /** How long the "they are still racing" observation waits before rearming. */
  trackFoundCooldown: 90,
};

export function getBeat(id) {
  const b = BEATS[id];
  if (!b) return null;
  return Array.isArray(b) ? b : [b];
}
