// The road graph's corners, shared by the auto-driver, the AI traffic and the signals: which arms meet at the end of
// an edge (left, right, straight, back), where the stop line sits before the corner, and whether a mapped stop sign
// applies to a given direction of travel. One rule set, so every vehicle reads the same junction the same way.
// The posted limit of a road piece, in m/s: the mapped speed, else 25 mph for a wide street and 20 for a narrow one.
const MPH=.44704;export function speedLimit(e){const mph=e.speed>0?e.speed:e.width>=9?25:20;return Math.min(30,mph)*MPH;}
export class Junctions{
 constructor(network){this.map=new Map();this.verts=[];const key=(x,z)=>Math.round(x/2)+','+Math.round(z/2);
  for(const s of network.segments)for(const p of[s.a,s.b]){let v=this.find(p[0],p[1],1.5);if(!v){v={x:p[0],z:p[1],segs:[]};this.verts.push(v);const k=key(p[0],p[1]);if(!this.map.has(k))this.map.set(k,[]);this.map.get(k).push(v);}if(!v.segs.includes(s))v.segs.push(s);}}
 find(x,z,r=1.5){let best=null;const cx=Math.round(x/2),cz=Math.round(z/2);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const v of this.map.get((cx+i)+','+(cz+j))||[]){const d=Math.hypot(v.x-x,v.z-z);if(d<r&&(!best||d<best.d))best={v,d};}return best&&best.v;}
 nearestVertex(x,z,r=32,minDegree=3){let best=null;for(const v of this.verts){if(v.segs.length<minDegree)continue;const d=Math.hypot(v.x-x,v.z-z);if(d<r&&(!best||d<best.d))best={v,d};}return best&&best.v;}
 // Arms at the corner a directed edge arrives at, seen from that edge: side is 'left' | 'right' | 'straight' | 'back',
 // inbound says whether traffic can arrive at the corner along that arm (one-way arms leading away cannot bring any).
 arms(e){const v=this.find(e.b[0],e.b[1],1.5);if(!v)return[];const n=Math.hypot(e.dx,e.dz)||1,fx=e.dx/n,fz=e.dz/n,out=[];
  for(const s of v.segs){const atA=Math.hypot(s.a[0]-v.x,s.a[1]-v.z)<1.5,far=atA?s.b:s.a;let dx=far[0]-v.x,dz=far[1]-v.z;const L=Math.hypot(dx,dz);if(L<1)continue;dx/=L;dz/=L;
   const dot=dx*fx+dz*fz,cross=fx*dz-fz*dx;const side=dot<-.8?'back':dot>.75?'straight':cross>0?'right':'left';
   const inbound=s.direction===0||s.direction===null||s.direction===undefined||(s.direction===1?!atA:atA);
   out.push({seg:s,dx,dz,length:L,width:s.width,side,inbound,outbound:s.direction===0||s.direction===null||s.direction===undefined||(s.direction===1?atA:!atA)});}
  return out;}
 // Where to stop before the corner: clear of the widest crossing arm, never inside the intersection.
 stopLine(e,arms=this.arms(e)){const cross=arms.filter(a=>a.side!=='back');if(!cross.length)return 3;return Math.min(10,Math.max(3.5,Math.max(...cross.map(a=>a.width))/2+1.5));}
 // The stop line for a mapped stop sign: the sign's own position when it sits a sensible distance before the corner.
 stopLineFor(e,sign){const line=this.stopLine(e);if(!sign)return line;const d=e.length-sign.along;return d>=3&&d<=14?Math.max(line,d):line;}
 // The first controlled corner ahead - a stop sign or a working signal - walking straight on through short edges
 // (roads are split into pieces at every bend and side street, so the corner is often not the end of this edge).
 // chooser(edge) names the edge that follows. Returns the corner's edge, the chain of edges to it, the distance from
 // the car to the corner, the stop line before it, and the light (if any).
 lookAhead(e,t,chooser,lights,stops,maxDist=60){let dist=(1-t)*e.length,cur=e;const chain=[e];
  for(let k=0;k<8;k++){const sign=this.stopSign(cur,0,stops),l=lights&&lights.lightAhead(cur.b[0],cur.b[1],cur.dx/cur.length,cur.dz/cur.length,undefined,4);
   if(sign||l)return {edge:cur,chain,dist,kind:l?'signal':'stop',light:l,sign:sign&&sign.sign,line:l?Math.max(l.line,this.stopLine(cur)):this.stopLineFor(cur,sign)};
   if(dist>maxDist)return null;const n=chooser(cur);if(!n)return null;if((n.dx*cur.dx+n.dz*cur.dz)/(n.length*cur.length)<.8)return null;chain.push(n);dist+=n.length;cur=n;}
  return null;}
 // A mapped stop sign on this approach, honouring OSM's forward/backward tag against the edge's travel direction.
 stopSign(e,t,stops){const along=p=>((p.x-e.a[0])*e.dx+(p.z-e.a[1])*e.dz)/e.length,across=p=>Math.abs((p.x-e.a[0])*e.dz-(p.z-e.a[1])*e.dx)/e.length;let best=null;
  for(const s of stops){const d=s.tags&&s.tags.direction;if(d==='forward'&&e.reversed)continue;if(d==='backward'&&!e.reversed)continue;
   const a=along(s);if(across(s)<4.5&&a>t*e.length-2&&a<e.length+3&&Math.hypot(s.x-e.b[0],s.z-e.b[1])<24&&(!best||a>best.along))best={sign:s,along:a};}
  return best;}
}
