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
/* Airlines that fly Logan, by ICAO callsign prefix: name + tail colour. Unknown prefixes keep the callsign and a grey tail. */
const AIRLINES={JBU:['JetBlue','#0a3d91'],DAL:['Delta','#c8102e'],AAL:['American','#0a4a8f'],UAL:['United','#1b3f8b'],SWA:['Southwest','#f9b612'],ASA:['Alaska','#01426a'],
 FFT:['Frontier','#1a7a3e'],NKS:['Spirit','#ffd200'],ACA:['Air Canada','#d22630'],BAW:['British Airways','#1e3a8a'],AFR:['Air France','#0b2d8f'],DLH:['Lufthansa','#f4c400'],
 EIN:['Aer Lingus','#0a7d5b'],VIR:['Virgin Atlantic','#c8102e'],KLM:['KLM','#00a1de'],ICE:['Icelandair','#f7c500'],QTR:['Qatar Airways','#5c0632'],UAE:['Emirates','#d71921'],
 CPA:['Cathay Pacific','#006564'],JAL:['Japan Airlines','#c8102e'],TAP:['TAP Portugal','#00a54f'],IBE:['Iberia','#d7192d'],SAS:['SAS','#000f5c'],SWR:['Swiss','#e30613'],
 FDX:['FedEx','#4d148c'],UPS:['UPS','#5b3a1a'],RPA:['Republic','#1b5faa'],EDV:['Endeavor','#c8102e'],JIA:['PSA','#0a4a8f'],ENY:['Envoy','#0a4a8f'],SKW:['SkyWest','#1b3f8b'],
 PDT:['Piedmont','#0a4a8f'],KAP:['Cape Air','#0a4a8f'],GJS:['GoJet','#1b3f8b'],CNS:['Cape Air','#0a4a8f'],ELY:['El Al','#1d4b9b'],THY:['Turkish','#c8102e'],
 ETH:['Ethiopian','#2f7d3a'],AZA:['ITA','#0b3c8c'],EJA:['NetJets','#0a2c5a'],LXJ:['Flexjet','#8a1b2e'],XOJ:['XOJet','#333']};
export function airlineOf(callsign){const cs=String(callsign||'').trim();const m=cs.match(/^([A-Z]{3})(\d+[A-Z]?)$/);if(!m||!AIRLINES[m[1]])return {name:cs||'Aircraft',flight:'',color:'#8a9198',text:cs||'Aircraft'};
 const [name,color]=AIRLINES[m[1]];return {name,flight:m[2],color,text:name+' '+m[2]};}
/** an airliner, nose along +x, 1.5× real (about 55 m long) so it reads from the ground; white fuselage, airline tail */
const PLANE_MAT={body:new THREE.MeshStandardMaterial({color:0xf4f6f8,roughness:.45,metalness:.15}),belly:new THREE.MeshStandardMaterial({color:0x9aa3ab,roughness:.6,metalness:.2}),
 engine:new THREE.MeshStandardMaterial({color:0xd8dde2,roughness:.4,metalness:.4}),glass:new THREE.MeshStandardMaterial({color:0x1b2630,roughness:.2,metalness:.5})};
