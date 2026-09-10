// Drive Winthrop — the opening title sequence, and the one place this project brags.
//
// The opening upgrades the existing #loading card without touching it: a fixed stage
// goes behind it carrying the town's own footage (the water tower, then the beach at
// sunset), and #loading stops painting its own ground so the type lands over the
// picture. Every contract app.js relies on is left alone — #loadmessage, the h2, the
// .spinner and the hidden flag all still do exactly what they did.
//
// Rules it keeps to:
//   · the world always wins. The instant #loading is hidden this dissolves and drops
//     its video. Nothing is ever held back waiting for a clip to finish.
//   · no black frame. Two <video> elements leapfrog and crossfade, driven by
//     requestVideoFrameCallback with a timeout and an interval behind it so a
//     backgrounded tab cannot freeze the handoff.
//   · never a blank rectangle. Video → poster still → the original gradient.
//   · the world data is the priority: the poster paints first, the first clip is only
//     fetched after it, the second clip only after the first is actually playing, and
//     phones and slow connections get a smaller rendition or no video at all.

const $ = id => document.getElementById(id);

/* ─────────────────────────── the footage ─────────────────────────── */

/* Pierce, 2026-09-10, on the water-tower aerial that used to open this:
   "that video, terrible. it was a poor one i did and it does not work." He wants a clip he
   shot on brown grass with the tower in the distance, not the bog or marsh. That file is not
   in the Winthrop site's media library, so until he points at it the opening leads with the
   beach at sunset alone, which is his and which he has not objected to. Put the right clip
   FIRST in this list when it turns up; the sequence handles one clip or two without changes. */
const CLIPS = [
  { name: 'beachside sunset',
    video: 'https://video.wixstatic.com/video/0caac7_3aa61477c2194affbeada3b902ca6c8c/{q}/mp4/file.mp4',
    poster: 'https://static.wixstatic.com/media/0caac7_3aa61477c2194affbeada3b902ca6c8cf000.jpg' }
];

const FADE = 900;   // crossfade, ms — must stay in step with --intro-fade in intro.css
const LEAD = 1.35;  // seconds before a clip ends that its successor starts

// The raw poster frames are ~1 MB. Wix will resize them on its own CDN, which takes the
// first thing painted down to about 150 KB (55 KB on a phone); the raw file is the
// retry if that ever stops working.
function poster(clip, wide) {
  const w = wide ? 1280 : 720;
  return `${clip.poster}/v1/fill/w_${w},h_${Math.round(w * 9 / 16)},al_c,q_80/file.jpg`;
}

// Which rendition, or none at all. The world data matters more than the picture does.
function quality() {
  const c = navigator.connection || {};
  if (c.saveData) return null;
  const et = c.effectiveType || '';
  if (et === 'slow-2g' || et === '2g') return null;
  if (et === '3g') return '360p';
  if (window.__lowMemory) return '360p';
  // The stage is full-bleed, so viewport width is what decides: phones and tablets get
  // the 480p cut, anything wider gets 720p.
  return (window.innerWidth || 1280) <= 820 ? '480p' : '720p';
}

/* ─────────────────────────── the sequence ─────────────────────────── */

