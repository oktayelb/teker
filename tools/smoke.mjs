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

// ---------------------------------------------------------------------------
// THE GROUND YOU CAN SEE IS THE GROUND YOU DRIVE ON
//
// `Terrain#heightAt` used to interpolate bilinearly while the mesh was
// triangulated with an alternating diagonal. Those are two different surfaces:
// they agree at the corners of a cell and nowhere else, and at the centre they
// differ by the cell's twist. On natural ground that is centimetres; where a
// track's shaper flattens the land beside the road it reached 3.9m, and the
// car was parked 3.5m below the hill it was standing on. This is the check
// that stops the sampler and the mesh builder ever drifting apart again.
{
  const { cellIsAntiDiagonal, cellTriangleHeight } = await import('../src/world/terrain.js');
  const terrain = world.terrain;
  const n = terrain.gridSize;
  const cs = terrain.cellSize;
  const half = terrain.halfSpan;

  /**
   * Height read straight off the rendered chunk geometry: find the triangle
   * containing (x, z) by barycentric test and evaluate its plane. This is
   * deliberately NOT a call into Terrain — it reads the index buffer the GPU
   * gets, so nothing about the sampler can make it agree by construction.
   */
  const chunkFor = (x, z) => {
    for (const mesh of terrain.chunks) {
      const pos = mesh.geometry.getAttribute('position');
      const idx = mesh.geometry.index;
      const bb = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox);
      if (x < bb.min.x - 0.01 || x > bb.max.x + 0.01 || z < bb.min.z - 0.01 || z > bb.max.z + 0.01) continue;
      for (let f = 0; f < idx.count; f += 3) {
        const a = idx.getX(f), b = idx.getX(f + 1), c = idx.getX(f + 2);
        const ax = pos.getX(a), az = pos.getZ(a);
        const bx = pos.getX(b), bz = pos.getZ(b);
        const cx = pos.getX(c), cz = pos.getZ(c);
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        return l1 * pos.getY(a) + l2 * pos.getY(b) + l3 * pos.getY(c);
      }
    }
    return null;
  };

  let worstMesh = 0;
  let checkedMesh = 0;
  for (let k = 0; k < 400; k++) {
    // Concentrated near the tracks, which is where the shaper makes the twist
    // large and where the player actually is.
    const tr = t3;
    const i = Math.floor((k / 400) * tr.count);
    const off = ((k * 37) % 61) - 30;
    const x = tr.px[i] + tr.rx[i] * off;
    const z = tr.pz[i] + tr.rz[i] * off;
    if (!terrain.contains(x, z)) continue;
    const fromMesh = chunkFor(x, z);
    if (fromMesh === null) continue;
    checkedMesh++;
    worstMesh = Math.max(worstMesh, Math.abs(terrain.heightAt(x, z) - fromMesh));
  }
  ok(
    'sampled ground matches the triangle the GPU is drawing',
    checkedMesh > 300 && worstMesh < 0.01,
    `${checkedMesh} points beside parkur 3, worst disagreement ${worstMesh.toFixed(5)}m`
  );

  // The same thing over the whole world, cheaply, against the shared helper.
  let worstAll = 0;
  let biggestTwist = 0;
  for (let k = 0; k < 120000; k++) {
    const x = (((k * 2654435761) >>> 0) / 4294967296 * 2 - 1) * half * 0.98;
    const z = (((k * 40503 + 12345) % 65536) / 65536 * 2 - 1) * half * 0.98;
    const fx = (x + half) / cs;
    const fz = (z + half) / cs;
    const i = Math.min(Math.max(Math.floor(fx), 0), n - 2);
    const j = Math.min(Math.max(Math.floor(fz), 0), n - 2);
    const row = j * n + i;
    const h00 = terrain.heights[row], h10 = terrain.heights[row + 1];
    const h01 = terrain.heights[row + n], h11 = terrain.heights[row + n + 1];
    const expect = cellTriangleHeight(h00, h10, h01, h11, fx - i, fz - j, cellIsAntiDiagonal(i, j));
    worstAll = Math.max(worstAll, Math.abs(terrain.heightAt(x, z) - expect));
    biggestTwist = Math.max(biggestTwist, Math.abs((h00 + h11 - h01 - h10) / 4));
  }
  ok('…everywhere, not just near the road', worstAll < 1e-9, `120k points, worst ${worstAll.toExponential(1)}m`);
  // If this ever reads ~0 the twist has gone away and the check above has
  // stopped proving anything. It is the size of the bug that was fixed.
  ok(
    'the twist that caused it is still there to be got wrong',
    biggestTwist > 0.5,
    `worst cell twist ${biggestTwist.toFixed(2)}m — that was the burial depth`
  );

  // Corners are the one place the two surfaces always agreed, so they are the
  // control: a sampler that returned nonsense would fail here too.
  let cornerErr = 0;
  for (let j = 4; j < n - 4; j += 17) {
    for (let i = 4; i < n - 4; i += 17) {
      const x = -half + i * cs;
      const z = -half + j * cs;
      cornerErr = Math.max(cornerErr, Math.abs(terrain.heightAt(x, z) - terrain.heights[j * n + i]));
    }
  }
  ok('grid corners still read exactly', cornerErr < 1e-6, `worst ${cornerErr.toExponential(1)}m`);

  // normalAt must NOT have gone faceted along with heightAt. It is what the car
  // lies down on every frame; a gradient taken across triangles steps at every
  // seam, and the body twitches. Pin the two surfaces apart: the height comes
  // from the facets, the slope comes from the smooth field, and this is the
  // only place in the codebase they are allowed to disagree.
  const e = terrain.cellSize * 0.5;
  const nrm = new THREE.Vector3();
  const expect = new THREE.Vector3();
  let worstNormalErr = 0;
  let facetGap = 0;
  for (let k = 0; k < 3000; k++) {
    const x = (((k * 7919) % 1999) / 1999 * 2 - 1) * half * 0.9;
    const z = (((k * 104729) % 2003) / 2003 * 2 - 1) * half * 0.9;
    terrain.normalAt(x, z, nrm);
    expect
      .set(
        terrain.smoothHeightAt(x - e, z) - terrain.smoothHeightAt(x + e, z),
        2 * e,
        terrain.smoothHeightAt(x, z - e) - terrain.smoothHeightAt(x, z + e)
      )
      .normalize();
    worstNormalErr = Math.max(worstNormalErr, nrm.distanceTo(expect));
    facetGap = Math.max(facetGap, Math.abs(terrain.heightAt(x, z) - terrain.smoothHeightAt(x, z)));
  }
  ok(
    'normalAt still reads the smooth surface, not the facets',
    worstNormalErr < 1e-9 && facetGap > 0.2,
    `3k points identical to the bilinear gradient; the two surfaces differ by up to ${facetGap.toFixed(2)}m, so this is not vacuous`
  );
}

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

