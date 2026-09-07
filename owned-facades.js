import * as THREE from 'three';
import {allFacades} from './facade-store.js';
import {homography,validateFacade,wallFrame} from './facade-core.js';
export async function addOwnedFacades(parent,world,heightAt){
 let records;try{records=await allFacades();}catch{return {loaded:0,failed:0};}
 const buildings=new Map(world.buildings.map(b=>[b.id,b])),loader=new THREE.TextureLoader();let loaded=0,failed=0;
 for(const record of records){try{
 const r=validateFacade(record),b=buildings.get(r.building);if(!b)throw Error('Building missing');const {a,b:end,normal}=wallFrame(b,r.edge);
 const y=(b.base??heightAt(...b.center))+r.baseOffset,H=homography(r.corners),texture=await loader.loadAsync(r.image);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 const point=(p,h)=>[p[0]+normal[0]*.06,h,p[1]+normal[1]*.06],vertices=[point(a,y+r.height),point(end,y+r.height),point(end,y),point(a,y)],coords=[];
 for(const [u,v]of [[0,0],[1,0],[1,1],[0,1]]){const q=H[6]*u+H[7]*v+1;coords.push(H[0]*u+H[1]*v+H[2],q-(H[3]*u+H[4]*v+H[5]),q);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));g.setAttribute('photoCoord',new THREE.Float32BufferAttribute(coords,3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();
 const m=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2});m.onBeforeCompile=s=>{s.vertexShader='attribute vec3 photoCoord;varying vec3 vPhoto;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPhoto=photoCoord;');s.fragmentShader='varying vec3 vPhoto;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>','#ifdef USE_MAP\ndiffuseColor *= texture2D(map,vPhoto.xy/vPhoto.z);\n#endif');};
 const mesh=new THREE.Mesh(g,m);mesh.userData.originalFacade={building:b.id,edge:r.edge,source:r.source,checked:false};parent.add(mesh);(b.ownedPhotoWalls??=[]).push({source:r.source,rights:r.rights,edge:r.edge,height:r.height,measurement:r.measurement});loaded++;
 }catch{failed++;}}
 return {loaded,failed};
}
