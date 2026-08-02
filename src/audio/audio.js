/**
 * AUDIO — every sound in TEKERLEK, synthesised from nothing.
 *
 * There are no asset files. There is no fetch. Every engine note, siren wail,
 * cricket and menu blip is built at runtime out of oscillators, noise buffers
 * generated in JS, biquads and envelopes. That is a design constraint, not a
 * flex: the game is a simulation that the player eventually escapes, and a
 * soundtrack that is *computed* rather than *recorded* is thematically honest —
 * and it means the whole audio layer is one import with zero network cost.
 *
 * The palette is deliberately thin and slightly aliased. Square waves, cheap
 * filters, short buffers, hard gates. It should sound like hardware from 1997
 * that is not quite sure it's working.
 *
 * ---------------------------------------------------------------------------
 * USING IT
 * ---------------------------------------------------------------------------
 *   import { audio } from './audio/audio.js';
 *
 *   audio.init();                          // safe anywhere, safe twice
 *   window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
 *
 *   // per frame:
 *   audio.setListener({ x, y, z, forwardX, forwardZ });
 *   audio.updateEngine({ rpm01, load, speed, surface, slip, airborne });
 *
 * Browsers refuse to make noise before a user gesture. Until `unlock()`
 * resolves, every method here is a no-op — but *intent is remembered*: calling
 * `setMusic('menu')` or `startEngine()` on the title screen works, the sound
 * simply begins the instant the player first clicks. One-shots (blips, crashes)
 * are dropped rather than queued, because a burst of stale sounds at unlock is
 * worse than silence.
 *
 * If WebAudio is missing entirely the whole class degrades to a silent stub.
 * Nothing here throws.
 */

import { events } from '../core/events.js';
import {
  chain,
  clamp,
  clamp01,
  createPanner,
  distanceGain,
  envAD,
  glide,
  lerp,
  makeBitcrushCurve,
  makeFilter,
  makeGain,
  makeLfo,
  makeNoiseBuffer,
  makeNoiseSource,
  makeOsc,
  makeRng,
  makeSoftClipCurve,
  midiToHz,
  num,
  panAndDistance,
  pickAudioContextCtor,
  ramp,
  safeDisconnect,
  safeStop,
  scheduleTeardown,
  setPan,
  VoicePool,
} from './synth.js';

// ===========================================================================
// AUDIO_CONFIG — every number the sound designer touches lives here.
// ===========================================================================
// Units are stated everywhere. Hz = hertz, s = seconds, m/s = metres per second,
// gain values are linear amplitude (1 = unity, 0.5 ≈ -6 dB).
//
// Tuning order that works: MASTER.busVolumes first (balance the layers), then
// ENGINE (it's the sound you hear for 95% of the game), then everything else.

