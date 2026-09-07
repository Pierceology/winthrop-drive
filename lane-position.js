export function laneOffset(edge){return edge.direction===0?Math.max(0,Math.min(edge.width/4,edge.width/2-1.15)):0;}
export function lanePoint(edge,t){const offset=laneOffset(edge),n=Math.hypot(edge.dx,edge.dz);return{x:edge.a[0]+edge.dx*t-edge.dz/n*offset,z:edge.a[1]+edge.dz*t+edge.dx/n*offset};}
