#!/usr/bin/env python3
"""factory/index.py -- write worlds/index.json: every pre-built town, so the globe opens them without building."""
import glob, json, os
rows = []
for f in sorted(glob.glob('worlds/*/town.json')):
    t = json.load(open(f)); slug = os.path.basename(os.path.dirname(f))
    rows.append({'slug': slug, 'name': t.get('name', slug), 'lat': t.get('lat'), 'lon': t.get('lon'), 'built': t.get('built'), 'buildings': (t.get('audit') or {}).get('buildings'), 'rides': t.get('rides', 0)})
json.dump({'towns': rows}, open('worlds/index.json', 'w'), indent=1); print(len(rows), 'towns indexed')