export const AUDIO_CONFIG = {
  MASTER: {
    /** Startup volume, 0..1. Overridden by setMasterVolume(). */
    volume: 0.8,
    /** Start muted? Useful when debugging with a mic open. */
    muted: false,
    /** Seconds to fade when volume/mute changes — instant changes click. */
    volumeGlideSec: 0.05,

    /**
     * Per-layer balance, linear gain. These are the mix. Everything else is
     * relative to them, so a layer that's too loud should be fixed HERE first
     * before you start pulling down individual sounds.
     */
    busVolumes: {
      engine: 0.55,
      tyres: 0.5,
      sfx: 0.85,
      siren: 0.7,
      music: 0.42,
      ambience: 0.4,
      glitch: 0.6,
    },

    /**
     * Output limiter. Not for loudness — for safety. Twelve one-shots plus an
     * engine plus two sirens can clip the summing bus, and digital clipping on
     * a laptop speaker sounds like a bug report.
     */
    limiter: {
      threshold: -8, // dB
      knee: 6, // dB
      ratio: 12, // :1
      attack: 0.004, // s
      release: 0.22, // s
    },
  },

  /**
   * Voice budgets. Three separate pools on purpose: if music and sfx shared
   * one, a long pad could eat the budget and silence the crash you just caused.
   * Gameplay one-shots must never lose to background layers.
   */
  VOICES: {
    maxOneShots: 12, // collisions, blips, stingers
    maxMusicVoices: 16, // sequencer notes in flight
    maxAmbienceVoices: 6, // birds, crickets, swells
  },

  /** Panning width for world-positioned sources. 1 = hard stereo, 0 = mono. */
  SPATIAL: {
    panWidth: 0.85,
    /** Distance (m) inside which a source is at full volume. */
    refDistance: 14,
    /** How fast it falls off past refDistance. Higher = more intimate world. */
    rolloff: 0.85,
    /** Beyond this (m) we stop bothering. */
    maxDistance: 400,
    /** Smoothing for pan/gain follow, seconds. */
    glideSec: 0.08,
  },

  // -------------------------------------------------------------------------
  // ENGINE
  // -------------------------------------------------------------------------
  // Three detuned oscillators tracking a "firing frequency", through a lowpass
  // that opens with throttle, amplitude-modulated by a sawtooth at the firing
  // rate. The AM is the important bit: it's what turns a drone into cylinders.
  // A pure tone here sounds like a theremin, not a car.
  ENGINE: {
    /** Firing frequency at idle and at redline, Hz. The whole pitch range. */
    idleHz: 38,
    maxHz: 168,
    /** rpm01 is raised to this power before mapping. >1 = lazier bottom end. */
    rpmCurve: 1.25,
    /** How fast pitch follows rpm, seconds. Too slow = rubber-band engine. */
    pitchGlideSec: 0.045,

    /**
     * Oscillator stack. `mul` is a multiple of the firing frequency, so the
     * whole stack stays harmonically locked as revs change.
     * Two saws a beating-interval apart + one square an octave up for edge.
     */
    oscillators: [
      { wave: 'sawtooth', mul: 1.0, detuneCents: 0, gain: 0.55 },
      { wave: 'sawtooth', mul: 1.0, detuneCents: -11, gain: 0.42 }, // beats against #1
      { wave: 'square', mul: 2.0, detuneCents: 7, gain: 0.18 }, // upper edge/whine
    ],

    /** Sub-octave body. 0 disables. Gives weight on small speakers. */
    subGain: 0.22,

    /**
     * Cylinder pulse: sawtooth AM at `pulseRatio` × firing frequency.
     * 1.0 = an even four; 0.5 = a lopey, uneven throb (V-twin territory).
     * Depth 0..1 — above ~0.7 it starts to sound like a helicopter.
     */
    pulseRatio: 1.0,
    pulseDepth: 0.5,

    /** Lowpass. Base cutoff plus contributions from throttle and revs, Hz. */
    cutoffBaseHz: 380,
    cutoffPerLoadHz: 2600, // full throttle opens it this much further
    cutoffPerRpmHz: 1500,
    cutoffQ: 3.2, // slight resonance = "pipe" character
    cutoffGlideSec: 0.06,

    /** Soft-clip drive, 0..1. Buzz and bite; 0 = clean and lifeless. */
    drive: 0.55,

    /** Combustion grit: bandpassed noise mixed under the oscillators. */
    gritGain: 0.1, // at full load
    gritHz: 520,
    gritQ: 0.7,

    /** Output gain = idle + load·loadGain + rpm01·rpmGain. Linear. */
    gainIdle: 0.16,
    gainPerLoad: 0.3,
    gainPerRpm: 0.18,
    gainGlideSec: 0.05,

    /** Off-throttle in the air: engine free-revs, so open up and thin out. */
    airborneCutoffBoost: 1.25, // multiplier
    airborneGain: 0.85, // multiplier

    /** Fades when startEngine()/stopEngine() are called, seconds. */
    startFadeSec: 0.25,
    stopFadeSec: 0.35,
  },

  // -------------------------------------------------------------------------
  // TYRES / SURFACE / WIND
  // -------------------------------------------------------------------------
  // One shared noise buffer, three branches at different playback rates so they
  // don't sound like the same hiss three times.
  TYRES: {
    /** Speed (m/s) at which surface noise reaches full volume. */
    fullVolumeSpeed: 22,
    /** Follow smoothing for surface crossfades, seconds. Slow = no pops. */
    glideSec: 0.09,
    /** Playback rate of the tyre noise branch. >1 = smaller, grittier grains. */
    noiseRate: 1.0,

    /** Squeal: a very resonant bandpass on noise. Q is the whole trick. */
    squeal: {
      /** Slip (0..1) below this makes no sound at all. */
      threshold: 0.18,
      /** Slip is raised to this power — keeps light drifts quiet. */
      curve: 1.8,
      /** Bandpass centre sweeps this range as slip rises, Hz. */
      minHz: 1050,
      maxHz: 2500,
      /** Q sweeps this range. High Q = the noise turns into a pitch. */
      minQ: 6,
      maxQ: 24,
      gain: 0.5,
      /** Vibrato on the centre frequency — keeps it from sounding like a tone. */
      wobbleHz: 7.5,
      wobbleDepthHz: 90,
      /** Below this speed (m/s) tyres scrub rather than squeal. */
      minSpeed: 4,
      noiseRate: 1.31,
    },

    /** Wind: lowpassed noise that grows with the square-ish of speed. */
    wind: {
      refSpeed: 30, // m/s at which `gain` is reached
      gain: 0.34,
      curve: 1.7, // >1 = wind stays out of the way until you're actually fast
      cutoffBaseHz: 260,
      cutoffPerSpeedHz: 34, // per m/s
      q: 0.6,
      noiseRate: 0.72,
    },
  },

  /**
   * Per-surface tyre character. Keys match `SURFACES` in config/tuning.js.
   * `hz`/`q` are the bandpass on the noise; `gain` is how loud that surface is;
   * `squeal` scales the squeal layer (ice hisses, mud swallows everything).
   * `rate` is the noise playback rate — a cheap grain-size control.
   */
  SURFACES: {
    TARMAC: { hz: 900, q: 0.8, gain: 0.3, squeal: 1.0, rate: 1.0 },
    DIRT: { hz: 1500, q: 0.55, gain: 0.55, squeal: 0.45, rate: 1.15 }, // brighter, louder: gravel spray
    GRASS: { hz: 700, q: 0.7, gain: 0.4, squeal: 0.2, rate: 0.9 }, // soft brush
    MUD: { hz: 380, q: 0.9, gain: 0.5, squeal: 0.1, rate: 0.8 }, // thick, dark, no squeal
    ICE: { hz: 3200, q: 0.45, gain: 0.16, squeal: 0.7, rate: 1.25 }, // quiet + hissy, and it *does* sing
    VOID: { hz: 200, q: 4.0, gain: 0.08, squeal: 0.0, rate: 0.5 }, // out of bounds: almost nothing
  },
  /** Used when the game reports a surface we don't know about. */
  DEFAULT_SURFACE: 'TARMAC',

  // -------------------------------------------------------------------------
  // ONE-SHOTS
  // -------------------------------------------------------------------------
  COLLISION: {
    /** Impacts below this intensity are ignored — stops kerb-rubbing chatter. */
    minIntensity: 0.06,
    /** Master gain at intensity 1. */
    gain: 0.9,
    /** Noise crunch. */
    noiseRelease: 0.26, // s at intensity 1
    noiseCutoffMinHz: 700, // light taps are dull...
    noiseCutoffMaxHz: 4200, // ...big hits are bright
    /** Low thud: a triangle sliding down. This is the "weight" of the hit. */
    thudFromHz: 130,
    thudToHz: 44,
    thudRelease: 0.3,
    thudGain: 0.75,
    /** Metallic ring — two resonant bands. Only above `ringAt` intensity. */
    ringAt: 0.35,
    ringHzA: 1450,
    ringHzB: 2730,
    ringQ: 14,
    ringGain: 0.28,
    ringRelease: 0.5,
    /** Minimum seconds between impacts. Physics reports collisions in bursts. */
    retriggerSec: 0.07,
  },

  COUNTDOWN: {
    /** "3, 2, 1" tone and the higher "GO". */
    hz: 620,
    finalHz: 940,
    wave: 'square', // square, because 1997
    dur: 0.14, // s
    finalDur: 0.42,
    gain: 0.4,
    /** Slight lowpass so the square doesn't shred. */
    cutoffHz: 2600,
  },

  UI: {
    /** Each blip: frequency (or two, for a slide), wave, length, gain. */
    blips: {
      move: { hz: 1180, hz2: 0, wave: 'square', dur: 0.045, gain: 0.16, cutoffHz: 4000 },
      confirm: { hz: 700, hz2: 1050, wave: 'square', dur: 0.11, gain: 0.24, cutoffHz: 4000 },
      back: { hz: 780, hz2: 470, wave: 'square', dur: 0.1, gain: 0.2, cutoffHz: 3000 },
      /** Detuned pair + low cutoff = sour and cheap. */
      error: { hz: 190, hz2: 178, wave: 'sawtooth', dur: 0.22, gain: 0.28, cutoffHz: 1200 },
    },
  },

  CHECKPOINT: {
    /** Two quick rising blips. Cheerful but not congratulatory. */
    hzA: 880,
    hzB: 1320,
    gapSec: 0.075,
    dur: 0.1,
    gain: 0.3,
    wave: 'square',
  },

  HORN: {
    /** Real horns are two tones a little apart; the beating IS the sound. */
    hzA: 415,
    hzB: 500,
    wave: 'square',
    cutoffHz: 3000,
    q: 1.2,
    drive: 0.5,
    gain: 0.32,
    attackSec: 0.02,
    releaseSec: 0.09,
    /** Safety: a held horn auto-releases after this many seconds. */
    maxHoldSec: 6,
  },

  // -------------------------------------------------------------------------
  // SIREN
  // -------------------------------------------------------------------------
  // A wail: one oscillator whose frequency is swept by a slow LFO, plus a
  // detuned partner for body, plus a delayed+muffled copy standing in for the
  // reflection off the trees. Distance drives a lowpass (air eats treble first)
  // and the gain. That relationship is the whole feeling of being chased: you
  // hear them get *brighter* before you can tell they're louder.
  SIREN: {
    maxConcurrent: 4,
    wave: 'sawtooth',
    /** Wail endpoints, Hz. */
    lowHz: 640,
    highHz: 1180,
    /** Sweep rate, Hz (cycles per second of the wail itself). ~0.35 = classic. */
    lfoHz: 0.36,
    /** 'sine' = smooth wail, 'triangle' = more linear, 'square' = two-tone. */
    lfoWave: 'triangle',
    /** Second oscillator, cents off. Nonzero = that ugly beating edge. */
    detuneCents: 14,
    detuneGain: 0.45,
    /** Bandpass on the direct sound — narrows it into "speaker on a roof". */
    bodyHz: 1400,
    bodyQ: 1.1,
    /** Lowpass cutoff at 0 m and at maxDistance, Hz. Air absorption. */
    nearCutoffHz: 9000,
    farCutoffHz: 700,
    /** Reflection: delayed, heavily filtered copy. Sells "outdoors at night". */
    reflectionDelaySec: 0.13,
    reflectionCutoffHz: 900,
    reflectionGain: 0.35,
    gain: 0.5,
    /** Fade in/out so sirens arrive and leave rather than snapping. */
    fadeInSec: 0.5,
    fadeOutSec: 0.6,
    /** Doppler-ish: slight pitch offset from closing distance. 0 disables. */
    approachDetuneCents: 0,
  },

  // -------------------------------------------------------------------------
  // GLITCH — the simulation noticing itself
  // -------------------------------------------------------------------------
  GLITCH: {
    gain: 0.55,
    /** Follow time for setGlitch(), seconds. Slow enough to feel like dread. */
    glideSec: 0.25,
    /** Seconds at zero before the bed is torn down (saves CPU when calm). */
    idleTeardownSec: 2.0,

    /** Sample-and-hold noise: a DAC failing. Rate scales with amount. */
    holdSamples: 26, // buffer generation: samples held per step
    noiseRateMin: 0.18,
    noiseRateMax: 1.5,
    noiseHighpassHz: 220,
    noiseGain: 0.4,
    /** Amplitude quantisation levels. Fewer = more broken. */
    crushLevels: 6,

    /** Detuned drone cluster: three saws that disagree more as things worsen. */
    droneMidi: 26, // D1
    droneVoices: 3,
    droneSpreadMinCents: 3,
    droneSpreadMaxCents: 64, // full corruption: no longer a chord, a smear
    droneCutoffMinHz: 240,
    droneCutoffMaxHz: 2800,
    droneGain: 0.3,

    /** Ring modulation: multiplies the drone by a bare oscillator. Inharmonic. */
    ringHzMin: 34,
    ringHzMax: 310,
    ringMix: 0.6,

    /** Stutter gate: square LFO chopping the whole bed. */
    gateHzMin: 0.6,
    gateHzMax: 15,
    gateDepth: 0.85, // at amount 1

    /** One-shot "it saw you" stinger. */
    stinger: {
      gain: 0.7,
      dur: 0.5, // s
      sweepFromHz: 3200, // bandpass sweeping down = something powering off
      sweepToHz: 140,
      q: 6,
      toneFromHz: 900,
      toneToHz: 70,
      toneGain: 0.5,
      ringHz: 190,
      crushLevels: 4,
    },
  },

  // -------------------------------------------------------------------------
  // AMBIENCE
  // -------------------------------------------------------------------------
  // Each bed = optional wind (filtered noise with a slow gust LFO) + optional
  // drone + sparse randomised events scheduled off the AudioContext clock.
  AMBIENCE: {
    /** Crossfade between beds, seconds. */
    fadeSec: 1.6,
    /** Cap on events scheduled per scheduler tick — runaway guard. */
    maxEventsPerTick: 4,

    forest: {
      wind: { gain: 0.3, cutoffHz: 520, q: 0.5, gustHz: 0.07, gustDepthHz: 300, rate: 0.7 },
      drone: null,
      /** Birds: 2–4 chirps, each a fast up-down sweep. Rare enough to notice. */
      event: {
        kind: 'bird',
        minGapSec: 2.2,
        maxGapSec: 9.0,
        gain: 0.17,
        minHz: 2100,
        maxHz: 4200,
        chirpsMin: 2,
        chirpsMax: 4,
        chirpSec: 0.055,
        chirpGapSec: 0.075,
      },
    },

    /** Outside the sanctioned world: colder, wider, and nothing lives here. */
    outside: {
      wind: { gain: 0.38, cutoffHz: 330, q: 0.4, gustHz: 0.045, gustDepthHz: 200, rate: 0.55 },
      drone: { midi: 31, voices: 2, spreadCents: 6, cutoffHz: 260, gain: 0.12 }, // G1
      event: {
        kind: 'swell',
        minGapSec: 9,
        maxGapSec: 24,
        gain: 0.1,
        minHz: 90,
        maxHz: 220,
        chirpSec: 3.2,
      },
    },

    /** Night: crickets on a rhythm, and something humming underneath. */
    night: {
      wind: { gain: 0.16, cutoffHz: 240, q: 0.5, gustHz: 0.05, gustDepthHz: 120, rate: 0.5 },
      drone: { midi: 24, voices: 3, spreadCents: 9, cutoffHz: 180, gain: 0.16 }, // C1
      event: {
        kind: 'cricket',
        minGapSec: 0.7,
        maxGapSec: 2.6,
        gain: 0.09,
        minHz: 4200,
        maxHz: 5400,
        chirpsMin: 3,
        chirpsMax: 5,
        chirpSec: 0.012,
        chirpGapSec: 0.035,
        q: 26, // very resonant: noise becomes an insect
      },
    },
  },

  // -------------------------------------------------------------------------
  // MUSIC
  // -------------------------------------------------------------------------
  // A step sequencer on a lookahead scheduler. setInterval wakes up often and
  // schedules notes slightly ahead against ctx.currentTime — this is the only
  // way to get stable timing in a browser. NEVER schedule notes from rAF: a
  // dropped frame becomes a dropped beat.
  //
  // Patterns are arrays of semitone offsets from `root` (MIDI), or null for a
  // rest. Voices index their pattern independently (`step % pattern.length`),
  // so different lengths give you free polymeter.
  MUSIC: {
    /** Scheduler wake-up interval, ms. */
    schedulerMs: 25,
    /** How far ahead of ctx.currentTime notes are scheduled, seconds. */
    lookaheadSec: 0.12,
    /** Crossfade when switching tracks, seconds. */
    fadeSec: 1.1,

    tracks: {
      /** Title screen. Patient, minor, a bit too still. */
      menu: {
        bpm: 68,
        stepsPerBeat: 2, // 8th notes
        steps: 16,
        root: 45, // A2
        voices: {
          pad: {
            wave: 'sawtooth', octave: -1, detuneCents: 9, gain: 0.2,
            attack: 1.4, hold: 2.2, release: 2.4, cutoffHz: 620, q: 0.8,
            pattern: [0, null, null, null, null, null, null, null, 7, null, null, null, null, null, null, null],
          },
          bass: {
            wave: 'square', octave: -2, detuneCents: 0, gain: 0.16,
            attack: 0.006, hold: 0.1, release: 0.5, cutoffHz: 380, q: 2.0,
            pattern: [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, 5, null],
          },
          lead: {
            wave: 'triangle', octave: 1, detuneCents: 0, gain: 0.13,
            attack: 0.01, hold: 0.04, release: 0.85, cutoffHz: 2400, q: 1.0,
            pattern: [null, null, 12, null, null, null, null, 15, null, null, null, null, 19, null, null, 12],
          },
        },
      },

      /** Racing. Forward motion, no melody to speak of. */
      race: {
        bpm: 132,
        stepsPerBeat: 4, // 16ths
        steps: 16,
        root: 38, // D2
        voices: {
          bass: {
            wave: 'sawtooth', octave: -1, detuneCents: 6, gain: 0.2,
            attack: 0.004, hold: 0.03, release: 0.13, cutoffHz: 520, q: 3.0,
            pattern: [0, null, 0, null, 0, null, 3, null, 0, null, 0, null, 5, null, 3, null],
          },
          perc: {
            wave: 'noise', octave: 0, gain: 0.1,
            attack: 0.001, hold: 0.0, release: 0.05, cutoffHz: 5200, q: 1.4,
            pattern: [null, null, 0, null, null, null, 0, null, null, null, 0, null, null, 7, 0, null],
          },
          pad: {
            wave: 'sawtooth', octave: 0, detuneCents: 11, gain: 0.09,
            attack: 0.6, hold: 1.1, release: 1.4, cutoffHz: 900, q: 0.9,
            pattern: [10, null, null, null, null, null, null, null, 8, null, null, null, null, null, null, null],
          },
        },
      },

      /** The chase. Faster, a semitone rubbing against itself. */
      chase: {
        bpm: 152,
        stepsPerBeat: 4,
        steps: 16,
        root: 37, // C#2
        voices: {
          bass: {
            wave: 'square', octave: -1, detuneCents: 0, gain: 0.22,
            attack: 0.003, hold: 0.02, release: 0.1, cutoffHz: 640, q: 4.0,
            pattern: [0, 0, null, 0, null, 0, 0, null, 1, null, 0, null, 0, 0, null, 11],
          },
          stab: {
            wave: 'sawtooth', octave: 1, detuneCents: 18, gain: 0.11,
            attack: 0.004, hold: 0.02, release: 0.22, cutoffHz: 1800, q: 5.0,
            // 13 steps against 16: the two never line up, which is the point.
            pattern: [0, null, null, 1, null, null, null, 0, null, null, 6, null, null],
          },
          perc: {
            wave: 'noise', octave: 0, gain: 0.12,
            attack: 0.001, hold: 0.0, release: 0.04, cutoffHz: 6400, q: 1.2,
            pattern: [0, null, 0, 0, null, 0, null, 0, 0, null, 0, null, 0, 0, null, 0],
          },
        },
      },

      /** After. Almost nothing — just enough to prove the world still runs. */
      alone: {
        bpm: 48,
        stepsPerBeat: 1, // quarter notes
        steps: 8,
        root: 41, // F2
        voices: {
          pad: {
            wave: 'sawtooth', octave: -1, detuneCents: 5, gain: 0.18,
            attack: 2.6, hold: 3.0, release: 3.4, cutoffHz: 420, q: 0.7,
            pattern: [0, null, null, null, null, null, null, null],
          },
          lead: {
            wave: 'sine', octave: 1, detuneCents: 0, gain: 0.1,
            attack: 0.05, hold: 0.2, release: 2.0, cutoffHz: 1800, q: 0.8,
            pattern: [null, null, null, 7, null, null, null, null, null, 12, null],
          },
        },
      },
    },
  },

  /** Ducking: how far music+ambience drop under dialogue and stingers. */
  DUCK: {
    /** Attenuation at setDucking(1). 0.75 = down to 25% of normal. */
    maxAttenuation: 0.75,
    /** Follow time, seconds. Fast down, slow up would be nicer; this is fine. */
    glideSec: 0.18,
  },
};

