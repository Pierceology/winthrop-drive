import * as THREE from 'three';
import {makeResidence} from './residential.js';
import {homography} from './facade-core.js';
// Partial photographed surfaces on the existing individual house geometry.
// Hidden elevations and metric heights remain estimates.
export function additionalPhotoHouse(spec,base,building,registration,texture){
 spec={...spec,...registration.modelFlags};
 let bodySpec={...spec,photoSurfaces:registration.surfaces};
 const carport=spec.carportUMax||0;
 if(carport){bodySpec={...bodySpec,width:spec.width*(1-carport),photoSurfaces:registration.surfaces.map(s=>['front','porch'].includes(s.plane)?{...s,uMin:Math.max(0,((s.uMin??0)-carport)/(1-carport)),uMax:Math.min(1,((s.uMax??1)-carport)/(1-carport))}:s)};}
 const group=makeResidence(bodySpec,base,building);
 if(carport){
  const shift=spec.width*carport/2;for(const child of group.children)child.position.x+=shift;
  const width=spec.width*carport,x=-spec.width/2+width/2,H=.65+2.75*Math.floor(spec.wallFloors??spec.stories);
  const roof=new THREE.MeshStandardMaterial({color:'#555957',roughness:.95}),post=new THREE.MeshStandardMaterial({color:spec.trim,roughness:.9});
  const add=(geometry,material,x,y,z)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;m.userData.ranges=[{end:geometry.index.count,data:building}];group.add(m);};
  add(new THREE.BoxGeometry(width+.15,.16,spec.depth+.25),roof,x,H-.15,0);
  for(const z of[-spec.depth/2+.16,spec.depth/2-.16])add(new THREE.BoxGeometry(.14,H-.2,.14),post,-spec.width/2+.12,(H-.2)/2,z);
  group.userData.spec=spec;
 }
 const W=spec.width,D=spec.depth,porch=spec.porch?Math.min(2.35,D*.21):0,front=D/2-porch,H=.65+Math.floor(spec.stories)*2.75,depth=D-porch,cz=-porch/2;
 const wire=new THREE.Group(),lineMat=new THREE.LineBasicMaterial({color:0x8be8f0,depthTest:false});
 for(const surface of registration.surfaces){
 const matrix=homography(surface.anchors.map(([x,y])=>[x/registration.size[0],y/registration.size[1]]));let vertices;
 const lo=surface.bottom,hi=surface.top;
 if(surface.plane==='front'||surface.plane==='porch'){const z=(surface.plane==='front'?front:D/2)+.045,left=((surface.uMin??0)-.5)*W,right=((surface.uMax??1)-.5)*W;vertices=[[left,hi,z],[right,hi,z],[right,lo,z],[left,lo,z]];}
 else if(surface.plane==='right'||surface.plane==='porchRight'){const near=surface.plane==='right'?front:D/2,far=surface.plane==='right'?-D/2:front,a=near+(far-near)*(surface.uMin??0),b=near+(far-near)*(surface.uMax??1);vertices=[[W/2+.045,hi,a],[W/2+.045,hi,b],[W/2+.045,lo,b],[W/2+.045,lo,a]];}
 else if(surface.plane==='left'){const a=-D/2+(front+D/2)*(surface.uMin??0),b=-D/2+(front+D/2)*(surface.uMax??1);vertices=[[-W/2-.045,hi,a],[-W/2-.045,hi,b],[-W/2-.045,lo,b],[-W/2-.045,lo,a]];}
 else{const rise=Math.min(3.1,Math.min(W,depth)*.3),z=cz+depth*.25+.72,y=H+rise*(spec.dormerBaseRise??.43);vertices=[[-.775,y+1.1,z],[.775,y+1.1,z],[.775,y-.1,z],[-.775,y-.1,z]];}
 let uvCorners=[[0,0],[1,0],[1,1],[0,1]],indices=[0,1,2,0,2,3];
 if(surface.outline){uvCorners=surface.outline;const z=(surface.plane==='porch'?D/2:front)+(surface.offset??.065),left=surface.uMin??0,span=(surface.uMax??1)-left;vertices=uvCorners.map(([u,v])=>[(left+u*span-.5)*W,hi+(lo-hi)*v,z]);indices=[];for(let i=1;i<vertices.length-1;i++)indices.push(0,i,i+1);}
 const coords=[];for(const[u,v]of uvCorners){const q=matrix[6]*u+matrix[7]*v+1;coords.push(matrix[0]*u+matrix[1]*v+matrix[2],q-(matrix[3]*u+matrix[4]*v+matrix[5]),q);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));g.setAttribute('photoCoord',new THREE.Float32BufferAttribute(coords,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvCorners.flatMap(([u,v])=>[u,1-v]),2));g.setIndex(indices);g.computeVertexNormals();
 const material=new THREE.MeshStandardMaterial({map:texture,roughness:.96,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});material.onBeforeCompile=s=>{s.vertexShader='attribute vec3 photoCoord;varying vec3 vPhoto;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPhoto=photoCoord;');s.fragmentShader='varying vec3 vPhoto;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>','#ifdef USE_MAP\ndiffuseColor.rgb*=texture2D(map,vPhoto.xy/vPhoto.z).rgb;\n#endif');};
 const mesh=new THREE.Mesh(g,material);mesh.receiveShadow=true;mesh.userData.ranges=[{end:indices.length,data:building}];mesh.userData.photographedSurface=surface.name;group.add(mesh);wire.add(new THREE.LineSegments(new THREE.EdgesGeometry(g),lineMat));
 }
 wire.visible=false;group.add(wire);group.userData.wire=wire;group.userData.photographic=true;group.userData.partialPhotograph=true;return group;
}
