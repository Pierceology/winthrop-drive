import * as THREE from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

// The town's designed ground: the real tennis and basketball courts, ball fields, playing turf, parks,
// playgrounds, pools, beaches and the golf holes, from OpenStreetMap (data/surfaces.json), laid a few
// centimetres over the aerial photograph so they read as surfaces someone laid out rather than a blur.
// Every ring is OSM's own outline. Triangles that fall on water, or on the mapped roadway, are dropped:
// the photograph keeps showing through everywhere we have nothing better to say.

// colour, how much the procedural grain moves it (fine, coarse), and how far above the photo it sits
const KIND={
 water    :{c:'#2a6480',o:.60,g:[.06,.06],y:.03},
 marsh    :{c:'#5b6b41',o:.34,g:[.34,.44],y:.03},
 park     :{c:'#4f7135',o:.36,g:[.38,.46],y:.04},
 grass    :{c:'#547537',o:.36,g:[.38,.46],y:.04},
 scrub    :{c:'#4b5d33',o:.38,g:[.44,.52],y:.04},
 rough    :{c:'#4a6330',o:.42,g:[.40,.48],y:.05},
 fairway  :{c:'#61873a',o:.52,g:[.22,.30],y:.05},
 garden   :{c:'#56763a',o:.40,g:[.36,.44],y:.05},
 sand     :{c:'#cdb488',o:.40,g:[.24,.20],y:.04},
 bunker   :{c:'#e2d5ac',o:.62,g:[.18,.14],y:.07},
 tee      :{c:'#679040',o:.58,g:[.16,.20],y:.07},
 green    :{c:'#75a052',o:.66,g:[.10,.12],y:.07},
 turf     :{c:'#4c7433',o:.50,g:[.20,.26],y:.07},
 playground:{c:'#8a5f45',o:.44,g:[.26,.22],y:.08},
 skatepark:{c:'#75797e',o:.62,g:[.16,.12],y:.08},
 track    :{c:'#a44e37',o:.70,g:[.14,.12],y:.08},
 pool     :{c:'#2f97c4',o:.70,g:[.05,.05],y:.08},
 court    :{c:'#4d545c',o:.66,g:[.13,.11],y:.11},
 rink     :{c:'#2f6a92',o:.62,g:[.09,.08],y:.11},   /* street and roller hockey: a painted hard surface */
 baseball :{c:'#4e7433',o:.46,g:[.24,.30],y:.06},
 basketball:{c:'#4b525b',o:.72,g:[.13,.11],y:.11},
 tennis   :{c:'#337261',o:.74,g:[.10,.10],y:.11},
 infield  :{c:'#a87a52',o:.74,g:[.26,.22],y:.10},
 mound    :{c:'#b7855c',o:.78,g:[.22,.18],y:.13},
 chalk    :{c:'#f2efe6',o:.88,g:[.05,.05],y:.14},
};
const MAX_EDGE=8, MAX_EDGE_LOW=18;
// the broad grounds: a park does not get painted over the pitch, pool or playground mapped inside it
const BROAD=new Set(['water','marsh','park','grass','scrub','rough','garden','sand','fairway','baseball']);

// every specific surface, in a 40 m grid, so a broad triangle can ask "is something better already here?"
class Cutouts{
 constructor(records){this.cell=40;this.grid=new Map();
  for(const r of records){if(BROAD.has(r.k))continue;
   let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of r.r){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);}
   for(let i=Math.floor(x0/this.cell);i<=Math.floor(x1/this.cell);i++)for(let j=Math.floor(z0/this.cell);j<=Math.floor(z1/this.cell);j++){
    const k=i+','+j;if(!this.grid.has(k))this.grid.set(k,[]);this.grid.get(k).push(r.r);}}}
 covers(x,z){for(const ring of this.grid.get(Math.floor(x/this.cell)+','+Math.floor(z/this.cell))||[])if(inside(ring,x,z))return true;return false;}
}

