import * as THREE from 'three';
// The first thing on screen. Pierce, 2026-09-13: "it still takes 5 seconds to see anything ... make the outline fun so
// stuff happens immediately." Before any of the town's two megabytes have arrived, a 36 KB outline of every road is
// here, and it draws itself: light runs out from Winthrop Center along the streets, so the town's shape appears the
// way a map is inked, in about a second and a half. When the real ground is drawn underneath, the ink dissolves.
const CENTER = [-1150, -1900];
export function townSketch({scene, outline, heightAt = () => 0}) {
  const pos = [], born = [];
  // distance from the centre along the polyline itself, so light travels the roads rather than radiating
  let far = 1;
  for (const road of outline) {
    for (let i = 1; i < road.length; i++) {
      const a = road[i - 1], b = road[i];
      const da = Math.hypot(a[0] - CENTER[0], a[1] - CENTER[1]), db = Math.hypot(b[0] - CENTER[0], b[1] - CENTER[1]);
      pos.push(a[0], 2.5, a[1], b[0], 2.5, b[1]); born.push(da, db); far = Math.max(far, da, db);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('born', new THREE.Float32BufferAttribute(born, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {reach: {value: 0}, fade: {value: 1}, far: {value: far}},
    vertexShader: `attribute float born; varying float vBorn; void main(){ vBorn = born; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float reach, fade; varying float vBorn;
      void main(){ float front = reach - vBorn;                                  // metres the light is past this point
        float lit = smoothstep(0.0, 90.0, front);                                // the front arrives, then the line stays
        float head = smoothstep(-160.0, 0.0, front) * (1.0 - smoothstep(0.0, 220.0, front));   // a bright head on the travelling front
        /* smoothstep with its edges reversed is undefined in GLSL; on Pierce's GPU the first cut lit the whole town
           and then UN-inked it outward. Edges ascend now, so it draws the same way everywhere. */
        vec3 ink = mix(vec3(0.62, 0.85, 0.95), vec3(1.0), head);
        gl_FragColor = vec4(ink, (0.55 * lit + 0.9 * head) * fade); }`
  });
  const lines = new THREE.LineSegments(g, material);
  lines.name = 'townSketch'; lines.frustumCulled = false; lines.renderOrder = 8;
  scene.add(lines);
  let t = 0, dissolving = false, dead = false;
  return {
    update(dt) {
      if (dead) return;
      t += dt;
      material.uniforms.reach.value = Math.min(far + 300, t * (far / 1.5));     // the whole town inked in 1.5 s
      if (dissolving) { material.uniforms.fade.value = Math.max(0, material.uniforms.fade.value - dt / 1.1); if (material.uniforms.fade.value <= 0) { dead = true; scene.remove(lines); g.dispose(); material.dispose(); } }
    },
    dissolve() { dissolving = true; },
    get alive() { return !dead; }
  };
}
