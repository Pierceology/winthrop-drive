// The card that opens when the car actually arrives somewhere on a tour.
// It never shows while the car is still travelling: the auto-driver's dwell is the arrival, and the card
// fades in with it and fades out again as the car pulls away. Tap it, or press Escape, to put it away —
// the next stop brings a fresh one. It takes no focus and swallows no steering: it is a status panel that
// happens to be dismissible, parked clear of the road ahead and clear of every driving control.
const OUT=460;   // must match the transition in experience.css

export class StopCard{
 constructor(id='driveCard'){
  this.el=document.getElementById(id);if(!this.el)return;
  this.key=null;this.dismissed=null;this.timer=null;this.open=false;
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
 show(stop,index,total,tourName){
  const el=this.el;
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
  clearTimeout(this.timer);this.timer=setTimeout(()=>{this.el.hidden=true;},OUT);
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
