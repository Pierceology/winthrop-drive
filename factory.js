// The factory, in the browser. Pierce, 2026-09-14: "imagine there's a globe. It spins to the area, and that says,
// please allow x amount of time while I build your driving experience for that city ... it goes to it, it maps it,
// it plays it."
//
// Same recipe as factory/build.py + surfaces.py, ported so a phone can run it with no server: OpenStreetMap roads,
// buildings, places and furniture (Overpass), Terrarium elevation (AWS open data), USGS NAIP ground photo where the
// US has it. Every source sends CORS headers; every fetch here is a plain browser fetch. The result is written into
// the Cache API under ./worlds/<slug>/… and sw.js serves it to the game as if the files were on the site.
//
// Not here: Microsoft's building footprints (their blob store sends no CORS header). A city built on a phone has
// the buildings OpenStreetMap has; a city built on the Mac has both.

// Measured 2026-09-14 on the Lihue box: maps.mail.ru 10 s, kumi 62 s, private.coffee timed out, overpass-api.de 406 all day.
const OVERPASS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter'];
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const NAIP = 'https://imagery.nationalmap.gov/arcgis/services/USGSNAIPPlus/ImageServer/WMSServer?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=USGSNAIPPlus&CRS=EPSG:4326&BBOX={s},{w},{n},{e}&WIDTH={px}&HEIGHT={px}&FORMAT=image/jpeg';
const HIGHWAY = {motorway: [1, 1, 14], trunk: [1, 1, 12], primary: [2, 2, 11], secondary: [3, 3, 10], tertiary: [4, 4, 9], unclassified: [5, 5, 7.5], residential: [5, 5, 7.5], living_street: [6, 6, 6], service: [6, 6, 5], footway: [7, 7, 2], path: [7, 7, 2], pedestrian: [7, 7, 3], cycleway: [8, 8, 2.5], track: [6, 6, 4]};
const HALF_TOWN = 1200, HALF_CITY = 1600;   // metres from the centre to the edge: a town is a 2.4 km square, a city 3.2 km -- what a phone builds in a minute or two

/* ---- a local frame: transverse Mercator about the centre, x east, z SOUTH (the game's convention) ---- */
export function makeFrame(lat0, lon0) {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f), k0 = 1, rad = Math.PI / 180;
  const M = lat => { const e4 = e2 * e2, e6 = e4 * e2; return a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat) - (35 * e6 / 3072) * Math.sin(6 * lat)); };
  const M0 = M(lat0 * rad);
  const xz = (lon, lat) => {
    const p = lat * rad, l = (lon - lon0) * rad, N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = e2 / (1 - e2) * Math.cos(p) ** 2, A = Math.cos(p) * l;
    const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * e2 / (1 - e2)) * A ** 5 / 120);
    const y = k0 * (M(p) - M0 + N * Math.tan(p) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * e2 / (1 - e2)) * A ** 6 / 720));
    return [Math.round(x * 100) / 100, Math.round(-y * 100) / 100];
  };
  // the inverse is only needed for the terrain grid: a metre north is 1/111,320 deg, a metre east 1/(111,320 cos lat)
  const lonlat = (x, z) => [lon0 + x / (111320 * Math.cos(lat0 * rad)), lat0 - z / 111320];
  return {lat0, lon0, xz, lonlat};
}

export function slugOf(name) { return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'town'; }

/* ---- geocode: Nominatim, one request ---- */
export async function geocode(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=' + encodeURIComponent(q), {headers: {'Accept-Language': 'en'}});
  if (!r.ok) throw new Error('geocoder ' + r.status);
  const rows = await r.json();
  const pick = rows.find(x => /city|town|village|hamlet|municipality|suburb|borough|county|island/.test(x.type + ' ' + x.class)) || rows[0];
  if (!pick) throw new Error('no such place');
  const ad = pick.address || {};
  return {name: ad.city || ad.town || ad.village || ad.hamlet || ad.municipality || pick.name || pick.display_name.split(',')[0], lat: +pick.lat, lon: +pick.lon, country: (ad.country_code || '').toUpperCase(), display: pick.display_name, kind: pick.type, big: pick.type === 'city' || (+pick.importance || 0) > .6};
}

