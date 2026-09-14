import * as THREE from 'three';
import {geocode, buildCity, builtCities, slugOf} from './factory.js';
// The globe. It turns to the city you name, the factory builds the town on this device, the game opens on it.

const $ = id => document.getElementById(id);
const canvas = $('globe');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color('#06090f');
const camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.set(0, 0, 3.6);
scene.add(new THREE.AmbientLight(0xffffff, .55));
const sun = new THREE.DirectionalLight(0xfff2da, 2.2); sun.position.set(-3, 1.5, 2.5); scene.add(sun);

const earth = new THREE.Group(); scene.add(earth);
const tex = new THREE.TextureLoader().load('assets/earth.jpg'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), new THREE.MeshStandardMaterial({map: tex, roughness: .95, metalness: 0}));
earth.add(globe);
// a thin atmosphere: a slightly larger back-face shell, additive, brightest at the rim
const halo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 64), new THREE.ShaderMaterial({transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
  vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'varying vec3 vN; void main(){ float r = pow(1.0 - abs(vN.z), 3.2); gl_FragColor = vec4(0.45, 0.72, 1.0, r * 0.9); }'}));
scene.add(halo);
// stars
{const n = 1400, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 20); p.set([v.x, v.y, v.z], i * 3); }
 scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p, 3)), new THREE.PointsMaterial({color: 0xcfe3ff, size: .06, sizeAttenuation: true, transparent: true, opacity: .8})));}
// the pin
const pin = new THREE.Group(); pin.visible = false; earth.add(pin);
pin.add(new THREE.Mesh(new THREE.SphereGeometry(.012, 16, 16), new THREE.MeshBasicMaterial({color: 0xf0b860})));
const ring = new THREE.Mesh(new THREE.RingGeometry(.02, .028, 40), new THREE.MeshBasicMaterial({color: 0xf0b860, transparent: true, opacity: .9, side: THREE.DoubleSide})); pin.add(ring);

// lat/lon on the sphere; the texture's seam is at lon -180, so lon 0 faces +z when the group is unrotated
const onSphere = (lat, lon, r = 1) => { const p = (90 - lat) * Math.PI / 180, t = (lon + 180) * Math.PI / 180; return new THREE.Vector3(-r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t)); };

let spin = .12, target = null, zoom = 3.6, zoomTo = 3.6, t0 = performance.now(), drag = null, userYaw = 0;
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); camera.position.z = zoom * (w < h ? 1.35 : 1); }
addEventListener('resize', resize); resize();
canvas.addEventListener('pointerdown', e => { drag = {x: e.clientX, yaw: earth.rotation.y, pitch: earth.rotation.x, y: e.clientY}; });
addEventListener('pointermove', e => { if (!drag) return; earth.rotation.y = drag.yaw + (e.clientX - drag.x) / 220; earth.rotation.x = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) / 320, -1.2, 1.2); target = null; });
addEventListener('pointerup', () => { drag = null; });

function frame(now) {
  const dt = Math.min(.05, (now - t0) / 1000); t0 = now;
  if (target) {
    // turn the earth so the pin faces the camera: yaw = -(lon+90°), pitch = lat
    const wantY = -((target.lon + 90) * Math.PI / 180), wantX = target.lat * Math.PI / 180;
    let dy = wantY - earth.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    earth.rotation.y += dy * Math.min(1, dt * 2.6); earth.rotation.x += (wantX - earth.rotation.x) * Math.min(1, dt * 2.6);
  } else if (!drag) earth.rotation.y += spin * dt;
  zoom += (zoomTo - zoom) * Math.min(1, dt * 2.2); camera.position.z = zoom * (innerWidth < innerHeight ? 1.35 : 1);
  halo.rotation.copy(earth.rotation);
  ring.scale.setScalar(1 + .25 * Math.sin(now / 300)); ring.material.opacity = .55 + .35 * Math.sin(now / 300);
  renderer.render(scene, camera); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---- the build ---- */
const status = $('status'), stName = $('stName'), stNote = $('stNote'), stBar = $('stBar');
async function chips() {
  const list = await builtCities().catch(() => []); const box = $('chips'); box.textContent = '';
  for (const t of list.sort((a, b) => (b.built || '').localeCompare(a.built || ''))) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Drive ' + t.name; b.onclick = () => open(t.slug); box.append(b);
  }
  const w = document.createElement('button'); w.type = 'button'; w.textContent = 'Drive Winthrop'; w.onclick = () => { location.href = './'; }; box.append(w);
}
async function ready() { if (!('serviceWorker' in navigator)) throw new Error('This browser cannot hold a built town (no service worker).'); await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; }
function open(slug) { location.href = './?world=' + slug + '&drive=1'; }
$('form').addEventListener('submit', async e => {
  e.preventDefault(); const q = $('city').value.trim(); if (!q) return;
  const go = $('go'); go.disabled = true;
  try {
    stName.textContent = q; stNote.textContent = 'Finding it…'; stNote.classList.remove('err'); stBar.style.width = '3%'; status.classList.add('on'); document.body.classList.add('building');
    const place = await geocode(q);
    const slug = slugOf(place.name + '-' + place.lat.toFixed(2) + '-' + place.lon.toFixed(2));
    stName.textContent = place.name;
    pin.position.copy(onSphere(place.lat, place.lon, 1.004)); pin.lookAt(pin.position.clone().multiplyScalar(2)); pin.visible = true;
    target = place; zoomTo = 2.2;
    stNote.textContent = 'Turning the globe to ' + place.name + '…';
    const already = (await builtCities().catch(() => [])).find(t => t.slug === slug);
    await ready();
    if (already) { stNote.textContent = 'Already built here — opening it.'; setTimeout(() => open(slug), 900); return; }
    await new Promise(r => setTimeout(r, 1400));
    stNote.textContent = 'Please allow about a minute while I build your drive of ' + place.name + '.';
    const t1 = performance.now();
    const result = await buildCity({name: place.name, lat: place.lat, lon: place.lon, country: place.country, slug}, p => { stNote.textContent = p.text; stBar.style.width = Math.round(p.k * 100) + '%'; });
    const secs = Math.round((performance.now() - t1) / 1000);
    stNote.textContent = `Built: ${result.audit.roadSegments} streets, ${result.audit.buildings} buildings in ${secs}s. Opening…`;
    setTimeout(() => open(slug), 900);
  } catch (err) {
    stNote.textContent = (err && err.message) || 'Something went wrong.'; stNote.classList.add('err'); stBar.style.width = '0';
    setTimeout(() => { status.classList.remove('on'); document.body.classList.remove('building'); target = null; zoomTo = 3.6; go.disabled = false; }, 2800);
  }
});
chips();
