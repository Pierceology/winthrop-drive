import * as THREE from 'three';
// The start flags and the finish line. Pierce, 2026-09-11: "lets get a start flag and all that stuff for each of the
// three locations and a finish line". One object language for both: two poles either side of the road and a banner
// slung between them at the height a car passes under. The start banner says START on green; the finish is the
// chequered flag. Everything is drawn here from a canvas, nothing fetched.

function cloth(kind) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  if (kind === 'finish') {
    const n = 16, w = c.width / n, h = c.height / 2;
    for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111111' : '#f4f4f0'; g.fillRect(i * w, j * h, w, h); }
  } else {
    g.fillStyle = '#1f6b3a'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, c.width, 8); g.fillRect(0, c.height - 8, c.width, 8);
    g.font = '700 84px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('START', c.width / 2, c.height / 2 + 4);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/* A gate across the road at (x,z). ux,uz is the direction of travel through it; width is the road's. */
export function gate({x, z, ux, uz, width = 9, kind = 'start', heightAt}) {
  const group = new THREE.Group(); group.name = 'gate-' + kind;
  const vx = -uz, vz = ux, half = width / 2 + 0.7, H = 4.2, BAR = 3.35, CLOTH = 1.05;
  const pole = new THREE.MeshStandardMaterial({color: '#e8e8e2', roughness: .55, metalness: .25});
  const y0 = Math.min(heightAt(x + vx * half, z + vz * half), heightAt(x - vx * half, z - vz * half), heightAt(x, z));
  for (const s of [1, -1]) {
    const px = x + vx * half * s, pz = z + vz * half * s, y = heightAt(px, pz);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, H, 10), pole);
    m.position.set(px, y + H / 2, pz); m.castShadow = true; group.add(m);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.13, 10, 8), new THREE.MeshStandardMaterial({color: kind === 'finish' ? '#111' : '#f0b860', roughness: .5}));
    cap.position.set(px, y + H + .05, pz); group.add(cap);
  }
  // the bar the cloth hangs from
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, half * 2, 8), pole);
  bar.rotation.z = Math.PI / 2; bar.rotation.y = Math.atan2(-vz, vx) ;
  bar.position.set(x, y0 + H - .05, z); group.add(bar);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - .3, CLOTH),
    new THREE.MeshStandardMaterial({map: cloth(kind), side: THREE.DoubleSide, roughness: .9}));
  // A plane faces +z; turned by the travel yaw it would face away from the car and read mirrored. Turn it round.
  banner.rotation.y = Math.atan2(ux, uz) + Math.PI;
  banner.position.set(x, y0 + BAR + CLOTH / 2, z);
  banner.castShadow = true; group.add(banner);
  // a line on the road under it, so the moment of crossing is a visible place
  const line = new THREE.Mesh(new THREE.PlaneGeometry(width - .4, kind === 'finish' ? 1.6 : .5),
    new THREE.MeshLambertMaterial({color: '#f4f4f0', map: kind === 'finish' ? cloth('finish') : null, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}));
  line.rotation.x = -Math.PI / 2; line.rotation.z = -Math.atan2(ux, uz);
  line.position.set(x, heightAt(x, z) + .12 + .04, z);
  group.add(line);
  group.userData.gate = {x, z, ux, uz, width, kind};
  return group;
}

export function disposeGate(g) {
  g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  if (g.parent) g.parent.remove(g);
}