async function overpass(query, onNote) {
  /* All three public mirrors at once; the first good answer wins and the others are cancelled. Serial tries were
     measured at 236 s of waiting for two 504s before the third host was even asked. */
  onNote && onNote('asking OpenStreetMap…');
  const controllers = OVERPASS.map(() => new AbortController());
  const attempts = OVERPASS.map((host, i) => (async () => {
    const r = await fetch(host, {method: 'POST', body: 'data=' + encodeURIComponent(query), headers: {'Content-Type': 'application/x-www-form-urlencoded'}, signal: controllers[i].signal});
    if (!r.ok) throw new Error(new URL(host).host + ' ' + r.status);
    const j = await r.json(); if (!j || !j.elements) throw new Error(new URL(host).host + ' empty');
    return j;
  })());
  try { const j = await Promise.any(attempts); controllers.forEach(c => c.abort()); return j; }
  catch (e) { throw new Error('OpenStreetMap is busy right now (' + (e.errors || []).map(x => x.message).join(', ') + ') — try again in a minute'); }
}

function area(ring) { let s = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s) / 2; }

/* ---- OSM → world.json + the small files ---- */
function parseOSM(d, frame, name) {
  const nodes = new Map(); for (const el of d.elements) if (el.type === 'node') nodes.set(el.id, el);
  const roads = [], buildings = [], places = [], crossings = [], lamps = [], hydrants = [], busStops = [], signals = [], poles = [], lines = [];
  const poleIndex = new Map();
  for (const el of nodes.values()) {
    const t = el.tags; if (!t) continue; const [x, z] = frame.xz(el.lon, el.lat);
    const kind = t.amenity || t.shop || t.tourism || t.leisure;
    if (t.name && kind) places.push({name: t.name, kind, x, z, address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null, osm: el.id});
    if (t.highway === 'crossing' && t.crossing !== 'unmarked' && t['crossing:markings'] !== 'no') crossings.push({id: el.id, x, z, ux: 0, uz: 1, style: t.crossing === 'zebra' ? 'zebra' : t.crossing === 'traffic_signals' ? 'signals' : 'ladder'});
    if (t.highway === 'street_lamp') lamps.push({x, z});
    if (t.emergency === 'fire_hydrant') hydrants.push({x, z, kind: 'hydrant'});
    if (t.highway === 'bus_stop') busStops.push({x, z, name: t.name || null});
    if (t.highway === 'traffic_signals') signals.push({x, z});
    if (t.power === 'pole') { poleIndex.set(el.id, poles.length); poles.push({x, z, osm: el.id}); }
  }
  for (const el of d.elements) {
    if (el.type !== 'way') continue;
    const t = el.tags || {};
    if (t.power === 'minor_line' || t.power === 'line') { const idx = el.nodes.filter(i => poleIndex.has(i)).map(i => poleIndex.get(i)); if (idx.length > 1) lines.push(idx); continue; }
    const pts = el.geometry ? el.geometry.map(g => frame.xz(g.lon, g.lat)) : el.nodes.filter(i => nodes.has(i)).map(i => { const n = nodes.get(i); return frame.xz(n.lon, n.lat); });
    if (pts.length < 2) continue;
    if (t.highway) {
      const hw = HIGHWAY[t.highway]; if (!hw) continue;
      let [cls, typ, width] = hw;
      if (t.width && !isNaN(parseFloat(t.width))) width = parseFloat(t.width);
      const lanes = /^\d+$/.test(t.lanes || '') ? +t.lanes : null;
      let speed = null; if (t.maxspeed) { const m = String(t.maxspeed).toLowerCase(); const v = parseFloat(m); if (!isNaN(v)) speed = /mph/.test(m) ? v : v * 0.621371; }
      const direction = ['yes', '1', 'true'].includes(t.oneway) ? 1 : t.oneway === '-1' ? -1 : 0;
      const segs = pts.length - 1;
      roads.push({id: el.id, name: (t.name || 'Unnamed road').toUpperCase(), points: pts, width, lanes, speed, town: name.toUpperCase(), class: cls, type: typ, directions: Array(segs).fill(direction), directionSources: Array(segs).fill('osm'), osmHighway: t.highway});
    } else if (t.building && el.nodes && el.nodes[0] === el.nodes[el.nodes.length - 1]) {
      const ring = pts.slice(0, -1); if (ring.length < 3) continue;
      const ar = area(ring); if (ar < 8) continue;
      let cx = 0, cz = 0; for (const p of ring) { cx += p[0]; cz += p[1]; } cx /= ring.length; cz /= ring.length;
      let height = null;
      for (const k of ['height', 'building:height']) if (t[k] && !isNaN(parseFloat(t[k]))) { height = parseFloat(t[k]); break; }
      if (height === null && /^\d+(\.\d+)?$/.test(t['building:levels'] || '')) height = parseFloat(t['building:levels']) * 3.2;
      buildings.push({id: 'osm_' + el.id, rings: [ring], center: [Math.round(cx * 100) / 100, Math.round(cz * 100) / 100], area: Math.round(ar * 10) / 10, sourceDate: null, source: 'OpenStreetMap', height, kind: t.building});
    }
  }
  const xs = roads.flatMap(r => r.points.map(p => p[0])), zs = roads.flatMap(r => r.points.map(p => p[1]));
  const stamp = new Date().toISOString().slice(0, 10);
  const world = {origin: [frame.lon0, frame.lat0], bbox: [Math.min(...xs, 0), Math.min(...zs, 0), Math.max(...xs, 0), Math.max(...zs, 0)], buildings, roads,
    audit: {buildings: buildings.length, roadSegments: roads.length, namedRoads: new Set(roads.filter(r => r.name !== 'UNNAMED ROAD').map(r => r.name)).size, verifiedBuildingHeights: buildings.filter(b => b.height).length,
      coordinateSystem: 'tmerc about ' + frame.lat0.toFixed(5) + ',' + frame.lon0.toFixed(5) + '; z south', buildingSources: ['OpenStreetMap'], source: 'OpenStreetMap contributors, via Overpass, built in the browser', fetched: stamp}};
  return {world,
    places: {source: 'OpenStreetMap contributors', fetched: stamp, complete: false, places},
    crossings: {source: 'OpenStreetMap contributors', fetched: stamp, note: 'direction is resolved against the road network at load', crossings},
    power: {source: 'OpenStreetMap contributors', fetched: stamp, poles, lines},
    assets: {source: 'OpenStreetMap contributors', date: stamp, complete: false, counts: {lamps: lamps.length, busStops: busStops.length, signals: signals.length}, lamps, busStops, signals, assets: hydrants}};
}

