/**
 * OPEN WORLD — the things living in it, and the things left behind in it.
 *
 * Checks that wildlife actually moves, that it follows the camera rather than
 * being scattered once and forgotten, that none of it is solid, and that the
 * posters and wrecks landed where they should (and are/aren't solid to match).
 *
 * Screenshots (if SHOTS is set) go OUTSIDE the repo.
 *
 *   node tools/open-world.mjs
 *   SHOTS=/tmp/somewhere node tools/open-world.mjs
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 8251;
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
  // `?scene=open` boots straight into the open world with NO director, so
  // nothing has announced that the story is over — which is exactly the state
  // the wildlife gate is supposed to sit closed in.
  await page.goto(`http://localhost:${PORT}/index.html?scene=open`, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.TEKER?.game?.loop?.running === true', { timeout: 60000 });
  await page.waitForFunction('TEKER.game.player != null', { timeout: 40000 });

  // -- 0. nothing is out while the cops might be ----------------------------
  console.log('\n— before the cops are ditched —');
  const shut = await page.evaluate(() => {
    const w = TEKER.game.world.wildlife;
    return { armed: w.armed, visible: w.root.visible };
  });
  console.log('   ', JSON.stringify(shut));
  check('the forest is empty until you are alone', shut.armed === false);
  check('…and nothing is even drawn', shut.visible === false);

  // Ditch them.
  await page.evaluate(() => TEKER.events.emit('chase:escaped', { duration: 42 }));
  await sleep(600);
  const open = await page.evaluate(() => {
    const g = TEKER.game;
    const w = g.world.wildlife;
    const v = g.player;
    let far = 0;
    for (const grp of w._groups)
      for (const it of grp.items)
        far = Math.max(far, Math.hypot(it.x - v.position.x, it.z - v.position.z));
    return { armed: w.armed, visible: w.root.visible, farthest: Math.round(far) };
  });
  console.log('   ', JSON.stringify(open));
  check('escaping brings the world back', open.armed === true && open.visible === true);
  check('…and they arrive around YOU, not the origin', open.farthest < 340, `${open.farthest} m away`);

  // -- 1. the population exists ---------------------------------------------
  console.log('\n— who lives here —');
  const census = await page.evaluate(() => {
    const w = TEKER.game.world.wildlife;
    if (!w) return null;
    const byKind = {};
    for (const g of w._groups) byKind[g.kind] = (byKind[g.kind] || 0) + g.items.length;
    let tris = 0;
    w.root.traverse((o) => {
      if (o.geometry?.attributes?.position) tris += (o.geometry.attributes.position.count / 3) * (o.count || 1);
    });
    return { byKind, meshes: w._meshes.length, tris: Math.round(tris) };
  });
  console.log('   ', JSON.stringify(census));
  check('wildlife exists', !!census);
  for (const kind of ['cat', 'fox', 'bird', 'butterfly']) {
    check(`  ${kind}s are out there`, (census?.byKind?.[kind] ?? 0) > 0, String(census?.byKind?.[kind]));
  }
  check('it is cheap', census && census.tris < 12000, `${census?.tris} triangles`);
  const total = Object.values(census?.byKind ?? {}).reduce((a, b) => a + b, 0);
  check('and sparse — an animal is an event, not a swarm', total <= 32, `${total} animals in all`);

  // -- 2. nothing living is solid -------------------------------------------
  console.log('\n— none of it is solid —');
  const solid = await page.evaluate(() => {
    const kinds = new Set();
    const seen = new Set();
    for (const list of TEKER.game.world.collision.cells.values()) {
      for (const c of list) {
        if (seen.has(c)) continue;
        seen.add(c);
        kinds.add(c.kind);
      }
    }
    return [...kinds];
  });
  console.log('    collider kinds:', solid.join(', '));
  for (const kind of ['cat', 'fox', 'bird', 'butterfly', 'poster']) {
    check(`  no ${kind} has a hitbox`, !solid.includes(kind));
  }
  check('a wreck IS solid — it is a car', solid.includes('wreck'));

  // -- 3. they move ----------------------------------------------------------
  // Park the car first: while the camera is travelling, animals get RECYCLED
  // ahead of it, and a 1000m jump is not locomotion.
  console.log('\n— they move —');
  await page.evaluate(() => {
    const v = TEKER.game.player;
    v.velocity.set(0, 0, 0);
    v.speed = 0;
  });
  await sleep(1200);
  const before = await page.evaluate(() =>
    TEKER.game.world.wildlife._groups.map((g) => g.items.map((i) => [i.x, i.y, i.z]))
  );
  await sleep(2000);
  const after = await page.evaluate(() =>
    TEKER.game.world.wildlife._groups.map((g) => g.items.map((i) => [i.x, i.y, i.z]))
  );
  const moved = {};
  await page.evaluate(() => {}); // no-op, keeps the flow readable
  const kinds = await page.evaluate(() => TEKER.game.world.wildlife._groups.map((g) => g.kind));
  for (let gi = 0; gi < before.length; gi++) {
    let max = 0;
    for (let i = 0; i < before[gi].length; i++) {
      const a = before[gi][i];
      const b = after[gi][i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      // Anything over 50m was recycled to a new spot, not walked there.
      if (d < 50) max = Math.max(max, d);
    }
    moved[kinds[gi]] = Math.max(moved[kinds[gi]] || 0, max);
  }
  console.log('   ', JSON.stringify(Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, +v.toFixed(2)]))));
  for (const kind of ['bird', 'butterfly']) {
    check(`  ${kind}s are never still`, moved[kind] > 0.5, `${moved[kind]?.toFixed(2)} m in 2s`);
  }
  check('  cats or foxes stir', (moved.cat ?? 0) + (moved.fox ?? 0) > 0.2,
    `cat ${moved.cat?.toFixed(2)}, fox ${moved.fox?.toFixed(2)}`);

  // -- 4. the pool follows the camera ---------------------------------------
  console.log('\n— the population follows you —');
  const follow = await page.evaluate(async () => {
    const g = TEKER.game;
    const w = g.world.wildlife;
    // Measure against a POINT, not against the camera: the camera lags the car
    // by a frame, so reading it straight after a teleport reports the old spot.
    // Each kind has its own range, so "near" is not one number: a bird lives
    // out to 260m and is only recycled at 320m. Judge each against its own.
    const nearPoint = (px, pz) => {
      let n = 0;
      for (const grp of w._groups) {
        const reach = (grp.cfg.radius ?? 140) + 60;
        for (const it of grp.items) if (Math.hypot(it.x - px, it.z - pz) <= reach) n++;
      }
      return n;
    };
    const total = w._groups.reduce((s, grp) => s + grp.items.length, 0);
    const v = g.player;
    const home = nearPoint(v.position.x, v.position.z);
    // Teleport a long way. Nothing was placed out here.
    const tx = 700;
    const tz = -700;
    v.reset(new v.position.constructor(tx, g.world.sampleGround(tx, tz).height + 1, tz), 0);
    return { total, home, awayImmediately: nearPoint(tx, tz) };
  });
  await sleep(2500);
  const settled = await page.evaluate(() => {
    const g = TEKER.game;
    const w = g.world.wildlife;
    const v = g.player;
    let n = 0;
    for (const grp of w._groups) {
      const reach = (grp.cfg.radius ?? 140) + 60;
      for (const it of grp.items)
        if (Math.hypot(it.x - v.position.x, it.z - v.position.z) <= reach) n++;
    }
    return n;
  });
  console.log('   ', JSON.stringify({ ...follow, afterSettling: settled }));
  check('everyone starts near the camera', follow.home === follow.total, `${follow.home}/${follow.total}`);
  check('teleporting leaves them behind', follow.awayImmediately < follow.total * 0.5,
    `${follow.awayImmediately}/${follow.total}`);
  check('…and they catch up', settled === follow.total, `${settled}/${follow.total}`);

  // -- 5. civilisation -------------------------------------------------------
  console.log('\n— what people left behind —');
  const left = await page.evaluate(() => {
    const s = TEKER.game.world.scatter;
    const counts = {};
    for (const c of s.colliders) counts[c.kind] = (counts[c.kind] || 0) + 1;
    const meshes = {};
    for (const m of s._meshes) {
      const kind = m.name.split(':')[1];
      meshes[kind] = (meshes[kind] || 0) + m.count;
    }
    return { wreckColliders: counts.wreck || 0, posters: meshes.poster || 0, wrecks: meshes.wreck || 0 };
  });
  console.log('   ', JSON.stringify(left));
  check('missing posters went up', left.posters > 40, String(left.posters));
  check('wrecks are out there', left.wrecks > 20, String(left.wrecks));
  check('every wreck is solid', left.wreckColliders === left.wrecks, `${left.wreckColliders}/${left.wrecks}`);

  if (SHOTS) {
    // Park next to a wreck and a poster so both are in frame.
    await page.evaluate(() => {
      const g = TEKER.game;
      const w = g.world.scatter.colliders.find((c) => c.kind === 'wreck');
      const v = g.player;
      const a = Math.atan2(w.x, w.z);
      const x = w.x - Math.sin(a) * 12;
      const z = w.z - Math.cos(a) * 12;
      v.reset(new v.position.constructor(x, g.world.sampleGround(x, z).height + 0.6, z), a);
      v.velocity.set(0, 0, 0);
      g.camera.setRig('chaseWide');
    });
    await sleep(2500);
    await page.screenshot({ path: `${SHOTS}/world-wreck.png` });

    await page.evaluate(() => {
      const g = TEKER.game;
      // Somewhere open, looking flat, so the animals read against the ground.
      const v = g.player;
      v.reset(new v.position.constructor(240, g.world.sampleGround(240, 240).height + 0.6, 240), 0.9);
      v.velocity.set(0, 0, 0);
      g.camera.setRig('chaseWide');
    });
    await sleep(3000);
    await page.screenshot({ path: `${SHOTS}/world-life.png` });
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
