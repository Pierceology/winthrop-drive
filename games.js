/* Drive Winthrop — errands.
   A short timed drive from wherever the car is standing to a real Winthrop place, driven by the person, not
   by the auto-driver. The destinations come straight out of data/games.json, which is copied from the town
   data; nothing here invents a shop or a coordinate.

   What the score is made of, and why it is only made of this: the par time is the actual shortest route over
   the road graph (auto-cruise's own planner) divided by the posted speed limits the same planner drives to,
   with an allowance for pulling away, for every real turn, and for parking. The only penalties are the two
   things the driving code genuinely observes about a human driver: state.wrongWay (a mapped one-way taken
   against its direction) and state.assisting (the car pressed into the road edge). Traffic lights are NOT
   scored: driving-physics.js never consults the signals for a human driver, so a red light is not something
   this game can see, and a score that pretended otherwise would be a lie. */

const DATA = './data/games.json';
const STORE = 'dw.errands.best.v1';
const SITE = 'https://www.winthropbythesea.com/';
const MI = 1 / 1609.344;
const ARRIVE_SPEED = 1.6;          // m/s — "roughly stopped"
const WRONGWAY_HOLD = 0.4;         // seconds before a wrong-way counts as one
const CURB_HOLD = 0.5;             // seconds of road-edge assist before a curb counts as one
const WRONGWAY_COST = 8;           // seconds added per wrong-way
const CURB_COST = 3;               // seconds added per curb
const JUMP = 80;                   // metres in one tick that no car can drive: the run was moved, not driven
const MIN_AWAY = 200;              // metres — closer than this is a walk, not an errand
const TURNAROUND = 7;              // seconds par allows for pressing Turn around before setting off

/* ---------- the way there: what the minimap draws and the readout says while an errand runs ---------- */
const TURN_ANGLE = 0.35;           // radians — the same bend auto-cruise calls a real turn, and par charges for
const TURN_SPAN = 20;              // metres — a corner cut into several short pieces is still one corner
const TURN_NEAR = 70;              // metres — closer than this the instruction drops the distance
const REPLAN = 2.5;                // seconds of car clock between route searches
const OFF_ROUTE = 28;              // metres off the line before the way is worked out again
const ROUTE_INK = '#f0b860';       // games.css --accent
const CASING = 'rgba(6,11,16,.85)';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function miles(m) {
  const v = m * MI;
  return (v < 0.1 ? v.toFixed(2) : v.toFixed(1)) + ' mi';
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
// Under a tenth of a mile, "0.04 mi" tells a driver nothing. Feet do.
function away(m) {
  const feet = m * 3.28084;
  return feet < 528 ? Math.max(50, Math.round(feet / 50) * 50) + ' ft' : miles(m);
}
// Street names arrive from OpenStreetMap in capitals. The road-name panel is uppercased by CSS anyway; a line
// of guidance is a sentence, so it is set the way it is spoken. Nothing is renamed, only recased.
function titleCase(name) {
  return String(name || '').toLowerCase()
    .replace(/\b[a-z]/g, c => c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase());
}

function readBest() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) { return {}; }
}
function writeBest(all) {
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch (_) { /* private mode: the run still counts, it just is not remembered */ }
}

/* ---------- the road graph: real route length, real par ---------- */

// The directed edges the car could set off along from here: the nearest one, and — where the street is
// two-way — the same piece of road the other way, because Turn around is a button the driver has.
function startsAt(cruise, x, z) {
  const near = cruise.edgesNear ? cruise.edgesNear(x, z, 400) : [];
  if (!near || !near.length) return [];
  return near.filter(g => g.d <= near[0].d + 1.5).slice(0, 2);
}

// Route length and free-flow time from one directed edge to a point, over the same graph the auto-driver uses.
function leg(cruise, from, fromT, target) {
  if (!from || !cruise.planRoute) return null;
  let plan = null;
  try { plan = cruise.planRoute(from, target); } catch (_) { return null; }
  if (!plan || !plan.route || !plan.route.length) return null;
  const route = plan.route;
  let metres = 0, seconds = 0, turns = 0;
  for (let i = 0; i < route.length; i++) {
    const e = route[i];
    let len = e.length;
    // A one-edge route is a straight run along a single piece of street: what is left of it between
    // where the car stands and where the door is, not the whole piece.
    if (route.length === 1) len = e.length * Math.abs(clamp(plan.t, 0, 1) - clamp(fromT || 0, 0, 1));
    else {
      if (i === 0) len -= e.length * clamp(fromT || 0, 0, 1);
      if (i === route.length - 1) len -= e.length * (1 - clamp(plan.t, 0, 1));
    }
    len = Math.max(0, len);
    metres += len;
    seconds += len / Math.max(2, cruise.limit(e));
    if (i > 0) {
      const p = route[i - 1];
      const cos = (e.dx * p.dx + e.dz * p.dz) / (e.length * p.length);
      if (Math.acos(clamp(cos, -1, 1)) > 0.35) turns++;
    }
  }
  // Where the route actually puts the car down, and how far that is from the pin on the building: a shop
  // is reached from the curb outside it, and on some streets that curb is the length of a garden away.
  const g = route[route.length - 1], gt = clamp(plan.t, 0, 1);
  const gap = dist(g.a[0] + g.dx * gt, g.a[1] + g.dz * gt, target.x, target.z);
  return { metres, seconds, turns, gap, last: g, lastT: plan.t };
}

