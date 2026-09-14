/* A lane with parked cars on its side runs inboard of them: parked-cars.js writes the parked offset per side on the
   segment (shared by every edge copy), and 2.1 m is two half-cars and a mirror. Pierce, 2026-09-13: "i see moving
   cars drive through parked cars". */
export function laneOffset(edge){const base=edge.direction===0?Math.max(0,Math.min(edge.width/4,edge.width/2-1.15)):0;const p=edge.parked&&edge.parked[edge.reversed?-1:1];return p==null?base:Math.max(.15,Math.min(base,p-2.1));}
export function lanePoint(edge,t){const offset=laneOffset(edge),n=Math.hypot(edge.dx,edge.dz);return{x:edge.a[0]+edge.dx*t-edge.dz/n*offset,z:edge.a[1]+edge.dz*t+edge.dx/n*offset};}
