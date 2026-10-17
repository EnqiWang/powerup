/* GitHub Pages adapter. Public APIs only; no Python service or credentials. */
(function(root){
'use strict';
const nativeFetch=root.fetch.bind(root);
const CENSUS='https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2';
const response=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const now=()=>new Date().toISOString();
async function publicJson(url,signal){
 const r=await nativeFetch(url,{signal,headers:{Accept:'application/geo+json, application/json'},credentials:'omit'});
 if(!r.ok)throw Error('Public data service returned HTTP '+r.status);
 const text=await r.text();if(text.length>8000000)throw Error('Public data response exceeded size limit.');
 const data=JSON.parse(text);if(data.error)throw Error('Public data service rejected the request.');return data;
}
function validZip(zip){if(!/^\d{5}$/.test(zip))throw Error('Enter a five-digit ZIP.');return zip;}
async function sce(zip,signal){
 validZip(zip);
 const q=new URLSearchParams({where:`zip_code='${zip}' AND customer_class='Residential'`,order_by:'year DESC, month DESC',limit:'100'});
 const url='https://openenergyhub.ornl.gov/api/explore/v2.1/catalog/datasets/sce-energy-data/records?'+q;
 const raw=await publicJson(url,signal);if(!Array.isArray(raw.results))throw Error('Unexpected SCE response.');
 const records=raw.results.filter(r=>String(r.zip_code)===zip&&r.customer_class==='Residential').map(r=>{
  const year=Number(r.year),month=Number(r.month),average=r.averagekwh;
  if(!Number.isInteger(year)||year<1900||year>2200||!Number.isInteger(month)||month<1||month>12)return null;
  const item={zip_code:zip,year,month,customer_class:'Residential',combined:r.combined,totalaccounts:r.totalaccounts,totalkwh:r.totalkwh,averagekwh:average,usable:typeof average==='number'&&Number.isFinite(average)&&average>0};
  if(item.usable){item.days=new Date(Date.UTC(year,month,0)).getUTCDate();item.dailyKwh=average/item.days;item.meanKw=average/(item.days*24);}return item;
 }).filter(Boolean).sort((a,b)=>b.year-a.year||b.month-a.month);
 return {kind:'zip-benchmark',zip,source:'SCE monthly ZIP aggregates via ORNL OpenEnergy Hub',fetchedAt:now(),apiUrl:url,records,latest:records[0]||null,cached:false,stale:false,note:'Historical ZIP averages, not individual household telemetry. Browser-direct public API request.'};
}
async function weather(lat,lon,signal){
 lat=Number(lat);lon=Number(lon);if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat>90||lon< -180||lon>180)throw Error('Invalid weather coordinates.');
 const points=await publicJson(`https://api.weather.gov/points/${lat},${lon}`,signal),p=points.properties;
 const u=new URL(p.forecastHourly);if(u.protocol!=='https:'||u.hostname!=='api.weather.gov')throw Error('Unexpected NWS forecast URL.');
 const alertsUrl=`https://api.weather.gov/alerts/active?point=${lat},${lon}`;
 const [forecast,alerts]=await Promise.all([publicJson(u.href,signal),publicJson(alertsUrl,signal)]);
 const periods=forecast.properties?.periods?.slice(0,24);if(!periods?.length||!Array.isArray(alerts.features))throw Error('Incomplete NWS response.');
 const location=p.relativeLocation?.properties||{};
 return {source:'National Weather Service',lat,lon,location:[location.city,location.state].filter(Boolean).join(', '),fetchedAt:now(),forecastUpdated:forecast.properties.updateTime||forecast.properties.updated||forecast.properties.generatedAt,forecastUrl:u.href,alertsUrl,periods,alerts:alerts.features.map(a=>a.properties),cached:false,stale:false};
}
function coordinatesValid(coords){
 if(!Array.isArray(coords)||!coords.length)return false;
 if(typeof coords[0]==='number')return coords.length>=2&&Number.isFinite(coords[0])&&Number.isFinite(coords[1])&&Math.abs(coords[0])<=180&&Math.abs(coords[1])<=90;
 return coords.every(coordinatesValid);
}
async function geography(text,signal){
 const zips=[...new Set(text.split(','))].sort();if(!zips.length||zips.length>12)throw Error('Choose up to twelve ZIPs.');zips.forEach(validZip);
 const q=new URLSearchParams({where:'ZCTA5 IN ('+zips.map(z=>"'"+z+"'").join(',')+')',outFields:'ZCTA5,NAME,INTPTLAT,INTPTLON',returnGeometry:'true',outSR:'4326',maxAllowableOffset:'0.0003',geometryPrecision:'5',f:'geojson'});
 const raw=await publicJson(CENSUS+'/query?'+q,signal);if(raw.type!=='FeatureCollection'||!Array.isArray(raw.features))throw Error('Unexpected Census response.');
 const features=raw.features.flatMap(f=>{
  const p=f.properties||{},zip=String(p.ZCTA5),lat=Number(p.INTPTLAT),lon=Number(p.INTPTLON),g=f.geometry;
  if(!zips.includes(zip)||p.INTPTLAT==null||p.INTPTLON==null||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||!['Polygon','MultiPolygon'].includes(g?.type)||!coordinatesValid(g.coordinates))return [];
  return [{type:'Feature',id:zip,properties:{zip,name:String(p.NAME||'ZCTA '+zip),lat,lon,geography:'2020 Census ZCTA'},geometry:g}];
 });
 return {type:'FeatureCollection',features,missing:zips.filter(z=>!features.some(f=>f.properties.zip===z)),source:'U.S. Census Bureau TIGERweb — 2020 Census ZCTAs',sourceUrl:CENSUS,fetchedAt:now(),cached:false,stale:false,note:'Census ZCTAs approximate ZIP areas; markers are not individual battery locations.'};
}
root.PowerupStatic={sce,weather,geography};
root.fetch=async function(input,init={}){
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
 try{
  if(url.pathname==='/api/sce')return response(200,await sce(url.searchParams.get('zip')||'',init.signal));
  if(url.pathname==='/api/weather')return response(200,await weather(url.searchParams.get('lat'),url.searchParams.get('lon'),init.signal));
  if(url.pathname==='/api/geography')return response(200,await geography(url.searchParams.get('zips')||'',init.signal));
  if(url.pathname==='/api/households/cached')return response(404,{error:'No local Python cache on GitHub Pages.'});
  if(url.pathname==='/api/version')return response(200,{version:'PoweruP GitHub Pages',static:true});
  if(url.pathname.startsWith('/api/households/'))return response(501,{error:'The raw OPSD loader requires the local Python version. Use SCE ZIP data, the saved SCE snapshot, or converted profile JSON here.'});
  return response(404,{error:'Unknown public-data route.'});
 }catch(error){return response(502,{error:'Public data unavailable: '+error.message+'. Check connectivity and cross-origin access. No records were substituted.'});}
};
})(globalThis);
