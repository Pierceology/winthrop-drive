/* qa/live-shots.js — Playwright screenshots of live.js in qa/live-harness.html.
   Serve the clone root first:  python3 -m http.server 8792   (URL env overrides)
   Run:  node /private/tmp/claude-501/-Users-jackpierce-puzzles/3419a1e3-80b1-4aff-8a26-fb6f9abf57f0/scratchpad/qa/../../wd-live/qa/live-shots.js
   (or from any cwd: NODE_PATH=<scratchpad>/qa/node_modules node qa/live-shots.js) */
const NM='/private/tmp/claude-501/-Users-jackpierce-puzzles/3419a1e3-80b1-4aff-8a26-fb6f9abf57f0/scratchpad/qa/node_modules';
const {chromium}=require(NM+'/playwright');const fs=require('fs'),path=require('path');
const URL=process.env.URL||'http://localhost:8792/qa/live-harness.html';const OUT=process.env.OUT||path.dirname(NM)+'/live-shots';fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
 const page=await b.newPage({viewport:{width:1280,height:800}});
 const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push('pageerror '+e.message));
 const shot=async(name,query)=>{await page.goto(URL+query);await page.waitForFunction(()=>window.__live&&window.__frame>20,{timeout:60000});await page.waitForTimeout(600);
  const f=path.join(OUT,name+'.png');await page.screenshot({path:f});const c=await page.evaluate(()=>({buses:window.__live.buses.size,aircraft:window.__live.aircraft.size,tide:window.__live.tide,polls:window.__live.counts.polls,errors:window.__live.errors}));
  console.log(name,JSON.stringify(c));return c;};
 await shot('mock-bus','?mock=1&view=bus');
 await shot('mock-plane','?mock=1&view=plane');
 await shot('mock-wide','?mock=1&view=wide');
 // real feeds: wait for the three first polls to land (or fail silently), then photograph whatever is there
 await page.goto(URL+'?view=wide');await page.waitForFunction(()=>window.__live&&window.__live.counts.polls.buses>0&&window.__live.counts.polls.aircraft>0&&window.__live.counts.polls.tide>0,{timeout:45000}).catch(()=>{});
 await page.waitForTimeout(800);const real=await page.evaluate(()=>({source:window.__live.aircraftSource,buses:[...window.__live.buses.entries()].map(([id,b])=>({id,label:b.label,status:b.status,x:+b.x.toFixed(1),z:+b.z.toFixed(1)})),aircraft:[...window.__live.aircraft.values()].map(p=>({callsign:p.callsign,alt:Math.round(p.y),x:Math.round(p.x),z:Math.round(p.z)})),tide:window.__live.tide,polls:window.__live.counts.polls,errors:window.__live.errors}));
 console.log('real',JSON.stringify(real));await page.screenshot({path:path.join(OUT,'real-wide.png')});
 // every real bus must sit on a Winthrop-area road: distance to the nearest data/world.json centreline segment
 const world=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','world.json')));
 const segd=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz||1;let t=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/l;t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);};
 // (world.json roads stop at the town line; the 713's western terminal is Orient Heights station in East Boston)
 const OH=await page.evaluate(()=>window.__live.toLocal(42.38685,-71.00470));
 for(const b of real.buses){let best={d:1e9};for(const r of world.roads)for(let i=1;i<r.points.length;i++){const d=segd([b.x,b.z],r.points[i-1],r.points[i]);if(d<best.d)best={d,road:r.name};}
  const oh=Math.hypot(b.x-OH[0],b.z-OH[1]);console.log(`real bus ${b.id} (${b.label}, ${b.status}) at x=${b.x} z=${b.z}: nearest Winthrop road ${best.road} ${best.d.toFixed(1)} m, Orient Heights station ${oh.toFixed(1)} m — ${Math.min(best.d,oh)<60?'ON ROUTE':'OFF ROUTE?'}`);}
 if(real.buses.length){await page.goto(URL+'?view=bus');await page.waitForFunction(()=>window.__live&&window.__live.buses.size>0&&window.__frame>20,{timeout:30000}).catch(()=>{});await page.waitForTimeout(800);await page.screenshot({path:path.join(OUT,'real-bus.png')});}
 if(real.aircraft.length){await page.goto(URL+'?view=plane');await page.waitForFunction(()=>window.__live&&window.__live.aircraft.size>0,{timeout:30000}).catch(()=>{});await page.waitForTimeout(800);await page.screenshot({path:path.join(OUT,'real-plane.png')});}
 console.log('console errors:',errors.length?errors.join('\n'):'none');await b.close();
})().catch(e=>{console.log('ERR',e.stack||e);process.exit(1);});