/* ---- rides: the same passes Winthrop has, from whatever the town has ---- */
function makeTours(seed, frame, town) {
  const cats = [
    {id: 'food', name: 'Eat your way through ' + town, blurb: 'Every restaurant, cafe, bar and bakery in town.', test: t => /^(restaurant|cafe|fast_food|bar|pub|ice_cream|bakery)$/.test(t.amenity || ''), kind: 'food'},
    {id: 'landmarks', name: 'Landmarks', blurb: 'The places people come to see: the historic, the museums, the views.', test: t => t.historic || /^(attraction|museum|viewpoint|artwork|gallery|zoo|aquarium)$/.test(t.tourism || ''), kind: 'landmark'},
    {id: 'worship', name: 'Churches and temples', blurb: 'Every place of worship in town.', test: t => t.amenity === 'place_of_worship', kind: 'church'},
    {id: 'parks', name: 'All the parks', blurb: 'Every park, playground and garden in town, in one loop.', test: t => /^(park|playground|garden|nature_reserve)$/.test(t.leisure || ''), kind: 'park'},
    {id: 'beaches', name: 'Beach to beach', blurb: 'Every beach and marina on the water.', test: t => t.natural === 'beach' || t.leisure === 'marina' || t.leisure === 'beach_resort', kind: 'beach'},
    {id: 'schools', name: 'Schools', blurb: 'Every school and library.', test: t => /^(school|library)$/.test(t.amenity || ''), kind: 'school'},
    {id: 'nightlife', name: 'A night out', blurb: 'Theatres, cinemas and stadiums.', test: t => /^(theatre|cinema)$/.test(t.amenity || '') || t.leisure === 'stadium', kind: 'night'}
  ];
  const items = [];
  for (const el of seed.elements || []) {
    const t = el.tags || {}; if (!t.name) continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon; if (lat == null) continue;
    const [x, z] = frame.xz(lon, lat);
    items.push({name: t.name, x, z, t, address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null});
  }
  const tours = [];
  for (const c of cats) {
    const seen = new Set(); const stops = items.filter(i => c.test(i.t) && !seen.has(i.name) && seen.add(i.name));
    if (stops.length < 3) continue;
    // nearest-neighbour order from the middle of town, so the ride is one loop rather than a zigzag
    const order = []; let cur = {x: 0, z: 0}; const left = stops.slice();
    while (left.length && order.length < 18) { let bi = 0, bd = 1e12; left.forEach((s, i) => { const d = (s.x - cur.x) ** 2 + (s.z - cur.z) ** 2; if (d < bd) { bd = d; bi = i; } }); cur = left.splice(bi, 1)[0]; order.push(cur); }
    tours.push({id: c.id, name: c.name, blurb: c.blurb, stops: order.map(s => ({name: s.name, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10, kind: c.kind, address: s.address, photo: null}))});
  }
  return tours;
}