// ===========================================================================
// AudioEngine
// ===========================================================================

export class AudioEngine {
  /**
   * The constructor MUST NOT touch WebAudio. The module is imported at page
   * load (and by tooling, and by plain Node), long before any user gesture.
   * Everything real happens in init().
   */
  constructor() {
    /** @type {AudioContext|null} */
    this._ctx = null;
    this._failed = false; // WebAudio unavailable or init threw
    this._disposed = false;

    // Mix state
    this._volume = AUDIO_CONFIG.MASTER.volume;
    this._muted = AUDIO_CONFIG.MASTER.muted;
    this._duck = 0;

    // Graph handles, all created in init()
    this._master = null;
    this._limiter = null;
    this._duckBus = null;
    this._bus = /** @type {Record<string, GainNode|null>} */ ({});
    this._buffers = null;
    this._curves = null;

    // Sub-systems
    this._eng = null; // engine oscillator cluster
    this._road = null; // tyre / wind / squeal cluster
    this._engineWanted = false;
    this._horn = null;
    this._glitch = null;
    this._glitchAmount = 0;

    /** @type {Map<string, object>} */
    this._sirens = new Map();

    // Ambience + music are *desires*; they realise once the context is running.
    this._ambienceName = 'none';
    this._amb = null;
    this._ambNextEvent = 0;
    this._musicName = 'none';
    this._music = null;
    this._schedTimer = null;

    this._voices = new VoicePool(AUDIO_CONFIG.VOICES.maxOneShots);
    this._musicVoices = new VoicePool(AUDIO_CONFIG.VOICES.maxMusicVoices);
    this._ambVoices = new VoicePool(AUDIO_CONFIG.VOICES.maxAmbienceVoices);
    this._rng = makeRng(0xc0ffee);
    this._listener = { x: 0, y: 0, z: 0, forwardX: 0, forwardZ: -1 };
    this._lastCollisionAt = -1e9;
    this._unsubs = [];
    this._warned = new Set();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Build the AudioContext and the master graph. Idempotent — call it from
   * wherever is convenient (boot, first mode, a settings screen). If WebAudio
   * is unavailable this quietly marks the engine as failed and every other
   * method becomes a no-op.
   *
   * This is also the way *back* from `dispose()`. A disposed engine is torn
   * down, not dead. That distinction matters because `audio` is a module
   * singleton shared by every Game in the page: when the latch was permanent,
   * one teardown silenced the rest of the session with no way to recover, and
   * the symptom — sound that goes and never comes back — looks exactly like a
   * browser autoplay problem, which sends you hunting in the wrong place.
   *
   * Note `_failed` is NOT cleared here: WebAudio being unavailable is a fact
   * about the browser, not a state we tore down.
   */
  init() {
    if (this._ctx || this._failed) return this;
    // Whatever dispose() released, we are building it again.
    this._disposed = false;

    const Ctor = pickAudioContextCtor();
    if (!Ctor) {
      this._failed = true;
      return this;
    }

    try {
      const ctx = new Ctor();
      this._ctx = ctx;

      const L = AUDIO_CONFIG.MASTER.limiter;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = L.threshold;
      limiter.knee.value = L.knee;
      limiter.ratio.value = L.ratio;
      limiter.attack.value = L.attack;
      limiter.release.value = L.release;
      this._limiter = limiter;

      this._master = makeGain(ctx, this._muted ? 0 : this._volume);
      chain(this._master, limiter, ctx.destination);

      // Music + ambience sit behind the duck bus; sfx/engine/sirens do not,
      // because ducking the crash you just caused is exactly wrong.
      this._duckBus = makeGain(ctx, 1);
      this._duckBus.connect(this._master);

      const bv = AUDIO_CONFIG.MASTER.busVolumes;
      const mk = (vol, parent) => {
        const g = makeGain(ctx, vol);
        g.connect(parent);
        return g;
      };
      this._bus = {
        engine: mk(bv.engine, this._master),
        tyres: mk(bv.tyres, this._master),
        sfx: mk(bv.sfx, this._master),
        siren: mk(bv.siren, this._master),
        glitch: mk(bv.glitch, this._master),
        music: mk(bv.music, this._duckBus),
        ambience: mk(bv.ambience, this._duckBus),
      };

      // Shared noise sources. Generated once; every noise voice in the game
      // reads from these three buffers.
      this._buffers = {
        white: makeNoiseBuffer(ctx, 3.1, 'white', { seed: 0x51ed }),
        pink: makeNoiseBuffer(ctx, 4.3, 'pink', { seed: 0x9a11 }),
        hold: makeNoiseBuffer(ctx, 2.7, 'sampleHold', {
          seed: 0x1337,
          holdSamples: AUDIO_CONFIG.GLITCH.holdSamples,
        }),
      };
      this._curves = {
        engineDrive: makeSoftClipCurve(AUDIO_CONFIG.ENGINE.drive),
        hornDrive: makeSoftClipCurve(AUDIO_CONFIG.HORN.drive),
        crush: makeBitcrushCurve(AUDIO_CONFIG.GLITCH.crushLevels),
        crushHard: makeBitcrushCurve(AUDIO_CONFIG.GLITCH.stinger.crushLevels),
      };

      // Some browsers suspend on tab-hide and resume on return; re-realising
      // deferred state here means the game comes back with its music intact.
      ctx.onstatechange = () => {
        if (this._ctx && this._ctx.state === 'running') this._realiseDesiredState();
      };

      this._subscribe();

      // If the context was born running (already-unlocked page), honour any
      // state the game set before init.
      if (ctx.state === 'running') this._realiseDesiredState();
    } catch (err) {
      console.warn('[audio] init failed, running silent:', err);
      this._failed = true;
      this._ctx = null;
    }
    return this;
  }

  /**
   * Resume after a user gesture. Wire this to the first pointerdown/keydown.
   * Always returns a Promise and never rejects — a game should not care.
   */
  unlock() {
    // No `_disposed` guard: init() below is what lifts it. A gesture arriving
    // after a teardown should bring the sound back, not be refused.
    if (!this._ctx && !this._failed) this.init();
    const ctx = this._ctx;
    if (!ctx) return Promise.resolve(false);

    const finish = () => {
      // iOS in particular only truly wakes after something has been *played*,
      // so push one silent sample through the graph.
      try {
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination);
        s.start(0);
        s.onended = () => safeDisconnect(s);
      } catch {
        /* not fatal */
      }
      this._realiseDesiredState();
      return ctx.state === 'running';
    };

    try {
      if (ctx.state === 'running') return Promise.resolve(finish());
      return Promise.resolve(ctx.resume()).then(finish, (err) => {
        console.warn('[audio] resume rejected:', err);
        return false;
      });
    } catch (err) {
      console.warn('[audio] unlock failed:', err);
      return Promise.resolve(false);
    }
  }

