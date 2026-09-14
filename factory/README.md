# factory — a drivable town from a bounding box

`python3 factory/build.py --name lihue --bbox 21.965,-159.385,21.99,-159.355 --out worlds/lihue`

Produces the files the game boots from, for any place on earth, from free sources only:

| file | source | notes |
|---|---|---|
| `world.json` | OpenStreetMap (Overpass) roads + buildings | local metric frame (transverse Mercator about the bbox centre), same fields as Winthrop's |
| `road-foundation.json` | Terrarium elevation tiles (AWS open data, Mapzen/NASA/USGS blend) | 8 m grid like Winthrop's; 1 m USGS 3DEP where the US has flown it comes later |
| `outline.json` | derived from world.json | the ink-in |
| `crossings.json`, `street-assets.json`, `power-lines.json`, `places.json` | OpenStreetMap | same shapes as Winthrop's fetches |
| ground photo | USGS NAIP WMS (US only, free, no key) | tiles written under `focus/` for the ortho layer; outside the US the ground stays a colour |
| surfaces (`*-surface.bin`) | built from roads + terrain | road / walk / curb / ground triangles the contact field samples |

What no source gives: verified places, house fronts, roof detail, the music. That is the week of hands per town.
