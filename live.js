/* live.js — three real-time layers for Drive Winthrop, all from free keyless feeds.
   1. MBTA route 713 buses   (api-v3.mbta.com, JSON:API, polled every 10 s, positions eased between polls)
   2. Aircraft over the town (OpenSky bbox; read via the first CORS-readable source in AIRCRAFT_SOURCES, polled every 20 s, dead-reckoned with velocity)
   3. Tide at Boston 8443970 (NOAA CO-OPS, polled every 6 min, moves the water plane)
   Every fetch is fail-silent: a dead feed leaves the layer empty and the game running.

   Frame: EPSG:26986 (NAD83 / Massachusetts Mainland, Lambert Conformal Conic 2SP) minus origin
   [243400, 901150]; x = easting-243400, z = 901150-northing (z grows south), y = metres up, water y≈0.

   Mount (after window.__drive=driving; in app.js):
     import('./live.js').then(m=>{window.__live=m.liveWinthrop({scene,heightAt:surfaceAt,water});}).catch(()=>{});
*/
import * as THREE from './vendor/three.module.js';

/* ---------- Lambert Conformal Conic 2SP, EPSG:26986 on GRS80 ---------- */
const A=6378137,FLAT=1/298.257222101,E=Math.sqrt(2*FLAT-FLAT*FLAT),D=Math.PI/180;
const LAT1=42.6833333333*D,LAT2=41.7166666667*D,LAT0=41*D,LON0=-71.5*D,FE=200000,FN=750000;
const mOf=p=>Math.cos(p)/Math.sqrt(1-E*E*Math.sin(p)*Math.sin(p));
const tOf=p=>Math.tan(Math.PI/4-p/2)/Math.pow((1-E*Math.sin(p))/(1+E*Math.sin(p)),E/2);
const N=Math.log(mOf(LAT1)/mOf(LAT2))/Math.log(tOf(LAT1)/tOf(LAT2));
const FC=mOf(LAT1)/(N*Math.pow(tOf(LAT1),N));
const R0=A*FC*Math.pow(tOf(LAT0),N);
/** lat/lon (degrees, WGS84≈NAD83) → [easting, northing] metres in EPSG:26986 */
export function toMassMainland(lat,lon){
 const r=A*FC*Math.pow(tOf(lat*D),N),th=N*(lon*D-LON0);
 return [FE+r*Math.sin(th),FN+R0-r*Math.cos(th)];
}
export const ORIGIN=[243400,901150];
/** lat/lon → [x, z] in the game frame */
export function toLocal(lat,lon){const [e,n]=toMassMainland(lat,lon);return [e-ORIGIN[0],ORIGIN[1]-n];}
/** compass bearing (deg clockwise from north) → three.js rotation.y for a model whose nose points +x */
export const yawFromBearing=b=>Math.PI/2-b*D;

/* ---------- feeds ---------- */
export const FEEDS={
 buses:'https://api-v3.mbta.com/vehicles?filter[route]=713',
 predictions:'https://api-v3.mbta.com/predictions?filter[route]=713&include=stop,trip&sort=departure_time&page[limit]=16',
 aircraft:'https://opensky-network.org/api/states/all?lamin=42.33&lomin=-71.05&lamax=42.42&lomax=-70.93',
 tide:'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&station=8443970&date=latest&datum=MLLW&units=metric&time_zone=lst_ldt&format=json'
};
/* Aircraft sources, tried in order until one yields data, then locked (measured 2026-09-14 from a browser page):
   OpenSky anonymous answers curl but sends Access-Control-Allow-Origin: https://opensky-network.org, so no web page
   can read it; api.adsb.lol sends no CORS header at all. The only keyless path that reads from a page today is adsb.lol
   through the public allorigins relay. adsb.lol records are normalised to OpenSky state rows below. */
