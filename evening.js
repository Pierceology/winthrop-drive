import * as THREE from 'three';
export class EveningDrive{
 constructor(scene,heightAt){this.active=false;this.heightAt=heightAt;this.lights=[];for(const side of[-.65,.65]){const light=new THREE.SpotLight(0xfff0cf,0,90,.38,.6,1.4);light.userData.side=side;light.target=new THREE.Object3D();scene.add(light,light.target);this.lights.push(light);}}
 update(state,driving){for(const light of this.lights){light.intensity=this.active&&driving?85:0;if(!state)continue;const fx=-Math.sin(state.yaw),fz=-Math.cos(state.yaw),rx=Math.cos(state.yaw),rz=-Math.sin(state.yaw);light.position.set(state.x+fx*1.8+rx*light.userData.side,this.heightAt(state.x,state.z)+.9,state.z+fz*1.8+rz*light.userData.side);light.target.position.set(state.x+fx*36,this.heightAt(state.x+fx*36,state.z+fz*36)+.15,state.z+fz*36);}}
}
