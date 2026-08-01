/**
 * Headless checks. `npm test`.
 *
 * Everything here runs in plain Node with no WebGL and no DOM: three.js only
 * needs a GPU when you actually render, so the world, the tracks and the whole
 * physics model can be built and driven in a terminal.
 *
 * The interesting one is TEST 5. The third parkour's escape is the load-bearing
 * moment of the entire game, and it is produced by physics rather than by a
 * script — which means it can silently stop working when the car is retuned.
 * So we drive it, every time, and assert that the car actually ends up outside.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as THREE from 'three';

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
  } else {
    failures++;
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? `  ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
section('1. every module imports cleanly');

// `main.js` is an entry point — importing it starts a game. Excluded here and
// covered by the source checks in section 2 instead.
const files = walk('src')
  .filter((f) => !f.includes('/ui/') || f.endsWith('index.js'))
  .filter((f) => !f.endsWith('main.js'));
for (const f of files) {
  try {
    await import('./../' + f.replace(/\\/g, '/'));
    ok(relative('.', f), true);
  } catch (err) {
    ok(relative('.', f), false, err.message.split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
section('2. the intro is deletable (nothing imports it but main.js)');

const allFiles = walk('src');
const offenders = [];
for (const f of allFiles) {
  if (f.includes('game/intro/')) continue;
  const src = readFileSync(f, 'utf8');
  const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const imp of imports) {
    if (imp.includes('intro/') && !f.endsWith('main.js')) offenders.push(`${f} → ${imp}`);
  }
}
ok('no non-main module imports src/game/intro/', offenders.length === 0, offenders.join(', '));

const mainSrc = readFileSync('src/main.js', 'utf8');
const mainIntroImports = [...mainSrc.matchAll(/from\s+['"]([^'"]*intro\/[^'"]*)['"]/g)];
ok('main.js is the single intro import', mainIntroImports.length === 1, mainIntroImports[0]?.[1] ?? 'none');

// The intro must not be reachable through a side door either: the modes it
// stages have to work when it is gone.
for (const f of ['src/game/modes/raceMode.js', 'src/game/modes/openWorldMode.js', 'src/game/chase.js', 'src/game/game.js']) {
  const src = readFileSync(f, 'utf8');
  ok(`${relative('.', f)} is intro-free`, !/from\s+['"][^'"]*intro/.test(src));
}

// ---------------------------------------------------------------------------
section('3. config resolves');

const { resolveProfile, PROFILES, SURFACES, samplePowerCurve } = await import('../src/config/tuning.js');
const { resolveTheme, THEMES, resolveRenderPreset, RENDER_PRESETS } = await import('../src/config/style.js');
const { resolveRig, CAMERA_RIGS } = await import('../src/config/camera.js');

for (const name of Object.keys(PROFILES)) {
  const p = resolveProfile(name);
  ok(`profile "${name}"`, p.engineForce > 0 && p.maxSteer > 0 && p.lateralGrip > 0);
}
for (const name of Object.keys(THEMES)) {
  const t = resolveTheme(name);
  ok(`theme "${name}"`, !!t.fog && !!t.ground.base && !!t.vehicles && !!t.grade);
}
for (const name of Object.keys(RENDER_PRESETS)) ok(`render preset "${name}"`, !!resolveRenderPreset(name));
for (const name of Object.keys(CAMERA_RIGS)) {
  const r = resolveRig(name);
  ok(`camera rig "${name}"`, typeof r.offset?.z === 'number' && r.fov > 0);
}
ok('power curve endpoints', samplePowerCurve([1, 0.5, 0], 0) === 1 && samplePowerCurve([1, 0.5, 0], 1) === 0);

// ---------------------------------------------------------------------------
section('4. the world builds');

const { MaterialLibrary } = await import('../src/render/materials.js');
const { World } = await import('../src/world/world.js');
const { ALL_TRACKS } = await import('../src/world/tracks/index.js');
const { ROAD } = await import('../src/world/track.js');

const theme = resolveTheme('forest');
const preset = resolveRenderPreset('psx');
const materials = new MaterialLibrary(theme, preset);

const t0 = Date.now();
const world = new World({ materials, theme, seed: 0x7e4e17 });
await world.build({ trackData: ALL_TRACKS, scatter: true });
const buildMs = Date.now() - t0;

ok('three tracks exist', world.tracks.size === 3, [...world.tracks.keys()].join(', '));
ok('build time is sane', buildMs < 30000, `${buildMs}ms`);

let triangles = 0;
world.root.traverse((o) => {
  if (o.geometry?.index) triangles += o.geometry.index.count / 3;
  else if (o.geometry?.attributes.position) triangles += (o.geometry.attributes.position.count / 3) * (o.count || 1);
});
ok('world has geometry', triangles > 50000, `${Math.round(triangles / 1000)}k triangles`);
ok('collision grid populated', world.collision.count > 1000, `${world.collision.count} colliders`);

for (const t of world.tracks.values()) {
  ok(`${t.id} "${t.name}"`, t.count > 100 && t.length > 500, `${Math.round(t.length)}m, ${t.count} samples`);
}

// The road must be flat under the car, not stepped by the coarse heightfield.
const t3 = world.getTrack('track3');
let maxStep = 0;
for (let i = 0; i < t3.count; i += 3) {
  const a = world.sampleGround(t3.px[i], t3.pz[i]).height;
  const j = (i + 3) % t3.count;
  const b = world.sampleGround(t3.px[j], t3.pz[j]).height;
  maxStep = Math.max(maxStep, Math.abs(b - a));
}
ok('road surface is smooth', maxStep < 2.2, `max step ${maxStep.toFixed(2)}m over 9m`);

// Winding. A back-facing surface does not look broken, it looks *absent* —
// you see through it to whatever is behind. The road shipped inside-out once
// and presented as "the tarmac renders as grass".
for (const id of ['track1', 'track2', 'track3']) {
  const group = world.root.getObjectByName(`track:${id}`);
  let worstUp = 1;
  let checked = 0;
  for (const meshName of ['road', 'roadDecals', 'startLine']) {
    const mesh = group?.getObjectByName(meshName);
    const n = mesh?.geometry?.getAttribute('normal');
    if (!n) continue;
    for (let i = 0; i < n.count; i += 7) {
      worstUp = Math.min(worstUp, n.getY(i));
      checked++;
    }
  }
  ok(
    `${id} road faces up`,
    checked > 0 && worstUp > 0.3,
    `${checked} normals checked, worst up-component ${worstUp.toFixed(3)}`
  );
}

// The ice patch has to actually be ice where the data says it is.
const iceSamples = t3.surfaces.filter((s) => s === 'ICE').length;
ok('parkur 3 has an ice section', iceSamples > 20, `${iceSamples} samples`);
// Read the gap from the data rather than hard-coding it, so moving the corner
// cannot leave this test silently checking the wrong stretch of road.
const gap = t3.data.barriers.gaps[0];
const gapColliders = t3.colliders.filter((c) => {
  const t = c.sample / t3.count;
  return t > gap.from && t < gap.to;
});
ok(
  'parkur 3 has a hole in its barrier',
  gapColliders.length === 0,
  `${gapColliders.length} barriers between ${gap.from} and ${gap.to}`
);
// …and the hole has to cover the ice, or the player bounces off Armco instead
// of discovering there is a world out there.
const iceRange = t3.data.patches.filter((p) => p.surface === 'ICE');
ok(
  'the hole covers the ice',
  iceRange.every((p) => p.from >= gap.from && p.to <= gap.to),
  `ice ${iceRange[0].from}–${iceRange[0].to} inside gap ${gap.from}–${gap.to}`
);
ok('parkur 1 is fully enclosed', world.getTrack('track1').colliders.length > 100);

// ---------------------------------------------------------------------------
section('5. physics — and the escape actually happens');

const { Vehicle } = await import('../src/vehicle/vehicle.js');
const { AiDriver } = await import('../src/vehicle/ai.js');

const DT = 1 / 120;
function simulate(vehicle, steps, driver) {
  for (let i = 0; i < steps; i++) {
    vehicle.setCommand(driver(vehicle, DT, i * DT));
    vehicle.fixedUpdate(DT);
  }
}

// -- straight-line performance ----------------------------------------------
const flat = {
  sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0), surface: 'TARMAC' }),
  collide: () => null,
};
const test = new Vehicle({ profile: 'hatchback', world: flat, id: 'test' });
test.reset(new THREE.Vector3(0, 0, 0), 0);

let timeTo100 = null;
simulate(test, 120 * 30, (v, dt, t) => {
  if (timeTo100 === null && v.speed * 3.6 >= 100) timeTo100 = t;
  return { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
});
const topSpeed = test.speed * 3.6;
ok('0–100 km/h is arcade-quick', timeTo100 > 2 && timeTo100 < 9, `${timeTo100?.toFixed(2)}s`);
ok('top speed is sane', topSpeed > 120 && topSpeed < 260, `${topSpeed.toFixed(0)} km/h`);

// -- braking -----------------------------------------------------------------
// Note: holding `brake` past a standstill engages reverse, by design. Measure
// the time to stop, not the speed after a fixed window.
const before = test.speed;
let timeToStop = null;
simulate(test, 120 * 4, (v, dt, t) => {
  if (timeToStop === null && v.longSpeed < 0.5) timeToStop = t;
  return { throttle: 0, brake: 1, steer: 0, handbrake: 0 };
});
ok(
  'brakes stop the car',
  timeToStop !== null && timeToStop < 4,
  `${before.toFixed(0)} m/s → stopped in ${timeToStop?.toFixed(2)}s`
);
ok('holding brake past zero reverses', test.longSpeed < -1, `${test.longSpeed.toFixed(1)} m/s`);

// -- grip: the same corner on tarmac and on ice ------------------------------
function corneringRadius(surfaceId) {
  const ground = {
    sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0), surface: surfaceId }),
    collide: () => null,
  };
  const v = new Vehicle({ profile: 'hatchback', world: ground, id: 's' });
  v.reset(new THREE.Vector3(0, 0, 0), 0);
  v.velocity.set(0, 0, 30);
  simulate(v, 120 * 3, () => ({ throttle: 0.5, brake: 0, steer: 1, handbrake: 0 }));
  return { lateral: Math.abs(v.position.x), heading: v.heading, slip: v.slip };
}
const onTarmac = corneringRadius('TARMAC');
const onIce = corneringRadius('ICE');
ok(
  'ice understeers badly vs tarmac',
  Math.abs(onIce.heading) < Math.abs(onTarmac.heading) * 0.75,
  `turned ${((onTarmac.heading * 180) / Math.PI).toFixed(0)}° on tarmac vs ${((onIce.heading * 180) / Math.PI).toFixed(0)}° on ice`
);

// -- THE ESCAPE --------------------------------------------------------------
const { BREAKOUT } = await import('../src/config/gameplay.js');
const q = {};

/**
 * A player, not an AI.
 *
 * The distinction matters. `AiDriver` re-reads the surface it is standing on
 * every step, so it starts respecting the ice the instant it touches it. A
 * human on their first lap does not know the corner is coming, arrives at
 * racing speed, and needs about a third of a second to notice anything is wrong
 * and react. That is who the trap has to work on.
 */
