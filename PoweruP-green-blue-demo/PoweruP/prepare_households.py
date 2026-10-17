"""Convert measured interval readings to PoweruP profiles. No third-party packages.
Input CSV: household_id,timestamp,kwh,interval_minutes
Supports Low Carbon London CSV columns LCLid,DateTime,KWH/hh (per half hour).
Battery settings and essential fraction are scenario assumptions, not measurements.
"""
import argparse
import csv
import json
import math
from pathlib import Path
from datetime import datetime


def prepare(path, source, location, limit=6, essential_fraction=.3):
    grouped = {}
    skipped = 0
    with open(path, newline='', encoding='utf-8-sig') as file:
        reader = csv.DictReader(file)
        fields = [str(x).strip() for x in (reader.fieldnames or [])]
        reader.fieldnames = fields
        london = 'LCLid' in fields
        if london:
            energy_key = next((x for x in fields if x.lower().startswith('kwh')), None)
            if not energy_key or 'DateTime' not in fields:
                raise ValueError('London CSV requires LCLid, DateTime and KWH/hh columns.')
        elif not {'household_id', 'timestamp', 'kwh', 'interval_minutes'}.issubset(fields):
            raise ValueError('Expected household_id,timestamp,kwh,interval_minutes headers.')
        for row in reader:
            home = (row.get('LCLid') if london else row.get('household_id') or '').strip()
            if not home:
                skipped += 1
                continue
            if home not in grouped and len(grouped) >= limit:
                continue
            try:
                energy = float(row[energy_key] if london else row['kwh'])
                minutes = 30.0 if london else float(row['interval_minutes'])
                stamp = (row['DateTime'] if london else row['timestamp']).strip()
                dt = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
                # Negative net-meter values cannot be interpreted as consumption.
                if not math.isfinite(energy) or not math.isfinite(minutes) or energy < 0 or minutes <= 0 or minutes > 1440:
                    raise ValueError()
            except (ValueError, KeyError, TypeError):
                skipped += 1
                continue
            entry = grouped.setdefault(home, {'energy': 0.0, 'hours': 0.0, 'count': 0, 'first': stamp, 'last': stamp, 'seen': set()})
            if stamp in entry['seen']:
                skipped += 1
                continue
            entry['seen'].add(stamp)
            entry['energy'] += energy
            entry['hours'] += minutes / 60
            entry['count'] += 1
            # ISO strings in a single source use the same timezone format.
            entry['first'] = min(entry['first'], stamp)
            entry['last'] = max(entry['last'], stamp)
    homes = []
    for i, (name, item) in enumerate(grouped.items(), 1):
        mean = item['energy'] / item['hours']
        if mean <= 0:
            continue
        homes.append({'id': i, 'name': name[:70], 'meanKw': mean, 'load': mean * essential_fraction,
                      'capacity': 12, 'energy': 6, 'rate': 3, 'priority': 1, 'online': True,
                      'flex': 'No flexibility confirmed', 'need': 'Estimated essential share of measured demand',
                      'measurement': {'source': source, 'location': location, 'first': item['first'], 'last': item['last'],
                                      'intervalCount': item['count'], 'observedHours': item['hours'], 'totalKwh': item['energy']},
                      'assumptions': {'essentialFraction': essential_fraction, 'batteryCapacityKwh': 12, 'batteryEnergyKwh': 6,
                                      'note': 'Battery state, priority, essential share and connectivity are scenario inputs, not measured facts.'}})
    if not homes:
        raise ValueError('No positive valid household consumption profiles found.')
    return {'schema': 'powerup.measured-loads.v1', 'source': source, 'location': location, 'skippedRows': skipped,
            'method': 'Mean kW = total measured kWh / valid observed interval-hours. Essential demand is a user-assumed fraction. Historical averages are not outage forecasts.',
            'homes': homes}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv')
    parser.add_argument('--source', required=True, help='Actual dataset name / utility and URL if public')
    parser.add_argument('--location', required=True, help='Actual measurement geography, not the demo target location')
    parser.add_argument('--homes', type=int, default=6)
    parser.add_argument('--essential-fraction', type=float, default=.3)
    parser.add_argument('--output', default='measured-households.json')
    args = parser.parse_args()
    if not 1 <= args.homes <= 30 or not 0 < args.essential_fraction <= 1:
        parser.error('--homes must be 1–30; --essential-fraction must be >0 and <=1')
    try:
        output = prepare(args.csv, args.source, args.location, args.homes, args.essential_fraction)
        Path(args.output).write_text(json.dumps(output, indent=2), encoding='utf-8')
        print(f'Wrote {len(output["homes"])} measured profiles to {args.output}. Battery inputs remain simulated.')
    except (ValueError, OSError) as exc:
        parser.exit(1, str(exc)+'\n')
