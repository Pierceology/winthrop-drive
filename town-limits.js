// Where the town stops being drawn. Pierce, 2026-09-13, of a line running north off the top of the peninsula into open
// water: "is that part of Winthrop? if not lose it". Past the end of the Short Beach seawall the mapped road and its
// power line continue 160 m over what the aerial shows as sea, to the edge of the fetch. Nothing north-west of the
// seawall's end is drawn: not the road, its surface, its poles, nor the buildings the fetch caught over there.
export function inTown(x, z) { if (window.__world && window.__world !== 'winthrop') return true; return !(x < -600 && z < -3395); }
