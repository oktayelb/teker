/**
 * RACE FLOW — checks the pacing *between* races, which is the part that has no
 * unit test and is invisible in a screenshot.
 *
 * Three things it will not let regress:
 *   1. Finishing a race does NOT advance the game. The results panel opens and
 *      stays open until the player presses ENTER.
 *   2. The countdown never runs behind the fade. When the new grid appears the
 *      race must still be on the grid, not already racing.
 *   3. `?start=` boots the story straight into the level that breaks, with the
 *      director still attached, so the blackout and everything after it still
 *      happen. The level id comes from `LEVELS` rather than being written here:
 *      the stage that ends the game has moved once already.
 *
 * Every level owns its map now, so 1 and 2 are also checks that a level swap
 * (a whole world built behind the fade) does not leak into what the player
 * sees: no countdown behind the curtain, no results panel skipped past.
 *
 *   node tools/race-flow.mjs
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';

// Which level ends the game, read from the game rather than assumed.
const { LEVELS } = await import('../src/levels/index.js');
const BREAKS = (LEVELS.find((l) => l.story?.breaks) || LEVELS.at(-1)).id;

const PORT = 8239;
const BASE = `http://localhost:${PORT}/index.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `   ${detail}` : ''}`);
};

/** Boot a page, wait for the world to build, return it wired for probing. */
async function open(query = '') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.setCacheEnabled(false);
  page.on('pageerror', (e) => {
    failures++;
    console.log('[PAGEERROR]', e.message);
  });
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.TEKER?.game?.loop?.running === true', { timeout: 60000 });
  await page.evaluate(() => {
    window.__log = [];
    for (const ev of ['race:started', 'race:finished', 'race:dismissed', 'mode:entered', 'intro:phase', 'level:loaded'])
      TEKER.events.on(ev, (p) => window.__log.push(`${ev}:${p?.levelId || p?.id || p?.name || p?.phase || ''}`));
  });
  return page;
}

const probe = (page) =>
  page.evaluate(() => {
    const m = TEKER.game.modes.current;
    return {
      mode: TEKER.game.modes.currentName,
      track: m?.track?.id ?? null,
      state: m?.state ?? null,
      // How black the screen is right now, 0..1.
      fade: Number(getComputedStyle(document.querySelector('.tk-fade')).opacity) || 0,
      open: [...document.querySelectorAll('.tk-screen.is-open')]
        .map((e) => e.className.replace(/tk-screen ?/, '').trim())
        .join(','),
      results: document.querySelector('.tk-results .tk-btn')?.textContent ?? null,
      hint: document.querySelector('.tk-results-hint')?.textContent ?? null,
      log: window.__log.join(' | '),
    };
  });

/** Force the player across the line: fixedUpdate picks it up and finishes. */
const finishRace = (page) =>
  page.evaluate(() => {
    const m = TEKER.game.modes.current;
    m.progress.find((x) => x.vehicle === TEKER.game.player).lap = m.laps;
  });