// a tileable value-noise sheet: a is clumps, g is coarse blotches — enough to break up a flat colour
function grainTexture(){
 const N=128,d=new Uint8Array(N*N*4),lat=(p,seed)=>{const g=new Float32Array(p*p);let s=seed;for(let i=0;i<p*p;i++){s=(s*1664525+1013904223)>>>0;g[i]=(s>>>8)/16777216;}
  return(x,y)=>{const fx=x*p/N,fy=y*p/N,i=Math.floor(fx),j=Math.floor(fy),a=fx-i,b=fy-j,sm=t=>t*t*(3-2*t),u=sm(a),v=sm(b),h=(di,dj)=>g[((j+dj)%p)*p+(i+di)%p];
   return h(0,0)*(1-u)*(1-v)+h(1,0)*u*(1-v)+h(0,1)*(1-u)*v+h(1,1)*u*v;};};
 const f=lat(64,21),m=lat(16,33),c=lat(8,47),k=lat(32,59);
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){const o=(y*N+x)*4;d[o]=255*f(x,y);d[o+1]=255*(.6*c(x,y)+.4*m(x,y));d[o+2]=255*m(x,y);d[o+3]=255*(.65*k(x,y)+.35*f(x,y));}
 const t=new THREE.DataTexture(d,N,N);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;}

// one material for every natural surface: colour comes from the vertex, the grain amount comes with it
function surfaceMaterial(grain){
 // Transparent on purpose: the designed colour is a wash over the aerial photograph, so the mown stripes,
 // worn paths and shadows the camera saw still come through under it. Hard surfaces carry a heavier wash.
 const m=new THREE.MeshStandardMaterial({vertexColors:true,transparent:true,depthWrite:false,roughness:1,metalness:0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-3});
 m.onBeforeCompile=s=>{
  s.uniforms.playGrain={value:grain};
  s.vertexShader='attribute vec2 grain;varying vec2 vGrain;varying vec3 vGround;\n'+s.vertexShader
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvGrain=grain;vGround=(modelMatrix*vec4(position,1.)).xyz;');
  s.fragmentShader='uniform sampler2D playGrain;varying vec2 vGrain;varying vec3 vGround;\n'+s.fragmentShader
   .replace('#include <color_fragment>',`#include <color_fragment>
   {vec4 nF=texture2D(playGrain,vGround.xz*.9),nM=texture2D(playGrain,vGround.xz*.21+vec2(.31,.63)),nC=texture2D(playGrain,vGround.xz*.055);
    float fine=(nF.a-.5)*.75+(nF.r-.5)*.35,coarse=(nM.g-.5)*.8+(nC.b-.5)*.6;
    diffuseColor.rgb*=1.+fine*vGrain.x+coarse*vGrain.y;}`);
 };
 m.customProgramCacheKey=()=>'play-surface';
 return m;}

// ---------- geometry helpers ----------
function ringArea(r){let s=0;for(let i=0,j=r.length-1;i<r.length;j=i++)s+=r[j][0]*r[i][1]-r[i][0]*r[j][1];return s/2;}
// how far a ray from (x,z) travels before it leaves the ring
function exitDistance(r,x,z,dx,dz,cap){
 let best=cap;
 for(let i=0,j=r.length-1;i<r.length;j=i++){
  const ax=r[j][0],az=r[j][1],ex=r[i][0]-ax,ez=r[i][1]-az,den=dx*ez-dz*ex;
  if(Math.abs(den)<1e-9)continue;
  const t=((ax-x)*ez-(az-z)*ex)/den,u=((ax-x)*dz-(az-z)*dx)/den;
  if(t>.5&&t<best&&u>=0&&u<=1)best=t;}
 return best;}
function inside(r,x,z){let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}

