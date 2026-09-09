// The card that opens when the car actually arrives somewhere on a tour.
// It never shows while the car is still travelling: the auto-driver's dwell is the arrival, and the card
// fades in with it and fades out again as the car pulls away. Tap it, or press Escape, to put it away —
// the next stop brings a fresh one. It takes no focus and swallows no steering: it is a status panel that
// happens to be dismissible, parked clear of the road ahead and clear of every driving control.
const OUT=460;   // must match the transition in experience.css

// A phone, or a machine the world has already told us is short of memory, gets the poster frame instead of
// the clip: one decoded JPEG rather than a second video decoder running behind the road.
function stills(){
 if(window.__lowMemory)return true;
 if(navigator.deviceMemory&&navigator.deviceMemory<=4)return true;
 if(matchMedia('(prefers-reduced-motion:reduce)').matches)return true;
 return matchMedia('(max-width:700px), (max-width:950px) and (max-height:460px)').matches;
}

export class StopCard{
 constructor(id='driveCard'){
  this.el=document.getElementById(id);if(!this.el)return;
  this.key=null;this.dismissed=null;this.timer=null;this.open=false;
  // The photo lives above everything else in the card. It is built empty and stays empty until a stop that
  // actually has a picture arrives, so a tour with no media costs nothing and the card keeps its old shape.
  this.media=document.createElement('figure');this.media.className='cardmedia';this.media.hidden=true;
  this.el.insertBefore(this.media,this.el.firstChild);
  this.el.addEventListener('click',e=>{e.preventDefault();this.dismiss();});
  this.el.addEventListener('pointerdown',e=>e.stopPropagation());   // a tap on the card is not a tap on the road
  addEventListener('keydown',e=>{
   if(e.code!=='Escape'||!this.open)return;
   if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
   e.preventDefault();e.stopImmediatePropagation();   // Escape dismisses the card before it exits the drive
   this.dismiss();
  },true);
  addEventListener('resize',()=>{if(this.open)this.place();});
 }
 // Called from the driving HUD tick. `stop` is the dwell's stop, or null while the car is moving.
 update(stop,index,total,tourName){
  if(!this.el)return;
  const key=stop?(tourName||'')+'#'+index+'#'+stop.name:null;
  if(key===this.key)return;
  this.key=key;
  if(!stop){this.hide();return;}
  if(key===this.dismissed)return;
  this.show(stop,index,total,tourName);
 }
 // Nothing is fetched until the car has actually arrived: the <img>/<video> is built here, in show(), and
 // thrown away again in hide(), so driving past 44 restaurants downloads nothing.
 setMedia(stop){
  const m=this.media;if(!m)return;
  m.replaceChildren();
  const poster=stop.poster||stop.photo;
  if(!poster){m.hidden=true;this.el.classList.remove('has-media');return;}
  m.hidden=false;this.el.classList.add('has-media');
  const grew=()=>{if(this.open)this.place();};   // the card changes height when the picture lands
  let node;
  if(stop.video&&!stills()){
   node=document.createElement('video');
   node.muted=true;node.loop=true;node.autoplay=true;node.playsInline=true;
   node.setAttribute('muted','');node.setAttribute('playsinline','');
   node.preload='none';node.poster=poster;node.src=stop.video;
   node.addEventListener('loadeddata',grew,{once:true});
   // A browser that refuses the autoplay, or a clip that will not load, falls back to the still it already has.
   node.addEventListener('error',()=>{if(this.open)this.setMedia({photo:poster,name:stop.name});},{once:true});
   const p=node.play();if(p&&p.catch)p.catch(()=>{});
  }else{
   node=document.createElement('img');
   node.loading='lazy';node.decoding='async';node.src=poster;
   node.addEventListener('load',grew,{once:true});
   node.addEventListener('error',()=>{m.hidden=true;this.el.classList.remove('has-media');grew();},{once:true});
  }
  node.alt=stop.name||'';
  m.appendChild(node);
 }
 clearMedia(){
  const m=this.media;if(!m)return;
  const v=m.querySelector('video');
  if(v){try{v.pause();}catch(e){}v.removeAttribute('src');try{v.load();}catch(e){}}
  m.replaceChildren();m.hidden=true;this.el.classList.remove('has-media');
 }
 show(stop,index,total,tourName){
  const el=this.el;
  this.setMedia(stop);
  el.querySelector('.kicker').textContent=total>1?`Stop ${index+1} of ${total}`:(tourName||'Arrived');
  el.querySelector('h3').textContent=stop.name||'';
  el.querySelector('.line').textContent=stop.line||'';
  el.querySelector('.addr').textContent=stop.address||'';
  clearTimeout(this.timer);el.hidden=false;this.open=true;document.body.classList.add('stopcard-open');this.place();
  // one frame with the card laid out but still transparent, so the transition actually runs.
  // A tab the browser has parked stops handing out frames, so a timer opens it there instead of never.
  const reveal=()=>{if(this.open)el.classList.add('showing');};
  requestAnimationFrame(()=>requestAnimationFrame(reveal));setTimeout(reveal,120);
 }
 hide(){
  if(!this.open)return;
  this.open=false;this.el.classList.remove('showing');document.body.classList.remove('stopcard-open');
  // let it fade out with the picture still in it, then drop the decoder and the bytes on the floor
  clearTimeout(this.timer);this.timer=setTimeout(()=>{this.el.hidden=true;this.clearMedia();},OUT);
 }
 dismiss(){if(!this.open)return;this.dismissed=this.key;this.hide();}
 // Sit under the street name, whatever height the street name happens to be today.
 place(){
  const head=document.querySelector('#drivehud .driveheading');
  if(!head)return;
  const r=head.getBoundingClientRect();
  document.body.style.setProperty('--drivecard-top',Math.round(r.bottom+18)+'px');
  document.body.style.setProperty('--drivecard-height',Math.round(this.el.getBoundingClientRect().height)+'px');
 }
}