/* ---- terrain: Terrarium tiles decoded on a canvas ---- */
async function terrain(s, w, n, e, frame, step = 8, z = 14) {
  const tile = (lat, lon) => { const x = (lon + 180) / 360 * 2 ** z; const y = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z; return [x, y]; };
  const [x0, y0] = tile(n, w), [x1, y1] = tile(s, e); const tiles = new Map();
  const jobs = [];
  for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) jobs.push([tx, ty]);
  await Promise.all(jobs.map(async ([tx, ty]) => {
    try {
      const blob = await (await fetch(TERRARIUM.replace('{z}', z).replace('{x}', tx).replace('{y}', ty))).blob();
      const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      tiles.set(tx + ',' + ty, g.getImageData(0, 0, 256, 256).data);
    } catch (_) {}
  }));
  const height = (lat, lon) => { const [x, y] = tile(lat, lon); const tx = Math.floor(x), ty = Math.floor(y); const im = tiles.get(tx + ',' + ty); if (!im) return 0; const px = Math.min(255, Math.floor((x - tx) * 256)), py = Math.min(255, Math.floor((y - ty) * 256)); const i = (py * 256 + px) * 4; return im[i] * 256 + im[i + 1] + im[i + 2] / 256 - 32768; };
  const sw = frame.xz(w, s), ne = frame.xz(e, n);
  const xmin = Math.min(sw[0], ne[0]), xmax = Math.max(sw[0], ne[0]), zmin = Math.min(sw[1], ne[1]), zmax = Math.max(sw[1], ne[1]);
  const cols = Math.floor((xmax - xmin) / step) + 2, rows = Math.floor((zmax - zmin) / step) + 2, values = new Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const [lon, lat] = frame.lonlat(xmin + i * step, zmin + j * step); values[j * cols + i] = Math.round(Math.max(0, height(lat, lon)) * 100) / 100; }
  return {grid: {x: Math.round(xmin * 100) / 100, z: Math.round(zmin * 100) / 100, step, cols, rows, values}, bounds: [xmin, zmin, xmax, zmax], tiles: tiles.size};
}

/* ---- surfaces: the road / sidewalk / curb / ground triangles the car drives on (surfaces.py, ported) ---- */
function surfaces(world, grid) {
  const ROAD = .12, WALK = .27, CURB_W = .25, WALK_W = 1.6, GSTEP = 16;
  const V = grid.values, h = (x, z) => { const u = Math.min(Math.max((x - grid.x) / grid.step, 0), grid.cols - 1.000001), w = Math.min(Math.max((z - grid.z) / grid.step, 0), grid.rows - 1.000001); const i = u | 0, j = w | 0, a = u - i, b = w - j; return V[j * grid.cols + i] * (1 - a) * (1 - b) + V[j * grid.cols + i + 1] * a * (1 - b) + V[(j + 1) * grid.cols + i] * (1 - a) * b + V[(j + 1) * grid.cols + i + 1] * a * b; };
  const road = [], walk = [], curb = [], ground = [];
  const quad = (o, p, q, r, s) => o.push(...p, ...q, ...r, ...p, ...r, ...s);
  const strip = (o, a, b, o0, o1, l0, l1) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < .2) return; const nx = -dz / L, nz = dx / L; const P = (x, z, off, lift) => { const px = x + nx * off, pz = z + nz * off; return [px, h(px, pz) + lift, pz]; }; quad(o, P(a[0], a[1], o0, l0), P(b[0], b[1], o0, l0), P(b[0], b[1], o1, l1), P(a[0], a[1], o1, l1)); };
  const disc = (o, c, r, lift) => { const cy = h(c[0], c[1]) + lift, n = 10; for (let k = 0; k < n; k++) { const t0 = 2 * Math.PI * k / n, t1 = 2 * Math.PI * (k + 1) / n; const px = c[0] + Math.cos(t0) * r, pz = c[1] + Math.sin(t0) * r, qx = c[0] + Math.cos(t1) * r, qz = c[1] + Math.sin(t1) * r; o.push(c[0], cy, c[1], px, h(px, pz) + lift, pz, qx, h(qx, qz) + lift, qz); } };
  for (const r of world.roads) {
    if (r.type >= 7) continue; const w = Math.max(3, r.width || 7.5), half = w / 2, hasWalk = r.type <= 5 && !['service', 'track'].includes(r.osmHighway);
    const pts = r.points;
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; strip(road, a, b, -half, half, ROAD, ROAD); for (const side of [-1, 1]) { strip(curb, a, b, side * half, side * (half + CURB_W), ROAD, WALK); if (hasWalk) strip(walk, a, b, side * (half + CURB_W), side * (half + CURB_W + WALK_W), WALK, WALK); } }
    for (const p of pts) disc(road, p, half, ROAD);
  }
  const X = Math.floor((grid.cols - 1) * grid.step / GSTEP), Z = Math.floor((grid.rows - 1) * grid.step / GSTEP);
  for (let j = 0; j < Z; j++) for (let i = 0; i < X; i++) { const x = grid.x + i * GSTEP, z = grid.z + j * GSTEP, x2 = x + GSTEP, z2 = z + GSTEP; quad(ground, [x, h(x, z), z], [x2, h(x2, z), z], [x2, h(x2, z2), z2], [x, h(x, z2), z2]); }
  return {road: new Float32Array(road), walk: new Float32Array(walk), curb: new Float32Array(curb), ground: new Float32Array(ground)};
}

