import * as THREE from 'three';
// Billboards. Pierce, 2026-09-14: "get that billboard that appears in each one ... take any video we have on record,
// just a URL of any video ... put it on a fake mock billboard ... so it's an evergreen process."
//
// Every town gets a handful of billboards on its busiest streets. Each one is a screen playing a video from a URL.
// With no sponsor sold, the screen plays the house reel and the plate under it says the slot is open — so a city
// built a minute ago already has the ad inventory in it. Sold slots come from billboards.json (per town) or from
// the sponsor endpoint the town points at; the shape is one row per slot: {video, link, sponsor}.

const HOUSE_VIDEO = 'https://video.wixstatic.com/video/6c593b_b284d0c373b14d2698cba90ef60c9297/720p/mp4/file.mp4';
const W = 12, H = 4.2, POST = 6;   // metres: the screen, and how high its bottom edge sits

function videoTexture(url) {
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous'; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  const play = () => v.play().catch(() => {});
  play(); addEventListener('pointerdown', play, {once: true});
  const t = new THREE.VideoTexture(v); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return {texture: t, video: v};
}

function plate(text, sub) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d');
  g.fillStyle = '#101418'; g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#f0b860'; g.font = '700 54px Inter, Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText(text, 36, 58);
  g.fillStyle = '#cfd8de'; g.font = '500 34px Inter, Arial, sans-serif'; g.fillText(sub, 36, 118);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* Pick the slots: the longest segments of the most important drivable roads, spread out so no two are within 220 m. */
export function chooseSlots(network, count = 6) {
  /* a network segment carries width, length, speed and a name -- not the road class -- so 'busy' is read from those:
     the widest, fastest, longest named streets first */
  const score = s => s.width * 10 + Math.min(s.length, 300) / 10 + (s.speed || 0) + (s.name && s.name !== 'UNNAMED ROAD' ? 15 : 0);
  const segs = network.segments.filter(s => s.length > 60 && s.width >= 7).sort((a, b) => score(b) - score(a));
  const out = [];
  for (const s of segs) {
    const mx = (s.a[0] + s.b[0]) / 2, mz = (s.a[1] + s.b[1]) / 2;
    if (out.some(o => Math.hypot(o.x - mx, o.z - mz) < 220)) continue;
    const dx = s.dx / s.length, dz = s.dz / s.length, nx = -dz, nz = dx;      // right-hand side of travel
    const off = s.width / 2 + 5;
    out.push({x: mx + nx * off, z: mz + nz * off, yaw: Math.atan2(-nx, -nz), road: s.name});
    if (out.length >= count) break;
  }
  return out;
}

export function billboards({scene, network, heightAt, slots = null, rows = [], count = 6, townName = ''}) {
  const group = new THREE.Group(); group.name = 'billboards';
  const places = slots || chooseSlots(network, count);
  const house = videoTexture(HOUSE_VIDEO);
  const sold = new Map(rows.map((r, i) => [i, r]));
  const post = new THREE.MeshStandardMaterial({color: '#3a3f44', roughness: .7, metalness: .3});
  const frame = new THREE.MeshStandardMaterial({color: '#15181b', roughness: .6});
  const cache = new Map();
  places.forEach((p, i) => {
    const row = sold.get(i);
    const tex = row && row.video ? (cache.get(row.video) || (cache.set(row.video, videoTexture(row.video)), cache.get(row.video))) : house;
    const y = heightAt(p.x, p.z);
    const b = new THREE.Group(); b.position.set(p.x, y, p.z); b.rotation.y = p.yaw;
    // two posts, a frame, the screen, a plate underneath
    for (const sx of [-W * .36, W * .36]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, POST, 10), post); m.position.set(sx, POST / 2, 0); m.castShadow = true; b.add(m); }
    const fr = new THREE.Mesh(new THREE.BoxGeometry(W + .5, H + .5, .35), frame); fr.position.set(0, POST + H / 2, 0); fr.castShadow = true; b.add(fr);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({map: tex.texture, toneMapped: false}));
    screen.position.set(0, POST + H / 2, .19); b.add(screen);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(W * .8, .95), new THREE.MeshBasicMaterial({map: plate(row && row.sponsor ? row.sponsor : 'THIS BILLBOARD IS OPEN', row && row.sponsor ? (row.link || '') : 'Your video on it, on every drive through ' + (townName || 'town')), toneMapped: false}));
    pl.position.set(0, POST - .6, .19); b.add(pl);
    b.userData = {slot: i, road: p.road, link: row && row.link, sponsor: row && row.sponsor};
    group.add(b);
  });
  group.userData.audit = {slots: places.length, sold: sold.size, roads: places.map(p => p.road)};
  scene.add(group);
  return group;
}
