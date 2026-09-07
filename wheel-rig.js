import * as THREE from 'three';
const UP=new THREE.Vector3(0,1,0),AXLE=new THREE.Vector3(1,0,0);
export function rigWheels(model){const wheels=[];model.traverse(o=>{if(!/^wheel_[fr][lr]$/.test(o.name))return;wheels.push({mount:o,base:o.quaternion.clone(),spin:0,rotating:o.children.filter(c=>c.name!=='brake').map(node=>({node,base:node.quaternion.clone()}))});});return wheels;}
export function updateWheels(wheels,speed,steer,dt){for(const w of wheels){w.spin=(w.spin-speed*dt/.34)%(Math.PI*2);w.mount.quaternion.setFromAxisAngle(UP,w.mount.name.startsWith('wheel_f')?steer:0).multiply(w.base);const roll=new THREE.Quaternion().setFromAxisAngle(AXLE,w.spin);for(const c of w.rotating)c.node.quaternion.copy(roll).multiply(c.base);}}