// split until no edge is longer than `max`, so the surface follows the ground and the masks bite finely
function tessellate(tri,max,out){
 const [a,b,c]=tri,e=[[a,b,Math.hypot(a[0]-b[0],a[1]-b[1])],[b,c,Math.hypot(b[0]-c[0],b[1]-c[1])],[c,a,Math.hypot(c[0]-a[0],c[1]-a[1])]];
 e.sort((p,q)=>q[2]-p[2]);
 if(e[0][2]<=max||out.length>60000){out.push(tri);return;}
 const [p,q]=e[0],m=[(p[0]+q[0])/2,(p[1]+q[1])/2],third=[a,b,c].find(v=>v!==p&&v!==q);
 tessellate([p,m,third],max,out);tessellate([m,q,third],max,out);
}

class Builder{
 constructor(o){Object.assign(this,o);this.pos=[];this.col=[];this.grn=[];this.dropped=0;this.tris=0;this.cutouts=null;}
 // one flat polygon, tessellated, masked and lifted
 polygon(ring,style,{mask=true,cutouts=null}={}){
  this.cutouts=cutouts;
  const r=ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1]?ring.slice(0,-1):ring;
  if(r.length<3)return;
  const contour=(ringArea(r)<0?[...r].reverse():r).map(p=>new THREE.Vector2(p[0],p[1]));
  let faces;try{faces=THREE.ShapeUtils.triangulateShape(contour,[]);}catch(e){return;}
  const pts=contour.map(v=>[v.x,v.y]),fine=[];
  for(const f of faces)tessellate([pts[f[0]],pts[f[1]],pts[f[2]]],this.maxEdge,fine);
  for(const t of fine)this.triangle(t,style,mask);
  this.cutouts=null;
 }
 triangle(t,style,mask=true){
  const cx=(t[0][0]+t[1][0]+t[2][0])/3,cz=(t[0][1]+t[1][1]+t[2][1])/3;
  // nothing over the sea, the roadway or a roof — and no broad ground over a surface mapped inside it
  if(mask&&(!this.onLand(cx,cz)||this.onRoad(cx,cz)||this.onBuilding(cx,cz))){this.dropped++;return;}
  if(this.cutouts&&this.cutouts.covers(cx,cz)){this.dropped++;return;}
  // z runs south on screen, so a ring that reads anticlockwise on the map faces DOWN in three's frame:
  // every triangle is wound the one way that leaves its normal pointing at the sky.
  const twice=(t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[2][0]-t[0][0])*(t[1][1]-t[0][1]);
  if(Math.abs(twice)<1e-7){this.dropped++;return;}
  const v=twice>0?[t[0],t[2],t[1]]:t;
  const s=KIND[style]||KIND.grass,c=new THREE.Color(s.c);
  for(const p of v){this.pos.push(p[0],this.heightAt(p[0],p[1])+s.y,p[1]);this.col.push(c.r,c.g,c.b,s.o);this.grn.push(s.g[0],s.g[1]);}
  this.tris++;
 }
 // a rectangle given centre, along-vector and half sizes — the workhorse for lines, bases and paths
 quad(cx,cz,ux,uz,halfL,halfW,style,mask=true){
  const vx=-uz,vz=ux,p=(a,b)=>[cx+ux*a+vx*b,cz+uz*a+vz*b];
  const c=[p(-halfL,-halfW),p(halfL,-halfW),p(halfL,halfW),p(-halfL,halfW)];
  this.triangle([c[0],c[1],c[2]],style,mask);this.triangle([c[0],c[2],c[3]],style,mask);
 }
 disc(cx,cz,r,style,steps=18,mask=true){
  for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2,b=(i+1)/steps*Math.PI*2;
   this.triangle([[cx,cz],[cx+Math.cos(a)*r,cz+Math.sin(a)*r],[cx+Math.cos(b)*r,cz+Math.sin(b)*r]],style,mask);}
 }
 geometry(){
  if(!this.tris)return null;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(this.col,4));
  g.setAttribute('grain',new THREE.Float32BufferAttribute(this.grn,2));
  g.computeVertexNormals();g.computeBoundingSphere();return g;
 }
}

