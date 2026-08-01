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

// -- which way is right? -----------------------------------------------------
// Mirrored steering is not a subtle bug to play but it IS a subtle bug to read,
// because every sign in the file is individually plausible. Pin it down.
{
  const car = new Vehicle({ profile: 'hatchback', world: flat, id: 'steer' });
  car.reset(new THREE.Vector3(0, 0, 0), 0); // heading 0 → facing +Z
  car.velocity.set(0, 0, 25);
  simulate(car, 120 * 2, () => ({ throttle: 0.4, brake: 0, steer: 1, handbrake: 0 }));

  // Camera sits behind on -Z looking toward +Z, so screen-right is world -X.
  ok(
    'steer +1 turns the car to the driver\'s right',
    car.position.x < -2,
    `moved to x=${car.position.x.toFixed(1)} (screen-right is -x)`
  );
  const fresh = new Vehicle({ profile: 'hatchback', world: flat, id: 'basis' });
  fresh.reset(new THREE.Vector3(0, 0, 0), 0);
  ok(
    '...and right is forward × up at heading 0',
    fresh.right.x < -0.99 && Math.abs(fresh.forward.z - 1) < 0.01,
    `forward=(${fresh.forward.x.toFixed(2)}, 0, ${fresh.forward.z.toFixed(2)}) right=(${fresh.right.x.toFixed(2)}, 0, ${fresh.right.z.toFixed(2)})`
  );

  const mirror = new Vehicle({ profile: 'hatchback', world: flat, id: 'steer2' });
  mirror.reset(new THREE.Vector3(0, 0, 0), 0);
  mirror.velocity.set(0, 0, 25);
  simulate(mirror, 120 * 2, () => ({ throttle: 0.4, brake: 0, steer: -1, handbrake: 0 }));
  ok('steer -1 turns left, symmetrically', mirror.position.x > 2 && Math.abs(mirror.position.x + car.position.x) < 0.5,
    `x=${mirror.position.x.toFixed(1)} vs ${car.position.x.toFixed(1)}`);

  // And the keyboard has to agree: D is `right`, which must produce steer > 0.
  const { BINDINGS } = await import('../src/core/input.js');
  ok('D is bound to right, A to left', BINDINGS.right.includes('KeyD') && BINDINGS.left.includes('KeyA'));
  ok('arrows agree', BINDINGS.right.includes('ArrowRight') && BINDINGS.left.includes('ArrowLeft'));
}

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
      // Negated: `angle` is a heading delta, `steer` is positive-is-right, and
      // heading decreases when turning right. Same rule as AiDriver#_steerTo.
      steer = Math.max(-1, Math.min(1, -Math.atan2(Math.sin(angle), Math.cos(angle)) * 2.0));
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

// -- oriented boxes -----------------------------------------------------------
// A guardrail is a long thin box laid ALONG the track. If its local frame is
// built the wrong way round it is correct at multiples of 90° and silently
// rotated everywhere between, so on a curve the rail becomes a wall across the
// road. The barrier is drawn in the right place either way, so it presents as
// "invisible boxes near the barriers".
{
  const { CollisionGrid } = await import('../src/world/collision.js');
  let worstAcross = 0;
  let worstAlong = Infinity;
  for (const deg of [0, 20, 45, 70, 90, 135, 200, 310]) {
    const h = (deg * Math.PI) / 180;
    const grid = new CollisionGrid(12);
    // Same shape the track builds: 0.44m thick, 6m long, laid along heading h.
    grid.insert({ type: 'box', x: 0, y: 0, z: 0, halfX: 0.22, halfY: 0.5, halfZ: 3.0, rotationY: h });
    // forward = (sin h, cos h); across = (cos h, -sin h)
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const ax = Math.cos(h);
    const az = -Math.sin(h);
    // 2.5m along the rail must still be inside it…
    const along = new THREE.Vector3(fx * 2.5, 0, fz * 2.5);
    if (grid.resolve(along, 0.3)) worstAlong = Math.min(worstAlong, 1);
    else worstAlong = 0;
    // …and 2.0m out to the side must be nowhere near it.
    const across = new THREE.Vector3(ax * 2.0, 0, az * 2.0);
    if (grid.resolve(across, 0.3)) worstAcross++;
  }
  ok('oriented boxes stay solid along their length', worstAlong === 1);
  ok(
    'oriented boxes are thin across their width at every angle',
    worstAcross === 0,
    `${worstAcross} of 8 angles reported a phantom hit 2m to the side`
  );
}

