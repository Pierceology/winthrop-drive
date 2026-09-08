import * as THREE from 'three';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

// Street furniture from OpenStreetMap, at OSM's positions: painted crossings across the through road,
// power lines hung between consecutive pole nodes, street lamps and bus-stop posts. Nothing here is guessed
// beyond road width (the mapped inventory width, else 9 m) and the standard shapes of the objects.
export function streetFurniture({crossings,powerLines,furniture},network,heightAt){
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
 // Traffic signals: one pole-mounted head per approach, on the driver's right 8 m before the mapped node.
 const heads=[];
 for(const sg of furniture.signals||[]){
  for(const s of network.segments){
   if(!(s.width>=3)||s.length<12)continue;const t=((sg.x-s.a[0])*s.dx+(sg.z-s.a[1])*s.dz)/(s.length*s.length),px=s.a[0]+s.dx*t,pz=s.a[1]+s.dz*t;
   if(t<-.05||t>1.05||Math.hypot(px-sg.x,pz-sg.z)>7)continue;
   const ends=[];if(t>.15)ends.push(s.a);if(t<.85)ends.push(s.b);
   for(const [fx,fz] of ends){let dx=fx-sg.x,dz=fz-sg.z;const L=Math.hypot(dx,dz)||1;dx/=L;dz/=L;if(L<12)continue;const hx=-dx,hz=-dz,rx=-hz,rz=hx,W=Math.max(6,Math.min(16,s.width||9));
    heads.push({x:sg.x+dx*8+rx*(W/2+.8),z:sg.z+dz*8+rz*(W/2+.8),yaw:Math.atan2(hx,hz)});}
  }
 }
 if(heads.length){
  batch(new THREE.CylinderGeometry(.06,.08,4.6,8),post,heads,2.3,'signalPoles');
  const housing=new THREE.MeshStandardMaterial({color:'#2d3a2f',roughness:.8});batch(new THREE.BoxGeometry(.32,1.05,.3),housing,heads,4.25,'signalHeads');
  for(const [dy,col] of [[.32,'#d23b2f'],[0,'#e0b52a'],[-.32,'#2f9e57']]){const lamp=new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:.5});const g=new THREE.SphereGeometry(.1,10,8);g.translate(0,0,.16);batch(g,lamp,heads,4.25+dy,'signalLamp'+dy);}
 }
 group.userData.audit={crossings:crossings.crossings.length,spans:wire.length/6/4,lamps:lamps.length,busStops:stops.length,signalHeads:heads.length};
 return group;
}