// ---------- painted markings ----------
function courtTexture(kind){
 const W=1024,H=kind==='tennis'?Math.round(W*10.97/23.77):Math.round(W*15/28),c=document.createElement('canvas');
 c.width=W;c.height=H;const ctx=c.getContext('2d');ctx.clearRect(0,0,W,H);
 ctx.strokeStyle='rgba(248,248,244,.94)';ctx.lineCap='butt';
 if(kind==='tennis'){
  const s=W/23.77,line=Math.max(2,.06*s),half=H/2;
  ctx.lineWidth=line;
  ctx.strokeRect(line/2,line/2,W-line,H-line);                                   // doubles court
  const alley=1.37*s;
  ctx.beginPath();ctx.moveTo(0,alley);ctx.lineTo(W,alley);ctx.moveTo(0,H-alley);ctx.lineTo(W,H-alley);ctx.stroke();  // singles sidelines
  const svc=6.40*s,mid=W/2;
  ctx.beginPath();ctx.moveTo(mid-svc,alley);ctx.lineTo(mid-svc,H-alley);ctx.moveTo(mid+svc,alley);ctx.lineTo(mid+svc,H-alley);
  ctx.moveTo(mid-svc,half);ctx.lineTo(mid+svc,half);ctx.stroke();                // service lines and centre service line
  ctx.beginPath();ctx.moveTo(line,half);ctx.lineTo(line+.3*s,half);ctx.moveTo(W-line,half);ctx.lineTo(W-line-.3*s,half);ctx.stroke();
  ctx.strokeStyle='rgba(248,248,244,.5)';ctx.lineWidth=Math.max(1.5,.04*s);
  ctx.beginPath();ctx.moveTo(mid,0);ctx.lineTo(mid,H);ctx.stroke();              // the net line, under the net mesh
 }else{
  const s=W/28,line=Math.max(2,.05*s);ctx.lineWidth=line;
  ctx.strokeRect(line/2,line/2,W-line,H-line);
  ctx.beginPath();ctx.moveTo(W/2,0);ctx.lineTo(W/2,H);ctx.stroke();              // half-way line
  ctx.beginPath();ctx.arc(W/2,H/2,1.8*s,0,Math.PI*2);ctx.stroke();               // centre circle
  for(const side of[0,1]){
   const x0=side?W:0,dir=side?-1:1,key=5.8*s,keyW=4.9*s;
   ctx.strokeRect(side?W-key:0,H/2-keyW/2,key,keyW);                             // the key
   ctx.beginPath();ctx.arc(x0+dir*key,H/2,1.8*s,0,Math.PI*2);ctx.stroke();       // free-throw circle
   const hoop=x0+dir*1.575*s,inset=.9*s;                                         // three-point line
   ctx.beginPath();ctx.moveTo(x0,inset);ctx.lineTo(x0+dir*2.99*s,inset);
   ctx.arc(hoop,H/2,6.75*s,dir>0?-Math.acos(.42):Math.PI+Math.acos(.42),dir>0?Math.acos(.42):Math.PI-Math.acos(.42),dir<0);
   ctx.lineTo(x0,H-inset);ctx.stroke();
  }
 }
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;t.needsUpdate=true;return t;
}

// how many standard courts a mapped block holds: courts pack side by side, but need run-off end to end
function courtGrid(L,W,cl,cw){
 const cols=Math.max(1,Math.floor(L/(cl+.4))),rows=Math.max(1,Math.floor(W/cw));
 return {cols,rows,cl:Math.min(cl,L/cols-.4),cw:Math.min(cw,W/rows-.15)};
}

