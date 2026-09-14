/* qa/live-frame.js — plain node. Verifies live.js's lat/lon → EPSG:26986 → game-frame projection.
   1. Fixed check: three OSM nodes against pyproj (EPSG:4326 → EPSG:26986) values computed 2026-09-14; must agree < 0.01 m.
   2. Live check: fetch nodes of three OSM ways cited in data/world.json roads from Overpass, project them, and measure
      the distance from each node to the nearest centreline segment of the roads citing that way. The node at the median
      error for each way (three nodes) must be < 2 m, and the mean offset vector (a frame shift would show as bias) < 2 m.
   Run from the clone root:  node qa/live-frame.js */
import {readFileSync} from 'node:fs';
import {toMassMainland,toLocal} from '../live.js';

const PYPROJ=[ // node id, lat, lon, easting, northing (pyproj 3.6.1, EPSG:26986)
 [61339330,42.3710968,-70.9931324,241747.947,902412.215],
 [61339535,42.3603737,-70.9711273,243567.751,901232.154],
 [61340938,42.3793035,-70.9725177,243440.21,903334.07]];
let worst=0;
for(const [id,lat,lon,e,n] of PYPROJ){const [E,Nn]=toMassMainland(lat,lon);const err=Math.hypot(E-e,Nn-n);worst=Math.max(worst,err);
 console.log(`projection node ${id}: ours ${E.toFixed(3)},${Nn.toFixed(3)}  pyproj ${e},${n}  err ${err.toFixed(4)} m`);}
console.log(`projection vs pyproj: worst ${worst.toFixed(4)} m ${worst<0.01?'OK':'FAIL'}`);

const world=JSON.parse(readFileSync(new URL('../data/world.json',import.meta.url)));
const byWay=new Map(); // way id -> [[p0,p1],...] segments of every road citing it
for(const r of world.roads){const src=r.directionSources||[];for(let i=0;i<src.length&&i+1<r.points.length;i++){const m=/way\/(\d+)/.exec(src[i]||'');if(!m)continue;
 if(!byWay.has(m[1]))byWay.set(m[1],[]);byWay.get(m[1]).push([r.points[i],r.points[i+1]]);}}
const ways=[...byWay.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,3).map(e=>e[0]);
console.log('ways from world.json roads:',ways.map(w=>w+' ('+byWay.get(w).length+' segments)').join(', '));

const nearest=(p,[a,b])=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz||1;let t=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/l;t=Math.max(0,Math.min(1,t));const off=[p[0]-a[0]-dx*t,p[1]-a[1]-dz*t];return {d:Math.hypot(...off),off};};
const MIRRORS=['https://z.overpass-api.de/api/interpreter','https://lz4.overpass-api.de/api/interpreter','https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
let osm=null;
for(const host of MIRRORS){try{const r=await fetch(host+'?data='+encodeURIComponent(`[out:json][timeout:50];way(id:${ways.join(',')});(._;>;);out;`),{signal:AbortSignal.timeout(60000),headers:{'user-agent':'drive-winthrop-qa/1 (live-frame.js)'}});
 if(r.ok){const j=await r.json();if(j.elements){osm=j;console.log('overpass:',host);break;}}else console.log('overpass',host,r.status);}catch(e){console.log('overpass',host,e.message);}}
if(!osm){console.log('FAIL: no Overpass mirror answered');process.exit(1);}
const nodes=new Map(osm.elements.filter(e=>e.type==='node').map(n=>[n.id,n]));
let fails=0;
for(const w of osm.elements.filter(e=>e.type==='way')){const segs=byWay.get(String(w.id));
 const errs=w.nodes.map(id=>nodes.get(id)).filter(Boolean).map(n=>{const p=toLocal(n.lat,n.lon);let best=null;for(const s of segs){const r=nearest(p,s);if(!best||r.d<best.d)best=r;}return {id:n.id,p,d:best.d,off:best.off};});
 errs.sort((a,b)=>a.d-b.d);const median=errs[errs.length>>1].d,mid=errs[errs.length>>1];
 const bias=[errs.reduce((a,e)=>a+e.off[0],0)/errs.length,errs.reduce((a,e)=>a+e.off[1],0)/errs.length],biasLen=Math.hypot(...bias);
 console.log(`way ${w.id} (${w.tags?.name||'?'}): ${errs.length} nodes, median offset to road centreline ${median.toFixed(2)} m, worst ${errs[errs.length-1].d.toFixed(2)} m, mean offset vector (${bias[0].toFixed(2)}, ${bias[1].toFixed(2)}) = ${biasLen.toFixed(2)} m bias`);
 console.log(`  median node ${mid.id} → local x=${mid.p[0].toFixed(2)} z=${mid.p[1].toFixed(2)}  error ${mid.d.toFixed(2)} m ${mid.d<2?'OK':'FAIL'}`);
 if(mid.d>=2||biasLen>=2)fails++;}
console.log(fails?`FRAME CHECK FAIL (${fails} ways ≥ 2 m)`:'FRAME CHECK OK (all < 2 m)');
process.exit(fails?1:0);