// Parkur 3 is an unsealed track with a slick section, marked by plastic posts
// and lit by a rig — not a road with Armco. Check the shape of it holds.
const slickSamples = t3.surfaces.filter((s) => s === 'SLICK').length;
ok('parkur 3 has a slick section', slickSamples > 20, `${slickSamples} samples`);
ok(
  'parkur 3 is unsealed for its whole length',
  t3.surfaces.every((s) => s !== 'TARMAC'),
  `${t3.surfaces.filter((s) => s === 'TARMAC').length} tarmac samples`
);
ok('parkur 3 has no barriers at all', t3.colliders.length === 0, `${t3.colliders.length} colliders`);
ok('parkur 3 has plastic markers instead', t3.markers.length > 100, `${t3.markers.length} posts`);
ok('parkur 3 has a lighting rig', t3.lightAnchors.length > 20, `${t3.lightAnchors.length} lamps`);

// The markers and the lights stop over the same stretch, and the slick section
// is inside it. If these three drift apart the whole beat stops landing.
const mGap = t3.data.markers.gaps[0];
const lGap = t3.data.lighting.gaps[0];
const slick = t3.data.patches.find((p) => p.surface === 'SLICK');
ok(
  'the unlit stretch and the unmarked stretch are the same stretch',
  mGap.from === lGap.from && mGap.to === lGap.to,
  `markers ${mGap.from}–${mGap.to}, lights ${lGap.from}–${lGap.to}`
);
ok(
  'the slick clay sits inside the dark',
  slick.from >= lGap.from && slick.to <= lGap.to,
  `slick ${slick.from}–${slick.to} in dark ${lGap.from}–${lGap.to}`
);
ok(
  'the blackout is triggered before the player reaches the dark',
  t3.data.breakout.blackoutAt < lGap.from,
  `blackout at ${t3.data.breakout.blackoutAt}, dark starts ${lGap.from}`
);
// Nothing on this track may be solid — that is the whole design.
const markerColliders = t3.markers.filter((m) => m.solid);
ok('the plastic posts are not solid', markerColliders.length === 0);
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
const { BREAKOUT, TREES } = await import('../src/config/gameplay.js');
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
    if (r && r.surface === 'SLICK' && entrySpeed === 0) entrySpeed = v.speed;
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
  'a player arrives at the clay carrying speed',
  human.entrySpeed > 28,
  `${(human.entrySpeed * 3.6).toFixed(0)} km/h at the clay`
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
  'even a perfect line gets thrown off the track',
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
  //
  // Speed matters now: a trunk has a capacity, and past it the tree comes down
  // on the car and takes its collider with it (see world/trees.js). So "solid"
  // has to be tested below that line, and felling tested above it.
  // Capacity is joules now, so the survivable speed comes back through
  // v = sqrt(2E/m). Well under one trunk's worth, with room for the extra hits
  // that three seconds of shoving at full throttle lands on top of it.
  const capacity = tree.radius * TREES.capacityPerRadius;
  const survivable = Math.sqrt((2 * capacity * 0.4) / 1100);

  // -- before the forest is armed, none of the above is true ----------------
  //
  // A fresh World has taken no `chase:escaped` / `intro:finished`, which is the
  // state the whole opening is played in: trees stop cars and hide them, and
  // nothing else. This is the check that the races cannot be spent knocking the
  // scenery down. See TREES.breakableBy.
  ok('a fresh forest takes no damage', world.trees.breakable === false);
  const early = new Vehicle({ profile: 'hatchback', world, id: 'early' });
  early.isPlayer = true;
  early.reset(new THREE.Vector3(tree.x, 0, tree.z - 9), 0);
  early.velocity.set(0, 0, 34);
  simulate(early, 120, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }));
  ok('…so a flat-out hit before the first escape does nothing at all',
    !tree.felled && !tree.damage, `damage=${Math.round(tree.damage || 0)} J`);
  ok('…and it is still standing in the way', early.position.z < tree.z + 4);

  // -- and cops never get to fell one, armed or not -------------------------
  world.trees.allowDamage();
  const cop = new Vehicle({ profile: 'cruiser', world, id: 'cop-test' });
  cop.reset(new THREE.Vector3(tree.x, 0, tree.z - 9), 0);
  cop.velocity.set(0, 0, 34);
  simulate(cop, 120, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }));
  ok('a cop cannot damage a tree even once the forest is armed',
    !tree.felled && !tree.damage, `damage=${Math.round(tree.damage || 0)} J`);

  const hitCar = new Vehicle({ profile: 'hatchback', world, id: 'crash' });
  hitCar.isPlayer = true;
  hitCar.reset(new THREE.Vector3(tree.x, 0, tree.z - 9), 0);
  hitCar.velocity.set(0, 0, survivable);
  simulate(hitCar, 120 * 3, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }));
  const passedThrough = hitCar.position.z > tree.z + 4;
  ok(
    'trees are solid below their capacity',
    !passedThrough && !tree.felled,
    passedThrough ? 'drove straight through' : `stopped by the trunk at ${survivable.toFixed(1)} m/s`
  );
  ok(
    'leaning on a trunk at full throttle does not fell it',
    !tree.felled,
    `${Math.round((tree.damage || 0) / 1000)} kJ / ${Math.round(capacity / 1000)} kJ`
  );
  // -- the lean IS the damage, drawn ----------------------------------------
  //
  // A trunk on the way down has to read as one from a moving car with no health
  // bar anywhere on the screen. So the tilt is not decoration: it is exactly
  // damage/capacity of TREES.maxLean, and a trunk that has taken twice as much
  // leans twice as far. Measured as the angle between the trunk's up vector
  // before and after, which is what the player actually sees.
  const bend = world.scatter.colliders.find(
    (c) => c !== tree && c.type === 'cylinder' && c.radius > 0.8 && c.mesh && !c.felled
  );
  if (bend) {
    const _p = new THREE.Vector3();
    const _r = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const upOf = (m) => {
      m.decompose(_p, _r, _s);
      return new THREE.Vector3(0, 1, 0).applyQuaternion(_r);
    };
    const rest = upOf(bend.baseMatrix);
    const leanNow = () => {
      const m = new THREE.Matrix4();
      bend.mesh.getMatrixAt(bend.instance, m);
      return rest.angleTo(upOf(m));
    };

    world.onImpact(hitCar, bend, 40000);
    const lean1 = leanNow();
    const t1 = bend.damage / bend.capacity;
    world.onImpact(hitCar, bend, 40000);
    const lean2 = leanNow();
    const t2 = bend.damage / bend.capacity;

    ok('a damaged trunk leans by its share of its capacity',
      Math.abs(lean1 - t1 * TREES.maxLean) < 0.02,
      `${lean1.toFixed(3)} rad at ${Math.round(t1 * 100)}% spent`);
    ok('…and a second hit bends it further, by the same rule',
      lean2 > lean1 && Math.abs(lean2 - t2 * TREES.maxLean) < 0.02,
      `${lean2.toFixed(3)} rad at ${Math.round(t2 * 100)}% spent`);
    ok('…without felling it', !bend.felled);
  }

  // Now hit it properly.
  const ram = new Vehicle({ profile: 'hatchback', world, id: 'ram' });
  ram.isPlayer = true;
  ram.reset(new THREE.Vector3(tree.x, 0, tree.z - 9), 0);
  ram.velocity.set(0, 0, 30);
  simulate(ram, 120, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }));
  ok('a hard enough hit fells the tree', !!tree.felled,
    `${Math.round((tree.damage || 0) / 1000)} kJ / ${Math.round(capacity / 1000)} kJ`);
  ok('a felled tree leaves no hitbox', tree.disabled === true && tree.blocksSight === false);

  // -- what actually flips the switch ---------------------------------------
  //
  // The forest listens for the story rather than being told by it: `Trees` never
  // imports the chase and the chase never mentions trees. That wire is the whole
  // gate, so it is worth one check on a throwaway instance.
  const { Trees } = await import('../src/world/trees.js');
  const { events } = await import('../src/core/events.js');
  const forest = new Trees();
  ok('a new forest starts unbreakable', forest.breakable === false && forest.armed === false);
  events.emit('chase:started', {});
  ok('the sirens arm the disguise, but not the axe',
    forest.armed === true && forest.breakable === false);
  events.emit('chase:escaped', {});
  ok('ditching the first cops is what makes the forest breakable', forest.breakable === true);
  forest.dispose();
}

