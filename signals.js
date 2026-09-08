import {Junctions} from './junctions.js';
// Traffic signals that actually cycle. Winthrop's lights are not published as a timing plan, so this is a standard
// two-phase plan per junction: the busier axis gets the longer green. Every car and the auto-driver obey it.
// OSM maps one signal node per approach, a few metres before the corner; those are grouped onto the road-graph
// corner they guard, so one clock and one plan run all the heads at a junction, and the node on each approach
// marks its stop line. The system keeps its own clock (tick) so the lamps, the AI cars and the auto-driver all
// read the same colour at the same moment.
export class SignalSystem{
 constructor(signals,network,{mainGreen=26,crossGreen=16,yellow=3.5,allRed=1.5}={}){this.nodes=[];this.time=0;this.timing={mainGreen,crossGreen,yellow,allRed};this.cycle=mainGreen+crossGreen+2*(yellow+allRed);
  const J=new Junctions(network),degree=v=>v.segs.filter(s=>s.length>=5).length,inTown=signals.filter(sg=>J.nearestVertex(sg.x,sg.z,32,3));
  // group the mapped nodes onto the corner they guard: the busiest corner within reach, and corners that are really
  // one intersection split into pieces (within 30 m of each other, or a second corner within 12 m) become one node
  const groups=[];for(const sg of inTown){let best=null;for(const v of J.verts){const d=Math.hypot(v.x-sg.x,v.z-sg.z);if(d>=32||degree(v)<3)continue;const score=degree(v)*40-d;if(!best||score>best.score)best={v,score};}
   let g=groups.find(g=>g.verts.some(v=>Math.hypot(v.x-best.v.x,v.z-best.v.z)<30));if(!g){g={verts:[],signals:[]};groups.push(g);}if(!g.verts.includes(best.v))g.verts.push(best.v);g.signals.push(sg);}
  for(let a=0;a<groups.length;a++)for(let b=groups.length-1;b>a;b--){if(groups[a].verts.some(u=>groups[b].verts.some(v=>Math.hypot(u.x-v.x,u.z-v.z)<30))){groups[a].verts.push(...groups[b].verts.filter(v=>!groups[a].verts.includes(v)));groups[a].signals.push(...groups[b].signals);groups.splice(b,1);}}
  for(const g of groups)for(const v of J.verts){if(degree(v)<3||g.verts.includes(v))continue;if(g.verts.some(u=>Math.hypot(u.x-v.x,u.z-v.z)<12))g.verts.push(v);}
  let i=0;for(const g of groups){const approaches=[],internal=(x,z)=>g.verts.some(u=>Math.hypot(u.x-x,u.z-z)<1.5);
   for(const v of g.verts)for(const s of v.segs){const atA=Math.hypot(s.a[0]-v.x,s.a[1]-v.z)<1.5,far=atA?s.b:s.a;if(internal(far[0],far[1]))continue;let dx=far[0]-v.x,dz=far[1]-v.z;const L=Math.hypot(dx,dz);if(L<3)continue;dx/=L;dz/=L;
    const inbound=s.direction===0||s.direction===null||s.direction===undefined||(s.direction===1?!atA:atA);if(!inbound)continue;// nothing arrives along a one-way leading away
    let line=null;for(const sg of g.signals){const ax=sg.x-v.x,az=sg.z-v.z,along=ax*dx+az*dz,across=Math.abs(ax*dz-az*dx);if(along>3&&along<32&&across<s.width/2+3&&(line===null||along<line))line=along;}
    const cross=Math.max(...v.segs.filter(o=>o!==s).map(o=>o.width||6));if(line===null)line=Math.min(12,Math.max(4,cross/2+3));
    approaches.push({hx:-dx,hz:-dz,dx,dz,width:s.width||6,cross,speed:s.speed||0,name:s.name,line,vx:v.x,vz:v.z,x:v.x+dx*line,z:v.z+dz*line});}
   if(approaches.length<2)continue;// axis 0 = the widest approach (then the faster) and the one facing it; every other approach is the cross phase
   const main=approaches.reduce((a,b)=>b.width>a.width||(b.width===a.width&&b.speed>a.speed)?b:a);for(const a of approaches)a.axis=a===main||a.hx*main.hx+a.hz*main.hz<-.5?0:1;
   if(!approaches.some(a=>a.axis===1))for(const a of approaches)if(a!==main&&Math.abs(a.hx*main.hx+a.hz*main.hz)<.9)a.axis=1;
   const cx=g.verts.reduce((n,v)=>n+v.x,0)/g.verts.length,cz=g.verts.reduce((n,v)=>n+v.z,0)/g.verts.length;
   this.nodes.push({x:cx,z:cz,verts:g.verts.map(v=>({x:v.x,z:v.z})),approaches,offset:(i*7919)%this.cycle,mainAxis:0,ids:g.signals.map(s=>s.id)});i++;}
 }
 tick(dt){this.time+=Math.max(0,dt);}
 // 'green' | 'yellow' | 'red' for an approach axis at a node
 state(node,axis,time=this.time){const {mainGreen,crossGreen,yellow,allRed}=this.timing;let t=(time+node.offset)%this.cycle;
  if(axis===0){if(t<mainGreen)return 'green';if(t<mainGreen+yellow)return 'yellow';return 'red';}
  t-=mainGreen+yellow+allRed;if(t<0)return 'red';if(t<crossGreen)return 'green';if(t<crossGreen+yellow)return 'yellow';return 'red';}
 approachFor(node,hx,hz,x,z){let best=null;for(const a of node.approaches){const d=a.hx*hx+a.hz*hz-(x!==undefined&&Math.hypot(a.vx-x,a.vz-z)>1.5?.6:0);if(!best||d>best.d)best={d,a};}return best&&best.d>.5?best.a:null;}
 axisFor(node,hx,hz){const a=this.approachFor(node,hx,hz);return a?a.axis:0;}
 near(x,z,r=4){let best=null;for(const n of this.nodes)for(const v of n.verts){const d=Math.hypot(v.x-x,v.z-z);if(d<r&&(!best||d<best.d))best={n,d};}return best&&best.n;}
 // What a driver heading (hx,hz) toward the corner at (x,z) sees, and how far before the corner the stop line is
 lightAhead(x,z,hx,hz,time=this.time,r=4){const n=this.near(x,z,r);if(!n)return null;const a=this.approachFor(n,hx,hz,x,z);if(!a)return null;return {node:n,approach:a,state:this.state(n,a.axis,time),line:a.line};}
}
