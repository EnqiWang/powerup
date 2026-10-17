"""PoweruP local server. Python 3.10+, standard library only."""
import geography
import argparse
import calendar
import json
import math
import os
import time
from load_six_households import load as load_public, convert as convert_households, context as https_context
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
CACHE = {}
SCE_CACHE = {}
TTL = 300
USER_AGENT = os.environ.get('NWS_USER_AGENT', 'PoweruP-Hackathon-Prototype/1.0')


def now():
    return datetime.now(timezone.utc).isoformat()


def coordinates(query):
    try:
        lat = float(query.get('lat', ['34.0224'])[0])
        lon = float(query.get('lon', ['-118.2851'])[0])
    except (ValueError, TypeError):
        raise ValueError('Latitude and longitude must be numbers.')
    if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError('Coordinates are outside valid latitude/longitude bounds.')
    return round(lat, 4), round(lon, 4)


def nws_json(url):
    # Only call the official NWS API; do not follow arbitrary URLs from inputs.
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.netloc != 'api.weather.gov':
        raise ValueError('Unexpected NWS forecast URL.')
    request = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/geo+json'})
    with urlopen(request, timeout=10, context=https_context()) as response:
        if urlparse(response.geturl()).hostname != 'api.weather.gov':
            raise ValueError('Unexpected upstream redirect.')
        data = response.read(5_000_001)
        if len(data) > 5_000_000:
            raise ValueError('Upstream response exceeded size limit.')
        return json.loads(data)


def fetch_weather(lat, lon):
    point_url = f'https://api.weather.gov/points/{lat},{lon}'
    points = nws_json(point_url)['properties']
    forecast_url = points['forecastHourly']
    forecast = nws_json(forecast_url)['properties']
    alerts_url = f'https://api.weather.gov/alerts/active?point={lat},{lon}'
    raw_alerts = nws_json(alerts_url)
    alerts = []
    for item in raw_alerts.get('features', []):
        p = item.get('properties', {})
        alerts.append({k: p.get(k) for k in ['id', 'event', 'severity', 'certainty', 'urgency', 'headline', 'description', 'instruction', 'sent', 'onset', 'expires', 'areaDesc', 'web']})
    periods = []
    for p in forecast.get('periods', [])[:24]:
        periods.append({k: p.get(k) for k in ['startTime', 'endTime', 'temperature', 'temperatureUnit', 'windSpeed', 'windDirection', 'shortForecast', 'isDaytime']})
    if not periods:
        raise ValueError('NWS returned no hourly forecast periods.')
    location = points.get('relativeLocation', {}).get('properties', {})
    return {'source': 'National Weather Service', 'lat': lat, 'lon': lon,
            'location': ', '.join(filter(None, [location.get('city'), location.get('state')])),
            'fetchedAt': now(), 'forecastUpdated': forecast.get('updateTime') or forecast.get('updated') or forecast.get('generatedAt'),
            'forecastUrl': forecast_url, 'alertsUrl': alerts_url, 'periods': periods, 'alerts': alerts,
            'note': 'Weather alerts do not confirm a utility shutoff. Battery and feeder data remain simulated.'}


def get_weather(lat, lon):
    key = (lat, lon)
    old = CACHE.get(key)
    if old and time.monotonic() - old['saved'] < TTL:
        return 200, dict(old['data'], cached=True, stale=False)
    try:
        data = fetch_weather(lat, lon)
        if len(CACHE) >= 100:
            CACHE.pop(next(iter(CACHE)))
        CACHE[key] = {'saved': time.monotonic(), 'data': data}
        return 200, dict(data, cached=False, stale=False)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as exc:
        # Never turn a failed request into an empty alert list / "all clear".
        reason = 'NWS request failed. Retry later or check that this location is supported.'
        if isinstance(exc, HTTPError):
            reason = f'NWS returned HTTP {exc.code}. Retry later or check location coverage.'
        if old:
            return 200, dict(old['data'], cached=True, stale=True, error=reason)
        return 502, {'source': 'National Weather Service', 'error': reason, 'stale': True, 'attemptedAt': now()}


def fetch_sce(zip_code):
    # ZIP is validated before building a fixed-host, read-only public API query.
    if len(zip_code) != 5 or not zip_code.isascii() or not zip_code.isdigit():
        raise ValueError('Enter a five-digit ZIP code.')
    query = urlencode({'where': f"zip_code='{zip_code}' AND customer_class='Residential'",
                       'order_by': 'year DESC, month DESC', 'limit': 100})
    url = 'https://openenergyhub.ornl.gov/api/explore/v2.1/catalog/datasets/sce-energy-data/records?' + query
    request = Request(url, headers={'User-Agent': 'PoweruP-Hackathon/1.0', 'Accept': 'application/json'})
    with urlopen(request, timeout=20, context=https_context()) as response:
        if urlparse(response.geturl()).hostname != 'openenergyhub.ornl.gov':
            raise ValueError('Unexpected SCE portal redirect.')
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('SCE response exceeded size limit.')
        payload = json.loads(raw)
    if not isinstance(payload.get('results'), list):
        raise ValueError('SCE portal returned an unexpected response.')
    records = []
    for row in payload['results']:
        if str(row.get('zip_code')) != zip_code or row.get('customer_class') != 'Residential':
            continue
        try:
            year, month = int(row['year']), int(row['month'])
            if not 1900 <= year <= 2200 or not 1 <= month <= 12:
                continue
        except (ValueError, KeyError, TypeError):
            continue
        item = {key: row.get(key) for key in ['zip_code', 'customer_class', 'combined', 'totalaccounts', 'totalkwh', 'averagekwh']}
        item.update(year=year, month=month)
        average = row.get('averagekwh')
        # A suppressed/missing value is not zero. Do not fill it from other ZIPs.
        usable = (isinstance(average, (int, float)) and not isinstance(average, bool)
                  and math.isfinite(average) and average > 0)
        item['usable'] = usable
        if usable:
            days = calendar.monthrange(year, month)[1]
            item.update(days=days, dailyKwh=average / days, meanKw=average / (days * 24))
        records.append(item)
    records.sort(key=lambda r: (r['year'], r['month']), reverse=True)
    return {'source': 'SCE monthly ZIP-code aggregates via ORNL OpenEnergy Hub',
            'kind': 'zip-benchmark', 'zip': zip_code, 'fetchedAt': now(),
            'apiUrl': url, 'sourceUrl': 'https://openenergyhub.ornl.gov/explore/dataset/sce-energy-data/',
            'records': records,
            'latest': records[0] if records else None,
            'note': 'Historical SCE residential account averages; not individual household telemetry, hourly demand, feeder membership, or a utility shutoff forecast. Combined flag is retained from the source.'}


