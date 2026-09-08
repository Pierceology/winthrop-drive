import * as THREE from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {carKit,KIT} from './car-kit.js';
import {Junctions,speedLimit} from './junctions.js';
const gray=new THREE.MeshStandardMaterial({color:'#30373a',roughness:.75}),glass=new THREE.MeshStandardMaterial({color:'#5b7783',metalness:.35,roughness:.2}),chrome=new THREE.MeshStandardMaterial({color:'#b5b7b7',metalness:.75,roughness:.3});
function geometryGroup(){const group=new THREE.Group(),parts=new Map();return{group,box(x,y,z,w,h,d,m){const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);if(!parts.has(m))parts.set(m,[]);parts.get(m).push(g);},finish(){for(const[m,gs]of parts){const mesh=new THREE.Mesh(mergeGeometries(gs,false),m);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);for(const g of gs)g.dispose();}return group;}};}
export function sedan(index=0,variant='sedan'){const a=geometryGroup(),paint=new THREE.MeshStandardMaterial({color:['#7d2828','#b6b8b5','#29445d','#e1dfd7','#4c5552'][index%5],metalness:.35,roughness:.3});
 a.box(0,.58,0,1.78,.48,4.35,paint);a.box(0,1.04,variant==='wagon'?.48:.16,1.55,.59,variant==='wagon'?2.98:2.35,glass);a.box(0,1.37,variant==='wagon'?.48:.2,1.6,.1,variant==='wagon'?3.02:2.3,paint);a.box(0,.82,-1.58,1.78,.14,1.2,paint);a.box(0,.82,1.65,1.78,.14,1,paint);
 a.box(0,.43,-2.17,1.55,.15,.08,gray);a.box(0,.5,2.18,1.5,.1,.08,chrome);
 for(const x of[-.6,.6]){a.box(x,.67,-2.2,.35,.14,.04,new THREE.MeshStandardMaterial({color:'#eee5c5',emissive:'#ccb97d',emissiveIntensity:.3}));a.box(x,.65,2.21,.38,.14,.03,new THREE.MeshStandardMaterial({color:'#c62c21'}));a.box(Math.sign(x)*.85,1.05,-.78,.2,.12,.3,paint);}
 a.box(0,1.06,.05,1.62,.65,.09,paint);const group=a.finish();group.userData.wheels=[];group.userData.paint=paint;
 for(const x of[-.88,.88])for(const z of[-1.35,1.36]){const wheel=new THREE.Group();wheel.name='wheel_'+(z<0?'f':'r')+(x<0?'l':'r');wheel.position.set(x,.34,z);const tire=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.22,16),gray);tire.rotation.z=Math.PI/2;wheel.add(tire);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.21,.21,.23,10),chrome);hub.rotation.z=Math.PI/2;wheel.add(hub);group.add(wheel);group.userData.wheels.push(wheel);}return group;
}
function walker(i){const group=new THREE.Group(),shirt=new THREE.MeshStandardMaterial({color:['#59788c','#d3ab76','#874d50','#6b7561'][i%4]}),skin=new THREE.MeshStandardMaterial({color:['#c29b7d','#936f58','#d7b293'][i%3]});
 const body=new THREE.Mesh(new THREE.CapsuleGeometry(.19,.43,3,6),shirt);body.position.y=1.13;group.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(.13,8,6),skin);head.position.y=1.68;group.add(head);group.userData.limbs=[];
 for(const side of[-1,1])for(const arm of[false,true]){const pivot=new THREE.Group();pivot.position.set(side*(arm?.25:.1),arm?1.38:.91,0);const limb=new THREE.Mesh(new THREE.CapsuleGeometry(arm?.065:.08,arm?.42:.63,2,5),arm?shirt:gray);limb.position.y=arm?-.22:-.35;pivot.add(limb);group.add(pivot);group.userData.limbs.push({pivot,phase:side*(arm?-1:1)});}return group;
}
export class AmbientLife{
 constructor(scene,network,heightAt){Object.assign(this,{scene,network,heightAt});this.junctions=new Junctions(network);this.stops=[];this.group=new THREE.Group();scene.add(this.group);this.agents=[];this.clock=0;this.nodes=new Map();this.segments=network.segments.filter(s=>s.width>=6&&s.length>8&&s.direction!==null);const key=p=>p.map(v=>Math.round(v)).join(',');this.key=key;
 for(const s of network.segments){if(s.width<6||s.direction===null)continue;for(const reverse of(s.direction===1?[false]:s.direction===-1?[true]:[false,true])){const a=reverse?s.b:s.a,b=reverse?s.a:s.b,edge={...s,reversed:reverse,a,b,dx:b[0]-a[0],dz:b[1]-a[1]};const k=key(a);if(!this.nodes.has(k))this.nodes.set(k,[]);this.nodes.get(k).push(edge);}}
 for(let i=0;i<22;i++){const pedestrian=i>=12,model=pedestrian?walker(i):sedan(i);this.group.add(model);this.agents.push({i,pedestrian,model,edge:null,t:0,speed:pedestrian?1.15:5.5+(i%4)*.6});}
 this.lights=null;this.dressUp();
 }
 // Swap the placeholder boxes for the Kenney kit as the models arrive; wheels keep spinning through userData.wheels.
 async dressUp(){const picks=['sedan','sedan-sports','hatchback-sports','suv','suv-luxury','van','taxi','truck','delivery-flat','sedan','suv','hatchback-sports'];
  for(const a of this.agents){if(a.pedestrian)continue;try{const t=await carKit.load(picks[a.i%picks.length]);const m=carKit.instance(t);m.position.copy(a.model.position);m.rotation.copy(a.model.rotation);m.visible=a.model.visible;this.group.remove(a.model);a.model=m;this.group.add(m);}catch(e){/* keep the box car */}}
 }
 spawn(agent,focus,player=null){const candidates=this.segments.filter(s=>Math.hypot((s.a[0]+s.b[0])/2-focus.x,(s.a[1]+s.b[1])/2-focus.z)<450&&(!agent.pedestrian||/SHIRLEY|BEACH|WINTHROP|HAGMAN|WOOD/i.test(s.name)));if(!candidates.length){agent.model.visible=false;agent.edge=null;return;}agent.edge=candidates[(agent.i*17+Math.floor(this.clock/30)*7)%candidates.length];if(agent.edge.direction===-1||(agent.edge.direction===0&&agent.i%2)){const s=agent.edge;agent.edge={...s,reversed:true,a:s.b,b:s.a,dx:-s.dx,dz:-s.dz};}agent.t=.15+(agent.i%7)*.1;agent.stopped=0;agent.next=null;agent.spawnedAt=this.clock;
  // never appear on top of the player, or right in front of them: slide along the road, else stay hidden this round
  if(player&&player.active){const st=player.state;for(let k=0;k<4;k++){const q=this.point(agent);if(Math.hypot(q.x-st.x,q.z-st.z)>18)break;agent.t=(agent.t+.3)%1;if(k===3){agent.model.visible=false;agent.edge=null;return;}}}
  agent.model.visible=true;}
 choices(edge){return(this.nodes.get(this.key(edge.b))||[]).filter(s=>(s.dx*edge.dx+s.dz*edge.dz)/(s.length*edge.length)>-.6);}
 pick(agent){const choices=this.choices(agent.edge);return choices.length?choices[(agent.i+Math.floor(this.clock/12))%choices.length]:null;}
 point(agent,t=agent.t){const s=agent.edge,n=Math.hypot(s.dx,s.dz),offset=agent.pedestrian?s.width/2+.95:Math.min(1.65,s.width*.22);return{x:s.a[0]+s.dx*t-s.dz/n*offset,z:s.a[1]+s.dz*t+s.dx/n*offset};}
 update(dt,focus,player,enabled=true){this.group.visible=enabled;if(!enabled)return;this.clock+=dt;
 for(const a of this.agents){if(!a.edge||Math.hypot(a.model.position.x-focus.x,a.model.position.z-focus.z)>800)this.spawn(a,focus,player);if(!a.edge)continue;const p=this.point(a);let speed=Math.min(a.speed,speedLimit(a.edge)*.92);// never over the posted limit
  if(!a.pedestrian){const others=this.agents.filter(b=>b!==a&&!b.pedestrian&&b.edge&&b.model.visible).map(b=>b.model.position);if(player?.active)others.push({x:player.state.x,z:player.state.z});for(const b of others){const dx=b.x-p.x,dz=b.z-p.z,ahead=(dx*a.edge.dx+dz*a.edge.dz)/a.edge.length,side=Math.abs(dx*a.edge.dz-dz*a.edge.dx)/a.edge.length;if(ahead>0&&ahead<10&&side<2)speed=Math.min(speed,Math.max(0,ahead-5));}
   // the corner ahead (looking on through the short pieces roads are cut into): a signal on the shared clock, or a
   // stop sign - stop at the line, hold a moment, yield to anyone already in the junction (the player included), go
   if(!a.next||a.nextFor!==a.edge){a.nextFor=a.edge;a.next=this.pick(a);}
   const look=this.junctions.lookAhead(a.edge,a.t,ed=>ed===a.edge?a.next:(this.choices(ed).length===1?this.choices(ed)[0]:null),this.lights,this.stops,45);
   if(look){const toLine=look.dist-look.line;if(a.stopFor!==look.edge){a.stopFor=look.edge;a.stopped=0;}
    if(toLine>-1.5){const st=look.light&&look.light.state,mustStop=look.kind==='signal'?(st==='red'||(st==='yellow'&&toLine>speed*speed/9+.6)):true;
     if(mustStop){if(toLine<.5){const busy=others.some(o=>Math.hypot(o.x-look.edge.b[0],o.z-look.edge.b[1])<9);if(look.kind==='signal'||a.stopped<1.2||(busy&&a.stopped<6)){speed=0;a.stopped+=dt;}}
      else if(toLine<12)speed=Math.min(speed,Math.max(0,toLine*1.2));}}}}
  // the player in the corner ahead: hold at the line (unless they are behind us), a few seconds at most
  if(!a.pedestrian&&player?.active){const e=a.edge,toEnd=(1-a.t)*e.length,st=player.state;if(toEnd<this.junctions.stopLine(e)+.5&&Math.hypot(st.x-e.b[0],st.z-e.b[1])<9&&((st.x-p.x)*e.dx+(st.z-p.z)*e.dz)/e.length>-1&&(a.held||0)<4){speed=0;a.held=(a.held||0)+dt;}}
  a.t+=dt*speed/a.edge.length;if(a.t>1){const n=a.nextFor===a.edge?a.next:this.pick(a);if(n){a.edge=n;a.t=0;a.stopped=0;a.held=0;}else{a.edge=null;a.model.visible=false;continue;}}
  const q=this.point(a);a.model.visible=!this.network.obstructed(q.x,q.z)&&(!a.pedestrian||this.heightAt(q.x,q.z)>.08);a.model.position.set(q.x,this.heightAt(q.x,q.z)+.14,q.z);const yaw=Math.atan2(-a.edge.dx,-a.edge.dz);a.model.rotation.y+=Math.atan2(Math.sin(yaw-a.model.rotation.y),Math.cos(yaw-a.model.rotation.y))*Math.min(1,dt*5);
  if(a.pedestrian)for(const l of a.model.userData.limbs)l.pivot.rotation.x=Math.sin(this.clock*5+a.i)*.43*l.phase;else for(const w of a.model.userData.wheels)w.rotation.x-=speed*dt/.34;
 }
 }
 constrainPlayer(state){if(!this.group.visible||state.speed<=0)return;const fx=-Math.sin(state.yaw),fz=-Math.cos(state.yaw);for(const a of this.agents){if(a.pedestrian||!a.edge||!a.model.visible)continue;const dx=a.model.position.x-state.x,dz=a.model.position.z-state.z,ahead=dx*fx+dz*fz,side=Math.abs(dx*fz-dz*fx);if(ahead>0&&ahead<7&&side<1.8)state.speed=Math.min(state.speed,Math.max(0,(ahead-4.6)*2));}}
}
