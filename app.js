import {CoverageMap} from './coverage.js';
import {treeScenery} from './tree-scenery.js';
let coverageMap,sceneryTrees;
import {treeSurvey} from './tree-survey.js';
import {PhotoTextures} from './photo-textures.js';
import {PhotoFronts} from './photo-fronts.js';
import {addressVisibility} from './address-visibility.js';
import {HouseChecklist} from './house-checklist.js';
let checklist,foundationData,groundWorld;
import {buildGroundWorld,gridHeight} from './ground-world.js';
import {additionalPhotoHouse} from './additional-photo-houses.js';
import {addOwnedFacades} from './owned-facades.js';
import {photoHouse} from './photo-houses.js';
import {trafficSigns} from './traffic-signs.js';
import {roadside} from './roadside.js';
import {streetFurniture} from './street-furniture.js';
import {SignalSystem} from './signals.js';
import {Weather} from './weather.js';
import {TourFlight} from './tour-flight.js';
import {EveningDrive} from './evening.js';
import {neighborhoodGeometry,neighborhoodMaterial,neighborhoodLight} from './neighborhoods.js';
import {streetAssets} from './street-assets.js';
import {makeWater,MapLabels,CoastalTour} from './world-life.js';
import {AmbientLife} from './ambient.js';
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {asphaltMaterial} from './road-mesh.js';
import {makeResidence} from './residential.js';
import {Driving} from './driving.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
const PUBLIC=!new URLSearchParams(location.search).has('studio');if(!PUBLIC)document.body.classList.add('studio');
const $=id=>document.getElementById(id);
const get=async path=>{const r=await fetch(path);if(!r.ok)throw Error(`Unable to load ${path}`);return r.json()};
let photoCatalog=[],photoStop=0;
let additionalRegistration,photoRegistration,photoTextures={},photoWires=[],photoPool,photoFronts,canopyGroup,canopyData;
let evening,hemi,roadsideGroup,signData,signGroup,signalSystem,furnitureGroup,weather,tourFlight,tourData=[];
let assetData,assetGroup,neighborhoods;
let water,labels,ambient,tour,poi,terrainMeshes=[],spot=null,spotMarker;
let scene,camera,renderer,controls,world,elevation,terrain,buildings,outlineGroup,roadGroup,selection,flight,auto=false;
let driving,sun,sunOffset=new THREE.Vector3(-300,450,180),roofTiles=[],pavement;
let surfaceAt,focusElevation,terrainPatches=[],residential=[],buildingMeshes=[],heightAt,origin,frame=0,lastTime=0;
const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2();
const places={whole:{target:[-350,0,-900],offset:[4100,5200,5300]},center:{target:[-1400,0,-1500],offset:[350,500,520]},beach:{target:[190,0,-90],offset:[400,340,450]},deer:{target:[1136,0,928],offset:[850,1100,1150]}};
function error(e){$('loading').hidden=false;$('loading').querySelector('h2').textContent='The model could not load';$('loadmessage').textContent=(/WebGL/i.test(e.message)?'This browser cannot start 3D graphics. Enable hardware acceleration or try a browser with WebGL support.':e.message+' — refresh to try again.');$('loading').querySelector('.spinner').style.display='none';console.error(e)}
function makeShape(rings){const s=new THREE.Shape(rings[0].map(p=>new THREE.Vector2(p[0],-p[1])));for(const ring of rings.slice(1))s.holes.push(new THREE.Path(ring.map(p=>new THREE.Vector2(p[0],-p[1]))));return s}
function fly(target,offset){$('searchstatus').textContent='';document.querySelectorAll('[data-place],#photoStreets button').forEach(b=>b.classList.remove('selected'));tour?.stop();if(driving?.active)driving.exit();auto=false;controls.autoRotate=false;$('orbit').classList.remove('active');$('orbit').setAttribute('aria-pressed','false');const t=new THREE.Vector3(...target);t.y=heightAt(t.x,t.z);flight={start:performance.now(),from:camera.position.clone(),fromTarget:controls.target.clone(),to:t.clone().add(new THREE.Vector3(...offset)),target:t};}
function goPlace(name){const p=places[name];fly(p.target,p.offset);document.querySelectorAll('[data-place]').forEach(b=>b.classList.toggle('selected',b.dataset.place===name));}
function detail(title,rows){$('selectionTitle').textContent=title;$('selectionDetails').replaceChildren();if(!document.body.classList.contains('studio'))rows=rows.filter(([label])=>!/^(Source|Fidelity|Source segments|Mapped surface width)$/.test(label));for(const [label,value]of rows){const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label;p.append(strong,document.createTextNode(String(value)));$('selectionDetails').append(p)}$('inspector').hidden=false;}
function selectBuilding(data){if(selection){scene.remove(selection);selection.geometry.dispose();selection.material.dispose()}
 if(PUBLIC&&(data.residence||data.ownedPhotoWalls?.length)){$('inspector').hidden=true;return;}
if(data.ownedPhotoWalls?.length){detail(data.residence?.address||data.neighborhood?.address||'Building '+data.id,[['Reconstruction','Your photographic wall surfaces · draft'],['Mapped footprint source',data.sourceDate||'Date unknown'],...data.ownedPhotoWalls.map(r=>['Wall '+(r.edge+1),r.height+' m · '+(r.measurement==='measured'?'user-reported measurement':'height estimated')+' · '+r.source]),['Unverified','Current footprint, roof, hidden walls and photographic alignment']]);const a=document.createElement('a');a.className='reference-link';a.textContent='Edit photographic walls';a.href='block-studio.html?building='+encodeURIComponent(data.id);$('selectionDetails').append(a);return;}
 if(data.residence){const r=data.residence;detail(r.address,[['Reconstruction',data.partialPhotograph?'Photographed visible surfaces on an individual 3D house; lower and hidden walls estimated':data.photographic?(r.assessorPlan?'Photographic surfaces; assessor dimensions for main and rear sections':'Photographic facade projection on 3D geometry; depth estimated'):'Photo-guided model; dimensions approximate'],['Main section',r.assessorPlan?'27 × 40 ft · assessor sketch':'Dimensions approximate'],['Recorded stories',r.fields['Stories:']],['Roof',r.roofNote||r.fields['Roof Structure:']],['Exterior',r.fields['Exterior Wall 1']],['Unverified','Metric heights, hidden sides, exact opening dimensions'],['Reference','Winthrop assessor exterior photograph']]);if(data.photographic){const img=document.createElement('img');img.src='./'+(additionalRegistration[r.id]?.image||'assets/houses/'+r.address.split(' ')[0]+'.jpg');img.alt=r.address+' source photograph';img.style.cssText='width:100%;height:auto;border-radius:4px;margin:10px 0';$('selectionDetails').append(img);}for(const [label,url] of [...(r.assessorPlan?[['Open dimensioned sketch',r.assessorPlan.source]]:[]),['Open assessor photograph',r.photo],['Open assessor record',r.url],...(r.comparisonReferences||[]).map(ref=>[ref.label,ref.url])]){const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.className='reference-link';$('selectionDetails').append(a);}return;}
 if(data.neighborhood){const r=data.neighborhood;detail(r.address||'Residential building',[['Model','Mapped footprint with estimated exterior'],['Assessor style',r.style],['Recorded stories',r.stories],['Geometry',r.accessory?'Small accessory structure; height estimated':'Floor heights, roof shape and windows estimated'],['Source','MassGIS property tax parcels · '+r.parcel]]);return;}
 const g=new THREE.ExtrudeGeometry(makeShape(data.rings),{depth:8,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);g.translate(0,data.base+.2,0);selection=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x8be4ff,transparent:true,opacity:.6}));scene.add(selection);
 detail('Building '+data.id,[['Mapped roof area',`${Math.round(data.area).toLocaleString()} m²`],['Source date',data.sourceDate||'Not provided'],['Source imagery',data.source||'Not provided'],['Building height','Not measured — study volume only'],['Facade / roof reconstruction','Not yet modeled']]);}
