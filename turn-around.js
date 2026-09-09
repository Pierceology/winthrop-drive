import {lanePoint,laneOffset} from './lane-position.js';

// "Turn around" — the car does the manoeuvre itself, and does it the way the rules of the road say.
// It plans before it moves: swing left across the centreline at full lock, and if the street is too narrow
// to come round in one, shuttle forward-left / reverse-right / forward-left until the nose points back the
// way it came. Every pose in the plan is checked with all four tyres against the mapped roadway and against
// the buildings, so the car never mounts a kerb, clips a corner or brushes a pole standing at the kerbside.
// It finishes in the OTHER lane, facing the other way, exactly where the auto-driver would have put it.
// One-way streets get a refusal with a note instead of a manoeuvre: turning there would be driving the
// wrong way, and no button is worth that.

const STEP=.16;            // metres per planning sample
const RADIUS=[6.4,5.2,4.3];// try the widest sweep first; the tightest is the car's own full lock
const MAX_LEG=26;          // no single leg longer than this
const MAX_LEGS=7;          // three-point, five-point, seven-point — then give up
const SPEED=2.6;           // m/s while manoeuvring, about walking pace for a car

export class TurnAround{
 constructor(network){this.network=network;this.plan=null;this.note='';this.noteAt=-99;this.clock=0;this.cells=new Map();}
 // Poles, signs, hydrants, lamps and bus-stop flags, in a 20 m grid. They stand at the kerb, but the
 // manoeuvre swings wide, so it is asked about every one of them before it commits.
 // Each one goes into its own cell and its eight neighbours, so a single lookup on the car's centre
 // finds everything that could reach the bodywork.
 setObstacles(list){this.cells=new Map();
  for(const o of list||[]){const ci=Math.floor(o.x/20),cj=Math.floor(o.z/20);
   for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const c=(ci+i)+','+(cj+j);
    if(!this.cells.has(c))this.cells.set(c,[]);this.cells.get(c).push(o);}}
  this.obstacleCount=(list||[]).length;}
 hitsFurniture(x,z,yaw){
  const near=this.cells.get(Math.floor(x/20)+','+Math.floor(z/20));if(!near)return false;
  const fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);
  for(const o of near){const dx=o.x-x,dz=o.z-z,r=o.r||.28;
   if(Math.abs(dx*fx+dz*fz)<1.35+r&&Math.abs(dx*rx+dz*rz)<.88+r)return true;}
  return false;}
 get active(){return !!this.plan;}
 // Is a turn-around legal and possible here? Returns true when a plan was made.
 start(state,clock=0){
  this.clock=clock;this.plan=null;
  const here=this.network.nearest(state.x,state.z);
  if(!here){this.refuse('No mapped road under the car');return false;}
  if(here.direction){this.refuse('One way · no turning here');return false;}
  const target=this.targetPose(state,here);
  let best=null;
  for(const R of RADIUS){
   const poses=this.shuttle(state,R,target);
   if(poses&&(!best||poses.legs<best.legs))best={poses:poses.path,legs:poses.legs,R};
   if(best&&best.legs===1)break;                     // a clean single arc: nothing beats it
  }
  if(!best){this.refuse('Not enough room · find a wider stretch');return false;}
  this.plan={path:best.poses,i:0,legs:best.legs,travelled:0,arc:best.legs===1};
  this.note=best.legs===1?'Turning around':'Turning around · three-point';
  this.noteAt=clock;
  return true;
 }
 refuse(text){this.plan=null;this.note=text;this.noteAt=this.clock;}
 stop(){this.plan=null;}
 // Where the car should end: the opposite lane of this piece of road, facing back.
 targetPose(state,seg){
  const t=Math.max(0,Math.min(1,((state.x-seg.a[0])*seg.dx+(state.z-seg.a[1])*seg.dz)/seg.length**2));
  const back={...seg,a:seg.b,b:seg.a,dx:-seg.dx,dz:-seg.dz},p=lanePoint(back,1-t);
  return {x:p.x,z:p.z,yaw:Math.atan2(-back.dx,-back.dz),lane:laneOffset(back)};
 }
 fits(state,x,z,yaw){return state.fitsAt(x,z,yaw)&&!this.hitsFurniture(x,z,yaw);}
 // Forward-left, reverse-right, forward-left … each leg runs until the next sample would not fit.
 // Heading turns the same way on every leg — that is what makes it a turn and not a wiggle.
 shuttle(state,R,target){
  let x=state.x,z=state.z,yaw=state.yaw,turned=0,gear=1,legs=0;
  const path=[];
  if(!this.fits(state,x,z,yaw))return null;
  while(turned<Math.PI-.02&&legs<MAX_LEGS){
   let moved=0,any=0;
   while(moved<MAX_LEG&&turned<Math.PI-.02){
    const dyaw=Math.min(STEP/R,Math.PI-turned);
    const ny=yaw+dyaw,nx=x-Math.sin(ny)*STEP*gear,nz=z-Math.cos(ny)*STEP*gear;
    if(!this.fits(state,nx,nz,ny))break;
    x=nx;z=nz;yaw=ny;turned+=dyaw;moved+=STEP;any++;
    path.push({x,z,yaw,gear});
   }
   legs++;
   if(turned>=Math.PI-.02)break;
   if(!any)return null;                     // stuck: this radius cannot get round here
   gear=-gear;
  }
  if(turned<Math.PI-.02)return null;
  // settle into the opposite lane: a short, checked glide onto the pose the auto-driver would use
  const settle=[];
  for(let k=1;k<=14;k++){
   const f=k/14,sx=x+(target.x-x)*f,sz=z+(target.z-z)*f;
   const d=Math.atan2(Math.sin(target.yaw-yaw),Math.cos(target.yaw-yaw)),sy=yaw+d*f;
   if(!this.fits(state,sx,sz,sy))return {path,legs};   // cannot glide over: stay where we stopped, still legal
   settle.push({x:sx,z:sz,yaw:sy,gear:1});
  }
  return {path:path.concat(settle),legs};
 }
 // Drive the plan: ease in and out of every leg, pause a beat at each change of gear.
 update(dt,state){
  if(!this.plan)return false;
  this.clock+=dt;
  const p=this.plan,path=p.path;
  if(p.hold>0){p.hold-=dt;state.speed=0;state.steer=0;return true;}
  const gear=path[p.i].gear;
  let ahead=0;while(p.i+ahead<path.length&&path[p.i+ahead].gear===gear)ahead++;
  const ease=Math.min(1,ahead/9)*Math.min(1,(p.i+2)/6);       // slow into and out of every leg
  const v=SPEED*Math.max(.3,ease);
  p.frac=(p.frac||0)+v*dt/STEP;
  while(p.frac>=1&&p.i<path.length-1&&path[p.i+1].gear===gear){p.i++;p.frac-=1;state.distance+=STEP;}
  const a=path[p.i],b=path[Math.min(path.length-1,p.i+1)],f=b.gear===gear?Math.min(1,p.frac):0;
  state.x=a.x+(b.x-a.x)*f;state.z=a.z+(b.z-a.z)*f;
  state.yaw=a.yaw+Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw))*f;
  state.speed=gear>0?v:-v;
  state.steer=gear>0?.5:-.5;
  state.blocked=false;state.wrongWay=false;state.assisting=false;
  state.road=this.network.nearest(state.x,state.z);
  if(p.i>=path.length-1){this.plan=null;state.speed=0;state.steer=0;this.note='';return false;}
  if(path[p.i+1].gear!==gear){p.i++;p.frac=0;p.hold=.5;state.speed=0;}   // stop, change gear, go again
  return true;
 }
}