function playerModel(track, { reaction = 0.35, lookahead = 18 } = {}) {
  const history = [];
  const goal = new THREE.Vector3();
  return (v, dt) => {
    const r = track.query(v.position.x, v.position.z, q);
    let steer = 0;
    if (r) {
      track.ahead(r.index, lookahead + v.speed * 0.35, goal);
      const dx = goal.x - v.position.x;
      const dz = goal.z - v.position.z;
      const angle = Math.atan2(dx, dz) - v.heading;
      steer = Math.max(-1, Math.min(1, Math.atan2(Math.sin(angle), Math.cos(angle)) * 2.0));
    }
    // Delayed perception of the slide.
    history.push(v.slip);
    const delayed = history.length > reaction / dt ? history.shift() : 0;
    const panicBrake = delayed > 0.85 ? 0.6 : 0;
    return { throttle: panicBrake > 0 ? 0 : 1, brake: panicBrake, steer, handbrake: 0 };
  };
}

function runCorner(driverFactory, label, profile = 'hatchback', ignoreSurfaces = false) {
  const startIndex = t3.sampleIndexAt(0.42);
  const car = new Vehicle({ profile, world, id: label });
  car.ignoreSurfaces = ignoreSurfaces;
  car.reset(
    new THREE.Vector3(t3.px[startIndex], t3.py[startIndex] + 0.5, t3.pz[startIndex]),
    Math.atan2(t3.tx[startIndex], t3.tz[startIndex])
  );
  car.velocity.set(car.forward.x * 36, 0, car.forward.z * 36);
  const drive = driverFactory(car);
  let maxOff = 0;
  let offFor = 0;
  let peakOffFor = 0;
  let entrySpeed = 0;
  simulate(car, 120 * 24, (v, dt) => {
    const cmd = drive(v, dt);
    const r = t3.query(v.position.x, v.position.z, q);
    if (r && r.surface === 'ICE' && entrySpeed === 0) entrySpeed = v.speed;
    // A null query means the car is outside the track's spatial hash entirely —
    // further off than any number the hash can report.
    const edge = r ? r.dist - r.halfWidth : Infinity;
    if (edge > 0) {
      maxOff = Math.max(maxOff, edge);
      offFor += dt;
      peakOffFor = Math.max(peakOffFor, offFor);
    } else offFor = 0;
    return cmd;
  });
  return { maxOff, peakOffFor, entrySpeed, car };
}