// ---------------------------------------------------------------------------
// THE CAR IS NOT A POINT
//
// `Vehicle` stuck itself to the ground sampled at its own centre, so on any
// slope the nose or a flank was inside the hill while the physics insisted the
// car was on top of it. Drive the real car across the real world and measure
// how far the bodywork ends up under the terrain — using the visual transform,
// tilt and all, because that is what the player is complaining about.
{
  const FLOOR_Y = 0.01; // underside of the body shell, see chassis.js
  const p = new THREE.Vector3();

  const drive = (footprint) => {
    let worst = 0;
    let buried = 0;
    let samples = 0;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let r = 0; r < 12; r++) {
      const a = rnd() * Math.PI * 2;
      const d = 200 + rnd() * 900;
      const car = new Vehicle({ profile: 'hatchback', world, id: `dig${r}` });
      car.groundReach = car.tuning.halfExtents.z * footprint;
      car.groundReachLat = car.tuning.halfExtents.x * footprint;
      car.reset(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), rnd() * Math.PI * 2);
      let steer = 0;
      for (let s = 0; s < 120 * 14; s++) {
        if (s % 90 === 0) steer = (rnd() * 2 - 1) * 0.55;
        car.setCommand({ throttle: 0.85, brake: 0, steer, handbrake: 0 });
        car.fixedUpdate(1 / 120);
        car.syncVisual(1, 1 / 120);
        if (s % 8 || !car.grounded) continue;
        if (!world.terrain.contains(car.position.x, car.position.z)) break;
        car.object.updateMatrixWorld(true);
        const hx = car.tuning.halfExtents.x;
        const hz = car.tuning.halfExtents.z;
        let deepest = 0;
        for (const sz of [-hz, 0, hz]) {
          for (const sx of [-hx, hx]) {
            p.set(sx, FLOOR_Y, sz).applyMatrix4(car.object.matrixWorld);
            if (!world.terrain.contains(p.x, p.z)) continue;
            deepest = Math.max(deepest, world.groundHeightAt(p.x, p.z) - p.y);
          }
        }
        samples++;
        if (deepest > 0.05) buried++;
        worst = Math.max(worst, deepest);
      }
    }
    return { worst, rate: buried / samples, samples };
  };

  const point = drive(0); // the old behaviour, for contrast
  const footprint = drive(resolveProfile('hatchback').groundFootprint);
  ok(
    'the car does not drive inside hills any more',
    footprint.worst < 1.0 && footprint.rate < 0.01,
    `worst ${footprint.worst.toFixed(2)}m under ground, ${(footprint.rate * 100).toFixed(2)}% of ${footprint.samples} samples`
  );
  ok(
    '…and that is the footprint sampler doing it, not luck',
    footprint.worst < point.worst * 0.75 && footprint.rate < point.rate * 0.5,
    `centre-only: ${point.worst.toFixed(2)}m / ${(point.rate * 100).toFixed(2)}%`
  );
  ok(
    'the ground probes sit inside the bodywork',
    resolveProfile('hatchback').groundFootprint > 0 && resolveProfile('hatchback').groundFootprint <= 1,
    `groundFootprint ${resolveProfile('hatchback').groundFootprint}`
  );
}

