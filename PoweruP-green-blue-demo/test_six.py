import csv
import io
import unittest
from datetime import datetime,timedelta,timezone
from load_six_households import convert

class SixTests(unittest.TestCase):
    def fixture(self):
        text=io.StringIO();keys=[f'DE_KN_residential{i}_grid_import' for i in range(1,7)];writer=csv.writer(text);writer.writerow(['utc_timestamp','interpolated']+keys)
        for hour in range(26):writer.writerow([(datetime(2020,1,1,tzinfo=timezone.utc)+timedelta(hours=hour)).isoformat(),'']+[hour*i for i in range(1,7)])
        return text.getvalue()
    def test_six_distinct_cumulative_units(self):
        result=convert(self.fixture());self.assertEqual(len(result['homes']),6)
        for i,h in enumerate(result['homes'],1):
            self.assertEqual(h['meanKw'],i);self.assertEqual(h['measurement']['intervalCount'],25)
            self.assertEqual(h['measurement']['totalKwh'],25*i)
        self.assertEqual(len(set(h['name'] for h in result['homes'])),6)
    def test_wrong_dataset(self):
        with self.assertRaises(ValueError):convert('Date;Time\n17/12/2006;00:00\n')
    def test_missing_home_not_fabricated(self):
        data=self.fixture().replace('DE_KN_residential6_grid_import','wrong')
        with self.assertRaises(ValueError):convert(data)
if __name__=='__main__':unittest.main()