export async function playSurfaces(data,heightAt,onLand,onRoad,onBuilding,lowMemory=false){
 const group=new THREE.Group();group.name='playSurfaces';
 const records=(data.surfaces||[]).filter(r=>!lowMemory||r.a>=2500);
 const maxEdge=lowMemory?MAX_EDGE_LOW:MAX_EDGE;
 const build=new Builder({heightAt,onLand,onRoad,onBuilding,maxEdge});
 const cutouts=new Cutouts(records);
 const courts={tennis:[],basketball:[]},nets=[],hoops=[];
 const counts={};

 for(const r of records){
  const kind=KIND[r.k]?r.k:'grass';counts[r.k]=(counts[r.k]||0)+1;
  build.polygon(r.r,kind,{cutouts:BROAD.has(r.k)?cutouts:null});
  if(r.k==='baseball'&&r.h)ballField(build,r,lowMemory);
  if(!lowMemory&&(r.k==='tennis'||r.k==='basketball')&&r.b)courts[r.k].push(...courtCells(r.b,r.k));
 }
 // the painted lines, one merged mesh per game
 for(const [kind,cells] of Object.entries(courts)){
  if(!cells.length)continue;
  const parts=cells.map(c=>{const g=new THREE.PlaneGeometry(c.l,c.w);g.rotateX(-Math.PI/2);g.rotateY(-c.ang);
   g.translate(c.x,heightAt(c.x,c.z)+KIND.chalk.y,c.z);return g;});
  const geo=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());
  const mat=new THREE.MeshStandardMaterial({map:courtTexture(kind),transparent:true,roughness:1,metalness:0,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-6});
  const mesh=new THREE.Mesh(geo,mat);mesh.receiveShadow=true;mesh.renderOrder=2;group.add(mesh);
  for(const c of cells){if(kind==='tennis')nets.push(tennisNet(c,heightAt));else hoops.push(...basketHoops(c,heightAt));}
 }
 if(nets.length){const g=mergeGeometries(nets.map(n=>n.geometry),true);
  const mesh=new THREE.Mesh(g,[new THREE.MeshStandardMaterial({color:'#2a3230',roughness:.9,side:THREE.DoubleSide}),new THREE.MeshStandardMaterial({color:'#e8e8e2',roughness:.85,side:THREE.DoubleSide})]);
  mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);nets.forEach(n=>n.geometry.dispose());}
 if(hoops.length){const g=mergeGeometries(hoops.map(h=>h.geometry),true);
  const mesh=new THREE.Mesh(g,[new THREE.MeshStandardMaterial({color:'#4d5257',roughness:.7,metalness:.4}),new THREE.MeshStandardMaterial({color:'#e6e6e0',roughness:.8}),new THREE.MeshStandardMaterial({color:'#d4592c',roughness:.6,metalness:.5})]);
  mesh.castShadow=true;group.add(mesh);hoops.forEach(h=>h.geometry.dispose());}

 const geo=build.geometry();
 if(geo){const mesh=new THREE.Mesh(geo,surfaceMaterial(grainTexture()));mesh.name='groundSurfaces';mesh.receiveShadow=true;mesh.renderOrder=1;group.add(mesh);}
 group.userData.audit={polygons:records.length,kinds:counts,triangles:build.tris,maskedOut:build.dropped,lowMemory,
  source:'OpenStreetMap contributors'};
 return group;
}