// ---------------------------------------------------------------------------
section('6. lights');

{
  const { LightPool, LIGHT_BUDGET } = await import('../src/render/lightPool.js');
  const { TrackLighting, LIGHTING } = await import('../src/world/lighting.js');

  const scene = new THREE.Scene();
  const pool = new LightPool(scene);
  const lightCount = scene.children.filter((o) => o.isLight).length;
  ok(
    'the pool allocates its whole budget up front',
    lightCount === LIGHT_BUDGET.point + LIGHT_BUDGET.spot,
    `${lightCount} lights in the scene`
  );
  ok('…all parked at zero', scene.children.filter((o) => o.isLight && o.intensity > 0).length === 0);

  const taken = [];
  for (let i = 0; i < LIGHT_BUDGET.spot; i++) taken.push(pool.acquireSpot());
  ok('spot leases run out cleanly', pool.acquireSpot() === null);
  taken[0].release();
  ok('…and come back after release', pool.acquireSpot() !== null);
  pool.releaseAll();

  // The light count must never change after boot, or three recompiles every
  // material in the world at the exact moment something dramatic happens.
  const afterChurn = scene.children.filter((o) => o.isLight).length;
  ok('acquiring never changes the light count', afterChurn === lightCount, `${afterChurn}`);

  // -- the rig ---------------------------------------------------------------
  const rigPool = new LightPool(new THREE.Scene());
  const rig = new TrackLighting({ track: t3, pool: rigPool });
  ok('the rig leases lights for the nearest poles', rig._leases.length === LIGHTING.maxActive);

  // Point the camera at one known anchor and check that anchor gets a light.
  const target = t3.lightAnchors[10];
  rig.update(0.5, { x: target.x, y: target.y, z: target.z });
  const lit = rig._leases.filter((l) => l.light.intensity > 0);
  ok('…and they actually light up', lit.length > 0, `${lit.length} of ${rig._leases.length} on`);
  const nearest = rig._leases[0].light;
  ok(
    '…nearest first',
    Math.hypot(nearest.position.x - target.x, nearest.position.z - target.z) < 6,
    `${Math.hypot(nearest.position.x - target.x, nearest.position.z - target.z).toFixed(1)}m from the anchor`
  );

  // Blackout: the whole rig has to go to nothing, and stay there.
  rig.blackout(9);
  for (let i = 0; i < 60; i++) rig.update(1 / 30, { x: target.x, y: target.y, z: target.z });
  ok('blackout kills the rig', rig.power < 0.02, `power ${rig.power.toFixed(3)}`);
  ok('…and every lamp with it', rig._leases.every((l) => l.light.intensity < 1));
  rig.hold();
  rig.dispose();
  ok('disposing gives the leases back', rigPool.points.every((l) => !l.inUse));
}

