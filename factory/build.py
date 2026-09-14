#!/usr/bin/env python3
"""factory/build.py — a drivable town from a bounding box, from free sources only.

    python3 factory/build.py --name lihue --bbox 21.965,-159.385,21.99,-159.355 --out worlds/lihue

Writes, in the shapes Drive Winthrop already boots from:
  world.json            roads + buildings (OpenStreetMap via Overpass), local metric frame
  road-foundation.json  8 m terrain grid (Terrarium tiles: AWS open data) + road evidence
  outline.json          the ink-in
  places.json           OSM amenities/shops with names
  crossings.json        OSM marked crossings with the through-road direction
  power-lines.json      OSM poles and lines
  street-assets.json    OSM lamps, hydrants, bus stops, signals
  naip/                 USGS NAIP ground photo tiles (US only), with extent.json

The surfaces (*-surface.bin) are built by factory/surfaces.py from world.json + the terrain.
Everything here is stdlib + numpy + pyproj + PIL. No keys.
"""
import argparse, json, math, os, sys, time, urllib.parse, urllib.request, io
import numpy as np
from pyproj import Transformer

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
# USGSNAIPPlus, not USGSNAIPImagery: measured 2026-09-14, the Imagery layer is black over Hawaii and Plus is not.
NAIP_WMS = ("https://imagery.nationalmap.gov/arcgis/services/USGSNAIPPlus/ImageServer/WMSServer"
            "?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=USGSNAIPPlus&CRS=EPSG:4326"
            "&BBOX={s},{w},{n},{e}&WIDTH={px}&HEIGHT={px}&FORMAT=image/jpeg")

# OSM highway -> Winthrop's road class/type/width. type 7/8 are footways the network skips.
HIGHWAY = {
    'motorway': (1, 1, 14), 'trunk': (1, 1, 12), 'primary': (2, 2, 11), 'secondary': (3, 3, 10),
    'tertiary': (4, 4, 9), 'unclassified': (5, 5, 7.5), 'residential': (5, 5, 7.5), 'living_street': (6, 6, 6),
    'service': (6, 6, 5), 'footway': (7, 7, 2), 'path': (7, 7, 2), 'pedestrian': (7, 7, 3), 'cycleway': (8, 8, 2.5), 'track': (6, 6, 4)
}


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, file=sys.stderr, flush=True)


def fetch(url, data=None, tries=3, timeout=120):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': 'drive-winthrop-factory/1 (pierceology)'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            last = e; log('retry', i + 1, url[:60], str(e)[:80]); time.sleep(3 * (i + 1))
    raise last


def overpass(query):
    for host in OVERPASS:
        try:
            raw = fetch(host, data=urllib.parse.urlencode({'data': query}).encode(), tries=2, timeout=180)
            return json.loads(raw)
        except Exception as e:
            log('overpass host failed', host, str(e)[:80])
    raise SystemExit('Overpass unavailable')


class Frame:
    """Local metres about the bbox centre, x east, z SOUTH (the game's z grows southward, like Winthrop's)."""
    def __init__(self, s, w, n, e):
        self.lat0, self.lon0 = (s + n) / 2, (w + e) / 2
        self.tm = Transformer.from_crs('EPSG:4326', f'+proj=tmerc +lat_0={self.lat0} +lon_0={self.lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m', always_xy=True)
    def xz(self, lon, lat):
        x, y = self.tm.transform(lon, lat)
        return [round(x, 2), round(-y, 2)]