// the sub-rectangles a mapped court block is really made of
function courtCells(box,kind){
 const [cx,cz,L,W,ang]=box,std=kind==='tennis'?[23.77,10.97]:[28,15];
 const {cols,rows,cl,cw}=courtGrid(L,W,std[0],std[1]);
 const ux=Math.cos(ang),uz=Math.sin(ang),vx=-uz,vz=ux,out=[];
 for(let i=0;i<cols;i++)for(let j=0;j<rows;j++){
  const a=(i-(cols-1)/2)*(L/cols),b=(j-(rows-1)/2)*(W/rows);
  out.push({x:cx+ux*a+vx*b,z:cz+uz*a+vz*b,l:cl,w:cw,ang,ux,uz,vx,vz});
 }
 return out;
}
function tennisNet(c,heightAt){
 const y=heightAt(c.x,c.z);
 const post=new THREE.BoxGeometry(.09,1.09,.09),net=new THREE.BoxGeometry(.04,.95,c.w+1.5),tape=new THREE.BoxGeometry(.05,.07,c.w+1.5);
 net.translate(0,.95/2,0);tape.translate(0,.98,0);
 const g=mergeGeometries([net,tape],true);net.dispose();tape.dispose();post.dispose();
 g.rotateY(-c.ang);g.translate(c.x,y+KIND.chalk.y,c.z);
 return {geometry:g};
}
function basketHoops(c,heightAt){
 const out=[];
 for(const side of[-1,1]){
  const x=c.x+c.ux*(c.l/2-.6)*side,z=c.z+c.uz*(c.l/2-.6)*side,y=heightAt(x,z);
  const pole=new THREE.BoxGeometry(.14,3.05,.14),board=new THREE.BoxGeometry(.06,1.05,1.8),rim=new THREE.BoxGeometry(.45,.05,.45);
  pole.translate(0,3.05/2,0);board.translate(-side*.55,3.2,0);rim.translate(-side*.95,3.05,0);
  const g=mergeGeometries([pole,board,rim],true);pole.dispose();board.dispose();rim.dispose();
  g.rotateY(-c.ang);g.translate(x,y+KIND.chalk.y,z);out.push({geometry:g});
 }
 return out;
}

// the skinned infield, the foul lines, the bases and the mound, set out from the mapped home plate
function ballField(build,r,lowMemory){
 const [hx,hz,ux,uz,half=Math.PI/4]=r.h,vx=-uz,vz=ux;
 const dir=a=>[ux*Math.cos(a)-vx*Math.sin(a),uz*Math.cos(a)-vz*Math.sin(a)];
 let depth=0;for(const p of r.r)depth=Math.max(depth,(p[0]-hx)*ux+(p[1]-hz)*uz);
 const R=Math.max(11,Math.min(29,depth*.45));      // a real infield arc, but never deeper than the field
 const steps=lowMemory?8:18,arc=[],radii=[];
 for(let i=0;i<=steps;i++){
  const a=-half+2*half*i/steps,[dx,dz]=dir(a);
  // a mapped field is rarely a tidy 90-degree fan: let the skin follow its own edge where it pinches in
  const room=exitDistance(r.r,hx,hz,dx,dz,R*1.6)-.7;
  const rad=Math.max(6,Math.min(R,room));
  radii.push(rad);arc.push([hx+dx*rad,hz+dz*rad]);
 }
 const shoulder=Math.min(2.4,Math.min(...radii)*.35);
 const [lx,lz]=dir(-half),[rx,rz]=dir(half);
 arc.unshift([hx-lx*shoulder,hz-lz*shoulder]);arc.push([hx-rx*shoulder,hz-rz*shoulder]);
 build.polygon(arc,'infield');
 if(lowMemory)return;
 // the foul lines out to the edge of the mapped field, the three bags and the pitcher's mound
 const skin=Math.min(...radii),base=Math.min(R,skin)*.94/Math.SQRT2;
 for(const s of[-1,1]){
  const [dx,dz]=dir(half*s);
  const len=Math.max(skin*1.05,exitDistance(r.r,hx,hz,dx,dz,depth*1.4)-1.2);
  build.quad(hx+dx*len/2,hz+dz*len/2,dx,dz,len/2,.06,'chalk');
  build.quad(hx+dx*base*1.4142,hz+dz*base*1.4142,dx,dz,.42,.42,'chalk');   // first and third
 }
 build.quad(hx+ux*base*2,hz+uz*base*2,ux,uz,.42,.42,'chalk');              // second
 build.disc(hx+ux*Math.min(skin*.62,18.44),hz+uz*Math.min(skin*.62,18.44),2.6,'mound',14);
 build.disc(hx,hz,1.6,'mound',12);
}