function opening() {
  const loading = $('loading');
  if (!loading || loading.hidden) return;
  const brand = loading.querySelector('.loadbrand');
  const spinner = loading.querySelector('.spinner');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const q = quality();

  const stage = document.createElement('div');
  stage.id = 'introStage';
  stage.setAttribute('aria-hidden', 'true');

  const still = document.createElement('img');
  still.className = 'intro-still';
  still.decoding = 'async';
  still.alt = '';
  still.setAttribute('aria-hidden', 'true');

  const makeVideo = () => {
    const v = document.createElement('video');
    v.className = 'intro-frame';
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = false;
    v.preload = 'auto'; v.tabIndex = -1; v.disablePictureInPicture = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', ''); v.setAttribute('aria-hidden', 'true');
    return v;
  };
  const vA = makeVideo(), vB = makeVideo();

  const scrim = document.createElement('div');
  scrim.className = 'intro-scrim';

  stage.append(still, vA, vB, scrim);
  document.body.insertBefore(stage, loading);
  document.body.classList.add('intro-live');   // stage carries the same gradient: no visual jump

  // One true line, quietly, under the progress text.
  const note = document.createElement('p');
  note.className = 'intro-note';
  note.setAttribute('aria-hidden', 'true');
  for (const line of ['5,633 measured buildings', '47 miles of road', 'the ground is a 2023 aerial photograph'])
    note.appendChild(Object.assign(document.createElement('span'), { textContent: line }));
  loading.appendChild(note);

  let active = null, other = null;
  let videoOn = false, secondReady = false, swapping = false, dismissed = false, errored = false;
  let rvfc = 0, handoff = 0, watchdog = 0, brandRect = null;

  const src = clip => clip.video.replace('{q}', q || '480p');

  /* every fallback the sequence has, in order */
  const posterOnly = () => { videoOn = false; stopScheduler(); };
  const nothingWorked = () => {                       // no video, no poster: the original gradient
    if (videoOn) return;
    document.body.classList.remove('intro-live');
    stage.hidden = true;
  };

  /* ── start: poster first, so the first painted frame never waits on video ── */
  const posterUp = () => { still.classList.add('is-on'); };
  let posterTry = 0;
  const showPoster = () => {
    still.src = posterTry === 0 ? poster(CLIPS[0], window.innerWidth > 760) : CLIPS[0].poster;
    posterTry++;
    const ok = () => posterUp();
    const bad = () => { if (posterTry < 2) showPoster(); else if (!videoOn) nothingWorked(); };
    still.addEventListener('error', bad, { once: true });
    if (still.decode) still.decode().then(ok).catch(bad);
    else still.addEventListener('load', ok, { once: true });
  };
  showPoster();

  if (q && !reduce.matches) {
    requestAnimationFrame(() => requestAnimationFrame(startVideo));
  } else {
    posterOnly();   // reduced motion, Save-Data, or a 2G connection: hold the still
  }

  function startVideo() {
    if (dismissed) return;
    vA.addEventListener('error', posterOnly, { once: true });
    vA.src = src(CLIPS[0]);
    const p = vA.play();
    if (p && p.then) p.then(playing).catch(posterOnly);
    else vA.addEventListener('playing', playing, { once: true });
  }

  function playing() {
    if (dismissed || videoOn) return;
    videoOn = true;
    stage.hidden = false;                              // a poster that 404'd must not keep the picture down
    document.body.classList.add('intro-live');
    active = vA; other = vB;
    vA.classList.add('is-on');
    // The second clip is only fetched once the first is genuinely running, so it never
    // races the world data for the opening seconds.
    setTimeout(loadSecond, 1200);
    schedule();
  }

  function loadSecond() {
    // With only one clip in the list there is nothing to hand off to: the single clip loops,
    // which is exactly what the error path already does when the second clip fails to load.
    if (CLIPS.length < 2) { if (active) active.loop = true; return; }
    if (dismissed || secondReady || vB.src) return;
    vB.addEventListener('error', () => { secondReady = false; if (active) active.loop = true; }, { once: true });
    vB.addEventListener('canplay', () => { secondReady = true; }, { once: true });
    vB.src = src(CLIPS[1]);
    vB.load();
  }

  /* ── the handoff: rVFC when frames are presented, a timeout and an interval when
        they are not (a backgrounded tab stops presenting frames entirely) ── */
  function schedule() {
    stopScheduler();
    if (dismissed || !videoOn || !active) return;
    const d = active.duration;
    if (!isFinite(d) || d <= 0) { handoff = setTimeout(schedule, 300); return; }
    handoff = setTimeout(swap, Math.max(0, (d - active.currentTime - LEAD) * 1000));
    if (active.requestVideoFrameCallback) {
      const tick = () => {
        rvfc = 0;
        if (dismissed || !active) return;
        if (due()) return swap();
        rvfc = active.requestVideoFrameCallback(tick);
      };
      rvfc = active.requestVideoFrameCallback(tick);
    }
    watchdog = setInterval(() => {
      if (dismissed) return;
      if (loading.hidden) return dismiss();          // belt and braces behind the observer
      measure();
      if (!active || errored) return;
      if (active.paused && !swapping) active.play().catch(() => {});
      if (due()) swap();
    }, 250);
  }

  const due = () => {
    if (!active) return false;
    const d = active.duration;
    return isFinite(d) && d > 0 && (d - active.currentTime) <= LEAD;
  };

  function stopScheduler() {
    if (rvfc && active && active.cancelVideoFrameCallback) active.cancelVideoFrameCallback(rvfc);
    rvfc = 0;
    clearTimeout(handoff); handoff = 0;
    clearInterval(watchdog); watchdog = 0;
  }

  function swap() {
    if (swapping || dismissed || !active) return;
    stopScheduler();
    // No successor loaded (it failed, or never got the chance): loop this clip rather
    // than risk a black frame. A hard cut on the same shot, not a drop to nothing.
    if (!other || !other.src) { active.loop = true; schedule(); return; }
    swapping = true;
    const next = other, outgoing = active;
    let gone = false;
    const go = () => {
      if (gone || dismissed) return;
      gone = true;
      clearTimeout(guard);
      try { next.currentTime = 0; } catch (e) {}
      const p = next.play();
      const shown = () => {
        next.classList.add('is-on');
        outgoing.classList.remove('is-on');
        active = next; other = outgoing;
        setTimeout(() => {
          if (dismissed || active === outgoing) return;
          outgoing.pause();
          try { outgoing.currentTime = 0; } catch (e) {}
        }, FADE + 80);
        swapping = false;
        schedule();
      };
      if (p && p.then) p.then(shown).catch(() => { swapping = false; active.loop = true; schedule(); });
      else shown();
    };
    const guard = setTimeout(go, 1400);   // never wait on canplay forever
    if (next.readyState >= 2) go();
    else next.addEventListener('canplay', go, { once: true });
  }

  /* ── the error path: app.js hides the spinner and rewrites the h2. Freeze on the
        last frame and pull it right back so the message is what you read. ── */
  const failure = new MutationObserver(() => {
    if (errored || !spinner) return;
    if (spinner.style.display !== 'none') return;
    errored = true;
    document.body.classList.add('intro-error');
    stopScheduler();
    for (const v of [vA, vB]) { try { v.pause(); } catch (e) {} }
  });
  if (spinner) failure.observe(spinner, { attributes: true, attributeFilter: ['style'] });

  /* ── getting out of the way ── */
  const measure = () => {
    if (!brand || loading.hidden) return;
    const r = brand.getBoundingClientRect();
    if (r.width) brandRect = r;
  };
  measure();
  addEventListener('resize', measure, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure).catch(() => {});
  addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || dismissed || errored || !active) return;
    if (active.paused) active.play().catch(() => {});
    if (due()) swap();
  });

  const watch = new MutationObserver(() => { if (loading.hidden) dismiss(); });
  watch.observe(loading, { attributes: true, attributeFilter: ['hidden'] });

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    stopScheduler();
    watch.disconnect(); failure.disconnect();
    removeEventListener('resize', measure);
    // Clone the title into the stage at the place it already occupies, so the card
    // dissolves as one piece instead of the words blinking out ahead of the picture.
    if (brand && brandRect && brandRect.width) {
      const ghost = brand.cloneNode(true);
      ghost.style.cssText = `position:absolute;left:${brandRect.left}px;top:${brandRect.top}px;` +
                            `width:${brandRect.width}px;height:${brandRect.height}px;margin:0`;
      stage.appendChild(ghost);
    }
    requestAnimationFrame(() => stage.classList.add('is-leaving'));
    setTimeout(finish, 780);
  }

  function finish() {
    for (const v of [vA, vB]) {
      try { v.pause(); } catch (e) {}
      v.removeAttribute('src');
      v.srcObject = null;
      try { v.load(); } catch (e) {}   // drops the buffered media so nothing decodes behind the scene
    }
    still.removeAttribute('src');
    stage.remove();
    document.body.classList.remove('intro-live', 'intro-error');
    active = other = null;
  }
}

