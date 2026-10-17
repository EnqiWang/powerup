"""Public Census ZCTA polygons for mapping ZIP benchmarks, not utility feeders."""
import json
import math
import time
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

CENSUS_LAYER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2'
CACHE = {}


def zip_list(text):
    items = sorted(set(text.split(',')))
    if not 1 <= len(items) <= 12 or any(len(z) != 5 or not z.isascii() or not z.isdigit() for z in items):
        raise ValueError('Supply one to twelve five-digit ZIP codes.')
    return items


def validate_geojson(raw, zips):
    if raw.get('error'):
        raise ValueError('Census rejected the geography request.')
    if raw.get('type') != 'FeatureCollection' or not isinstance(raw.get('features'), list):
        raise ValueError('Census returned an unexpected geography format.')
    features = []
    for f in raw['features']:
        p = f.get('properties', {})
        zip_code = str(p.get('ZCTA5', ''))
        if zip_code not in zips:
            continue
        g = f.get('geometry') or {}
        if g.get('type') not in ('Polygon', 'MultiPolygon'):
            continue
        def check_coords(coords):
            if not isinstance(coords, list) or not coords:
                raise ValueError('Invalid Census boundary coordinates.')
            if isinstance(coords[0], (float, int)):
                if len(coords) < 2 or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in coords[:2]):
                    raise ValueError('Invalid Census boundary point.')
                if not -180 <= coords[0] <= 180 or not -90 <= coords[1] <= 90:
                    raise ValueError('Census boundary was not returned in longitude/latitude.')
            else:
                for child in coords:
                    check_coords(child)
        check_coords(g.get('coordinates'))
        try:
            lat, lon = float(p['INTPTLAT']), float(p['INTPTLON'])
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
            continue
        features.append({'type': 'Feature', 'id': zip_code,
                         'properties': {'zip': zip_code, 'name': str(p.get('NAME') or 'ZCTA '+zip_code),
                                        'lat': lat, 'lon': lon, 'geography': '2020 Census ZCTA'},
                         'geometry': g})
    return {'type': 'FeatureCollection', 'features': features,
            'missing': [z for z in zips if z not in {f['properties']['zip'] for f in features}],
            'source': 'U.S. Census Bureau TIGERweb — 2020 Census ZCTAs',
            'sourceUrl': CENSUS_LAYER, 'fetchedAt': datetime.now(timezone.utc).isoformat(),
            'note': 'ZCTAs approximate ZIP areas. They are not individual houses, USPS delivery boundaries, actual battery sites, or utility feeders.'}


def fetch(zips, context):
    # ZIP validation happens before interpolation into a fixed-host query.
    zips = zip_list(','.join(zips))
    query = urlencode({'where': 'ZCTA5 IN ('+','.join("'"+z+"'" for z in zips)+')',
                       'outFields': 'ZCTA5,NAME,INTPTLAT,INTPTLON', 'returnGeometry': 'true',
                       'outSR': 4326, 'maxAllowableOffset': 0.0003, 'geometryPrecision': 5, 'f': 'geojson'})
    request = Request(CENSUS_LAYER+'/query?'+query, headers={'Accept': 'application/geo+json, application/json', 'User-Agent': 'PoweruP-Hackathon/1.0'})
    with urlopen(request, timeout=25, context=context) as response:
        if urlparse(response.geturl()).hostname != 'tigerweb.geo.census.gov':
            raise ValueError('Unexpected Census redirect.')
        raw = response.read(8_000_001)
        if len(raw) > 8_000_000:
            raise ValueError('Census geography response exceeded size limit.')
    return validate_geojson(json.loads(raw), zips)


def get(text, context):
    try:
        zips = zip_list(text)
    except ValueError as exc:
        return 400, {'error': str(exc)}
    key = ','.join(zips)
    old = CACHE.get(key)
    if old and time.monotonic()-old['saved'] < 86400:
        return 200, dict(old['data'], cached=True, stale=False)
    try:
        data = fetch(zips, context)
        if len(CACHE) >= 100:
            CACHE.pop(next(iter(CACHE)))
        CACHE[key] = {'saved': time.monotonic(), 'data': data}
        return 200, dict(data, cached=False, stale=False)
    except (OSError, ValueError, TypeError, KeyError, TimeoutError) as exc:
        if old:
            return 200, dict(old['data'], cached=True, stale=True, error='Geography refresh failed; cached boundaries retained.')
        return 502, {'error': 'Census boundary lookup failed: '+str(exc)[:160],
                     'note': 'No substitute or invented ZIP locations were used.'}