// Par for a whole errand: out, and back again when it is a loop.
// free-flow + 15% for the give-and-take of a real street, 2.5s per turn, 5s to pull away and park.
function parFor(cruise, errand, from) {
  if (!from || !errand.home) return null;
  const out = leg(cruise, from.e, from.t, errand);
  if (!out) return null;
  let metres = out.metres, seconds = out.seconds, turns = out.turns;
  let crow = dist(errand.home.x, errand.home.z, errand.x, errand.z);
  if (errand.roundTrip) {
    const back = leg(cruise, out.last, out.lastT, errand.home);
    if (!back) return null;
    metres += back.metres; seconds += back.seconds; turns += back.turns;
    crow *= 2;
  }
  // A route can never be shorter than the crow flies. Where the planner cannot express the way round
  // (a one-way it has to loop past, a door behind you on the same block) it hands back less than that,
  // and a par built on it would be unwinnable. Fall back to the crow line at a town 20 mph.
  if (metres < crow) { metres = crow; seconds = Math.max(seconds, crow / 8.94); }
  return { metres, par: seconds * 1.15 + 5 + 2.5 * turns, turns, gap: out.gap };
}

// Par for an errand from a standing start: the best of the ways out of this spot. Setting off the way the
// car is already pointed is free; turning it round first costs what turning it round costs.
function bestPar(cruise, errand, origin, yaw) {
  let best = null;
  for (const g of startsAt(cruise, origin.x, origin.z)) {
    const p = parFor(cruise, { ...errand, home: origin }, g);
    if (!p) continue;
    const aligned = (-Math.sin(yaw) * g.e.dx - Math.cos(yaw) * g.e.dz) >= 0;
    const par = p.par + (aligned ? 0 : TURNAROUND);
    if (!best || par < best.par) best = { metres: p.metres, turns: p.turns, gap: p.gap, par };
  }
  return best;
}

/* ---------- the way there ----------
   One route, from the same planner par was built on, turned into three things: a line for the minimap, a
   marker for the door, and one sentence about the next corner. The route is re-planned from wherever the car
   actually is, so a wrong turn is followed rather than argued with. Nothing here is scored, and nothing here
   claims a rule the game does not enforce: it says which way, not how fast, and never mentions a light. */

// The directed edge the car is on and pointed along — the same test auto-cruise uses to set off.
function edgeUnder(cruise, s) {
  const near = cruise.edgesNear ? cruise.edgesNear(s.x, s.z, 90) : [];
  let best = null;
  for (const g of near.slice(0, 10)) {
    const aligned = (-Math.sin(s.yaw) * g.e.dx - Math.cos(s.yaw) * g.e.dz) >= 0;
    const score = g.d + (aligned ? 0 : 3);
    if (!best || score < best.score) best = { g, score };
  }
  return best && best.g;
}

// Signed bend from one unit heading to the next: negative is a left turn (north is up, z runs south).
function bend(a, b) {
  const cos = clamp(a[0] * b[0] + a[1] * b[1], -1, 1);
  return ((a[0] * b[1] - a[1] * b[0]) < 0 ? -1 : 1) * Math.acos(cos);
}

// Every real corner on the line, in order, with how far along the line it is and the street it turns onto.
// A corner OSM has cut into three short pieces is one corner: the bend is gathered over TURN_SPAN metres.
function cornersOf(pts, cum, names) {
  const dirs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dz) || 1;
    dirs.push([dx / l, dz / l, l]);
  }
  const out = [];
  for (let i = 0; i < dirs.length - 1; i++) {
    let angle = 0, span = 0, j = i, onto = '';
    while (j < dirs.length - 1) {
      angle += bend(dirs[j], dirs[j + 1]);
      span += dirs[j + 1][2];
      if (!onto && names[j + 1] && names[j + 1] !== names[i]) onto = names[j + 1];
      j++;
      if (Math.abs(angle) > TURN_ANGLE || span > TURN_SPAN) break;
    }
    if (Math.abs(angle) > TURN_ANGLE) {
      out.push({ at: cum[i + 1], left: angle < 0, name: onto, angle: Math.abs(angle) });
      i = j - 1;
    }
  }
  return out;
}

