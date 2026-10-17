import json
import threading
import unittest
import tempfile
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError
import server

class ServerTests(unittest.TestCase):
    def setUp(self):server.CACHE.clear()
    def test_routes_and_static_assets(self):
        httpd=ThreadingHTTPServer(('127.0.0.1',0),partial(server.Handler,directory=str(server.ROOT)))
        threading.Thread(target=httpd.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{httpd.server_port}'
        try:
            for path in ['/','/app.js','/engine.js','/advanced.js','/experience.js','/sce.js','/notifications.js','/style.css']:
                with urlopen(base+path) as response:self.assertEqual(response.status,200)
            with self.assertRaises(HTTPError):urlopen(base+'/server.py')
            with self.assertRaises(HTTPError) as error:urlopen(base+'/api/sce?zip=invalid')
            self.assertEqual(error.exception.code,400)
            with patch.object(server,'fetch_sce',return_value={'zip':'90002','records':[],'latest':None}):
                self.assertEqual(json.load(urlopen(base+'/api/sce?zip=90002'))['zip'],'90002')
            with patch.object(server,'load_public',return_value={'schema':'powerup.measured-loads.v1','homes':[]}):
                self.assertEqual(json.load(urlopen(base+'/api/households/public'))['schema'],'powerup.measured-loads.v1')
            with patch.object(server,'load_public',side_effect=URLError('unavailable')):
                with self.assertRaises(HTTPError) as error:urlopen(base+'/api/households/public')
                self.assertEqual(error.exception.code,502)
            from test_six import SixTests
            csv_body=SixTests().fixture().encode()
            with tempfile.TemporaryDirectory() as directory,patch.object(server,'ROOT',Path(directory)):
                request=Request(base+'/api/households/import-csv',data=csv_body,headers={'Content-Type':'text/csv'})
                self.assertEqual(len(json.load(urlopen(request))['homes']),6)
                self.assertTrue((Path(directory)/'data'/'opsd-six-households.json').exists())
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(base+'/api/households/import-csv',data=csv_body,headers={'Origin':'https://unrelated.example'}))
                self.assertEqual(error.exception.code,403)
            with self.assertRaises(HTTPError) as error:urlopen(base+'/api/weather?lat=nan')
            self.assertEqual(error.exception.code,400)
        finally:httpd.shutdown();httpd.server_close()
    def test_weather_failure_unknown(self):
        with patch.object(server,'fetch_weather',side_effect=URLError('blocked')):
            status,data=server.get_weather(34,-118);self.assertEqual(status,502);self.assertNotIn('alerts',data)
    def test_stale_keeps_time(self):
        original={'fetchedAt':'2026-01-01T00:00:00Z','periods':[],'alerts':[]}
        with patch.object(server,'fetch_weather',return_value=original):server.get_weather(34,-118)
        server.CACHE[(34,-118)]['saved']-=301
        with patch.object(server,'fetch_weather',side_effect=URLError('blocked')):
            status,data=server.get_weather(34,-118);self.assertTrue(data['stale']);self.assertEqual(data['fetchedAt'],original['fetchedAt'])
if __name__=='__main__':unittest.main()