def get_sce(zip_code):
    if len(zip_code) != 5 or not zip_code.isascii() or not zip_code.isdigit():
        return 400, {'error': 'Enter a five-digit ZIP code.'}
    old = SCE_CACHE.get(zip_code)
    if old and time.monotonic() - old['saved'] < 21600:
        return 200, dict(old['data'], cached=True, stale=False)
    try:
        data = fetch_sce(zip_code)
        if len(SCE_CACHE) >= 100:
            SCE_CACHE.pop(next(iter(SCE_CACHE)))
        SCE_CACHE[zip_code] = {'saved': time.monotonic(), 'data': data}
        return 200, dict(data, cached=False, stale=False)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as exc:
        reason = 'SCE public-data request failed: ' + str(exc)[:160]
        if old:
            return 200, dict(old['data'], cached=True, stale=True, error=reason)
        return 502, {'error': reason, 'attemptedAt': now(), 'stale': True}


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if urlparse(self.path).path != '/api/households/import-csv':
            self.send_error(404)
            return
        origin=self.headers.get('Origin')
        allowed={f'http://localhost:{self.server.server_port}',f'http://127.0.0.1:{self.server.server_port}'}
        if origin and origin not in allowed:
            self.send_json(403,{'error':'Only the local PoweruP page may import a CSV.'})
            return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 25_000_000:
                raise ValueError('CSV must be between 1 byte and 25 MB.')
            text=self.rfile.read(length).decode('utf-8-sig')
            result=convert_households(text)
            folder=ROOT/'data'
            folder.mkdir(exist_ok=True)
            (folder/'opsd-six-households.json').write_text(json.dumps(result),encoding='utf-8')
            self.send_json(200,result)
        except (ValueError,OSError,UnicodeError) as exc:
            self.send_json(400,{'error':str(exc)[:220]})

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/api/version':
            self.send_json(200, {'version': 'PoweruP Geographic Fleet Command 7', 'householdLoader': True, 'sceApi': True, 'notificationDemo': True})
            return
        if url.path == '/api/geography':
            self.send_json(*geography.get(parse_qs(url.query).get('zips', [''])[0], https_context()))
            return
        if url.path == '/api/sce':
            self.send_json(*get_sce(parse_qs(url.query).get('zip', [''])[0]))
            return
        if url.path == '/api/households/cached':
            cached=ROOT/'data'/'opsd-six-households.json'
            if cached.exists():
                try:
                    self.send_json(200,json.loads(cached.read_text(encoding='utf-8')))
                except (ValueError,OSError):
                    self.send_json(500,{'error':'Cached household summary could not be read.'})
            else:
                self.send_json(404,{'error':'No measured household cache yet.'})
            return
        if url.path == '/api/households/public':
            try:
                self.send_json(200, load_public())
            except (OSError, ValueError, KeyError, RuntimeError, EOFError, json.JSONDecodeError) as exc:
                self.send_json(502, {'error': 'Measured-data download failed: '+str(exc)[:180]+'. No data was substituted. Check internet access or import a local profile.'})
            return
        if url.path == '/api/weather':
            try:
                lat, lon = coordinates(parse_qs(url.query))
            except ValueError as exc:
                self.send_json(400, {'error': str(exc)})
                return
            self.send_json(*get_weather(lat, lon))
            return
        # Serve only the app's public entrypoint and scheduler.
        if url.path not in ('/', '/index.html', '/engine.js', '/app.js', '/advanced.js', '/experience.js', '/sce.js', '/notifications.js', '/scene.js', '/visual.js', '/style.css'):
            self.send_error(404)
            return
        super().do_GET()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8004)
    parser.add_argument('--open', action='store_true', help='Open local dashboard in your default browser')
    args = parser.parse_args()
    handler = partial(Handler, directory=str(ROOT))
    print(f'PoweruP: http://localhost:{args.port}  (Ctrl+C to stop)', flush=True)
    if args.open:
        import threading, webbrowser
        threading.Timer(1.0, lambda: webbrowser.open(f'http://localhost:{args.port}')).start()
    try:
        ThreadingHTTPServer(('127.0.0.1', args.port), handler).serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
