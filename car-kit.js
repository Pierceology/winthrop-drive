import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
// Kenney Car Kit (CC0, kenney.nl): a dozen everyday vehicles for the traffic and the garage.
// The kit faces +z at toy scale; each template is turned to face -z (the game's forward) and scaled to road size.
export const KIT=['sedan','sedan-sports','hatchback-sports','suv','suv-luxury','van','taxi','truck','delivery-flat','police','ambulance','garbage-truck'];
const SCALE={default:1.5,truck:1.6,'delivery-flat':1.6,'garbage-truck':1.7,ambulance:1.6};
export class CarKit{
 constructor(){this.templates=new Map();this.loader=new GLTFLoader();this.loading=new Map();}
 async load(name){if(this.templates.has(name))return this.templates.get(name);if(this.loading.has(name))return this.loading.get(name);
  const p=(async()=>{const {scene}=await this.loader.loadAsync('./assets/cars/'+name+'.glb');const s=SCALE[name]||SCALE.default;const root=new THREE.Group();root.name='kit:'+name;const turn=new THREE.Group();turn.rotation.y=Math.PI;turn.scale.setScalar(s);turn.add(scene);root.add(turn);
   scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material){o.material.metalness=0;o.material.roughness=.75;}}});
   this.templates.set(name,root);return root;})();this.loading.set(name,p);return p;}
 // A drivable copy: wheel meshes get a mount named the way wheel-rig expects (wheel_fl …) so they steer and spin.
 instance(template){const car=template.clone(true);const wheels=[];car.traverse(o=>{if(/^wheel-(front|back)-(left|right)$/.test(o.name))wheels.push(o);});
  for(const w of wheels){const mount=new THREE.Group();mount.name='wheel_'+(w.name.includes('front')?'f':'r')+(w.name.includes('left')?'l':'r');mount.position.copy(w.position);mount.quaternion.copy(w.quaternion);w.parent.add(mount);w.parent.remove(w);w.position.set(0,0,0);w.quaternion.identity();mount.add(w);}
  car.userData.wheels=[];car.traverse(o=>{if(/^wheel_[fr][lr]$/.test(o.name))car.userData.wheels.push(o);});car.userData.paint=null;return car;}
}
export const carKit=new CarKit();
