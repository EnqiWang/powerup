import io
import json
import unittest
from unittest.mock import patch
from urllib.error import URLError
import server


class Response(io.BytesIO):
    def geturl(self):
        return 'https://openenergyhub.ornl.gov/api/explore/v2.1/catalog/datasets/sce-energy-data/records'


class SceTests(unittest.TestCase):
    def setUp(self):
        server.SCE_CACHE.clear()

    def test_month_length_and_suppression(self):
        payload = {'results': [
            {'zip_code': '90002', 'customer_class': 'Residential', 'year': 2024, 'month': 2,
             'averagekwh': 290, 'totalaccounts': 100, 'totalkwh': 29000, 'combined': 'N'},
            {'zip_code': '90002', 'customer_class': 'Residential', 'year': 2024, 'month': 3,
             'averagekwh': None, 'totalaccounts': None},
            {'zip_code': '90002', 'customer_class': 'Commercial', 'year': 2024, 'month': 4,
             'averagekwh': 99999}]}
        with patch.object(server, 'urlopen', return_value=Response(json.dumps(payload).encode())) as call:
            data = server.fetch_sce('90002')
        self.assertEqual(len(data['records']), 2)
        self.assertFalse(data['latest']['usable'])
        self.assertNotIn('meanKw', data['latest'])
        self.assertEqual(data['records'][1]['dailyKwh'], 10)
        self.assertAlmostEqual(data['records'][1]['meanKw'], 10/24)
        self.assertIn('zip_code%3D%2790002%27', call.call_args.args[0].full_url)

    def test_validation_caching_and_failure(self):
        for invalid in ['', '90002 OR 1=1', '９０００２', '9000']:
            self.assertEqual(server.get_sce(invalid)[0], 400)
        with patch.object(server, 'fetch_sce', side_effect=URLError('offline')):
            code, data = server.get_sce('90002')
            self.assertEqual(code, 502)
            self.assertNotIn('records', data)
        fixture = {'fetchedAt': '2024-01-01', 'records': [], 'latest': None}
        with patch.object(server, 'fetch_sce', return_value=fixture) as call:
            server.get_sce('90002'); server.get_sce('90002')
            self.assertEqual(call.call_count, 1)
        server.SCE_CACHE['90002']['saved'] -= 21601
        with patch.object(server, 'fetch_sce', side_effect=URLError('offline')):
            code, data = server.get_sce('90002')
            self.assertEqual(code, 200)
            self.assertTrue(data['stale'])
            self.assertEqual(data['fetchedAt'], '2024-01-01')


if __name__ == '__main__':
    unittest.main()
