import * as THREE from 'three';
import {carKit, KIT} from './car-kit.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
// Cars at the kerb. Winthrop has nine thousand people and, until now, not one parked car in it: the word
// "parkedCar" appeared nowhere in the codebase, so every street was a runway with houses either side. This
// puts the town's own cars back on its own kerbs, from the road graph's width and direction — no new survey
// data, because none exists and inventing one would be worse than reading the geometry we already trust.
//
// They are scenery, not obstacles. Making them solid changes how every street drives and every errand times,
// and that is a separate decision with its own test pass. What they do today is narrow the street to the eye,
// which is most of why an empty road reads as a runway.
//
// The whole kit shares one texture atlas (material "colormap"), so all six models merge into instanced meshes
// against a single material: six draw calls for the whole town, whatever the count.

const MODELS = ['sedan', 'suv', 'van', 'taxi', 'hatchback-sports', 'truck'];
const SPACING = 8.4;      // m between slots: a 4.1 m car and a gap you could actually pull into
const END_CLEAR = 9;      // m kept clear at each end of a segment, so nobody parks in the junction
const MIN_WIDTH = 7.5;    // m. Narrower than this and a parked car blocks the street
const HALF_CAR = 0.98;    // m, the kit car's actual half-width; 1.15 pushed them into the traffic lane
const GUTTER = 0.12;      // m from the kerb line. Tucked in: once the cars became solid, every centimetre
                          // out from the kerb came off the corridor the traffic has to get through.
const RANGE = 230;        // m. Cars further than this are in the list but not in a mesh
const CAP_PER_MODEL = 90; // instances allocated per model; the visible set never exceeds this

