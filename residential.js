import * as THREE from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

// Individually configured from exterior photographs. Metric elevations and unseen
// elevations are estimates, kept separate from surveyed footprint coordinates.
export function makeResidence(spec,base,building){
 const group=new THREE.Group(),batches=new Map();
 const mat=(color,roughness=.9)=>new THREE.MeshStandardMaterial({color,roughness,side:THREE.DoubleSide});
 const wall=mat(spec.color),trim=mat(spec.trim),roof=mat('#45494a'),glass=mat('#344c55',.26),foundation=mat('#9a9990'),door=mat('#3d4949'),seam=mat(spec.material==='brick'?'#a58b77':new THREE.Color(spec.color).multiplyScalar(.91));
 function add(g,m){g.deleteAttribute('uv');if(!batches.has(m))batches.set(m,[]);batches.get(m).push(g);}
 function covered(x,y,z){const W=spec.width,D=spec.depth,P=spec.porch?Math.min(2.35,D*.21):0;
 const inside=(u,v,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>v)!==(b[1]>v)&&u<(b[0]-a[0])*(v-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
 return (spec.photoSurfaces||[]).some(s=>{if(!(y>s.bottom-.02&&y<s.top+.02))return false;const front=(s.plane==='front'&&Math.abs(z-(D/2-P))<.28)||(s.plane==='porch'&&Math.abs(z-D/2)<.28),side=(s.plane==='left'&&Math.abs(x+W/2)<.28)||(s.plane==='right'&&Math.abs(x-W/2)<.28)||(s.plane==='porchRight'&&Math.abs(x-W/2)<.28&&z>D/2-P);if(!front&&!side)return false;const u=front?x/W+.5:s.plane==='left'?(z+D/2)/(D-P):s.plane==='porchRight'?(D/2-z)/P:(D/2-P-z)/(D-P),lo=s.uMin??0,hi=s.uMax??1;if(u<lo||u>hi)return false;return !s.outline||inside((u-lo)/(hi-lo),(s.top-y)/(s.top-s.bottom),s.outline);});}

 function box(x,y,z,w,h,d,m){if((d<.3||w<.3)&&covered(x,y,z))return;const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);add(g,m)}
 function triangles(points,m){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));g.computeVertexNormals();add(g,m)}
 const W=spec.width,D=spec.depth,porch=spec.porch?Math.min(2.35,D*.21):0,depth=D-porch,cz=-porch/2;
 const floors=Math.max(1,Math.floor(spec.wallFloors??spec.stories)),F=.65,H=F+floors*2.75,front=D/2-porch;
 box(0,F/2,cz,W,F,depth,foundation);box(0,(H+F)/2,cz,W,H-F,depth,wall);
 if(spec.upperFrontColor){const z=front+.025,m=mat(spec.upperFrontColor);triangles([[-W/2,3.4,z],[W/2,3.4,z],[W/2,H,z],[-W/2,3.4,z],[W/2,H,z],[-W/2,H,z]],m);}
 // Siding reveals have real depth and catch low sunlight; masonry uses mortar courses.
 const course=spec.material==='brick'?.085:spec.material==='stucco'?0:.18;
 if(course)for(let y=F+.12;y<H;y+=course){if(!(spec.photoUpper&&y>=3.4))box(0,y,front+.012,W,.012,.024,seam);box(0,y,-D/2-.012,W,.012,.024,seam);box(-W/2-.012,y,cz,.024,.012,depth,seam);box(W/2+.012,y,cz,.024,.012,depth,seam);}
 if(spec.material==='brick')for(let row=0;row<Math.floor((H-F)/.085);row++)for(let x=-W/2+.12+(row%2)*.12;x<W/2;x+=.25)box(x,F+row*.085+.045,front+.019,.009,.075,.012,seam);
 for(const x of[-W/2,W/2])for(const z of[-D/2,front])box(x,(H+F)/2,z,.11,H-F,.11,trim);
 function windowAt(x,y,z,w=1,h=1.32,rotation=0,shutters=false){
  if(covered(x,y,z))return;
  const start=new Map([...batches].map(([m,g])=>[m,g.length]));
  box(0,0,.01,w+.16,h+.16,.12,trim);box(0,0,.083,w,h,.03,glass);box(0,0,.11,w,.045,.035,trim);box(0,-h/2-.1,.06,w+.25,.08,.2,trim);
  if(shutters)for(const side of[-1,1]){box(side*(w/2+.28),0,.015,.3,h+.12,.08,door);for(let a=-h/2+.1;a<h/2;a+=.14)box(side*(w/2+.28),a,.065,.25,.025,.025,trim);}
  for(const [m,gs]of batches)for(let i=start.get(m)||0;i<gs.length;i++){gs[i].rotateY(rotation);gs[i].translate(x,y,z);}
 }
 const cols=spec.columns||3,doorX=(spec.doorSide||0)*W;
 for(let floor=0;floor<floors;floor++)for(let c=0;c<cols;c++){
  const x=(c-(cols-1)/2)*W/(cols+.35);if(floor===0&&Math.abs(x-doorX)<1.1)continue;
  if((spec.porch==='stacked'||spec.photoUpper)&&floor===1)continue;
  windowAt(x,F+1.55+floor*2.75,front+.03,spec.wideWindow&&floor===0?1.8:1,1.35,0,spec.shutters);
 }
 for(const side of[-1,1])for(let floor=0;floor<floors;floor++)for(let j=0;j<Math.max(2,Math.floor(depth/3.8));j++){
  const n=Math.max(2,Math.floor(depth/3.8)),z=cz+(j-(n-1)/2)*depth/(n+1);windowAt(side*(W/2+.025),F+1.55+floor*2.75,z,.85,1.3,side*Math.PI/2);
 }
 box(doorX,F+1.05,front+.055,1.03,2.1,.11,trim);box(doorX,F+1,front+.12,.87,1.95,.07,door);box(doorX,F+1.42,front+.17,.58,.75,.035,glass);box(doorX+.32,F+.92,front+.2,.045,.06,.045,roof);
 // Roof orientation is per address, not seeded or randomized.
 let rw=W+.45,rd=depth+.45,rz=cz,ry=H+.08,rise=spec.roof==='flat'?.12:(spec.roofRise??Math.min(3.1,Math.min(W,depth)*.3));
 function roofForm(w,d,y,z,r,type,frontGable){
  if(type==='flat'){box(0,y,z,w,.18,d,roof);return;}
  let p=[[-w/2,y,z-d/2],[w/2,y,z-d/2],[w/2,y,z+d/2],[-w/2,y,z+d/2]];
  if(type==='gambrel'){
   const cross=[[-w/2,y],[-w*.4,y+r*(spec.roofBreak??.62)],[0,y+r],[w*.4,y+r*(spec.roofBreak??.62)],[w/2,y]];
   for(let i=0;i<4;i++){const a=cross[i],b=cross[i+1];triangles([[a[0],a[1],z-d/2],[b[0],b[1],z-d/2],[b[0],b[1],z+d/2],[a[0],a[1],z-d/2],[b[0],b[1],z+d/2],[a[0],a[1],z+d/2]],roof);}
   for(const side of [-1,1])for(let i=1;i<4;i++)triangles([[cross[0][0],cross[0][1],z+side*d/2],[cross[i][0],cross[i][1],z+side*d/2],[cross[i+1][0],cross[i+1][1],z+side*d/2]],wall);
  }else if(type==='hip'){
   const ridge=Math.max(0,d/2-w/2),a=[0,y+r,z-ridge],b=[0,y+r,z+ridge];triangles([p[0],p[1],a,p[1],p[2],b,p[1],b,a,p[2],p[3],b,p[3],p[0],a,p[3],a,b],roof);
  }else if(frontGable){const a=[0,y+r,z-d/2],b=[0,y+r,z+d/2];triangles([p[0],a,b,p[0],b,p[3],a,p[1],p[2],a,p[2],b],roof);triangles([p[0],p[1],a,p[3],b,p[2]],wall);}
  else{const a=[-w/2,y+r,z],b=[w/2,y+r,z];triangles([p[0],p[1],b,p[0],b,a,a,b,p[2],a,p[2],p[3]],roof);triangles([p[0],a,p[3],p[1],p[2],b],wall);}
 }
 if(spec.roofOverPorch){rd=D+.45;rz=0;}
 roofForm(rw,rd,ry,rz,rise,spec.roof,spec.frontGable);
 box(0,H,front+.1,W+.4,.16,.22,trim);box(0,H,-D/2-.1,W+.4,.16,.22,trim);
 if(spec.attic&&spec.frontGable)windowAt(0,H+rise*.4,front+.23,.85,1.1,0,true);
 if(spec.dormer){const z=cz+depth*.25,y=H+rise*(spec.dormerBaseRise??.43);box(0,y+.5,z,1.55,1.2,1.4,wall);box(0,y+1.12,z,1.8,.15,1.65,roof);if(!spec.photoDormer)windowAt(0,y+.5,z+.72,.8,.8);}
 if(spec.cornice){box(0,H+.18,front+.15,W+.55,.24,.45,trim);for(let x=-W/2;x<W/2;x+=.45)box(x,H-.17,front+.13,.14,.22,.23,trim);}
 // Chimney position cannot be measured from these references: omit unless visible.
 if(['1016','1018','1058'].includes(spec.address.split(' ')[0]))box(-W*.22,H+rise-.1,cz-depth*.28,.5,1.35,.55,mat('#795c51'));
 if(porch){const z=D/2,pH=F+2.48;box(0,F-.1,front+porch/2,W,.22,porch,foundation);
  for(let x=-W/2+.15;x<=W/2;x+=(W-.3)/3)box(x,(F+pH)/2,z-.12,.14,pH-F,.14,trim);
  if(spec.porch==='open'){
    const l=-W/2-.18,r=W/2+.18,near=z+.2,far=front-.12;
    triangles([[l,pH,near],[r,pH,near],[r,pH+.65,far],[l,pH,near],[r,pH+.65,far],[l,pH+.65,far]],roof);
    box(0,pH-.05,near,W+.35,.16,.15,trim);
   }else box(0,pH,front+porch/2,W+.35,.18,porch+.4,roof);
  if(spec.porch==='enclosed'||spec.porch==='stacked'){
   const sy=spec.porch==='stacked'?F+2.75:F;
   box(0,sy+.4,z-.05,W,.8,.13,wall);for(let c=0;c<(spec.photoPorch?0:Math.floor(W/1.1));c++)windowAt((c-(Math.floor(W/1.1)-1)/2)*1.08,sy+1.62,z,.91,1.56);
   if(spec.porch==='stacked')box(0,sy+2.65,front+porch/2,W+.3,.18,porch+.3,roof);
  }else{
   for(const y of[F+.12,F+.93])for(const side of[-1,1]){const end=side<0?doorX-.7:W/2,start=side<0?-W/2:doorX+.7;if(end>start)box((start+end)/2,y,z,end-start,.08,.08,trim);}
   for(let x=-W/2+.1;x<W/2;x+=.18)if(Math.abs(x-doorX)>.7)box(x,F+.52,z,.04,.8,.04,trim);
  }
 }
 if(spec.vestibule){
  const ew=2.35,ed=1.35,eh=2.45,x=doorX,z=front+ed/2;
  box(x,F+eh/2,z,ew,eh,ed,wall);box(x,F+1.05,front+ed+.04,1.0,2.1,.12,trim);box(x,F+1.05,front+ed+.12,.82,1.94,.04,glass);
  windowAt(x+ew/2+.04,F+1.35,z,.85,1.25,Math.PI/2);
  const y=F+eh,peak=y+.8,a=[x-ew/2-.15,y,front+ed+.15],b=[x+ew/2+.15,y,front+ed+.15],c=[x,peak,front+ed+.15],d=[x-ew/2-.15,y,front-.1],e=[x+ew/2+.15,y,front-.1],f=[x,peak,front-.1];
  triangles([a,b,c],trim);triangles([a,c,f,a,f,d,c,b,e,c,e,f],roof);
 }
 const stepFront=spec.vestibule?front+1.35:porch?D/2:front;for(let i=0;i<4;i++)box(doorX,(4-i)*F/8,stepFront+.16+i*.29,1.5,(4-i)*F/4,.32,foundation);
 if(spec.awning)box(doorX,F+2.4,front+.43,1.8,.15,.95,roof);
 for(const side of[-1,1])box(side*(W/2+.06),(F+H)/2,front-.15,.085,H-F,.085,trim);
 for(const [material,geometries]of batches){
  const merged=mergeGeometries(geometries.map(g=>g.index?g.toNonIndexed():g),false);const mesh=new THREE.Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.ranges=[{end:merged.attributes.position.count,data:building}];group.add(mesh);for(const g of geometries)g.dispose();
 }
 group.rotation.y=Math.atan2(spec.front[0],spec.front[1]);group.position.set(spec.center[0],base,spec.center[1]);group.userData.spec=spec;return group;
}