{
  // Headlights are the scarcest lease. Only the cars the player watches in the
  // dark get one — see the `headlights` default in createChassis.
  const { createChassis } = await import('../src/vehicle/chassis.js');
  const { LightPool } = await import('../src/render/lightPool.js');
  const scene = new THREE.Scene();
  const pool = new LightPool(scene);
  const he = { x: 0.9, y: 0.65, z: 2.05 };
  const mk = (kind) => createChassis({ materials, theme, kind, halfExtents: he, lightPool: pool });

  const before = pool.spots.filter((l) => l.inUse).length;
  const rival = mk('rival');
  ok('rivals do not burn a spot light', pool.spots.filter((l) => l.inUse).length === before);
  const player = mk('player');
  ok('the player does', pool.spots.filter((l) => l.inUse).length === before + 1);
  const cop = mk('cop');
  ok('so do the cops', pool.spots.filter((l) => l.inUse).length === before + 2);

  player.setHeadlights(true);
  const on = pool.spots.find((l) => l.inUse && l.light.intensity > 0);
  ok('switching them on lights a real spot', !!on, on ? `intensity ${on.light.intensity}` : 'none');
  player.setHeadlights(false);
  ok('…and off again', !pool.spots.some((l) => l.inUse && l.light.intensity > 0));

  for (const c of [rival, player, cop]) c.dispose();
  ok('chassis dispose returns every lease', pool.spots.every((l) => !l.inUse) && pool.points.every((l) => !l.inUse));
}

