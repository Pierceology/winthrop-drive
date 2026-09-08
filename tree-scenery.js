import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

// Repeatable artist-built models placed at source-screened crown centers.
// Height, species and trunk position remain estimates. No vehicle collisions.
export async function treeScenery(data,heightAt,network,canopyAreas={placements:[]}){
 const group=new THREE.Group(),pickable=[],loader=new GLTFLoader();
 const files=['tree_oak_dark','tree_detailed_dark','tree_pineRoundC','tree_pineTallA_detailed'];
 const leafPalette=['#516b3e','#5a7148','#405b3b','#496140'];
 const models=await Promise.all(files.map(async (name,variant)=>{
  const {scene}=await loader.loadAsync('./assets/trees/'+name+'.glb');
  scene.traverse(o=>{if(!o.isMesh)return;o.material=o.material.clone();o.material.metalness=0;o.material.roughness=1;o.material.color.set(o.material.name.toLowerCase().includes('leaf')?leafPalette[variant]:'#695747');});
  const box=new THREE.Box3().setFromObject(scene),size=box.getSize(new THREE.Vector3());
  scene.updateMatrixWorld(true);
  const parts=[];scene.traverse(o=>{if(!o.isMesh)return;let g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);if(g.index)g=g.toNonIndexed();for(const key of Object.keys(g.attributes))if(!['position','normal'].includes(key))g.deleteAttribute(key);const color=o.material.color,colors=new Float32Array(g.attributes.position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=color.r;colors[i+1]=color.g;colors[i+2]=color.b;}g.setAttribute('color',new THREE.BufferAttribute(colors,3));parts.push(g);});
  const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());
  return {scene,box,size,geometry};
 }));
 let withheld=0;
 for(const p of data.candidates.filter(p=>p.review==='accepted')){
  if(network.contains(p.x,p.z,-1)||network.obstructed(p.x,p.z)){withheld++;continue;}
  const seed=[...p.id].reduce((s,c)=>(s*31+c.charCodeAt(0))>>>0,0),m=models[seed%models.length];
  const root=new THREE.Group(),tree=m.scene.clone(true),height=THREE.MathUtils.clamp(p.radius*2.6,5.5,19);
  const scale=2*p.radius/Math.max(m.size.x,m.size.z);tree.scale.set(scale,height/m.size.y,scale);tree.position.set(-(m.box.min.x+m.box.max.x)*.5*scale,-m.box.min.y*height/m.size.y,-(m.box.min.z+m.box.max.z)*.5*scale);
  tree.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.canopy=p;pickable.push(o);}});
  root.add(tree);root.position.set(p.x,heightAt(p.x,p.z),p.z);root.rotation.y=(seed%360)*Math.PI/180;group.add(root);
 }
 const screened=group.children.length,cells=new Map(),dummy=new THREE.Object3D();let areaCount=0,areaWithheld=0;
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
 const lite=window.__lowMemory;let ti=0;
 for(const p of canopyAreas.placements){if(lite&&(ti++%2))continue;
  if(heightAt(p.x,p.z)<.12||network.contains(p.x,p.z,-1)||network.obstructed(p.x,p.z)||data.candidates.some(c=>c.review==='accepted'&&Math.hypot(p.x-c.x,p.z-c.z)<c.radius+3)){areaWithheld++;continue;}
  const seed=Math.abs(Math.round(p.x*17+p.z*31)),m=models[seed%models.length],radius=p.radius||3.2,height=THREE.MathUtils.clamp(p.height||radius*2.8,p.height?3.5:6,p.height?26:16),scale=radius*2/Math.max(m.size.x,m.size.z);
  const g=m.geometry.clone();g.translate(-(m.box.min.x+m.box.max.x)/2,-m.box.min.y,-(m.box.min.z+m.box.max.z)/2);g.scale(scale,height/m.size.y,scale);
  dummy.position.set(p.x,heightAt(p.x,p.z),p.z);dummy.rotation.set(0,(seed%360)*Math.PI/180,0);dummy.updateMatrix();g.applyMatrix4(dummy.matrix);
  const key=Math.floor(p.x/220)+','+Math.floor(p.z/220);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(g);areaCount++;
 }
 for(const geometries of cells.values()){const mesh=new THREE.Mesh(mergeGeometries(geometries,false),material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);geometries.forEach(g=>g.dispose());}
 models.forEach(m=>m.geometry.dispose());
 group.userData={pickable,count:screened+areaCount,screened,areaCount,areaWithheld,withheld,source:'Kenney Nature Kit · CC0',position:'Screened crown centers and mapped canopy area; trunk locations, heights and species estimated'};
 return group;
}