function addGeometry(){
 buildings=new THREE.Group();outlineGroup=new THREE.Group();roadGroup=new THREE.Group();scene.add(buildings,outlineGroup,roadGroup);
 const chunks=new Map(),lines=[];
 for(const b of world.buildings){
  b.base=surfaceAt(...b.center);const spec=residential.find(r=>r.id===b.id);if(spec){b.residence=spec;const number=spec.address.split(' ')[0];b.photographic=!!additionalRegistration[spec.id]||(/ SHIRLEY ST$/.test(spec.address)&&!!photoRegistration[number]);b.partialPhotograph=!!additionalRegistration[spec.id];const house=b.partialPhotograph?additionalPhotoHouse(spec,b.base,b,additionalRegistration[spec.id],photoTextures[spec.id]):b.photographic?photoHouse(spec,b.base,b,photoRegistration[number],photoTextures[number]):makeResidence(spec,b.base,b);if(house.userData.wire)photoWires.push(house.userData.wire);buildings.add(house);buildingMeshes.push(...house.children);continue;}b.neighborhood=neighborhoods.buildings[String(b.id)];const g=neighborhoodGeometry(makeShape(b.rings),b,b.neighborhood);
  const rt=roofTiles.find(t=>b.center[0]+origin[0]>=t.bbox[0]&&b.center[0]+origin[0]<=t.bbox[2]&&origin[1]-b.center[1]>=t.bbox[1]&&origin[1]-b.center[1]<=t.bbox[3])||roofTiles[roofTiles.length-1];
  b.roofTile=roofTiles.indexOf(rt);const pos=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)+origin[0]-rt.bbox[0])/(rt.bbox[2]-rt.bbox[0]),(origin[1]-pos.getZ(i)-rt.bbox[1])/(rt.bbox[3]-rt.bbox[1]));
  const key=b.roofTile+','+Math.floor(b.center[0]/300)+','+Math.floor(b.center[1]/300);if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push({g,b});
  for(const ring of b.rings)for(let i=1;i<ring.length;i++){for(const p of[ring[i-1],ring[i]])lines.push(p[0],heightAt(...p)+.5,p[1])}
 }
 const materials=roofTiles.map(t=>neighborhoodMaterial(t.texture));
 for(const entries of chunks.values()){
  const geometries=entries.map(e=>e.g);const merged=mergeGeometries(geometries,false);const mesh=new THREE.Mesh(merged,materials[entries[0].b.roofTile]);mesh.castShadow=true;mesh.receiveShadow=true;let end=0;mesh.userData.ranges=entries.map(({g,b})=>{end+=g.index?g.index.count:g.attributes.position.count;return{end,data:b}});buildings.add(mesh);buildingMeshes.push(mesh);for(const g of geometries)g.dispose();
 }
 outlineGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(lines,3)),new THREE.LineBasicMaterial({color:0xd2f1f5,transparent:true,opacity:.8})));
 const roadPositions=[];
 for(const r of world.roads)for(let i=1;i<r.points.length;i++){
  const a=r.points[i-1],b=r.points[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/8));
  for(let k=0;k<n;k++)for(const q of[k/n,(k+1)/n]){const x=a[0]+(b[0]-a[0])*q,z=a[1]+(b[1]-a[1])*q;roadPositions.push(x,heightAt(x,z)+.65,z)}
 }
 roadGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(roadPositions,3)),new THREE.LineBasicMaterial({color:0x85d3e9,transparent:true,opacity:.55})));
 buildings.visible=true;outlineGroup.visible=false;roadGroup.visible=false;
}
async function init(){
 [world,foundationData,residential,poi,assetData,neighborhoods,signData,photoRegistration]=await Promise.all([get('./data/world.json'),get('./data/road-foundation.json'),get('./data/residential.json'),get('./data/places.json'),get('./data/street-assets.json'),get('./data/neighborhoods.json'),get('./data/traffic-signs.json'),get('./data/photo-facades.json')]);origin=world.origin;heightAt=gridHeight(foundationData.terrain);
 if(new URLSearchParams(location.search).get('render')==='software'){const {SoftwareRenderer}=await import('./inspection-renderer.js');renderer=new SoftwareRenderer(document.createElement('canvas'));const badge=document.createElement('div');badge.textContent='Geometry preview · lighting and vegetation simplified';badge.style.cssText='position:fixed;left:12px;bottom:32px;z-index:30;background:#102a35;color:white;padding:8px;font:12px system-ui';document.body.append(badge);}else renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;$('viewport').append(renderer.domElement);
 scene=new THREE.Scene();scene.background=new THREE.Color('#a2bdc9');scene.fog=new THREE.Fog('#a2bdc9',4500,18000);camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.15,45000);
 controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=5;controls.maxDistance=15500;controls.maxPolarAngle=Math.PI/2-.035;controls.autoRotateSpeed=.3;controls.zoomToCursor=true;controls.screenSpacePanning=false;controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};controls.touches={ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_ROTATE};
 water=makeWater();water.userData.previewColor=[.035,.16,.20];scene.add(water);
 hemi=new THREE.HemisphereLight(0xe6f1ff,0x515c56,2);scene.add(hemi);sun=new THREE.DirectionalLight(0xfff2da,1.6);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-180,right:180,top:180,bottom:-180,near:1,far:1600});sun.shadow.bias=-.00015;sun.shadow.normalBias=.4;scene.add(sun,sun.target);
 $('loadmessage').textContent=`Aligning terrain, roads and ${world.buildings.length.toLocaleString()} building outlines…`;
 additionalRegistration=await get('./data/additional-photo-facades.json');
 const loader=new THREE.TextureLoader();
 const photoEntries=[...Object.keys(photoRegistration).map(n=>({key:n,image:'assets/houses/'+n+'.jpg',center:residential.find(r=>r.address===n+' SHIRLEY ST').center})),...Object.entries(additionalRegistration).map(([key,r])=>({key,image:r.image,center:residential.find(s=>s.id===key).center}))];
 photoPool=new PhotoTextures(photoEntries,{anisotropy:Math.min(renderer.capabilities.getMaxAnisotropy(),8)});photoTextures=photoPool.textures;
 photoPool.update(...residential.find(r=>r.address==='1040 SHIRLEY ST').center);
 const tiles=await get('./data/detailed/tiles.json');
 const [focusTexture,focusExtent,...textures]=await Promise.all([loader.loadAsync('./data/focus/aerial.webp'),get('./data/focus/extent.json'),...tiles.map(t=>loader.loadAsync('./data/detailed/'+t.file))]);
 roofTiles=[{bbox:focusExtent,texture:focusTexture},...tiles.map((t,i)=>({...t,texture:textures[i]}))];
 for(const t of roofTiles){t.texture.colorSpace=THREE.SRGBColorSpace;t.texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),16);}
 // Real roofs from the 2021 LiDAR: unpack the centimetre binary into the same roof-triangle format the estimates use.
 try{const fp=await get('./data/facade-params.json');let n=0;for(const [id,v] of Object.entries(fp.buildings)){const rec=neighborhoods.buildings[id];if(rec){rec.facade=v;n++;}}window.__facades=n;}catch(e){}
 const lowMemory=(navigator.deviceMemory&&navigator.deviceMemory<=4)||(matchMedia('(pointer:coarse)').matches&&Math.min(innerWidth,innerHeight)<800);window.__lowMemory=lowMemory;
 if(!lowMemory)try{const [idx,buf]=await Promise.all([get('./data/roofs-index.json'),fetch('./data/roofs.bin').then(r=>r.arrayBuffer())]);const dv=new DataView(buf);let applied=0;const centers=new Map(world.buildings.map(b=>[b.id,b.center]));
  for(const [id,[off,nv,nt,wall]] of Object.entries(idx.buildings)){const c=centers.get(id);if(!c)continue;const xs=new Int16Array(buf,off,nv),ys=new Uint16Array(buf,off+nv*2,nv),zs=new Int16Array(buf,off+nv*4,nv),tri=new Uint16Array(buf,off+nv*6,nt*3);const roof=new Float32Array(nt*9);for(let i=0;i<nt*3;i++){const v=tri[i];roof[i*3]=c[0]+xs[v]/100;roof[i*3+1]=ys[v]/100;roof[i*3+2]=c[1]+zs[v]/100;}
   const rec=neighborhoods.buildings[id]||(neighborhoods.buildings[id]={address:'',stories:0,accessory:false});rec.wall=wall;rec.roof=roof;rec.roofSource='lidar';applied++;}
  window.__lidarRoofs=applied;}catch(e){console.warn('LiDAR roofs unavailable',e);}
 groundWorld=await buildGroundWorld(foundationData,roofTiles,origin,asphaltMaterial());
 terrain=groundWorld.ground;pavement=groundWorld.road;terrainMeshes=[terrain,groundWorld.walk,groundWorld.curb];surfaceAt=groundWorld.field.height;heightAt=surfaceAt;scene.add(terrain,pavement,groundWorld.walk,groundWorld.curb);
 addGeometry();for(const b of world.buildings)if(b.neighborhood&&b.neighborhood.roofSource==='lidar')b.neighborhood.roof=null;
 const ownedFacades=await addOwnedFacades(buildings,world,surfaceAt);
 places.homes={target:[110,0,0],offset:[90,65,100]};const photoHome=residential.find(r=>r.address.startsWith('1040 '));places.replicas={target:[photoHome.center[0],0,photoHome.center[1]],offset:[photoHome.front[0]*27,12,photoHome.front[1]*27]};
 photoCatalog=residential.filter(r=>additionalRegistration[r.id]||(/ SHIRLEY ST$/.test(r.address)&&photoRegistration[r.address.split(' ')[0]]));photoStop=photoCatalog.findIndex(r=>r.address.startsWith('1040 '));for(const [i,r]of photoCatalog.entries())places['photo'+i]={target:[r.center[0],0,r.center[1]],offset:[r.front[0]*30,11,r.front[1]*30]};
 // Derive neighborhood focus from authoritative street geometry.
 const wood=world.roads.filter(r=>/WOODSIDE|WOOD SIDE/i.test(r.name));if(wood.length){const pts=wood.flatMap(r=>r.points);places.center.target=[pts.reduce((s,p)=>s+p[0],0)/pts.length,0,pts.reduce((s,p)=>s+p[1],0)/pts.length];}
 controls.target.set(...places.whole.target);controls.target.y=surfaceAt(controls.target.x,controls.target.z);camera.position.copy(controls.target).add(new THREE.Vector3(...places.whole.offset));controls.update();
 const names=[...new Set(world.roads.map(r=>r.name))].filter(n=>n!=='Unnamed road').sort();for(const name of [...names,...poi.places.map(p=>p.name)]){const o=document.createElement('option');o.value=name;$('roadnames').append(o)}
 $('counts').textContent=`${world.audit.buildings.toLocaleString()} building outlines · ${world.audit.roadSegments} road segments`;
 driving=new Driving({scene,camera,controls,world,heightAt:surfaceAt,collisionMeshes:buildingMeshes,onEnter:()=>{checklist?.open(false);if(coverageMap)coverageMap.outlines.visible=false;tour?.stop();$('spotActions').hidden=true;flight=null;auto=false;buildings.visible=true;pavement.visible=true;roadGroup.visible=false;$('inspector').hidden=true;$('notice').textContent=`${photoCatalog.length} photographed homes · other exteriors estimated`;},onExit:()=>{if(coverageMap)coverageMap.outlines.visible=$('coverageLayer').checked;$('notice').textContent=`${photoCatalog.length} homes with photographic surfaces · other exteriors estimated`;}});
 labels=new MapLabels(scene,world.roads,poi.places,surfaceAt,p=>{chooseSpot(new THREE.Vector3(p.x,surfaceAt(p.x,p.z),p.z));detail(p.name,[['Type',p.kind.replaceAll('_',' ')],['Address',p.address||'Not recorded'],['Source','OpenStreetMap — listing may be incomplete or outdated']]);const a=document.createElement('a');a.textContent='View mapped listing';a.href=p.url;a.target='_blank';a.rel='noopener';$('selectionDetails').append(a);});
 signGroup=trafficSigns(signData,surfaceAt);scene.add(signGroup);
 get('./data/tours.json').then(({tours})=>{tourData=tours;const box=$('tourList'),sw=$('tourSwitch');if(!box)return;for(const t of tours){const row=document.createElement('div');row.className='tourrow';const lab=document.createElement('div');lab.innerHTML='<b></b><small></small>';lab.querySelector('b').textContent=t.name;lab.querySelector('small').textContent=t.stops.length+' stops · '+t.blurb;const fly=document.createElement('button');fly.textContent='Fly';fly.onclick=()=>{if(driving.active)driving.exit();tour.stop();flight=null;auto=false;controls.autoRotate=false;tourFlight.start(t);};const drive=document.createElement('button');drive.textContent='Drive';drive.onclick=()=>{tour.stop();driving.startTour(t);};row.append(lab,fly,drive);box.append(row);if(sw){const o=document.createElement('option');o.value=t.id;o.textContent=t.name;sw.append(o);}}
  if(sw)sw.onchange=e=>{const t=tours.find(t=>t.id===e.target.value);e.target.value='';if(!t)return;if(driving.active)driving.exit();tour.stop();tourFlight.start(t);};
  $('tourPrev').onclick=()=>tourFlight.prev();$('tourNext').onclick=()=>tourFlight.next();}).catch(()=>{});
 if(new URLSearchParams(location.search).get('fronts')==='1')get('./data/assessor-photos.json').then(photos=>{photoFronts=new PhotoFronts({scene,world,neighborhoods,photos,network:driving.state.network,anisotropy:Math.min(renderer.capabilities.getMaxAnisotropy(),8)});photoFronts.update(camera.position.x,camera.position.z);window.__fronts=photoFronts;}).catch(e=>console.warn('Photo fronts unavailable',e));
 roadsideGroup=roadside(assetData,driving.state.network,surfaceAt);scene.add(roadsideGroup);
 Promise.all([get('./data/crossings.json'),get('./data/power-lines.json'),get('./data/street-furniture.json')]).then(([crossings,powerLines,furniture])=>{driving.cruise.signals=furniture.signals||[];signalSystem=new SignalSystem(furniture.signals||[],driving.state.network);driving.cruise.lights=signalSystem;if(ambient)ambient.lights=signalSystem;const g=streetFurniture({crossings,powerLines,furniture},driving.state.network,surfaceAt,signalSystem);scene.add(g);furnitureGroup=g;window.__furniture=g;}).catch(e=>console.warn('Street furniture unavailable',e));evening=new EveningDrive(scene,surfaceAt);weather=new Weather({scene,hemi,sun});weather.bind(['weather','weatherDrive']);
 assetGroup=streetAssets(assetData,surfaceAt);scene.add(assetGroup);$('assetLabel').textContent=`Signs, poles and hydrants · ${assetData.assets.length}`;
