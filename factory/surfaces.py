#!/usr/bin/env python3
"""factory/surfaces.py — the four surface files the game drives on, from world.json + the terrain grid.

    python3 factory/surfaces.py --world worlds/lihue

Writes road-surface.bin, walk-surface.bin, curb-surface.bin, ground-surface.bin (Float32 triangles, x y z per vertex,
the exact format road-surface.js reads) and fills road-foundation.json's `surfaces` entry.

Heights: the contact field hands back surface height minus 0.12 and the car adds 0.14, so the road top is written
0.12 m above the terrain, the sidewalk 0.27 m (a 15 cm curb), and the curb strip slopes between the two.
"""
import argparse, json, math, os, sys
import numpy as np

ROAD_LIFT, WALK_LIFT, CURB_W, WALK_W = 0.12, 0.27, 0.25, 1.6
GROUND_STEP = 16          # metres between ground vertices; Winthrop's 100k-triangle ground is about this density


def log(*a): print(*a, file=sys.stderr, flush=True)


class Terrain:
    def __init__(self, t):
        self.x, self.z, self.step, self.cols, self.rows = t['x'], t['z'], t['step'], t['cols'], t['rows']
        self.v = np.asarray(t['values'], dtype=np.float64).reshape(self.rows, self.cols)
    def h(self, x, z):
        u = min(max((x - self.x) / self.step, 0), self.cols - 1.000001); w = min(max((z - self.z) / self.step, 0), self.rows - 1.000001)
        i, j = int(u), int(w); a, b = u - i, w - j; v = self.v
        return v[j, i] * (1 - a) * (1 - b) + v[j, i + 1] * a * (1 - b) + v[j + 1, i] * (1 - a) * b + v[j + 1, i + 1] * a * b


def quad(tris, p, q, r, s):
    """two triangles for the quad p q r s (counter-clockwise seen from above)"""
    tris.extend([p, q, r, p, r, s])


def strip(tris, a, b, off0, off1, lift0, lift1, T):
    """a strip along segment a->b from lateral offset off0 to off1 (metres, positive = right of travel), lifted above terrain"""
    dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
    if L < 0.2: return
    nx, nz = -dz / L, dx / L
    pts = []
    for (x, z) in (a, b):
        for off, lift in ((off0, lift0), (off1, lift1)):
            px, pz = x + nx * off, z + nz * off
            pts.append((px, T.h(px, pz) + lift, pz))
    a0, a1, b0, b1 = pts
    quad(tris, a0, b0, b1, a1)


def disc(tris, c, radius, lift, T, n=10):
    cy = T.h(c[0], c[1]) + lift
    for k in range(n):
        t0, t1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        p = (c[0] + math.cos(t0) * radius, T.h(c[0] + math.cos(t0) * radius, c[1] + math.sin(t0) * radius) + lift, c[1] + math.sin(t0) * radius)
        q = (c[0] + math.cos(t1) * radius, T.h(c[0] + math.cos(t1) * radius, c[1] + math.sin(t1) * radius) + lift, c[1] + math.sin(t1) * radius)
        tris.extend([(c[0], cy, c[1]), p, q])


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--world', required=True); a = ap.parse_args()
    world = json.load(open(os.path.join(a.world, 'world.json'))); fnd = json.load(open(os.path.join(a.world, 'road-foundation.json')))
    T = Terrain(fnd['terrain'])
    road, walk, curb, ground = [], [], [], []
    for r in world['roads']:
        if r['type'] in (7, 8): continue
        w = max(3.0, float(r.get('width') or 7.5)); half = w / 2
        hasWalk = r['type'] <= 5 and (r.get('osmHighway') not in ('service', 'track'))
        pts = r['points']
        for i in range(len(pts) - 1):
            a_, b_ = pts[i], pts[i + 1]
            strip(road, a_, b_, -half, half, ROAD_LIFT, ROAD_LIFT, T)
            for side in (-1, 1):
                strip(curb, a_, b_, side * half, side * (half + CURB_W), ROAD_LIFT, WALK_LIFT, T)
                if hasWalk: strip(walk, a_, b_, side * (half + CURB_W), side * (half + CURB_W + WALK_W), WALK_LIFT, WALK_LIFT, T)
        for p in pts:   # joints: a disc of road at every vertex so bends and junctions have no wedge of grass
            disc(road, p, half, ROAD_LIFT, T)
    # ground: the whole terrain at GROUND_STEP, at terrain height (the road sits 12 cm above it)
    x0, z0 = T.x, T.z; X = int((T.cols - 1) * T.step / GROUND_STEP); Z = int((T.rows - 1) * T.step / GROUND_STEP)
    H = [[T.h(x0 + i * GROUND_STEP, z0 + j * GROUND_STEP) for i in range(X + 1)] for j in range(Z + 1)]
    cx0, cz0 = x0 + (T.cols - 1) * T.step / 2, z0 + (T.rows - 1) * T.step / 2; rr = min((T.cols - 1), (T.rows - 1)) * T.step / 2 * 1.02   # the ground stops at the rim of the disc
    for j in range(Z):
        for i in range(X):
            if math.hypot(x0 + (i + .5) * GROUND_STEP - cx0, z0 + (j + .5) * GROUND_STEP - cz0) > rr: continue
            p = (x0 + i * GROUND_STEP, H[j][i], z0 + j * GROUND_STEP); q = (x0 + (i + 1) * GROUND_STEP, H[j][i + 1], z0 + j * GROUND_STEP)
            r_ = (x0 + (i + 1) * GROUND_STEP, H[j + 1][i + 1], z0 + (j + 1) * GROUND_STEP); s_ = (x0 + i * GROUND_STEP, H[j + 1][i], z0 + (j + 1) * GROUND_STEP)
            quad(ground, p, q, r_, s_)
    surfaces = {}
    for kind, tris in (('road', road), ('walk', walk), ('curb', curb), ('ground', ground)):
        arr = np.asarray(tris, dtype=np.float32).reshape(-1)
        f = f'{kind}-surface.bin'; arr.tofile(os.path.join(a.world, f))
        surfaces[kind] = {'url': f'./{a.world.rstrip("/")}/{f}', 'triangles': len(tris) // 3}
        log(kind, len(tris) // 3, 'triangles', round(arr.nbytes / 1e6, 1), 'MB')
    fnd['surfaces'] = surfaces
    json.dump(fnd, open(os.path.join(a.world, 'road-foundation.json'), 'w'), separators=(',', ':'))
    log('surfaces written into', a.world)


if __name__ == '__main__':
    main()
