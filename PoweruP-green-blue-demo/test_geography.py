import json
import io
import unittest
from unittest.mock import patch
import geography


def fixture():
    return {'type': 'FeatureCollection', 'features': [{'type': 'Feature',
        'properties': {'ZCTA5': '90002', 'NAME': 'ZCTA5 90002', 'INTPTLAT': '33.95', 'INTPTLON': '-118.25'},
        'geometry': {'type': 'Polygon', 'coordinates': [[[-118.26,33.94],[-118.24,33.94],[-118.24,33.96],[-118.26,33.94]]]}}]}


class Response(io.BytesIO):
    def geturl(self): return geography.CENSUS_LAYER+'/query'


class GeoTests(unittest.TestCase):
    def setUp(self): geography.CACHE.clear()
    def test_valid_geometry_and_missing(self):
        d=geography.validate_geojson(fixture(),['90002','90008'])
        self.assertEqual(d['features'][0]['properties']['zip'],'90002')
        self.assertEqual(d['features'][0]['properties']['lon'],-118.25)
        self.assertEqual(d['missing'],['90008'])
    def test_no_invented_coordinates(self):
        f=fixture();del f['features'][0]['properties']['INTPTLAT']
        self.assertEqual(geography.validate_geojson(f,['90002'])['features'],[])
        f=fixture();f['features'][0]['geometry']['coordinates'][0][0]=[1000000,1000000]
        with self.assertRaises(ValueError): geography.validate_geojson(f,['90002'])
    def test_query_and_cache(self):
        with patch.object(geography,'urlopen',return_value=Response(json.dumps(fixture()).encode())) as call:
            code,d=geography.get('90002',None)
            self.assertEqual(code,200)
            self.assertIn('outSR=4326',call.call_args.args[0].full_url)
            self.assertIn('f=geojson',call.call_args.args[0].full_url)
            self.assertEqual(geography.get('90002',None)[0],200)
            self.assertEqual(call.call_count,1)
        geography.CACHE['90002']['saved']-=86401
        with patch.object(geography,'fetch',side_effect=OSError('offline')):
            self.assertTrue(geography.get('90002',None)[1]['stale'])
            self.assertEqual(geography.get('90008',None)[0],502)
    def test_invalid_queries(self):
        for text in ['','90002 OR 1=1','９０００２','9000']:
            self.assertEqual(geography.get(text,None)[0],400)

if __name__=='__main__':unittest.main()