// ---------------------------------------------------------------------------
section('7. seed determinism');
const worldB = new World({ materials, theme, seed: 0x7e4e17 });
await worldB.build({ trackData: ALL_TRACKS, scatter: false });
const sampleA = world.terrain.heightAt(123, -456);
const sampleB = worldB.terrain.heightAt(123, -456);
ok('same seed, same terrain', Math.abs(sampleA - sampleB) < 1e-6, `${sampleA.toFixed(4)} vs ${sampleB.toFixed(4)}`);

// ---------------------------------------------------------------------------
section('8. saved sound settings actually reach the mix');

// The player restores their volumes at boot, which is *before* the first
// gesture, which means the AudioContext is still suspended and the GainNodes
// will not take a value. The engine has to remember and replay. Nothing here
// makes a sound — the fakes below only record what lands on each AudioParam,
// because the bug was a number that never reached the node at all.
{
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  /** An AudioParam that just remembers the last value scheduled onto it. */
  const param = (v) => ({
    value: v,
    setValueAtTime(x) { this.value = x; return this; },
    setTargetAtTime(x) { this.value = x; return this; },
    linearRampToValueAtTime(x) { this.value = x; return this; },
    exponentialRampToValueAtTime(x) { this.value = x; return this; },
    cancelScheduledValues() { return this; },
    cancelAndHoldAtTime() { return this; },
  });
  const node = (extra = {}) => ({ connect() { return this; }, disconnect() {}, ...extra });

  function fakeAudioContext() {
    return {
      state: 'suspended',
      currentTime: 0,
      // Only decides how long the noise buffers are. Keep it small: the real
      // 44.1kHz would generate half a million samples we are never going to hear.
      sampleRate: 8000,
      destination: node(),
      onstatechange: null,
      createGain: () => node({ gain: param(1) }),
      createDynamicsCompressor: () =>
        node({
          threshold: param(0), knee: param(0), ratio: param(1),
          attack: param(0), release: param(0),
        }),
      createBuffer: (_ch, len) => ({ getChannelData: () => new Float32Array(len) }),
      createBufferSource: () =>
        node({ buffer: null, loop: false, playbackRate: param(1), start() {}, stop() {}, onended: null }),
      resume() {
        this.state = 'running';
        this.onstatechange?.();
        return Promise.resolve();
      },
    };
  }

  const { AudioEngine, AUDIO_CONFIG } = await import('../src/audio/audio.js');
  const bv = AUDIO_CONFIG.MASTER.busVolumes;
  globalThis.AudioContext = fakeAudioContext;

  {
    const engine = new AudioEngine();
    engine.init();
    ok('the graph builds before any gesture', engine.ready && !engine._live);

    // This is Game#init: settings.load() → applyAll() → setBusVolume, all of it
    // while the context is still asleep.
    engine.setMasterVolume(0.35);
    engine.setBusVolume('music', 0.2);
    engine.setBusVolume('engine', 0.4);
    ok('a suspended bus cannot take the value yet', engine._bus.music.gain.value === bv.music);
    ok('…but the engine remembered the scale', engine.getBusVolume('music') === 0.2);

    await engine.unlock();
    ok('the first gesture starts the context', engine._live);
    ok(
      'the saved bus scale is on the real node',
      near(engine._bus.music.gain.value, bv.music * 0.2),
      `${engine._bus.music.gain.value.toFixed(4)} = ${bv.music} × 0.2`
    );
    ok('…for every bus that was set', near(engine._bus.engine.gain.value, bv.engine * 0.4));
    ok('…and buses nobody touched keep the AUDIO_CONFIG balance', engine._bus.sfx.gain.value === bv.sfx);
    ok('master survives the suspension too', near(engine._master.gain.value, 0.35));
    engine.dispose();
  }

  {
    // Tab-hide suspends the context and drops the graph's automation. Coming
    // back must not come back at the defaults.
    const engine = new AudioEngine();
    engine.init();
    await engine.unlock();
    engine.setBusVolume('siren', 0.1);
    engine._ctx.state = 'suspended';
    engine._bus.siren.gain.value = bv.siren; // what a rebuilt/reset node looks like
    engine._ctx.state = 'running';
    engine._ctx.onstatechange();
    ok('a resumed tab gets the mix back', near(engine._bus.siren.gain.value, bv.siren * 0.1));
    engine.dispose();
  }

  delete globalThis.AudioContext;
}

