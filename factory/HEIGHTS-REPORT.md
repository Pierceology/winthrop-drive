# Building heights — coverage report (2026-09-14)

Deliverable: `data/building-heights.json` — 4,769 of 5,633 `world.json` buildings (84.7%) given a height in metres. Every number in the file comes from one source: Microsoft GlobalMLBuildingFootprints. No height was estimated, converted or filled in.

## Frame check
- `world.json` ids are MassGIS `STRUCT_ID`s of the form `easting_northing` (EPSG:26986). First building: center `[-838.03, -2578.83]` → easting 242562, northing 903728.8 → id `242562_903729`. So `easting = x + 243400`, `northing = 901150 − z` (z grows southward) — confirmed on the ids themselves, not just one landmark.
- Winthrop Town Hall (OSM way 29710074, 42.377633 N −70.984649 W) converted through pyproj lands *inside* world building `242445_903142` (604 m²), distance 0.0 m. (The coordinate given in the brief, 42.3752/−70.9825, is ~350 m south-east of the real Town Hall and lands on no building; OSM's position was used.)

## Sources
### 1. Microsoft GlobalMLBuildingFootprints (ODbL) — used
- Index: `dataset-links.csv` (30,345 rows). Winthrop's building extent is 42.346–42.390 N, −70.996 to −70.954 W; both corners fall in one zoom-9 quadkey: **030233213** (`RegionName=UnitedStates`, release `2026-02-03`, 19.0 MB csv.gz, 215,549 polygons).
- Neighbouring tiles 030233212 / 030233230 / 030233231 exist in the index but were not needed — the bbox does not cross the tile edge.
- Inside the 42.34–42.40 / −71.00–−70.95 bbox: 6,195 polygons, 6,160 with `height > 0` (35 carry −1 = unknown). Tile-wide median height in bbox 5.37 m, max 23.88 m.
- Matching: each Microsoft polygon reprojected to EPSG:26986 → local frame; a world building takes the Microsoft polygon whose centroid is nearest, accepted if centroid distance < 5 m (4,748 buildings) or if each polygon contains the other's centroid (21 buildings). Median accepted centroid distance 0.68 m.

### 2. OpenStreetMap via Overpass — queried, not usable
- `overpass-api.de` and `overpass.kumi.systems` timed out twice ("server too busy"); `overpass.private.coffee` answered: 6,909 building ways/relations in the bbox.
- Tags present: `height` on **0** buildings; `building:levels` on **6**, of which **1** is in Winthrop (Letterie's Italian Market, 67 Woodside Ave, 1 level — Microsoft gives that footprint 4.72 m). The other five are in East Boston/Revere, outside every world building (>1 km away).
- Nothing from OSM went into the file: storeys are not metres and a levels×N conversion would be an invented number.

### 3. MassGIS Building Structures (2-D) — downloaded, no height field
- Per-town shapefile `structures_poly_346.zip` (Winthrop, town id 346; 738 KB; files dated 2026-05-20; 5,551 polygons; NAD83 Mass. Mainland). Attribute table: STRUCT_ID, SOURCE, SOURCETYPE, SOURCEDATE, SOURCEDATA, MOVED, AREA_SQ_FT, TOWN_ID/2/3, LOCAL_ID, EDIT_DATE, EDIT_BY, COMMENTS, SHAPE_AREA, SHAPE_LEN. **No height, elevation or lidar attribute** — neither in the DBF nor in the FGDC metadata's attribute list. The mass.gov layer description mentions LiDAR-derived roof heights; the shapefile as distributed today does not carry them. (`world.json` was evidently built from this layer — same ids, same SOURCEDATA strings.)
- `gis-prod.digital.mass.gov` and `arcgisserver.digital.mass.gov` REST endpoints returned 502/proxy errors during this session; not verified.

## Coverage numbers
| | count |
|---|---|
| world.json buildings | 5,633 |
| matched (height from Microsoft) | **4,769** (84.7%) |
| unmatched | 864 |
| — no Microsoft polygon touches the footprint at all | 765 |
| — Microsoft polygon overlaps but centroid > 5 m off (different segmentation) | 99 |
| unmatched by area: < 50 m² / 50–150 / ≥ 150 | 620 / 144 / 100 |

Unmatched median footprint 35 m² vs 120 m² for matched — the misses are mostly sheds and garages Microsoft did not detect.

Height distribution of the 4,769 matched: median **5.38 m**, mean 5.20, p10 3.15, p90 6.76, max 20.38; 4 buildings over 12 m, 2 over 15 m.

## Sanity checks against named buildings
Positions from OSM (Nominatim), converted with pyproj; each lands in (or next to) one world building.

| building | world id | area | Microsoft height |
|---|---|---|---|
| Winthrop Town Hall, 1 Metcalf Sq (OSM way 29710074) | 242445_903142 | 604 m² | 10.84 m |
| Winthrop Public Library, 2 Winthrop St (OSM node 367779339) | 242473_903152 | 675 m² | 9.15 m |
| E. B. Newton School, Pauline St (OSM way 29851134) | 242307_903050 | 814 m² | 11.98 m |
| Winthrop Fire Dept, 40 Pauline St (OSM node 257495260) | 242390_903015 | 330 m² | 7.38 m |
| Winthrop Middle/High School, 400 Main St (OSM rel 14073612) | 242874_903445 | 7,768 m² | 6.74 m |
| The Winthrop Arms hotel, 130 Grovers Ave (OSM node 13051134701) | 243499_904178 | 654 m² | 7.04 m |
| St. John the Evangelist Church, Winthrop St (OSM node 358278543) | 242566_903357 | 872 m² | unmatched — no Microsoft polygon overlaps it |

Tallest in the file: 1 Pond St, Winthrop Highlands (`243722_904324`, 1,845 m², residential per OSM) 20.38 m; 550 Pleasant St (`241828_903461`) 12.42 m; 200 Governors Drive (Governor's Park Condominiums, `242676_903771`) 11.75 m.

Reading of the checks: the three-storey masonry civic buildings (Town Hall, Newton School, Library) come out at 9–12 m, which is consistent with their storey count. The two large multi-storey buildings — the Middle/High School and the four-storey Winthrop Arms — come out at 6.7–7.0 m, lower than their storey counts suggest. Microsoft's heights are model estimates from imagery, and on this evidence they read low on big multi-storey footprints; the town-wide median of 5.38 m should be treated the same way. That is an observation, not a correction — nothing in the file was adjusted.

## Failures / not done
- Overpass: two of three mirrors timed out; result obtained from the third.
- MassGIS: heights not present in the current download (see §3).
- OSM: no usable height data for Winthrop.
- 864 buildings (15.3%) remain `null`; 765 of those have no Microsoft detection at all.