// -- the car's own footprint --------------------------------------------------
{
  const car = new Vehicle({ profile: 'hatchback', world: flat, id: 'shape' });
  const T = car.tuning;
  ok(
    'car hitbox is as wide as the car, not as long',
    car.collisionRadius < T.halfExtents.x * 1.2,
    `radius ${car.collisionRadius.toFixed(2)}m vs half-width ${T.halfExtents.x}m`
  );
  const span = Math.max(...car.collisionProbes) + car.collisionRadius;
  ok(
    '...and its probes still cover the full length',
    Math.abs(span - T.halfExtents.z) < 0.05,
    `covers ${span.toFixed(2)}m of ${T.halfExtents.z}m`
  );

  // Drive down the middle of a barriered straight and touch nothing.
  const t1 = world.getTrack('track1');
  const q2 = {};
  let clipped = 0;
  for (let i = 0; i < t1.count; i += 4) {
    const probe = new THREE.Vector3(t1.px[i], t1.py[i] + 0.5, t1.pz[i]);
    car.reset(probe, Math.atan2(t1.tx[i], t1.tz[i]));
    for (let p = 0; p < car.collisionProbes.length; p++) {
      if (world.collide(car.probePosition(p), car.collisionRadius)) clipped++;
    }
  }
  ok(
    'the racing line is clear of barriers all the way round',
    clipped === 0,
    `${clipped} phantom contacts on the centreline of ${t1.id}`
  );

  // How far off the racing line can you get before you touch the Armco? This is
  // the number the player actually feels. It should be just past the edge of the
  // tarmac — not well inside it, which is what "invisible boxes" means.
  const contactAt = [];
  for (const frac of [0.08, 0.21, 0.34, 0.47, 0.6, 0.73, 0.86, 0.95]) {
    const i = t1.sampleIndexAt(frac);
    const hw = t1.halfWidth[i];
    let firstTouch = null;
    for (let off = 0; off < hw + 4; off += 0.05) {
      const p = new THREE.Vector3(
        t1.px[i] + t1.rx[i] * off,
        t1.py[i] + 0.5,
        t1.pz[i] + t1.rz[i] * off
      );
      car.reset(p, Math.atan2(t1.tx[i], t1.tz[i]));
      let hit = false;
      for (let k = 0; k < car.collisionProbes.length; k++) {
        if (world.collide(car.probePosition(k), car.collisionRadius)) hit = true;
      }
      if (hit) {
        firstTouch = off - hw; // metres past the tarmac edge
        break;
      }
    }
    contactAt.push(firstTouch ?? 99);
  }
  const worst = Math.min(...contactAt);
  ok(
    'you can reach the edge of the tarmac before the barrier stops you',
    worst > -0.15,
    `nearest contact ${worst.toFixed(2)}m relative to the tarmac edge (negative = stopped early)`
  );
}

// -- car on car ---------------------------------------------------------------
{
  const { resolveVehicleContacts, CONTACT } = await import('../src/vehicle/contacts.js');
  const mk = (id, x, z, vz) => {
    const v = new Vehicle({ profile: 'hatchback', world: flat, id });
    v.reset(new THREE.Vector3(x, 0, z), 0);
    v.velocity.set(0, 0, vz);
    return v;
  };

  // Rear-ending: the faster car behind must slow, the one in front must speed up.
  const behind = mk('behind', 0, 0, 30);
  const ahead = mk('ahead', 0, 4.0, 12);
  for (let i = 0; i < 120; i++) {
    behind.fixedUpdate(DT);
    ahead.fixedUpdate(DT);
    resolveVehicleContacts([behind, ahead], DT);
  }
  ok(
    'a rear-end transfers momentum',
    behind.velocity.z < 30 && ahead.velocity.z > 12,
    `${behind.velocity.z.toFixed(1)} m/s into ${ahead.velocity.z.toFixed(1)} m/s`
  );
  const gap = ahead.position.z - behind.position.z;
  ok('...and the cars do not end up inside each other', gap > 3.4, `gap ${gap.toFixed(2)}m`);

  // Without the pass they would pass straight through — check that directly.
  const ghostA = mk('ga', 0, 0, 30);
  const ghostB = mk('gb', 0, 4.0, 12);
  for (let i = 0; i < 120; i++) {
    ghostA.fixedUpdate(DT);
    ghostB.fixedUpdate(DT);
  }
  ok(
    'without the contact pass they overlap (proving the test is live)',
    ghostA.position.z > ghostB.position.z,
    `${ghostA.position.z.toFixed(1)} vs ${ghostB.position.z.toFixed(1)}`
  );

  // Side-swipe: a glancing hit should push the other car sideways and spin it.
  const meA = mk('sa', 0, 0, 26);
  const meB = mk('sb', 1.5, 1.0, 26);
  const headingBefore = meB.heading;
  for (let i = 0; i < 90; i++) {
    meA.velocity.x = 3; // steer into them
    meA.fixedUpdate(DT);
    meB.fixedUpdate(DT);
    resolveVehicleContacts([meA, meB], DT);
  }
  ok('a side-swipe shoves the other car sideways', meB.position.x > 1.8, `x=${meB.position.x.toFixed(2)}`);
  ok('...and disturbs its heading', Math.abs(meB.heading - headingBefore) > 0.002,
    `Δheading ${(meB.heading - headingBefore).toFixed(4)}`);

  // A heavier car should win the exchange.
  const light = mk('light', 0, 0, 28);
  const heavy = new Vehicle({ profile: 'cruiser', world: flat, id: 'heavy' });
  heavy.reset(new THREE.Vector3(0, 0, 4.0), 0);
  heavy.velocity.set(0, 0, 10);
  const lightStart = light.position.x;
  for (let i = 0; i < 120; i++) {
    light.fixedUpdate(DT);
    heavy.fixedUpdate(DT);
    resolveVehicleContacts([light, heavy], DT);
  }
  ok(
    'mass decides who moves',
    Math.abs(light.velocity.z - 28) > Math.abs(heavy.velocity.z - 10),
    `light lost ${(28 - light.velocity.z).toFixed(1)}, heavy gained ${(heavy.velocity.z - 10).toFixed(1)}`
  );
}

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