export const AIRCRAFT_BOX={lamin:42.33,lomin:-71.05,lamax:42.42,lomax:-70.93};
const ADSB_LOL='https://api.adsb.lol/v2/lat/42.375/lon/-70.99/dist/5';
export const AIRCRAFT_SOURCES=[
 {name:'winthropbythesea relay',url:'https://www.winthropbythesea.com/_functions/aircraft',parse:fromAdsbLol},   // WBTS backend fetches adsb.lol server-side and answers with CORS (live after the next editor Publish)
 {name:'opensky',url:FEEDS.aircraft,parse:j=>j&&Array.isArray(j.states)?j:null},
 {name:'adsb.lol',url:ADSB_LOL,parse:fromAdsbLol},
 {name:'adsb.lol via allorigins',url:'https://api.allorigins.win/raw?url='+encodeURIComponent(ADSB_LOL),parse:fromAdsbLol}
];
const FT=.3048,KT=.514444,FPM=.00508;
/** adsb.lol / readsb v2 {ac:[...],now:ms} → OpenSky-shaped {time,states:[[icao,callsign,country,time_position,last_contact,lon,lat,baro_alt,on_ground,velocity,true_track,vertical_rate,sensors,geo_alt]]} inside AIRCRAFT_BOX */
function fromAdsbLol(j){
 if(!j||!Array.isArray(j.ac))return null;const now=(Number(j.now)||Date.now())/1000,B=AIRCRAFT_BOX;
 const states=j.ac.filter(a=>Number.isFinite(a.lat)&&Number.isFinite(a.lon)&&a.lat>=B.lamin&&a.lat<=B.lamax&&a.lon>=B.lomin&&a.lon<=B.lomax).map(a=>{
  const ground=a.alt_baro==='ground',baro=Number.isFinite(a.alt_baro)?a.alt_baro*FT:null,geo=Number.isFinite(a.alt_geom)?a.alt_geom*FT:null,tp=now-(Number(a.seen_pos)||0);
  return [a.hex,a.flight||'','',tp,now-(Number(a.seen)||0),a.lon,a.lat,baro,ground,Number.isFinite(a.gs)?a.gs*KT:null,Number.isFinite(a.track)?a.track:null,Number.isFinite(a.baro_rate)?a.baro_rate*FPM:null,null,geo];});
 return {time:now,states};
}
/* Tide mapping: NOAA reports metres above MLLW. Mean tide at Boston is ~1.5 m MLLW and the game's water
   plane already sits at mean tide, so water.y = (water.y at mount) + (level - MEAN_TIDE_MLLW). */
export const MEAN_TIDE_MLLW=1.5;

async function getJSON(url,ms=12000){
 try{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  const r=await fetch(url,{signal:c.signal});clearTimeout(t);
  if(!r.ok)return {error:r.status};return await r.json();
 }catch(e){return null;}
}
/** walk AIRCRAFT_SOURCES from the locked one; returns {json,source} or null */
async function getAircraft(state){
 const order=state.locked?[state.locked,...AIRCRAFT_SOURCES.filter(s=>s!==state.locked)]:AIRCRAFT_SOURCES;
 for(const src of order){const j=await getJSON(src.url);if(j&&j.error===429)return {error:429};const parsed=j&&!j.error?src.parse(j):null;if(parsed){state.locked=src;return {json:parsed,source:src.name};}}
 state.locked=null;return null;
}

/* ---------- small builders ---------- */
function labelSprite(text,{bg='#f2c11c',fg='#111',w=128,h=64,size=44}={}){
 const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
 g.fillStyle=bg;g.beginPath();g.roundRect(2,2,w-4,h-4,14);g.fill();
 g.fillStyle=fg;g.font=`900 ${size}px system-ui,Helvetica,Arial`;g.textAlign='center';g.textBaseline='middle';g.fillText(text,w/2,h/2+2);
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
 const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:true,transparent:true}));s.scale.set(3,1.5,1);return s;
}
const MAT={silver:new THREE.MeshStandardMaterial({color:0xc9cfd4,metalness:.35,roughness:.5}),
 yellow:new THREE.MeshStandardMaterial({color:0xf2c11c,roughness:.6}),glass:new THREE.MeshStandardMaterial({color:0x1d2a33,roughness:.2,metalness:.4}),
 rubber:new THREE.MeshStandardMaterial({color:0x151515,roughness:.95}),white:new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}),
 shadow:new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.18,depthWrite:false})};
