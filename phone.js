// Phones: everything that pops up can be put away.
//  - the explore panel is a bottom sheet that starts collapsed; tap its bar to open or close it
//  - the wrong-way warning gets a close button
//  - "Hide panels" in the driving strip clears the road card, speed, minimap and hint (base minimal-hud mode)
const coarse = matchMedia('(pointer:coarse)').matches || new URLSearchParams(location.search).has('touch');
if (coarse) {
  // holding a control must never open the copy/lookup menu or start a selection
  for (const id of ['touchDrive', 'touchReverse']) { const e = document.getElementById(id); if (e) e.addEventListener('contextmenu', ev => ev.preventDefault()); }
  document.addEventListener('contextmenu', ev => { if (ev.target.closest('button, #touchDrive, canvas')) ev.preventDefault(); });
  document.addEventListener('selectstart', ev => { if (!ev.target.closest('input, textarea')) ev.preventDefault(); });
  const sheet = document.querySelector('aside.places');
  if (sheet && !document.getElementById('sheetToggle')) {
    const bar = document.createElement('button'); bar.id = 'sheetToggle'; bar.type = 'button';
    bar.innerHTML = '<span>Explore Winthrop</span><b>▴</b>';
    const h1 = sheet.querySelector('h1'); if (h1) h1.hidden = true;
    sheet.prepend(bar); sheet.classList.add('collapsed'); bar.setAttribute('aria-expanded', 'false');
    bar.onclick = () => { const c = sheet.classList.toggle('collapsed'); bar.setAttribute('aria-expanded', String(!c)); bar.querySelector('b').textContent = c ? '▴' : '▾'; if (!c) sheet.scrollTop = 0; };
  }
  const warn = document.getElementById('roadWarning');
  if (warn && !warn.querySelector('.closeWarn')) {
    const x = document.createElement('button'); x.className = 'closeWarn'; x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Dismiss');
    // driving.js re-shows the warning every 100ms while the car is still wrong-way or off the road, so `hidden` alone
    // undid the tap. The dismissal is a class; it clears when the warning goes away on its own, so the next one shows.
    x.onclick = () => { warn.classList.add('dismissed'); }; warn.prepend(x);
    new MutationObserver(() => { if (warn.hidden) warn.classList.remove('dismissed'); }).observe(warn, { attributes: true, attributeFilter: ['hidden'] });
  }
  const strip = document.querySelector('.driveactions');
  if (strip && !document.getElementById('phoneHud')) {
    const b = document.createElement('button'); b.id = 'phoneHud'; b.type = 'button'; b.textContent = 'Hide panels';
    b.onclick = () => { const on = document.body.classList.toggle('minimal-hud'); b.textContent = on ? 'Show panels' : 'Hide panels'; };
    strip.prepend(b);
  }
}