window.__drive=driving; ambient=new AmbientLife(scene,driving.state.network,surfaceAt);driving.cruise.traffic=ambient;driving.cruise.stops=ambient.stops=assetData.assets.filter(a=>a.kind==='stop');{const coastal=new CoastalTour(camera,controls,surfaceAt,()=>{$('tour').textContent='Coastal flyover';}),flight=new TourFlight(camera,controls,surfaceAt,()=>{});tourFlight=flight;window.__flight=flight;
 tour={get active(){return coastal.active||flight.active;},start(){flight.stop();coastal.start();},stop(){coastal.stop();flight.stop();},update(dt){coastal.update(dt);flight.update(dt);}};}
 canopyData=await get('./data/tree-survey.json');canopyGroup=treeSurvey(canopyData,surfaceAt);scene.add(canopyGroup);
 const canopyAreas=await get('./data/lidar-trees.json').catch(()=>get('./data/canopy-scenery.json'));sceneryTrees=await treeScenery(canopyData,surfaceAt,driving.state.network,canopyAreas);scene.add(sceneryTrees);$('treeSummary').textContent=sceneryTrees.userData.count.toLocaleString()+' trees, each one where it really stands.';
 const reviewCatalog=await get('./data/review-catalog.json');labels.occluded=addressVisibility(world.buildings,reviewCatalog.houses,surfaceAt);checklist=new HouseChecklist(reviewCatalog,{occluded:addressVisibility(world.buildings,reviewCatalog.houses,surfaceAt),heightAt:surfaceAt,pause:()=>{if(driving.active)driving.pause(true)},visit:async h=>{tour?.stop();if(driving.active){return await driving.inspectHouse(h);}else fly([h.center[0],0,h.center[1]],h.front?[h.front[0]*30,12,h.front[1]*30]:[30,20,30]);}});
 coverageMap=new CoverageMap({world,catalog:reviewCatalog,photos:photoCatalog,scene,heightAt:surfaceAt,onReview:()=>checklist.open(true),onCenter:p=>fly([p[0],0,p[1]],[180,260,220]),onVisit:r=>{photoStop=photoCatalog.indexOf(r);photoPool.update(...r.center);checklist.selectAddress(r.address);goPlace('photo'+photoStop);},onStreet:(street,entries)=>{const r=entries.find(h=>h.address==='274 WINTHROP ST')||entries[0];photoStop=photoCatalog.indexOf(r);photoPool.update(...r.center);checklist.selectAddress(r.address);fly([r.center[0],0,r.center[1]],[r.front[0]*80,60,r.front[1]*80]);$('searchstatus').textContent=street+' · '+entries.length+' buildings with partial photo walls';}});
 bind();$('photoCoverage').textContent=photoCatalog.length+' buildings with registered photographic surfaces. Each uses individually traced visible wall planes. Heights and unseen elevations remain estimates.';$('notice').textContent=`${photoCatalog.length} homes with photographic surfaces · other exteriors estimated`;$('loading').hidden=true;renderer.setAnimationLoop(animate);
 const requestedBuilding=world.buildings.find(b=>b.id===new URLSearchParams(location.search).get('building'));if(requestedBuilding){controls.target.set(requestedBuilding.center[0],surfaceAt(...requestedBuilding.center),requestedBuilding.center[1]);camera.position.copy(controls.target).add(new THREE.Vector3(35,22,35));controls.update();chooseSpot(controls.target.clone(),false);}
 if(!requestedBuilding)goPlace('whole');
 if(ownedFacades.loaded)$('counts').textContent+=' · '+ownedFacades.loaded+' original photo walls';
 window.__worldAudit={...world.audit,ownedFacades,terrainVertices:terrain.geometry.attributes.position.count,drawGroups:buildingMeshes.length,imageryReady:true,residentialModels:residential.length,roads:pavement.userData.audit,localTerrainSpacing:4,terrainSource:foundationData.audit.sourceTerrain,sidewalks:foundationData.audit.sidewalkSides};
}
function chooseSpot(point,center=true){
 $('inspector').hidden=true;spot={x:point.x,z:point.z};const road=driving.state.network.nearest(spot.x,spot.z,true);$('spotName').textContent=road&&road.distance<90?road.name:'Explore this location';$('spotDrive').disabled=!road||road.distance>90;$('spotCruise').disabled=$('spotDrive').disabled;$('spotActions').hidden=false;
 if(!spotMarker){spotMarker=new THREE.Mesh(new THREE.RingGeometry(1.5,1.85,48),new THREE.MeshBasicMaterial({color:0xabeaff,side:THREE.DoubleSide,depthWrite:false}));spotMarker.rotation.x=-Math.PI/2;scene.add(spotMarker);}spotMarker.visible=true;spotMarker.position.set(spot.x,surfaceAt(spot.x,spot.z)+.3,spot.z);
 if(center&&!driving.active){const offset=camera.position.clone().sub(controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*.65,65,420));fly([spot.x,0,spot.z],offset.toArray());}
}
function driveSpot(){if(!spot||$('spotDrive').disabled)return;tour.stop();driving.enter(spot.x,spot.z);}
async function startDriveFromView(automatic=false){
 const target=(flight?.target||controls.target).clone();flight=null;tour.stop();checklist.open(false);
 const button=$('driveCurrent');if(button.disabled)return;button.disabled=true;button.textContent='Preparing car…';
 try{if(automatic)await driving.goForDrive(target.x,target.z);else await driving.enter(target.x,target.z);}finally{button.disabled=false;button.textContent='Drive here';}
}
function bind(){
 $('driveCurrent').onclick=()=>startDriveFromView();
 $('exploreTown').onclick=()=>{checklist.open(false);goPlace('whole');};
 $('trees').onchange=e=>sceneryTrees.visible=e.target.checked;
 $('treeSurvey').onclick=()=>{canopyGroup.visible=!canopyGroup.visible;$('treeSurvey').setAttribute('aria-pressed',String(canopyGroup.visible));if(canopyGroup.visible){const p=canopyData.candidates.find(p=>p.review==='accepted'&&p.streetDistance<30)||canopyData.candidates.find(p=>p.review==='accepted');fly([p.x,0,p.z],[45,55,50]);$('searchstatus').textContent='Canopy near '+p.nearestStreet+' · green: screened · gold: uncertain';}else $('notice').textContent=photoCatalog.length+' buildings with photographic surfaces';};
 $('nextPhoto').onclick=()=>{photoStop=(photoStop+1)%photoCatalog.length;const r=photoCatalog[photoStop],h=checklist.rows.find(h=>h.address===r.address);checklist.selectAddress(r.address);photoPool.update(...r.center);if(driving.active){driving.inspectHouse(h||{...r,buildingId:r.id,street:r.street,height:r.stories*2.75+3});}else goPlace('photo'+photoStop);$('searchstatus').textContent=r.address;};
 document.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>goPlace(b.dataset.place));
 const mode=study=>{if(driving.active)driving.exit();buildings.visible=study;pavement.visible=study;$('aerial').classList.toggle('active',!study);$('study').classList.toggle('active',study);$('aerial').setAttribute('aria-pressed',String(!study));$('study').setAttribute('aria-pressed',String(study));$('notice').textContent=study?`${photoCatalog.length} homes with photographic surfaces · other exteriors estimated`:'Geographic foundation · building facades are not reconstructed';if(!study&&selection){scene.remove(selection);selection.geometry.dispose();selection.material.dispose();selection=null;$('inspector').hidden=true;}};
 $('drive').onclick=()=>startDriveFromView();
 $('goDrive').onclick=()=>startDriveFromView(true);$('spotCruise').onclick=()=>{if(spot){tour.stop();driving.goForDrive(spot.x,spot.z);}};
 $('spotDrive').onclick=driveSpot;$('spotCenter').onclick=()=>{if(spot)fly([spot.x,0,spot.z],[55,60,70]);};$('closeSpot').onclick=()=>{$('spotActions').hidden=true;if(spotMarker)spotMarker.visible=false;};
 $('tour').onclick=()=>{if(tour.active){tour.stop();return;}if(driving.active)driving.exit();flight=null;auto=false;controls.autoRotate=false;$('sunlight').value=17;$('sunlight').dispatchEvent(new Event('input'));tour.start();$('tour').textContent='Stop flyover';};$('stopTour').onclick=()=>tour.stop();$('tourDrive').onclick=()=>{if(tourFlight&&tourFlight.active&&tourFlight.tour){const t=tourFlight.tour,i=tourFlight.index;tour.stop();driving.startTour({...t,stops:t.stops.slice(i).concat(t.stops.slice(0,i))});return;}tour.stop();driving.enter(controls.target.x,controls.target.z);};
 addEventListener('keydown',e=>{if(e.code==='Escape')tour.stop();});
 $('eveningDrive').onclick=()=>{evening.active=!evening.active;const night=evening.active;$('eveningDrive').setAttribute('aria-pressed',String(night));$('eveningDrive').textContent=night?'Return to daylight':'Evening drive';neighborhoodLight.value=night?1:0;weather.night=night;weather.apply();};
 $('sunlight').oninput=e=>{const angle=(Number(e.target.value)-6)/12*Math.PI;sunOffset.set(Math.cos(angle)*450,Math.max(85,Math.sin(angle)*500),180);sun.color.set(Number(e.target.value)>16?'#ffd3a0':'#fff2da');$('sunTime').textContent=e.target.value+':00';};
 $('aerial').onclick=()=>mode(false);$('study').onclick=()=>mode(true);
 $('photoWire').onchange=e=>photoWires.forEach(w=>w.visible=e.target.checked);
 $('assets').onchange=e=>assetGroup.visible=e.target.checked;
 $('roads').onchange=e=>roadGroup.visible=e.target.checked;$('footprints').onchange=e=>outlineGroup.visible=e.target.checked;
 $('top').onclick=()=>fly(controls.target.toArray(),[0,Math.max(500,camera.position.distanceTo(controls.target)),.1]);$('reset').onclick=()=>goPlace('whole');
 $('orbit').onclick=()=>{flight=null;auto=!auto;controls.autoRotate=auto;$('orbit').classList.toggle('active',auto);$('orbit').setAttribute('aria-pressed',String(auto))};
 $('info').onclick=()=>{$('about').showModal();$('info').setAttribute('aria-expanded','true')};$('closeabout').onclick=()=>$('about').close();$('about').addEventListener('close',()=>$('info').setAttribute('aria-expanded','false'));
 $('closeinspect').onclick=()=>{$('inspector').hidden=true;if(selection){scene.remove(selection);selection.geometry.dispose();selection.material.dispose();selection=null}};
 const SUF={STREET:'ST',AVENUE:'AVE',ROAD:'RD',DRIVE:'DR',COURT:'CT',PLACE:'PL',TERRACE:'TER',LANE:'LN',BOULEVARD:'BLVD',CIRCLE:'CIR',PARKWAY:'PKWY',SQUARE:'SQ',HIGHWAY:'HWY'};const normAddr=a=>a.toUpperCase().replace(/[.,]/g,'').replace(/\b(WINTHROP|MA|02152)\b/g,'').replace(/\s+/g,' ').trim().split(' ').map(w=>SUF[w]||w).join(' ');
 let addressIndex=null;get('./data/addresses.json').then(d=>{addressIndex=d.addresses;const list=$('roadnames');if(list){const frag=document.createDocumentFragment();for(const a of Object.keys(addressIndex)){const o=document.createElement('option');o.value=a.replace(/\b([A-Z])([A-Z]+)\b/g,(m,a,b)=>a+b.toLowerCase());frag.append(o);}list.append(frag);}}).catch(()=>{});
 const findRoad=()=>{const q=$('roadsearch').value.trim().toUpperCase();if(!q)return;
  if(addressIndex&&/^\d+[A-Z]?\s+\S/.test(q)){const key=normAddr(q);let hit=addressIndex[key];if(!hit){const num=parseInt(key),street=key.replace(/^\S+\s+/,'');let best=null;for(const k of Object.keys(addressIndex)){if(!k.endsWith(' '+street))continue;const n=parseInt(k);if(isNaN(n)||Math.abs(n-num)>8)continue;if(!best||Math.abs(n-num)<best.d)best={d:Math.abs(n-num),k};}if(best)hit=addressIndex[best.k];}
   if(hit){const y=surfaceAt(hit.x,hit.z);chooseSpot(new THREE.Vector3(hit.x,y,hit.z));fly([hit.x,0,hit.z],[38,26,38]);$('searchstatus').textContent=key.replace(/\b([A-Z])([A-Z]+)\b/g,(m,a,b)=>a+b.toLowerCase());$('spotName').textContent=$('searchstatus').textContent;detail($('searchstatus').textContent,[['Address',$('searchstatus').textContent+', Winthrop']]);return;}
   $('searchstatus').textContent='No such address in Winthrop yet.';return;}const exact=world.roads.filter(r=>r.name.toUpperCase()===q);const rs=exact.length?exact:world.roads.filter(r=>r.name.toUpperCase().includes(q));if(!rs.length){const p=poi.places.find(p=>p.name.toUpperCase().includes(q));if(p){chooseSpot(new THREE.Vector3(p.x,surfaceAt(p.x,p.z),p.z));$('searchstatus').textContent=p.name;return;}$('searchstatus').textContent='No matching road or mapped place.';return;}const name=rs[0].name,matches=rs.filter(r=>r.name===name),pts=matches.flatMap(r=>r.points),xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]),x=(Math.min(...xs)+Math.max(...xs))/2,z=(Math.min(...zs)+Math.max(...zs))/2,span=Math.max(250,Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs));fly([x,0,z],[span*.6,span*.8,span*.7]);$('searchstatus').textContent=name;detail(name,[['Source segments',matches.length],['Mapped surface width',matches[0].width?`${matches[0].width} m (inventory value)`:'Not recorded'],['Source','MassDOT road inventory'],['Fidelity','Pavement and sidewalks use MassDOT inventory widths. Missing sidewalk widths stay unmodeled. Curb edges are derived, not surveyed.']]);};
 $('findroad').onclick=findRoad;$('roadsearch').addEventListener('keydown',e=>{if(e.key==='Enter')findRoad()});
 let lookStart=0;let down,lastTap=0,lastTapPoint=null,tapTimer,dragged=false;const pointers=new Set();
 renderer.domElement.addEventListener('pointerdown',e=>{tour.stop();down=[e.clientX,e.clientY];lookStart=driving.lookYaw;dragged=false;pointers.add(e.pointerId);if(pointers.size>1)down=null;flight=null;});
 renderer.domElement.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])>6){dragged=true;if(driving.active)driving.setLook(lookStart-(e.clientX-down[0])*.005);}});
 renderer.domElement.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);down=null;});
 renderer.domElement.addEventListener('pointerup',e=>{pointers.delete(e.pointerId);if(!down||dragged||e.button!==0)return;down=null;pointer.set(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2);raycaster.setFromCamera(pointer,camera);const objects=[...(sceneryTrees.visible?sceneryTrees.userData.pickable:[]),...(canopyGroup.visible?canopyGroup.userData.pickable:[]),...signGroup.userData.pickable,...(assetGroup.visible?assetGroup.children:[]),...terrainMeshes,pavement,...(buildings.visible?buildingMeshes:[])];const hit=raycaster.intersectObjects(objects,false)[0];if(!hit)return;const now=performance.now(),double=now-lastTap<310&&lastTapPoint&&Math.hypot(e.clientX-lastTapPoint[0],e.clientY-lastTapPoint[1])<24;lastTap=now;lastTapPoint=[e.clientX,e.clientY];clearTimeout(tapTimer);if(double){chooseSpot(hit.point,false);driveSpot();lastTap=0;}else tapTimer=setTimeout(()=>{chooseSpot(hit.point);if(hit.object.userData.canopy){const p=hit.object.userData.canopy;detail('Canopy near '+p.nearestStreet,[['Review',p.review==='accepted'?'Visible canopy screened in aerial photo':'Candidate awaiting review'],['Source','Massachusetts aerial imagery · '+canopyData.imageryYear],['Observed',p.reviewReason],['Dimensions','Crown extent estimated from pixels; height and trunk position unmeasured']]);const img=document.createElement('img');img.src=p.referenceImage;img.alt='Aerial reference centered on this canopy candidate';img.style.width='100%';$('selectionDetails').append(img);return;}if(hit.object.userData.streetSign){const a=hit.object.userData.streetSign;detail(a.text,[['Source','MassDOT sign inventory'],['Street',a.street||'Not recorded'],['Facing',a.orientation],['Inventory date',a.recorded?new Date(a.recorded).getFullYear():'Not recorded'],['Fidelity','Recorded point and orientation; current condition unverified']]);const link=document.createElement('a');link.textContent='View source sign';link.href=a.url;link.target='_blank';link.rel='noopener';$('selectionDetails').append(link);return;}if(hit.object.userData.streetAsset){const a=hit.object.userData.streetAsset;detail('Mapped '+a.kind,[['Source','OpenStreetMap'],['Coverage','Incomplete inventory; field verification needed'],['Position','Mapped point; marker is not a reconstructed object']]);const link=document.createElement('a');link.textContent='View source record';link.href=a.url;link.target='_blank';link.rel='noopener';$('selectionDetails').append(link);return;}const r=hit.object.userData.ranges?.find(r=>hit.faceIndex*3<r.end);if(r)selectBuilding(r.data);},310);});
 renderer.domElement.addEventListener('wheel',()=>{flight=null;tour.stop();},{passive:true});
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
}
function animate(time){const dt=lastTime?Math.min((time-lastTime)/1000,.1):.016;lastTime=time;
 if(flight){const t=Math.min(1,(time-flight.start)/1600),ease=t*t*(3-2*t);camera.position.lerpVectors(flight.from,flight.to,ease);controls.target.lerpVectors(flight.fromTarget,flight.target,ease);if(t===1)flight=null;}
 controls.target.x=THREE.MathUtils.clamp(controls.target.x,-3500,3500);controls.target.z=THREE.MathUtils.clamp(controls.target.z,-3900,3900);if(tour?.active)tour.update(dt);else if(driving?.active){ambient?.constrainPlayer(driving.state);driving.update(dt,time);}else controls.update(dt);
 ambient?.update(driving?.paused?0:dt,controls.target,driving,$('life').checked);water.material.uniforms.time.value=time/1000;water.material.uniforms.sunDirection.value.copy(sunOffset).normalize();if(frame%6===0)labels?.update(camera,controls.target,$('labels').checked&&!tour?.active);
 if(frame%6===0)checklist?.update(camera,buildings.visible&&!tour?.active);
 signalSystem?.tick(dt);if(frame%6===0)furnitureGroup?.userData.lights?.update();weather?.update(dt,camera);
 if(frame%24===0){photoPool?.update(camera.position.x,camera.position.z);photoFronts?.update(camera.position.x,camera.position.z);coverageMap?.update(controls.target);}
 evening?.update(driving?.state,driving?.active);
 sun.target.position.copy(controls.target);sun.position.copy(controls.target).add(sunOffset);
 if(frame++%30===0)$('position').textContent=`View distance ${Math.round(camera.position.distanceTo(controls.target)).toLocaleString()} m`;
 // Preserve ground/water depth precision as the camera climbs during flyovers.
 const clearance=Math.max(0,camera.position.y-heightAt(camera.position.x,camera.position.z));
 const near=THREE.MathUtils.clamp(clearance*.015,.15,20);
 if(Math.abs(camera.near-near)>.01){camera.near=near;camera.updateProjectionMatrix();}
 renderer.render(scene,camera);
}
init().catch(error);
