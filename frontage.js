// Match the address street to existing source road names before choosing a stop.
// This never geocodes an invented address or changes the mapped road geometry.
export function streetName(name=''){
 const suffixes={ST:'STREET',AVE:'AVENUE',AV:'AVENUE',RD:'ROAD',DR:'DRIVE',CT:'COURT',PL:'PLACE',TER:'TERRACE',LN:'LANE',BLVD:'BOULEVARD',CIR:'CIRCLE',PKWY:'PARKWAY'};
 return name.toUpperCase().replace(/[.]/g,'').replace(/\s+/g,' ').trim().split(' ').map(w=>suffixes[w]||w).join(' ');
}
const indexes=new WeakMap();
export function houseStop(house,network){
 let index=indexes.get(network);if(!index){const all=network.segments.filter(s=>s.length>8&&s.width>=3),streets=new Map();for(const s of all){const name=streetName(s.name);if(!streets.has(name))streets.set(name,[]);streets.get(name).push(s);}index={all,streets};indexes.set(network,index);}
 const [x,z]=house.center,wanted=streetName(house.street||house.address.replace(/^\S+\s+/,''));
 const closest=list=>{let best=null;for(const s of list){const t=Math.max(.05,Math.min(.95,((x-s.a[0])*s.dx+(z-s.a[1])*s.dz)/s.length**2)),px=s.a[0]+s.dx*t,pz=s.a[1]+s.dz*t,d=Math.hypot(x-px,z-pz);if(!best||d<best.d)best={segment:s,x:px,z:pz,d,matched:streetName(s.name)===wanted};}return best;};
 const named=closest(index.streets.get(wanted)||[]);return named&&named.d<100?named:closest(index.all);
}

// Frame a house from a point on its mapped street, at pedestrian camera height.
// This is an inspection viewpoint; it does not move the parked vehicle.
export function houseView(house,network,stop,extent=16){
 const desired=Math.max(20,Math.min(38,extent*.8+10));let best=null;
 for(const s of network.segments){
  if(streetName(s.name)!==streetName(stop.segment.name))continue;
  for(let i=0;i<=8;i++){
   const t=i/8,x=s.a[0]+s.dx*t,z=s.a[1]+s.dz*t;
   const fromStop=Math.hypot(x-stop.x,z-stop.z);if(fromStop>42)continue;
   const dx=x-house.center[0],dz=z-house.center[1],distance=Math.hypot(dx,dz);if(distance<12||distance>60)continue;
   const facing=house.front?(dx*house.front[0]+dz*house.front[1])/distance:1;
   const score=Math.abs(distance-desired)+fromStop*.12+Math.max(0,.55-facing)*45;
   if(!best||score<best.score)best={x,z,score};
  }
 }
 return best||{x:stop.x,z:stop.z};
}
