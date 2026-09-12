import {lanePoint} from './lane-position.js';
// A bounded, road-constrained bicycle model. Coordinates and distances are meters.
export class RoadNetwork {
 constructor(roads,buildings=[]){this.obstacles=new Map();for(const b of buildings){const xs=b.rings[0].map(p=>p[0]),zs=b.rings[0].map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/60);x<=Math.floor(Math.max(...xs)/60);x++)for(let z=Math.floor(Math.min(...zs)/60);z<=Math.floor(Math.max(...zs)/60);z++){const k=x+","+z;if(!this.obstacles.has(k))this.obstacles.set(k,[]);this.obstacles.get(k).push(b.rings)}}this.segments=[];this.cells=new Map();this.cellSize=60;for(const road of roads){if([7,8].includes(road.type))continue;for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.05)continue;const s={a,b,dx,dz,length,width:road.width||6,name:road.name,speed:road.speed,id:road.id,direction:road.directions?.[i-1]??null,directionSource:road.directionSources?.[i-1]??null};this.segments.push(s);const pad=s.width/2+3;for(let x=Math.floor((Math.min(a[0],b[0])-pad)/60);x<=Math.floor((Math.max(a[0],b[0])+pad)/60);x++)for(let z=Math.floor((Math.min(a[1],b[1])-pad)/60);z<=Math.floor((Math.max(a[1],b[1])+pad)/60);z++){const key=x+','+z;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(s)}}}}
 nearest(x,z,global=false){const list=global?this.segments.filter(s=>s.length>8&&s.width>=3):(this.cells.get(Math.floor(x/60)+','+Math.floor(z/60))||[]);let best=null;for(const s of list){const t=Math.max(0,Math.min(1,((x-s.a[0])*s.dx+(z-s.a[1])*s.dz)/s.length**2)),px=s.a[0]+t*s.dx,pz=s.a[1]+t*s.dz,d=Math.hypot(x-px,z-pz);if(!best||d<best.distance)best={...s,x:px,z:pz,distance:d,t}}return best;}
 /* Things parked on the road. Buildings are polygons and never move; a parked car is a small box that the
    town puts there and may take away again, so it gets its own grid and its own switch. Each car is two
    circles along its axis rather than a box: a box test in the middle of contains() would be felt, and two
    circles are close enough that you cannot drive through a wing mirror.
    Pierce, 2026-09-12: the cars were scenery you drove straight through, which is the difference between a
    place and a backdrop. This is what makes the street actually narrower. */
 setBlockers(list){this.blockers=new Map();this.blockerR=0;
  for(const c of list||[]){const fx=-Math.sin(c.yaw),fz=-Math.cos(c.yaw);
   for(const along of[-1.35,0,1.35]){const x=c.x+fx*along,z=c.z+fz*along,r=1.05;this.blockerR=Math.max(this.blockerR,r);
    const k=Math.floor(x/12)+','+Math.floor(z/12);if(!this.blockers.has(k))this.blockers.set(k,[]);this.blockers.get(k).push({x,z,r});}}
  return this.blockers.size;}
 blockerAt(x,z){if(!this.blockers||!this.blockers.size)return null;const cx=Math.floor(x/12),cz=Math.floor(z/12);let best=null;
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const list=this.blockers.get((cx+i)+','+(cz+j));if(!list)continue;
   for(const b of list){const dx=x-b.x,dz=z-b.z,d=Math.hypot(dx,dz);if(d<b.r&&(!best||b.r-d>best.depth))best={b,d,depth:b.r-d,dx,dz};}}
  return best;}
 blocked(x,z){if(!this.blockers||!this.blockers.size)return false;const cx=Math.floor(x/12),cz=Math.floor(z/12);
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const list=this.blockers.get((cx+i)+','+(cz+j));if(!list)continue;
   for(const b of list){const dx=b.x-x,dz=b.z-z;if(dx*dx+dz*dz<b.r*b.r)return true;}}
  return false;}
 obstructed(x,z){const inside=ring=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit}return hit};return (this.obstacles.get(Math.floor(x/60)+","+Math.floor(z/60))||[]).some(r=>inside(r[0])&&!r.slice(1).some(inside));}
 contains(x,z,margin=.9){if(this.obstructed(x,z)||this.blocked(x,z))return false;const list=this.cells.get(Math.floor(x/60)+','+Math.floor(z/60))||[];for(const s of list){const t=Math.max(0,Math.min(1,((x-s.a[0])*s.dx+(z-s.a[1])*s.dz)/s.length**2)),dx=x-s.a[0]-t*s.dx,dz=z-s.a[1]-t*s.dz;if(Math.hypot(dx,dz)<=Math.max(.6,s.width/2-margin))return true}return false;}
}
export class DrivingState {
 constructor(network){this.network=network;this.performance={top:325/3.6,launch:8.8,power:260};this.x=0;this.z=0;this.yaw=0;this.speed=0;this.steer=0;this.distance=0;this.blocked=false;this.road=null;this.recoveryTime=0;this.recoveryCount=0;this.lastSafe=null;}
 spawn(x,z,preferred=null){const chosen=preferred&&this.network.segments.includes(preferred)?preferred:null;const t0=chosen?Math.max(0,Math.min(1,((x-chosen.a[0])*chosen.dx+(z-chosen.a[1])*chosen.dz)/chosen.length**2)):0;const s=chosen?{...chosen,t:t0}:this.network.nearest(x,z,true);if(!s)throw Error('No road found');const t=Math.max(2.6/s.length,Math.min(1-2.6/s.length,s.t));this.x=s.a[0]+t*s.dx;this.z=s.a[1]+t*s.dz;this.yaw=Math.atan2(-s.dx,-s.dz)+(s.direction===-1?Math.PI:0);
  /* Never start the car facing a wall or the end of the road. A two-way segment runs whichever way
     the source data happened to draw it, so taking its heading blind meant a coin flip, and at the end
     of a street that coin flip pointed off the tarmac. A one-way has only one legal answer and keeps it;
     otherwise look both ways along the road and take whichever has more of it in front of you. */
  if(!s.direction){const ahead=(yaw)=>{const fx=-Math.sin(yaw),fz=-Math.cos(yaw);let d=0;for(;d<60;d+=2){if(!this.network.contains(this.x+fx*(d+2),this.z+fz*(d+2),.1))break;}return d;};  const back=this.yaw+Math.PI;if(ahead(back)>ahead(this.yaw)+2)this.yaw=back;}
  if(!this.fitsAt(this.x,this.z,this.yaw)&&this.fitsAt(this.x,this.z,this.yaw+Math.PI))this.yaw+=Math.PI;
  /* Still nose-to-the-wall? Then it is not the heading that is wrong, it is where the car was put down —
     the very end of a stub. Keep the heading and reverse the car back up its own road until it has room
     to pull away. Better to start a few metres further back than to start unable to move. */
  {const room=()=>{const fx=-Math.sin(this.yaw),fz=-Math.cos(this.yaw);let d=0;
     for(;d<40;d+=2){if(!this.network.contains(this.x+fx*(d+2),this.z+fz*(d+2),.1))break;}return d;};
   const fx=-Math.sin(this.yaw),fz=-Math.cos(this.yaw);let guard=0;
   while(room()<12&&guard++<12){const nx=this.x-fx*2.5,nz=this.z-fz*2.5;
     if(!this.network.contains(nx,nz,.1)||!this.fitsAt(nx,nz,this.yaw))break;this.x=nx;this.z=nz;}
   /* A stub shorter than the car cannot be reversed out of. Rather than leave someone parked in a
      hedge, move to the nearest segment that is actually long enough to drive and take that instead. */
   if(room()<8){const here={x:this.x,z:this.z};const alt=this.network.segments
       .filter(g=>g!==s&&g.length>25&&g.width>=3)
       .map(g=>{const t=Math.max(.2,Math.min(.8,((here.x-g.a[0])*g.dx+(here.z-g.a[1])*g.dz)/g.length**2));
                return{g,t,d:Math.hypot(here.x-g.a[0]-t*g.dx,here.z-g.a[1]-t*g.dz)};})
       .sort((a,b)=>a.d-b.d)[0];
     if(alt&&alt.d<180){const g=alt.g;this.x=g.a[0]+alt.t*g.dx;this.z=g.a[1]+alt.t*g.dz;
       this.yaw=Math.atan2(-g.dx,-g.dz)+(g.direction===-1?Math.PI:0);this.road=g;
       if(!g.direction){const bk=this.yaw+Math.PI;const look=(y)=>{const ax=-Math.sin(y),az=-Math.cos(y);let m=0;
           for(;m<60;m+=2){if(!this.network.contains(this.x+ax*(m+2),this.z+az*(m+2),.1))break;}return m;};
         if(look(bk)>look(this.yaw)+2)this.yaw=bk;}}}}
  if(s.direction===0){const p=lanePoint(s,t);if(this.network.contains(p.x,p.z,.95)){this.x=p.x;this.z=p.z;}}this.speed=0;this.steer=0;this.road=s;this.blocked=false;this.wrongWay=false;return s;}
 fitsAt(x,z,yaw){const fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);for(const l of[-1.1,1.1])for(const w of[-.76,.76])if(!this.network.contains(x+fx*l+rx*w,z+fz*l+rz*w,.1))return false;return true;}
 recover(){const candidates=this.network.segments.filter(s=>s.length>6&&s.width>=3).map(s=>{const t=Math.max(2.5/s.length,Math.min(1-2.5/s.length,((this.x-s.a[0])*s.dx+(this.z-s.a[1])*s.dz)/s.length**2));return{s,t,d:Math.hypot(this.x-s.a[0]-t*s.dx,this.z-s.a[1]-t*s.dz)};}).sort((a,b)=>a.d-b.d);
 for(const {s,t}of candidates.slice(0,100)){const sign=s.direction||((-Math.sin(this.yaw)*s.dx-Math.cos(this.yaw)*s.dz)>=0?1:-1),yaw=Math.atan2(-s.dx*sign,-s.dz*sign);for(const at of[t,.5])for(const offset of[s.direction?0:Math.min(s.width/4,2),0]){const x=s.a[0]+at*s.dx-s.dz/s.length*offset*sign,z=s.a[1]+at*s.dz+s.dx/s.length*offset*sign;if(!this.fitsAt(x,z,yaw))continue;Object.assign(this,{x,z,yaw,speed:0,steer:0,blocked:false,wrongWay:false,road:s,recoveryTime:1.4});this.recoveryCount++;this.lastSafe={x,z,yaw};return true;}}
 if(this.lastSafe){Object.assign(this,this.lastSafe,{speed:0,steer:0,blocked:false,wrongWay:false,recoveryTime:1.4});this.recoveryCount++;return true;}return false;
 }
 step(dt,input){dt=Math.min(.05,Math.max(0,dt));this.recoveryTime=0;this.assisting=false;
 const target=(typeof input.steerAxis==='number')?Math.max(-1,Math.min(1,input.steerAxis)):(input.left?1:0)-(input.right?1:0);this.steer+=(target*.56/(1+Math.abs(this.speed)/20)-this.steer)*Math.min(1,dt*9);
 const p=this.performance;this.speed+=((input.accel?Math.min(p.launch,p.power/Math.max(1,Math.abs(this.speed))):0)-(input.reverse?(this.speed>0?12:3):0))*dt;const drag=(.15+.000335*this.speed*this.speed+(input.brake?12:0))*dt;
 this.speed=Math.abs(this.speed)<=drag?0:this.speed-Math.sign(this.speed)*drag;this.speed=Math.max(-5,Math.min(this.performance.top,this.speed));
 const current=this.network.nearest(this.x,this.z);// wrong way only when every road the car is actually on is a one-way against it (not just the nearest one-way side street at a corner)
 const fx=-Math.sin(this.yaw),fz=-Math.cos(this.yaw),here=(this.network.cells.get(Math.floor(this.x/60)+','+Math.floor(this.z/60))||[]).filter(s=>{const t=Math.max(0,Math.min(1,((this.x-s.a[0])*s.dx+(this.z-s.a[1])*s.dz)/s.length**2));return Math.hypot(this.x-s.a[0]-t*s.dx,this.z-s.a[1]-t*s.dz)<=s.width/2;});this.wrongWay=here.length>0&&here.every(s=>s.direction&&(fx*s.dx+fz*s.dz)*s.direction<-.1);
 let yaw=this.yaw+this.speed/2.65*Math.tan(this.steer)*dt,x=this.x-Math.sin(yaw)*this.speed*dt,z=this.z-Math.cos(yaw)*this.speed*dt;
 if(!this.fitsAt(x,z,yaw)){
  this.assisting=true;
  // Resolve tire penetration against the UNION of road corridors: each tire can
  // occupy either arm of an intersection, rather than snapping to one centerline.
  for(let pass=0;pass<5;pass++){
   let cx=0,cz=0,count=0;const fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);
   for(const l of[-1.1,1.1])for(const w of[-.76,.76]){
    const px=x+fx*l+rx*w,pz=z+fz*l+rz*w;if(this.network.contains(px,pz,.1))continue;
    const hit=this.network.blockerAt(px,pz);
    if(hit){const len=hit.d||.001;cx+=hit.dx/len*hit.depth;cz+=hit.dz/len*hit.depth;count++;continue;}
    const list=this.network.cells.get(Math.floor(px/60)+','+Math.floor(pz/60))||[];let best;
    for(const e of list){const t=Math.max(0,Math.min(1,((px-e.a[0])*e.dx+(pz-e.a[1])*e.dz)/e.length**2)),qx=e.a[0]+t*e.dx,qz=e.a[1]+t*e.dz,d=Math.hypot(qx-px,qz-pz),depth=d-Math.max(.6,e.width/2-.14);if(!best||depth<best.depth)best={qx,qz,d,depth};}
    if(best&&best.depth>0&&best.d>0){cx+=(best.qx-px)/best.d*best.depth;cz+=(best.qz-pz)/best.d*best.depth;count++;}
   }
   if(!count)break;const len=Math.hypot(cx,cz),limit=Math.min(1,(dt*3)/(len||1));x+=cx*limit;z+=cz*limit;
  }
  // Turn gently along the edge while retaining the player's steering and speed.
  const edge=this.network.nearest(x,z)||current;if(edge){const heading=Math.atan2(-edge.dx,-edge.dz),d=a=>Math.atan2(Math.sin(a-yaw),Math.cos(a-yaw));const turn=Math.abs(d(heading))<Math.abs(d(heading+Math.PI))?d(heading):d(heading+Math.PI);yaw+=turn*Math.min(.18,dt*2.5);}
  // Building contact slides along a free axis. No respawn or steering lock.
  if(!this.fitsAt(x,z,yaw)){
   const candidates=[[x,this.z,yaw],[this.x,z,yaw],[this.x,this.z,yaw],[this.x,this.z,this.yaw]];
   const safe=candidates.find(([a,b,c])=>this.fitsAt(a,b,c));
   if(safe){[x,z,yaw]=safe;this.speed*=Math.exp(-dt*1.5);}else{
    // An externally placed car outside the corridor approaches the nearest road
    // continuously; the explicit Reset button remains the only teleport.
    const near=this.network.nearest(this.x,this.z,true);if(near&&!this.network.obstructed(x,z)){const d=Math.hypot(near.x-this.x,near.z-this.z),k=Math.min(1,dt*2.5/(d||1));x=this.x+(near.x-this.x)*k;z=this.z+(near.z-this.z)*k;}else{x=this.x;z=this.z;this.speed*=Math.exp(-dt*5);}
   }
  }
 }
 /* If the car did not actually go where its speed said it would, its speed is a lie. Until now nothing
    reconciled the two: a car pinned against something kept reading 5.7 m/s with the odometer frozen,
    which is what stopped the beach loop from ever finishing - the errand needs the car within the
    radius AND under 1.6 m/s, and it was sitting still at the beach reporting that it was not. Drive
    into a parked car and you stop, which is also what happens outside. */
 {const moved=Math.hypot(x-this.x,z-this.z),wanted=Math.abs(this.speed)*dt;
  if(wanted>.02&&moved<wanted*.4)this.speed*=Math.max(0,moved/wanted);}
 this.distance+=Math.hypot(x-this.x,z-this.z);this.x=x;this.z=z;this.yaw=yaw;this.blocked=false;
 if(this.fitsAt(x,z,yaw))this.lastSafe={x,z,yaw};this.road=this.network.nearest(x,z);return this;
 }

}
