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
const tourQuick=document.createElement('button');tourQuick.id='tourQuick';tourQuick.textContent='Coastal flyover';extra.append(tourQuick);tourQuick.onclick=()=>{garage.open=false;document.getElementById('tour').click();};
/* While driving, the controls fade after a few seconds of no input and come back on any touch, mouse move or key.
   The road name, speed and minimap stay: they are information, not controls. Never while paused, in the garage, or with a warning up. */
{const body=document.body;let timer=null,wasDriving=false;const canIdle=()=>body.classList.contains('driving')&&!garage.open&&!window.__drive?.paused&&document.getElementById('spotActions').hidden&&document.getElementById('roadWarning').hidden;
 const wake=()=>{if(body.classList.contains('idle'))body.classList.remove('idle');clearTimeout(timer);timer=setTimeout(()=>{if(canIdle())body.classList.add('idle');},5000);};
 for(const ev of['pointermove','pointerdown','keydown','wheel','touchstart'])addEventListener(ev,wake,{passive:true,capture:true});
 new MutationObserver(()=>{const d=body.classList.contains('driving');if(d===wasDriving)return;wasDriving=d;if(d)wake();else{clearTimeout(timer);body.classList.remove('idle');}}).observe(body,{attributes:true,attributeFilter:['class']});
 garage.addEventListener('toggle',wake);window.__idleNow=()=>{if(canIdle())body.classList.add('idle');};}
const closeSpot=()=>document.getElementById('spotActions').hidden=true;dock.addEventListener('click',closeSpot);document.querySelector('.pedals').addEventListener('pointerdown',closeSpot);addEventListener('keydown',e=>{if(/^(Key[WASD]|Arrow|Space)/.test(e.code)&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))closeSpot();if(e.code==='Escape')garage.open=false;});
