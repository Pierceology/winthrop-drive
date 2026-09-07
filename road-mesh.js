import * as THREE from 'three';
// Sample the actual rendered terrain triangles, so road and car elevations agree.
export function surfaceSampler(patches,source){return(x,z)=>{
 for(let i=patches.length-1;i>=0;i--){const p=patches[i],u=(x-p.x)/p.dx,v=(z-p.z)/p.dz;if(u<0||v<0||u>p.n||v>p.n)continue;
 const ix=Math.min(p.n-1,Math.floor(u)),iz=Math.min(p.n-1,Math.floor(v)),a=u-ix,b=v-iz;
 const h=(di,dj)=>source(p.x+(ix+di)*p.dx,p.z+(iz+dj)*p.dz)+p.offset;
 return a+b<=1?h(0,0)*(1-a-b)+h(1,0)*a+h(0,1)*b:h(1,1)*(a+b-1)+h(0,1)*(1-a)+h(1,0)*(1-b);
 }return source(x,z);
};}
export function roadMesh(roads,heightAt,imagery=[],origin=[243400,901150]){
 const vertices=[];
 const p=(x,z)=>[x,heightAt(x,z)+.12,z];
 function quad(a,b,c,d){vertices.push(...p(...a),...p(...c),...p(...b),...p(...b),...p(...c),...p(...d));}
 const joints=new Map();
 for(const r of roads){if([7,8].includes(r.type))continue;const w=(r.width||6)/2;
  for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.01)continue;
   const nx=-dz/len,nz=dx/len,n=Math.ceil(len/2.5),across=Math.ceil(2*w/2.5);
   for(let k=0;k<n;k++)for(let j=0;j<across;j++){
    const at=(t,s)=>[a[0]+dx*t+nx*s,a[1]+dz*t+nz*s];quad(at(k/n,-w+j*2*w/across),at(k/n,-w+(j+1)*2*w/across),at((k+1)/n,-w+j*2*w/across),at((k+1)/n,-w+(j+1)*2*w/across));
   }
  }
  for(const a of r.points){const key=a.map(v=>v.toFixed(2)).join(',');if(!joints.has(key)||joints.get(key).w<w)joints.set(key,{a,w});}
 }
 // Round joins close exposed wedges at every bend and road intersection.
 for(const {a,w}of joints.values()){const rings=Math.ceil(w/2.5),steps=Math.max(16,Math.ceil(w*5));for(let j=0;j<rings;j++)for(let i=0;i<steps;i++){
  const at=(rad,k)=>[a[0]+Math.cos(k/steps*Math.PI*2)*rad,a[1]+Math.sin(k/steps*Math.PI*2)*rad];quad(at(w*j/rings,i),at(w*j/rings,i+1),at(w*(j+1)/rings,i),at(w*(j+1)/rings,i+1));
 }}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();
 const material=asphaltMaterial();

 const mesh=new THREE.Mesh(g,material);mesh.receiveShadow=true;mesh.userData.audit={vertices:g.attributes.position.count,closedJoins:joints.size,photographic:false};return mesh;
}

export function asphaltMaterial(){
 const material=new THREE.MeshStandardMaterial({color:'#626360',roughness:.97,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
 material.color.set('#ffffff');
 material.onBeforeCompile=shader=>{
 shader.vertexShader='varying vec2 roadXZ;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nroadXZ=position.xz;');
 shader.fragmentShader='varying vec2 roadXZ;\n'+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float grain=fract(sin(dot(floor(roadXZ*72.),vec2(12.9898,78.233)))*43758.5453);
 float antialias=1.-smoothstep(.012,.07,max(length(dFdx(roadXZ)),length(dFdy(roadXZ))));
 grain=mix(.5,grain,antialias);
 float wear=sin(roadXZ.x*.28+roadXZ.y*.17)*sin(roadXZ.y*.21-roadXZ.x*.11);
 diffuseColor.rgb*=vec3(.115,.125,.132)*(0.93+grain*.14+wear*.035);`);
 };

 return material;
}
