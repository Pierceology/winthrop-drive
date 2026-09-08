import * as THREE from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

// Street furniture from OpenStreetMap, at OSM's positions: painted crossings across the through road,
// power lines hung between consecutive pole nodes, street lamps and bus-stop posts. Nothing here is guessed
// beyond road width (the mapped inventory width, else 9 m) and the standard shapes of the objects.
export function streetFurniture({crossings,powerLines,furniture},network,heightAt,lights=null){
 const group=new THREE.Group();group.name='streetFurniture';
 // Crossings: continental bars 0.4 m wide across the road, 2.4 m deep, at road grade.
 const bars=[];
 for(const c of crossings.crossings){
  const seg=network.nearest(c.x,c.z,true),W=Math.max(6,Math.min(16,(seg&&seg.width)||9)),depth=c.style==='zebra'?3:2.4;
  const ux=c.ux,uz=c.uz,vx=-uz,vz=ux;const n=Math.floor((W-1.2)/.9)+1,start=-(n-1)*.45;
  for(let i=0;i<n;i++){
   const o=start+i*.9,cx=c.x+vx*o,cz=c.z+vz*o;const g=new THREE.PlaneGeometry(.42,depth);g.rotateX(-Math.PI/2);g.rotateY(Math.atan2(ux,uz));
   // sample grade at both ends so the bar follows the crown of the road
   const y=Math.max(heightAt(cx+ux*depth/2,cz+uz*depth/2),heightAt(cx-ux*depth/2,cz-uz*depth/2),heightAt(cx,cz))+.045;g.translate(cx,y,cz);bars.push(g);
  }
 }
 if(bars.length){const paint=new THREE.Mesh(mergeGeometries(bars,false),new THREE.MeshLambertMaterial({color:'#e9e9df',polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));paint.receiveShadow=true;paint.name='crossings';group.add(paint);for(const g of bars)g.dispose();}
 // Power lines: three conductors on the crossarm (8.4 m) and a neutral below (7.1 m), sagging with span.
 const wire=[];const TOP=8.35,LOW=7.1,STEPS=8;
 for(const line of powerLines.lines)for(let i=1;i<line.length;i++){
  const [ax,az]=line[i-1],[bx,bz]=line[i],span=Math.hypot(bx-ax,bz-az);if(span<2||span>120)continue;
  const ay=heightAt(ax,az),by=heightAt(bx,bz),sag=Math.min(1.4,.006*span+.15),dx=bx-ax,dz=bz-az,L=span,px=-dz/L,pz=dx/L;
  for(const [off,h] of [[-.6,TOP],[0,TOP],[.6,TOP],[0,LOW]]){
   let prev=null;for(let s=0;s<=STEPS;s++){const t=s/STEPS,x=ax+dx*t+px*off,z=az+dz*t+pz*off,y=ay+(by-ay)*t+h-sag*4*t*(1-t);if(prev)wire.push(...prev,x,y,z);prev=[x,y,z];}
  }
 }
 if(wire.length){const w=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(wire,3)),new THREE.LineBasicMaterial({color:'#1d1f22',transparent:true,opacity:.85}));w.name='powerLines';w.frustumCulled=false;group.add(w);}
 // Lamps and bus stops as instanced posts.
 const post=new THREE.MeshStandardMaterial({color:'#4a4f52',roughness:.7}),bulb=new THREE.MeshStandardMaterial({color:'#f2e8c8',emissive:'#8a7a4a',emissiveIntensity:.35,roughness:.5}),plate=new THREE.MeshStandardMaterial({color:'#1f4d8f',roughness:.6});
 function batch(geometry,material,items,h,name){if(!items.length)return;const mesh=new THREE.InstancedMesh(geometry,material,items.length),o=new THREE.Object3D();items.forEach((p,i)=>{o.position.set(p.x,heightAt(p.x,p.z)+h,p.z);o.rotation.set(0,p.yaw||0,0);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.castShadow=true;mesh.name=name;group.add(mesh);}
 const lamps=furniture.lamps.filter(a=>!network.contains(a.x,a.z,-.5));
 batch(new THREE.CylinderGeometry(.07,.11,7,8),post,lamps,3.5,'lampPosts');batch(new THREE.CylinderGeometry(.22,.3,.32,10),bulb,lamps,7.05,'lampHeads');
 const stops=furniture.busStops.filter(a=>!network.contains(a.x,a.z,-.5)).map(a=>{const s=network.nearest(a.x,a.z,true);return {...a,yaw:s?Math.atan2(s.dx,s.dz):0};});
 batch(new THREE.CylinderGeometry(.04,.04,2.6,6),post,stops,1.3,'busPosts');batch(new THREE.BoxGeometry(.05,.5,.4),plate,stops,2.3,'busPlates');
 // Traffic signals: one pole-mounted head per inbound approach, facing that approach from the far side of the
 // junction on the driver's right (the usual post-mounted head, in view from the stop line). Lamps follow SignalSystem.
 const heads=[];
 for(const node of(lights&&lights.nodes)||[])for(const a of node.approaches){const rx=-a.hz,rz=a.hx,W=Math.max(6,Math.min(16,a.width||9)),far=Math.max(4,Math.min(9,(a.cross||9)/2+1.2));heads.push({x:a.vx+a.hx*far+rx*(W/2+.8),z:a.vz+a.hz*far+rz*(W/2+.8),yaw:Math.atan2(a.hx,a.hz),node,axis:a.axis});}
 if(heads.length){
  batch(new THREE.CylinderGeometry(.06,.08,4.6,8),post,heads,2.3,'signalPoles');
  const housing=new THREE.MeshStandardMaterial({color:'#2d3a2f',roughness:.8});batch(new THREE.BoxGeometry(.32,1.05,.3),housing,heads,4.25,'signalHeads');
  const lampMeshes=[];const OFF=new THREE.Color('#1b1d1f');
  for(const [dy,col] of [[.32,'#e0392b'],[0,'#f2c230'],[-.32,'#37b061']]){const lamp=new THREE.MeshBasicMaterial({color:'#ffffff'});const g=new THREE.SphereGeometry(.1,10,8);g.translate(0,0,.16);const mesh=new THREE.InstancedMesh(g,lamp,heads.length),o=new THREE.Object3D();heads.forEach((p,i)=>{o.position.set(p.x,heightAt(p.x,p.z)+4.25+dy,p.z);o.rotation.set(0,p.yaw,0);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);mesh.setColorAt(i,OFF);});mesh.name='signalLamps';group.add(mesh);lampMeshes.push({mesh,on:new THREE.Color(col),state:dy>0?'red':dy<0?'green':'yellow'});}
  group.userData.lights={heads,lamps:lampMeshes,update(){if(!lights)return;heads.forEach((h,i)=>{const st=lights.state(h.node,h.axis);for(const l of lampMeshes)l.mesh.setColorAt(i,l.state===st?l.on:OFF);});for(const l of lampMeshes)l.mesh.instanceColor.needsUpdate=true;}};
 }
 group.userData.audit={crossings:crossings.crossings.length,spans:wire.length/6/4,lamps:lamps.length,busStops:stops.length,signalHeads:heads.length};
 return group;
}
