// The way back. Pierce, 2026-09-14: "once I pick a city I have no way to get back, maybe a small globe spinning with
// cities popping up beautifully as it rotates, in a click-bait, lure, siren type of way."
//
// A small earth turning in the header of every town. As it turns, the names of towns that exist surface one after
// another under it — the ones built on this device, the ones the Mac pre-built, Winthrop — and the whole thing is
// one link back to the globe page. Pure CSS sphere (the day map scrolling behind a round window with a shaded rim),
// so it costs no second WebGL context on a phone.

export async function globeBack({towns = []} = {}) {
  const header = document.querySelector('header'); if (!header || document.getElementById('globeBack')) return;
  const a = document.createElement('a'); a.id = 'globeBack'; a.href = './world.html'; a.setAttribute('aria-label', 'Back to the globe: drive another town');
  a.innerHTML = '<span class="gb-earth"><i></i></span><span class="gb-text"><b>Drive Anywhere</b><em class="gb-town">any town on earth</em></span>';
  header.insertBefore(a, header.querySelector('#driveCurrent') || header.firstChild.nextSibling);
  const names = new Set(['Winthrop']);
  for (const t of towns) if (t && t.name) names.add(t.name);
  try {
    const cache = await caches.open('factory-worlds');
    for (const k of await cache.keys()) { const m = k.url.match(/\/worlds\/([a-z0-9-]+)\/town\.json$/); if (m) { const j = await (await cache.match(k)).json().catch(() => null); if (j && j.name) names.add(j.name); } }
  } catch (_) {}
  try { const r = await fetch('./worlds/index.json'); if (r.ok) for (const t of ((await r.json()).towns || [])) if (t.name) names.add(t.name); } catch (_) {}
  const lures = ['any town on earth', ...[...names].map(n => 'Drive ' + n), 'type a city, drive it', 'built in a minute'];
  const em = a.querySelector('.gb-town'); let i = 0;
  setInterval(() => { em.classList.add('gb-out'); setTimeout(() => { i = (i + 1) % lures.length; em.textContent = lures[i]; em.classList.remove('gb-out'); }, 380); }, 2600);
  return a;
}