/** box bus, nose along +x, wheels on y=0: 11 × 2.5 × 3 m, MBTA silver with a yellow band */
function makeBus(){
 const g=new THREE.Group();const add=(geo,mat,x,y,z,rx=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.x=rx;m.castShadow=true;g.add(m);return m;};
 add(new THREE.BoxGeometry(11,3,2.5),MAT.silver,0,2.0,0);
 add(new THREE.BoxGeometry(11.04,.5,2.54),MAT.yellow,0,1.45,0);
 add(new THREE.BoxGeometry(11.04,.95,2.54),MAT.glass,0,2.65,0);
 add(new THREE.BoxGeometry(.06,1.6,2.3),MAT.glass,5.52,2.4,0);
 const wheel=new THREE.CylinderGeometry(.5,.5,.35,14);
 for(const x of[-3.6,3.6])for(const z of[-1.15,1.15])add(wheel,MAT.rubber,x,.5,z,Math.PI/2);
 const tag=labelSprite('713');tag.position.set(0,5.2,0);g.add(tag);
 return g;
}
/** white plane silhouette, nose along +x, ~36 m long / 36 m span, with a fin */
function makePlane(){
 const s=new THREE.Shape();
 s.moveTo(18,0);s.lineTo(14,1.5);s.lineTo(2,1.6);s.lineTo(-8,17);s.lineTo(-11,17);s.lineTo(-6,1.6);s.lineTo(-13,1.3);s.lineTo(-17,6);s.lineTo(-19,6);s.lineTo(-18,1);
 s.lineTo(-18,-1);s.lineTo(-19,-6);s.lineTo(-17,-6);s.lineTo(-13,-1.3);s.lineTo(-6,-1.6);s.lineTo(-11,-17);s.lineTo(-8,-17);s.lineTo(2,-1.6);s.lineTo(14,-1.5);s.closePath();
 const g=new THREE.Group();const body=new THREE.Mesh(new THREE.ShapeGeometry(s),MAT.white);body.rotation.x=-Math.PI/2;g.add(body);
 const f=new THREE.Shape();f.moveTo(-11,0);f.lineTo(-18,6);f.lineTo(-19,6);f.lineTo(-18,0);f.closePath();
 g.add(new THREE.Mesh(new THREE.ShapeGeometry(f),MAT.white));
 const sh=new THREE.Mesh(new THREE.ShapeGeometry(s),MAT.shadow);sh.rotation.x=-Math.PI/2;sh.name='shadow';g.add(sh);
 return g;
}
const lerpAngle=(a,b,t)=>{let d=(b-a+Math.PI)%(2*Math.PI);if(d<0)d+=2*Math.PI;return a+(d-Math.PI)*t;};

