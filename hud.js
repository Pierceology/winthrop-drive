const full=document.getElementById('fullscreen'),toggle=document.getElementById('hudToggle');
const sync=()=>{const native=!!document.fullscreenElement,immersive=document.body.classList.contains('immersive');full.textContent=native?'Exit fullscreen':immersive?'Restore view':'Fullscreen';full.setAttribute('aria-pressed',String(native||immersive));};
full.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.body.classList.contains('immersive'))document.body.classList.remove('immersive');else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else document.body.classList.add('immersive');}catch{document.body.classList.add('immersive');}sync();});document.addEventListener('fullscreenchange',sync);
toggle.addEventListener('click',()=>{const small=document.body.classList.toggle('minimal-hud');toggle.textContent=small?'Show all controls':'Minimal HUD';toggle.setAttribute('aria-pressed',String(small));});

const garage=document.getElementById('audioPanel'),dock=document.querySelector('.driveactions');
const openGarage=document.createElement('button');openGarage.id='garageToggle';openGarage.textContent='Garage';openGarage.setAttribute('aria-expanded','false');openGarage.setAttribute('aria-controls','audioPanel');dock.prepend(openGarage);
openGarage.onclick=()=>{garage.open=!garage.open;};garage.addEventListener('toggle',()=>openGarage.setAttribute('aria-expanded',String(garage.open)));
garage.querySelector('summary').textContent='Garage';
const extra=document.createElement('div');extra.className='garageExtras';extra.append(document.getElementById('hudToggle'),document.getElementById('resetCar'));garage.append(extra);
const steering=document.createElement('button');steering.textContent='Show driving buttons';steering.setAttribute('aria-pressed','false');steering.onclick=()=>{const enabled=document.body.classList.toggle('touch-controls');steering.textContent=enabled?'Hide driving buttons':'Show driving buttons';steering.setAttribute('aria-pressed',String(enabled));};extra.append(steering);
const exit=document.getElementById('exitDrive');exit.textContent='Explore';
/* The dock's More tray, built once for every size. It used to exist only on phones (phone.js), which is why
   a desktop showed eight controls at the same weight. The garage, the evening light and the hood camera are
   set once and left alone, so they go behind one button; a phone adds Hide panels and Pause to the same tray.
   Same element, same id, same class on <body> — one control, not two implementations. */
{const tray=document.createElement('div');tray.id='dockExtras';
 for(const id of['garageToggle','eveningDrive','driveCamera']){const b=document.getElementById(id);if(b)tray.append(b);}
 const more=document.createElement('button');more.id='dockMore';more.type='button';more.textContent='More';
 more.title='More driving controls';more.setAttribute('aria-label','More driving controls');
 more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls','dockExtras');
 dock.append(tray);dock.insertBefore(more,exit);
 const shut=()=>{if(!document.body.classList.contains('dock-open'))return;document.body.classList.remove('dock-open');more.setAttribute('aria-expanded','false');};
 more.onclick=e=>{e.stopPropagation();const open=document.body.classList.toggle('dock-open');more.setAttribute('aria-expanded',String(open));};
 tray.addEventListener('click',shut);                       // any secondary action closes the tray behind it
 addEventListener('pointerdown',e=>{if(!e.target?.closest?.('#dockExtras,#dockMore'))shut();},true);
 addEventListener('keydown',e=>{if(e.code==='Escape')shut();});
 new MutationObserver(()=>{if(!document.body.classList.contains('driving'))shut();}).observe(document.body,{attributes:true,attributeFilter:['class']});}
/* The U-turn is the one control in the row with no caption, so it says what it is on hover. Its label is
   still in the DOM for a screen reader, and the phone layout still shows it. More sets its own. */
{const t=document.getElementById('turnAround');if(t&&!t.title)t.title='Turn around';}
const tourQuick=document.createElement('button');tourQuick.id='tourQuick';tourQuick.textContent='Coastal flyover';extra.append(tourQuick);tourQuick.onclick=()=>{garage.open=false;document.getElementById('tour').click();};
/* While driving, the controls fade after a few seconds of no input and come back on any touch, mouse move or key.
   The road name, speed and minimap stay: they are information, not controls. Never while paused, in the garage, or with a warning up. */
{const body=document.body;let timer=null,wasDriving=false;const canIdle=()=>body.classList.contains('driving')&&!garage.open&&!window.__drive?.paused&&document.getElementById('spotActions').hidden&&document.getElementById('roadWarning').hidden;
 const wake=()=>{if(body.classList.contains('idle'))body.classList.remove('idle');clearTimeout(timer);timer=setTimeout(()=>{if(canIdle())body.classList.add('idle');},5000);};
 for(const ev of['pointermove','pointerdown','keydown','wheel','touchstart'])addEventListener(ev,wake,{passive:true,capture:true});
 new MutationObserver(()=>{const d=body.classList.contains('driving');if(d===wasDriving)return;wasDriving=d;if(d)wake();else{clearTimeout(timer);body.classList.remove('idle');}}).observe(body,{attributes:true,attributeFilter:['class']});
 garage.addEventListener('toggle',wake);window.__idleNow=()=>{if(canIdle())body.classList.add('idle');};}
const closeSpot=()=>document.getElementById('spotActions').hidden=true;dock.addEventListener('click',closeSpot);document.querySelector('.pedals').addEventListener('pointerdown',closeSpot);addEventListener('keydown',e=>{if(/^(Key[WASD]|Arrow|Space)/.test(e.code)&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))closeSpot();if(e.code==='Escape')garage.open=false;});