  /**
   * Release the context and every node hanging off it. Reversible: `init()`
   * builds a fresh graph and `unlock()` calls `init()` for you, so a later
   * Game — or a later gesture — gets working sound back.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    for (const off of this._unsubs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this._unsubs.length = 0;

    this._stopScheduler();
    try {
      this.stopAllSirens();
      this._teardownEngine(0);
      this._teardownGlitch(0);
      this._teardownAmbience(0);
      this._teardownMusic(0);
      this.playHorn(false);
    } catch {
      /* best effort */
    }

    const ctx = this._ctx;
    this._ctx = null;
    this._master = null;
    this._bus = {};
    this._buffers = null;
    if (ctx) {
      try {
        ctx.onstatechange = null;
        ctx.close();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * True once init() has built a working graph. Note this can be true while
   * the context is still suspended — sound only actually leaves the building
   * after `unlock()`. Methods gate themselves, so callers rarely need this.
   */
  get ready() {
    return !!this._ctx && !this._failed && !this._disposed && this._ctx.state !== 'closed';
  }

  /** Internal gate: is the graph actually able to make noise *right now*? */
  get _live() {
    return this.ready && this._ctx.state === 'running';
  }

  get _now() {
    return this._ctx ? this._ctx.currentTime : 0;
  }

  // -------------------------------------------------------------------------
  // Mix
  // -------------------------------------------------------------------------

  setMasterVolume(v) {
    this._volume = clamp01(v);
    this._applyMasterGain();
  }

  setMuted(muted) {
    this._muted = !!muted;
    this._applyMasterGain();
  }

  _applyMasterGain() {
    if (!this._master) return;
    ramp(this._master.gain, this._muted ? 0 : this._volume, this._now, AUDIO_CONFIG.MASTER.volumeGlideSec);
  }

  /**
   * Scale one mix layer, relative to its `MASTER.busVolumes` balance.
   * A settings menu changes this; the mix itself stays in AUDIO_CONFIG.
   * @param {'engine'|'tyres'|'sfx'|'siren'|'music'|'ambience'|'glitch'} name
   * @param {number} scale 0..1 (values above 1 are allowed but will clip sooner)
   */
  setBusVolume(name, scale) {
    this._busScale = this._busScale || {};
    this._busScale[name] = scale;
    const base = AUDIO_CONFIG.MASTER.busVolumes[name];
    const node = this._bus?.[name];
    // `_live` and `_now` are getters, not methods.
    if (base === undefined || !node || !this._live) return;
    node.gain.setTargetAtTime(
      Math.max(0, base * scale),
      this._now,
      AUDIO_CONFIG.MASTER.volumeGlideSec
    );
  }

  /** Current scale for a layer, 1 if never set. */
  getBusVolume(name) {
    return this._busScale?.[name] ?? 1;
  }

  setDucking(amount01) {
    this._duck = clamp01(amount01);
    if (!this._duckBus) return;
    const target = 1 - this._duck * AUDIO_CONFIG.DUCK.maxAttenuation;
    glide(this._duckBus.gain, target, AUDIO_CONFIG.DUCK.glideSec, this._now);
  }

  /**
   * Where the ears are. Call once per frame with the camera (not the car —
   * you hear what the camera hears). Only used to derive pan/distance for
   * sources given in world space; sirens fed explicit {distance, pan} ignore it.
   */
  setListener({ x, y, z, forwardX, forwardZ } = {}) {
    const l = this._listener;
    l.x = num(x, l.x);
    l.y = num(y, l.y);
    l.z = num(z, l.z);
    l.forwardX = num(forwardX, l.forwardX);
    l.forwardZ = num(forwardZ, l.forwardZ);
  }

  // -------------------------------------------------------------------------
  // Engine + road noise
  // -------------------------------------------------------------------------

  /**
   * Start the continuous engine + tyre/wind layer. Idempotent. Safe before
   * unlock: the intent is remembered and the engine starts on resume.
   */
  startEngine() {
    this._engineWanted = true;
    if (!this._live || this._eng) return;
    try {
      this._buildEngine();
      this._buildRoad();
    } catch (err) {
      console.warn('[audio] engine build failed:', err);
      this._teardownEngine(0);
    }
  }

  /** Fade the engine out and free its nodes. */
  stopEngine() {
    this._engineWanted = false;
    this._teardownEngine(AUDIO_CONFIG.ENGINE.stopFadeSec);
  }

  /**
   * Per-frame engine drive. Cheap by design — no allocation, just parameter
   * follows. Everything is clamped, so a NaN out of the physics can't take the
   * audio thread with it.
   *
   * @param {object} s
   * @param {number} s.rpm01   0..1 normalised engine speed
   * @param {number} s.load    0..1 throttle / how hard it's working
   * @param {number} s.speed   m/s, drives wind + tyre volume
   * @param {string} s.surface key into AUDIO_CONFIG.SURFACES
   * @param {number} s.slip    0..1, drives squeal
   * @param {boolean} s.airborne
   */
  updateEngine({ rpm01, load, speed, surface, slip, airborne } = {}) {
    if (!this._live || !this._eng) return;
    const E = AUDIO_CONFIG.ENGINE;
    const now = this._now;

    const rpm = clamp01(rpm01);
    const ld = clamp01(load);
    const spd = Math.max(0, num(speed, 0));
    const sl = clamp01(slip);
    const air = !!airborne;

    // --- pitch -------------------------------------------------------------
    const fire = lerp(E.idleHz, E.maxHz, Math.pow(rpm, E.rpmCurve));
    const eng = this._eng;
    for (let i = 0; i < eng.oscs.length; i++) {
      glide(eng.oscs[i].frequency, fire * eng.muls[i], E.pitchGlideSec, now, 0.05);
    }
    if (eng.sub) glide(eng.sub.frequency, fire * 0.5, E.pitchGlideSec, now, 0.05);
    glide(eng.pulseLfo.frequency, fire * E.pulseRatio, E.pitchGlideSec, now, 0.05);

    // --- timbre ------------------------------------------------------------
    // Cutoff tracks throttle far more than revs: that's the difference between
    // "revving" and "pulling". Airborne opens it up — no load on the engine.
    let cutoff = E.cutoffBaseHz + ld * E.cutoffPerLoadHz + rpm * E.cutoffPerRpmHz;
    if (air) cutoff *= E.airborneCutoffBoost;
    glide(eng.filter.frequency, Math.min(cutoff, 18000), E.cutoffGlideSec, now, 1);
    glide(eng.gritGain.gain, ld * E.gritGain, E.cutoffGlideSec, now);

    let gain = E.gainIdle + ld * E.gainPerLoad + rpm * E.gainPerRpm;
    if (air) gain *= E.airborneGain;
    glide(eng.gain.gain, gain, E.gainGlideSec, now);

    // --- road --------------------------------------------------------------
    const road = this._road;
    if (!road) return;
    const T = AUDIO_CONFIG.TYRES;
    const surf = AUDIO_CONFIG.SURFACES[surface] || AUDIO_CONFIG.SURFACES[AUDIO_CONFIG.DEFAULT_SURFACE];

    // Contact noise dies instantly in the air — nothing is touching the ground.
    const contact = air ? 0 : 1;
    const speedMix = clamp(spd / T.fullVolumeSpeed, 0, 1.15);

    glide(road.surfFilter.frequency, surf.hz, T.glideSec, now, 1);
    glide(road.surfFilter.Q, surf.q, T.glideSec, now, 0.01);
    glide(road.surfGain.gain, surf.gain * speedMix * contact, T.glideSec, now);
    glide(road.surfNoise.playbackRate, surf.rate * T.noiseRate, T.glideSec, now, 0.005);

    const W = T.wind;
    const windAmt = Math.pow(clamp(spd / W.refSpeed, 0, 1.6), W.curve) * W.gain;
    glide(road.windGain.gain, windAmt, T.glideSec, now);
    glide(road.windFilter.frequency, Math.min(W.cutoffBaseHz + spd * W.cutoffPerSpeedHz, 16000), T.glideSec, now, 1);

    const S = T.squeal;
    const slipAmt = sl <= S.threshold ? 0 : Math.pow((sl - S.threshold) / (1 - S.threshold), S.curve);
    const squealGate = clamp(spd / S.minSpeed, 0, 1) * contact * surf.squeal;
    glide(road.squealGain.gain, slipAmt * squealGate * S.gain, T.glideSec, now);
    glide(road.squealFilter.frequency, lerp(S.minHz, S.maxHz, slipAmt), T.glideSec, now, 1);
    glide(road.squealFilter.Q, lerp(S.minQ, S.maxQ, slipAmt), T.glideSec, now, 0.05);
  }

  _buildEngine() {
    const ctx = this._ctx;
    const E = AUDIO_CONFIG.ENGINE;
    const now = this._now;

    const out = makeGain(ctx, 0.0001);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._curves.engineDrive;
    const filter = makeFilter(ctx, 'lowpass', E.cutoffBaseHz, E.cutoffQ);

    // AM stage. gain.value is the DC centre; the LFO sums onto it, so the
    // signal is multiplied by (1 - d/2 ± d/2) — a periodic dip per cylinder.
    const pulse = makeGain(ctx, 1 - E.pulseDepth / 2);
    const pulseLfo = makeOsc(ctx, 'sawtooth', E.idleHz * E.pulseRatio);
    const pulseDepth = makeGain(ctx, E.pulseDepth / 2);
    chain(pulseLfo, pulseDepth);
    pulseDepth.connect(pulse.gain);

    const mix = makeGain(ctx, 1);
    chain(mix, pulse, filter, shaper, out);
    out.connect(this._bus.engine);

    const oscs = [];
    const muls = [];
    const sources = [pulseLfo];
    for (const cfg of E.oscillators) {
      const o = makeOsc(ctx, cfg.wave, E.idleHz * cfg.mul, cfg.detuneCents);
      const g = makeGain(ctx, cfg.gain);
      chain(o, g, mix);
      oscs.push(o);
      muls.push(cfg.mul);
      sources.push(o);
    }

    let sub = null;
    if (E.subGain > 0) {
      sub = makeOsc(ctx, 'triangle', E.idleHz * 0.5);
      const sg = makeGain(ctx, E.subGain);
      chain(sub, sg, mix);
      sources.push(sub);
    }

    // Combustion grit — bandpassed noise under the tone. Without it the engine
    // is too "clean synth"; with it, it sounds like it's burning something.
    const gritNoise = makeNoiseSource(ctx, this._buffers.white, 1.0);
    const gritBand = makeFilter(ctx, 'bandpass', E.gritHz, E.gritQ);
    const gritGain = makeGain(ctx, 0);
    chain(gritNoise, gritBand, gritGain, mix);
    sources.push(gritNoise);

    for (const s of sources) {
      try {
        s.start(now);
      } catch {
        /* ignore */
      }
    }
    // Fade in with the same automation type updateEngine() uses (setTarget).
    // Mixing a linear ramp here with per-frame setTargetAtTime calls would give
    // the timeline two overlapping event types fighting over the same param.
    glide(out.gain, E.gainIdle, E.startFadeSec / 3, now);

    this._eng = { out, gain: out, shaper, filter, pulse, pulseLfo, pulseDepth, mix, oscs, muls, sub, gritGain, gritBand, gritNoise, sources };
  }

  _buildRoad() {
    const ctx = this._ctx;
    const T = AUDIO_CONFIG.TYRES;
    const now = this._now;
    const surf = AUDIO_CONFIG.SURFACES[AUDIO_CONFIG.DEFAULT_SURFACE];

    // Three branches read the same buffer at different rates — same source
    // material, but decorrelated enough that they don't comb-filter each other.
    const surfNoise = makeNoiseSource(ctx, this._buffers.white, T.noiseRate);
    const surfFilter = makeFilter(ctx, 'bandpass', surf.hz, surf.q);
    const surfGain = makeGain(ctx, 0);
    chain(surfNoise, surfFilter, surfGain, this._bus.tyres);

    const windNoise = makeNoiseSource(ctx, this._buffers.pink, T.wind.rate);
    const windFilter = makeFilter(ctx, 'lowpass', T.wind.cutoffBaseHz, T.wind.q);
    const windGain = makeGain(ctx, 0);
    chain(windNoise, windFilter, windGain, this._bus.tyres);

    const squealNoise = makeNoiseSource(ctx, this._buffers.white, T.squeal.noiseRate);
    const squealFilter = makeFilter(ctx, 'bandpass', T.squeal.minHz, T.squeal.minQ);
    const squealGain = makeGain(ctx, 0);
    chain(squealNoise, squealFilter, squealGain, this._bus.tyres);

    // A little vibrato on the squeal's centre frequency. A perfectly steady
    // resonant band reads as a synth tone; wobbling it reads as rubber.
    const wobble = makeLfo(ctx, {
      hz: T.squeal.wobbleHz,
      depth: T.squeal.wobbleDepthHz,
      type: 'sine',
    });
    wobble.out.connect(squealFilter.frequency);

    const sources = [surfNoise, windNoise, squealNoise, wobble.osc];
    for (const s of sources) {
      try {
        s.start(now);
      } catch {
        /* ignore */
      }
    }

    this._road = { surfNoise, surfFilter, surfGain, windNoise, windFilter, windGain, squealNoise, squealFilter, squealGain, wobble, sources };
  }

  _teardownEngine(fadeSec = 0.2) {
    const eng = this._eng;
    const road = this._road;
    this._eng = null;
    this._road = null;
    if (!eng && !road) return;
    const now = this._now;
    const fade = Math.max(0, fadeSec);

    const kill = (cluster, gains) => {
      if (!cluster) return;
      for (const g of gains) if (g) ramp(g.gain, 0.0001, now, Math.max(0.01, fade));
      const stopAt = now + fade + 0.02;
      for (const s of cluster.sources) {
        s.onended = null;
        safeStop(s, stopAt);
      }
      // Disconnect a beat after the stop so the fade is actually heard.
      const cleanup = () => {
        for (const s of cluster.sources) safeDisconnect(s);
        for (const k of Object.keys(cluster)) {
          const n = cluster[k];
          if (n && typeof n.disconnect === 'function') safeDisconnect(n);
          if (n && n.out && typeof n.out.disconnect === 'function') safeDisconnect(n.out);
        }
      };
      if (fade <= 0) cleanup();
      else setTimeout(cleanup, (fade + 0.1) * 1000);
    };

    kill(eng, eng ? [eng.out] : []);
    kill(road, road ? [road.surfGain, road.windGain, road.squealGain] : []);
  }

  // -------------------------------------------------------------------------
  // One-shots
  // -------------------------------------------------------------------------

  /**
   * Impact. `intensity01` should be normalised impulse — 0.1 is a kerb, 1.0 is
   * a tree at full speed. Built from three layers because a single noise burst
   * reads as "static", not "crash": crunch (noise) + weight (falling thud) +
   * ring (resonant metal) with the ring only appearing on real hits.
   */
  playCollision(intensity01) {
    if (!this._live) return;
    const C = AUDIO_CONFIG.COLLISION;
    const i = clamp01(intensity01);
    if (i < C.minIntensity) return;

    const now = this._now;
    if (now - this._lastCollisionAt < C.retriggerSec) return; // physics burst guard
    this._lastCollisionAt = now;
    if (!this._voices.take()) return;

    try {
      const ctx = this._ctx;
      const out = makeGain(ctx, C.gain * lerp(0.35, 1, i));
      out.connect(this._bus.sfx);

      const sources = [];
      const nodes = [out];

      // 1. Crunch.
      const noise = makeNoiseSource(ctx, this._buffers.white, lerp(0.7, 1.25, i), false);
      const nf = makeFilter(ctx, 'lowpass', lerp(C.noiseCutoffMinHz, C.noiseCutoffMaxHz, i), 0.9);
      const ng = makeGain(ctx, 0.0001);
      chain(noise, nf, ng, out);
      const nRel = C.noiseRelease * lerp(0.45, 1, i);
      envAD(ng.gain, now, { peak: 1, attack: 0.002, hold: 0.005, release: nRel });
      sources.push(noise);
      nodes.push(nf, ng);

      // 2. Thud — pitch falling fast is what the body reads as "mass".
      const thud = makeOsc(ctx, 'triangle', C.thudFromHz * lerp(0.8, 1.15, i));
      const tg = makeGain(ctx, 0.0001);
      chain(thud, tg, out);
      const tRel = C.thudRelease * lerp(0.5, 1, i);
      try {
        thud.frequency.setValueAtTime(C.thudFromHz * lerp(0.8, 1.15, i), now);
        thud.frequency.exponentialRampToValueAtTime(C.thudToHz, now + tRel);
      } catch {
        /* ignore */
      }
      envAD(tg.gain, now, { peak: C.thudGain, attack: 0.003, hold: 0.01, release: tRel });
      sources.push(thud);
      nodes.push(tg);

      // 3. Metal ring, big hits only.
      let ringRel = 0;
      if (i >= C.ringAt) {
        ringRel = C.ringRelease * i;
        const rNoise = makeNoiseSource(ctx, this._buffers.white, 1.0, false);
        const rg = makeGain(ctx, 0.0001);
        const a = makeFilter(ctx, 'bandpass', C.ringHzA, C.ringQ);
        const b = makeFilter(ctx, 'bandpass', C.ringHzB, C.ringQ);
        rNoise.connect(a);
        rNoise.connect(b);
        a.connect(rg);
        b.connect(rg);
        rg.connect(out);
        envAD(rg.gain, now, { peak: C.ringGain * i, attack: 0.004, hold: 0.01, release: ringRel });
        sources.push(rNoise);
        nodes.push(a, b, rg);
      }

      const total = Math.max(nRel, tRel, ringRel) + 0.06;
      scheduleTeardown(sources, nodes, now, now + total, () => this._voices.release());
    } catch (err) {
      this._voices.release();
      this._warnOnce('collision', err);
    }
  }

  /** Countdown pip. `final === true` gives the higher, longer "GO" tone. */
  playCountdownBeep(final = false) {
    const C = AUDIO_CONFIG.COUNTDOWN;
    this._blip({
      hz: final ? C.finalHz : C.hz,
      wave: C.wave,
      dur: final ? C.finalDur : C.dur,
      gain: C.gain,
      cutoffHz: C.cutoffHz,
    });
  }

  /** @param {'move'|'confirm'|'back'|'error'} kind */
  playUiBlip(kind) {
    const cfg = AUDIO_CONFIG.UI.blips[kind] || AUDIO_CONFIG.UI.blips.move;
    this._blip(cfg);
  }

  /** Checkpoint: two rising pips. Short enough to survive being spammed. */
  playCheckpoint() {
    const C = AUDIO_CONFIG.CHECKPOINT;
    this._blip({ hz: C.hzA, wave: C.wave, dur: C.dur, gain: C.gain, cutoffHz: 6000 });
    this._blip({ hz: C.hzB, wave: C.wave, dur: C.dur, gain: C.gain, cutoffHz: 8000, delay: C.gapSec });
  }

  /**
   * Generic UI/pip voice. `hz2` slides the pitch (rising = confirm, falling =
   * back); when `wave` is a saw with hz2 close to hz, the two beat against each
   * other and it reads as an error buzz.
   */
  _blip({ hz, hz2 = 0, wave = 'square', dur = 0.08, gain = 0.2, cutoffHz = 4000, delay = 0 }) {
    if (!this._live) return;
    if (!this._voices.take()) return;
    try {
      const ctx = this._ctx;
      const t0 = this._now + Math.max(0, delay);
      const out = makeGain(ctx, 0.0001);
      const filt = makeFilter(ctx, 'lowpass', cutoffHz, 0.9);
      chain(out, filt, this._bus.sfx);

      const osc = makeOsc(ctx, wave, hz);
      osc.connect(out);
      const sources = [osc];
      const nodes = [out, filt];

      if (hz2 > 0) {
        if (Math.abs(hz2 - hz) / hz < 0.25) {
          // Close interval → a second oscillator, so we get audible beating.
          const osc2 = makeOsc(ctx, wave, hz2);
          osc2.connect(out);
          sources.push(osc2);
        } else {
          // Wide interval → a slide.
          try {
            osc.frequency.setValueAtTime(hz, t0);
            osc.frequency.exponentialRampToValueAtTime(hz2, t0 + dur * 0.8);
          } catch {
            /* ignore */
          }
        }
      }

      const total = envAD(out.gain, t0, {
        peak: gain,
        attack: 0.004,
        hold: Math.max(0, dur - 0.02),
        release: Math.max(0.03, dur * 0.6),
      });
      scheduleTeardown(sources, nodes, t0, t0 + total + 0.03, () => this._voices.release());
    } catch (err) {
      this._voices.release();
      this._warnOnce('blip', err);
    }
  }

  /**
   * Horn. `down=true` on press, `false` on release. Repeated presses don't
   * stack; a horn held longer than HORN.maxHoldSec releases itself, because a
   * stuck input should never leave a tone running forever.
   */
  playHorn(down) {
    if (down) {
      if (!this._live || this._horn) return;
      try {
        const ctx = this._ctx;
        const H = AUDIO_CONFIG.HORN;
        const now = this._now;
        const out = makeGain(ctx, 0.0001);
        const shaper = ctx.createWaveShaper();
        shaper.curve = this._curves.hornDrive;
        const filt = makeFilter(ctx, 'lowpass', H.cutoffHz, H.q);
        chain(out, shaper, filt, this._bus.sfx);

        const a = makeOsc(ctx, H.wave, H.hzA);
        const b = makeOsc(ctx, H.wave, H.hzB);
        a.connect(out);
        b.connect(out);
        a.start(now);
        b.start(now);
        ramp(out.gain, H.gain, now, H.attackSec);

        const timer = setTimeout(() => this.playHorn(false), H.maxHoldSec * 1000);
        this._horn = { out, shaper, filt, oscs: [a, b], timer };
      } catch (err) {
        this._warnOnce('horn', err);
      }
      return;
    }

    const h = this._horn;
    this._horn = null;
    if (!h) return;
    clearTimeout(h.timer);
    const now = this._now;
    const rel = AUDIO_CONFIG.HORN.releaseSec;
    ramp(h.out.gain, 0.0001, now, rel);
    for (const o of h.oscs) {
      o.onended = null;
      safeStop(o, now + rel + 0.02);
    }
    setTimeout(() => {
      for (const o of h.oscs) safeDisconnect(o);
      safeDisconnect(h.out);
      safeDisconnect(h.shaper);
      safeDisconnect(h.filt);
    }, (rel + 0.1) * 1000);
  }

  // -------------------------------------------------------------------------
  // Sirens
  // -------------------------------------------------------------------------

  /**
   * Start (or re-aim) a siren.
   *
   * `opts` accepts either explicit `{ distance, pan }` or a world position
   * `{ x, y, z }` — with a position we derive distance and pan from the
   * listener set by setListener(). Mixing both is fine; explicit wins.
   */
  startSiren(id, opts = {}) {
    const key = String(id);
    let entry = this._sirens.get(key);
    if (!entry) {
      if (this._sirens.size >= AUDIO_CONFIG.SIREN.maxConcurrent) return;
      entry = { id: key, distance: 60, pan: 0, nodes: null };
      this._sirens.set(key, entry);
    }
    this._aimSiren(entry, opts);
    // If we're not live yet the entry is kept and realised on unlock.
    if (this._live && !entry.nodes) this._realiseSiren(entry);
  }

  /** Per-frame siren update. Unknown ids are ignored (call startSiren first). */
  updateSiren(id, opts = {}) {
    const entry = this._sirens.get(String(id));
    if (!entry) return;
    this._aimSiren(entry, opts);
    if (!entry.nodes) {
      if (this._live) this._realiseSiren(entry);
      return;
    }

    const S = AUDIO_CONFIG.SIREN;
    const SP = AUDIO_CONFIG.SPATIAL;
    const now = this._now;
    const g = distanceGain(entry.distance, SP.refDistance, SP.rolloff, SP.maxDistance);
    // Air absorption: treble disappears with distance long before volume does.
    const t = clamp(entry.distance / SP.maxDistance, 0, 1);
    const cutoff = lerp(S.nearCutoffHz, S.farCutoffHz, Math.pow(t, 0.5));

    glide(entry.nodes.distGain.gain, g, SP.glideSec, now);
    glide(entry.nodes.airFilter.frequency, cutoff, SP.glideSec, now, 1);
    setPan(entry.nodes.panner, entry.pan, now, SP.glideSec);
  }

  stopSiren(id) {
    const key = String(id);
    const entry = this._sirens.get(key);
    if (!entry) return;
    this._sirens.delete(key);
    this._destroySiren(entry, AUDIO_CONFIG.SIREN.fadeOutSec);
  }

  stopAllSirens() {
    for (const entry of [...this._sirens.values()]) {
      this._sirens.delete(entry.id);
      this._destroySiren(entry, AUDIO_CONFIG.SIREN.fadeOutSec);
    }
  }

  _aimSiren(entry, opts) {
    if (Number.isFinite(opts.x) || Number.isFinite(opts.z)) {
      const { distance, pan } = panAndDistance(this._listener, opts.x, opts.y, opts.z, AUDIO_CONFIG.SPATIAL.panWidth);
      entry.distance = distance;
      entry.pan = pan;
    }
    entry.distance = Math.max(0, num(opts.distance, entry.distance));
    entry.pan = clamp(num(opts.pan, entry.pan), -1, 1);
  }

  _realiseSiren(entry) {
    try {
      const ctx = this._ctx;
      const S = AUDIO_CONFIG.SIREN;
      const now = this._now;

      const panner = createPanner(ctx);
      panner.connect(this._bus.siren);
      const distGain = makeGain(ctx, 0.0001);
      const airFilter = makeFilter(ctx, 'lowpass', S.nearCutoffHz, 0.7);
      chain(distGain, airFilter, panner);

      const out = makeGain(ctx, 0.0001);
      out.connect(distGain);

      // Direct sound: two saws, one detuned, through a mid bandpass so it
      // sounds like a small horn speaker rather than a full-range monitor.
      const body = makeFilter(ctx, 'bandpass', S.bodyHz, S.bodyQ);
      chain(body, out);
      const oscA = makeOsc(ctx, S.wave, S.lowHz);
      const oscB = makeOsc(ctx, S.wave, S.lowHz, S.detuneCents);
      const gB = makeGain(ctx, S.detuneGain);
      oscA.connect(body);
      chain(oscB, gB, body);

      // The wail. One LFO drives BOTH oscillators so they stay locked.
      const lfo = makeLfo(ctx, {
        hz: S.lfoHz,
        depth: (S.highHz - S.lowHz) / 2,
        type: S.lfoWave,
      });
      lfo.out.connect(oscA.frequency);
      lfo.out.connect(oscB.frequency);
      const centre = (S.lowHz + S.highHz) / 2;
      oscA.frequency.value = centre;
      oscB.frequency.value = centre;

      // Reflection: a delayed, dull copy. Costs one delay node and buys the
      // impression of trees and distance.
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = S.reflectionDelaySec;
      const refFilter = makeFilter(ctx, 'lowpass', S.reflectionCutoffHz, 0.7);
      const refGain = makeGain(ctx, S.reflectionGain);
      chain(body, delay, refFilter, refGain, out);

      const sources = [oscA, oscB, lfo.osc];
      for (const s of sources) {
        try {
          s.start(now);
        } catch {
          /* ignore */
        }
      }
      ramp(out.gain, S.gain, now, S.fadeInSec);

      entry.nodes = { out, distGain, airFilter, panner, body, oscA, oscB, gB, lfo, delay, refFilter, refGain, sources };
      this.updateSiren(entry.id, {});
    } catch (err) {
      this._warnOnce('siren', err);
      entry.nodes = null;
    }
  }

  _destroySiren(entry, fadeSec) {
    const n = entry.nodes;
    entry.nodes = null;
    if (!n) return;
    const now = this._now;
    ramp(n.out.gain, 0.0001, now, Math.max(0.02, fadeSec));
    const stopAt = now + fadeSec + 0.05;
    for (const s of n.sources) {
      s.onended = null;
      safeStop(s, stopAt);
    }
    setTimeout(() => {
      for (const s of n.sources) safeDisconnect(s);
      for (const k of Object.keys(n)) {
        const node = n[k];
        if (node && typeof node.disconnect === 'function') safeDisconnect(node);
        if (node && node.out && typeof node.out.disconnect === 'function') safeDisconnect(node.out);
      }
    }, (fadeSec + 0.15) * 1000);
  }

  // -------------------------------------------------------------------------
  // Glitch
  // -------------------------------------------------------------------------

  /**
   * The corruption bed, 0..1. Everything about it worsens together: the
   * sample-and-hold noise speeds up and brightens, the drone cluster spreads
   * from a chord into a smear, the ring modulator climbs into inharmonic
   * territory, and a square gate starts chopping the whole thing.
   *
   * Setting 0 fades out and (after a delay) frees the nodes.
   */
  setGlitch(amount01) {
    const a = clamp01(amount01);
    this._glitchAmount = a;
    if (!this._live) return;

    if (a <= 0.001) {
      if (this._glitch) {
        glide(this._glitch.out.gain, 0.0001, AUDIO_CONFIG.GLITCH.glideSec, this._now);
        if (!this._glitch.teardownTimer) {
          this._glitch.teardownTimer = setTimeout(
            () => this._teardownGlitch(0),
            (AUDIO_CONFIG.GLITCH.glideSec + AUDIO_CONFIG.GLITCH.idleTeardownSec) * 1000,
          );
        }
      }
      return;
    }

    if (!this._glitch) {
      try {
        this._buildGlitch();
      } catch (err) {
        this._warnOnce('glitch', err);
        return;
      }
    }
    if (this._glitch.teardownTimer) {
      clearTimeout(this._glitch.teardownTimer);
      this._glitch.teardownTimer = null;
    }

    const G = AUDIO_CONFIG.GLITCH;
    const g = this._glitch;
    const now = this._now;
    const tc = G.glideSec;

    // setGlitch may be called every frame, so everything here is a setTarget
    // follow rather than a scheduled ramp — see _buildEngine for why.
    glide(g.out.gain, a * G.gain, tc, now);
    glide(g.noise.playbackRate, lerp(G.noiseRateMin, G.noiseRateMax, a), tc, now, 0.005);
    glide(g.droneFilter.frequency, lerp(G.droneCutoffMinHz, G.droneCutoffMaxHz, a), tc, now, 1);
    for (let i = 0; i < g.drones.length; i++) {
      const spread = lerp(G.droneSpreadMinCents, G.droneSpreadMaxCents, a);
      // Symmetric spread around the root: -s, 0, +s, -2s ...
      const k = i - (g.drones.length - 1) / 2;
      glide(g.drones[i].detune, k * spread, tc, now, 0.1);
    }
    glide(g.ringOsc.frequency, lerp(G.ringHzMin, G.ringHzMax, a), tc, now, 0.1);
    glide(g.ringMix.gain, a * G.ringMix, tc, now);
    glide(g.gateLfo.frequency, lerp(G.gateHzMin, G.gateHzMax, a), tc, now, 0.05);
    const depth = a * G.gateDepth;
    glide(g.gateDepth.gain, depth / 2, tc, now);
    glide(g.gate.gain, 1 - depth / 2, tc, now);
  }

  _buildGlitch() {
    const ctx = this._ctx;
    const G = AUDIO_CONFIG.GLITCH;
    const now = this._now;

    const out = makeGain(ctx, 0.0001);
    out.connect(this._bus.glitch);
    const gate = makeGain(ctx, 1);
    gate.connect(out);
    const gateLfo = makeOsc(ctx, 'square', G.gateHzMin);
    const gateDepth = makeGain(ctx, 0);
    chain(gateLfo, gateDepth);
    gateDepth.connect(gate.gain);

    // Stepped noise → bitcrush → highpass. The crush after the S&H is
    // deliberate: quantising already-stepped noise gives you the flat,
    // metallic buzz of failing hardware rather than plain hiss.
    const noise = makeNoiseSource(ctx, this._buffers.hold, G.noiseRateMin);
    const crush = ctx.createWaveShaper();
    crush.curve = this._curves.crush;
    const hp = makeFilter(ctx, 'highpass', G.noiseHighpassHz, 0.7);
    const noiseGain = makeGain(ctx, G.noiseGain);
    chain(noise, crush, hp, noiseGain, gate);

    // Drone cluster → ring modulator. A ring mod is just a gain node whose
    // gain sits at 0 and is driven entirely by a carrier: output = a × b, and
    // the sum/difference tones it creates are never in the original key.
    const droneMix = makeGain(ctx, 1);
    const droneFilter = makeFilter(ctx, 'lowpass', G.droneCutoffMinHz, 1.2);
    const droneGain = makeGain(ctx, G.droneGain);
    chain(droneMix, droneFilter, droneGain);
    droneGain.connect(gate); // dry path

    const ringMix = makeGain(ctx, 0);
    const ring = makeGain(ctx, 0); // gain 0 = pure ring modulation
    const ringOsc = makeOsc(ctx, 'sine', G.ringHzMin);
    ringOsc.connect(ring.gain);
    chain(droneGain, ring, ringMix, gate);

    const drones = [];
    const baseHz = midiToHz(G.droneMidi);
    for (let i = 0; i < G.droneVoices; i++) {
      const o = makeOsc(ctx, 'sawtooth', baseHz);
      o.connect(droneMix);
      drones.push(o);
    }

    const sources = [noise, gateLfo, ringOsc, ...drones];
    for (const s of sources) {
      try {
        s.start(now);
      } catch {
        /* ignore */
      }
    }

    this._glitch = { out, gate, gateLfo, gateDepth, noise, crush, hp, noiseGain, droneMix, droneFilter, droneGain, ringMix, ring, ringOsc, drones, sources, teardownTimer: null };
  }

  _teardownGlitch(fadeSec = 0.2) {
    const g = this._glitch;
    this._glitch = null;
    if (!g) return;
    if (g.teardownTimer) clearTimeout(g.teardownTimer);
    const now = this._now;
    if (fadeSec > 0) ramp(g.out.gain, 0.0001, now, fadeSec);
    const stopAt = now + fadeSec + 0.02;
    for (const s of g.sources) {
      s.onended = null;
      safeStop(s, stopAt);
    }
    const cleanup = () => {
      for (const s of g.sources) safeDisconnect(s);
      for (const k of Object.keys(g)) {
        const n = g[k];
        if (n && typeof n.disconnect === 'function') safeDisconnect(n);
      }
    };
    if (fadeSec <= 0) cleanup();
    else setTimeout(cleanup, (fadeSec + 0.1) * 1000);
  }

  /**
   * "The system noticed you." A bandpass sweeping downwards over crushed noise
   * plus a ring-modulated tone collapsing in pitch — the sonic shape of
   * something powering down mid-sentence.
   */
  playGlitchStinger() {
    if (!this._live) return;
    if (!this._voices.take()) return;
    try {
      const ctx = this._ctx;
      const S = AUDIO_CONFIG.GLITCH.stinger;
      const now = this._now;
      const dur = S.dur;

      const out = makeGain(ctx, 0.0001);
      out.connect(this._bus.glitch);
      envAD(out.gain, now, { peak: S.gain, attack: 0.003, hold: dur * 0.35, release: dur * 0.65 });

      // Crushed noise through a falling bandpass.
      const noise = makeNoiseSource(ctx, this._buffers.hold, 1.4, false);
      const crush = ctx.createWaveShaper();
      crush.curve = this._curves.crushHard;
      const band = makeFilter(ctx, 'bandpass', S.sweepFromHz, S.q);
      chain(noise, crush, band, out);
      try {
        band.frequency.setValueAtTime(S.sweepFromHz, now);
        band.frequency.exponentialRampToValueAtTime(S.sweepToHz, now + dur);
      } catch {
        /* ignore */
      }

      // Ring-modulated tone collapsing alongside it.
      const tone = makeOsc(ctx, 'square', S.toneFromHz);
      const ring = makeGain(ctx, 0);
      const ringOsc = makeOsc(ctx, 'sine', S.ringHz);
      ringOsc.connect(ring.gain);
      const tg = makeGain(ctx, S.toneGain);
      chain(tone, ring, tg, out);
      try {
        tone.frequency.setValueAtTime(S.toneFromHz, now);
        tone.frequency.exponentialRampToValueAtTime(S.toneToHz, now + dur * 0.9);
      } catch {
        /* ignore */
      }

      const sources = [noise, tone, ringOsc];
      const nodes = [out, crush, band, ring, tg];
      scheduleTeardown(sources, nodes, now, now + dur + 0.08, () => this._voices.release());
    } catch (err) {
      this._voices.release();
      this._warnOnce('stinger', err);
    }
  }

  // -------------------------------------------------------------------------
  // Ambience
  // -------------------------------------------------------------------------

  /** @param {'forest'|'outside'|'night'|'none'} name */
  setAmbience(name) {
    const key = name || 'none';
    if (key === this._ambienceName) return;
    if (key !== 'none' && !AUDIO_CONFIG.AMBIENCE[key]) {
      this._warnOnce('ambience:' + key, new Error(`unknown ambience "${key}"`));
      return;
    }
    this._ambienceName = key;
    if (!this._live) return; // realised on unlock
    this._applyAmbience();
  }

  _applyAmbience() {
    this._teardownAmbience(AUDIO_CONFIG.AMBIENCE.fadeSec);
    const cfg = AUDIO_CONFIG.AMBIENCE[this._ambienceName];
    if (!cfg) {
      this._maybeStopScheduler();
      return;
    }
    try {
      this._buildAmbience(cfg);
      this._ambNextEvent = this._now + 0.5;
      this._ensureScheduler();
    } catch (err) {
      this._warnOnce('ambience', err);
      this._teardownAmbience(0);
    }
  }

  _buildAmbience(cfg) {
    const ctx = this._ctx;
    const now = this._now;
    const out = makeGain(ctx, 0.0001);
    out.connect(this._bus.ambience);
    const sources = [];
    const nodes = [out];

    if (cfg.wind) {
      const W = cfg.wind;
      const n = makeNoiseSource(ctx, this._buffers.pink, W.rate);
      const f = makeFilter(ctx, 'lowpass', W.cutoffHz, W.q);
      const g = makeGain(ctx, W.gain);
      chain(n, f, g, out);
      // Gusts: a very slow LFO on the cutoff. Modulating cutoff rather than
      // gain is what makes it read as moving air instead of a volume knob.
      const gust = makeLfo(ctx, { hz: W.gustHz, depth: W.gustDepthHz, type: 'sine' });
      gust.out.connect(f.frequency);
      sources.push(n, gust.osc);
      nodes.push(f, g, gust.out);
    }

    if (cfg.drone) {
      const D = cfg.drone;
      const f = makeFilter(ctx, 'lowpass', D.cutoffHz, 0.9);
      const g = makeGain(ctx, D.gain);
      chain(f, g, out);
      const base = midiToHz(D.midi);
      for (let i = 0; i < D.voices; i++) {
        const k = i - (D.voices - 1) / 2;
        const o = makeOsc(ctx, 'sawtooth', base, k * D.spreadCents);
        o.connect(f);
        sources.push(o);
      }
      nodes.push(f, g);
    }

    for (const s of sources) {
      try {
        s.start(now);
      } catch {
        /* ignore */
      }
    }
    ramp(out.gain, 1, now, AUDIO_CONFIG.AMBIENCE.fadeSec);
    this._amb = { out, sources, nodes, cfg };
  }

  _teardownAmbience(fadeSec = 0.5) {
    const a = this._amb;
    this._amb = null;
    if (!a) return;
    const now = this._now;
    if (fadeSec > 0) ramp(a.out.gain, 0.0001, now, fadeSec);
    const stopAt = now + fadeSec + 0.05;
    for (const s of a.sources) {
      s.onended = null;
      safeStop(s, stopAt);
    }
    const cleanup = () => {
      for (const s of a.sources) safeDisconnect(s);
      for (const n of a.nodes) safeDisconnect(n);
    };
    if (fadeSec <= 0) cleanup();
    else setTimeout(cleanup, (fadeSec + 0.15) * 1000);
  }

  /** Schedule sparse ambience events (birds, crickets, swells) ahead of time. */
  _tickAmbience(now, horizon) {
    const amb = this._amb;
    if (!amb || !amb.cfg.event) return;
    const E = amb.cfg.event;
    if (this._ambNextEvent < now) this._ambNextEvent = now + 0.05;
    let guard = AUDIO_CONFIG.AMBIENCE.maxEventsPerTick;
    while (this._ambNextEvent < horizon && guard-- > 0) {
      this._spawnAmbienceEvent(E, this._ambNextEvent);
      this._ambNextEvent += lerp(E.minGapSec, E.maxGapSec, this._rng());
    }
  }

  _spawnAmbienceEvent(E, when) {
    if (!this._ambVoices.take()) return;
    try {
      const ctx = this._ctx;
      const panner = createPanner(ctx);
      setPan(panner, this._rng() * 1.6 - 0.8, when, 0.001);
      panner.connect(this._bus.ambience);
      const sources = [];
      const nodes = [panner];
      let total = 0;

      if (E.kind === 'bird') {
        // A chirp is a fast up-then-down frequency sweep. Several in a row,
        // each slightly different, is the difference between "bird" and "beep".
        const n = Math.floor(lerp(E.chirpsMin, E.chirpsMax + 0.999, this._rng()));
        const hz = lerp(E.minHz, E.maxHz, this._rng());
        for (let i = 0; i < n; i++) {
          const t = when + i * (E.chirpSec + E.chirpGapSec);
          const o = makeOsc(ctx, 'triangle', hz);
          const g = makeGain(ctx, 0.0001);
          chain(o, g, panner);
          try {
            o.frequency.setValueAtTime(hz * 0.75, t);
            o.frequency.exponentialRampToValueAtTime(hz * 1.25, t + E.chirpSec * 0.4);
            o.frequency.exponentialRampToValueAtTime(hz * 0.85, t + E.chirpSec);
          } catch {
            /* ignore */
          }
          envAD(g.gain, t, { peak: E.gain, attack: 0.008, hold: E.chirpSec * 0.3, release: E.chirpSec * 0.7 });
          sources.push(o);
          nodes.push(g);
          total = i * (E.chirpSec + E.chirpGapSec) + E.chirpSec * 2;
        }
      } else if (E.kind === 'cricket') {
        // Crickets are noise through an absurdly resonant bandpass, gated into
        // tiny pulses. A pure oscillator sounds electronic; this sounds alive.
        const hz = lerp(E.minHz, E.maxHz, this._rng());
        const n = Math.floor(lerp(E.chirpsMin, E.chirpsMax + 0.999, this._rng()));
        const src = makeNoiseSource(ctx, this._buffers.white, 1.0, true);
        const band = makeFilter(ctx, 'bandpass', hz, E.q);
        const g = makeGain(ctx, 0.0001);
        chain(src, band, g, panner);
        for (let i = 0; i < n; i++) {
          const t = when + i * (E.chirpSec + E.chirpGapSec);
          envAD(g.gain, t, { peak: E.gain, attack: 0.002, hold: E.chirpSec, release: E.chirpSec * 1.5 });
        }
        total = n * (E.chirpSec + E.chirpGapSec) + 0.1;
        sources.push(src);
        nodes.push(band, g);
      } else {
        // 'swell' — a slow low tone rising and falling. Used sparingly outside
        // the track bounds, where the world is supposed to feel unattended.
        const hz = lerp(E.minHz, E.maxHz, this._rng());
        const o = makeOsc(ctx, 'sawtooth', hz);
        const f = makeFilter(ctx, 'lowpass', hz * 3, 1.5);
        const g = makeGain(ctx, 0.0001);
        chain(o, f, g, panner);
        envAD(g.gain, when, { peak: E.gain, attack: E.chirpSec * 0.45, hold: 0.1, release: E.chirpSec * 0.55 });
        total = E.chirpSec + 0.2;
        sources.push(o);
        nodes.push(f, g);
      }

      scheduleTeardown(sources, nodes, when, when + total + 0.1, () => this._ambVoices.release());
    } catch (err) {
      this._ambVoices.release();
      this._warnOnce('ambience-event', err);
    }
  }

  // -------------------------------------------------------------------------
  // Music
  // -------------------------------------------------------------------------

  /** @param {'none'|'menu'|'race'|'chase'|'alone'} name */
  setMusic(name) {
    const key = name || 'none';
    if (key === this._musicName) return;
    if (key !== 'none' && !AUDIO_CONFIG.MUSIC.tracks[key]) {
      this._warnOnce('music:' + key, new Error(`unknown music track "${key}"`));
      return;
    }
    this._musicName = key;
    if (!this._live) return; // realised on unlock
    this._applyMusic();
  }

  _applyMusic() {
    this._teardownMusic(AUDIO_CONFIG.MUSIC.fadeSec);
    const track = AUDIO_CONFIG.MUSIC.tracks[this._musicName];
    if (!track) {
      this._maybeStopScheduler();
      return;
    }
    const ctx = this._ctx;
    const out = makeGain(ctx, 0.0001);
    out.connect(this._bus.music);
    ramp(out.gain, 1, this._now, AUDIO_CONFIG.MUSIC.fadeSec);
    this._music = {
      track,
      out,
      step: 0,
      stepSec: 60 / track.bpm / track.stepsPerBeat,
      // Start slightly ahead so the first note isn't scheduled in the past.
      nextTime: this._now + 0.06,
    };
    this._ensureScheduler();
  }

  _teardownMusic(fadeSec = 0.3) {
    const m = this._music;
    this._music = null;
    if (!m) return;
    const now = this._now;
    if (fadeSec > 0) ramp(m.out.gain, 0.0001, now, fadeSec);
    // Notes already scheduled keep their own teardown; we only need to drop
    // the bus once everything under it has finished.
    setTimeout(() => safeDisconnect(m.out), (fadeSec + 4) * 1000);
  }

  /**
   * Lookahead scheduler. Wakes every MUSIC.schedulerMs and schedules anything
   * due within MUSIC.lookaheadSec against ctx.currentTime. This is the standard
   * "A Tale of Two Clocks" pattern: setInterval is allowed to be late and
   * jittery because it never decides *when* a note sounds, only when we think
   * about it.
   */
  _ensureScheduler() {
    if (this._schedTimer || !this._live) return;
    this._schedTimer = setInterval(() => this._schedulerTick(), AUDIO_CONFIG.MUSIC.schedulerMs);
  }

  _stopScheduler() {
    if (this._schedTimer) {
      clearInterval(this._schedTimer);
      this._schedTimer = null;
    }
  }

  _maybeStopScheduler() {
    if (!this._music && !this._amb) this._stopScheduler();
  }

  _schedulerTick() {
    if (!this._live) return;
    const now = this._now;
    const horizon = now + AUDIO_CONFIG.MUSIC.lookaheadSec;

    const m = this._music;
    if (m) {
      // If the tab was backgrounded, nextTime can be far in the past. Snap
      // forward rather than machine-gunning the catch-up notes.
      if (m.nextTime < now - 0.5) m.nextTime = now + 0.02;
      let guard = 64;
      while (m.nextTime < horizon && guard-- > 0) {
        this._scheduleStep(m, m.step, m.nextTime);
        m.step = (m.step + 1) % m.track.steps;
        m.nextTime += m.stepSec;
      }
    }

    this._tickAmbience(now, horizon);
  }

  _scheduleStep(m, step, time) {
    const voices = m.track.voices;
    for (const key of Object.keys(voices)) {
      const v = voices[key];
      const pat = v.pattern;
      if (!pat || !pat.length) continue;
      // Each voice wraps its own pattern — mismatched lengths give polymeter.
      const note = pat[step % pat.length];
      if (note === null || note === undefined) continue;
      this._playMusicNote(m, v, m.track.root + (v.octave || 0) * 12 + note, time);
    }
  }

  _playMusicNote(m, v, midi, time) {
    if (!this._musicVoices.take()) return;
    try {
      const ctx = this._ctx;
      const hz = midiToHz(midi);
      const g = makeGain(ctx, 0.0001);
      const sources = [];
      const nodes = [g];

      if (v.wave === 'noise') {
        // Percussion: a noise burst through a bandpass. The pattern value
        // transposes the band, so one voice covers hats and snares.
        const band = makeFilter(ctx, 'bandpass', v.cutoffHz * Math.pow(2, (midi - m.track.root) / 24), v.q || 1);
        const src = makeNoiseSource(ctx, this._buffers.white, 1.0, false);
        chain(src, band, g, m.out);
        sources.push(src);
        nodes.push(band);
      } else {
        const filt = makeFilter(ctx, 'lowpass', v.cutoffHz, v.q || 1);
        chain(filt, g, m.out);
        const o = makeOsc(ctx, v.wave, hz);
        o.connect(filt);
        sources.push(o);
        if (v.detuneCents) {
          // A second, detuned voice. Slow beating is most of what makes a
          // two-oscillator pad sound "warm" instead of "thin".
          const o2 = makeOsc(ctx, v.wave, hz, v.detuneCents);
          o2.connect(filt);
          sources.push(o2);
        }
        nodes.push(filt);
      }

      const total = envAD(g.gain, time, {
        peak: v.gain,
        attack: v.attack,
        hold: v.hold,
        release: v.release,
      });
      scheduleTeardown(sources, nodes, time, time + total + 0.05, () => this._musicVoices.release());
    } catch (err) {
      this._musicVoices.release();
      this._warnOnce('music-note', err);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Re-apply everything the game asked for while we were suspended. Called on
   * unlock and whenever the context spontaneously resumes (tab focus).
   */
  _realiseDesiredState() {
    if (!this._live) return;
    try {
      if (this._engineWanted && !this._eng) this.startEngine();
      if (this._ambienceName !== 'none' && !this._amb) this._applyAmbience();
      if (this._musicName !== 'none' && !this._music) this._applyMusic();
      if (this._glitchAmount > 0 && !this._glitch) this.setGlitch(this._glitchAmount);
      for (const entry of this._sirens.values()) if (!entry.nodes) this._realiseSiren(entry);
      if (this._music || this._amb) this._ensureScheduler();
    } catch (err) {
      this._warnOnce('realise', err);
    }
  }

  /**
   * Fire-and-forget hookups so the rest of the game doesn't have to know audio
   * exists. Payloads are treated as hostile — every field is optional.
   */
  _subscribe() {
    const sub = (channel, fn) => {
      try {
        this._unsubs.push(events.on(channel, fn));
      } catch (err) {
        this._warnOnce('subscribe:' + channel, err);
      }
    };

    sub('vehicle:collision', (p) => this.playCollision(num(p?.intensity, 0.5)));
    sub('race:checkpoint', () => this.playCheckpoint());
    sub('ui:blip', (p) => this.playUiBlip(p?.kind || 'move'));
    // 'camera:shake' is intentionally not handled: collisions already emit
    // 'vehicle:collision', and shaking for other reasons is a visual concern.
  }

  /** Log a given failure once. A per-frame failure must not flood the console. */
  _warnOnce(key, err) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`[audio] ${key}:`, err);
  }
}

/** The game-wide instance. Systems import this directly. */
export const audio = new AudioEngine();
