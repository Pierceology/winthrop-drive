// Traffic signals that actually cycle. Winthrop's lights are not published as a timing plan, so this is a standard
// two-phase plan per junction: the busier axis gets the longer green. Every car and the auto-driver obey it.
export class SignalSystem{
 constructor(signals,network,{mainGreen=26,crossGreen=16,yellow=3.5,allRed=1.5}={}){this.nodes=[];this.timing={mainGreen,crossGreen,yellow,allRed};this.cycle=mainGreen+crossGreen+2*(yellow+allRed);
  signals.forEach((sg,i)=>{const approaches=[];
   for(const s of network.segments){if(!(s.width>=3)||s.length<12)continue;const t=((sg.x-s.a[0])*s.dx+(sg.z-s.a[1])*s.dz)/(s.length*s.length),px=s.a[0]+s.dx*t,pz=s.a[1]+s.dz*t;if(t<-.05||t>1.05||Math.hypot(px-sg.x,pz-sg.z)>12)continue;
    const ends=[];if(t>.15)ends.push(s.a);if(t<.85)ends.push(s.b);for(const [fx,fz] of ends){let dx=fx-sg.x,dz=fz-sg.z;const L=Math.hypot(dx,dz)||1;if(L<12)continue;approaches.push({hx:-dx/L,hz:-dz/L,width:s.width});}}
   if(!approaches.length)return;// axis 0 = the widest approach and anything roughly parallel to it
   const main=approaches.reduce((a,b)=>b.width>a.width?b:a);for(const a of approaches)a.axis=Math.abs(a.hx*main.hx+a.hz*main.hz)>.5?0:1;
   this.nodes.push({x:sg.x,z:sg.z,approaches,offset:(i*7919)%this.cycle,mainAxis:0});});
 }
 // 'green' | 'yellow' | 'red' for an approach axis at a node
 state(node,axis,time){const {mainGreen,crossGreen,yellow,allRed}=this.timing;let t=(time+node.offset)%this.cycle;
  if(axis===0){if(t<mainGreen)return 'green';if(t<mainGreen+yellow)return 'yellow';return 'red';}
  t-=mainGreen+yellow+allRed;if(t<0)return 'red';if(t<crossGreen)return 'green';if(t<crossGreen+yellow)return 'yellow';return 'red';}
 axisFor(node,hx,hz){let best=null;for(const a of node.approaches){const d=a.hx*hx+a.hz*hz;if(!best||d>best.d)best={d,axis:a.axis};}return best?best.axis:0;}
 near(x,z,r=9){let best=null;for(const n of this.nodes){const d=Math.hypot(n.x-x,n.z-z);if(d<r&&(!best||d<best.d))best={n,d};}return best&&best.n;}
 // What a driver heading (hx,hz) toward the junction at (x,z) sees
 lightAhead(x,z,hx,hz,time,r=9){const n=this.near(x,z,r);if(!n)return null;return {node:n,state:this.state(n,this.axisFor(n,hx,hz),time)};}
}
