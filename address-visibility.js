// Conservative footprint/height occlusion for DOM labels. A spatial grid avoids
// raycasting every merged facade mesh for every address on every frame.
export function addressVisibility(buildings,rows,heightAt){
 const heights=new Map();for(const h of rows)if(h.buildingId)heights.set(h.buildingId,Math.max(heights.get(h.buildingId)||0,h.height||8));
 const cells=new Map(),size=32;
 for(const b of buildings){
  const rings=b.rings;if(!rings?.length)continue;
  const points=rings.flat(),xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
  const item={id:b.id,rings,top:heightAt(...b.center)+(heights.get(b.id)||b.height||8)};
  for(let x=Math.floor(Math.min(...xs)/size);x<=Math.floor(Math.max(...xs)/size);x++)for(let z=Math.floor(Math.min(...zs)/size);z<=Math.floor(Math.max(...zs)/size);z++){
   const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);
  }
 }
 const inside=(ring,x,z)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
 return (camera,target,id)=>{
  const dx=target.x-camera.x,dz=target.z-camera.z,dy=target.y-camera.y,steps=Math.ceil(Math.hypot(dx,dz)/1.5);
  for(let i=1;i<steps;i++){
   const t=i/steps,x=camera.x+dx*t,z=camera.z+dz*t,y=camera.y+dy*t;
   for(const b of cells.get(Math.floor(x/size)+','+Math.floor(z/size))||[])if(b.id!==id&&y<b.top&&inside(b.rings[0],x,z)&&!b.rings.slice(1).some(r=>inside(r,x,z)))return true;
  }
  return false;
 };
}
