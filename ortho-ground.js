import * as THREE from 'three';
// The ground's photograph, streamed: MassGIS 2023 orthoimagery cut into 256 m tiles at three resolutions
// (assets/ortho, built offline). A base image of the whole town at 2 m/px paints first, so the first frame never
// waits on tiles; near/mid/far tiles then load for a window of the tile grid around the car (or the explore focus),
// are drawn into one atlas per level, and drop out again as the window slides on. One sampler per level keeps the
// shader inside the 16 texture units phones allow. A procedural close-up layer (grass, asphalt, sand, concrete,
// chosen from the photo's own colour) keeps the surface sharp under the wheels where 25 cm pixels would blur.
const LEVELS=[{name:'near',px:1024,win:2,grid:2,maxHeight:170},{name:'mid',px:512,win:4,grid:4,maxHeight:900},{name:'far',px:256,win:6,grid:6,maxHeight:1e9}];
const MAX_INFLIGHT=6;
function noiseTexture(){// a tileable 256 px value-noise sheet: r fine grain, g coarse blotches, b streaks along x, a clumps
 const N=256,d=new Uint8Array(N*N*4),lat=(p,seed)=>{const g=new Float32Array(p*p);let s=seed;for(let i=0;i<p*p;i++){s=(s*1664525+1013904223)>>>0;g[i]=(s>>>8)/16777216;}return (x,y)=>{const fx=x*p/N,fy=y*p/N,i=Math.floor(fx),j=Math.floor(fy),a=fx-i,b=fy-j,sm=t=>t*t*(3-2*t),u=sm(a),v=sm(b),h=(di,dj)=>g[((j+dj)%p)*p+(i+di)%p];return h(0,0)*(1-u)*(1-v)+h(1,0)*u*(1-v)+h(0,1)*(1-u)*v+h(1,1)*u*v;};};
 const f1=lat(64,7),f2=lat(128,11),c1=lat(8,3),c2=lat(16,5),s1=lat(4,9),s2=lat(64,13),k1=lat(32,17),k2=lat(16,19);
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){const o=(y*N+x)*4;d[o]=255*(.5*f1(x,y)+.5*f2(x,y));d[o+1]=255*(.6*c1(x,y)+.4*c2(x,y));d[o+2]=255*(.7*s1(x*8,y)+.3*s2(x,y));d[o+3]=255*(.6*k1(x,y)+.4*k2(x,y));}
 const t=new THREE.DataTexture(d,N,N);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;}