try {
  // =========================================================================
  console.log('\n— A. the story, race 1 → race 2 ————————————————————————————');
  const page = await open();
  await sleep(1500);

  const title = await page.evaluate(() =>
    [...document.querySelectorAll('.tk-menu .tk-btn')].map((b) => b.dataset.id)
  );
  check('title menu offers a shortcut to the level that breaks', title.includes(BREAKS), title.join(','));

  await page.keyboard.press('Enter'); // BAŞLA
  // The grid is held for gridHold before the lights: catch it mid-hold.
  await sleep(1200);
  let s = await probe(page);
  check('race 1 holds on the grid before the countdown', s.state === 'grid' || s.state === 'countdown', s.state);

  await page.waitForFunction('TEKER.game.modes.current?.state === "racing"', { timeout: 20000 });
  console.log('  race 1 running.');

  await finishRace(page);
  await sleep(800);
  s = await probe(page);
  check('the finish breathes before the panel opens', !s.open.includes('dim'), `open=${s.open}`);

  await page.waitForFunction('document.querySelector(".tk-results")?.closest(".is-open") != null', {
    timeout: 15000,
  });
  s = await probe(page);
  check('results panel opens', s.open.includes('dim'), `btn=${s.results}`);
  check('results panel says how to continue', s.hint === 'ENTER', String(s.hint));

  // THE POINT: sit here doing nothing for a long time. Nothing may advance.
  await sleep(9000);
  s = await probe(page);
  check('9s with no input: still on bölüm 1, panel still up', s.track === 'level1' && s.open.includes('dim'),
    `track=${s.track} open=${s.open}`);
  check('race:dismissed not emitted before ENTER', !s.log.includes('race:dismissed'), s.log);

  // Now press on.
  await page.keyboard.press('Enter');
  await sleep(600);
  s = await probe(page);
  check('ENTER closes the panel', !s.open.includes('dim'), s.open);

  // Through the gap: black screen, then the new grid, then the lights.
  await page.waitForFunction('TEKER.game.modes.current?.track?.id === "level2"', { timeout: 25000 });
  s = await probe(page);
  check('race 2 grid is NOT already racing when it appears', s.state !== 'racing', s.state);

  // Watch until the fade is fully clear, then assert the race still has not started.
  await page.waitForFunction(
    'Number(getComputedStyle(document.querySelector(".tk-fade")).opacity) < 0.05',
    { timeout: 20000 }
  );
  s = await probe(page);
  check('screen is visible before the countdown ends', s.state !== 'racing', `state=${s.state} fade=${s.fade}`);

  await page.waitForFunction('TEKER.game.modes.current?.state === "racing"', { timeout: 20000 });
  console.log('  race 2 running.');
  console.log('  events:', (await probe(page)).log);
  await page.close();

  // =========================================================================
  console.log('\n— B. ?start=race3 ————————————————————————————————————————');
  const p3 = await open(`?start=${BREAKS}`);
  await page3Checks(p3);
  await p3.close();
} finally {
  await browser.close();
  server.kill();
}

async function page3Checks(p3) {
  await p3.waitForFunction(`TEKER.game.modes.current?.track?.id === "${BREAKS}"`, { timeout: 60000 });
  let s = await probe(p3);
  check('no title screen — straight into the stage that breaks', !s.open.includes('scrim'), s.open);
  check(`on ${BREAKS}`, s.track === BREAKS, String(s.track));

  await p3.waitForFunction(
    'Number(getComputedStyle(document.querySelector(".tk-fade")).opacity) < 0.05',
    { timeout: 20000 }
  );
  s = await probe(p3);
  check('it fades in before it starts', s.state !== 'racing', `state=${s.state} fade=${s.fade}`);

  await p3.waitForFunction('TEKER.game.modes.current?.state === "racing"', { timeout: 20000 });
  const d = await p3.evaluate(() => ({
    phase: TEKER.game.modes.current ? window.__director?.phase : null,
    races: TEKER.game.flags.racesCompleted,
    showResults: TEKER.game.modes.current.showResults,
  }));
  check('director counts the races that were skipped', d.races === LEVELS.findIndex((l) => l.id === BREAKS),
    `racesCompleted=${d.races}`);
  check('it has no results screen — the story ends it', d.showResults === false, String(d.showResults));

  // The whole point of the shortcut: the director must still be attached, so
  // driving off the edge still breaks the game open instead of doing nothing.
  await p3.evaluate(() => {
    const v = TEKER.game.player;
    v.position.set(v.position.x + 600, v.position.y, v.position.z + 600);
  });
  await p3.waitForFunction("window.__log.join().includes('intro:phase:breakout')", { timeout: 20000 })
    .then(() => check('driving off the edge still triggers the breakout', true))
    .catch(() => check('driving off the edge still triggers the breakout', false, 'timed out'));
  await p3.waitForFunction("window.__log.join().includes('intro:phase:free')", { timeout: 30000 })
    .then(() => check('…and hands over to the open world', true))
    .catch(() => check('…and hands over to the open world', false, 'timed out'));
  console.log('  events:', (await probe(p3)).log);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
