import * as THREE from 'three';
// A flyover of a tour: glide from stop to stop, hover and slowly orbit each one, captions on screen.
// Previous / Next jump between stops; any other tour can be picked mid-flight.
export class TourFlight{
 constructor(camera,controls,heightAt,onStop){Object.assign(this,{camera,controls,heightAt,onStop});this.active=false;this.tour=null;}
 start(tour,index=0){this.tour=tour;this.active=true;this.controls.enabled=false;this.controls.autoRotate=false;document.body.classList.add('touring','tour-flight');this.go(index);}
 go(i){if(!this.tour)return;const n=this.tour.stops.length;if(!n){this.stop();return;}this.index=((i%n)+n)%n;const st=this.tour.stops[this.index],prev=this.tour.stops[(this.index-1+n)%n],y=this.heightAt(st.x,st.z);
  let dx=st.x-prev.x,dz=st.z-prev.z;const L=Math.hypot(dx,dz);if(L<5){dx=-.6;dz=.8;}else{dx/=L;dz/=L;}
  this.leg={from:this.camera.position.clone(),fromT:this.controls.target.clone(),to:new THREE.Vector3(st.x-dx*115,y+68,st.z-dz*115),toT:new THREE.Vector3(st.x,y+4,st.z),t:0,dur:4.5};this.hold=5;
  const cap=document.getElementById('tourCaption'),kick=document.getElementById('tourKicker');if(cap)cap.textContent=st.name;if(kick)kick.textContent=this.tour.name.toUpperCase()+' · '+(this.index+1)+' of '+n;}
 next(){this.go(this.index+1);} prev(){this.go(this.index-1);}
 stop(){if(!this.active)return;this.active=false;this.tour=null;this.controls.enabled=true;document.body.classList.remove('touring','tour-flight');this.onStop?.();}
 update(dt){if(!this.active)return;const l=this.leg;if(l.t<1){l.t=Math.min(1,l.t+dt/l.dur);const k=l.t<.5?2*l.t*l.t:1-Math.pow(-2*l.t+2,2)/2;const p=l.from.clone().lerp(l.to,k);p.y=Math.max(p.y,this.heightAt(p.x,p.z)+22);this.camera.position.copy(p);this.controls.target.copy(l.fromT.clone().lerp(l.toT,k));this.camera.lookAt(this.controls.target);return;}
  this.hold-=dt;const st=this.tour.stops[this.index],a=dt*.1,c=this.camera.position,rx=c.x-st.x,rz=c.z-st.z;c.x=st.x+rx*Math.cos(a)-rz*Math.sin(a);c.z=st.z+rx*Math.sin(a)+rz*Math.cos(a);this.camera.lookAt(this.controls.target);if(this.hold<=0)this.next();}
}
