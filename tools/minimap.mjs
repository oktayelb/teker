/**
 * MINIMAP — that the map opens, tracks the player, and draws what it claims to.
 *
 * The map is a canvas, so almost none of it is reachable from the DOM. What
 * this checks instead is the layer beneath the pixels: that the toggle key runs,
 * that the world was indexed, that the projection actually moves when the car
 * does, and that the canvas is not blank. The one visual check is a pixel
 * count — a map that draws nothing and a map that draws everything both fail it.
 *
 *   node tools/minimap.mjs
 *   SHOTS=/tmp/somewhere node tools/minimap.mjs
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 8253;
const SHOTS = process.env.SHOTS || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `   ${detail}` : ''}`);
};

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  await page.setCacheEnabled(false);
  page.on('pageerror', (e) => {
    failures++;
    console.log('[PAGEERROR]', e.message);
  });
  await page.goto(`http://localhost:${PORT}/index.html?scene=open`, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.TEKER?.game?.loop?.running === true', { timeout: 60000 });
  await page.waitForFunction('TEKER.game.player != null', { timeout: 40000 });
  await sleep(600);

  // -- 1. it was built, and it indexed the world ----------------------------

  const built = await page.evaluate(() => {
    const m = TEKER.game.ui.minimap;
    return {
      exists: !!m,
      mounted: !!m?.el,
      trees: m?._trees?.count ?? 0,
      rocks: m?._rocks?.count ?? 0,
      tracks: m?._trackLines?.length ?? 0,
      landmarks: m?._landmarks?.length ?? 0,
      visible: m?.visible,
    };
  });
  check('the map exists and is mounted', built.exists && built.mounted);
  check('the forest was indexed', built.trees > 3000, `${built.trees} trees`);
  check('so were the rocks', built.rocks > 500, `${built.rocks} rocks and logs`);
  // One map, one parkour: every level owns its own world now, so the ribbon on
  // the minimap is this level's ribbon and there is nothing else out there.
  check('this level\'s parkour is on it', built.tracks === 1, `${built.tracks} ribbons`);
  check('and the landmarks', built.landmarks === 6, `${built.landmarks} places`);
  check('it starts closed', built.visible === false);

  // -- 2. H opens it --------------------------------------------------------

  await page.keyboard.press('KeyH');
  await sleep(400);
  const opened = await page.evaluate(() => {
    const m = TEKER.game.ui.minimap;
    return { visible: m.visible, open: m.el.classList.contains('is-open'), size: m._size };
  });
  check('H opens the map', opened.visible && opened.open);
  check('the canvas has a real size', opened.size >= 132, `${opened.size}px`);

  // -- 3. it is not blank ---------------------------------------------------
  // Sampled off the canvas itself rather than a screenshot, so a WebGL quirk in
  // the software renderer cannot make this pass or fail for the wrong reason.

  const ink = await page.evaluate(() => {
    const c = TEKER.game.ui.minimap.canvas;
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
    return { lit, total: d.length / 4 };
  });
  const coverage = ink.lit / ink.total;
  check('the map draws something', coverage > 0.3, `${(coverage * 100).toFixed(1)}% of pixels inked`);
  check('…and is not a solid block', coverage < 0.995, `${(coverage * 100).toFixed(1)}%`);

  // -- 4. it tracks the player ---------------------------------------------
  // Drive for a moment and confirm the map's idea of where the car is followed
  // it. This is the whole feature: a map that does not move is wallpaper.

  const sample = () =>
    page.evaluate(() => {
      const m = TEKER.game.ui.minimap;
      const p = TEKER.game.player;
      return { x: m._px, z: m._pz, angle: m._mapAngle, px: p.position.x, pz: p.position.z };
    });
  const before = await sample();
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await sleep(2500);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');
  const after = await sample();

  const carMoved = Math.hypot(after.px - before.px, after.pz - before.pz);
  const mapMoved = Math.hypot(after.x - before.x, after.z - before.z);
  // Compared against the car's *actual* travel rather than a fixed distance:
  // under swiftshader the loop runs at a handful of frames a second and a
  // literal metre count would only be measuring the software renderer.
  check('the car actually drove', carMoved > 2, `${carMoved.toFixed(1)}m`);
  check('the map went with it', Math.abs(mapMoved - carMoved) < 2, `map ${mapMoved.toFixed(1)}m vs car ${carMoved.toFixed(1)}m`);
  // The map is sampled once per rendered frame and the car integrates at 120Hz,
  // so it is at most one frame behind — never a growing gap.
  const lag = Math.hypot(after.x - after.px, after.z - after.pz);
  check('…no more than a frame behind', lag < 2, `${lag.toFixed(3)}m`);
  check('the map turned with it', Math.abs(after.angle - before.angle) > 0.05, `${(after.angle - before.angle).toFixed(2)} rad`);

  // -- 5. zoom and close ----------------------------------------------------

  const zoom0 = await page.evaluate(() => TEKER.game.ui.minimap.range);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.press('KeyH');
  await page.keyboard.up('ShiftLeft');
  await sleep(200);
  const zoom1 = await page.evaluate(() => TEKER.game.ui.minimap.range);
  check('shift+H zooms instead of closing', zoom1 !== zoom0, `${zoom0}m → ${zoom1}m`);
  check('…and left it open', await page.evaluate(() => TEKER.game.ui.minimap.visible));

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/minimap-open.png` });

  await page.keyboard.press('KeyH');
  await sleep(400);
  check('H closes it again', !(await page.evaluate(() => TEKER.game.ui.minimap.visible)));

  // -- 6. it is there in a race too -----------------------------------------

  await page.evaluate(() => TEKER.game.modes.switchTo('race', { levelId: 'level1' }));
  await sleep(2500);
  await page.keyboard.press('KeyH');
  await sleep(500);
  const race = await page.evaluate(() => {
    const m = TEKER.game.ui.minimap;
    return { visible: m.visible, open: m.el.classList.contains('is-open'), active: m._activeTrackId, next: m._nextCheckpoint };
  });
  check('the map opens in a race', race.visible && race.open);
  check('…and knows which ribbon is live', race.active === 'level1', String(race.active));
  check('…and which checkpoint is next', typeof race.next === 'number', String(race.next));

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/minimap-race.png` });
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\n\x1b[32mminimap ok\x1b[0m' : `\n\x1b[31m${failures} failed\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
