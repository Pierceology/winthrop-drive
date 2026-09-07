import * as THREE from 'three';
export function makeWater(){
 const material=new THREE.ShaderMaterial({depthWrite:false,uniforms:{time:{value:0},sunDirection:{value:new THREE.Vector3(-.6,.7,.3)}},vertexShader:`varying vec3 world;void main(){world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,fragmentShader:`
 uniform float time;uniform vec3 sunDirection;varying vec3 world;
 void main(){vec2 p=world.xz;float a=p.x*.095+p.y*.073-time*.6;float b=p.x*.26-p.y*.19+time*.85;
 float footprint=max(length(dFdx(p)),length(dFdy(p)));float nearFade=1.-smoothstep(.3,2.,footprint);float farFade=1.-smoothstep(4.,25.,footprint);
 vec3 n=normalize(vec3((cos(a)*.035+cos(b)*.015)*nearFade,1.,(sin(a)*.032-sin(b)*.014)*nearFade));vec3 v=normalize(cameraPosition-world);float f=pow(1.-max(0.,dot(n,v)),3.);
 vec3 base=mix(vec3(.035,.16,.20),vec3(.36,.49,.55),f);float sparkle=pow(max(0.,dot(reflect(-normalize(sunDirection),n),v)),100.);
 float swell=sin(p.x*.007+p.y*.004-time*.12)*sin(p.y*.009-p.x*.003+time*.08)*.006*farFade;
 base+=swell+sparkle*vec3(1.,.84,.62)*.4;gl_FragColor=vec4(base,1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`.replace(';#include',';\n#include')});
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(100000,100000),material);mesh.rotation.x=-Math.PI/2;mesh.position.y=-.15;mesh.renderOrder=-1000;return mesh;
}
export class MapLabels{
 constructor(scene,roads,places,heightAt,onPlace){this.scene=scene;this.heightAt=heightAt;this.ground=new THREE.Group();scene.add(this.ground);this.labels=[];const textures=new Map();
 for(const r of roads){if(!r.name||r.name==='Unnamed road'||[7,8].includes(r.type))continue;let length=0;for(let i=1;i<r.points.length;i++)length+=Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1]);if(length<22)continue;
  let along=0;for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(along+len<length/2){along+=len;continue;}const t=(length/2-along)/len,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
   if(!textures.has(r.name)){const c=document.createElement('canvas');c.width=1024;c.height=96;const ctx=c.getContext('2d');ctx.font='600 42px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#f0ede0';ctx.fillText(r.name,512,48,1000);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;textures.set(r.name,texture);}
   const m=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(23,length*.6),2.1,12,2),new THREE.MeshBasicMaterial({map:textures.get(r.name),transparent:true,opacity:.8,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));m.rotation.set(-Math.PI/2,0,0);m.rotateZ(Math.atan2(-(b[1]-a[1]),b[0]-a[0]));m.geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(m.rotation));m.rotation.set(0,0,0);const vertices=m.geometry.attributes.position;for(let k=0;k<vertices.count;k++)vertices.setY(k,heightAt(x+vertices.getX(k),z+vertices.getZ(k))+.2);m.geometry.computeVertexNormals();m.position.set(x,0,z);this.ground.add(m);break;
  }
 }
 this.container=document.createElement('div');this.container.id='maplabels';document.body.append(this.container);
 const studio=document.body.classList.contains('studio');
 for(const p of places){if(!studio&&/^\d+[A-Z]?\s+\S/.test(p.name))continue;/* visitors see places and businesses, never a house number */
  const b=document.createElement('button');b.className='maplabel'+(p.business?' business':'');b.textContent=p.name;b.title=p.kind.replaceAll('_',' ');b.onclick=()=>onPlace(p);this.container.append(b);this.labels.push({p,element:b,position:new THREE.Vector3(p.x,heightAt(p.x,p.z)+10,p.z)});}
 }
 update(camera,focus,enabled=true){this.ground.visible=enabled;const max=camera.position.distanceTo(focus)>1000?3000:650;const boxes=[];
 for(const l of this.labels.sort((a,b)=>a.position.distanceToSquared(camera.position)-b.position.distanceToSquared(camera.position))){const p=l.position.clone().project(camera),x=(p.x*.5+.5)*innerWidth,y=(-p.y*.5+.5)*innerHeight,w=Math.min(240,l.p.name.length*7+22);const okay=enabled&&!this.occluded?.(camera.position,l.position,null)&&l.position.distanceTo(focus)<max&&p.z>-1&&p.z<1&&x>30&&x<innerWidth-30&&y>90&&y<innerHeight-120&&boxes.length<16&&!boxes.some(a=>Math.abs(a.x-x)<(a.w+w)/2&&Math.abs(a.y-y)<36);l.element.hidden=!okay;if(okay){l.element.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%)`;boxes.push({x,y,w});}}
 for(const m of this.ground.children)m.visible=m.position.distanceTo(focus)<450;
 }
}
export class CoastalTour{
 constructor(camera,controls,heightAt,onStop){Object.assign(this,{camera,controls,heightAt,onStop});this.active=false;}
 start(){this.active=true;this.elapsed=0;this.startPosition=this.camera.position.clone();this.startTarget=this.controls.target.clone();this.controls.enabled=false;this.controls.autoRotate=false;
 const shots=[{p:[200,45,95],t:[110,0,0],name:'The neighborhood'},{p:[470,100,-220],t:[160,0,-100],name:'Yirrell Beach'},{p:[1100,190,1350],t:[1100,0,800],name:'All of Deer Island'},{p:[-1100,650,1000],t:[-400,0,-650],name:'Winthrop by the sea'},{p:[-1300,360,-1700],t:[-800,0,-1350],name:'Home, from above'},{p:[180,55,100],t:[110,0,0],name:'Back to Shirley Street'}];
 this.positions=new THREE.CatmullRomCurve3([this.startPosition,...shots.map(s=>new THREE.Vector3(...s.p))],false,'centripetal');this.targets=new THREE.CatmullRomCurve3([this.startTarget,...shots.map(s=>new THREE.Vector3(s.t[0],this.heightAt(s.t[0],s.t[2])+5,s.t[2]))],false,'centripetal');this.shots=shots;document.body.classList.add('touring');}
 stop(){if(!this.active)return;this.active=false;this.controls.enabled=true;document.body.classList.remove('touring');this.onStop?.();}
 update(dt){if(!this.active)return;this.elapsed+=dt;const t=Math.min(1,this.elapsed/70),p=this.positions.getPoint(t),target=this.targets.getPoint(t);p.y=Math.max(p.y,this.heightAt(p.x,p.z)+18);this.camera.position.copy(p);this.controls.target.copy(target);this.camera.lookAt(target);document.getElementById('tourCaption').textContent=this.shots[Math.min(5,Math.floor(t*6))].name;if(t>=1)this.stop();}
}
