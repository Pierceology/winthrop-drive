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
const KERB_HOLD = 0.5;             // seconds of road-edge assist before a kerb counts as one
const WRONGWAY_COST = 8;           // seconds added per wrong-way
const KERB_COST = 3;               // seconds added per kerb
const JUMP = 80;                   // metres in one tick that no car can drive: the run was moved, not driven
const MIN_AWAY = 200;              // metres — closer than this is a walk, not an errand
const TURNAROUND = 7;              // seconds par allows for pressing Turn around before setting off

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
  // is reached from the kerb outside it, and on some streets that kerb is the length of a garden away.
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
  const tray = $('dockExtras');          // phones keep secondary controls one tap behind More
  if (tray) tray.prepend(button);
  else if (strip) strip.prepend(button);
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
  readout.innerHTML = '<b class="ertime">0:00</b><span class="erto"></span><span class="erwhere"></span>' +
    '<button type="button" class="ergiveup">Give up</button>';
  document.body.append(readout);

  const list = panel.querySelector('.errandlist');
  panel.append(comingSoon(null));
  const erTime = readout.querySelector('.ertime');
  const erTo = readout.querySelector('.erto');
  const erWhere = readout.querySelector('.erwhere');

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

  // "Arrived" is measured from the kerb the route can actually reach, plus a couple of car lengths —
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
      wrongWay: 0, kerbs: 0, wrongTimer: 0, kerbTimer: 0, wrongOn: false, kerbOn: false,
      lastX: s.x, lastZ: s.z, voided: null
    };
    closePanel();
    result.hidden = true;
    readout.hidden = false;
    document.body.classList.add('errand-running');
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

  function paint() {
    if (!run) return;
    const s = drive.state, t = target();
    erTime.textContent = clock(run.elapsed);
    erTo.textContent = miles(dist(s.x, s.z, t.x, t.z)) + ' to go';
    erWhere.textContent = targetName();
    readout.classList.toggle('close', dist(s.x, s.z, t.x, t.z) < radius() * 1.8);
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
          // kerb: the road-edge assist is holding the car back onto the pavement.
          if (s.assisting) { run.kerbTimer += drove; if (!run.kerbOn && run.kerbTimer > KERB_HOLD) { run.kerbOn = true; run.kerbs++; } }
          else { run.kerbTimer = 0; run.kerbOn = false; }
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

  function penaltySeconds(r) { return r.wrongWay * WRONGWAY_COST + r.kerbs * KERB_COST; }
  function penaltyWords(r) {
    const bits = [];
    if (r.wrongWay) bits.push(plural(r.wrongWay, 'wrong way', 'wrong ways'));
    if (r.kerbs) bits.push(plural(r.kerbs, 'kerb', 'kerbs'));
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
    document.body.classList.remove('errand-running');
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
      : 'Clean run: no wrong ways, no kerbs');
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

    if (r.errand.order) result.append(comingSoon(r.errand.place));
  }

  // The one quiet line about real ordering. It is a link to the town site, not a form: a box that
  // swallowed an email address and did nothing with it would be worse than saying nothing.
  function comingSoon(place) {
    const wrap = document.createElement('div');
    wrap.className = 'errandsoon';
    const p = document.createElement('p');
    p.textContent = 'Ordering from ' + (place || 'these places') +
      ' for real is coming. There is nothing to sign up for yet.';
    const a = document.createElement('a');
    a.className = 'errandnotify';
    a.href = SITE; a.target = '_blank'; a.rel = 'noreferrer';
    a.textContent = 'Follow it at winthropbythesea.com';
    wrap.append(p, a);
    return wrap;
  }

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
