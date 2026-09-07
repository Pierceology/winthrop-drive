import * as THREE from 'three';
// OSM point locations are retained. Stop-control nodes receive estimated roadside mounts.
export function roadside(data,network,heightAt){
 const group=new THREE.Group(),brown=new THREE.MeshStandardMaterial({color:'#675347',roughness:1}),metal=new THREE.MeshStandardMaterial({color:'#9ba3a5',roughness:.6}),red=new THREE.MeshStandardMaterial({color:'#b93125',roughness:.7});
 function batch(geometry,material,items){const mesh=new THREE.InstancedMesh(geometry,material,items.length),o=new THREE.Object3D();items.forEach((p,i)=>{o.position.set(p.x,heightAt(p.x,p.z)+p.h,p.z);o.rotation.set(0,p.yaw||0,0);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
 const allPoles=data.assets.filter(a=>a.kind==='pole');const poles=allPoles.filter(a=>!network.contains(a.x,a.z,-.5)&&!network.obstructed(a.x,a.z));batch(new THREE.CylinderGeometry(.12,.19,8.8,7),brown,poles.map(a=>({...a,h:4.4})));batch(new THREE.BoxGeometry(1.7,.12,.12),brown,poles.map(a=>({...a,h:7.8})));
 const hydrants=data.assets.filter(a=>a.kind==='hydrant');batch(new THREE.CylinderGeometry(.16,.2,.65,10),red,hydrants.map(a=>({...a,h:.34})));batch(new THREE.SphereGeometry(.19,10,8),red,hydrants.map(a=>({...a,h:.7})));batch(new THREE.BoxGeometry(.58,.19,.2),metal,hydrants.map(a=>({...a,h:.45})));
 group.userData.audit={poles:poles.length,withheldPoles:allPoles.length-poles.length,hydrants:hydrants.length};return group;
}
