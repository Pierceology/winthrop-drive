import * as THREE from 'three';

export function coverageStats(rows){
 const matched=new Set(rows.filter(h=>h.buildingId).map(h=>h.buildingId));
 const photos=new Set(rows.filter(h=>h.buildingId&&h.kind==='Photographic surfaces').map(h=>h.buildingId));
 return {matched:matched.size,photos:photos.size,estimated:matched.size-photos.size,addressOnly:rows.filter(h=>!h.buildingId).length};
}

export class CoverageMap{
 constructor({world,catalog,photos,scene,heightAt,onVisit,onCenter,onStreet,onReview}){
  this.world=world;this.photos=photos;this.onVisit=onVisit;this.canvas=document.getElementById('coverageMap');this.ctx=this.canvas.getContext('2d');
  const stats=coverageStats(catalog.houses),fmt=n=>n.toLocaleString();
  document.getElementById('coverageNumbers').innerHTML=`<div><b>${fmt(stats.photos)}</b><span>with photo walls</span></div><div><b>${fmt(stats.estimated)}</b><span>estimated exteriors</span></div>`;
  const note=document.createElement('p');note.className='coverage-note';note.textContent=`${fmt(stats.matched)} matched residential buildings · ${fmt(stats.addressOnly)} additional addresses have parcel locations only.`;document.getElementById('coverageNumbers').after(note);
  document.getElementById('coverageReview').onclick=onReview;
  const streets=[...new Set(photos.map(h=>h.street||h.address.replace(/^\S+\s+/,'')))];
  const parent=document.getElementById('photoStreets');
  for(const street of streets.sort((a,b)=>b.localeCompare(a))){const entries=photos.filter(h=>(h.street||h.address.replace(/^\S+\s+/,''))===street);const button=document.createElement('button');button.innerHTML='<strong></strong><span></span>';button.querySelector('strong').textContent=street.replace(/\b\w+/g,s=>s[0]+s.slice(1).toLowerCase());button.querySelector('span').textContent=entries.length+' buildings · partial photo walls';button.onclick=()=>{onStreet(street,entries);button.classList.add('selected');};parent.append(button);}
  const points=world.buildings.map(h=>h.center).concat(world.roads.flatMap(r=>r.points));
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const scale=Math.min(552/(maxX-minX),382/(maxZ-minZ));this.map=p=>[300+(p[0]-(minX+maxX)/2)*scale,215+(p[1]-(minZ+maxZ)/2)*scale];this.unmap=p=>[(p[0]-300)/scale+(minX+maxX)/2,(p[1]-215)/scale+(minZ+maxZ)/2];
  this.base=document.createElement('canvas');this.base.width=600;this.base.height=430;const c=this.base.getContext('2d');c.fillStyle='#142631';c.fillRect(0,0,600,430);c.strokeStyle='#4b636d';c.lineWidth=1;
  for(const road of world.roads){c.beginPath();road.points.forEach((p,i)=>{const[x,y]=this.map(p);i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke();}
  c.fillStyle='#8c999c';for(const b of world.buildings){c.beginPath();b.rings[0].forEach((p,i)=>{const[x,y]=this.map(p);i?c.lineTo(x,y):c.moveTo(x,y)});c.fill();}
  c.fillStyle='#efb568';c.strokeStyle='#3ddc84';c.lineWidth=2;for(const h of photos){const[x,y]=this.map(h.center);c.beginPath();c.arc(x,y,3.5,0,Math.PI*2);c.fill();c.stroke();}/* green ring = photo walls done (Pierce, 2026-09-08) */
  c.font='18px system-ui';c.fillStyle='#c3d2d7';c.fillText('N ↑',553,30);c.font='16px system-ui';c.fillText('DEER ISLAND',365,413);
  this.canvas.onclick=e=>{const box=this.canvas.getBoundingClientRect(),p=[(e.clientX-box.left)*600/box.width,(e.clientY-box.top)*430/box.height];const close=photos.map(h=>({h,d:Math.hypot(...this.map(h.center).map((v,i)=>v-p[i]))})).sort((a,b)=>a.d-b.d)[0];if(close?.d<12)onVisit(close.h);else onCenter(this.unmap(p));};
  const vertices=[];const ids=new Set(photos.map(h=>h.id));for(const b of world.buildings.filter(b=>ids.has(b.id))){for(const ring of b.rings)for(let i=1;i<ring.length;i++)for(const p of [ring[i-1],ring[i]])vertices.push(p[0],heightAt(...p)+.3,p[1]);}
  this.outlines=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)),new THREE.LineBasicMaterial({color:'#f4b965',depthTest:true}));scene.add(this.outlines);
  document.getElementById('coverageLayer').onchange=e=>this.outlines.visible=e.target.checked;
  this.update({x:0,z:0});
 }
 update(target){if(document.body.classList.contains('driving'))return;this.ctx.drawImage(this.base,0,0);const[x,y]=this.map([target.x,target.z]);this.ctx.strokeStyle='#84e3eb';this.ctx.lineWidth=2;this.ctx.beginPath();this.ctx.arc(x,y,9,0,Math.PI*2);this.ctx.stroke();this.ctx.fillStyle='#84e3eb';this.ctx.fillRect(x-2,y-2,4,4);}
}
