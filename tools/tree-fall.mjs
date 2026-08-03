/**
 * TREE FALL — trunk damage, felling, and the disguise.
 *
 * Drives the player into a real tree at real speeds and checks the whole chain:
 * momentum accumulates, a soft tap does nothing, a hard hit fells it, the tree
 * ends up on the car, its collider stops existing, and the cops stop seeing it.
 * Then that the player can take the thing off again — handbrake and throttle
 * together — and that it is left standing where they shrugged it off.
 *
 * Screenshots (if SHOTS is set) go OUTSIDE the repo.
 *
 *   node tools/tree-fall.mjs
 *   SHOTS=/tmp/somewhere node tools/tree-fall.mjs
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 8249;
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
  // Free roam: a whole forest, no race rules in the way.
  await page.goto(`http://localhost:${PORT}/index.html?skip=intro`, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.TEKER?.game?.loop?.running === true', { timeout: 60000 });
  await page.waitForFunction('TEKER.game.player != null', { timeout: 40000 });

  await page.evaluate(() => {
    const g = TEKER.game;
    window.__log = [];
    for (const ev of ['tree:damaged', 'tree:felled', 'vehicle:disguised', 'vehicle:undisguised'])
      TEKER.events.on(ev, (p) => window.__log.push(`${ev}:${p.kind ?? ''}`));

    /**
     * Find a fellable tree the player can be aimed at.
     *
     * "Can be aimed at" now excludes anything under a dome the player is sealed
     * against. Free roam spawns you on parkur 3's grid, which means parkurs 1
     * and 2 have already closed over their forests — put the car down in there
     * and it is placed on the *roof*, sixty metres above the trunk it was
     * supposed to hit, and every ram silently misses. See `src/world/dome.js`.
     */
    window.__pickTree = () => {
      const domes = g.world.domes;
      const reachable = (c) => {
        if (!domes) return true;
        for (const d of domes.domes) {
          if (domes.sealedFor(g.player, d) && d.distanceTo(c.x, c.z) <= d.radius) return false;
        }
        return true;
      };
      const seen = new Set();
      for (const list of g.world.collision.cells.values()) {
        for (const c of list) {
          if (seen.has(c) || c.felled) continue;
          seen.add(c);
          if (['pine', 'broadleaf', 'dead'].includes(c.kind) && c.mesh && reachable(c)) return c;
        }
      }
      return null;
    };
    /** Aim the car at a tree from `back` metres away and fire it in at `speed`. */
    window.__ramTry = 0;
    window.__ram = (c, speed, back = 9) => {
      const v = g.player;
      // Deterministic sweep of approach angles rather than random: a run that
      // misses the trunk on a slope must not turn into a flaky assertion.
      const a = (window.__ramTry++ * 2.39996);
      const x = c.x + Math.cos(a) * back;
      const z = c.z + Math.sin(a) * back;
      const heading = Math.atan2(c.x - x, c.z - z);
      v.reset(new v.position.constructor(x, g.world.sampleGround(x, z).height + 0.6, z), heading);
      v.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
    };
    window.__tree = (c) => ({
      kind: c.kind,
      damage: Math.round(c.damage || 0),
      capacity: Math.round(c.capacity || 0),
      felled: !!c.felled,
      disabled: !!c.disabled,
      blocksSight: !!c.blocksSight,
    });
    window.__player = () => {
      const worn = g.player.object.children.filter((o) => o.name?.startsWith('fallen:'));
      const w = worn[0];
      return {
        disguised: !!g.player.disguised,
        speed: +g.player.speed.toFixed(2),
        wearing: worn.map((o) => o.name),
        // Is the trunk actually gone, and is it sitting level?
        wornTris: w ? w.geometry.getAttribute('position').count / 3 : 0,
        srcTris: window.__t?.mesh ? window.__t.mesh.geometry.getAttribute('position').count / 3 : 0,
        pitch: w ? +w.rotation.x.toFixed(4) : null,
        roll: w ? +w.rotation.z.toFixed(4) : null,
        wornWorldHeight: w
          ? +(
              (w.geometry.boundingBox
                ? w.geometry.boundingBox.max.y - w.geometry.boundingBox.min.y
                : (w.geometry.computeBoundingBox(),
                  w.geometry.boundingBox.max.y - w.geometry.boundingBox.min.y)) * w.scale.y
            ).toFixed(2)
          : null,
      };
    };
  });

  const tree = () => page.evaluate(() => window.__tree(window.__t));
  const player = () => page.evaluate(() => window.__player());

  // -- 0. the forest is only breakable once the story says so ---------------
  //
  // Free roam has no cops to ditch, so `intro:finished` arms it at boot (see
  // TREES.breakableBy). Everything below depends on that having happened.
  console.log('\n— the forest is armed at all —');
  check('free roam arms the damage model at boot',
    await page.evaluate(() => TEKER.game.world.trees.breakable === true));

  // -- 1. a gentle nudge must not damage anything ---------------------------
  //
  // Driven directly rather than by rolling a car at it: over 7m of sloped
  // terrain gravity turns any "gentle" approach into a real hit, which tests
  // the terrain rather than the threshold.
  console.log('\n— a nudge below the impact floor —');
  const nudge = await page.evaluate(() => {
    const g = TEKER.game;
    const c = window.__pickTree();
    window.__t = c;
    const before = c.damage || 0;
    g.world.onImpact(g.player, c, 1000); // TREES.minImpactEnergy is 8000 J
    return { before, after: c.damage || 0, felled: !!c.felled };
  });
  console.log('   ', JSON.stringify(nudge));
  check('a nudge leaves the trunk alone', nudge.after === nudge.before, `damage=${nudge.after}`);
  check('…and it is still standing', !nudge.felled);
  let t = await tree();

  // -- 2 & 3. the damage model, driven directly ----------------------------
  //
  // Aiming a car at a specific trunk across procedural terrain is genuinely
  // unreliable — it can miss, or arrive at a speed the slope chose. The rules
  // being tested here are about arithmetic, not driving, so they are driven
  // through the same entry point the vehicle uses. Section 4 below does the
  // real thing with a real car.
  console.log('\n— a moderate hit —');
  const model = await page.evaluate(() => {
    const g = TEKER.game;
    const c = window.__t;
    const cap = c.radius * 165000;
    g.world.onImpact(g.player, c, cap * 0.4);
    const first = c.damage;
    const felledAfterFirst = !!c.felled;
    g.world.onImpact(g.player, c, cap * 0.4);
    return { cap: Math.round(cap), first: Math.round(first), second: Math.round(c.damage),
             felledAfterFirst, felled: !!c.felled };
  });
  console.log('   ', JSON.stringify(model));
  check('a real hit registers energy', model.first > 0, `${model.first} J`);
  check('under capacity, it stays up', model.felledAfterFirst === false);
  check('the trunk remembers the first hit', model.second > model.first,
    `${model.first} → ${model.second} of ${model.cap}`);
  check('two sub-capacity hits still leave it standing', model.felled === false);

  // -- 4. keep going until it comes down ------------------------------------
  console.log('\n— keep hitting until it goes —');
  for (let i = 0; i < 6 && !(await tree()).felled; i++) {
    await page.evaluate(() => window.__ram(window.__t, 14, 11));
    await sleep(2200);
  }
  t = await tree();
  console.log('   ', JSON.stringify(t));
  check('the tree comes down', t.felled, `damage=${t.damage} / ${t.capacity}`);
  check('a felled tree has no hitbox', t.disabled === true);
  check('…and no longer blocks line of sight where it stood', t.blocksSight === false);

  // -- 4a. BEFORE the chase, nothing is worn -------------------------------
  await sleep(600);
  let p = await player();
  console.log('   ', JSON.stringify(p));
  check('before the chase, a felled tree is NOT worn', p.wearing.length === 0, p.wearing.join(','));
  check('…and the car is not disguised', p.disguised === false);
  check('…but the tree still came down', t.felled === true);

  // Start the chase — that is what arms the disguise.
  await page.evaluate(() => {
    const m = TEKER.game.modes.current;
    window.__chase = m.startChase ? m.startChase({ rig: 'chaseWide' }) : null;
  });
  await sleep(400);
  check('the chase arms the disguise', await page.evaluate(() => TEKER.game.world.trees.armed === true));

  // Fell another one, now that there is something to hide from.
  await page.evaluate(() => {
    window.__t = window.__pickTree();
  });
  for (let i = 0; i < 6 && !(await tree()).felled; i++) {
    await page.evaluate(() => window.__ram(window.__t, 24, 13));
    await sleep(2200);
  }
  t = await tree();
  await sleep(600);
  p = await player();
  console.log('   ', JSON.stringify(p));
  check('after the chase starts, the tree IS worn', p.wearing.length === 1, p.wearing.join(','));
  check('the car is disguised', p.disguised === true);
  check('the worn cover is a fraction of the tree, not all of it',
    p.wornTris > 0 && p.wornTris < p.srcTris * 0.5, `${p.wornTris} of ${p.srcTris} triangles kept`);
  check('…and it is short enough to see over',
    p.wornWorldHeight > 1 && p.wornWorldHeight < 3, `${p.wornWorldHeight} m tall`);
  check('…and it sits level, with no slope', p.pitch === 0 && p.roll === 0,
    `pitch=${p.pitch} roll=${p.roll}`);
  console.log('    events:', await page.evaluate(() => window.__log.join(' | ')));

  // -- 4c. handbrake + throttle takes it off again --------------------------
  //
  // The disguise only works parked, so a player who no longer wants it would
  // otherwise be stuck with it. Both pedals together, held, is the way out.
  console.log('\n— shrugging the cover off —');
  const shed = await page.evaluate(async () => {
    const g = TEKER.game;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const scene = g.renderer.scene;
    const inWorld = () => scene.children.filter((o) => o.name?.startsWith('fallen:')).length;
    const before = { disguised: !!g.player.disguised, onCar: g.player.object.children.filter((o) => o.name?.startsWith('fallen:')).length, inWorld: inWorld() };

    // Throttle alone must not do it — otherwise the player sheds the cover the
    // moment they try to creep away from a hiding place still wearing it.
    const onlyGas = g.input.pushOverride((s) => { s.throttle = 1; s.handbrake = 0; });
    await sleep(900);
    const gasOnly = { disguised: !!g.player.disguised };
    onlyGas();

    // Both, held past TREES.shed.hold.
    const release = g.input.pushOverride((s) => { s.throttle = 1; s.handbrake = 1; });
    await sleep(900);
    release();
    return {
      before,
      gasOnly,
      after: {
        disguised: !!g.player.disguised,
        onCar: g.player.object.children.filter((o) => o.name?.startsWith('fallen:')).length,
        inWorld: inWorld(),
      },
    };
  });
  console.log('   ', JSON.stringify(shed));
  check('the gas alone does not shed the cover', shed.gasOnly.disguised === true);
  check('handbrake + throttle sheds it', shed.after.disguised === false);
  check('…it comes off the car', shed.before.onCar === 1 && shed.after.onCar === 0);
  check('…and is left standing in the world rather than deleted',
    shed.after.inWorld === shed.before.inWorld + 1);
  check('…and it is announced, so anything watching can react',
    await page.evaluate(() => window.__log.some((l) => l.startsWith('vehicle:undisguised'))));

  if (SHOTS) {
    // Pull away and look back at what was left behind.
    await page.evaluate(async () => {
      const g = TEKER.game;
      g.camera.setRig('chaseWide');
      const release = g.input.pushOverride((s) => { s.throttle = 1; });
      await new Promise((r) => setTimeout(r, 3200));
      release();
    });
    await sleep(2000);
    await page.screenshot({ path: `${SHOTS}/tree-shed.png` });
  }

  // -- 4b. a damaged tree must LOOK damaged ---------------------------------
  console.log('\n— a damaged tree is visibly different —');
  const look = await page.evaluate(() => {
    const g = TEKER.game;
    const c = window.__pickTree();
    if (!c) return null;
    const read = () => {
      const m = new (Object.getPrototypeOf(c.baseMatrix).constructor)();
      c.mesh.getMatrixAt(c.instance, m);
      const col = { r: 0, g: 0, b: 0 };
      const arr = c.mesh.instanceColor.array;
      col.r = arr[c.instance * 3];
      col.g = arr[c.instance * 3 + 1];
      col.b = arr[c.instance * 3 + 2];
      return { m: [...m.elements], col };
    };
    const before = read();
    // One solid but sub-capacity hit.
    c.capacity = c.capacity ?? c.radius * 165000;
    g.world.onImpact(g.player, c, c.capacity * 0.6);
    const after = read();
    window.__dmg = c;
    return {
      damage: Math.round(c.damage),
      capacity: Math.round(c.capacity),
      felled: !!c.felled,
      matrixChanged: before.m.some((v, i) => Math.abs(v - after.m[i]) > 1e-6),
      tintChanged: Math.abs(before.col.r - after.col.r) > 1e-3,
      darker: after.col.r < before.col.r,
      browner: after.col.b < after.col.r,
      x: c.x,
      z: c.z,
    };
  });
  console.log('   ', JSON.stringify(look));
  check('a damaged trunk is still standing', look && !look.felled);
  check('…it leans (instance matrix changed)', look && look.matrixChanged === true);
  check('…and it darkens', look && look.tintChanged === true && look.darker === true);
  check('…toward a browner, splintered tone', look && look.browner === true);

  if (SHOTS) {
    // Park the player looking at the damaged tree so it can be eyeballed
    // against its healthy neighbours.
    await page.evaluate(() => {
      const g = TEKER.game;
      const c = window.__dmg;
      const v = g.player;
      const a = Math.atan2(c.x, c.z);
      const x = c.x - Math.sin(a) * 16;
      const z = c.z - Math.cos(a) * 16;
      v.reset(new v.position.constructor(x, g.world.sampleGround(x, z).height + 0.6, z), a);
      v.velocity.set(0, 0, 0);
      g.camera.setRig('chaseWide');
    });
    await sleep(1800);
    await page.screenshot({ path: `${SHOTS}/tree-damaged.png` });
  }

  // -- 5. the disguise is what the cops care about --------------------------
  console.log('\n— what the cops see —');
  const seen = await page.evaluate(() => {
    const g = TEKER.game;
    const mode = g.modes.current;
    const chase = window.__chase || (mode.startChase ? mode.startChase({ rig: 'chaseWide' }) : null);
    if (!chase) return null;
    const cop = chase.cops?.[0]?.vehicle;
    if (!cop) return null;
    const v = g.player;

    // Stand on open tarmac. Scatter is kept clear of the tracks, so this is the
    // one place we can be sure the occlusion raycast is not doing the hiding
    // for us — otherwise "the cop cannot see you" proves nothing about trees.
    const t = g.world.getTrack('track1');
    const i = t.startLine.sample;
    v.reset(new v.position.constructor(t.px[i], t.py[i] + 0.6, t.pz[i]), Math.atan2(t.tx[i], t.tz[i]));

    // Put a cop right in front of the player, looking straight at them.
    cop.position.set(v.position.x + Math.sin(v.heading) * 20, v.position.y, v.position.z + Math.cos(v.heading) * 20);
    cop.heading = v.heading + Math.PI;
    v.velocity.set(0, 0, 0);
    v.speed = 0;

    // Control: without the tree, can they see this spot at all?
    v.disguised = false;
    const baseline = chase._canSee(cop);
    v.disguised = true;
    // `_canSee` reads the cached `speed`, which only refreshes in fixedUpdate —
    // set it directly rather than waiting a frame.
    v.speed = 0;
    const still = chase._canSee(cop);
    v.velocity.set(Math.sin(v.heading) * 25, 0, Math.cos(v.heading) * 25);
    v.speed = 25;
    const moving = chase._canSee(cop);
    return { baseline, still, moving, disguised: !!v.disguised };
  });
  console.log('   ', JSON.stringify(seen));
  check('control: an undisguised car IS seen from 20m', seen && seen.baseline === true);
  check('a cop 20m away cannot see a parked tree', seen && seen.still === false);
  check('…but a tree doing 90 km/h is not camouflage', seen && seen.moving === true);

  if (SHOTS) {
    await page.evaluate(() => {
      const g = TEKER.game;
      g.player.velocity.set(0, 0, 0);
      g.camera.setRig('chaseWide');
    });
    await sleep(1500);
    await page.screenshot({ path: `${SHOTS}/tree-disguise.png` });
  }

  // -- 6. the forest must survive the car being torn down -------------------
  console.log('\n— despawn the wearer —');
  const survived = await page.evaluate(() => {
    const g = TEKER.game;
    const mesh = window.__t.mesh;
    g.despawnVehicle(g.player);
    // If the shared instanced geometry had been disposed, its attributes go.
    return { hasGeometry: !!mesh.geometry?.attributes?.position, instances: mesh.count };
  });
  check('felling a tree does not dispose the forest it came from',
    survived.hasGeometry === true, JSON.stringify(survived));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