/* ---------- the layers ---------- */
export function liveWinthrop({scene,heightAt=()=>0,water=null,camera=null,controls=null,intervals={}}={}){
 const I={buses:10000,predictions:30000,aircraft:20000,tide:360000,...intervals};
 const group=new THREE.Group();group.name='live';scene.add(group);
 const ground=(x,z)=>{const y=heightAt(x,z);return Number.isFinite(y)?y:0;};
 const now=()=>performance.now();
 const buses=new Map(),aircraft=new Map();let following=null;   // declared up here: tick() runs before the follow block below is reached
 const live={group,buses,aircraft,tide:null,counts:{buses:0,aircraft:0,polls:{buses:0,aircraft:0,tide:0}},errors:{buses:0,aircraft:0,tide:0},toLocal,toMassMainland};

 /* buses: each record eases from where it was drawn to the new fix over one poll interval */
 live.ingestBuses=json=>{
  const rows=json&&Array.isArray(json.data)?json.data:[];const seen=new Set(),t=now();
  for(const v of rows){const a=v.attributes||{};if(!Number.isFinite(a.latitude)||!Number.isFinite(a.longitude))continue;
   const [x,z]=toLocal(a.latitude,a.longitude),yaw=yawFromBearing(Number.isFinite(a.bearing)?a.bearing:0);seen.add(v.id);
   let b=buses.get(v.id);
   if(!b){b={mesh:makeBus(),x,z,yaw,from:{x,z,yaw},to:{x,z,yaw},t0:t,label:a.label,status:a.current_status};b.mesh.position.set(x,ground(x,z),z);b.mesh.rotation.y=yaw;group.add(b.mesh);buses.set(v.id,b);}
   else{b.from={x:b.x,z:b.z,yaw:b.yaw};b.to={x,z,yaw:Number.isFinite(a.bearing)?yaw:b.yaw};b.t0=t;b.status=a.current_status;}
   b.miss=0;}
  for(const [id,b] of buses){if(seen.has(id))continue;if(++b.miss>=2){group.remove(b.mesh);buses.delete(id);}}
  live.counts.buses=buses.size;return buses.size;
 };
 /* aircraft: dead-reckon from the fix with velocity along true_track; a fresh fix that disagrees with the drawn
    position is blended out over 3 s so nothing snaps */
 live.ingestAircraft=json=>{
  const rows=json&&Array.isArray(json.states)?json.states:[];const seen=new Set(),t=now();
  const feedTime=Number.isFinite(json?.time)?json.time:Date.now()/1000;
  for(const s of rows){const [icao,cs,,tpos,,lon,lat,baro,onGround,vel,track,vrate,,geo]=s;
   if(onGround||!Number.isFinite(lat)||!Number.isFinite(lon))continue;
   const alt=Number.isFinite(baro)?baro:(Number.isFinite(geo)?geo:0);const [x,z]=toLocal(lat,lon);
   const age=Math.max(0,feedTime-(tpos||feedTime));const v=Number.isFinite(vel)?vel:0,tr=(Number.isFinite(track)?track:0)*D,vr=Number.isFinite(vrate)?vrate:0;
   const fix={x:x+Math.sin(tr)*v*age,z:z-Math.cos(tr)*v*age,y:alt+vr*age,vx:Math.sin(tr)*v,vz:-Math.cos(tr)*v,vy:vr,yaw:yawFromBearing(Number.isFinite(track)?track:0),t0:t};
   seen.add(icao);let p=aircraft.get(icao);
   if(!p){p={mesh:makePlane(),callsign:(cs||'').trim(),...fix,ox:0,oz:0,oy:0};const tag=labelSprite(p.callsign||icao,{bg:'#ffffff',size:34});tag.position.set(0,6,0);tag.scale.set(14,7,1);p.mesh.add(tag);group.add(p.mesh);aircraft.set(icao,p);}
   else{const cur=pos(p,t);p.ox=cur.x-fix.x;p.oz=cur.z-fix.z;p.oy=cur.y-fix.y;Object.assign(p,fix);}
   p.miss=0;}
  for(const [id,p] of aircraft){if(seen.has(id))continue;if(++p.miss>=3){group.remove(p.mesh);aircraft.delete(id);}}
  live.counts.aircraft=aircraft.size;return aircraft.size;
 };
 function pos(p,t){const dt=(t-p.t0)/1000,k=Math.max(0,1-dt/3);return {x:p.x+p.vx*dt+p.ox*k,z:p.z+p.vz*dt+p.oz*k,y:p.y+p.vy*dt+p.oy*k};}
 /* tide */
 const waterBase=water?water.position.y:0;
 live.ingestTide=json=>{
  const row=json&&Array.isArray(json.data)?json.data[0]:null;const v=row?parseFloat(row.v):NaN;if(!Number.isFinite(v))return null;
  live.tide={level:v,time:row.t,y:Math.round((waterBase+(v-MEAN_TIDE_MLLW))*1000)/1000};if(water)water.position.y=live.tide.y;return live.tide;
 };

 /* per-frame easing; runs on its own rAF so mounting needs no hook in the game loop */
 let raf=0,stopped=false;
 function tick(){if(stopped)return;raf=requestAnimationFrame(tick);const t=now();
  if(following){const b=buses.get(following);
   if(!b||(typeof document!=='undefined'&&document.body.classList.contains('driving'))){following=null;renderChip();}
   else if(camera&&controls){let dx=b.to.x-b.from.x,dz=b.to.z-b.from.z;const L=Math.hypot(dx,dz);if(L>.5){b.dir=[dx/L,dz/L];}const d=b.dir||[0,1];
    const y=ground(b.x,b.z);const gx=b.x-d[0]*30,gz=b.z-d[1]*30,gy=y+12;
    camera.position.x+=(gx-camera.position.x)*.06;camera.position.y+=(gy-camera.position.y)*.06;camera.position.z+=(gz-camera.position.z)*.06;
    controls.target.x+=(b.x-controls.target.x)*.12;controls.target.y+=(y+2-controls.target.y)*.12;controls.target.z+=(b.z-controls.target.z)*.12;}}
  for(const b of buses.values()){const k=Math.min(1,(t-b.t0)/I.buses);b.x=b.from.x+(b.to.x-b.from.x)*k;b.z=b.from.z+(b.to.z-b.from.z)*k;b.yaw=lerpAngle(b.from.yaw,b.to.yaw,k);
   b.mesh.position.set(b.x,ground(b.x,b.z),b.z);b.mesh.rotation.y=b.yaw;}
  for(const p of aircraft.values()){const c=pos(p,t);p.mesh.position.set(c.x,c.y,c.z);p.mesh.rotation.y=p.yaw;
   const sh=p.mesh.getObjectByName('shadow');if(sh)sh.position.y=ground(c.x,c.z)+.3-c.y;}
 }
 tick();

 /* pollers — fail-silent, back off on 429, skip while the tab is hidden */
 const timers=[];
 const air={locked:null};live.aircraftSource=null;
 function poll(name,ingest){let wait=I[name];const run=async()=>{if(stopped)return;
   if(typeof document==='undefined'||!document.hidden){let j;if(name==='aircraft'){const r=await getAircraft(air);j=r&&r.json?r.json:r;live.aircraftSource=r&&r.source||null;}else j=await getJSON(FEEDS[name]);live.counts.polls[name]++;
    if(j&&!j.error){try{ingest(j);}catch(e){}wait=I[name];}else{live.errors[name]++;if(j&&j.error===429)wait=Math.min(wait*2,300000);}}
   timers.push(setTimeout(run,wait));};run();}
 /* Follow a bus, and its next stop with the time (Pierce, 09-14: "show me the live busses so people can follow them and the time").
    Predictions come from the same MBTA API (keyless); the first prediction per vehicle, sorted by time, is its next stop. */
 const preds=new Map();live.predictions=preds;
 live.ingestPredictions=json=>{const inc=new Map((json.included||[]).map(i=>[i.type+':'+i.id,i]));preds.clear();
  for(const p of (json.data||[])){const veh=p.relationships&&p.relationships.vehicle&&p.relationships.vehicle.data;if(!veh)continue;const a=p.attributes||{};const when=a.departure_time||a.arrival_time;if(!when)continue;
   const stop=inc.get('stop:'+p.relationships.stop.data.id),trip=inc.get('trip:'+p.relationships.trip.data.id);
   if(!preds.has(veh.id))preds.set(veh.id,{stop:stop?stop.attributes.name:'',headsign:trip?trip.attributes.headsign:'',when});}
  renderChip();return preds.size;};
 const chip=typeof document!=='undefined'?document.createElement('div'):null;if(chip){chip.id='liveChip';chip.hidden=true;document.body.appendChild(chip);}
 function renderChip(){if(!chip)return;if(!buses.size){chip.hidden=true;return;}chip.hidden=false;chip.textContent='';
  for(const [id,b] of buses){const p=preds.get(id);const el=document.createElement('button');el.className='bus'+(following===id?' on':'');
   const when=p&&p.when?new Date(p.when):null;const mins=when?Math.max(0,Math.round((when-Date.now())/60000)):null;
   const line=p?('to '+p.headsign+' · '+p.stop+(when?' · '+when.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+(mins!==null?' ('+(mins===0?'now':mins+' min')+')':''):'')):String(b.status||'').toLowerCase().replace(/_/g,' ');
   const bb=document.createElement('b');bb.textContent='713 bus'+(b.label?' '+b.label:'');const sp=document.createElement('span');sp.textContent=line;const em=document.createElement('em');em.textContent=following===id?'Following · tap to stop':'Follow this bus';
   el.append(bb,sp,em);el.onclick=()=>live.follow(following===id?null:id);chip.append(el);}}
 live.follow=id=>{following=id&&buses.has(id)?id:null;if(following&&controls)controls.autoRotate=false;renderChip();return following;};
 live.following=()=>following;
 if(typeof addEventListener==='function')addEventListener('pointerdown',e=>{if(following&&e.target&&e.target.tagName==='CANVAS'){following=null;renderChip();}},{passive:true});
 const chipTimer=setInterval(renderChip,15000);
 poll('buses',j=>{live.ingestBuses(j);renderChip();});poll('predictions',live.ingestPredictions);poll('aircraft',live.ingestAircraft);poll('tide',live.ingestTide);

 live.stop=()=>{stopped=true;cancelAnimationFrame(raf);clearInterval(chipTimer);for(const t of timers)clearTimeout(t);if(chip)chip.remove();scene.remove(group);};
 return live;
}
