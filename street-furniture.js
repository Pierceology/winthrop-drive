import * as THREE from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {inTown} from './town-limits.js';

// Street furniture from OpenStreetMap, at OSM's positions: painted crossings across the through road,
// power poles with their wires hung between consecutive poles, street lamps and bus-stop posts. Nothing here is guessed
// beyond road width (the mapped inventory width, else 9 m) and the standard shapes of the objects.
export function streetFurniture({crossings,powerLines,furniture},network,heightAt,lights=null,junctions=null){
 const group=new THREE.Group();group.name='streetFurniture';
 // Crossings: continental bars 0.4 m wide across the road, 2.4 m deep, at road grade.
 // OSM gives the node; the node is not always where the paint goes. Pierce, 2026-09-12: "plenty of crosswalks are not where
 // they need to be." Measured that day, 297 nodes: 135 lie outside the town entirely (the fetch box reaches East Boston and
 // Revere), 39 in-town nodes sit on a sidewalk beside the road rather than on it, 32 carry a direction that is not the road's,
 // and 18 are tagged on the corner node itself. So each crossing is placed against the road network rather than trusted:
 //   · a node with no road within 12 m is not drawn;
 //   · a node on the corner itself becomes one walk per arm, each at that arm's stop line (that is what a marked corner is);
 //   · every other node is snapped sideways onto the centreline of the road it belongs to, and its bars run across THAT road.
 // The road a node belongs to is the nearby segment that best agrees with the node's mapped direction, so a crossing five
 // metres from a corner stays on its own street instead of jumping onto the cross street.
 // The contact field hands back the road surface MINUS 0.12 m (ground-world.js: the car adds its own 0.14). Paint that
 // trusted that number sat 7 cm under the asphalt and showed only where the crown happened to dip -- the half-crosswalks.
 const ROAD_TOP=.12;
 const bars=[],placed=new Set();
 const pickRoad=(c)=>{let best=null;for(const s of network.segments){if(s.length<4||s.width<3)continue;
   const t=Math.max(0,Math.min(1,((c.x-s.a[0])*s.dx+(c.z-s.a[1])*s.dz)/s.length**2)),px=s.a[0]+t*s.dx,pz=s.a[1]+t*s.dz,d=Math.hypot(c.x-px,c.z-pz);if(d>12)continue;
   const rx=s.dx/s.length,rz=s.dz/s.length,agree=Math.abs(rx*c.ux+rz*c.uz);const score=d-agree*4;if(!best||score<best.score)best={s,px,pz,rx,rz,d,score};}
  return best;};
 // Two nodes can describe one walk (a corner node and a node four metres up the arm): the second one within 4 m, running the same way, is the same paint.
 const paintWalk=(x,z,ux,uz,width,depth)=>{for(const w of placed)if(Math.hypot(w.x-x,w.z-z)<4&&Math.abs(w.ux*ux+w.uz*uz)>.9)return;placed.add({x,z,ux,uz});
  const W=Math.max(6,Math.min(16,width||9)),vx=-uz,vz=ux,n=Math.floor((W-1.2)/.9)+1,start=-(n-1)*.45;
  for(let i=0;i<n;i++){
   const o=start+i*.9,cx=x+vx*o,cz=z+vz*o;const g=new THREE.PlaneGeometry(.42,depth);g.rotateX(-Math.PI/2);g.rotateY(Math.atan2(ux,uz));
   // sample grade along the bar and across it so the paint rides the crown of the road instead of sinking under it
   const y=Math.max(heightAt(cx+ux*depth/2,cz+uz*depth/2),heightAt(cx-ux*depth/2,cz-uz*depth/2),heightAt(cx,cz),heightAt(cx+vx*.45,cz+vz*.45),heightAt(cx-vx*.45,cz-vz*.45))+ROAD_TOP+.03;g.translate(cx,y,cz);bars.push(g);
  }};
 let dropped=0,corners=0,snapped=0;
 for(const c of crossings.crossings){
  const depth=c.style==='zebra'?3:2.4;
  const v=junctions&&junctions.nearestVertex(c.x,c.z,3.5,3);
  if(v){corners++;
   for(const s of v.segs){const atA=Math.hypot(s.a[0]-v.x,s.a[1]-v.z)<1.5,far=atA?s.b:s.a;let dx=far[0]-v.x,dz=far[1]-v.z;const L=Math.hypot(dx,dz);if(L<8)continue;dx/=L;dz/=L;
    const others=v.segs.filter(o=>o!==s).map(o=>o.width||9),line=Math.min(10,Math.max(3.5,Math.max(...others)/2+1.5));
    paintWalk(v.x+dx*line,v.z+dz*line,dx,dz,s.width,depth);}
   continue;}
  const r=pickRoad(c);if(!r){dropped++;continue;}
  if(r.d>.5)snapped++;
  paintWalk(r.px,r.pz,r.rx,r.rz,r.s.width,depth);
 }
 group.userData.crossingPlacement={nodes:crossings.crossings.length,dropped,corners,snapped,walks:placed.size};
 if(bars.length){const paint=new THREE.Mesh(mergeGeometries(bars,false),new THREE.MeshLambertMaterial({color:'#e9e9df',polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));paint.receiveShadow=true;paint.name='crossings';group.add(paint);for(const g of bars)g.dispose();}
 // Power lines. Poles and wires come from the same file (power-lines.json: poles[], lines[] of pole indices), so a wire is
 // never drawn without the two poles it hangs from. 8.8 m pole, crossarm at 8.45 m turned across the line, three conductors
 // on the arm at the pole top (-0.6 / 0 / +0.6 m) and a neutral on the pole at 7.1 m, all sagging with the span.
 const POLE_H=8.8,ARM_Y=8.45,TOP=POLE_H,LOW=7.1,OFFSETS=[-.6,0,.6],STEPS=8;
 const poles=(powerLines.poles||[]).map(p=>inTown(p.x,p.z)?({...p,y:heightAt(p.x,p.z),ax:Math.cos(p.yaw||0),az:-Math.sin(p.yaw||0)}):null);
 const attach=(p,off,h)=>[p.x+p.ax*off,p.y+h,p.z+p.az*off];
 const wire=[];let spans=0;
 for(const line of powerLines.lines||[])for(let i=1;i<line.length;i++){
  const a=poles[line[i-1]],b=poles[line[i]];if(!a||!b)continue;   /* a pole beyond the town line is null: no wire */const span=Math.hypot(b.x-a.x,b.z-a.z);if(span<1)continue;
  const flip=(a.ax*b.ax+a.az*b.az)<0?-1:1,sag=Math.min(1.4,.006*span+.15);spans++;/* arms that face opposite ways swap the outer conductors so they never cross */
  for(const [off,h] of [...OFFSETS.map(o=>[o,TOP]),[0,LOW]]){const A=attach(a,off,h),B=attach(b,off*flip,h);let prev=null;for(let s=0;s<=STEPS;s++){const t=s/STEPS,x=A[0]+(B[0]-A[0])*t,z=A[2]+(B[2]-A[2])*t,y=A[1]+(B[1]-A[1])*t-sag*4*t*(1-t);if(prev)wire.push(...prev,x,y,z);prev=[x,y,z];}}
 }
 if(wire.length){const w=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(wire,3)),new THREE.LineBasicMaterial({color:'#1d1f22',transparent:true,opacity:.85}));w.name='powerLines';w.frustumCulled=false;group.add(w);}
 // Lamps and bus stops as instanced posts.
 const post=new THREE.MeshStandardMaterial({color:'#4a4f52',roughness:.7}),bulb=new THREE.MeshStandardMaterial({color:'#f2e8c8',emissive:'#8a7a4a',emissiveIntensity:.35,roughness:.5}),plate=new THREE.MeshStandardMaterial({color:'#1f4d8f',roughness:.6});
 function batch(geometry,material,items,h,name){if(!items.length)return;const mesh=new THREE.InstancedMesh(geometry,material,items.length),o=new THREE.Object3D();items.forEach((p,i)=>{o.position.set(p.x,heightAt(p.x,p.z)+h,p.z);o.rotation.set(0,p.yaw||0,0);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.castShadow=true;mesh.name=name;group.add(mesh);}
 const wood=new THREE.MeshStandardMaterial({color:'#675347',roughness:1}),glass=new THREE.MeshStandardMaterial({color:'#9fb7b0',roughness:.35});
 {const stood=poles.filter(Boolean);batch(new THREE.CylinderGeometry(.12,.19,POLE_H,7),wood,stood,POLE_H/2,"powerPoles");batch(new THREE.BoxGeometry(1.7,.12,.12),wood,stood,ARM_Y,"powerArms");}
 {const pins=mergeGeometries(OFFSETS.map(o=>{const g=new THREE.CylinderGeometry(.05,.07,TOP-ARM_Y,6);g.translate(o,(TOP+ARM_Y)/2,0);return g;}),false);batch(pins,glass,poles.filter(Boolean),0,"powerInsulators");}
 const lamps=furniture.lamps.filter(a=>!network.contains(a.x,a.z,.2));
 batch(new THREE.CylinderGeometry(.07,.11,7,8),post,lamps,3.5,'lampPosts');batch(new THREE.CylinderGeometry(.22,.3,.32,10),bulb,lamps,7.05,'lampHeads');
 const stops=furniture.busStops.filter(a=>!network.contains(a.x,a.z,.2)).map(a=>{const s=network.nearest(a.x,a.z,true);return {...a,yaw:s?Math.atan2(s.dx,s.dz):0};});
 batch(new THREE.CylinderGeometry(.04,.04,2.6,6),post,stops,1.3,'busPosts');batch(new THREE.BoxGeometry(.05,.5,.4),plate,stops,2.3,'busPlates');
 // Traffic signals: one pole-mounted head per inbound approach, facing that approach from the far side of the
 // junction on the driver's right (the usual post-mounted head, in view from the stop line). Lamps follow SignalSystem.
 const heads=[];
 for(const node of(lights&&lights.nodes)||[])for(const a of node.approaches){const rx=-a.hz,rz=a.hx,W=Math.max(6,Math.min(16,a.width||9)),far=Math.max(4,Math.min(9,(a.cross||9)/2+1.2));let x=a.vx+a.hx*far+rx*(W/2+.8),z=a.vz+a.hz*far+rz*(W/2+.8);
  if(network.contains(x,z,-.6)){/* the post landed on another arm's pavement (a wider cross street): the nearest spot beyond every curb, sideways first, then further along */
   const c=[];for(let f=0;f<=8;f+=.5)for(let l=0;l<=5;l+=.25)c.push([f,l]);c.sort((p,q)=>Math.hypot(p[0],p[1]*1.2)-Math.hypot(q[0],q[1]*1.2));
   for(const [f,l] of c){const cx=a.vx+a.hx*(far+f)+rx*(W/2+.8+l),cz=a.vz+a.hz*(far+f)+rz*(W/2+.8+l);if(!network.contains(cx,cz,-.6)&&!network.obstructed(cx,cz)){x=cx;z=cz;break;}}
  }
  heads.push({x,z,yaw:Math.atan2(a.hx,a.hz),node,axis:a.axis});}
 if(heads.length){
  batch(new THREE.CylinderGeometry(.06,.08,4.6,8),post,heads,2.3,'signalPoles');
  const housing=new THREE.MeshStandardMaterial({color:'#2d3a2f',roughness:.8});batch(new THREE.BoxGeometry(.32,1.05,.3),housing,heads,4.25,'signalHeads');
  const lampMeshes=[];const OFF=new THREE.Color('#1b1d1f');
  for(const [dy,col] of [[.32,'#e0392b'],[0,'#f2c230'],[-.32,'#37b061']]){const lamp=new THREE.MeshBasicMaterial({color:'#ffffff'});const g=new THREE.SphereGeometry(.1,10,8);g.translate(0,0,.16);const mesh=new THREE.InstancedMesh(g,lamp,heads.length),o=new THREE.Object3D();heads.forEach((p,i)=>{o.position.set(p.x,heightAt(p.x,p.z)+4.25+dy,p.z);o.rotation.set(0,p.yaw,0);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,OFF);});mesh.name='signalLamps';group.add(mesh);lampMeshes.push({mesh,on:new THREE.Color(col),state:dy>0?'red':dy<0?'green':'yellow'});}
  group.userData.lights={heads,lamps:lampMeshes,update(){if(!lights)return;heads.forEach((h,i)=>{const st=lights.state(h.node,h.axis);for(const l of lampMeshes)l.mesh.setColorAt(i,l.state===st?l.on:OFF);});for(const l of lampMeshes)l.mesh.instanceColor.needsUpdate=true;}};
 }
 group.userData.audit={crossings:crossings.crossings.length,poles:poles.filter(Boolean).length,estimatedPoles:poles.filter(p=>p&&p.estimated).length,movedPoles:poles.filter(p=>p&&p.mapped).length,spans,lamps:lamps.length,busStops:stops.length,signalHeads:heads.length,pole:{h:POLE_H,top:TOP,low:LOW,offsets:OFFSETS,steps:STEPS}};
 return group;
}
