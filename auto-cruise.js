import {lanePoint} from './lane-position.js';
import {Junctions,speedLimit} from './junctions.js';
// A directed-road cruise that drives the way a person would: up to the street's posted limit, a full stop and a
// look both ways at stop signs and signals, a slow-and-look before any real turn, a gap behind slower traffic, and
// an angry beep then a pass when the road is wide enough and nothing is coming. Stops when a mapped route ends.
const MPH=.44704;
export class AutoCruise{
 constructor(network){this.network=network;this.junctions=new Junctions(network);this.edges=[];this.nodes=new Map();this.active=false;this.reason='';this.note='';this.glance=0;this.honk=false;this.stops=[];this.signals=[];this.traffic=null;this.lights=null;this.tour=null;this.route=null;this.dwell=null;this.tourLine='';const key=p=>p.map(v=>Math.round(v/2)).join(',');this.key=key;
 for(const s of network.segments){if(s.direction===null||s.direction===undefined)continue;for(const reverse of(s.direction===1?[false]:s.direction===-1?[true]:[false,true])){const e={...s,reversed:reverse,a:reverse?s.b:s.a,b:reverse?s.a:s.b,dx:reverse?-s.dx:s.dx,dz:reverse?-s.dz:s.dz};this.edges.push(e);const k=key(e.a);if(!this.nodes.has(k))this.nodes.set(k,[]);this.nodes.get(k).push(e);}}
 }
 start(state){let best=null;for(const e of this.edges){const t=Math.max(0,Math.min(1,((state.x-e.a[0])*e.dx+(state.z-e.a[1])*e.dz)/e.length**2)),d=Math.hypot(state.x-e.a[0]-t*e.dx,state.z-e.a[1]-t*e.dz);const alignment=-Math.sin(state.yaw)*e.dx-Math.cos(state.yaw)*e.dz,score=d+(alignment<0?3:0);if(!best||score<best.score)best={e,t,d,score};}if(!best||best.d>20){this.reason='No direction-mapped road nearby';return false;}this.edge=best.e;this.t=best.t;this.visits=new Map();if(this.t>.97){const n=this.nextEdges(best.e)[0];if(n){this.edge=n;this.t=.01;}else{this.reason='End of mapped route · take control';return false;}}this.transition=null;const lane=lanePoint(this.edge,this.t);if(!this.network.contains(lane.x,lane.z,.95)){this.reason='Lane obstructed';return false;}state.x=lane.x;state.z=lane.z;this.active=true;this.reason='';this.note='';this.visits=new Map();this.junction=null;this.pass=null;this.offset=0;this.held=0;this.honkAt=-99;this.clock=0;this.glance=0;state.speed=Math.max(0,state.speed);state.yaw=Math.atan2(-this.edge.dx,-this.edge.dz);return true;}
 stop(reason=''){this.active=false;this.reason=reason;this.note='';this.glance=0;this.dwell=null;}
 // Shortest path over the directed road graph, by length, from the current edge to the edge nearest a point.
 // Every directed edge within reach of a point, nearest first (a stop can sit well off the road, like a beach).
 edgesNear(x,z,limit=260){const list=[];for(const e of this.edges){const t=Math.max(0,Math.min(1,((x-e.a[0])*e.dx+(z-e.a[1])*e.dz)/e.length**2)),d=Math.hypot(x-e.a[0]-t*e.dx,z-e.a[1]-t*e.dz)+(e.width<5?15:0);if(d<limit)list.push({e,t,d});}return list.sort((a,b)=>a.d-b.d);}
 // Shortest path over the directed road graph, by length, from the current edge to the nearest reachable edge by the point.
 planRoute(from,target){const goals=this.edgesNear(target.x,target.z);if(!goals.length)return null;const near=goals[0].d,cands=new Map(goals.filter(g=>g.d<near+60).map(g=>[g.e,g]));
  const dist=new Map([[from,0]]),prev=new Map(),open=[from];let hit=null;
  while(open.length){let i=0;for(let k=1;k<open.length;k++)if(dist.get(open[k])<dist.get(open[i]))i=k;const e=open.splice(i,1)[0];if(cands.has(e)){hit=cands.get(e);break;}
   const outs=this.nodes.get(this.key(e.b))||[],deadEnd=outs.length<=1;for(const n of outs){if(!deadEnd&&(n.dx*e.dx+n.dz*e.dz)/(n.length*e.length)<-.9)continue;const d=dist.get(e)+n.length+(deadEnd?25:0);if(d<(dist.get(n)??Infinity)){dist.set(n,d);prev.set(n,e);if(!open.includes(n))open.push(n);}}}
  if(!hit)return null;const route=[hit.e];while(route[0]!==from){const p=prev.get(route[0]);if(!p)return null;route.unshift(p);}return {route,t:hit.t};}
 startTour(tour){this.tour={...tour,index:-1};this.route=null;this.dwell=null;this.nextStop();}
 endTour(){this.tour=null;this.route=null;this.dwell=null;this.tourLine='';}
 nextStop(){if(!this.tour)return;for(;;){this.tour.index++;const st=this.tour.stops[this.tour.index];if(!st){this.tourLine=this.tour.name+' · done';this.tour=null;this.route=null;return;}
   const plan=this.planRoute(this.edge,st);if(plan){this.route=plan.route;this.routeT=plan.t;this.stop_=st;this.tourLine=this.tour.name+' · '+(this.tour.index+1)+'/'+this.tour.stops.length+' · next: '+st.name;return;}}}
 nextEdges(e){const outs=this.nodes.get(this.key(e.b))||[];return(outs.length<=1?outs:outs.filter(n=>(n.dx*e.dx+n.dz*e.dz)/(n.length*e.length)>-.75)).sort((a,b)=>{const score=n=>(this.visits.get(n)||0)*3-(n.dx*e.dx+n.dz*e.dz)/(n.length*e.length);return score(a)-score(b);});}
 limit(e){return speedLimit(e);}
 // Is there a stop sign (or a signal) on this approach? OSM puts the stop node on the way a few metres before the
 // corner, tagged forward/backward for the direction it applies to; signals are grouped onto the corner they guard.
 control(e,t){if(this.junctions.stopSign(e,t,this.stops))return 'stop';if(this.lights&&this.lights.near(e.b[0],e.b[1],4))return 'signal';return null;}
 cars(state){const list=[];if(!this.traffic)return list;const fx=-Math.sin(state.yaw),fz=-Math.cos(state.yaw),rx=Math.cos(state.yaw),rz=-Math.sin(state.yaw);
  for(const a of this.traffic.agents){if(!a.edge||!a.model.visible)continue;const dx=a.model.position.x-state.x,dz=a.model.position.z-state.z,ahead=dx*fx+dz*fz,side=dx*rx+dz*rz;if(a.pedestrian){if(ahead>0&&ahead<24&&Math.abs(side)<3&&this.network.contains(a.model.position.x,a.model.position.z,.2))list.push({a,ahead,side,heading:1,speed:0,walker:true});continue;}const heading=(a.edge.dx*fx+a.edge.dz*fz)/a.edge.length;list.push({a,ahead,side,heading,speed:a.speed});}return list;}
 update(dt,state){if(!this.active)return;this.clock+=dt;let e=this.edge;const options=this.nextEdges(e);let next=options[0];
 if(this.route){let i=this.route.indexOf(e);if(i<0){const plan=this.planRoute(e,this.stop_);if(plan){this.route=plan.route;this.routeT=plan.t;i=0;}else{this.nextStop();}}
  if(this.route){i=this.route.indexOf(e);next=i>=0&&i<this.route.length-1?this.route[i+1]:(i===this.route.length-1?null:next);
   if(i===this.route.length-1&&!this.dwell&&this.t>=this.routeT-.02){this.dwell={until:this.clock+7,stop:this.stop_};}}}
 if(this.dwell){const st=this.dwell.stop,fx=-Math.sin(state.yaw),fz=-Math.cos(state.yaw),dx=st.x-state.x,dz=st.z-state.z;this.glance=(fx*dz-fz*dx)>0?-Math.PI/2:Math.PI/2;state.speed=Math.max(0,state.speed-dt*6.5);this.note='Here: '+st.name;this.tourLine=(this.tour?this.tour.name+' · '+(this.tour.index+1)+'/'+this.tour.stops.length+' · ':'')+st.name;
  if(this.clock>this.dwell.until){this.dwell=null;this.glance=0;this.route=null;this.nextStop();}return;}
 if(this.route&&!next){// at the goal edge's end without arriving: treat its end as the stop
  if(this.t>=.97){this.dwell={until:this.clock+7,stop:this.stop_};}next=options[0];}const cos=next?(next.dx*e.dx+next.dz*e.dz)/(next.length*e.length):1,turn=Math.acos(Math.max(-1,Math.min(1,cos))),left=next?(e.dx*next.dz-e.dz*next.dx)<0:false;
 const limit=this.limit(e),remaining=(1-this.t)*e.length,realTurn=turn>.35;
 // the edge that follows any edge on our way: the route's, else the wander's first choice
 const chooser=ed=>{if(ed===e)return next;if(this.route){const k=this.route.indexOf(ed);if(k>=0)return k<this.route.length-1?this.route[k+1]:null;}return this.nextEdges(ed)[0]||null;};
 // the first stop sign or signal ahead, looking straight on through the short pieces roads are cut into
 const look=next?this.junctions.lookAhead(e,this.t,chooser,this.lights,this.stops,70):null;
 // --- the junction ahead: decide once whether it needs a stop or a slow-and-look, and which way to look:
 // only toward arms that exist (a left-only corner gets a look left, nothing to the right means no look right)
 const near=Math.max(14,state.speed*state.speed/6+10),ctrlClose=!!(look&&look.dist-look.line<near),turnClose=!!(next&&realTurn&&remaining<near);
 if(this.junction&&this.junction.kind==='turn'&&this.junction.phase==='go'&&ctrlClose)this.junction=null;
 if(next&&!this.junction&&(ctrlClose||turnClose)){const je=ctrlClose?look.edge:e,arms=this.junctions.arms(je),sides=arms.filter(a=>a.side!=='back'),after=chooser(je);
  const cosA=after?(after.dx*je.dx+after.dz*je.dz)/(after.length*je.length):1,turnAtEnd=Math.acos(Math.max(-1,Math.min(1,cosA)))>.35,leftAtEnd=after?(je.dx*after.dz-je.dz*after.dx)<0:false;
  let line=ctrlClose?look.line:2.2,dist=ctrlClose?look.dist:remaining,commit=false;
  if(ctrlClose&&dist-line<-1){if(dist>4)line=dist-1;else commit=true;}// the line was behind us when we turned in: stop short of the box, or clear it
  this.junction={edge:je,chain:ctrlClose?look.chain:[e],kind:ctrlClose?look.kind:'turn',phase:commit?'go':'approach',timer:0,left:leftAtEnd,turnAtEnd,minSpeed:ctrlClose?0:1.6,line,arms,lookLeft:sides.some(a=>a.side==='left'),lookRight:sides.some(a=>a.side==='right'),looked:commit};}
 let jdist=-1;if(this.junction){const j=this.junction,k=j.chain.indexOf(e);jdist=e===j.edge?remaining:k>=0?remaining+j.chain.slice(k+1).reduce((n,x)=>n+x.length,0):-1;if(jdist<0&&j.phase==='approach')this.junction=null;}
 // a working light: green means go (a glance, no stop); red means stop at the line and wait for green; yellow means
 // stop if that can be done gently, else carry on through. The decision is re-read until the line is reached, so a
 // light that changes while we roll up behind slower traffic is obeyed, not remembered.
 if(this.junction&&this.junction.kind==='signal'&&this.lights){const j=this.junction,je=j.edge,l=this.lights.lightAhead(je.b[0],je.b[1],je.dx/je.length,je.dz/je.length,undefined,4);j.light=l?l.state:'green';
  const toLine=jdist-j.line,committed=j.phase==='go'&&(j.looked||toLine<1.5),canStop=toLine>state.speed*state.speed/9+.6;
  if(!committed){if(j.light==='green'){if(!j.turnAtEnd){j.phase='go';j.minSpeed=Math.max(3,limit*.7);this.note='Green light';}else{j.minSpeed=1.6;if(j.phase==='go')j.phase='approach';}}
   else if(j.light==='yellow'&&!canStop&&(j.phase==='approach'||j.phase==='go')){j.phase='go';j.looked=true;j.minSpeed=Math.max(3,limit*.7);this.note='Yellow · going through';}
   else{if(j.phase==='go')j.phase='approach';j.minSpeed=0;}}}
 // --- traffic ahead in our lane, and anything coming the other way
 const cars=this.cars(state);let leader=null,oncoming=null;for(const c of cars){if(c.ahead>1&&c.ahead<40&&Math.abs(c.side-this.offset)<2.2&&c.heading>.3&&(!leader||c.ahead<leader.ahead))leader=c;if(c.ahead>-4&&c.ahead<110&&c.heading<-.3&&Math.abs(c.side)<5.5&&(!oncoming||c.ahead<oncoming.ahead))oncoming=c;}
 let desired=this.tour?Math.min(limit,10):limit;this.note='';
 const gap=5+state.speed*1.2;// a following distance that grows with speed, about a second and a half
 if(leader&&!this.pass){desired=Math.min(desired,Math.max(0,leader.speed+(leader.ahead-gap)*.9));if(leader.speed<limit-2&&leader.ahead<gap+6&&!leader.walker){this.held+=dt;}else this.held=Math.max(0,this.held-dt);
  if(this.held>2.5){// pass only on a wide road with enough of it left to get past and back in before the corner
   // (at the limit against their speed), no control or crossing ahead, and nothing coming for a long way
   const edge=limit-leader.speed,need=edge>2.5?(leader.ahead+14)/edge*limit+20:Infinity;
   const clear=e.width>=7.5&&!this.junction&&remaining>need&&!oncoming&&!look&&!this.tour&&leader.ahead<gap+6&&!leader.walker;if(this.clock-this.honkAt>10){this.honk=true;this.honkAt=this.clock;}
   if(clear){this.pass={target:-Math.max(2.4,Math.min(3.2,e.width*.42)),leader:leader.a};this.held=0;}}
  this.note=this.pass?'':leader.walker?'Pedestrian in the road':'Following traffic';}
 else this.held=Math.max(0,this.held-dt);
 if(this.pass){const l=cars.find(c=>c.a===this.pass.leader);const abort=oncoming&&oncoming.ahead<70,done=!l||l.ahead<-9;
  if(done)this.pass=null;
  else if(abort||this.junction||remaining<14||look||this.pass.abort){// never merge back while level with them: drop behind first
   this.pass.abort=true;if(l.ahead>gap+3)this.pass=null;else{desired=Math.min(desired,Math.max(0,l.speed-2.5));this.note='Dropping back';}}
  else{desired=limit;this.note='Passing';}}
 this.offset+=(( this.pass?this.pass.target:0)-this.offset)*Math.min(1,dt*1.6);
 // --- junction procedure: brake, stop at the line or crawl, look where the roads are, wait for a gap, go
 if(this.junction){const j=this.junction;const stopAt=Math.max(0,jdist-j.line);const vmax=Math.sqrt(Math.max(0,j.minSpeed*j.minSpeed+2*3.2*stopAt));
  if(j.phase==='approach'){desired=Math.min(desired,vmax);if(jdist<j.line+1&&state.speed<=j.minSpeed+.25){j.phase=j.lookLeft?'left':j.lookRight?'right':'wait';j.timer=0;}}
  if(j.phase!=='approach'&&j.phase!=='go'){desired=Math.min(desired,j.minSpeed);j.timer+=dt;
   if(j.phase==='left'){this.glance=Math.PI/2;if(j.timer>.75){j.phase=j.lookRight?'right':'wait';j.timer=0;}}
   else if(j.phase==='right'){this.glance=-Math.PI/2;if(j.timer>.75){j.phase=j.lookLeft?'left2':'wait';j.timer=0;}}
   else if(j.phase==='left2'){this.glance=Math.PI/2;if(j.timer>.45){j.phase='wait';j.timer=0;}}
   else if(j.phase==='wait'){// anyone in the junction or about to enter it from the side? and, turning left, anyone coming toward us?
    const node=j.edge.b,atNode=c=>Math.hypot(c.a.model.position.x-node[0],c.a.model.position.z-node[1]),toward=c=>((node[0]-c.a.model.position.x)*c.a.edge.dx+(node[1]-c.a.model.position.z)*c.a.edge.dz)>0;
    const cross=cars.find(c=>!c.walker&&Math.abs(c.heading)<.7&&(atNode(c)<8||(atNode(c)<26&&toward(c))));
    const coming=j.left?cars.find(c=>!c.walker&&c.heading<-.3&&c.ahead>0&&c.ahead<45&&Math.abs(c.side)<6):null;
    const red=j.kind==='signal'&&j.light&&j.light!=='green';if(red){this.glance=Math.sin(j.timer*1.2)>0?Math.PI/2:-Math.PI/2;this.note='Red light';}
    else if(cross&&j.timer<8){this.glance=cross.side<0?Math.PI/2:-Math.PI/2;this.note='Waiting for a gap';}
    else if(coming&&j.timer<8){this.glance=0;this.note='Yielding to oncoming';}
    else{j.phase='go';j.looked=true;j.timer=0;this.glance=0;}}
   if(this.note==='')this.note=j.kind==='stop'?'Stop sign · looking':j.kind==='signal'?'Signal · looking':'Turn ahead · looking';}
  if(j.phase==='go'){this.glance=0;if(jdist<0&&this.t*this.edge.length>6)this.junction=null;}
 } else this.glance=0;
 // --- bends and a lower limit ahead still get their speed before the corner, junction or not
 const cornerSpeed=Math.min(turn<.25?limit:Math.max(2.5,limit-turn*5),next?this.limit(next):limit),braking=Math.max(0,(state.speed**2-cornerSpeed**2)/7)+3;
 if(next&&remaining<braking)desired=Math.min(desired,cornerSpeed);if(!next&&remaining<Math.max(4,state.speed*state.speed/6))desired=Math.min(desired,1.2);
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
