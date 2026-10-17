const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../sce-circuits');

test('replay has unique IDs, parsable local scripts and light default', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /data-theme="light"/);
  assert.doesNotMatch(html, /poster\.html|data-twist|twistBar/);
  assert.match(html, /planner\.html/);
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = attrs.match(/src="([^"?]+)/)?.[1];
    new vm.Script(src ? fs.readFileSync(path.join(root, src), 'utf8') : body);
  }
});

test('queries use the correct circuit fields and reject unlisted names', () => {
  const urls = api.queries('cuthbert');
  assert.match(new URL(urls.geometry).searchParams.get('where'), /circt_nam/);
  assert.match(new URL(urls.load).searchParams.get('outFields'), /min_load_mw/);
  assert.throws(() => api.queries("CUTHBERT' OR 1=1"));
});

test('load summary uses explicit MW values and zero-based SCE months', () => {
  const result = api.summarizeLoad([{ attributes: {year:2026,month:1,hour:0,min_load:157,max_load:176,min_load_mw:4.37,max_load_mw:4.87} }]);
  assert.equal(result.month, 2);
  assert.equal(result.minMw, 4.37);
  const missing = api.summarizeLoad([{attributes:{year:2026,month:0,hour:0,min_load:157}}]);
  assert.equal(missing.minMw, null);
});

test('shutoff duration uses timestamps and flags inconsistent duration fields', () => {
  const start = Date.UTC(2025,0,23);
  const [row] = api.summarizeShutoffs([{attributes:{deenergization_datetime:start,reenergization_datetime:start+29*3600000,minutes_deenergized:29}}]);
  assert.equal(row.hoursFromDates,29);
  assert.equal(row.durationMismatch,true);
  assert.equal(api.summarizeShutoffs([{attributes:{}}])[0].hoursFromDates,null);
});

test('pagination and partial errors never invent missing circuit records', async () => {
  let loadCalls = 0;
  const fetcher = async url => {
    if (url.includes('Distribution_circuits')) throw Error('offline');
    if (url.includes('ICA_Tables')) {
      loadCalls++;
      return {ok:true,json:async()=>({features:[{attributes:{year:2026,month:1,hour:loadCalls-1,min_load_mw:2,max_load_mw:3}}],exceededTransferLimit:loadCalls===1})};
    }
    return {ok:true,json:async()=>({features:[]})};
  };
  const result = await api.fetchCircuit('Cuthbert',{fetcher});
  assert.equal(loadCalls,2);
  assert.equal(result.load.hours,2);
  assert.equal(result.geometry,null);
  assert.equal(result.errors.geometry,'offline');
  assert.deepEqual(result.shutoffs,[]);
});

test('cancelled evidence requests reject', async () => {
  const controller = new AbortController(); controller.abort(Error('cancelled'));
  await assert.rejects(api.fetchCircuit('Cuthbert',{signal:controller.signal,fetcher:async()=>({ok:true,json:async()=>({features:[]})})}),/cancelled/);
});
