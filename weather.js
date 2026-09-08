import * as THREE from 'three';
// Weather for the whole town: sky, fog, light, and falling rain or snow around the camera. Works with the evening drive.
const MODES={
 clear:{sky:'#a2bdc9',night:'#142237',fog:[4500,18000],nightFog:[2500,12000],hemi:2,sun:1.6},
 overcast:{sky:'#b7bec3',night:'#111b26',fog:[2200,11000],nightFog:[1500,8000],hemi:1.55,sun:.5},
 fog:{sky:'#c7cdd0',night:'#0f171d',fog:[40,700],nightFog:[30,450],hemi:1.4,sun:.3},
 rain:{sky:'#8d99a2',night:'#0d151d',fog:[700,5500],nightFog:[400,3500],hemi:1.25,sun:.35,drops:2600,fall:14,size:[.012,.55],color:'#c9d3d8'},
 snow:{sky:'#d0d7db',night:'#141c24',fog:[260,2600],nightFog:[200,1800],hemi:1.75,sun:.55,drops:2200,fall:1.6,size:[.09,.09],color:'#ffffff',drift:.8},
};
export class Weather{
 constructor({scene,hemi,sun}){Object.assign(this,{scene,hemi,sun});this.mode='clear';this.night=false;this.particles=null;this.box=[70,40,70];}
 bind(ids){this.selects=ids.map(id=>document.getElementById(id)).filter(Boolean);for(const el of this.selects)el.onchange=e=>this.set(e.target.value);}
 set(mode){if(!MODES[mode])return;this.mode=mode;for(const el of this.selects||[])el.value=mode;this.apply();}
 apply(){const m=MODES[this.mode],night=this.night;this.scene.background.set(night?m.night:m.sky);this.scene.fog.color.copy(this.scene.background);const [near,far]=night?m.nightFog:m.fog;this.scene.fog.near=near;this.scene.fog.far=far;
  this.hemi.intensity=night?.3:m.hemi;this.sun.intensity=night?.15:m.sun;this.sun.castShadow=this.mode==='clear'||this.mode==='overcast';
  if(this.particles){this.scene.remove(this.particles);this.particles.geometry.dispose();this.particles.material.dispose();this.particles=null;}
  if(m.drops){const n=m.drops,[w,h,d]=this.box,pos=new Float32Array(n*6),vel=new Float32Array(n);for(let i=0;i<n;i++){const x=(Math.random()-.5)*w,y=Math.random()*h,z=(Math.random()-.5)*d;pos.set([x,y,z,x,y-m.size[1],z],i*6);vel[i]=m.fall*(.8+Math.random()*.4);}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));const mat=new THREE.LineBasicMaterial({color:m.color,transparent:true,opacity:this.mode==='snow'?.9:.45});const lines=new THREE.LineSegments(g,mat);lines.frustumCulled=false;lines.userData={vel,m};this.particles=lines;this.scene.add(lines);}
 }
 update(dt,camera){const p=this.particles;if(!p||!camera)return;const {vel,m}=p.userData,a=p.geometry.attributes.position.array,[w,h,d]=this.box,n=vel.length,cx=camera.position.x,cy=camera.position.y,cz=camera.position.z;p.position.set(cx,cy-h*.35,cz);
  for(let i=0;i<n;i++){const k=i*6;let y=a[k+1]-vel[i]*dt;if(m.drift){a[k]+=Math.sin(y*.7+i)*m.drift*dt;a[k+2]+=Math.cos(y*.5+i)*m.drift*dt;}
   if(y<-h*.35){y=h*.65;a[k]=(Math.random()-.5)*w;a[k+2]=(Math.random()-.5)*d;}a[k+1]=y;a[k+3]=a[k];a[k+4]=y-m.size[1];a[k+5]=a[k+2];}
  p.geometry.attributes.position.needsUpdate=true;}
}