/* ─────────────────────────── the brag ───────────────────────────────
   Every number below is counted from this repository, and every one of them is
   checked against the runtime audit where the runtime publishes it. Nothing here is
   rounded up and nothing here is a claim about how it feels to play.

     5,633 / 676 / 230   world.json → audit.buildings, roadSegments, namedRoads
                         (also window.__worldAudit, and the footer counter)
     5,010               data/roofs-index.json, confirmed by window.__lidarRoofs
     roof shapes         window.__lidarRoofTypes: gable 2,131 · hip 1,170 · cross 722 ·
                         shed 363 · flat 348 · gambrel 105
     4,105 / 3,062 / 20  data/neighborhoods.json: records carrying a colour, distinct
                         colours, distinct wall materials (MassGIS property tax parcels,
                         TOWN_ID 346 — the assessor's file)
     47 miles            summed from the road polylines in world.json: 76,558 m
     1,732 / 569 / 164   world.json audit.directionCoverage, and the 164 roads in
                         data/road-inventory.json carrying a MassDOT speedLimit
     6,763               data/lidar-trees.json placements (3DEP 2021 canopy model)
     299,733             window.__worldAudit.terrainVertices, DEM sampled every 4 m
     15 cm / 2023 / 256m assets/ortho/index.json credit and tile grid
     6,082               data/addresses.json
     112 / 34 / 118      data/street-furniture.json busStops, signals;
                         data/traffic-signs.json signs
     162                 data/surfaces.json                                            */

