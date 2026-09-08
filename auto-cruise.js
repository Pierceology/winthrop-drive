import {lanePoint} from './lane-position.js';
// A directed-road cruise that drives the way a person would: up to the street's posted limit, a full stop and a
// look both ways at stop signs and signals, a slow-and-look before any real turn, a gap behind slower traffic, and
// an angry beep then a pass when the road is wide enough and nothing is coming. Stops when a mapped route ends.
const MPH=.44704;
export class AutoCruise{
 constructor(network){this.network=network;this.edges=[];this.nodes=new Map();this.active=false;this.reason='';this.note='';this.glance=0;this.honk=false;this.stops=[];this.signals=[];this.traffic=null;this.lights=null;const key=p=>p.map(v=>Math.round(v/2)).join(',');this.key=key;
 for(const s of network.segments){if(s.direction===null||s.direction===undefined)continue;for(const reverse of(s.direction===1?[false]:s.direction===-1?[true]:[false,true])){const e={...s,a:reverse?s.b:s.a,b:reverse?s.a:s.b,dx:reverse?-s.dx:s.dx,dz:reverse?-s.dz:s.dz};this.edges.push(e);const k=key(e.a);if(!this.nodes.has(k))this.nodes.set(k,[]);this.nodes.get(k).push(e);}}
 }
 start(state){let best=null;for(const e of this.edges){const t=Math.max(0,Math.min(1,((state.x-e.a[0])*e.dx+(state.z-e.a[1])*e.dz)/e.length**2)),d=Math.hypot(state.x-e.a[0]-t*e.dx,state.z-e.a[1]-t*e.dz);const alignment=-Math.sin(state.yaw)*e.dx-Math.cos(state.yaw)*e.dz,score=d+(alignment<0?3:0);if(!best||score<best.score)best={e,t,d,score};}if(!best||best.d>20){this.reason='No direction-mapped road nearby';return false;}this.edge=best.e;this.t=best.t;this.visits=new Map();if(this.t>.97){const n=this.nextEdges(best.e)[0];if(n){this.edge=n;this.t=.01;}else{this.reason='End of mapped route · take control';return false;}}this.transition=null;const lane=lanePoint(this.edge,this.t);if(!this.network.contains(lane.x,lane.z,.95)){this.reason='Lane obstructed';return false;}state.x=lane.x;state.z=lane.z;this.active=true;this.reason='';this.note='';this.visits=new Map();this.junction=null;this.pass=null;this.offset=0;this.held=0;this.honkAt=-99;this.clock=0;this.glance=0;state.speed=Math.max(0,state.speed);state.yaw=Math.atan2(-this.edge.dx,-this.edge.dz);return true;}
 stop(reason=''){this.active=false;this.reason=reason;this.note='';this.glance=0;}
 nextEdges(e){return(this.nodes.get(this.key(e.b))||[]).filter(n=>(n.dx*e.dx+n.dz*e.dz)/(n.length*e.length)>-.75).sort((a,b)=>{const score=n=>(this.visits.get(n)||0)*3-(n.dx*e.dx+n.dz*e.dz)/(n.length*e.length);return score(a)-score(b);});}
 limit(e){const mph=e.speed>0?e.speed:e.width>=9?25:20;return Math.min(30,mph)*MPH;}
 // Is there a stop sign (or a signal) on this approach? OSM puts the node on the way a few metres before the corner.
 control(e,t){const along=(p)=>((p.x-e.a[0])*e.dx+(p.z-e.a[1])*e.dz)/e.length,across=(p)=>Math.abs((p.x-e.a[0])*e.dz-(p.z-e.a[1])*e.dx)/e.length;
  for(const s of this.stops)if(across(s)<4.5&&along(s)>t*e.length-2&&along(s)<e.length+3&&Math.hypot(s.x-e.b[0],s.z-e.b[1])<16)return 'stop';
  for(const s of this.signals)if(Math.hypot(s.x-e.b[0],s.z-e.b[1])<9)return 'signal';return null;}
 cars(state){const list=[];if(!this.traffic)return list;const fx=-Math.sin(state.yaw),fz=-Math.cos(state.yaw),rx=Math.cos(state.yaw),rz=-Math.sin(state.yaw);
  for(const a of this.traffic.agents){if(a.pedestrian||!a.edge||!a.model.visible)continue;const dx=a.model.position.x-state.x,dz=a.model.position.z-state.z,ahead=dx*fx+dz*fz,side=dx*rx+dz*rz;const heading=(a.edge.dx*fx+a.edge.dz*fz)/a.edge.length;list.push({a,ahead,side,heading,speed:a.speed});}return list;}
 update(dt,state){if(!this.active)return;this.clock+=dt;let e=this.edge;const options=this.nextEdges(e),next=options[0];const cos=next?(next.dx*e.dx+next.dz*e.dz)/(next.length*e.length):1,turn=Math.acos(Math.max(-1,Math.min(1,cos))),left=next?(e.dx*next.dz-e.dz*next.dx)>0:false;
 const limit=this.limit(e),remaining=(1-this.t)*e.length,control=next?this.control(e,this.t):null,realTurn=turn>.35;
 // --- the junction ahead: decide once per edge whether it needs a stop or a slow-and-look
 if(next&&!this.junction&&(control||realTurn)&&remaining<Math.max(12,state.speed*state.speed/6+8)){this.junction={edge:e,kind:control||'turn',phase:'approach',timer:0,left,minSpeed:control?0:1.6};}
 // a working light: green means go (a glance, no stop); yellow or red means stop at the line and wait for green
 if(this.junction&&this.junction.kind==='signal'&&this.lights){const j=this.junction,l=this.lights.lightAhead(e.b[0],e.b[1],e.dx/e.length,e.dz/e.length,this.clock,10);j.light=l?l.state:'green';
  if(j.phase==='approach'&&j.light==='green'){j.minSpeed=realTurn?1.6:Math.max(3,this.limit(e)*.7);if(!realTurn){j.phase='go';this.note='Green light';}}
  if(j.phase==='approach'&&j.light==='yellow'&&remaining<state.speed*1.2){j.minSpeed=Math.max(3,this.limit(e)*.7);j.phase='go';this.note='Yellow · going through';}
  if(j.phase!=='go'&&j.light!=='green')j.minSpeed=0;}
 // --- traffic ahead in our lane, and anything coming the other way
 const cars=this.cars(state);let leader=null,oncoming=null;for(const c of cars){if(c.ahead>1&&c.ahead<32&&Math.abs(c.side-this.offset)<2.2&&c.heading>.3&&(!leader||c.ahead<leader.ahead))leader=c;if(c.ahead>-4&&c.ahead<60&&c.heading<-.3&&Math.abs(c.side)<5.5&&(!oncoming||c.ahead<oncoming.ahead))oncoming=c;}
 let desired=limit;this.note='';
 if(leader&&!this.pass){desired=Math.min(desired,Math.max(0,leader.speed+(leader.ahead-7)*.9));if(leader.speed<limit-2&&leader.ahead<16){this.held+=dt;}else this.held=Math.max(0,this.held-dt);
  if(this.held>2.5){const wide=e.width>=7.5&&!this.junction&&remaining>35&&!oncoming;if(this.clock-this.honkAt>10){this.honk=true;this.honkAt=this.clock;}
   if(wide){this.pass={target:-Math.max(2.4,Math.min(3.2,e.width*.42)),leader:leader.a};this.held=0;}}
  this.note=this.pass?'':'Following traffic';}
 else this.held=Math.max(0,this.held-dt);
 if(this.pass){const l=cars.find(c=>c.a===this.pass.leader);const abort=oncoming&&oncoming.ahead<38,done=!l||l.ahead<-9;
  if(abort||done||this.junction||remaining<12){this.pass=null;}else{desired=limit;this.note='Passing';}}
 this.offset+=(( this.pass?this.pass.target:0)-this.offset)*Math.min(1,dt*1.6);
 // --- junction procedure: brake, stop or crawl, look left, look right, wait for a gap, go
 if(this.junction){const j=this.junction;const stopAt=Math.max(0,remaining-2.2);const vmax=Math.sqrt(Math.max(0,j.minSpeed*j.minSpeed+2*3.2*stopAt));
  if(j.phase==='approach'){desired=Math.min(desired,vmax);if(remaining<3.2&&state.speed<=j.minSpeed+.25){j.phase='left';j.timer=0;}}
  if(j.phase!=='approach'&&j.phase!=='go'){desired=Math.min(desired,j.minSpeed);j.timer+=dt;
   if(j.phase==='left'){this.glance=Math.PI/2;if(j.timer>.75){j.phase='right';j.timer=0;}}
   else if(j.phase==='right'){this.glance=-Math.PI/2;if(j.timer>.75){j.phase=j.left?'left2':'wait';j.timer=0;}}
   else if(j.phase==='left2'){this.glance=Math.PI/2;if(j.timer>.45){j.phase='wait';j.timer=0;}}
   else if(j.phase==='wait'){// anyone about to cross the junction from the side? keep looking their way until they are through
    const cross=cars.find(c=>Math.abs(c.heading)<.7&&Math.hypot(c.a.model.position.x-e.b[0],c.a.model.position.z-e.b[1])<24);
    const red=j.kind==='signal'&&j.light&&j.light!=='green';if(red){this.glance=Math.sin(j.timer*1.2)>0?Math.PI/2:-Math.PI/2;this.note='Red light';}
    else if(cross&&j.timer<6){this.glance=cross.side<0?Math.PI/2:-Math.PI/2;this.note='Waiting for a gap';}else{j.phase='go';j.timer=0;this.glance=0;}}
   if(this.note==='')this.note=j.kind==='stop'?'Stop sign · looking both ways':j.kind==='signal'?'Signal · looking both ways':'Turn ahead · looking both ways';}
  if(j.phase==='go'){this.glance=0;if(this.edge!==j.edge&&this.t*this.edge.length>6)this.junction=null;}
 } else this.glance=0;
 // --- bends without a junction procedure still get a corner speed
 const cornerSpeed=turn<.25?limit:Math.max(2.5,limit-turn*5),braking=Math.max(0,(state.speed**2-cornerSpeed**2)/7)+3;
 if(next&&remaining<braking&&!this.junction)desired=Math.min(desired,cornerSpeed);if(!next&&remaining<Math.max(4,state.speed*state.speed/6))desired=Math.min(desired,1.2);
 this.debug={desired:+desired.toFixed(2),remaining:+remaining.toFixed(1),leader:leader?[+leader.ahead.toFixed(1),+leader.side.toFixed(1),+leader.speed.toFixed(1)]:null,oncoming:oncoming?+oncoming.ahead.toFixed(1):null,corner:+cornerSpeed.toFixed(1),turn:+turn.toFixed(2),len:+e.length.toFixed(1),t:+this.t.toFixed(3)};
 state.speed+=Math.max(-dt*6.5,Math.min(dt*(state.speed<4?3.2:2.2),desired-state.speed));if(state.speed<.05&&desired<.1)state.speed=0;
 let t=this.t+state.speed*dt/e.length;
 if(t>=1){if(!next){state.speed=0;this.stop('End of mapped route · take control');return;}
 const excess=(t-1)*e.length;this.transition=turn>.17||Math.abs(next.width-e.width)>.5?{x:state.x,z:state.z}:null;this.edge=next;this.visits.set(next,(this.visits.get(next)||0)+1);e=next;t=Math.min(.99,excess/e.length);
 }
 let {x,z}=lanePoint(e,t);if(this.offset){const n=Math.hypot(e.dx,e.dz),sx=x-e.dz/n*this.offset,sz=z+e.dx/n*this.offset;if(this.network.contains(sx,sz,.95)){x=sx;z=sz;}else{this.pass=null;this.offset*=.5;}}
 if(this.transition){const blend=Math.min(1,t*e.length/Math.min(5,e.length*.5));x=this.transition.x+(x-this.transition.x)*blend;z=this.transition.z+(z-this.transition.z)*blend;if(blend===1)this.transition=null;}
 if(!this.network.contains(x,z,.95)){this.stop('Edge assist · take control');state.step(dt,{});return;}
 const angle=Math.atan2(Math.sin(Math.atan2(-e.dx,-e.dz)-state.yaw),Math.cos(Math.atan2(-e.dx,-e.dz)-state.yaw));state.distance+=Math.hypot(x-state.x,z-state.z);state.x=x;state.z=z;state.yaw+=angle*Math.min(1,dt*5);state.steer=Math.max(-.4,Math.min(.4,angle*.5));state.road=e;state.blocked=false;state.wrongWay=false;this.t=t;
 }
}