// Deterministic per-slot noise: the same street parks the same way on every visit, which matters because a
// player who drives Shirley Street twice should not find the cars rearranged.
const hash = (a, b, c) => {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export async function parkedCars(network, heightAt, {assets = [], furniture = {}, crossings = {}} = {}) {
  const group = new THREE.Group();
  group.name = 'parked-cars';

  // Everything a car must not be left on top of or in front of.
  const keepOut = [];
  for (const a of assets) keepOut.push({x: a.x, z: a.z, r: a.kind === 'stop' ? 7 : 4.5});
  for (const p of furniture.busStops || []) keepOut.push({x: p.x, z: p.z, r: 11});
  for (const p of furniture.signals || []) keepOut.push({x: p.x, z: p.z, r: 9});
  for (const c of (crossings.crossings || crossings.items || [])) if (c && c.x != null) keepOut.push({x: c.x, z: c.z, r: 7});
  /* And nobody parks across an errand. Once the cars became solid, a single one sitting on the approach to
     Winthrop Beach made that errand unfinishable — the car could not reach the door however long it drove,
     which the test caught and 200 simulated seconds confirmed was a block and not merely a slower run.
     The errand list is the town's own; this reads it rather than keeping a second copy. */
  try {
    const g = await (await fetch('./data/games.json')).json();
    for (const e of (g.errands || [])) if (e && e.x != null) keepOut.push({x: e.x, z: e.z, r: 22});
  } catch (err) { /* no errand list is not a reason to have no parked cars */ }
  const cells = new Map();
  for (const k of keepOut) {
    const key = Math.floor(k.x / 30) + ',' + Math.floor(k.z / 30);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(k);
  }
  const blocked = (x, z) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const k of cells.get((Math.floor(x / 30) + i) + ',' + (Math.floor(z / 30) + j)) || [])
        if (Math.hypot(k.x - x, k.z - z) < k.r) return true;
    }
    return false;
  };

  // --- where the cars go -------------------------------------------------------------------------------
  const slots = [];
  let segIndex = 0;
  for (const s of network.segments) {
    segIndex++;
    if (s.width < MIN_WIDTH || s.length < END_CLEAR * 2 + SPACING) continue;
    const off = s.width / 2 - HALF_CAR - GUTTER;
    if (off < 1.5) continue;
    const ux = s.dx / s.length, uz = s.dz / s.length;      // along
    const nx = -uz, nz = ux;                                // across
    const count = Math.floor((s.length - END_CLEAR * 2) / SPACING);
    for (let i = 0; i <= count; i++) {
      const along = END_CLEAR + i * SPACING;
      // Both sides only where a lane survives it. Measured on 2026-09-12: with cars on both sides of a
      // narrow street, two of twelve test streets became undrivable — the same twelve were all clear with
      // the cars switched off, so it was the parking, not the bends. Winthrop parks one side on its
      // narrow streets for exactly this reason.
      const sides = s.width >= 9.5 ? [1, -1] : [s.direction ? 1 : (segIndex % 2 ? 1 : -1)];
      for (const side of sides) {
        const r = hash(segIndex, i, side + 2);
        // Wider roads are busier and park fuller; a one-way's far side is usually the quiet one.
        // Tuned against what is actually drawn around the car, not against the town total: at 0.34/0.24 the
        // whole town held 777 cars and a street you were standing on held about thirteen, which still read
        // as empty. The culling pays for the density, so the density is set by how a street looks.
        const fill = (s.width >= 10 ? 0.56 : 0.42) * (s.direction && side < 0 ? 0.55 : 1);
        if (r > fill) continue;
        const x = s.a[0] + ux * along + nx * off * side;
        const z = s.a[1] + uz * along + nz * off * side;
        if (!network.contains(x, z, 0.2) || network.obstructed(x, z) || blocked(x, z)) continue;
        // Park with the flow: on a two-way that means nose the way traffic runs on your side of the road.
        const facing = s.direction ? (s.direction === 1 ? 1 : -1) : side;
        const yaw = Math.atan2(-ux * facing, -uz * facing) + (hash(segIndex, i, side + 9) - 0.5) * 0.06;
        slots.push({x, z, yaw, model: Math.floor(hash(segIndex, i, side + 40) * MODELS.length)});
      }
    }
  }

  // Two roads that meet, overlap or run as split pieces of the same street can each offer a slot in nearly
  // the same spot, and the test found a pair 3.4 m apart — two cars in one parking space. Segments do not
  // know about each other, so the de-duplication has to happen once the whole list exists.
  const kept = [], grid = new Map();
  for (const s of slots) {
    const cx = Math.floor(s.x / 6), cz = Math.floor(s.z / 6);
    let clash = false;
    for (let i = -1; i <= 1 && !clash; i++) for (let j = -1; j <= 1 && !clash; j++)
      for (const o of grid.get((cx + i) + ',' + (cz + j)) || [])
        if (Math.hypot(o.x - s.x, o.z - s.z) < 4.4) { clash = true; break; }
    if (clash) continue;
    kept.push(s);
    const k = cx + ',' + cz;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  slots.length = 0;
  slots.push(...kept);

  // --- one merged geometry per model, and only the near ones drawn --------------------------------------
  // The first cut of this put every car in the town into instanced meshes and left the GPU to frustum-cull
  // them. Measured, that was 2.3x the frame time: about five and a half million triangles of parked car,
  // most of it behind you or a mile away. So the slot list stays whole and the meshes carry only what is
  // near the camera, rewritten when the camera has moved far enough to matter. Triangles on screen now
  // depend on how much street you can see, not on how big Winthrop is.
  const dummy = new THREE.Object3D();
  const built = [];
  let material = null;
  for (let m = 0; m < MODELS.length; m++) {
    const mine = slots.filter(s => s.model === m);
    if (!mine.length) continue;
    let template;
    try { template = await carKit.load(MODELS[m]); }
    catch (e) { continue; }                                  /* a missing model costs its share, not the town */
    template.updateMatrixWorld(true);
    const parts = [];
    template.traverse(o => {
      if (!o.isMesh) return;
      if (!material) material = Array.isArray(o.material) ? o.material[0] : o.material;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
      parts.push(g.index ? g.toNonIndexed() : g);
    });
    if (!parts.length) continue;
    const geometry = mergeGeometries(parts, false);
    parts.forEach(g => g.dispose());
    const cap = Math.min(mine.length, CAP_PER_MODEL);
    const mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;                              /* we do the culling; the box would cover the town */
    mesh.count = 0;
    mesh.userData.model = MODELS[m];
    group.add(mesh);
    built.push({mesh, slots: mine, cap});
  }

  // Rewrite the visible set. Cheap enough to call on a moved camera, far too expensive every frame.
  const last = new THREE.Vector3(1e9, 1e9, 1e9);
  group.userData.refresh = (cx, cz) => {
    for (const b of built) {
      let n = 0;
      for (const s of b.slots) {
        if (n >= b.cap) break;
        const dx = s.x - cx, dz = s.z - cz;
        if (dx * dx + dz * dz > RANGE * RANGE) continue;
        dummy.position.set(s.x, heightAt(s.x, s.z), s.z);
        dummy.rotation.set(0, s.yaw, 0);
        dummy.updateMatrix();
        b.mesh.setMatrixAt(n++, dummy.matrix);
      }
      b.mesh.count = n;
      b.mesh.instanceMatrix.needsUpdate = true;
    }
    last.set(cx, 0, cz);
  };
  group.userData.update = (cx, cz) => {
    if (Math.hypot(cx - last.x, cz - last.z) < 30) return false;
    group.userData.refresh(cx, cz);
    return true;
  };
  group.userData.refresh(0, 0);

  group.userData.count = slots.length;
  group.userData.slots = slots;
  return group;
}