def build_world(s, w, n, e, frame, name):
    q = f"""[out:json][timeout:170];
    (way["highway"]({s},{w},{n},{e}); way["building"]({s},{w},{n},{e}););
    out body; >; out skel qt;"""
    log('overpass roads+buildings…')
    d = overpass(q)
    nodes = {el['id']: (el['lon'], el['lat']) for el in d['elements'] if el['type'] == 'node'}
    roads, buildings = [], []
    for el in d['elements']:
        if el['type'] != 'way': continue
        t = el.get('tags', {})
        pts = [frame.xz(*nodes[i]) for i in el['nodes'] if i in nodes]
        if len(pts) < 2: continue
        if 'highway' in t:
            hw = t['highway']
            if hw not in HIGHWAY: continue
            cls, typ, width = HIGHWAY[hw]
            if t.get('width'):
                try: width = float(str(t['width']).split()[0])
                except ValueError: pass
            lanes = int(t['lanes']) if str(t.get('lanes', '')).isdigit() else None
            speed = None
            if t.get('maxspeed'):
                m = str(t['maxspeed']).lower()
                try: speed = float(m.replace('mph', '').strip()) if 'mph' in m else float(m) * 0.621371
                except ValueError: speed = None
            oneway = t.get('oneway')
            direction = 1 if oneway in ('yes', '1', 'true') else (-1 if oneway == '-1' else 0)
            segs = len(pts) - 1
            roads.append({'id': el['id'], 'name': (t.get('name') or 'Unnamed road').upper(), 'points': pts, 'width': width,
                          'lanes': lanes, 'speed': speed, 'town': name.upper(), 'class': cls, 'type': typ,
                          'directions': [direction] * segs, 'directionSources': ['osm'] * segs, 'osmHighway': hw})
        elif 'building' in t and el['nodes'][0] == el['nodes'][-1]:
            ring = pts[:-1]
            if len(ring) < 3: continue
            area = abs(sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))) / 2
            if area < 8: continue
            cx = sum(p[0] for p in ring) / len(ring); cz = sum(p[1] for p in ring) / len(ring)
            height = None
            for k in ('height', 'building:height'):
                if t.get(k):
                    try: height = float(str(t[k]).replace('m', '').strip()); break
                    except ValueError: pass
            if height is None and str(t.get('building:levels', '')).replace('.', '').isdigit():
                height = float(t['building:levels']) * 3.2
            buildings.append({'id': f"osm_{el['id']}", 'rings': [ring], 'center': [round(cx, 2), round(cz, 2)], 'area': round(area, 1),
                              'sourceDate': None, 'source': 'OpenStreetMap', 'height': height, 'kind': t.get('building')})
    xs = [p[0] for r in roads for p in r['points']] or [0]; zs = [p[1] for r in roads for p in r['points']] or [0]
    world = {'origin': [frame.lon0, frame.lat0], 'bbox': [min(xs), min(zs), max(xs), max(zs)], 'buildings': buildings, 'roads': roads,
             'audit': {'buildings': len(buildings), 'roadSegments': len(roads), 'namedRoads': len({r['name'] for r in roads if r['name'] != 'UNNAMED ROAD'}),
                       'verifiedBuildingHeights': sum(1 for b in buildings if b['height']), 'coordinateSystem': f'tmerc about {frame.lat0:.5f},{frame.lon0:.5f}; z south',
                       'buildingSources': ['OpenStreetMap'], 'source': 'OpenStreetMap contributors, via Overpass', 'fetched': time.strftime('%Y-%m-%d')}}
    log('roads', len(roads), 'buildings', len(buildings), 'with height', world['audit']['verifiedBuildingHeights'])
    return world

MS_INDEX = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"


def quadkey(lat, lon, z=9):
    x = int((lon + 180) / 360 * 2 ** z); y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2 ** z)
    q = ''
    for i in range(z, 0, -1):
        d, m = 0, 1 << (i - 1)
        if x & m: d += 1
        if y & m: d += 2
        q += str(d)
    return q


