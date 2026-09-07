import * as THREE from 'three';
// Photograph registration preserves observed colors/openings. Depth and unseen walls remain estimates.
export function photoHouse(spec,base,building,registration,texture){
 const plan=spec.assessorPlan;
 const group=new THREE.Group(),W=plan?plan.mainWidthFeet*.3048:spec.width,D=plan?plan.mainDepthFeet*.3048:spec.depth,H=.65+Math.floor(spec.stories)*2.75;
 const white=new THREE.MeshStandardMaterial({color:'#d6d9d5',roughness:.95}),blue=new THREE.MeshStandardMaterial({color:'#345465',roughness:.95}),roof=new THREE.MeshStandardMaterial({color:'#42494d',roughness:.95});
 function mesh(g,m){const o=new THREE.Mesh(g,m);o.castShadow=true;o.receiveShadow=true;o.userData.ranges=[{end:g.index?.count||g.attributes.position.count,data:building}];group.add(o);return o;}
 function box(x,y,z,w,h,d,m){const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);return mesh(g,m);}
 const number=spec.address.split(' ')[0];
 // Keep side/back walls while allowing actual openings through the street-facing wall.
 const shell=new THREE.BoxGeometry(W,H,D).toNonIndexed(),sp=shell.attributes.position,sn=shell.attributes.normal,keep=[];for(let i=0;i<sp.count;i+=3)if(sn.getZ(i)<.9)for(let j=i;j<i+3;j++)keep.push(sp.getX(j),sp.getY(j)+H/2,sp.getZ(j));shell.dispose();const body=new THREE.BufferGeometry();body.setAttribute('position',new THREE.Float32BufferAttribute(keep,3));body.computeVertexNormals();mesh(body,white);
 const wallShape=new THREE.Shape([new THREE.Vector2(-W/2,0),new THREE.Vector2(W/2,0),new THREE.Vector2(W/2,H),new THREE.Vector2(-W/2,H)]);
 for(const opening of registration.front.openings||[])wallShape.holes.push(new THREE.Path(opening.outline.map(([u,v])=>new THREE.Vector2((u-.5)*W,v*H))));const frontWall=mesh(new THREE.ShapeGeometry(wallShape),number==='1040'?blue:white);frontWall.position.z=D/2+.009;
 // Rectify only the traced visible surfaces; occluded areas retain the underlying geometry.
 for(const side of ['front','right','left']){const p=registration[side];if(!p)continue;const shape=new THREE.Shape(p.outline.map(a=>new THREE.Vector2(...a)));for(const opening of p.openings||[])shape.holes.push(new THREE.Path(opening.outline.map(a=>new THREE.Vector2(...a))));const g=new THREE.ShapeGeometry(shape),pos=g.attributes.position,coords=[];
 for(let i=0;i<pos.count;i++){const u=pos.getX(i),v=pos.getY(i),m=p.matrix,q=m[6]*u+m[7]*v+m[8],px=m[0]*u+m[1]*v+m[2],py=m[3]*u+m[4]*v+m[5];coords.push(px/registration.size[0],q-py/registration.size[1],q);pos.setXYZ(i,(u-.5)*(side==='front'?W:D),v*H,0);}
 g.setAttribute('photoCoord',new THREE.Float32BufferAttribute(coords,3));
 const material=new THREE.MeshStandardMaterial({map:texture,roughness:.96,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});material.onBeforeCompile=s=>{s.vertexShader='attribute vec3 photoCoord;varying vec3 vPhoto;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPhoto=photoCoord;');s.fragmentShader='varying vec3 vPhoto;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>','#ifdef USE_MAP\ndiffuseColor.rgb*=texture2D(map,vPhoto.xy/vPhoto.z).rgb;\n#endif');};
 if(side==='front')for(const opening of p.openings||[]){
 const insetShape=new THREE.Shape(opening.outline.map(([u,v])=>new THREE.Vector2((u-.5)*W,v*H))),pane=new THREE.ShapeGeometry(insetShape),pp=pane.attributes.position,photo=[];
 for(let i=0;i<pp.count;i++){const u=pp.getX(i)/W+.5,v=pp.getY(i)/H,m=p.matrix,q=m[6]*u+m[7]*v+m[8];photo.push((m[0]*u+m[1]*v+m[2])/registration.size[0],q-(m[3]*u+m[4]*v+m[5])/registration.size[1],q);}
 pane.setAttribute('photoCoord',new THREE.Float32BufferAttribute(photo,3));const inset=mesh(pane,material);inset.position.z=D/2+.03-opening.depth;
 const reveal=[];for(let i=0;i<opening.outline.length;i++){const a=opening.outline[i],b=opening.outline[(i+1)%opening.outline.length],ax=(a[0]-.5)*W,ay=a[1]*H,bx=(b[0]-.5)*W,by=b[1]*H,z=D/2+.03,d=z-opening.depth;reveal.push(ax,ay,z,bx,by,z,bx,by,d,ax,ay,z,bx,by,d,ax,ay,d);}
 const rim=new THREE.BufferGeometry();rim.setAttribute('position',new THREE.Float32BufferAttribute(reveal,3));rim.computeVertexNormals();const lining=white.clone();lining.side=THREE.DoubleSide;mesh(rim,lining);
 }
 const o=mesh(g,material);if(side==='front')o.position.z=D/2+.03;else if(side==='right'){o.rotation.y=Math.PI/2;o.position.x=W/2+.03;}else{o.rotation.y=-Math.PI/2;o.position.x=-W/2-.03;}
 }
 if(number==='1040'){
  box(0,H+.1,0,W+.4,.22,D+.4,white);box(0,H+.23,0,W+.2,.08,D+.2,roof);
  // Separately dimensioned rear sections; unseen finishes and heights remain estimates.
  if(plan)for(const part of plan.rearSections){
   const w=part.widthFeet*.3048,d=part.depthFeet*.3048,x=-W/2+(part.leftFeet+part.widthFeet/2)*.3048,z=-D/2-d/2;
   const h=part.stories*2.75+.65;
   box(x,h/2,z,w,h,d,white);box(x,h+.06,z,w+.12,.12,d+.12,roof);
  }
  // The photographed cornice has repeated projecting brackets.
  for(let x=-W/2+.2;x<W/2;x+=.55)box(x,H-.14,D/2+.13,.12,.26,.3,white);
  for(let z=-D/2+.2;z<D/2;z+=.6)box(W/2+.12,H-.14,z,.28,.26,.12,white);
 }else{
  const peak=registration.front.outline.reduce((a,b)=>b[1]>a[1]?b:a),rise=(peak[1]-1)*H,ridge=(peak[0]-.5)*W,points=[[-W/2-.18,H,-D/2-.18],[W/2+.18,H,-D/2-.18],[W/2+.18,H,D/2+.18],[-W/2-.18,H,D/2+.18]],a=[ridge,H+rise,-D/2-.18],b=[ridge,H+rise,D/2+.18];
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([points[0],a,b,points[0],b,points[3],a,points[1],points[2],a,points[2],b].flat(),3));g.computeVertexNormals();roof.side=THREE.DoubleSide;mesh(g,roof);
  // Back gable is unobserved; retain a neutral geometric closure.
  const back=new THREE.BufferGeometry();back.setAttribute('position',new THREE.Float32BufferAttribute([points[0],points[1],a].flat(),3));back.computeVertexNormals();white.side=THREE.DoubleSide;mesh(back,white);
  box(0,H,D/2+.05,W+.28,.1,.15,white);
 }
 const wire=new THREE.Group(),lineMaterial=new THREE.LineBasicMaterial({color:0x8be8f0,depthTest:false,transparent:true,opacity:.8});for(const child of [...group.children])if(child.isMesh){const line=new THREE.LineSegments(new THREE.EdgesGeometry(child.geometry,20),lineMaterial);line.position.copy(child.position);line.quaternion.copy(child.quaternion);wire.add(line);}wire.visible=false;group.add(wire);group.userData.wire=wire;
 group.rotation.y=Math.atan2(spec.front[0],spec.front[1]);
 // Preserve the established street-facing plane when replacing the old envelope depth.
 const shift=plan?(spec.depth-D)/2:0;
 group.position.set(spec.center[0]+spec.front[0]*shift,base,spec.center[1]+spec.front[1]*shift);
 group.userData.assessorDimensions=plan?{width:W,depth:D}:null;group.userData.photographic=true;return group;
}
