import {lanePoint} from './lane-position.js';
// A directed-road cruise, deliberately stopping when a mapped continuation ends.
export class AutoCruise{
 constructor(network){this.network=network;this.edges=[];this.nodes=new Map();this.active=false;this.reason='';const key=p=>p.map(v=>Math.round(v/2)).join(',');this.key=key;
 for(const s of network.segments){if(s.direction===null||s.direction===undefined)continue;for(const reverse of(s.direction===1?[false]:s.direction===-1?[true]:[false,true])){const e={...s,a:reverse?s.b:s.a,b:reverse?s.a:s.b,dx:reverse?-s.dx:s.dx,dz:reverse?-s.dz:s.dz};this.edges.push(e);const k=key(e.a);if(!this.nodes.has(k))this.nodes.set(k,[]);this.nodes.get(k).push(e);}}
 }
 start(state){let best=null;for(const e of this.edges){const t=Math.max(0,Math.min(1,((state.x-e.a[0])*e.dx+(state.z-e.a[1])*e.dz)/e.length**2)),d=Math.hypot(state.x-e.a[0]-t*e.dx,state.z-e.a[1]-t*e.dz);const alignment=-Math.sin(state.yaw)*e.dx-Math.cos(state.yaw)*e.dz,score=d+(alignment<0?3:0);if(!best||score<best.score)best={e,t,d,score};}if(!best||best.d>20){this.reason='No direction-mapped road nearby';return false;}this.edge=best.e;this.t=best.t;this.transition=null;const lane=lanePoint(this.edge,this.t);if(!this.network.contains(lane.x,lane.z,.95)){this.reason='Lane obstructed';return false;}state.x=lane.x;state.z=lane.z;this.active=true;this.reason='';this.visits=new Map();state.speed=Math.max(0,state.speed);state.yaw=Math.atan2(-this.edge.dx,-this.edge.dz);return true;}
 stop(reason=''){this.active=false;this.reason=reason;}
 nextEdges(e){return(this.nodes.get(this.key(e.b))||[]).filter(n=>(n.dx*e.dx+n.dz*e.dz)/(n.length*e.length)>-.75).sort((a,b)=>{const score=n=>(this.visits.get(n)||0)*3-(n.dx*e.dx+n.dz*e.dz)/(n.length*e.length);return score(a)-score(b);});}
 update(dt,state){if(!this.active)return;let e=this.edge;const options=this.nextEdges(e),next=options[0];const turn=next?Math.acos(Math.max(-1,Math.min(1,(next.dx*e.dx+next.dz*e.dz)/(next.length*e.length)))):0;
 const cornerSpeed=turn<.25?7:Math.max(2.8,7-turn*2.7),remaining=(1-this.t)*e.length,braking=Math.max(0,(state.speed**2-cornerSpeed**2)/8)+3;
 const desired=next&&remaining<braking?cornerSpeed:7;state.speed+=Math.max(-dt*4,Math.min(dt*2,desired-state.speed));
 let t=this.t+state.speed*dt/e.length;
 if(t>=1){if(!next){state.speed=0;this.stop('End of mapped route · take control');return;}
 const excess=(t-1)*e.length;this.transition=turn>.17||Math.abs(next.width-e.width)>.5?{x:state.x,z:state.z}:null;this.edge=next;this.visits.set(next,(this.visits.get(next)||0)+1);e=next;t=Math.min(.99,excess/e.length);
 }
 let {x,z}=lanePoint(e,t);if(this.transition){const blend=Math.min(1,t*e.length/Math.min(5,e.length*.5));x=this.transition.x+(x-this.transition.x)*blend;z=this.transition.z+(z-this.transition.z)*blend;if(blend===1)this.transition=null;}
 if(!this.network.contains(x,z,.95)){this.stop('Edge assist · take control');state.step(dt,{});return;}
 const angle=Math.atan2(Math.sin(Math.atan2(-e.dx,-e.dz)-state.yaw),Math.cos(Math.atan2(-e.dx,-e.dz)-state.yaw));state.distance+=Math.hypot(x-state.x,z-state.z);state.x=x;state.z=z;state.yaw+=angle*Math.min(1,dt*5);state.steer=Math.max(-.4,Math.min(.4,angle*.5));state.road=e;state.blocked=false;state.wrongWay=false;this.t=t;
 }
}
