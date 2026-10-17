"""Load six distinct residential grid-import profiles from OPSD.
Measurements are historical German data, not LA; battery/essential inputs assumed.
"""
import csv
import io
import json
import math
import ssl
from pathlib import Path
from datetime import datetime, timezone
from urllib.request import Request,urlopen

URL='https://data.open-power-system-data.org/household_data/2020-04-15/household_data_60min_singleindex.csv'
SOURCE='Open Power System Data (2020), Data Package Household Data, version 2020-04-15. Primary source CoSSMic. Creative Commons Attribution-International. https://data.open-power-system-data.org/household_data/2020-04-15/'


def context():
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except ImportError:
        return ssl.create_default_context()


def convert(text):
    reader=csv.DictReader(io.StringIO(text))
    keys=[f'DE_KN_residential{i}_grid_import' for i in range(1,7)]
    if not all(k in (reader.fieldnames or []) for k in keys):
        raise ValueError('Expected OPSD 2020-04-15 60-minute singleindex CSV with six residential grid-import columns.')
    records={k:{'prev':None,'energy':0.,'hours':0.,'count':0,'skipped':0,'first':None,'last':None} for k in keys}
    for row in reader:
        try:stamp=datetime.fromisoformat(row['utc_timestamp'].replace('Z','+00:00'))
        except (ValueError,KeyError):continue
        marked=(row.get('interpolated') or '').lower()
        for key in keys:
            rec=records[key]
            try:
                value=float(row[key])
                if not math.isfinite(value) or value<0:raise ValueError()
                interpolated=key.lower() in marked
            except (ValueError,KeyError,TypeError):
                rec['prev']=None;rec['skipped']+=1;continue
            prev=rec['prev'];rec['prev']=(stamp,value,interpolated)
            if prev is None:continue
            dt=(stamp-prev[0]).total_seconds()/3600
            delta=value-prev[1]
            # Cumulative kWh -> energy increment over a consecutive hourly interval.
            # Skip counter resets, missing periods and publisher-marked interpolations.
            if abs(dt-1)>1e-6 or delta<0 or interpolated or prev[2]:
                rec['skipped']+=1;continue
            rec['energy']+=delta;rec['hours']+=dt;rec['count']+=1
            rec['first']=rec['first'] or prev[0].isoformat();rec['last']=stamp.isoformat()
    homes=[]
    for i,key in enumerate(keys,1):
        rec=records[key]
        if rec['hours']<24 or rec['energy']<=0:raise ValueError(f'{key}: fewer than 24 valid positive-energy hourly observations. No household invented.')
        mean=rec['energy']/rec['hours']
        homes.append({'id':i,'name':key.removesuffix('_grid_import'),'meanKw':mean,'load':mean*.3,
            'capacity':39.2,'energy':11.76,'rate':3,'priority':1,'online':True,'flex':'No flexibility confirmed',
            'need':'Assumed essential share of historical grid-import proxy',
            'measurement':{'source':SOURCE,'location':'Southern Germany (not LA)','metric':'Measured grid import, not total household load; excludes self-consumed solar',
                'first':rec['first'],'last':rec['last'],'intervalCount':rec['count'],'observedHours':rec['hours'],'totalKwh':rec['energy'],'skippedIntervals':rec['skipped']},
            'assumptions':{'essentialFraction':.3,'batteryCapacityKwh':39.2,'batteryEnergyKwh':11.76,
                'note':'Base-sized hypothetical battery. Starting charge, essential share, priority and connectivity are not measured. Grid import is a proxy and can understate essential demand.'}})
    return {'schema':'powerup.measured-loads.v1','source':SOURCE,'location':'Southern Germany; historical measurements, NOT LA',
        'method':'Six distinct residential IDs. Differences of cumulative hourly grid-import kWh divided by valid observed hours; missing/reset/marked-interpolated intervals excluded. Grid import is not total home demand. Essential share remains an assumption.',
        'homes':homes,'retrievedAt':datetime.now(timezone.utc).isoformat()}


def load():
    folder=Path(__file__).resolve().parent/'data'
    folder.mkdir(exist_ok=True)
    cache=folder/'opsd-six-households.json'
    if cache.exists():return json.loads(cache.read_text(encoding='utf-8'))
    local=folder/'household_data_60min_singleindex.csv'
    if local.exists():
        if local.stat().st_size>25_000_000:raise ValueError('CSV exceeds expected size.')
        text=local.read_text(encoding='utf-8-sig')
    else:
        with urlopen(Request(URL,headers={'User-Agent':'PoweruP/1.0'}),timeout=60,context=context()) as response:
            raw=response.read(25_000_001)
        if len(raw)>25_000_000:raise ValueError('Dataset exceeds expected size.')
        text=raw.decode('utf-8-sig')
    result=convert(text)
    cache.write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv',nargs='?',help='Optional locally downloaded official CSV')
    args=parser.parse_args()
    if args.csv:
        result=convert(Path(args.csv).read_text(encoding='utf-8-sig'))
    else:result=load()
    Path('six-measured-households.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print('Saved six-measured-households.json with 6 distinct measured residential profiles. Import it in PoweruP.')
