// Boston Logan, across the harbor from Winthrop (Pierce, 2026-09-14: "add all of Boston Logan airport completely, all we
// can find, so that I can be in the planes as they land and take off live"). data/logan.json is OpenStreetMap's airport
// in the game's frame: runways, taxiways, aprons, stands, terminals and hangars, the East Boston buildings and roads
// around it. Everything sits on one flat field at the airport's elevation, merged into a handful of meshes.
import * as THREE from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

const M = {
  field: new THREE.MeshLambertMaterial({color: '#5a6a47'}),
  runway: new THREE.MeshLambertMaterial({color: '#3b3d40'}),
  taxiway: new THREE.MeshLambertMaterial({color: '#5d6063'}),
  apron: new THREE.MeshLambertMaterial({color: '#8b8f92'}),
  road: new THREE.MeshLambertMaterial({color: '#4f5356', transparent: true, opacity: .55}),
  white: new THREE.MeshBasicMaterial({color: '#e8e8e2'}),
  yellow: new THREE.MeshBasicMaterial({color: '#e2c14a'}),
  building: new THREE.MeshLambertMaterial({color: '#b9bcbf'}),
  terminal: new THREE.MeshLambertMaterial({color: '#cfd6dc'}),
  hangar: new THREE.MeshLambertMaterial({color: '#9aa0a5'}),
};

function strip(pts, width, y, out) {   // quads along a polyline plus a disc at every interior joint, like the road surfaces
  const half = width / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < .3) continue;
    const g = new THREE.PlaneGeometry(L, width); g.rotateX(-Math.PI / 2); g.rotateY(-Math.atan2(dz, dx)); g.translate((ax + bx) / 2, y, (az + bz) / 2); out.push(g);
    if (i > 0) { const d = new THREE.CircleGeometry(half, 10); d.rotateX(-Math.PI / 2); d.translate(ax, y, az); out.push(d); }
  }
}
function polygon(ring, y, out, height = 0) {
  const s = new THREE.Shape(ring.map(p => new THREE.Vector2(p[0], -p[1])));
  const g = height > 0 ? new THREE.ExtrudeGeometry(s, {depth: height, bevelEnabled: false}) : new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0); out.push(g);
}
function hull(points) {   // Andrew's monotone chain, for the grass field under everything
  const P = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; for (const p of P) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = []; for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop(); return lower.concat(upper);
}
function grow(ring, m) { const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length; return ring.map(p => { const dx = p[0] - cx, dz = p[1] - cz, L = Math.hypot(dx, dz) || 1; return [p[0] + dx / L * m, p[1] + dz / L * m]; }); }

export function logan({scene, data, y = 1.5}) {
  const group = new THREE.Group(); group.name = 'logan'; group.userData.audit = {};
  const add = (geos, mat, order = 0) => { if (!geos.length) return; const g = mergeGeometries(geos, false); geos.forEach(x => x.dispose()); const m = new THREE.Mesh(g, mat); m.renderOrder = order; m.receiveShadow = true; group.add(m); };
  /* the ground: the USGS aerial photo in tiles (assets/logan/extent.json); the grass hull only if the photo is missing
     (Pierce, 09-14: "can the airport look any better?") */
  const loader = new THREE.TextureLoader();
  fetch('./assets/logan/extent.json').then(r => r.ok ? r.json() : null).then(ext => {
    if (!ext || !ext.tiles || !ext.tiles.length) throw 0;
    for (const t of ext.tiles) { const [ax, az, bx, bz] = t.bboxLocal; const g = new THREE.PlaneGeometry(bx - ax, bz - az); g.rotateX(-Math.PI / 2); g.translate((ax + bx) / 2, y + .02, (az + bz) / 2);
      const tex = loader.load('./assets/logan/' + t.file); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({map: tex})); m.renderOrder = 1; m.receiveShadow = true; group.add(m); }
    group.userData.audit.ground = ext.source;
  }).catch(() => { const fieldPts = []; for (const r of data.runways) fieldPts.push(...r.points); for (const t of data.taxiways) fieldPts.push(...t.points); for (const a of data.aprons) fieldPts.push(...a.ring);
    const field = []; polygon(grow(hull(fieldPts), 120), y, field); add(field, M.field, 1); });
  /* aprons, taxiways, runways, in that order so the runway paints on top */
  const aprons = []; for (const a of data.aprons) polygon(a.ring, y + .05, aprons); add(aprons, M.apron, 2);
  const taxi = [], yellow = []; for (const t of data.taxiways) { strip(t.points, t.width || 23, y + .08, taxi); strip(t.points, .5, y + .13, yellow); } add(taxi, M.taxiway, 3); add(yellow, M.yellow, 4);
  const rw = [], white = [];
  for (const r of data.runways) {
    const W = r.width || 46; strip(r.points, W, y + .1, rw);
    /* markings: edge lines, a dashed centreline, and eight threshold stripes at each end */
    const pts = r.points; let total = 0; const seg = [];
    for (let i = 0; i < pts.length - 1; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(L); total += L; }
    const at = d => { let acc = 0; for (let i = 0; i < seg.length; i++) { if (d <= acc + seg[i] || i === seg.length - 1) { const k = Math.max(0, Math.min(1, (d - acc) / seg[i])); const a = pts[i], b = pts[i + 1]; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, (b[0] - a[0]) / seg[i], (b[1] - a[1]) / seg[i]]; } acc += seg[i]; } return null; };
    const mark = (d0, d1, offset, w) => { const p = at(d0), q = at(d1); if (!p || !q) return; const nx = -p[3], nz = p[2]; strip([[p[0] + nx * offset, p[1] + nz * offset], [q[0] + nx * offset, q[1] + nz * offset]], w, y + .16, white); };
    for (let d = 60; d < total - 60; d += 50) mark(d, Math.min(d + 30, total - 60), 0, .9);
    mark(0, total, W / 2 - 1.2, .9); mark(0, total, -(W / 2 - 1.2), .9);
    const stripes = W >= 40 ? 8 : 6, gap = (W - 6) / stripes;
    for (let s = 0; s < stripes; s++) { const off = -(W - 6) / 2 + gap / 2 + s * gap; mark(6, 45, off, 1.8); mark(total - 45, total - 6, off, 1.8); }
  }
  add(rw, M.runway, 5); add(white, M.white, 6);
  const roads = []; for (const r of data.roads) strip(r.points, r.width || 10, y + .06, roads); add(roads, M.road, 2);
  /* buildings by kind */
  const kinds = {building: [], terminal: [], hangar: []};
  for (const b of data.buildings) polygon(b.ring, y + .1, kinds[b.kind] || kinds.building, Math.max(3, b.height || 8));
  for (const k of Object.keys(kinds)) { const m = new THREE.Mesh(mergeGeometries(kinds[k], false), M[k]); m.castShadow = k !== 'building'; m.receiveShadow = true; kinds[k].forEach(g => g.dispose()); group.add(m); }
  group.userData.audit = Object.assign(group.userData.audit || {}, {runways: data.runways.length, taxiways: data.taxiways.length, aprons: data.aprons.length, buildings: data.buildings.length, roads: data.roads.length, field: data.field, source: data.source});
  scene.add(group); return group;
}
