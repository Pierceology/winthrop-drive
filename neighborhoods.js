import * as THREE from 'three';
export const neighborhoodLight={value:0};
export function neighborhoodGeometry(shape,b,record){
 const h=record?.wall||8;
 let g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);
 if(record?.roof.length){
  // Remove flat top, retaining footprint walls and bottom.
  const p=g.attributes.position,n=g.attributes.normal,keep=[];
  for(let i=0;i<p.count;i+=3)if(n.getY(i)<.5)for(let j=i;j<i+3;j++)keep.push(p.getX(j),p.getY(j),p.getZ(j));
  for(let i=0;i<record.roof.length;i++)keep.push(record.roof[i]);g.dispose();g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(keep,3));g.computeVertexNormals();
  const normal=g.attributes.normal;for(let i=0;i<normal.count;i++)if(normal.getY(i)<-.1&&g.attributes.position.getY(i)>h-.01)normal.setXYZ(i,-normal.getX(i),-normal.getY(i),-normal.getZ(i));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
 }
 const count=g.attributes.position.count,meta=new Float32Array(count*4);let seed=0;for(const c of String(b.id))seed=(seed*31+c.charCodeAt(0))>>>0;
 for(let i=0;i<count;i++)meta.set([record?1:0,h,(seed%1000)/1000,record?.accessory?1:0],i*4);
 g.setAttribute('house',new THREE.Float32BufferAttribute(meta,4));
 // Cross-referenced look (assessor record + the town's own photo): rgb = siding colour, a = 0 none / 1 siding / 2 brick or masonry / 3 stucco or shingle
 const paint=new Float32Array(count*4);{const c=record?.color?new THREE.Color(record.color):null;const mat=(record?.material||'').toLowerCase();const code=!c?0:/brick|stone|concrete|masonry/.test(mat)?2:/stucco|shingle/.test(mat)?3:1;for(let i=0;i<count;i++)paint.set([c?c.r:0,c?c.g:0,c?c.b:0,code],i*4);}
 g.setAttribute('paint',new THREE.Float32BufferAttribute(paint,4));
 const fa=record?.facade||[2.8,0,0,0,0,0];const facade=new Float32Array(count*4),flags=new Float32Array(count);for(let i=0;i<count;i++){facade.set([fa[0],fa[1],fa[2],fa[3]],i*4);flags[i]=fa[4];}g.setAttribute('facade',new THREE.Float32BufferAttribute(facade,4));g.setAttribute('facadeFlags',new THREE.Float32BufferAttribute(flags,1));
 const localY=new Float32Array(count);for(let i=0;i<count;i++)localY[i]=g.attributes.position.getY(i);g.setAttribute('localY',new THREE.Float32BufferAttribute(localY,1));
 g.translate(0,b.base+.15,0);return g;
}
export function neighborhoodMaterial(texture){
 const m=new THREE.MeshStandardMaterial({map:texture,roughness:.93,side:THREE.DoubleSide});
 m.onBeforeCompile=s=>{s.uniforms.eveningWindows=neighborhoodLight;
 s.vertexShader='attribute float localY; varying float vLocalY; attribute vec4 house; varying vec4 vHouse; attribute vec4 paint; varying vec4 vPaint; varying vec3 vBuilding; varying vec3 vFace; attribute vec4 facade; varying vec4 vFacade; attribute float facadeFlags; varying float vFlags;\n'+s.vertexShader;
 s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvLocalY=localY;vHouse=house;vPaint=paint;vBuilding=position;vFace=normal;vFacade=facade;vFlags=facadeFlags;');
 s.fragmentShader='uniform float eveningWindows; varying float vLocalY; varying vec4 vHouse; varying vec4 vPaint; varying vec3 vBuilding; varying vec3 vFace; varying vec4 vFacade; varying float vFlags;\n'+s.fragmentShader;
 s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
 vec3 photo=texture2D(map,vMapUv).rgb;
 float roof=step(.3,abs(vFace.y));
 vec3 paint=mix(vec3(.59,.64,.62),vec3(.79,.76,.66),vHouse.z);
 if(vHouse.z<.22)paint=vec3(.32,.43,.49);
 if(vHouse.z>.82)paint=vec3(.79,.80,.76);
 // the real colour, when the assessor photo gave one; brick and stucco lose the clapboard grooves
 if(vPaint.a>.5)paint=vPaint.rgb;
 // Per-face horizontal coordinate, meter-scaled siding and repeated window bays.
 float u=vBuilding.x*abs(vFace.z)+vBuilding.z*abs(vFace.x);
 float y=vLocalY;
 float groove=1.0-smoothstep(.015,.04,mod(y,.16));
 if(vPaint.a>1.5)groove*=0.0;
 vec3 wall=paint*(1.0-groove*.15);
 // window bays: the real count across the street face when the town photo gave one, else the 2.8 m default
 float hasData=step(3.5,vFlags);
 float isFront=step(.7,dot(normalize(vFace.xz),vFacade.yz))*hasData;
 float bayW=mix(2.8,vFacade.x,hasData);
 float bx=mod(u+vHouse.z*2.,bayW);float wc=bayW*.5;
 vec2 bay=vec2(bx,mod(y,2.75));
 float trim=step(wc-.65,bx)*step(bx,wc+.65)*step(.68,bay.y)*step(bay.y,2.12);
 float glass=step(wc-.54,bx)*step(bx,wc+.54)*step(.79,bay.y)*step(bay.y,2.01);
 wall=mix(wall,vec3(.87,.85,.79),trim);
 vec3 windowColor=mix(vec3(.09,.16,.20),vec3(.20,.29,.32),smoothstep(.8,2.0,bay.y));
 wall=mix(wall,windowColor,glass);
 float muntin=(1.-smoothstep(.025,.045,abs(bx-wc)))+(1.-smoothstep(.025,.045,abs(bay.y-1.40)));
 wall=mix(wall,vec3(.81,.80,.74),clamp(muntin,0.,1.)*glass);
 // the door: on the street face, centred, when we know the face; otherwise the old repeating door
 float doorOld=step(.5,mod(u+vHouse.z*8.,10.))*step(mod(u+vHouse.z*8.,10.),1.5)*step(y,2.05)*step(.3,y);
 float doorFront=step(abs(u-vFacade.w),.5)*isFront*step(y,2.05)*step(.3,y);
 float door=mix(doorOld,doorFront,hasData);
 wall=mix(wall,vec3(.16,.22,.24),door);
 // a porch across the street face where the photo shows one: posts, a rail and its own little roof line
 float hasPorch=step(.5,mod(vFlags,2.0))*isFront;
 if(hasPorch>.5){float pu=u-vFacade.w;float post=1.-smoothstep(.05,.09,abs(mod(pu+.7,1.4)-.7));float rail=step(.85,y)*step(y,.98)+step(.35,y)*step(y,.43);float slat=1.-smoothstep(.02,.04,abs(mod(pu,.16)-.08));float porchRoof=step(2.5,y)*step(y,2.72);
  vec3 porchPaint=vec3(.86,.85,.80);float porchMask=clamp(post*step(y,2.72)+rail+slat*step(.43,y)*step(y,.85)+porchRoof,0.,1.);wall=mix(wall,porchPaint,porchMask*.9);}
 wall=mix(vec3(.39,.40,.38),wall,smoothstep(.28,.38,y));
 float eave=step(vHouse.y-.16,y)*step(y,vHouse.y+.03);wall=mix(wall,vec3(.84,.83,.77),eave);
 if(vHouse.w>.5){wall=paint*(1.-groove*.15);float garage=step(.3,mod(u,4.5))*step(mod(u,4.5),3.9)*step(.1,y)*step(y,2.25);wall=mix(wall,vec3(.68,.69,.66)*(1.-groove*.2),garage);}
 float shingle=1.-smoothstep(.012,.035,mod(y+u*.06,.24));
 vec3 roofColor=vec3(.105,.12,.13)*(1.-shingle*.16);
 vec3 estimated=mix(wall,roofColor,roof);
 diffuseColor.rgb*=mix(mix(vec3(.65,.68,.67),photo,roof),estimated,vHouse.x);
 #endif`);
 s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_MAP\nfloat occupied=step(.38,fract(vHouse.z*31.+floor(u/2.8)*.37+floor(y/2.75)*.61));totalEmissiveRadiance+=vec3(1.,.52,.18)*eveningWindows*glass*(1.-roof)*vHouse.x*(1.-vHouse.w)*occupied*.7;\n#endif');
 };return m;
}