const FIGURES = {
  buildings: 5633, roads: 676, named: 230, roofs: 5010,
  painted: 4105, colours: 3062, trees: 6763, terrain: 299733,
  directed: 1732, oneway: 569, posted: 164,
  addresses: 6082, stops: 112, signals: 34, signs: 118, surfaces: 162
};

const n = v => v.toLocaleString('en-US');

function brag() {
  const about = $('about');
  if (!about || about.querySelector('.intro-brag')) return;

  const f = { ...FIGURES };
  const audit = window.__worldAudit;     // prefer what the running world reports
  if (audit) {
    if (audit.buildings) f.buildings = audit.buildings;
    if (audit.roadSegments) f.roads = audit.roadSegments;
    if (audit.namedRoads) f.named = audit.namedRoads;
    if (audit.terrainVertices) f.terrain = audit.terrainVertices;
    const d = audit.directionCoverage;
    if (d) { if (d.matched) f.directed = d.matched; if (d.oneway) f.oneway = d.oneway; }
  }
  if (window.__lidarRoofs) f.roofs = window.__lidarRoofs;

  const s = document.createElement('section');
  s.className = 'intro-brag';
  s.innerHTML = `
<h3>What you are actually looking&nbsp;at</h3>
<p>This is Winthrop, Massachusetts, at full size and measured rather than imagined.
Almost nothing in it was placed by&nbsp;hand.</p>
<ul class="brag-list">
<li><b>${n(f.buildings)} buildings</b>, each standing on its own surveyed footprint — the shape
of that house, not a box standing in for&nbsp;it.</li>
<li><b>${n(f.roofs)} of those roofs</b> were fitted to LiDAR returns and snapped to the
footprint underneath: hips, gables, cross-gables, gambrels, sheds and flats. Each one is the
shape the point cloud found over that house, not a shape chosen from a&nbsp;list.</li>
<li><b>${n(f.painted)} houses</b> are painted the colour the town assessor's file records, in the
wall material it records — ${n(f.colours)} distinct colours across vinyl, wood shingle, clapboard,
aluminium, asbestos shingle and&nbsp;brick.</li>
<li><b>${n(f.roads)} road centrelines</b>, about 47 miles of them and ${n(f.named)} named streets,
held in Massachusetts State Plane metres rather than fitted by&nbsp;eye.</li>
<li><b>${n(f.directed)} stretches of road</b> know which way traffic runs, ${n(f.oneway)} of them
one-way, and ${n(f.posted)} carry the speed limit MassDOT has on file. Where the file is silent the
town says nothing rather than inventing a&nbsp;number.</li>
<li><b>${n(f.trees)} trees</b>, each one a crown picked out of the 2021 LiDAR canopy model and left
standing where that crown&nbsp;stood.</li>
<li><b>The ground is a photograph.</b> Colour orthoimagery flown in 2023 at 15 cm, cut into
256-metre tiles and streamed at 25 cm per pixel around the car, laid over an elevation model
sampled every 4 metres — ${n(f.terrain)} vertices of actual Winthrop&nbsp;hill.</li>
<li><b>${n(f.addresses)} addresses</b>, ${f.stops} bus stops, ${f.signals} signals, ${f.signs} signs
and ${f.surfaces} parks, beaches, courts and ball fields, each drawn as the thing it actually&nbsp;is.</li>
</ul>
<p class="brag-sources">Sources: MassGIS 2023 colour orthoimagery and Massachusetts property tax
parcels; MassDOT Road Inventory; USGS 3DEP LiDAR, MA_CentralEastern_2021_B21; OpenStreetMap
contributors; and the Winthrop assessor's own records and photographs. Building heights, hidden
elevations and interior detail remain estimates, and the About note above says&nbsp;so.</p>
<p class="brag-close">It runs in a browser. There is nothing to install, nothing to sign in to and
no download waiting at the other end — one web page, and the whole town is already&nbsp;in&nbsp;it.</p>`;

  const anchor = $('photoCoverage');
  if (anchor && anchor.parentNode === about) about.insertBefore(s, anchor);
  else about.appendChild(s);
}

/* ─────────────────────────── go ─────────────────────────── */

try { opening(); } catch (e) { console.warn('intro: opening unavailable', e); }
try { brag(); } catch (e) { console.warn('intro: about note unavailable', e); }