def ms_buildings(s, w, n, e, frame, have):
    """Microsoft GlobalMLBuildingFootprints (ODbL): the buildings OpenStreetMap never drew. Merged in where no
    OSM building centre lies within 6 m, so a mapped building keeps its mapped outline."""
    import csv, gzip
    keys = {quadkey(la, lo) for la in (s, n) for lo in (w, e)}
    idx = fetch(MS_INDEX, timeout=90).decode()
    urls = [r['Url'] for r in csv.DictReader(io.StringIO(idx)) if r['QuadKey'] in keys]
    log('microsoft footprint tiles', len(urls), 'for quadkeys', sorted(keys))
    # OSM centres in the local frame for the overlap test
    cells = {}
    for b in have:
        cx, cz = b['center']; cells.setdefault((int(cx // 20), int(cz // 20)), []).append((cx, cz))
    def taken(cx, cz):
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for (px, pz) in cells.get((int(cx // 20) + dx, int(cz // 20) + dz), []):
                    if math.hypot(px - cx, pz - cz) < 6: return True
        return False
    added = []
    for u in urls:
        raw = gzip.decompress(fetch(u, timeout=180))
        for line in raw.decode().splitlines():
            try: g = json.loads(line)
            except ValueError: continue
            geom = g.get('geometry', g); coords = geom.get('coordinates')
            if geom.get('type') != 'Polygon' or not coords: continue
            ring_ll = coords[0]
            lons = [p[0] for p in ring_ll]; lats = [p[1] for p in ring_ll]
            if max(lats) < s or min(lats) > n or max(lons) < w or min(lons) > e: continue
            ring = [frame.xz(lo, la) for lo, la in ring_ll[:-1]]
            if len(ring) < 3: continue
            area = abs(sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))) / 2
            if area < 8: continue
            cx = sum(p[0] for p in ring) / len(ring); cz = sum(p[1] for p in ring) / len(ring)
            if taken(cx, cz): continue
            h = (g.get('properties') or {}).get('height')
            try: h = float(h) if h is not None and float(h) > 0 else None
            except (TypeError, ValueError): h = None
            added.append({'id': f'ms_{len(added)}', 'rings': [ring], 'center': [round(cx, 2), round(cz, 2)], 'area': round(area, 1),
                          'sourceDate': None, 'source': 'Microsoft GlobalMLBuildingFootprints', 'height': h, 'kind': None})
            cells.setdefault((int(cx // 20), int(cz // 20)), []).append((cx, cz))
    log('microsoft buildings added', len(added))
    return added



def make_disc(world, R):
    """A town is a disc: streets end at the rim, buildings inside it (the browser factory does the same)."""
    inside = lambda x, z: x * x + z * z <= R * R
    def rim(a, b):
        dx, dz = b[0] - a[0], b[1] - a[1]; lo, hi = 0.0, 1.0
        for _ in range(18):
            m = (lo + hi) / 2
            if inside(a[0] + dx * m, a[1] + dz * m): lo = m
            else: hi = m
        return [round(a[0] + dx * lo, 2), round(a[1] + dz * lo, 2)]
    roads = []
    for r in world['roads']:
        pieces, cur = [], []
        for i, p in enumerate(r['points']):
            if inside(*p):
                if not cur and i > 0: cur.append(rim(p, r['points'][i - 1]))
                cur.append(p)
            elif cur:
                cur.append(rim(cur[-1], p))
                if len(cur) > 1: pieces.append(cur)
                cur = []
        if len(cur) > 1: pieces.append(cur)
        for k, pts in enumerate(pieces):
            d0 = (r['directions'] or [0])[0]
            roads.append({**r, 'id': r['id'] if k == 0 else f"{r['id']}_{k}", 'points': pts, 'directions': [d0] * (len(pts) - 1), 'directionSources': ['osm'] * (len(pts) - 1)})
    world['roads'] = roads
    world['buildings'] = [b for b in world['buildings'] if inside(*b['center'])]
    world['audit']['roadSegments'] = len(roads); world['audit']['buildings'] = len(world['buildings']); world['audit']['shape'] = f'disc r={round(R)} m'
    return world


def terrarium_grid(s, w, n, e, frame, step=8, z=14):
    """8 m grid of elevations from Terrarium PNG tiles: h = (R*256 + G + B/256) - 32768."""
    from PIL import Image
    def tile(lat, lon):
        x = (lon + 180) / 360 * 2 ** z
        y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2 ** z
        return x, y
    x0, y0 = tile(n, w); x1, y1 = tile(s, e)
    tiles = {}
    for tx in range(int(x0), int(x1) + 1):
        for ty in range(int(y0), int(y1) + 1):
            png = fetch(TERRARIUM.format(z=z, x=tx, y=ty))
            tiles[(tx, ty)] = np.asarray(Image.open(io.BytesIO(png)).convert('RGB')).astype(np.float64)
    log('terrarium tiles', len(tiles))
    def height(lat, lon):
        x, y = tile(lat, lon); tx, ty = int(x), int(y); im = tiles.get((tx, ty))
        if im is None: return 0.0
        px = min(255, int((x - tx) * 256)); py = min(255, int((y - ty) * 256)); r, g, b = im[py, px]
        return r * 256 + g + b / 256 - 32768
    # grid in the local frame
    sw = frame.xz(w, s); ne = frame.xz(e, n)
    xmin, xmax = min(sw[0], ne[0]), max(sw[0], ne[0]); zmin, zmax = min(sw[1], ne[1]), max(sw[1], ne[1])
    cols = int((xmax - xmin) / step) + 2; rows = int((zmax - zmin) / step) + 2
    inv = Transformer.from_crs(frame.tm.target_crs, 'EPSG:4326', always_xy=True)
    vals = []
    for j in range(rows):
        for i in range(cols):
            lon, lat = inv.transform(xmin + i * step, -(zmin + j * step))
            vals.append(height(lat, lon))
    # level the town to its own floor: the lowest 3% of the box becomes 0 (a plateau city rests on the ground; a shore keeps its sea)
    floor = max(0.0, sorted(vals)[int(len(vals) * .03)]) if vals else 0.0
    vals = [round(max(0.0, v - floor), 2) for v in vals]
    log('terrain grid', cols, 'x', rows)
    return {'x': round(xmin, 2), 'z': round(zmin, 2), 'step': step, 'cols': cols, 'rows': rows, 'values': vals}, [xmin, zmin, xmax, zmax]


def road_evidence(world):
    ev = []
    for r in world['roads']:
        if r['type'] in (7, 8): continue
        for i in range(len(r['points']) - 1):
            ev.append({'a': r['points'][i], 'b': r['points'][i + 1], 'name': r['name'], 'width': r['width'], 'objectId': r['id'],
                       'widthSource': 'osm' if r.get('osmHighway') else 'estimated', 'sidewalks': [None, None],
                       'direction': r['directions'][i], 'source': f"https://www.openstreetmap.org/way/{r['id']}"})
    return ev


def build_places_and_furniture(s, w, n, e, frame):
    q = f"""[out:json][timeout:120];
    (node["amenity"]({s},{w},{n},{e}); node["shop"]({s},{w},{n},{e}); node["tourism"]({s},{w},{n},{e}); node["leisure"]({s},{w},{n},{e});
     node["highway"="crossing"]({s},{w},{n},{e}); node["highway"="street_lamp"]({s},{w},{n},{e}); node["emergency"="fire_hydrant"]({s},{w},{n},{e});
     node["highway"="bus_stop"]({s},{w},{n},{e}); node["highway"="traffic_signals"]({s},{w},{n},{e}); node["power"="pole"]({s},{w},{n},{e});
     way["power"="minor_line"]({s},{w},{n},{e}); way["power"="line"]({s},{w},{n},{e}););
    out body; >; out skel qt;"""
    log('overpass places+furniture…')
    d = overpass(q)
    nodes = {el['id']: el for el in d['elements'] if el['type'] == 'node'}
    places, crossings, lamps, hydrants, busStops, signals, poles, lines = [], [], [], [], [], [], [], []
    pole_index = {}
    for el in nodes.values():
        t = el.get('tags', {}); x, z = frame.xz(el['lon'], el['lat'])
        if t.get('name') and (t.get('amenity') or t.get('shop') or t.get('tourism') or t.get('leisure')):
            places.append({'name': t['name'], 'kind': t.get('amenity') or t.get('shop') or t.get('tourism') or t.get('leisure'), 'x': x, 'z': z,
                           'address': ' '.join(filter(None, [t.get('addr:housenumber'), t.get('addr:street')])) or None, 'osm': el['id']})
        if t.get('highway') == 'crossing' and t.get('crossing') != 'unmarked' and t.get('crossing:markings') != 'no':
            crossings.append({'id': el['id'], 'x': x, 'z': z, 'ux': 0, 'uz': 1, 'style': 'zebra' if t.get('crossing') == 'zebra' else ('signals' if t.get('crossing') == 'traffic_signals' else 'ladder')})
        if t.get('highway') == 'street_lamp': lamps.append({'x': x, 'z': z})
        if t.get('emergency') == 'fire_hydrant': hydrants.append({'x': x, 'z': z, 'kind': 'hydrant'})
        if t.get('highway') == 'bus_stop': busStops.append({'x': x, 'z': z, 'name': t.get('name')})
        if t.get('highway') == 'traffic_signals': signals.append({'x': x, 'z': z})
        if t.get('power') == 'pole': pole_index[el['id']] = len(poles); poles.append({'x': x, 'z': z, 'osm': el['id']})
    for el in d['elements']:
        if el['type'] == 'way' and el.get('tags', {}).get('power') in ('minor_line', 'line'):
            idx = [pole_index[i] for i in el['nodes'] if i in pole_index]
            if len(idx) > 1: lines.append(idx)
    log('places', len(places), 'crossings', len(crossings), 'lamps', len(lamps), 'hydrants', len(hydrants), 'bus stops', len(busStops), 'signals', len(signals), 'poles', len(poles), 'lines', len(lines))
    stamp = time.strftime('%Y-%m-%d')
    return ({'source': 'OpenStreetMap contributors', 'fetched': stamp, 'complete': False, 'places': places},
            {'source': 'OpenStreetMap contributors', 'fetched': stamp, 'note': 'direction is resolved against the road network at load', 'crossings': crossings},
            {'source': 'OpenStreetMap contributors', 'fetched': stamp, 'poles': poles, 'lines': lines},
            {'source': 'OpenStreetMap contributors', 'date': stamp, 'complete': False, 'counts': {'lamps': len(lamps), 'busStops': len(busStops), 'signals': len(signals)},
             'lamps': lamps, 'busStops': busStops, 'signals': signals, 'assets': hydrants})


TOUR_CATS = [
    ('food', 'Eat your way through {t}', 'Every restaurant, cafe, bar and bakery in town.', lambda t: t.get('amenity') in ('restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream', 'bakery'), 'food'),
    ('landmarks', 'Landmarks', 'The places people come to see: the historic, the museums, the views.', lambda t: t.get('historic') or t.get('tourism') in ('attraction', 'museum', 'viewpoint', 'artwork', 'gallery', 'zoo', 'aquarium'), 'landmark'),
    ('worship', 'Churches and temples', 'Every place of worship in town.', lambda t: t.get('amenity') == 'place_of_worship', 'church'),
    ('parks', 'All the parks', 'Every park, playground and garden in town, in one loop.', lambda t: t.get('leisure') in ('park', 'playground', 'garden', 'nature_reserve'), 'park'),
    ('beaches', 'Beach to beach', 'Every beach and marina on the water.', lambda t: t.get('natural') == 'beach' or t.get('leisure') in ('marina', 'beach_resort'), 'beach'),
    ('schools', 'Schools', 'Every school and library.', lambda t: t.get('amenity') in ('school', 'library'), 'school'),
    ('nightlife', 'A night out', 'Theatres, cinemas and stadiums.', lambda t: t.get('amenity') in ('theatre', 'cinema') or t.get('leisure') == 'stadium', 'night'),
]


def build_tours(s, w, n, e, frame, town):
    q = f"""[out:json][timeout:120];(nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|bakery|place_of_worship|school|library|theatre|cinema)$"]({s},{w},{n},{e});
    nwr["tourism"~"^(attraction|museum|viewpoint|artwork|gallery|zoo|aquarium)$"]({s},{w},{n},{e});nwr["historic"]({s},{w},{n},{e});
    nwr["leisure"~"^(park|playground|garden|nature_reserve|stadium|marina)$"]({s},{w},{n},{e});nwr["natural"="beach"]({s},{w},{n},{e}););out center tags;"""
    log('overpass rides…')
    try: d = overpass(q)
    except SystemExit: log('rides skipped: overpass unavailable'); return []
    items = []
    for el in d['elements']:
        t = el.get('tags', {}); name = t.get('name')
        if not name: continue
        lat = el.get('lat') or (el.get('center') or {}).get('lat'); lon = el.get('lon') or (el.get('center') or {}).get('lon')
        if lat is None: continue
        x, z = frame.xz(lon, lat)
        items.append({'name': name, 'x': x, 'z': z, 'lat': round(lat, 6), 'lon': round(lon, 6), 't': t, 'address': ' '.join(filter(None, [t.get('addr:housenumber'), t.get('addr:street')])) or None})
    tours = []
    for cid, title, blurb, test, kind in TOUR_CATS:
        seen = set(); stops = []
        for i in items:
            if test(i['t']) and i['name'] not in seen: seen.add(i['name']); stops.append(i)
        if len(stops) < 3: continue
        order, cur, left = [], (0.0, 0.0), stops[:]
        while left and len(order) < 18:
            bi = min(range(len(left)), key=lambda k: (left[k]['x'] - cur[0]) ** 2 + (left[k]['z'] - cur[1]) ** 2)
            cur = (left[bi]['x'], left[bi]['z']); order.append(left.pop(bi))
        tours.append({'id': cid, 'name': title.format(t=town), 'blurb': blurb, 'stops': [{'name': s_['name'], 'x': round(s_['x'], 1), 'z': round(s_['z'], 1), 'lat': s_['lat'], 'lon': s_['lon'], 'kind': kind, 'address': s_['address'], 'photo': None} for s_ in order]})
    log('rides', len(tours), [t['id'] + ':' + str(len(t['stops'])) for t in tours])
    return tours


def naip(s, w, n, e, out, frame, px=2048, cells=2):
    """US only. A few large WMS tiles for the ground photo; outside the US the request 404s and the ground stays a colour."""
    os.makedirs(out, exist_ok=True); got = []
    for j in range(cells):
        for i in range(cells):
            cs, cn = s + (n - s) * j / cells, s + (n - s) * (j + 1) / cells; cw, ce = w + (e - w) * i / cells, w + (e - w) * (i + 1) / cells
            try:
                jpg = fetch(NAIP_WMS.format(s=cs, w=cw, n=cn, e=ce, px=px), tries=2, timeout=180)
                if len(jpg) < 3000: raise ValueError('empty tile')
                f = f'naip-{j}-{i}.jpg'; open(os.path.join(out, f), 'wb').write(jpg)
                # bbox in the town's own metres, y north (the game's roof/ground uv math wants [xmin, ymin, xmax, ymax])
                sw_ = frame.xz(cw, cs); ne_ = frame.xz(ce, cn)
                got.append({'file': f, 'bbox': [cw, cs, ce, cn], 'bboxLocal': [round(sw_[0], 2), round(-sw_[1], 2), round(ne_[0], 2), round(-ne_[1], 2)]})
            except Exception as ex:
                log('naip tile failed', j, i, str(ex)[:60])
    json.dump({'source': 'USGS NAIP via imagery.nationalmap.gov WMS', 'tiles': got}, open(os.path.join(out, 'extent.json'), 'w'))
    log('naip tiles', len(got))
    return got


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--name', required=True); ap.add_argument('--bbox', required=True, help='south,west,north,east')
    ap.add_argument('--out', required=True); ap.add_argument('--no-naip', action='store_true'); a = ap.parse_args()
    s, w, n, e = map(float, a.bbox.split(',')); os.makedirs(a.out, exist_ok=True)
    frame = Frame(s, w, n, e)
    world = build_world(s, w, n, e, frame, a.name)
    try:
        extra = ms_buildings(s, w, n, e, frame, world['buildings'])
        world['buildings'] += extra; world['audit']['buildings'] = len(world['buildings']); world['audit']['buildingSources'].append('Microsoft GlobalMLBuildingFootprints')
        world['audit']['verifiedBuildingHeights'] = sum(1 for b in world['buildings'] if b['height'])
    except Exception as ex:
        log('microsoft footprints skipped:', str(ex)[:100])
    half_m = min((n - s) * 111320, (e - w) * 111320 * math.cos(math.radians((s + n) / 2))) / 2
    world = make_disc(world, half_m * 1.02)
    json.dump(world, open(os.path.join(a.out, 'world.json'), 'w'), separators=(',', ':'))
    outline = [[[round(p[0]), round(p[1])] for p in r['points']] for r in world['roads'] if r['type'] not in (7, 8) and len(r['points']) > 1]
    json.dump(outline, open(os.path.join(a.out, 'outline.json'), 'w'), separators=(',', ':'))
    terrain, bounds = terrarium_grid(s, w, n, e, frame)
    foundation = {'origin': [frame.lon0, frame.lat0], 'bounds': [round(b, 2) for b in bounds], 'terrain': terrain,
                  'surfaces': {}, 'roadEvidence': road_evidence(world),
                  'audit': {'source': 'OpenStreetMap roads; Terrarium elevation (AWS open data)', 'elevation': 'Terrarium z14 (~10 m), sampled at 8 m; below sea level clamped to 0',
                            'sourceRoads': 'Overpass API', 'sourceTerrain': TERRARIUM}}
    json.dump(foundation, open(os.path.join(a.out, 'road-foundation.json'), 'w'), separators=(',', ':'))
    places, crossings, power, assets = build_places_and_furniture(s, w, n, e, frame)
    for f, d in [('places.json', places), ('crossings.json', crossings), ('power-lines.json', power), ('street-assets.json', assets)]:
        json.dump(d, open(os.path.join(a.out, f), 'w'), separators=(',', ':'))
    if not a.no_naip: naip(s, w, n, e, os.path.join(a.out, 'naip'), frame)
    title = a.name.replace('-', ' ').title()
    tours = build_tours(s, w, n, e, frame, title)
    json.dump({'source': 'OpenStreetMap contributors, via Overpass', 'tours': tours}, open(os.path.join(a.out, 'tours.json'), 'w'), separators=(',', ':'))
    json.dump({'name': title, 'slug': a.name, 'lat': frame.lat0, 'lon': frame.lon0, 'country': 'US' if not a.no_naip else None, 'bbox': [s, w, n, e], 'built': time.strftime('%Y-%m-%d %H:%M'),
               'audit': world['audit'], 'rides': len(tours), 'prebuilt': True, 'tagline': f'Every street in {title}, from free open data -- built on the Mac with the full building set.'},
              open(os.path.join(a.out, 'town.json'), 'w'), indent=1)
    log('done ->', a.out)


if __name__ == '__main__':
    main()