// Plan the way from where the car stands to a point, and keep it as a polyline over the street centres —
// the same lines the minimap already draws, so the route sits on the roads rather than beside them.
function planGuide(cruise, s, to) {
  const from = edgeUnder(cruise, s);
  if (!from || !cruise.planRoute) return null;
  let plan = null;
  try { plan = cruise.planRoute(from.e, to); } catch (_) { return null; }
  if (!plan || !plan.route || !plan.route.length) return null;
  const route = plan.route, n = route.length, t0 = clamp(from.t, 0, 1), tEnd = clamp(plan.t, 0, 1);
  const pts = [], names = [];
  const push = (p, name) => {
    const last = pts[pts.length - 1];
    if (last && dist(last[0], last[1], p[0], p[1]) < 0.75) { names[names.length - 1] = name; return; }
    pts.push(p); names.push(name);
  };
  push([route[0].a[0] + route[0].dx * t0, route[0].a[1] + route[0].dz * t0], route[0].name || '');
  for (let i = 0; i < n; i++) {
    const p = i < n - 1 ? [route[i].b[0], route[i].b[1]]
      : [route[n - 1].a[0] + route[n - 1].dx * tEnd, route[n - 1].a[1] + route[n - 1].dz * tEnd];
    push(p, (i < n - 1 ? route[i + 1].name : route[i].name) || '');
  }
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  const end = pts[pts.length - 1];
  return {
    pts, cum, names, corners: cornersOf(pts, cum, names), total: cum[cum.length - 1],
    door: dist(end[0], end[1], to.x, to.z), travelled: 0, off: 0, turn: null
  };
}

// Where along the line the car has got to, how far off it, and which corner comes next. Cheap: it runs every
// frame, on a handful of points, and never searches the graph.
function follow(guide, s) {
  let best = null;
  for (let i = 0; i < guide.pts.length - 1; i++) {
    const a = guide.pts[i], b = guide.pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const t = clamp(((s.x - a[0]) * dx + (s.z - a[1]) * dz) / l2, 0, 1);
    const d = dist(s.x, s.z, a[0] + dx * t, a[1] + dz * t);
    const at = guide.cum[i] + Math.hypot(dx, dz) * t;
    // where a route passes near itself, stay on the part of it the car was already driving
    const score = d + Math.min(60, Math.abs(at - guide.travelled)) * 0.25;
    if (!best || score < best.score) best = { score, d, at };
  }
  if (!best) return guide;
  guide.off = best.d;
  guide.travelled = best.at;
  guide.remaining = Math.max(0, guide.total - best.at);
  const turn = guide.corners.find(c => c.at - best.at > 6) || null;
  guide.turn = turn && { ...turn, dist: turn.at - best.at };
  return guide;
}

// How much of the journey is left, by road: the route still to drive plus the last few metres from the curb
// to the door. It is the number the readout and the map both use, so they never disagree.
function toGo(guide) { return guide && typeof guide.remaining === 'number' ? guide.remaining + guide.door : null; }

// One sentence. A corner with a name gets the name; a corner without one is still a corner, and saying
// "left" without pretending to know the street is better than naming the wrong street.
function turnWords(guide) {
  if (!guide) return '';
  const t = guide.turn, left = toGo(guide);
  if (!t) return left > 30 ? 'Straight for ' + away(left) : '';
  const way = t.left ? 'Left' : 'Right';
  if (t.dist <= TURN_NEAR) return t.name ? way + ' on ' + titleCase(t.name) : 'Turn ' + way.toLowerCase();
  return (t.name ? way + ' on ' + titleCase(t.name) : way) + ' in ' + away(t.dist);
}

/* ---------- the module ---------- */

