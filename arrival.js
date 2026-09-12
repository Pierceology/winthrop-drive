import * as THREE from 'three';
// The arrival. Pierce, 2026-09-12: "forget the opening with the video and fog, just open on the map flying
// down through the clouds like GTA".
//
// What it replaces was a title card over the town's own footage: two videos leapfrogging from wixstatic,
// a poster, a fallback gradient, and a lot of machinery to stop any of it showing a black frame. It was
// beautiful when it worked and it was the glitchiest thing on the site, because the one asset the opening
// depended on lived somewhere else and buffered.
//
// This depends on nothing. The cloud is drawn here, in a canvas, from noise — no file to fetch, no clip to
// buffer, nothing to go wrong on a hotel wifi. The camera starts above the weather and comes down through
// it onto the town, which is the shot, and the whole thing is over in four and a half seconds.
//
// Two rules it keeps:
//   · the world always wins. This never delays anything; it runs on top of a town that is already there.
//   · any touch lands it. A person who has seen it once should not have to watch it again.

/* One cloud, drawn: several octaves of value noise multiplied by a radial falloff so the edges are soft and
   the middle has something to look at. Deterministic per layer so the sky is the same sky every visit. */
function cloudTexture(seed = 1, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  let s = seed * 9301 + 49297;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const grid = [];
  for (let o = 0; o < 4; o++) {
    const n = 4 << o, cells = [];
    for (let i = 0; i <= n; i++) { cells.push([]); for (let j = 0; j <= n; j++) cells[i].push(rnd()); }
    grid.push({n, cells});
  }
  const smooth = t => t * t * (3 - 2 * t);
  const value = (x, y, {n, cells}) => {
    const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = smooth(fx - ix), ty = smooth(fy - iy);
    const a = cells[ix][iy], b = cells[ix + 1][iy], cc = cells[ix][iy + 1], d = cells[ix + 1][iy + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let n = 0, amp = 0.55, sum = 0;
    for (const oct of grid) { n += value(u, v, oct) * amp; sum += amp; amp *= 0.5; }
    n /= sum;
    const dx = u - 0.5, dy = v - 0.5;
    const fall = Math.max(0, 1 - Math.hypot(dx, dy) * 2.05);
    const a = Math.max(0, Math.min(1, (n * 1.35 - 0.42) * 2.1)) * fall * fall;
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const easeOut = t => 1 - Math.pow(1 - t, 3);

export function arrival({scene, camera, controls, target, finalPos, seconds = 4.5, onDone}) {
  const deck = new THREE.Group();
  deck.name = 'arrival-clouds';
  deck.renderOrder = 9;
  scene.add(deck);

  const topY = finalPos.y * 3.1;
  const tex = [cloudTexture(3), cloudTexture(11), cloudTexture(29)];
  for (let i = 0; i < 9; i++) {
    const span = 7000 + (i % 3) * 4200;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(span, span),
      new THREE.MeshBasicMaterial({map: tex[i % 3], transparent: true, opacity: 0.44 + (i % 4) * 0.09,
        depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide})
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = i * 0.7;
    m.position.set(target.x + (i % 2 ? 1 : -1) * (600 + i * 260),
                   finalPos.y * (0.92 + i * 0.26),
                   target.z + (i % 3 - 1) * (700 + i * 210));
    deck.add(m);
  }

  const fog = scene.fog;
  const near0 = fog ? fog.near : 0, far0 = fog ? fog.far : 0;
  const start = new THREE.Vector3(target.x + (finalPos.x - target.x) * 0.38, topY,
                                  target.z + (finalPos.z - target.z) * 0.38);

  const wasEnabled = controls.enabled;
  controls.enabled = false;
  controls.target.copy(target);

  let t0 = 0, raf = 0, done = false;
  const land = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    removeEventListener('pointerdown', land, true);
    removeEventListener('keydown', land, true);
    removeEventListener('wheel', land, true);
    camera.position.copy(finalPos);
    controls.target.copy(target);
    controls.enabled = wasEnabled === undefined ? true : wasEnabled;
    controls.update();
    if (fog) { fog.near = near0; fog.far = far0; }
    deck.traverse(o => { if (o.material) { o.material.dispose(); } if (o.geometry) o.geometry.dispose(); });
    tex.forEach(x => x.dispose());
    scene.remove(deck);
    document.body.classList.remove('arriving');
    if (onDone) onDone();
  };

  addEventListener('pointerdown', land, true);
  addEventListener('keydown', land, true);
  addEventListener('wheel', land, true);
  document.body.classList.add('arriving');

  /* The clock is performance.now(), not the frame's own timestamp. The first frame after the loading card
     hides is often a long one (shaders compiling on a phone), and its rAF timestamp is stamped for when the
     frame was scheduled, seconds before it actually runs -- measured at 7 s under SwiftShader. Trusting it
     put the whole flight in the past and the descent landed on its second frame. */
  const step = () => {
    if (done) return;
    const now = performance.now();
    if (!t0) t0 = now;
    const k = Math.min(1, (now - t0) / (seconds * 1000)), e = easeOut(k);
    camera.position.lerpVectors(start, finalPos, e);
    camera.lookAt(target);
    /* The weather clears as you come down through it rather than being switched off at the bottom. */
    if (fog) { fog.near = 1 + (near0 - 1) * e; fog.far = 1500 + (far0 - 1500) * e; }
    const out = Math.max(0, (k - 0.72) / 0.28);
    deck.children.forEach((m, i) => {
      m.material.opacity = (0.44 + (i % 4) * 0.09) * (1 - out);
      m.position.y -= 2.2;            // the deck drifts down past you, so it reads as passing through
      m.rotation.z += 0.0006;
    });
    controls.target.copy(target);
    if (k >= 1) land(); else raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return {skip: land};
}