function wingShape(rootFront,rootBack,span,tipFront,tipBack){const w=new THREE.Shape();w.moveTo(rootFront,0);w.lineTo(tipFront,span);w.lineTo(tipBack,span);w.lineTo(rootBack,0);w.closePath();return w;}
function makePlane(callsign){
 const al=airlineOf(callsign);const g=new THREE.Group();
 const add=(geo,mat,x,y,z,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;g.add(m);return m;};
 add(new THREE.CapsuleGeometry(1.9,30,6,18),PLANE_MAT.body,0,0,0,0,0,Math.PI/2);                       // fuselage
 add(new THREE.CapsuleGeometry(1.6,26,4,14),PLANE_MAT.belly,-.5,-.55,0,0,0,Math.PI/2);                  // darker belly
 add(new THREE.BoxGeometry(2.2,.7,3.2),PLANE_MAT.glass,13.6,.9,0);                                       // cockpit glass
 const wing=new THREE.ExtrudeGeometry(wingShape(3,-4.5,16.5,-7.5,-10),{depth:.45,bevelEnabled:false});
 for(const side of [1,-1]){const w=add(wing,PLANE_MAT.body,0,-.9,0,side===1?-Math.PI/2:Math.PI/2,0,0);w.rotation.x+=side*.06;w.scale.set(1,1,1);if(side===-1)w.scale.z=1;
  add(new THREE.CylinderGeometry(1.15,1.25,4.6,16),PLANE_MAT.engine,-1.2,-2.4,side*6.2,0,0,Math.PI/2);
  add(new THREE.CylinderGeometry(.9,.9,.4,16),PLANE_MAT.glass,1.2,-2.4,side*6.2,0,0,Math.PI/2);}
 const stab=new THREE.ExtrudeGeometry(wingShape(-13.5,-16.5,6.5,-16.5,-18),{depth:.3,bevelEnabled:false});
 for(const side of [1,-1])add(stab,PLANE_MAT.body,0,.6,0,side===1?-Math.PI/2:Math.PI/2,0,0);
 const finShape=new THREE.Shape();finShape.moveTo(-11,1.2);finShape.lineTo(-16.5,8.5);finShape.lineTo(-18.5,8.5);finShape.lineTo(-18.2,1.2);finShape.closePath();
 add(new THREE.ExtrudeGeometry(finShape,{depth:.35,bevelEnabled:false}),new THREE.MeshStandardMaterial({color:al.color,roughness:.5}),0,0,-.17);
 g.scale.setScalar(1.5);
 /* ground shadow: the planform, flat, sized to the model */
 const plan=new THREE.Shape();plan.moveTo(16,0);plan.lineTo(3,2);plan.lineTo(-7.5,16.5);plan.lineTo(-10,16.5);plan.lineTo(-4.5,2);plan.lineTo(-13.5,2);plan.lineTo(-16.5,6.5);plan.lineTo(-18,6.5);plan.lineTo(-17,1.5);
 plan.lineTo(-17,-1.5);plan.lineTo(-18,-6.5);plan.lineTo(-16.5,-6.5);plan.lineTo(-13.5,-2);plan.lineTo(-4.5,-2);plan.lineTo(-10,-16.5);plan.lineTo(-7.5,-16.5);plan.lineTo(3,-2);plan.closePath();
 const sh=new THREE.Mesh(new THREE.ShapeGeometry(plan),MAT.shadow);sh.rotation.x=-Math.PI/2;sh.name='shadow';g.add(sh);
 return g;
}
/** a small screen-sized name tag: same pixel size at any distance */
function nameTag(text,color){
 const c=document.createElement('canvas');c.width=512;c.height=96;const g=c.getContext('2d');
 g.fillStyle='rgba(12,17,22,.82)';g.beginPath();g.roundRect(2,2,c.width-4,c.height-4,24);g.fill();g.fillStyle=color;g.fillRect(2,2,14,c.height-4);
 g.fillStyle='#fff';g.font='700 46px system-ui,Helvetica,Arial';g.textAlign='center';g.textBaseline='middle';g.fillText(text,c.width/2+6,c.height/2+2);
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
 const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true,sizeAttenuation:false}));s.scale.set(.07,.013,1);s.renderOrder=20;return s;
}
const lerpAngle=(a,b,t)=>{let d=(b-a+Math.PI)%(2*Math.PI);if(d<0)d+=2*Math.PI;return a+(d-Math.PI)*t;};

