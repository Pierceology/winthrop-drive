import * as THREE from 'three';
export const compassYaw={N:Math.PI,NE:Math.PI*.75,E:Math.PI*.5,SE:Math.PI*.25,S:0,SW:-Math.PI*.25,W:-Math.PI*.5,NW:-Math.PI*.75};
export function trafficSigns(data,heightAt){
 const group=new THREE.Group(),pickable=[],cache=new Map(),metal=new THREE.MeshStandardMaterial({color:'#909b9d',roughness:.65});
 for(const a of data.signs){if(compassYaw[a.orientation]===undefined)continue;
 const stop=a.code==='R1-1',entry=a.code==='R5-1',oneway=a.code.startsWith('R6-1'),green=a.code.startsWith('D1'),key=a.code+' '+a.text;
 if(!cache.has(key)){
 const c=document.createElement('canvas');c.width=512;c.height=oneway?192:512;const t=c.getContext('2d'),w=c.width,h=c.height;t.fillStyle=green?'#155c3e':'#f0eee6';
 if(stop){t.beginPath();for(let i=0;i<8;i++){const rad=Math.PI/8+i*Math.PI/4;t.lineTo(w/2+Math.cos(rad)*247,h/2+Math.sin(rad)*247)}t.closePath();t.fillStyle='#b21c22';t.fill();t.strokeStyle='white';t.lineWidth=13;t.stroke();t.fillStyle='white';t.font='bold 130px Arial';t.textAlign='center';t.textBaseline='middle';t.fillText('STOP',256,264);}
 else if(entry){t.fillRect(0,0,w,h);t.fillStyle='#b21c22';t.beginPath();t.arc(256,256,239,0,Math.PI*2);t.fill();t.fillStyle='white';t.fillRect(55,222,402,68);t.font='bold 54px Arial';t.textAlign='center';t.fillText('DO NOT',256,174);t.fillText('ENTER',256,368);}
 else if(oneway){t.fillRect(0,0,w,h);t.fillStyle='#101518';t.beginPath();t.moveTo(15,96);t.lineTo(118,18);t.lineTo(118,45);t.lineTo(490,45);t.lineTo(490,147);t.lineTo(118,147);t.lineTo(118,176);t.closePath();t.fill();t.fillStyle='white';t.font='bold 59px Arial';t.textAlign='center';t.fillText('ONE WAY',302,118);}
 else{t.fillRect(0,0,w,h);t.strokeStyle=green?'white':'#24292a';t.lineWidth=10;t.strokeRect(12,12,w-24,h-24);t.fillStyle=green?'white':a.code.startsWith('R7')?'#a92126':'#172124';t.textAlign='center';t.textBaseline='middle';const words=a.text.split(/\s+/),lines=[];let line='';for(const word of words){if((line+' '+word).trim().length>13){lines.push(line);line=word;}else line=(line+' '+word).trim();}if(line)lines.push(line);t.font='bold '+Math.min(85,350/lines.length)+'px Arial';lines.forEach((l,i)=>t.fillText(l,256,256+(i-(lines.length-1)/2)*100,460));}
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;cache.set(key,new THREE.MeshStandardMaterial({map:tex,transparent:true,alphaTest:.2,roughness:.45}));}
 const width=Math.max(.4,Math.min(3,a.width*.0254||.76)),height=Math.max(.25,Math.min(3,a.height*.0254||.76)),clearance=Math.max(1.2,Math.min(4,a.clearance*.0254||2));
 const mount=new THREE.Group();mount.position.set(a.x,heightAt(a.x,a.z),a.z);mount.rotation.y=compassYaw[a.orientation];
 const pole=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,clearance+height*.5,6),metal);pole.position.y=(clearance+height*.5)/2;mount.add(pole);
 const back=new THREE.Mesh(stop?new THREE.CircleGeometry(.5,8):new THREE.PlaneGeometry(1,1),metal);if(stop)back.geometry.rotateZ(Math.PI/8);back.scale.set(width,height,1);back.position.y=clearance+height/2;back.rotation.y=Math.PI;mount.add(back);
 const plate=new THREE.Mesh(new THREE.PlaneGeometry(width,height),cache.get(key));plate.position.set(0,clearance+height/2,.015);plate.userData.streetSign={...a,url:data.url+'/'+a.id};mount.add(plate);pickable.push(plate);pole.castShadow=true;group.add(mount);
 }
 group.userData.pickable=pickable;group.userData.count=pickable.length;return group;
}