/* ---- the ground photo: NAIP for the US, 2×2 tiles ---- */
async function naip(s, w, n, e, frame, onNote) {
  const got = [], cells = 2, px = 1536;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const cs = s + (n - s) * j / cells, cn = s + (n - s) * (j + 1) / cells, cw = w + (e - w) * i / cells, ce = w + (e - w) * (i + 1) / cells;
    try {
      onNote && onNote('fetching the aerial photo (' + (j * cells + i + 1) + ' of 4)…');
      const r = await fetch(NAIP.replace('{s}', cs).replace('{w}', cw).replace('{n}', cn).replace('{e}', ce).replace(/{px}/g, px)); if (!r.ok) throw 0;
      const blob = await r.blob(); if (blob.size < 3000) throw 0;
      const sw = frame.xz(cw, cs), ne = frame.xz(ce, cn);
      got.push({file: `naip-${j}-${i}.jpg`, blob, bbox: [cw, cs, ce, cn], bboxLocal: [sw[0], -sw[1], ne[0], -ne[1]]});
    } catch (_) {}
  }
  return got;
}

/* ---- the whole build; writes into the Cache API under ./worlds/<slug>/ ---- */
export async function buildCity({name, lat, lon, country, slug, big = false}, onProgress = () => {}) {
  const frame = makeFrame(lat, lon);
  const HALF = big ? HALF_CITY : HALF_TOWN;
  const dLat = HALF / 111320, dLon = HALF / (111320 * Math.cos(lat * Math.PI / 180));
  const s = lat - dLat, n = lat + dLat, w = lon - dLon, e = lon + dLon;
  const note = (t, k) => onProgress({text: t, k});
  note('asking OpenStreetMap for every street and building…', .05);
  const bb = `(${s},${w},${n},${e})`;
  const qWays = `[out:json][timeout:60];(way["highway"]${bb};way["building"]${bb};way["power"~"^(minor_)?line$"]${bb};);out body geom;`;
  const qNodes = `[out:json][timeout:60];(node["amenity"]${bb};node["shop"]${bb};node["tourism"]${bb};node["leisure"]${bb};node["highway"~"^(crossing|street_lamp|bus_stop|traffic_signals)$"]${bb};node["emergency"="fire_hydrant"]${bb};node["power"="pole"]${bb};);out body;`;
  const ways = await overpass(qWays, t => note(t, .08));           // one at a time: two races at once was six requests from one phone
  note('asking OpenStreetMap for the shops, parks, signs and lights…', .22);
  const pts = await overpass(qNodes);
  note('finding the restaurants, landmarks, churches, parks and beaches…', .27);
  const qTours = `[out:json][timeout:60];(nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|bakery|place_of_worship|school|library|theatre|cinema)$"]${bb};nwr["tourism"~"^(attraction|museum|viewpoint|artwork|gallery|zoo|aquarium)$"]${bb};nwr["historic"]${bb};nwr["leisure"~"^(park|playground|garden|nature_reserve|stadium|marina)$"]${bb};nwr["natural"="beach"]${bb};);out center tags;`;
  let tourSeed = {elements: []}; try { tourSeed = await overpass(qTours); } catch (_) {}
  const osm = {elements: [...pts.elements, ...ways.elements]};
  note('laying out the streets…', .3);
  const parsed = parseOSM(osm, frame, name);
  const tours = makeTours(tourSeed, frame, name);
  if (parsed.world.roads.length < 5) throw new Error('OpenStreetMap has almost no streets here');
  note('reading the land (elevation tiles)…', .4);
  const terr = await terrain(s, w, n, e, frame);
  note('pouring the roads, sidewalks and curbs…', .55);
  const surf = surfaces(parsed.world, terr.grid);
  let tiles = [];
  if (country === 'US') { note('fetching the aerial photo…', .65); tiles = await naip(s, w, n, e, frame, t => note(t, .7)); }
  note('writing the town…', .9);
  const base = new URL('./worlds/' + slug + '/', location.href).href;
  const cache = await caches.open('factory-worlds');
  const put = (file, body, type) => cache.put(base + file, new Response(body, {headers: {'Content-Type': type, 'X-Factory': slug}}));
  const outline = parsed.world.roads.filter(r => r.type < 7 && r.points.length > 1).map(r => r.points.map(p => [Math.round(p[0]), Math.round(p[1])]));
  const foundation = {origin: [frame.lon0, frame.lat0], bounds: terr.bounds.map(v => Math.round(v * 100) / 100), terrain: terr.grid,
    surfaces: {road: {url: './worlds/' + slug + '/road-surface.bin', triangles: surf.road.length / 9}, walk: {url: './worlds/' + slug + '/walk-surface.bin', triangles: surf.walk.length / 9}, curb: {url: './worlds/' + slug + '/curb-surface.bin', triangles: surf.curb.length / 9}, ground: {url: './worlds/' + slug + '/ground-surface.bin', triangles: surf.ground.length / 9}},
    roadEvidence: parsed.world.roads.filter(r => r.type < 7).flatMap(r => r.points.slice(1).map((b, i) => ({a: r.points[i], b, name: r.name, width: r.width, objectId: r.id, widthSource: 'osm', sidewalks: [null, null], direction: r.directions[i], source: 'https://www.openstreetmap.org/way/' + r.id}))),
    audit: {source: 'OpenStreetMap roads; Terrarium elevation (AWS open data); built in the browser', elevation: 'Terrarium z14 (~10 m) sampled at 8 m; below sea level clamped to 0', terrainTiles: terr.tiles}};
  const J = 'application/json';
  await Promise.all([
    put('world.json', JSON.stringify(parsed.world), J), put('road-foundation.json', JSON.stringify(foundation), J), put('outline.json', JSON.stringify(outline), J),
    put('places.json', JSON.stringify(parsed.places), J), put('crossings.json', JSON.stringify(parsed.crossings), J), put('power-lines.json', JSON.stringify(parsed.power), J), put('street-assets.json', JSON.stringify(parsed.assets), J),
    put('road-surface.bin', surf.road, 'application/octet-stream'), put('walk-surface.bin', surf.walk, 'application/octet-stream'), put('curb-surface.bin', surf.curb, 'application/octet-stream'), put('ground-surface.bin', surf.ground, 'application/octet-stream'),
    put('naip/extent.json', JSON.stringify({source: 'USGS NAIP Plus WMS', tiles: tiles.map(t => ({file: t.file, bbox: t.bbox, bboxLocal: t.bboxLocal}))}), J),
    ...tiles.map(t => put('naip/' + t.file, t.blob, 'image/jpeg')),
    put('tours.json', JSON.stringify({source: 'OpenStreetMap contributors, built in the browser', tours}), J),
    put('town.json', JSON.stringify({name, slug, lat, lon, country, built: new Date().toISOString(), audit: parsed.world.audit, rides: tours.length, tagline: 'Every street in ' + name + ', from free open data. Built on this phone in a minute.'}), J)
  ]);
  note('done', 1);
  return {slug, audit: parsed.world.audit, tiles: tiles.length, terrainTiles: terr.tiles};
}

export async function builtCities() {
  const cache = await caches.open('factory-worlds'); const keys = await cache.keys(); const out = new Map();
  for (const k of keys) { const m = k.url.match(/\/worlds\/([a-z0-9-]+)\/town\.json$/); if (m) { try { out.set(m[1], await (await cache.match(k)).json()); } catch (_) {} } }
  return [...out.values()];
}