// The other half of the round trip: the value has to survive the page as well
// as the suspension. A second module instance is what a reload actually is.
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const { events } = await import('../src/core/events.js');
  const { settings } = await import('../src/config/settings.js?instance=write');

  let fired = 0;
  const off = events.on('settings:changed', () => fired++);
  settings.set('musicVolume', 0.3);
  ok('changing a setting broadcasts it', fired === 1);
  settings.set('musicVolume', 0.3);
  ok('…and setting the same value again is correctly a no-op', fired === 1);
  settings.set('musicVolume', 0.35);
  ok('…while a real change still gets through', fired === 2, `${settings.get('musicVolume')}`);
  off();

  ok('it reached localStorage', store.size === 1);
  const reloaded = (await import('../src/config/settings.js?instance=read')).settings;
  ok('a fresh page starts at the default', reloaded.get('musicVolume') === 1);
  reloaded.load();
  ok('…and load() brings the saved value back', reloaded.get('musicVolume') === 0.35);

  let applied = null;
  const off2 = events.on('settings:changed', ({ id, value }) => {
    if (id === 'musicVolume') applied = value;
  });
  reloaded.applyAll();
  ok('…and applyAll() hands it to Game#_applySetting', applied === 0.35);
  off2();

  delete globalThis.localStorage;
}

// ---------------------------------------------------------------------------
console.log(
  `\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${checks - failures}/${checks} checks passed\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