function start(drive) {
  let errands = [];
  let run = null;                     // the errand in progress
  let panelOpen = false;
  let raf = null;

  /* ---- chrome ---- */

  const button = document.createElement('button');
  button.id = 'errandsBtn';
  button.type = 'button';
  button.textContent = 'Errands';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'errandPanel');

  const strip = document.querySelector('#drivehud .driveactions');
  const tray = $('dockExtras');
  // A phone puts everything secondary behind More, and an errand is secondary to steering with a thumb.
  // On a mouse the errand is the reason the dock exists, so it sits in the row, next to Turn around —
  // the two things you do while you are already driving, together and to the right of who is driving.
  if (tray && document.body.classList.contains('touch-ui')) tray.prepend(button);
  else if (strip) strip.insertBefore(button, $('turnAround'));
  else return;

  const panel = document.createElement('section');
  panel.id = 'errandPanel';
  panel.className = 'errandsheet';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Run an errand');
  panel.innerHTML =
    '<div class="errandhead"><h2>Run an errand</h2><button type="button" class="errandclose" aria-label="Close errands">×</button></div>' +
    '<p class="errandnote">Short drives from where you are standing. You drive; the clock runs until you stop at the door.</p>' +
    '<ul class="errandlist"></ul>';
  document.body.append(panel);

  const result = document.createElement('section');
  result.id = 'errandResult';
  result.className = 'errandsheet';
  result.hidden = true;
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  document.body.append(result);

  const readout = document.createElement('div');
  readout.id = 'errandRun';
  readout.hidden = true;
  readout.setAttribute('role', 'status');
  // Pierce, 2026-09-10: "the score and timing is so tight". Four things were on one line. Now the clock is
  // an anchor on the left, where you are going sits above how far is left, and the next corner gets a band
  // of its own under a rule. Reading order is the DOM order; games.css only places it.
  readout.innerHTML = '<b class="ertime">0:00</b>' +
    '<span class="erline"><span class="erwhere"></span><span class="erto"></span></span>' +
    '<button type="button" class="ergiveup">Give up</button>' +
    '<span class="erturn"></span>';
  document.body.append(readout);

  const list = panel.querySelector('.errandlist');
  const erTime = readout.querySelector('.ertime');
  const erTo = readout.querySelector('.erto');
  const erWhere = readout.querySelector('.erwhere');
  const erTurn = readout.querySelector('.erturn');
  const mapCanvas = $('minimap');

  button.onclick = () => { panelOpen ? closePanel() : openPanel(); };
  panel.querySelector('.errandclose').onclick = closePanel;
  readout.querySelector('.ergiveup').onclick = () => finish('gave up');
  // Escape puts the sheet away before driving.js can read it as "leave the drive". driving.js registered
  // its keydown first, so the only way to get in front of it is the capture phase.
  addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (!result.hidden) { e.preventDefault(); e.stopImmediatePropagation(); result.hidden = true; return; }
    if (panelOpen) { e.preventDefault(); e.stopImmediatePropagation(); closePanel(); }
  }, true);

  /* ---- the list ---- */

  function openPanel() {
    if (!drive.active) return;
    result.hidden = true;
    panelOpen = true;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.body.classList.add('errands-open');
    buildList();
    tick();
  }
  function closePanel() {
    panelOpen = false;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('errands-open');
  }

  // Nearest first, but never four pizzas in a row: at most two of any one kind. A place you could
  // already walk to is not an errand, so anything inside MIN_AWAY is left off the list.
  function nearby(limit = 8) {
    const s = drive.state;
    const scored = errands.map(e => ({ e, d: dist(s.x, s.z, e.x, e.z) }))
      .filter(r => r.d >= MIN_AWAY).sort((a, b) => a.d - b.d);
    const seen = new Map(), out = [];
    for (const row of scored) {
      const n = seen.get(row.e.kind) || 0;
      if (n >= 2) continue;
      seen.set(row.e.kind, n + 1);
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
  }

  function buildList() {
    const best = readBest();
    const rows = nearby();
    list.textContent = '';
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'errandempty';
      li.textContent = 'No errands loaded.';
      list.append(li);
      return;
    }
    const pending = [];
    for (const row of rows) {
      const e = row.e;
      const li = document.createElement('li');
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'errandpick';
      go.dataset.errand = e.id;
      const b = best[e.id];
      go.innerHTML =
        '<span class="ername"></span>' +
        '<span class="ermeta"><span class="erdist"></span><span class="erpar">working out a target…</span></span>' +
        (b ? '<span class="erbest"></span>' : '');
      go.querySelector('.ername').textContent = e.title;
      go.querySelector('.erdist').textContent = miles(row.d) + ' away' + (e.roundTrip ? ', there and back' : '');
      if (b) go.querySelector('.erbest').textContent = 'Your best: ' + clock(b.time);
      go.onclick = () => begin(e);
      li.append(go);
      list.append(li);
      pending.push({ e, node: go.querySelector('.erpar') });
    }
    // Par comes from a real route search, which is not free. Fill them in one per frame so the
    // list is on screen at once and nothing stutters.
    let i = 0;
    const step = () => {
      if (!panelOpen || i >= pending.length) return;
      const { e, node } = pending[i++];
      const p = parOf(e);
      node.textContent = p ? 'Target ' + clock(p.par) + ' · ' + miles(p.metres) + ' of road' : 'No mapped route from here';
      if (!p) node.closest('.errandpick').disabled = true;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function parOf(errand) {
    const s = drive.state;
    return bestPar(drive.cruise, errand, { x: s.x, z: s.z }, s.yaw);
  }

  /* ---- running one ---- */

  // "Arrived" is measured from the curb the route can actually reach, plus a couple of car lengths —
  // not from the pin on the roof, which on some streets is a whole garden away from any road.
  const arrivalRadius = (gap, floor) => clamp((gap || 0) + 16, floor, 120);

  function begin(errand) {
    const s = drive.state;
    const home = { x: s.x, z: s.z };
    const p = bestPar(drive.cruise, errand, home, s.yaw);
    if (!p) return;
    if (drive.cruise && drive.cruise.active) drive.cruise.stop();
    if (drive.paused) drive.pause(false);
    run = {
      errand, home, par: p.par, metres: p.metres,
      elapsed: 0, clock: drive.clock,
      legIndex: 0, radius: arrivalRadius(p.gap, errand.radius || 45), homeRadius: 55,
      wrongWay: 0, curbs: 0, wrongTimer: 0, curbTimer: 0, wrongOn: false, curbOn: false,
      lastX: s.x, lastZ: s.z, voided: null, guide: null
    };
    closePanel();
    result.hidden = true;
    readout.hidden = false;
    document.body.classList.add('errand-running');
    drive.mapOverlay = drawGuide;
    paint();
    tick();
  }

  function target() {
    if (!run) return null;
    return run.legIndex === 0 ? run.errand : run.home;
  }
  function targetName() {
    if (!run) return '';
    return run.legIndex === 0 ? run.errand.place : 'back where you started';
  }
  function radius() {
    if (!run) return 45;
    return run.legIndex === 0 ? run.radius : run.homeRadius;
  }

  // The route is re-planned from where the car actually is, not from where it was told to go: every REPLAN
  // seconds of car clock, whenever the driver strays off the line, and the moment a round trip turns for home.
  // A search that comes back empty keeps the last good line for a few seconds rather than blinking it away.
  function guideNow() {
    if (!run) return null;
    const s = drive.state;
    let g = run.guide;
    if (!g || g.leg !== run.legIndex || drive.clock - g.at > REPLAN || g.off > OFF_ROUTE) {
      const built = planGuide(drive.cruise, s, target());
      if (built) { built.leg = run.legIndex; built.at = built.fresh = drive.clock; run.guide = built; }
      else if (!g || g.leg !== run.legIndex || drive.clock - g.fresh > 12) run.guide = null;
      else g.at = drive.clock - REPLAN + 0.6;
      g = run.guide;
    }
    return g && follow(g, s);
  }

  function paint() {
    if (!run) return;
    const s = drive.state, t = target(), g = guideNow(), crow = dist(s.x, s.z, t.x, t.z);
    erTime.textContent = clock(run.elapsed);
    // by road while there is a route to measure — the way round a one-way is part of the errand — and as the
    // crow flies when the planner has nothing to offer from here.
    erTo.textContent = miles(toGo(g) ?? crow) + ' to go';
    erWhere.textContent = targetName();
    readout.classList.toggle('close', crow < radius() * 1.8);
    erTurn.textContent = turnWords(g);
  }

  /* ---- the minimap, while an errand is running ---- */

  // North up, the car at the centre, the same 0.4 px per metre the streets are drawn at. Registered when a run
  // starts and taken off the moment it ends, so free drive and tours see exactly the map they saw before.
  function drawGuide(ctx, s, size, scale) {
    if (!run) return;
    const half = size / 2, to = target(), g = run.guide;
    // 180 px of canvas is shown at whatever the layout allows — 84 px on a phone. Weights are set in canvas
    // pixels, so they are scaled up to still read at the size the map is really drawn.
    const shown = mapCanvas.clientWidth || size, k = clamp(size / shown, 1, 1.9);
    const at = (x, z) => [half + (x - s.x) * scale, half + (z - s.z) * scale];
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    if (g && g.pts.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < g.pts.length; i++) {
        const [px, py] = at(g.pts[i][0], g.pts[i][1]);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.strokeStyle = CASING; ctx.lineWidth = 5.6 * k; ctx.stroke();
      ctx.strokeStyle = ROUTE_INK; ctx.lineWidth = 3 * k; ctx.stroke();
      // the last stretch from the curb the route can reach to the door itself, which is not always on a road
      const end = g.pts[g.pts.length - 1];
      if (g.door > 12) {
        ctx.setLineDash([3 * k, 3 * k]);
        ctx.beginPath();
        ctx.moveTo(...at(end[0], end[1]));
        ctx.lineTo(...at(to.x, to.z));
        ctx.lineWidth = 2 * k; ctx.strokeStyle = ROUTE_INK; ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const dx = (to.x - s.x) * scale, dz = (to.z - s.z) * scale, inset = 13 * k, edge = half - inset;
    // The canvas is heading-up: driving.js turns it by the car's yaw before handing it over, so the town
    // rotates and the four edges of the map do not. Whether the door is still on the map, and where on the
    // rim its arrow belongs, are both questions about the canvas, so both are answered in canvas space.
    // Asked in map space, a door out towards a corner put its arrow off the 180px square altogether.
    const yaw = s.yaw || 0, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const ex = dx * cs - dz * sn, ez = dx * sn + dz * cs;
    if (Math.abs(ex) <= edge && Math.abs(ez) <= edge) {
      // the door itself is a place in the town, so it is drawn in the town's space and turns with it
      const [x, y] = at(to.x, to.z), r = 4.2 * k;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ROUTE_INK; ctx.fill();
      ctx.lineWidth = 1.8 * k; ctx.strokeStyle = CASING; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
      ctx.lineWidth = 1.4 * k; ctx.strokeStyle = ROUTE_INK; ctx.stroke();
      return;
    }
    // off the edge of the map: an arrow on the rim, pointing at it, with how far it still is
    const push = Math.min(edge / Math.max(1e-6, Math.abs(ex)), edge / Math.max(1e-6, Math.abs(ez)));
    const px = half + ex * push, py = half + ez * push, out = Math.atan2(ez, ex), w = 6.6 * k;
    // 6.6, not 5.5: with the number beside it at 11px the old triangle read as a speck, and when the
    // door is off the map this arrow is the only thing saying which way it is.
    ctx.save();
    ctx.translate(half, half); ctx.rotate(-yaw); ctx.translate(-half, -half);   // out of the town's rotation
    ctx.save();
    ctx.translate(px, py); ctx.rotate(out);
    ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(-w * .8, w * .82); ctx.lineTo(-w * .8, -w * .82); ctx.closePath();
    ctx.fillStyle = ROUTE_INK; ctx.fill();
    ctx.lineWidth = 1.6 * k; ctx.strokeStyle = CASING; ctx.stroke();
    ctx.restore();
    // A phone shows this map at 84 px. A number on it would be too small to read, and the readout above
    // carries the same distance in type that is not, so the map keeps the arrow and drops the label.
    //
    // Pierce, 2026-09-10: "distnaces in map mini are updaisde down i notce and not nice". It was drawn
    // inside the town's rotation and turned with it, so heading south stood the number on its head. The
    // arrow turns; the type never does. This is also the space the compass badge and the scale bar are
    // drawn in, so the two rules that keep the label off them finally mean what they say.
    if (shown >= 120) {
      const label = miles(toGo(g) ?? dist(s.x, s.z, to.x, to.z));
      // 19px back from the rim, not 15: at 15 the number's casing halo sat on the tail of the arrow
      let tx = clamp(px - Math.cos(out) * 19 * k, 22, size - 22);
      let ty = clamp(py - Math.sin(out) * 19 * k, 13, size - 13);
      const nx = half + Math.sin(yaw) * 70, ny = half - Math.cos(yaw) * 70;   // the compass badge
      for (let i = 0; i < 3 && dist(tx, ty, nx, ny) < 24; i++) {              // step in along the arrow
        tx = clamp(tx - Math.cos(out) * 13 * k, 22, size - 22);
        ty = clamp(ty - Math.sin(out) * 13 * k, 13, size - 13);
      }
      if (ty > 148 && tx < 66) ty = 148;                    // the scale bar owns the bottom left corner
      ctx.font = '600 ' + Math.round(clamp(11 * k, 11, 15)) + 'px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = CASING; ctx.strokeText(label, tx, ty);
      ctx.fillStyle = ROUTE_INK; ctx.fillText(label, tx, ty);
    }
    ctx.restore();
  }

  function tick() {
    raf = null;
    if (run) {
      const s = drive.state;
      if (!drive.active) { finish('left the drive'); }
      else if (drive.cruise && drive.cruise.active) { finish('auto drive took over'); }
      else if (dist(s.x, s.z, run.lastX, run.lastZ) > JUMP) { finish('the car was moved'); }
      else {
        run.lastX = s.x; run.lastZ = s.z;
        // The clock is the car's clock, not the visitor's frame rate: driving.clock only advances while the
        // drive is live and unpaused, so a slow phone and a fast desktop time the same errand the same way.
        const drove = clamp(drive.clock - run.clock, 0, 2);
        run.clock = drive.clock;
        if (drove > 0) {
          run.elapsed += drove;
          // wrong way: a mapped one-way taken against its direction. driving-physics sets this every step.
          if (s.wrongWay) { run.wrongTimer += drove; if (!run.wrongOn && run.wrongTimer > WRONGWAY_HOLD) { run.wrongOn = true; run.wrongWay++; } }
          else { run.wrongTimer = 0; run.wrongOn = false; }
          // curb: the road-edge assist is holding the car back onto the pavement.
          if (s.assisting) { run.curbTimer += drove; if (!run.curbOn && run.curbTimer > CURB_HOLD) { run.curbOn = true; run.curbs++; } }
          else { run.curbTimer = 0; run.curbOn = false; }
          const t = target();
          if (dist(s.x, s.z, t.x, t.z) <= radius() && Math.abs(s.speed) < ARRIVE_SPEED) {
            if (run.legIndex === 0 && run.errand.roundTrip) { run.legIndex = 1; }
            else finish('arrived');
          }
        }
        paint();
      }
    }

    if (panelOpen && !drive.active) closePanel();
    if (run || panelOpen) raf = requestAnimationFrame(tick);
  }

  /* ---- the result ---- */

  function penaltySeconds(r) { return r.wrongWay * WRONGWAY_COST + r.curbs * CURB_COST; }
  function penaltyWords(r) {
    const bits = [];
    if (r.wrongWay) bits.push(plural(r.wrongWay, 'wrong way', 'wrong ways'));
    if (r.curbs) bits.push(plural(r.curbs, 'curb', 'curbs'));
    return bits.join(', ');
  }
  function sharePhrase(e) {
    return e.label + ' to ' + e.place + (e.roundTrip ? ' and back' : '');
  }

  function finish(why) {
    if (!run) return;
    const r = run;
    run = null;
    readout.hidden = true;
    erTurn.textContent = '';
    document.body.classList.remove('errand-running');
    // the way there goes with the errand: the minimap is the plain map again in free drive and on a tour
    if (drive.mapOverlay === drawGuide) drive.mapOverlay = null;
    if (why !== 'arrived') {
      if (why === 'left the drive') return;
      showAbandoned(r, why);
      return;
    }
    const penalties = penaltySeconds(r);
    const official = r.elapsed + penalties;
    const stars = official <= r.par ? 3 : official <= r.par * 1.25 ? 2 : 1;
    const best = readBest();
    const previous = best[r.errand.id] ? best[r.errand.id].time : null;
    const record = previous === null || official < previous;
    if (record) { best[r.errand.id] = { time: Math.round(official), at: Date.now() }; writeBest(best); }

    const share = 'Drive Winthrop — ' + sharePhrase(r.errand) + ' in ' + clock(official) +
      ' (par ' + clock(r.par) + '). ' + (penalties ? penaltyWords(r) + '.' : 'Clean run.') +
      ' ' + SITE.replace(/^https:\/\/www\./, '').replace(/\/$/, '');

    result.textContent = '';
    result.hidden = false;
    const head = document.createElement('div');
    head.className = 'errandhead';
    head.innerHTML = '<h2></h2><button type="button" class="errandclose" aria-label="Close result">×</button>';
    head.querySelector('h2').textContent = r.errand.title;
    head.querySelector('.errandclose').onclick = () => { result.hidden = true; };
    result.append(head);

    if (r.errand.photo) {
      const fig = document.createElement('figure');
      fig.className = 'errandphoto';
      const img = document.createElement('img');
      img.src = r.errand.photo; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = () => fig.remove();
      fig.append(img);
      result.append(fig);
    }

    const score = document.createElement('div');
    score.className = 'errandscore';
    score.innerHTML = '<b class="ertime"></b><span class="erstars"></span><span class="erverdict"></span>';
    score.querySelector('.ertime').textContent = clock(official);
    score.querySelector('.erstars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    score.querySelector('.erstars').setAttribute('aria-label', stars + ' out of 3');
    const delta = official - r.par;
    score.querySelector('.erverdict').textContent = 'Par ' + clock(r.par) + ' · ' +
      (delta <= 0 ? clock(-delta) + ' under' : clock(delta) + ' over');
    result.append(score);

    const detail = document.createElement('ul');
    detail.className = 'erdetail';
    const lines = [];
    lines.push(miles(r.metres) + ' of road at the posted limits' + (r.errand.roundTrip ? ', there and back' : ''));
    lines.push(penalties
      ? 'Driven in ' + clock(r.elapsed) + ' plus ' + penalties + 's for ' + penaltyWords(r)
      : 'Clean run: no wrong ways, no curbs');
    if (r.errand.address) lines.push(r.errand.address);
    lines.push(record
      ? (previous === null ? 'Your first time here' : 'A new best: ' + clock(previous) + ' before')
      : 'Your best here is still ' + clock(previous));
    for (const line of lines) { const li = document.createElement('li'); li.textContent = line; detail.append(li); }
    result.append(detail);

    const actions = document.createElement('div');
    actions.className = 'erpicks';
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button'; shareBtn.className = 'primary'; shareBtn.textContent = 'Copy result';
    shareBtn.onclick = () => sendShare(share, shareBtn);
    const again = document.createElement('button');
    again.type = 'button'; again.textContent = 'Another errand';
    again.onclick = () => { result.hidden = true; openPanel(); };
    actions.append(shareBtn, again);
    result.append(actions);

    const say = document.createElement('p');
    say.className = 'ershared'; say.setAttribute('role', 'status');
    result.append(say);
    result.__share = share;

  }

  // There was a "real ordering is coming" line on the result card. Pierce, 2026-09-10:
  // "i thought we werent saying this yet". He is right, and it was my brief that asked for it.
  // Announcing a feature with no date, nothing to sign up for and nothing to click is a promise
  // with nothing behind it, and it sat on every errand card. Say it when it exists.

  function showAbandoned(r, why) {
    result.textContent = '';
    result.hidden = false;
    const head = document.createElement('div');
    head.className = 'errandhead';
    head.innerHTML = '<h2></h2><button type="button" class="errandclose" aria-label="Close">×</button>';
    head.querySelector('h2').textContent = 'Errand ended';
    head.querySelector('.errandclose').onclick = () => { result.hidden = true; };
    result.append(head);
    const p = document.createElement('p');
    p.className = 'errandnote';
    p.textContent = why === 'auto drive took over'
      ? 'Auto drive took the wheel, so this one does not count. ' + r.errand.title + ' is still there.'
      : why === 'the car was moved'
        ? 'The car was moved rather than driven, so this one does not count.'
        : 'You gave up on ' + r.errand.title + ' after ' + clock(r.elapsed) + '.';
    result.append(p);
    const actions = document.createElement('div');
    actions.className = 'erpicks';
    const again = document.createElement('button');
    again.type = 'button'; again.className = 'primary'; again.textContent = 'Pick another';
    again.onclick = () => { result.hidden = true; openPanel(); };
    actions.append(again);
    result.append(actions);
    result.__share = null;
  }

  async function sendShare(text, btn) {
    const say = result.querySelector('.ershared');
    const done = msg => { if (say) say.textContent = msg; };
    try {
      if (navigator.share) { await navigator.share({ text }); done('Shared.'); return; }
    } catch (e) {
      if (e && e.name === 'AbortError') { done(''); return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      done('Copied to the clipboard.');
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy result'; }, 2500);
    } catch (_) {
      done(text);   // no clipboard: put the line on screen so it can still be taken
    }
  }

  /* ---- data, and the exit hook ---- */

  new MutationObserver(() => {
    if (document.body.classList.contains('driving')) return;
    if (run) finish('left the drive');
    if (panelOpen) closePanel();
    result.hidden = true;
    readout.hidden = true;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  fetch(DATA).then(r => r.json()).then(d => { errands = (d && d.errands) || []; if (panelOpen) buildList(); })
    .catch(() => { errands = []; });

  window.__errands = {
    get list() { return errands; },
    get run() { return run; },
    get open() { return panelOpen; },
    get share() { return result.__share || null; },
    get guide() { return (run && run.guide) ? { ...run.guide } : null; },
    get turn() { return erTurn.textContent; },
    get overlay() { return drive.mapOverlay === drawGuide; },
    nearby, parOf, begin, openPanel, closePanel,
    finish: () => finish('arrived')
  };
}

/* window.__drive appears when app.js has built the world. Wait for it, quietly give up if it never comes. */
(function wait(tries = 0) {
  if (window.__drive && window.__drive.state && window.__drive.cruise && document.querySelector('#drivehud .driveactions')) {
    try { start(window.__drive); } catch (e) { console.warn('Errands unavailable', e); }
    return;
  }
  if (tries > 900) return;
  setTimeout(() => wait(tries + 1), 200);
})();