export class OrthoGround{
 constructor({origin,renderer,lowMemory=false,url='./assets/ortho/'}){
  this.origin=origin;this.lowMemory=lowMemory;this.url=url;this.index=null;this.loader=new THREE.TextureLoader();this.images=new THREE.ImageLoader();this.anisotropy=Math.min(renderer.capabilities?.getMaxAnisotropy?.()||1,8);
  this.levels=lowMemory?[]:LEVELS.map(l=>this.makeLevel(l));this.inflight=0;this.loaded=0;this.detail=noiseTexture();this.blank=new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1);this.blank.needsUpdate=true;
  this.material=this.buildMaterial();this.ready=this.load();
 }
 makeLevel(l){const size=l.px*l.grid,canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');ctx.fillStyle='#5a625a';ctx.fillRect(0,0,size,size);
  const atlas=new THREE.CanvasTexture(canvas);atlas.colorSpace=THREE.SRGBColorSpace;atlas.wrapS=atlas.wrapT=THREE.ClampToEdgeWrapping;atlas.generateMipmaps=true;atlas.minFilter=THREE.LinearMipmapLinearFilter;atlas.magFilter=THREE.LinearFilter;atlas.anisotropy=this.anisotropy;
  return {...l,canvas,ctx,atlas,cells:new Array(l.grid*l.grid).fill(null),cellOf:new Float32Array(l.win*l.win).fill(-1),win0:[0,0],loading:new Set(),images:new Map(),dirty:false};}
 buildMaterial(){
  const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,side:THREE.DoubleSide});const self=this;
  const u={orthoBase:{value:this.blank},orthoBaseBox:{value:new THREE.Vector4(0,0,1,1)},orthoHasBase:{value:0},orthoGrid:{value:new THREE.Vector3(0,0,256)},orthoDetail:{value:this.detail},orthoFocus:{value:new THREE.Vector3(0,0,0)},orthoDetailStrength:{value:1}};
  for(const l of this.levels){u[l.name+'Atlas']={value:l.atlas};u[l.name+'Win']={value:new THREE.Vector4(0,0,l.win,l.grid)};u[l.name+'Cell']={value:l.cellOf};}
  m.onBeforeCompile=s=>{
   Object.assign(s.uniforms,u);
   s.vertexShader='varying vec2 landXZ;varying vec3 landWorld;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nlandXZ=position.xz;landWorld=(modelMatrix*vec4(position,1.)).xyz;');
   let decl='varying vec2 landXZ;varying vec3 landWorld;uniform sampler2D orthoBase;uniform vec4 orthoBaseBox;uniform float orthoHasBase;uniform vec3 orthoGrid;uniform sampler2D orthoDetail;uniform vec3 orthoFocus;uniform float orthoDetailStrength;\n';
   let body='vec3 landColor=vec3(.36,.40,.33);bool landHit=false;vec2 landTile=floor((landXZ-orthoGrid.xy)/orthoGrid.z);vec2 landIn=(landXZ-orthoGrid.xy)/orthoGrid.z-landTile;\n';
   for(const l of this.levels){const N=l.win*l.win;decl+=`uniform sampler2D ${l.name}Atlas;uniform vec4 ${l.name}Win;uniform float ${l.name}Cell[${N}];\n`;
    body+=`if(!landHit){vec2 w=landTile-${l.name}Win.xy;if(w.x>=0.&&w.y>=0.&&w.x<${l.name}Win.z&&w.y<${l.name}Win.z){int k=int(w.x)*${l.win}+int(w.y);float c=${l.name}Cell[k];if(c>=0.){float g=${l.name}Win.w;vec2 cell=vec2(mod(c,g),floor(c/g));vec2 uv=vec2((cell.x+landIn.x)/g,1.-(cell.y+landIn.y)/g);landColor=texture2D(${l.name}Atlas,uv).rgb;landHit=true;}}}\n`;}
   body+=`if(!landHit&&orthoHasBase>.5&&landXZ.x>=orthoBaseBox.x&&landXZ.y>=orthoBaseBox.y&&landXZ.x<orthoBaseBox.z&&landXZ.y<orthoBaseBox.w){vec2 uv=vec2((landXZ.x-orthoBaseBox.x)/(orthoBaseBox.z-orthoBaseBox.x),1.-(landXZ.y-orthoBaseBox.y)/(orthoBaseBox.w-orthoBaseBox.y));landColor=texture2D(orthoBase,uv).rgb;landHit=true;}\n`;
   // close-up detail: pick a surface from the photo's colour, then modulate with tileable noise, fading out by 95 m from the focus
   body+=`{float dist=distance(landWorld.xz,orthoFocus.xz);float s=orthoDetailStrength*(1.-smoothstep(35.,95.,dist));if(s>.001&&landHit){
    vec3 c=landColor;float lum=dot(c,vec3(.3,.59,.11));float green=c.g-max(c.r,c.b);float warm=c.r-c.b;
    float grass=smoothstep(.02,.09,green);float sand=(1.-grass)*smoothstep(.5,.62,lum)*smoothstep(.06,.14,warm);float concrete=(1.-grass)*(1.-sand)*smoothstep(.42,.6,lum);float asphalt=(1.-grass)*(1.-sand)*(1.-concrete);
    vec4 nF=texture2D(orthoDetail,landWorld.xz*1.6),nM=texture2D(orthoDetail,landWorld.xz*.35+vec2(.37,.11)),nC=texture2D(orthoDetail,landWorld.xz*.09);
    float g=(nF.a-.5)*.42+(nM.g-.5)*.22+(nC.a-.5)*.12;vec3 grassCol=c*(1.+g)+vec3(-.02,.03,-.03)*(nM.a-.5);
    float a=(nF.r-.5)*.16+(nM.r-.5)*.07+(nF.b-.5)*.06;vec3 asphaltCol=c*(1.+a);
    float sd=(nF.r-.5)*.22+(nM.b-.5)*.10+(nC.g-.5)*.08;vec3 sandCol=c*(1.+sd);
    float cc=(nF.g-.5)*.10+(nM.r-.5)*.05;vec3 concreteCol=c*(1.+cc);
    vec3 detailed=grassCol*grass+asphaltCol*asphalt+sandCol*sand+concreteCol*concrete;landColor=mix(landColor,detailed,s);}}\n`;
   s.fragmentShader=decl+s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n${body}\ndiffuseColor.rgb*=landColor;`);
   self.shader=s;
  };
  m.customProgramCacheKey=()=>'ortho-ground-'+this.levels.map(l=>l.win).join('-');
  this.uniforms=u;return m;
 }
 async load(){
  try{this.index=await (await fetch(this.url+'index.json')).json();}catch(e){console.warn('ortho index unavailable',e);return;}
  const ix=this.index,base=this.lowMemory?ix.baseSmall:ix.base;this.tiles=new Set(ix.tiles.map(([i,j])=>i+'-'+j));this.uniforms.orthoGrid.value.set(ix.x0,ix.z0,ix.tile);
  const t=await this.loader.loadAsync(this.url+base.file);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.anisotropy=this.anisotropy;
  this.uniforms.orthoBase.value=t;this.uniforms.orthoBaseBox.value.set(ix.x0,ix.z0,ix.x0+ix.nx*ix.tile,ix.z0+ix.nz*ix.tile);this.uniforms.orthoHasBase.value=1;this.baseReady=true;
 }
 // Called a few times a second with the point the ground should be sharpest around (the car, or the explore target)
 // and the camera's height above it. Each level keeps a window of the tile grid centred there; levels too fine for
 // the height are emptied. Tiles are fetched nearest first, drawn into the level's atlas when they arrive, and the
 // atlas re-uploads once per update at most.
 update(x,z,height,detailStrength=1){
  this.uniforms.orthoFocus.value.set(x,0,z);this.uniforms.orthoDetailStrength.value=detailStrength;this.last={x:+x.toFixed(1),z:+z.toFixed(1),height:+height.toFixed(1)};if(!this.index||this.lowMemory)return;
  const ix=this.index,T=ix.tile;
  for(const l of this.levels){
   const W=l.win,active=height<=l.maxHeight;
   const i0=active?Math.max(0,Math.min(ix.nx-W,Math.floor((x-ix.x0)/T-W/2+.5))):-1e6,j0=active?Math.max(0,Math.min(ix.nz-W,Math.floor((z-ix.z0)/T-W/2+.5))):-1e6;
   const wanted=new Map();if(active)for(let i=i0;i<i0+W;i++)for(let j=j0;j<j0+W;j++){const key=i+'-'+j;if(this.tiles.has(key))wanted.set(key,{i,j,d:Math.hypot(ix.x0+(i+.5)*T-x,ix.z0+(j+.5)*T-z)});}
   // free cells whose tile has left the window
   l.cells.forEach((key,c)=>{if(key&&!wanted.has(key))l.cells[c]=null;});
   const held=new Set(l.cells.filter(Boolean));
   for(const [key,w] of [...wanted].sort((a,b)=>a[1].d-b[1].d)){if(held.has(key))continue;const img=l.images.get(key);if(img){this.place(l,key,img);continue;}
    if(l.loading.has(key)||this.inflight>=MAX_INFLIGHT)continue;l.loading.add(key);this.inflight++;
    this.images.loadAsync(`${this.url}${l.name}/${key}.webp`).then(im=>{l.images.set(key,im);this.loaded++;if(l.images.size>28){const first=l.images.keys().next().value;if(!l.cells.includes(first))l.images.delete(first);}}).catch(()=>{}).finally(()=>{this.inflight--;l.loading.delete(key);});}
   // the window and its cell table, whether or not anything changed this round
   l.win0=[i0,j0];this.uniforms[l.name+'Win'].value.set(i0,j0,W,l.grid);l.cellOf.fill(-1);
   l.cells.forEach((key,c)=>{if(!key)return;const [i,j]=key.split('-').map(Number);const k=(i-i0)*W+(j-j0);if(k>=0&&k<W*W)l.cellOf[k]=c;});
   if(l.dirty){l.atlas.needsUpdate=true;l.dirty=false;}
  }
 }
 place(l,key,img){const c=l.cells.indexOf(null);if(c<0)return;l.cells[c]=key;const g=l.grid,px=l.px;l.ctx.drawImage(img,(c%g)*px,Math.floor(c/g)*px,px,px);l.dirty=true;}
 stats(){return {last:this.last,base:!!this.baseReady,lowMemory:this.lowMemory,pending:this.inflight+this.levels.reduce((n,l)=>n+l.loading.size,0),loaded:this.loaded,bound:Object.fromEntries(this.levels.map(l=>[l.name,l.cells.filter(Boolean)])),window:Object.fromEntries(this.levels.map(l=>[l.name,l.win0]))};}
}