const human = runCorner((v) => playerModel(t3), 'escapee');
const wouldTrigger =
  human.maxOff > BREAKOUT.escapeDistance ||
  (human.maxOff > 30 && human.peakOffFor > BREAKOUT.escapeHoldSeconds);
ok(
  'a player arrives at the ice carrying speed',
  human.entrySpeed > 28,
  `${(human.entrySpeed * 3.6).toFixed(0)} km/h at the ice`
);
ok(
  'and loses the car completely',
  human.maxOff > 30,
  human.maxOff === Infinity
    ? `left the track network entirely, for ${human.peakOffFor.toFixed(1)}s`
    : `ran ${human.maxOff.toFixed(0)}m past the ribbon edge for ${human.peakOffFor.toFixed(1)}s`
);
ok('...far enough to trigger the breakout', wouldTrigger, `threshold ${BREAKOUT.escapeDistance}m`);

// The AI can feel the ice the instant it touches it and still gets thrown well
// off the road. It recovers where a human would not, which is the correct
// outcome: the corner is unfair to reflexes, not impossible in principle.
const ai = runCorner(
  (v) => {
    const d = new AiDriver(v, { track: t3, skill: 0.85, aggression: 0.7, seed: 9, world });
    return (_, dt) => d.update(dt);
  },
  'ai-escapee'
);
ok(
  'even a perfect line gets thrown off the road',
  ai.maxOff > 5,
  `${ai.maxOff.toFixed(1)}m past the edge (it recovers; a human does not)`
);

