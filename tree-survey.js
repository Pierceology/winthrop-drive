import * as THREE from 'three';
// Optional reference markers; physical tree scenery is a separate default-on layer.
export function treeSurvey(data,heightAt){
 const group=new THREE.Group(),pickable=[];
 const accepted=new THREE.MeshBasicMaterial({color:'#7fe6a5',side:THREE.DoubleSide,transparent:true,opacity:.8});
 const pending=new THREE.MeshBasicMaterial({color:'#e9b765',side:THREE.DoubleSide,transparent:true,opacity:.65});
 for(const p of data.candidates.filter(p=>p.review!=='rejected')){
  const y=heightAt(p.x,p.z),ring=new THREE.Mesh(new THREE.RingGeometry(p.radius*.87,p.radius,28),p.review==='accepted'?accepted:pending);
  ring.rotation.x=-Math.PI/2;ring.position.set(p.x,y+.22,p.z);ring.userData.canopy=p;group.add(ring);pickable.push(ring);

 }
 group.visible=false;group.userData.pickable=pickable;return group;
}
