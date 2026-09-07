import * as THREE from 'three';

// Stable texture identities let houses remain in the scene while their nearby
// photographs load. Only a bounded set of decoded images stays resident.
export class PhotoTextures {
 constructor(entries,{anisotropy=4,capacity=36,concurrency=3,radius=650}={}){
  Object.assign(this,{capacity,concurrency,radius});this.pending=0;this.focus=[0,0];this.queue=[];
  this.placeholder=document.createElement('canvas');this.placeholder.width=this.placeholder.height=2;
  const ctx=this.placeholder.getContext('2d');ctx.fillStyle='#bfc6c1';ctx.fillRect(0,0,2,2);
  this.entries=entries.map(e=>{const texture=new THREE.CanvasTexture(this.placeholder);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=anisotropy;return {...e,texture,state:'idle',distance:Infinity};});
  this.textures=Object.fromEntries(this.entries.map(e=>[e.key,e.texture]));
 }
 update(x,z){
  this.focus=[x,z];for(const e of this.entries)e.distance=Math.hypot(e.center[0]-x,e.center[1]-z);
  const sorted=[...this.entries].sort((a,b)=>a.distance-b.distance);
  this.wanted=new Set(sorted.filter(e=>e.distance<this.radius).slice(0,this.capacity).map(e=>e.key));
  for(const e of this.entries)if(e.state==='ready'&&!this.wanted.has(e.key)){
   e.texture.dispose();e.texture.image=this.placeholder;e.texture.needsUpdate=true;e.state='idle';
  }
  this.queue=sorted.filter(e=>this.wanted.has(e.key)&&e.state==='idle');this.pump();
 }
 async load(e){
  e.state='loading';this.pending++;
  try{
   const image=new Image();image.decoding='async';image.src='./'+e.image;await image.decode();
   if(this.wanted.has(e.key)){
    const canvas=document.createElement('canvas'),scale=Math.min(1,1024/Math.max(image.width,image.height));
    canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    e.texture.image=canvas;e.texture.needsUpdate=true;e.state='ready';
   }else e.state='idle';
  }catch{e.state='failed';console.warn('House photograph unavailable:',e.key);}
  finally{this.pending--;this.pump();}
 }
 pump(){while(this.pending<this.concurrency&&this.queue.length){const e=this.queue.shift();if(e.state==='idle'&&this.wanted.has(e.key))this.load(e);}}
}