// -- the rivals must NOT go off ---------------------------------------------
// They are part of the track (Vehicle#ignoreSurfaces), so the ice is not there
// for them. If this ever fails the whole field slides off and the moment reads
// as a bug rather than as something happening to you specifically.
const rival = runCorner(
  (v) => {
    const d = new AiDriver(v, { track: t3, skill: 0.85, aggression: 0.6, seed: 3, world });
    return (_, dt) => d.update(dt);
  },
  'rival',
  'rival',
  true
);
ok(
  'the rivals take the same corner cleanly',
  rival.maxOff < 6,
  `stayed within ${rival.maxOff.toFixed(1)}m of the ribbon`
);

// -- collision ----------------------------------------------------------------
const tree = world.scatter.colliders.find((c) => c.type === 'cylinder' && c.radius > 0.8);
if (tree) {
  // Direct query first: is the grid even reporting the overlap?
  const probe = new THREE.Vector3(tree.x, tree.y, tree.z);
  ok('collision grid finds a tree', !!world.collide(probe, 1.7), `r=${tree.radius.toFixed(2)}`);
  const clear = new THREE.Vector3(tree.x + 60, tree.y, tree.z + 60);
  ok('collision grid reports empty space as empty', !world.collide(clear, 1.7));

  // Then drive into it from close range, where terrain drift cannot make us miss.
  const hitCar = new Vehicle({ profile: 'hatchback', world, id: 'crash' });
  hitCar.reset(new THREE.Vector3(tree.x, 0, tree.z - 9), 0);
  hitCar.velocity.set(0, 0, 22);
  simulate(hitCar, 120 * 3, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }));
  const passedThrough = hitCar.position.z > tree.z + 4;
  ok('trees are solid', !passedThrough, passedThrough ? 'drove straight through' : 'stopped by the trunk');
}

// ---------------------------------------------------------------------------
section('6. seed determinism');
const worldB = new World({ materials, theme, seed: 0x7e4e17 });
await worldB.build({ trackData: ALL_TRACKS, scatter: false });
const sampleA = world.terrain.heightAt(123, -456);
const sampleB = worldB.terrain.heightAt(123, -456);
ok('same seed, same terrain', Math.abs(sampleA - sampleB) < 1e-6, `${sampleA.toFixed(4)} vs ${sampleB.toFixed(4)}`);

// ---------------------------------------------------------------------------
console.log(
  `\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${checks - failures}/${checks} checks passed\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