/* ---------- the layers ---------- */
export function liveWinthrop({scene,heightAt=()=>0,water=null,camera=null,controls=null,network=null,fieldY=1.5,intervals={}}={}){
 const I={buses:10000,predictions:30000,aircraft:20000,tide:360000,...intervals};
 const group=new THREE.Group();group.name='live';scene.add(group);
 const ground=(x,z)=>{const y=heightAt(x,z);return Number.isFinite(y)?y:0;};
 const now=()=>performance.now();
 const buses=new Map(),aircraft=new Map();let following=null,snap=false;   // declared up here: tick() runs before the follow block below is reached
 const live={group,buses,aircraft,tide:null,counts:{buses:0,aircraft:0,polls:{buses:0,aircraft:0,tide:0}},errors:{buses:0,aircraft:0,tide:0},toLocal,toMassMainland};

 /* buses: each record eases from where it was drawn to the new fix over one poll interval */
 live.ingestBuses=json=>{
  const rows=json&&Array.isArray(json.data)?json.data:[];const seen=new Set(),t=now();
  for(const v of rows){const a=v.attributes||{};if(!Number.isFinite(a.latitude)||!Number.isFinite(a.longitude))continue;
   let [x,z]=toLocal(a.latitude,a.longitude),yaw=yawFromBearing(Number.isFinite(a.bearing)?a.bearing:0);seen.add(v.id);
   /* Snap to the road (Pierce, 09-14: "bus is on sidewalks"): the MBTA fix is 5–10 m off, so the raw point lands on the curb.
      Put the bus on the nearest centerline, in the right-hand lane of its direction of travel, pointing along the road. */
   const prev=buses.get(v.id);
   if(network&&network.nearest){const n=network.nearest(x,z,true);if(n&&n.distance<30){
    let dx=n.dx/n.length,dz=n.dz/n.length;const bv=Number.isFinite(a.bearing)?[Math.sin(a.bearing*D),-Math.cos(a.bearing*D)]:(prev?[Math.cos(prev.yaw),-Math.sin(prev.yaw)]:null);
    if(bv&&bv[0]*dx+bv[1]*dz<0){dx=-dx;dz=-dz;}
    const off=Math.min(2.2,(n.width||7)/4);x=n.x+(-dz)*off;z=n.z+dx*off;yaw=Math.atan2(-dz,dx);}}
   let b=buses.get(v.id);
   if(!b){b={mesh:makeBus(),x,z,yaw,from:{x,z,yaw},to:{x,z,yaw},t0:t,label:a.label,status:a.current_status,direction:a.direction_id};b.mesh.position.set(x,ground(x,z),z);b.mesh.rotation.y=yaw;group.add(b.mesh);buses.set(v.id,b);}
   else{b.from=snap?{x,z,yaw}:{x:b.x,z:b.z,yaw:b.yaw};b.to={x,z,yaw:Number.isFinite(a.bearing)?yaw:b.yaw};b.t0=t;b.status=a.current_status;b.direction=a.direction_id;}
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
   if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
   const alt=onGround?0:(Number.isFinite(baro)?baro:(Number.isFinite(geo)?geo:0));const [x,z]=toLocal(lat,lon);
   const age=Math.max(0,feedTime-(tpos||feedTime));const v=Number.isFinite(vel)?vel:0,tr=(Number.isFinite(track)?track:0)*D,vr=Number.isFinite(vrate)?vrate:0;
   const fix={x:x+Math.sin(tr)*v*age,z:z-Math.cos(tr)*v*age,y:alt+vr*age,vx:Math.sin(tr)*v,vz:-Math.cos(tr)*v,vy:vr,yaw:yawFromBearing(Number.isFinite(track)?track:0),t0:t};
   seen.add(icao);let p=aircraft.get(icao);
   if(!p){const callsign=(cs||'').trim(),al=airlineOf(callsign);p={mesh:makePlane(callsign),callsign,airline:al,icao,...fix,ox:0,oz:0,oy:0};const tag=nameTag(al.text,al.color);tag.position.set(0,9,0);tag.visible=false;tag.name='tag';p.mesh.add(tag);p.mesh.userData.icao=icao;p.mesh.traverse(o=>{o.userData.icao=icao;});group.add(p.mesh);aircraft.set(icao,p);}
   else{const cur=pos(p,t);p.ox=snap?0:cur.x-fix.x;p.oz=snap?0:cur.z-fix.z;p.oy=snap?0:cur.y-fix.y;Object.assign(p,fix);}
   p.alt=alt;p.speed=v;p.climb=vr;p.ground=!!onGround;p.miss=0;}
  renderChip();
  for(const [id,p] of aircraft){if(seen.has(id))continue;if(++p.miss>=3){group.remove(p.mesh);aircraft.delete(id);}}
  live.counts.aircraft=aircraft.size;return aircraft.size;
 };
 /* never carry a fix forward more than 25 s: a hidden tab polls nothing */
 function pos(p,t){const dt=Math.min(25,(t-p.t0)/1000),k=Math.max(0,1-dt/3);return {x:p.x+p.vx*dt+p.ox*k,z:p.z+p.vz*dt+p.oz*k,y:Math.max(fieldY+2.6,p.y+p.vy*dt+p.oy*k)};}
 /* tide */
 const waterBase=water?water.position.y:0;
 live.ingestTide=json=>{
  const row=json&&Array.isArray(json.data)?json.data[0]:null;const v=row?parseFloat(row.v):NaN;if(!Number.isFinite(v))return null;
  live.tide={level:v,time:row.t,y:Math.round((waterBase+(v-MEAN_TIDE_MLLW))*1000)/1000};if(water)water.position.y=live.tide.y;return live.tide;
 };

 /* per-frame easing; runs on its own rAF so mounting needs no hook in the game loop */
 let raf=0,stopped=false;
 function tick(){if(stopped)return;raf=requestAnimationFrame(tick);const t=now();
  if(following&&String(following).startsWith('ac:')){const p=aircraft.get(following.slice(3));
   if(!p||(typeof document!=='undefined'&&document.body.classList.contains('driving'))){following=null;renderChip();}
   else if(camera&&controls){const c=pos(p,t);const sp=Math.hypot(p.vx,p.vz)||1;const dx=p.vx/sp,dz=p.vz/sp;
    const gx=c.x-dx*140,gz=c.z-dz*140,gy=c.y+45;
    camera.position.x+=(gx-camera.position.x)*.08;camera.position.y+=(gy-camera.position.y)*.08;camera.position.z+=(gz-camera.position.z)*.08;
    controls.target.x+=(c.x-controls.target.x)*.15;controls.target.y+=(c.y-controls.target.y)*.15;controls.target.z+=(c.z-controls.target.z)*.15;}}
  else if(following&&String(following).startsWith('in:')){const p=aircraft.get(following.slice(3));
   if(!p||(typeof document!=='undefined'&&document.body.classList.contains('driving'))){live.follow(null);}
   else if(camera&&controls){const c=pos(p,t);const sp=Math.hypot(p.vx,p.vz);const dx=sp>1?p.vx/sp:Math.cos(p.yaw),dz=sp>1?p.vz/sp:-Math.sin(p.yaw);   // parked: the nose, not a zero velocity
    /* OrbitControls.update() re-aims the camera at its target every frame even with input off, so the target itself goes
       down the runway ahead (Pierce, 09-14: "ride along goes the wrong direction") */
    const ly=c.y+3.4+Math.max(-40,Math.min(40,p.vy*6));controls.target.set(c.x+dx*600,ly,c.z+dz*600);
    camera.position.set(c.x+dx*22,c.y+3.4,c.z+dz*22);camera.lookAt(c.x+dx*600,ly,c.z+dz*600);}}
  else if(following){const b=buses.get(following);
   if(!b||(typeof document!=='undefined'&&document.body.classList.contains('driving'))){following=null;renderChip();}
   else if(camera&&controls){let dx=b.to.x-b.from.x,dz=b.to.z-b.from.z;const L=Math.hypot(dx,dz);if(L>.5){b.dir=[dx/L,dz/L];}const d=b.dir||[Math.cos(b.yaw),-Math.sin(b.yaw)];   // a stopped bus: look along its nose (the road), never a default compass point
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
 const runNow={};
 function poll(name,ingest){let wait=I[name],pending=0;const run=async()=>{if(stopped)return;
   if(typeof document==='undefined'||!document.hidden){let j;if(name==='aircraft'){const r=await getAircraft(air);j=r&&r.json?r.json:r;live.aircraftSource=r&&r.source||null;}else j=await getJSON(FEEDS[name]);live.counts.polls[name]++;
    if(j&&!j.error){try{ingest(j);}catch(e){}wait=I[name];}else{live.errors[name]++;if(j&&j.error===429)wait=Math.min(wait*2,300000);}}
   clearTimeout(pending);pending=setTimeout(run,wait);timers.push(pending);};runNow[name]=run;run();}
 /* back from another tab (Pierce, 09-14: "it all drags or animates the items to where they would be"): fetch every feed
    now and snap to the fresh fixes instead of easing from stale ones */
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.hidden)return;snap=true;for(const k of Object.keys(runNow))runNow[k]();setTimeout(()=>{snap=false;},4000);});
 /* Follow a bus, and its next stop with the time (Pierce, 09-14: "show me the live busses so people can follow them and the time").
    Predictions come from the same MBTA API (keyless); the first prediction per vehicle, sorted by time, is its next stop. */
 const preds=new Map();live.predictions=preds;
 live.ingestPredictions=json=>{const inc=new Map((json.included||[]).map(i=>[i.type+':'+i.id,i]));preds.clear();
  for(const p of (json.data||[])){const veh=p.relationships&&p.relationships.vehicle&&p.relationships.vehicle.data;if(!veh)continue;const a=p.attributes||{};const when=a.departure_time||a.arrival_time;if(!when)continue;
   const stop=inc.get('stop:'+p.relationships.stop.data.id),trip=inc.get('trip:'+p.relationships.trip.data.id);
   if(new Date(when).getTime()<Date.now()-45000)continue;   // already happened: not a next stop
   if(!preds.has(veh.id))preds.set(veh.id,{stop:stop?stop.attributes.name:'',headsign:trip?trip.attributes.headsign:'',when});}
  renderChip();return preds.size;};
 const chip=typeof document!=='undefined'?document.createElement('div'):null;if(chip){chip.id='liveChip';chip.hidden=true;document.body.appendChild(chip);}
 const DIRECTION={0:'toward Winthrop Beach',1:'toward Orient Heights'};
 function renderChip(){if(!chip)return;if(!buses.size&&!aircraft.size){chip.hidden=true;return;}chip.hidden=false;chip.textContent='';
  const entry=(id,title,line,cls)=>{const el=document.createElement('button');el.className=cls+(following===id?' on':'');
   const bb=document.createElement('b');bb.textContent=title;const sp=document.createElement('span');sp.textContent=line;const em=document.createElement('em');em.textContent=following===id?'Following · tap to stop':'Follow';
   el.append(bb,sp,em);el.onclick=()=>live.follow(following===id?null:id);chip.append(el);};
  for(const [id,b] of buses){let p=preds.get(id);if(p&&p.when&&new Date(p.when).getTime()<Date.now()-45000)p=null;const when=p&&p.when?new Date(p.when):null;const mins=when?Math.max(0,Math.round((when-Date.now())/60000)):null;
   const line=p?('to '+p.headsign+' · '+p.stop+(when?' · '+when.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+(mins!==null?' ('+(mins===0?'now':mins+' min')+')':''):''))
    :((b.status==='STOPPED_AT'?'stopped, ':'')+(DIRECTION[b.direction]||'in service'));
   entry(id,'713 bus'+(b.label?' '+b.label:''),line,'bus');}
  /* flying first, then rolling, then parked; nearest to Winthrop within each */
  const rank=p=>(p.ground?(p.speed>15?1:2):0)*1e6+Math.hypot(p.x,p.z);
  const planes=[...aircraft.entries()].sort((a,b)=>rank(a[1])-rank(b[1])).slice(0,5);
  for(const [icao,p] of planes){const ft=Math.max(0,Math.round(p.alt/0.3048/100)*100),mph=Math.round((p.speed||0)*2.237);const phase=p.ground?(mph>40?'rolling':'on the ground'):p.climb>1?'climbing':p.climb<-1?'descending':'level';
   const el=document.createElement('div');el.className='plane'+(following==='ac:'+icao||following==='in:'+icao?' on':'');
   const bb=document.createElement('b');bb.textContent=p.airline.text;const sp=document.createElement('span');sp.textContent=(p.ground?'':ft.toLocaleString()+' ft · ')+phase+' · '+mph+' mph';
   const acts=document.createElement('div');acts.className='acts';
   for(const [key,label] of [['ac:'+icao,following==='ac:'+icao?'Following · stop':'Follow'],['in:'+icao,following==='in:'+icao?'Aboard · step off':'Ride along']]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>live.follow(following===key?null:key);acts.append(b);}
   el.append(bb,sp,acts);chip.append(el);}}
 live.follow=id=>{const s=String(id||'');if(following&&String(following).startsWith('in:')&&controls){const q=aircraft.get(following.slice(3));if(q){const c=pos(q,now());controls.target.set(c.x,c.y,c.z);camera.position.set(c.x-60,c.y+30,c.z+60);}}following=id&&(buses.has(id)||((s.startsWith('ac:')||s.startsWith('in:'))&&aircraft.has(s.slice(3))))?id:null;
  if(controls){controls.autoRotate=false;controls.enabled=!(following&&String(following).startsWith('in:'));}
  for(const p of aircraft.values()){const tag=p.mesh.getObjectByName('tag');if(tag)tag.visible=following==='ac:'+p.icao||following==='in:'+p.icao;p.mesh.visible=following!=='in:'+p.icao;}
  if(typeof document!=='undefined')document.body.classList.toggle('aboard',!!(following&&String(following).startsWith('in:')));renderChip();return following;};
 /* the name shows only on hover (Pierce, 09-14: "only info if I hover") */
 const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();let hovered=null,lastHover=0;
 if(typeof addEventListener==='function'&&camera)addEventListener('pointermove',e=>{const t=now();if(t-lastHover<80)return;lastHover=t;const cv=e.target;if(!cv||cv.tagName!=='CANVAS')return;
  ndc.set((e.clientX/cv.clientWidth)*2-1,-(e.clientY/cv.clientHeight)*2+1);ray.setFromCamera(ndc,camera);ray.params.Line={threshold:2};
  const hit=ray.intersectObjects([...aircraft.values()].map(p=>p.mesh),true).find(h=>h.object.userData.icao);const id=hit?hit.object.userData.icao:null;
  if(id!==hovered){if(hovered){const q=aircraft.get(hovered);const tg=q&&q.mesh.getObjectByName('tag');if(tg&&following!=='ac:'+hovered)tg.visible=false;}hovered=id;if(id){const q=aircraft.get(id);const tg=q&&q.mesh.getObjectByName('tag');if(tg)tg.visible=true;}cv.style.cursor=id?'pointer':'';}},{passive:true});
 live.following=()=>following;
 if(typeof addEventListener==='function')addEventListener('pointerdown',e=>{if(following&&e.target&&e.target.tagName==='CANVAS'){following=null;renderChip();}},{passive:true});
 const chipTimer=setInterval(renderChip,15000);
 poll('buses',j=>{live.ingestBuses(j);renderChip();});poll('predictions',live.ingestPredictions);poll('aircraft',live.ingestAircraft);poll('tide',live.ingestTide);

 live.stop=()=>{stopped=true;cancelAnimationFrame(raf);clearInterval(chipTimer);for(const t of timers)clearTimeout(t);if(chip)chip.remove();scene.remove(group);};
 return live;
}
