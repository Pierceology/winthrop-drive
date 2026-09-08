import * as THREE from 'three';

// Photo fronts: the town's own assessor photograph of a house, hung on the wall
// that faces its street. Estimated houses keep their MassGIS footprint and their
// cross-referenced colour; this only dresses the one wall a driver actually sees.
// Photographs load for houses near the camera and are released when it moves on.
export class PhotoFronts {
 constructor({scene,world,neighborhoods,photos,network,anisotropy=4,radius=240,capacity=70,concurrency=3}){
  Object.assign(this,{scene,network,radius,capacity,concurrency,anisotropy});this.pending=0;this.queue=[];this.group=new THREE.Group();scene.add(this.group);
  const byId=new Map(world.buildings.map(b=>[b.id,b]));this.entries=[];
  for(const [id,p] of Object.entries(photos)){const b=byId.get(id);if(!b||b.residence||!p.w||!p.h||p.hide)continue;this.entries.push({id,pid:p.pid,w:p.cut?p.cw:p.w,h:p.cut?p.ch:p.h,cut:!!p.cut,edge:p.edge,b,record:neighborhoods.buildings[id],state:'idle',mesh:null,distance:Infinity});}
 }
 // The street-facing wall: the footprint edge whose outward normal points most toward the nearest mapped road, long edges preferred.
 wall(b,edge){
  const ring=b.rings[0];if(edge!==undefined&&ring[edge+1]){let area=0;for(let i=1;i<ring.length;i++)area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];const p=ring[edge],q=ring[edge+1],dx=q[0]-p[0],dz=q[1]-p[1],len=Math.hypot(dx,dz);let nx=dz/len,nz=-dx/len;if(area<0){nx=-nx;nz=-nz;}return {p,q,nx,nz,len,score:1};}let area=0;for(let i=1;i<ring.length;i++)area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];const cw=area<0;
  let best=null;
  for(let i=1;i<ring.length;i++){
   const p=ring[i-1],q=ring[i],dx=q[0]-p[0],dz=q[1]-p[1],len=Math.hypot(dx,dz);if(len<2.5)continue;
   let nx=dz/len,nz=-dx/len;if(cw){nx=-nx;nz=-nz;}
   const mx=(p[0]+q[0])/2,mz=(p[1]+q[1])/2,road=this.network?.nearest(mx,mz,true);
   let facing=1;if(road){const rx=road.x-mx,rz=road.z-mz,d=Math.hypot(rx,rz)||1;facing=(rx*nx+rz*nz)/d;}
   const score=facing*Math.sqrt(len);if(!best||score>best.score)best={p,q,nx,nz,len,score};
  }
  return best;
 }
 build(e,texture){
  const w=this.wall(e.b,e.edge);if(!w)return null;const base=e.b.base+.15,eave=e.record?.wall||8,roof=e.record?.roof||[];let ridge=eave;for(let i=1;i<roof.length;i+=3)ridge=Math.max(ridge,roof[i]);
  let natural=w.len*e.h/e.w,H,W=w.len,u0=0,u1=1,v0=0,v1=1;
  if(e.cut){// a cut-out keeps the photo's own proportions: never taller than the roof allows; a long wall keeps its siding either side
   const cap=ridge*1.3;if(natural>cap){H=cap;W=cap*e.w/e.h;}else H=natural;}
  else{H=Math.max(eave,Math.min(natural,ridge));const qa=w.len/H,pa=e.w/e.h;if(qa>pa){const k=pa/qa;v0=.5-k/2;v1=.5+k/2;}else{const k=qa/pa;u0=.5-k/2;u1=.5+k/2;}}
  const inset=(w.len-W)/2,dx=(w.q[0]-w.p[0])/w.len,dz=(w.q[1]-w.p[1])/w.len,ox=w.nx*.07,oz=w.nz*.07,ax=w.p[0]+dx*inset+ox,az=w.p[1]+dz*inset+oz,bx=w.q[0]-dx*inset+ox,bz=w.q[1]-dz*inset+oz;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([ax,base,az,bx,base,bz,bx,base+H,bz,ax,base+H,az],3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute([w.nx,0,w.nz,w.nx,0,w.nz,w.nx,0,w.nz,w.nx,0,w.nz],3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute([u0,v0,u1,v0,u1,v1,u0,v1],2));g.setIndex([0,1,2,0,2,3]);
  const m=new THREE.Mesh(g,e.cut?new THREE.MeshLambertMaterial({map:texture,side:THREE.DoubleSide,alphaTest:.5}):new THREE.MeshLambertMaterial({map:texture,side:THREE.DoubleSide,transparent:true,alphaTest:.02}));m.receiveShadow=true;m.userData.photoFront=e.id;return m;
 }
 update(x,z){
  for(const e of this.entries)e.distance=Math.hypot(e.b.center[0]-x,e.b.center[1]-z);
  const sorted=[...this.entries].sort((a,b)=>a.distance-b.distance);
  this.wanted=new Set(sorted.filter(e=>e.distance<this.radius).slice(0,this.capacity).map(e=>e.id));
  for(const e of this.entries)if(e.state==='ready'&&!this.wanted.has(e.id)){this.group.remove(e.mesh);e.mesh.geometry.dispose();e.mesh.material.map.dispose();e.mesh.material.dispose();e.mesh=null;e.state='idle';}
  this.queue=sorted.filter(e=>this.wanted.has(e.id)&&e.state==='idle');this.pump();
 }
 async load(e){
  e.state='loading';this.pending++;
  try{
   const image=new Image();image.decoding='async';image.src=e.cut?'./assets/fronts/'+e.pid+'.webp':'./assets/assessor/'+e.pid+'.jpg';await image.decode();
   if(this.wanted.has(e.id)){
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);if(!e.cut){const fade=ctx.createLinearGradient(0,0,0,image.height*.14);fade.addColorStop(0,'rgba(0,0,0,1)');fade.addColorStop(1,'rgba(0,0,0,0)');ctx.globalCompositeOperation='destination-out';ctx.fillStyle=fade;ctx.fillRect(0,0,image.width,image.height*.14);}
    const texture=new THREE.Texture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=this.anisotropy;texture.needsUpdate=true;
    const mesh=this.build(e,texture);if(mesh){this.group.add(mesh);e.mesh=mesh;e.state='ready';}else{texture.dispose();e.state='failed';}
   }else e.state='idle';
  }catch{e.state='failed';}
  finally{this.pending--;this.pump();}
 }
 pump(){while(this.pending<this.concurrency&&this.queue.length){const e=this.queue.shift();if(e.state==='idle'&&this.wanted.has(e.id))this.load(e);}}
}
