// Normalized image coordinates. A projective transform maps a unit wall to its photograph.
export function homography(corners){
 if(!Array.isArray(corners)||corners.length!==4||corners.some(p=>p.length!==2||p.some(x=>!Number.isFinite(x)||x<0||x>1)))throw Error('Choose four image corners.');
 const cross=corners.map((p,i)=>{const q=corners[(i+1)%4],r=corners[(i+2)%4];return(q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]);});
 if(!cross.every(v=>v>1e-5))throw Error('Corners must form a convex wall: top left, top right, bottom right, bottom left.');
 const A=[],unit=[[0,0],[1,0],[1,1],[0,1]];
 unit.forEach(([u,v],i)=>{const[x,y]=corners[i];A.push([u,v,1,0,0,0,-u*x,-v*x,x],[0,0,0,u,v,1,-u*y,-v*y,y]);});
 for(let i=0;i<8;i++){let k=i;for(let j=i+1;j<8;j++)if(Math.abs(A[j][i])>Math.abs(A[k][i]))k=j;[A[i],A[k]]=[A[k],A[i]];if(Math.abs(A[i][i])<1e-10)throw Error('Wall corners are too close together.');const d=A[i][i];for(let j=i;j<9;j++)A[i][j]/=d;for(let r=0;r<8;r++)if(r!==i){const d=A[r][i];for(let j=i;j<9;j++)A[r][j]-=d*A[i][j];}}
 const H=[...A.map(row=>row[8]),1];
 for(const[u,v]of unit)if(H[6]*u+H[7]*v+1<=1e-5)throw Error('Perspective is too extreme. Use a clearer photograph.');
 return H;
}
export function project(H,u,v){const q=H[6]*u+H[7]*v+H[8];return[(H[0]*u+H[1]*v+H[2])/q,(H[3]*u+H[4]*v+H[5])/q];}
export function validateFacade(r){
 if(!r||typeof r.building!=='string'||!Number.isInteger(r.edge)||r.edge<0||!Number.isFinite(r.height)||r.height<1||r.height>50||!Number.isFinite(r.baseOffset)||Math.abs(r.baseOffset)>10)throw Error('Invalid wall dimensions.');
 if(typeof r.image!=='string'||r.image.length>16000000||!/^data:image\/(jpeg|png|webp);base64,/.test(r.image))throw Error('Invalid image.');
 if(typeof r.source!=='string'||!r.source.trim()||typeof r.rights!=='string'||!r.rights.trim())throw Error('Record the photograph source and reuse permission.');
 homography(r.corners);return r;
}
export function wallFrame(building,edge){const ring=building.rings[0],a=ring[edge],b=ring[edge+1];if(!a||!b)throw Error('Wall not in footprint.');const dx=b[0]-a[0],dz=b[1]-a[1],width=Math.hypot(dx,dz);if(width<.2)throw Error('Wall too short.');const area=ring.slice(0,-1).reduce((sum,p,i)=>sum+p[0]*ring[i+1][1]-ring[i+1][0]*p[1],0),sign=area>0?1:-1;return {a:area>0?b:a,b:area>0?a:b,width,normal:[sign*dz/width,-sign*dx/width]};}
