// The opening (Pierce, 2026-09-14, on the mock-up: "a lovely pageload to see and then fly through the text to see
// the Winthrop"): the town from straight above with a title over it, then the camera dives through the type into
// the normal opening view. A touch, a scroll or a key skips it. Reduced-motion users get a fade, no dive.
import * as THREE from 'three';

export function startFrom(target, offset) {   // where the dive begins: higher and nearer overhead than the resting view
  return [target[0] + offset[0] * .22, offset[1] * 1.7, target[2] + offset[2] * .22];
}

export function openingTitle({camera, controls, target, offset, ready, copy = {}}) {
  const from = new THREE.Vector3(...startFrom(target, offset));
  const to = new THREE.Vector3(target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]);
  camera.position.copy(from); controls.target.set(...target); controls.update();
  document.body.classList.add('opening');
  const el = document.createElement('div'); el.id = 'opening';
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = copy.eyebrow || 'Drive Winthrop';
  const h1 = document.createElement('h1'); h1.append(copy.lead || 'The whole town, '); const em = document.createElement('em'); em.textContent = copy.italic || 'Yirrell Beach to Deer Island.'; h1.append(em);
  const sub = document.createElement('p'); sub.className = 'sub'; sub.textContent = copy.sub || 'Every street and every stop. The bus and the planes, live.';
  el.append(eyebrow, h1, sub); document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  let done = false, started = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish = () => { if (done) return; done = true; camera.position.copy(to); controls.update(); el.classList.add('out'); document.body.classList.remove('opening'); setTimeout(() => el.remove(), 900); };
  const fly = () => { if (started || done) return; started = true; if (reduced) { finish(); return; }
    const t0 = performance.now(), D = 2400; el.classList.add('fly');
    const step = () => { if (done) return; const k = Math.min(1, (performance.now() - t0) / D), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(from, to, e); controls.update(); if (k < 1) requestAnimationFrame(step); else finish(); };
    step(); };
  ready.then(() => { setTimeout(fly, 1300); setTimeout(finish, 1300 + 2400 + 400); });   // the timeout lands the camera even if the tab was hidden and frames never ran
  const skip = () => { if (done) return; done = true; camera.position.copy(to); controls.update(); el.remove(); document.body.classList.remove('opening'); };
  setTimeout(() => { if (!done) finish(); }, 45000);   // nothing waits forever: after 45 s the town is shown whatever happened
  for (const ev of ['pointerdown', 'wheel', 'keydown']) addEventListener(ev, skip, {once: true, passive: true});
  return {skip, active: () => !done};
}
