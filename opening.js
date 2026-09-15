// The opening (Pierce, 2026-09-14, on the mock-up: "a lovely pageload to see and then fly through the text to see
// the Winthrop"): the town from straight above with a title over it, then the camera dives through the type into
// the normal opening view. A touch, a scroll or a key skips it. Reduced-motion users get a fade, no dive.
import * as THREE from 'three';

export function startFrom(target, offset) {   // where the dive begins: higher and nearer overhead than the resting view
  return [target[0] + offset[0] * .22, offset[1] * 1.7, target[2] + offset[2] * .22];
}

export function openingTitle({camera, controls, target, offset, ready, copy = {}, onReveal = () => {}, warm = null}) {
  const from = new THREE.Vector3(...startFrom(target, offset));
  const to = new THREE.Vector3(target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]);
  camera.position.copy(from); controls.target.set(...target); controls.update();
  document.body.classList.add('opening');
  const el = document.createElement('div'); el.id = 'opening';
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = copy.eyebrow || 'Drive Winthrop';
  const h1 = document.createElement('h1'); h1.append(copy.lead || 'The whole town, '); const em = document.createElement('em'); em.textContent = copy.italic || 'Yirrell Beach to Deer Island.'; h1.append(em);
  const sub = document.createElement('p'); sub.className = 'sub'; sub.textContent = copy.sub || 'Every street and every stop. The bus and the planes, live.';
  const prog = document.createElement('div'); prog.className = 'progress'; const bar = document.createElement('i'); const lab = document.createElement('span'); lab.textContent = 'Reading the town'; prog.append(bar, lab);
  el.append(eyebrow, h1, sub, prog); document.body.appendChild(el);
  /* the bar follows the load's own stage marks (app.js performance.mark('stage:…')) — a real measure, not a timer */
  const STAGES = [['roads-inventory', 6, 'Reading the roads'], ['heights', 12, 'Measuring the houses'], ['lidar-roofs', 20, 'Shaping the roofs'], ['ground-world', 32, 'Laying the ground'], ['owned-facades', 44, 'Hanging the photo fronts'], ['signs', 48, 'Posting the signs'], ['trees', 70, 'Planting the trees'], ['play-surfaces', 100, 'Ready']];
  let pct = 0; const setPct = (v, text) => { if (v <= pct) return; pct = v; bar.style.width = v + '%'; if (text) lab.textContent = text; };
  try { const po = new PerformanceObserver(list => { for (const e of list.getEntries()) { const st = STAGES.find(s => 'stage:' + s[0] === e.name); if (st) setPct(st[1], st[2]); } }); po.observe({type: 'mark', buffered: true}); } catch (_) {}
  const veil = document.createElement('div'); veil.id = 'veil'; document.body.appendChild(veil);   // a dark wash over the ink; fades as the town is revealed
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  let done = false, started = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish = () => { if (done) return; done = true; try { onReveal(); } catch (_) {} if (window.__dissolveSketch) window.__dissolveSketch(); camera.position.copy(to); controls.update(); el.classList.add('out'); veil.classList.add('gone'); document.body.classList.remove('opening'); setTimeout(() => { el.remove(); veil.remove(); }, 1600); };
  const fly = () => { if (started || done) return; started = true; if (reduced) { finish(); return; }
    const t0 = performance.now(), D = 2400; el.classList.add('fly'); veil.classList.add('gone'); if (window.__dissolveSketch) window.__dissolveSketch();
    const step = () => { if (done) return; const k = Math.min(1, (performance.now() - t0) / D), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(from, to, e); controls.update();
      /* the type flies on the camera's own curve, so the two never drift apart */
      el.style.transform = 'scale(' + (1 + e * 2.2) + ')'; el.style.opacity = String(Math.max(0, 1 - Math.pow(e, 1.4) * 1.25));
      if (k < 1) requestAnimationFrame(step); else finish(); };
    step(); };
  /* GPU warm-up while the ink traces: every texture uploaded and every shader compiled as it arrives, so the reveal is free */
  const warmTimer = warm ? setInterval(() => { if (done) { clearInterval(warmTimer); return; } try { warm(); } catch (_) {} }, 700) : null;
  ready.then(() => {
    if (warmTimer) { try { warm(); } catch (_) {} }
    try { onReveal(); } catch (_) {}                       // town on, under the veil: shaders compile and textures upload here, not mid-dive
    requestAnimationFrame(() => requestAnimationFrame(() => { setTimeout(fly, 500); }));   // two painted frames, then the dive
    setTimeout(finish, 4500);                                // and nothing waits on frames: the camera lands regardless
  });   // the timeout lands the camera even if the tab was hidden and frames never ran
  const skip = () => { if (done) return; done = true; try { onReveal(); } catch (_) {} if (window.__dissolveSketch) window.__dissolveSketch(); camera.position.copy(to); controls.update(); el.remove(); veil.classList.add('gone'); setTimeout(() => veil.remove(), 1600); document.body.classList.remove('opening'); };
  setTimeout(() => { if (!done) finish(); }, 45000);   // nothing waits forever: after 45 s the town is shown whatever happened
  for (const ev of ['pointerdown', 'wheel', 'keydown']) addEventListener(ev, skip, {once: true, passive: true});
  return {skip, active: () => !done};
}
