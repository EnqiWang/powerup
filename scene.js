/* Real geography: OpenFreeMap/OSM basemap + U.S. Census ZCTA boundaries. */
(function(root){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STYLE='https://tiles.openfreemap.org/styles/dark';
const MODULE='https://unpkg.com/maplibre-gl@6.14.0/dist/maplibre-gl.mjs';
let host=null,options=null,map=null,lib=null,ready=false,loading=null,markers=[],geo=null,geoKey='',requested='',lastFit='',lastSelected=null;
function zipOf(h){if(h.measurement?.kind!=='zip-benchmark')return null;return [h.measurement.zip,h.measurement.location,h.name].map(String).join(' ').match(/\b\d{5}\b/)?.[0]||null;}
function status(text){const el=document.getElementById('geoStatus');if(el)el.textContent=text;}
function mount(el){
 if(host===el&&document.getElementById('geoCanvas'))return;
 if(map){map.remove();map=null;ready=false;}
 host=el;
 el.innerHTML='<div id="geoCanvas" aria-label="Geographic map of Los Angeles with Census ZIP-area boundaries"></div><div class="geo-heading"><span>LOS ANGELES / GEOGRAPHIC VIEW</span><small>OSM basemap · Census ZCTA areas · modeled batteries</small></div><div class="geo-tools"><button id="geoFit" title="Show all loaded ZIP areas">Fit ZIPs</button><button id="geoTilt" title="Toggle map tilt">3D view</button><button id="geoRetry">Retry map</button></div><div id="geoStatus" class="geo-status" role="status">Loading real map…</div><div id="geoList" class="geo-list"></div>';
 document.getElementById('geoFit').onclick=()=>fit(true);
 document.getElementById('geoTilt').onclick=()=>{if(map){const tilt=map.getPitch()<=30;map.easeTo({pitch:tilt?48:0,zoom:tilt?Math.max(map.getZoom(),15.3):map.getZoom(),duration:900});}};
 document.getElementById('geoRetry').onclick=()=>{requested='';if(map){map.remove();map=null;ready=false;}loading=null;loadMap();loadGeography();};
}
function points(g){return g.features.map(f=>[f.properties.lon,f.properties.lat]);}
function fit(force=false){
 if(!map||!ready||!geo?.features.length)return;
 if(!force&&lastFit===geoKey)return;
 const coords=[];
 function walk(c){if(typeof c[0]==='number')coords.push(c);else c.forEach(walk);}
 geo.features.forEach(f=>walk(f.geometry.coordinates));
 if(!coords.length)return;
 const bounds=new lib.LngLatBounds(coords[0],coords[0]);coords.forEach(p=>bounds.extend(p));
 map.fitBounds(bounds,{padding:65,maxZoom:12,duration:force?750:0,pitch:20,bearing:0});lastFit=geoKey;
}
function select(h,fly=true){
 options.select(h.id);
 const f=geo?.features.find(f=>f.properties.zip===zipOf(h));
 if(f&&map&&fly)map.flyTo({center:[f.properties.lon,f.properties.lat],zoom:15.3,pitch:48,bearing:-15,duration:1100});
}
function rows(){
 const target=document.getElementById('geoList');if(!target)return;
 target.innerHTML=options.homes.map(h=>{const b=options.viewBudget(h),zip=zipOf(h);return `<button class="geo-chip ${h.id===options.selected?'active':''}" data-geohome="${h.id}"><b>${esc(zip?'ZIP '+zip:h.name)}</b><span>${h.online?(Number.isFinite(b.runtime)?b.runtime.toFixed(1)+'h':'—'):'Unknown'} modeled backup</span></button>`;}).join('')||'<button id="geoConnect" class="primary">Connect ZIP data ↗</button><button id="geoOffline">Use saved SCE usage</button>';
 target.querySelectorAll('[data-geohome]').forEach(el=>el.onclick=()=>select(options.homes.find(h=>h.id===+el.dataset.geohome)));
 const connect=document.getElementById('geoConnect');if(connect)connect.onclick=()=>root.PowerupVisual?.view('data');
 const offline=document.getElementById('geoOffline');if(offline)offline.onclick=()=>root.PowerupVisual?.offline();
}
function draw(){
 rows();if(!map||!ready)return;
 markers.forEach(m=>m.remove());markers=[];
 const byZip=new Map(options.homes.map(h=>[zipOf(h),h]));
 const data={type:'FeatureCollection',features:(geo?.features||[]).filter(f=>byZip.has(f.properties.zip)).map(f=>{const h=byZip.get(f.properties.zip),b=options.viewBudget(h);return {...f,properties:{...f.properties,selected:h.id===options.selected,color:!h.online?'#8092a1':b.targetMet?'#49dfba':'#4dbaf5'}};})};
 if(map.getSource('powerup-zctas'))map.getSource('powerup-zctas').setData(data);
 else{
  map.addSource('powerup-zctas',{type:'geojson',data});
  map.addLayer({id:'powerup-zcta-fill',type:'fill',source:'powerup-zctas',paint:{'fill-color':['get','color'],'fill-opacity':['case',['get','selected'],.24,.10]}});
  map.addLayer({id:'powerup-zcta-outline',type:'line',source:'powerup-zctas',paint:{'line-color':['get','color'],'line-width':['case',['get','selected'],3,1.5],'line-opacity':.85}});
  map.on('click','powerup-zcta-fill',e=>{const h=options.homes.find(h=>zipOf(h)===e.features?.[0]?.properties?.zip);if(h)select(h);});
  map.on('mouseenter','powerup-zcta-fill',()=>{map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','powerup-zcta-fill',()=>{map.getCanvas().style.cursor='';});
 }
 for(const f of data.features){
  const h=byZip.get(f.properties.zip),b=options.viewBudget(h),el=document.createElement('button');
  el.className='geo-marker'+(h.id===options.selected?' active':'');el.style.setProperty('--node-color',f.properties.color);
  el.setAttribute('aria-label','Select ZIP '+f.properties.zip+', Census representative point');
  el.innerHTML=`<i></i><b>${esc(f.properties.zip)}</b><span>${h.online?(Number.isFinite(b.runtime)?b.runtime.toFixed(1)+'h':'—'):'Unknown'}</span>`;
  el.onclick=e=>{e.stopPropagation();select(h);};
  markers.push(new lib.Marker({element:el,anchor:'bottom'}).setLngLat([f.properties.lon,f.properties.lat]).addTo(map));
 }
 fit();
}
async function loadMap(){
 if(map||loading)return loading;
 loading=(async()=>{
  let timer;
  try{
   lib=root.maplibregl||await Promise.race([import(MODULE),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Map library timed out. Check internet access.')),18000);})]);
   if(!host)return;
   map=new lib.Map({container:document.getElementById('geoCanvas'),style:STYLE,center:[-118.30,34.025],zoom:10.1,pitch:20,bearing:0,canvasContextAttributes:{antialias:true}});
   map.addControl(new lib.NavigationControl({visualizePitch:true}),'top-right');
   map.addControl(new lib.ScaleControl({maxWidth:90,unit:'imperial'}),'bottom-left');
   map.on('load',()=>{
    ready=true;
    try{
     const before=map.getStyle().layers.find(l=>l.type==='symbol'&&l.layout?.['text-field'])?.id;
     map.addSource('powerup-osm-buildings',{type:'vector',url:'https://tiles.openfreemap.org/planet'});
     map.addLayer({id:'powerup-3d-buildings',type:'fill-extrusion',source:'powerup-osm-buildings','source-layer':'building',minzoom:15,filter:['!=',['get','hide_3d'],true],paint:{'fill-extrusion-color':'#275966','fill-extrusion-height':['coalesce',['get','render_height'],0],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.8}},before);
    }catch(e){/* Geographic 2D map remains available if optional building layer fails. */}
    status(geo?'Census areas located. Click a ZIP to inspect its real location.':'Real LA map loaded. Load ZIP usage to highlight Census areas.');draw();
   });
   map.on('error',()=>status('Some map assets failed to load. Check internet access; no decorative map is substituted.'));
   if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>map?.resize()).observe(host);
  }catch(e){status('Map unavailable: '+e.message+' ZIP usage remains available below; no invented locations shown.');}
  finally{clearTimeout(timer);loading=null;}
 })();return loading;
}
async function loadGeography(){
 const zips=[...new Set(options.homes.map(zipOf).filter(Boolean))].sort(),key=zips.join(',');
 if(!key){geo=null;geoKey='';requested='';draw();return;}
 if(key===requested){draw();return;}
 requested=key;geo=null;geoKey=key;lastFit='';
 const saved=typeof source!=='undefined'?source?.geography:null;
 if(saved?.type==='FeatureCollection'&&saved.features?.length&&zips.every(z=>saved.features.some(f=>f.properties?.zip===z))){geo=saved;draw();status('Saved Census areas restored; street basemap still requires internet.');return;}
 status('Locating ZIP areas through U.S. Census TIGERweb…');draw();
 try{
  if(location.protocol==='file:')throw Error('Run start-windows.bat and open http://localhost:8004 for Census lookup.');
  const response=await fetch('/api/geography?zips='+encodeURIComponent(key),{signal:AbortSignal.timeout(35000)}),data=await response.json();
  if(!response.ok)throw Error(data.error||'Census unavailable');
  if(requested!==key)return;
  if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('Unexpected Census response.');
  geo=data;if(typeof source!=='undefined'&&source)source.geography=data;
  draw();status(`${data.features.length} Census ZIP areas located${data.stale?' · cached boundaries':''}. `+(data.missing?.length?'No ZCTA found for '+data.missing.join(', ')+'.':'Click a ZIP to zoom to its actual area.'));
 }catch(e){if(requested===key){status('ZIP locations unavailable: '+e.message+' No substitute coordinates used.');draw();}}
}
function render(el,next){options=next;mount(el);rows();loadMap();loadGeography();if(map)map.resize();}
function resize(){if(map)map.resize();}
root.PowerupScene={render,resize,zipOf};
})(globalThis);
