import csv
import tempfile
import unittest
from pathlib import Path
from prepare_households import prepare

class ImportTests(unittest.TestCase):
    def run_csv(self, text):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'input.csv';p.write_text(text)
            return prepare(p,'TEST FIXTURE ONLY','Test location')
    def test_energy_units(self):
        r=self.run_csv('household_id,timestamp,kwh,interval_minutes\nH1,2025-01-01T00:00:00,0.5,30\nH1,2025-01-01T00:30:00,1.0,30\n')
        self.assertEqual(r['homes'][0]['meanKw'],1.5)
        self.assertAlmostEqual(r['homes'][0]['load'],.45)
        self.assertEqual(r['homes'][0]['measurement']['intervalCount'],2)
    def test_london_format(self):
        r=self.run_csv('LCLid,stdorToU,DateTime,KWH/hh (per half hour)\nMAC000002,Std,2013-01-01 00:00:00.000,0.2\n')
        self.assertEqual(r['homes'][0]['name'],'MAC000002')
        self.assertEqual(r['homes'][0]['meanKw'],.4)
    def test_missing_duplicate_negative(self):
        r=self.run_csv('household_id,timestamp,kwh,interval_minutes\nH1,2025-01-01T00:00:00,0.5,30\nH1,2025-01-01T00:00:00,0.5,30\nH1,2025-01-01T00:30:00,-1,30\nH1,2025-01-01T01:00:00,Null,30\n')
        self.assertEqual(r['skippedRows'],3)
        self.assertEqual(r['homes'][0]['measurement']['intervalCount'],1)
    def test_empty_rejected(self):
        with self.assertRaises(ValueError):self.run_csv('a,b\n1,2\n')
if __name__=='__main__':unittest.main()
