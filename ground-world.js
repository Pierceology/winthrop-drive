import * as THREE from 'three';
import {RoadSurface,loadSurfaces} from './road-surface.js';

// Coordinates remain in the original local EPSG:26986 frame. The source
// triangle arrays are shared by the renderer and contact sampler.
export function gridHeight(t){return(x,z)=>{
 const u=Math.max(0,Math.min(t.cols-1,(x-t.x)/t.step)),v=Math.max(0,Math.min(t.rows-1,(z-t.z)/t.step));
 const i=Math.min(t.cols-2,Math.floor(u)),j=Math.min(t.rows-2,Math.floor(v)),a=u-i,b=v-j,h=(di,dj)=>t.values[(j+dj)*t.cols+i+di];
 return h(0,0)*(1-a)*(1-b)+h(1,0)*a*(1-b)+h(0,1)*(1-a)*b+h(1,1)*a*b;
};}
export function contactField(data,arrays){
 const fallback=gridHeight(data.terrain),ground=new RoadSurface(arrays.ground,fallback),walk=new RoadSurface(arrays.walk,fallback),road=new RoadSurface(arrays.road,fallback);
 // Return the base elevation: vehicle/contact callers add their existing .14 m.
 const sample=(x,z)=>{const r=road.sample(x,z);if(r!==null)return r-.12;const w=walk.sample(x,z);return w!==null?w-.12:ground.sample(x,z)??fallback(x,z);};
 return {height:sample,ground,walk,road};
}
function mesh(vertices,material){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();const m=new THREE.Mesh(geometry,material);m.receiveShadow=true;return m;}
function aerialMaterial(tiles,origin){
 const material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,side:THREE.DoubleSide});
 material.onBeforeCompile=s=>{
  s.vertexShader='varying vec2 landXZ;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nlandXZ=position.xz;');
  let declarations='varying vec2 landXZ;\n',body='vec3 landColor=vec3(.16,.20,.16);\n';
  // Broad orthophotos first, then the existing higher-resolution Shirley patch.
  [...tiles.slice(1),tiles[0]].forEach((tile,i)=>{
   const [a,b,c,d]=tile.bbox,box=[a-origin[0],origin[1]-d,c-origin[0],origin[1]-b];
   s.uniforms['landPhoto'+i]={value:tile.texture};s.uniforms['landBox'+i]={value:new THREE.Vector4(...box)};
   declarations+=`uniform sampler2D landPhoto${i};uniform vec4 landBox${i};\n`;
   body+=`{vec4 b=landBox${i};vec2 uv=(landXZ-b.xy)/(b.zw-b.xy);if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){vec4 photo=texture2D(landPhoto${i},vec2(uv.x,1.-uv.y));landColor=mix(landColor,photo.rgb,photo.a);}}\n`;
  });
  s.fragmentShader=declarations+s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n${body}\ndiffuseColor.rgb*=landColor;`);
 };
 material.customProgramCacheKey=()=> 'original-ground-aerial-'+tiles.length;
 return material;
}
export async function buildGroundWorld(data,tiles,origin,roadMaterial,groundMaterial=null){
 const arrays=await loadSurfaces(data,new URL('./',location.href)),field=contactField(data,arrays);
 const ground=mesh(arrays.ground,groundMaterial||aerialMaterial(tiles,origin)),road=mesh(arrays.road,roadMaterial);
 const walk=mesh(arrays.walk,new THREE.MeshStandardMaterial({color:'#a3a49e',roughness:1,side:THREE.DoubleSide}));
 const curb=mesh(arrays.curb,new THREE.MeshStandardMaterial({color:'#b3b5b1',roughness:1,side:THREE.DoubleSide}));
 for(const m of[ground,road,walk,curb])m.userData.previewTile=true;ground.userData.aerialTiles=tiles;ground.userData.origin=origin;road.userData.previewColor=[.115,.125,.132];
 road.userData.audit={...data.audit,triangles:data.surfaces.road.triangles,continuous:true};
 return {ground,road,walk,curb,field,arrays};
}
