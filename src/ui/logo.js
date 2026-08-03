/**
 * LOGO — "Tek" | "er"
 *
 * The word is TEKER (Turkish: "wheel"). It is rendered as two glyph runs so
 * the first three letters read as their own word: *tek* — "single, sole, the
 * only one". That is the entire premise of the game hiding in plain sight in
 * the title, and the player is not supposed to notice it on the first screen.
 *
 * Which is why the split must NOT look like graphic design. It looks like a
 * defect: a hairline seam, a one-pixel vertical drift, a little channel bleed —
 * the kind of thing you would blame on the emulator. As the story breaks the
 * world open, the same defect is turned up until "Tek" tears off the front of
 * the word and the game still does not react to it.
 *
 * Pure DOM + CSS (see ui.css). No canvas, no images, no webfonts — the logo has
 * to survive being opened from a local file with no network.
 *
 * Nothing here touches `document` until a factory is actually called.
 */

const TEK = 'Tek';
const REST = 'er';
const FULL_WORD = TEK + REST;

/** Threshold where the seam starts animating rather than just sitting there. */
const GLITCH_ON = 0.02;
/** Threshold where "Tek" stops belonging to the word at all. */
const TORN = 0.5;

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Build one glyph run. `data-text` feeds the ::before/::after ghost copies that
 * produce the RGB fringing, so the text lives in three places and must match.
 */
function makePart(text, extraClass) {
  const el = document.createElement('span');
  el.className = `tk-logo-part ${extraClass}`;
  el.dataset.text = text;
  el.textContent = text;
  return el;
}

/**
 * @param {object} [opts]
 * @param {number|string} [opts.size=96]  font-size; number = px, string = any CSS length
 * @param {number} [opts.glitch=0]        initial glitch amount, 0..1
 * @returns {HTMLElement & { setGlitch(amount01: number): void, glitch: number }}
 */
export function createLogo({ size = 96, glitch = 0 } = {}) {
  const el = document.createElement('div');
  el.className = 'tk-logo';
  // One accessible name for the whole thing: a screen reader must hear the
  // word intact, because the split is a *visual* lie, not a semantic one.
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', FULL_WORD.toUpperCase());
  el.style.setProperty('--logo-fs', typeof size === 'number' ? `${size}px` : String(size));

  const word = document.createElement('div');
  word.className = 'tk-logo-word';
  word.setAttribute('aria-hidden', 'true');

  const tek = makePart(TEK, 'tk-logo-tek');
  const seam = document.createElement('i');
  seam.className = 'tk-logo-seam';
  const rest = makePart(REST, 'tk-logo-rest');

  word.append(tek, seam, rest);
  el.append(word);

  let current = -1; // force the first write through

  /** @param {number} amount01 */
  el.setGlitch = function setGlitch(amount01) {
    const g = clamp01(Number(amount01) || 0);
    if (g === current) return;
    current = g;
    // Everything downstream is CSS maths on --g: one property write per change,
    // no per-frame JS animation, no layout thrash.
    el.style.setProperty('--g', String(g));
    el.classList.toggle('is-glitching', g > GLITCH_ON);
    el.classList.toggle('is-torn', g > TORN);
  };

  Object.defineProperty(el, 'glitch', { get: () => current });

  el.setGlitch(glitch);
  return el;
}

/**
 * Small inline wordmark for a HUD corner. Same split, same lie, 12 pixels tall.
 * @returns {HTMLElement & { setGlitch(amount01: number): void }}
 */
export function createWordmark() {
  const el = document.createElement('span');
  el.className = 'tk-wordmark';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', FULL_WORD.toUpperCase());

  const tek = document.createElement('b');
  tek.textContent = TEK.toUpperCase();
  const rest = document.createElement('i');
  rest.textContent = REST.toUpperCase();
  el.append(tek, rest);

  let current = -1;
  el.setGlitch = function setGlitch(amount01) {
    const g = clamp01(Number(amount01) || 0);
    if (g === current) return;
    current = g;
    // At this size a transform is all that reads; the gap widens, nothing else.
    tek.style.marginRight = `${0.28 + g * 0.5}em`;
    tek.style.top = `${-1 - g * 2}px`;
    el.style.opacity = String(0.55 + g * 0.45);
  };
  el.setGlitch(0);

  return el;
}
