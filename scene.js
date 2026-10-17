/* Real geography: OpenFreeMap/OSM basemap + U.S. Census ZCTA boundaries. */
(function(root){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let theme=(typeof document.documentElement!=='undefined'&&document.documentElement.dataset.theme)||'dark';
function styleUrl(){return 'https://tiles.openfreemap.org/styles/'+(theme==='light'?'positron':'dark');}
let handlersBound=false;
const MODULE='https://unpkg.com/maplibre-gl@6.14.0/dist/maplibre-gl.mjs';
let host=null,options=null,map=null,lib=null,ready=false,loading=null,markers=[],geo=null,geoKey='',requested='',lastFit='',lastSelected=null,
 fallbackReason=root.POWERUP_DEMO?'Demo mode: street basemap is optional.':null;
function zipOf(h){if(h.measurement?.kind!=='zip-benchmark')return null;return [h.measurement.zip,h.measurement.location,h.name].map(String).join(' ').match(/\b\d{5}\b/)?.[0]||null;}
function status(text){const el=document.getElementById('geoStatus');if(el)el.textContent=text;}
function mount(el){
 if(host===el&&document.getElementById('geoCanvas'))return;
 if(map){map.remove();map=null;ready=false;handlersBound=false;}
 host=el;
 el.innerHTML='<div id="geoCanvas" aria-label="Geographic map of Los Angeles with Census ZIP-area boundaries"></div><div class="geo-heading"><span>LOS ANGELES / ZIP CODE MAP</span><small>Street map · Census ZIP areas · demo homes</small></div><div class="geo-tools"><button id="geoFit" title="Show all loaded ZIP areas">Fit ZIPs</button><button id="geoTilt" title="Toggle map tilt">3D view</button><button id="geoRetry">Retry map</button></div><div id="geoStatus" class="geo-status" role="status">Loading real map…</div><div id="geoList" class="geo-list"></div>';
 document.getElementById('geoCanvas').insertAdjacentHTML('afterend','<div id="geoFallback" class="geo-fallback" hidden></div>');
 document.getElementById('geoFit').onclick=()=>fit(true);
 document.getElementById('geoTilt').onclick=()=>{if(map){const tilt=map.getPitch()<=30;map.easeTo({pitch:tilt?48:0,zoom:tilt?Math.max(map.getZoom(),15.3):map.getZoom(),duration:900});}};
 document.getElementById('geoRetry').onclick=()=>{requested='';if(map){map.remove();map=null;ready=false;handlersBound=false;}loading=null;loadMap();loadGeography();};
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
 target.innerHTML=options.homes.map(h=>{const b=options.viewBudget(h),zip=zipOf(h);return `<button class="geo-chip ${h.id===options.selected?'active':''}" data-geohome="${h.id}"><b>${esc(zip?'ZIP '+zip:h.name)}</b><span>${h.online?(Number.isFinite(b.runtime)?b.runtime.toFixed(1)+'h':'—'):'Unknown'} estimated backup</span></button>`;}).join('')||'<button id="geoConnect" class="primary">Load electricity data ↗</button><button id="geoOffline">Use saved electricity data</button>';
 target.querySelectorAll('[data-geohome]').forEach(el=>el.onclick=()=>select(options.homes.find(h=>h.id===+el.dataset.geohome)));
 const connect=document.getElementById('geoConnect');if(connect)connect.onclick=()=>root.PowerupVisual?.view('data');
 const offline=document.getElementById('geoOffline');if(offline)offline.onclick=()=>root.PowerupVisual?.offline();
}
// Draw the bundled Census shapes without importing MapLibre or requesting map tiles.
function fallback(){
 const el=document.getElementById('geoFallback');if(!el)return;
 if(ready||!fallbackReason){el.hidden=true;return;}
 const byZip=new Map(options.homes.map(h=>[zipOf(h),h])),feats=(geo?.features||[]).filter(f=>byZip.has(f.properties.zip));
 const note=`<div class="geo-fallback-note">OFFLINE MAP &middot; Census ZIP areas without street details &middot; ${esc(fallbackReason)}</div>`;
 el.hidden=false;
 if(!feats.length){el.innerHTML=note;return;}
 const rings=g=>g.type==='Polygon'?g.coordinates:g.coordinates.flat(),pts=feats.flatMap(f=>rings(f.geometry).flat());
 const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),x0=Math.min(...xs),y1=Math.max(...ys),k=Math.cos((((Math.min(...ys)+y1)/2)*Math.PI)/180),w=(Math.max(...xs)-x0)*k,hgt=y1-Math.min(...ys),s=Math.min(560/w,360/hgt);
 const px=p=>(20+(p[0]-x0)*k*s).toFixed(1)+','+(20+(y1-p[1])*s).toFixed(1);
 const shapes=feats.map(f=>{const h=byZip.get(f.properties.zip),b=options.viewBudget(h),cls=!h.online?'unknown':b.targetMet?'ok':'short',d=rings(f.geometry).map(r=>'M'+r.map(px).join('L')+'Z').join(''),[lx,ly]=px([f.properties.lon,f.properties.lat]).split(',');return `<g class="zcta ${cls} ${h.id===options.selected?'active':''}" data-geohome="${h.id}"><path d="${d}"/><text x="${lx}" y="${ly}">${esc(f.properties.zip)}</text></g>`;}).join('');
 el.innerHTML=`<svg viewBox="0 0 600 400" role="img" aria-label="Offline outline map of loaded ZIP areas">${shapes}</svg>${note}`;
 el.querySelectorAll('[data-geohome]').forEach(g=>g.onclick=()=>select(options.homes.find(h=>h.id===+g.dataset.geohome),false));
}
function draw(){
 rows();fallback();if(!map||!ready)return;
 markers.forEach(m=>m.remove());markers=[];
 const byZip=new Map(options.homes.map(h=>[zipOf(h),h]));
 const data={type:'FeatureCollection',features:(geo?.features||[]).filter(f=>byZip.has(f.properties.zip)).map(f=>{const h=byZip.get(f.properties.zip),b=options.viewBudget(h);return {...f,properties:{...f.properties,selected:h.id===options.selected,color:!h.online?'#8092a1':b.targetMet?(theme==='light'?'#087e65':'#49dfba'):(theme==='light'?'#945b0e':'#f4c178')}};})};
 if(map.getSource('powerup-zctas'))map.getSource('powerup-zctas').setData(data);
 else{
  map.addSource('powerup-zctas',{type:'geojson',data});
  map.addLayer({id:'powerup-zcta-fill',type:'fill',source:'powerup-zctas',paint:{'fill-color':['get','color'],'fill-opacity':['case',['get','selected'],.24,.10]}});
  map.addLayer({id:'powerup-zcta-outline',type:'line',source:'powerup-zctas',paint:{'line-color':['get','color'],'line-width':['case',['get','selected'],3,1.5],'line-opacity':.85}});
  if(!handlersBound){handlersBound=true;map.on('click','powerup-zcta-fill',e=>{const h=options.homes.find(h=>zipOf(h)===e.features?.[0]?.properties?.zip);if(h)select(h);});
  map.on('mouseenter','powerup-zcta-fill',()=>{map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','powerup-zcta-fill',()=>{map.getCanvas().style.cursor='';});}
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
 if(new URLSearchParams(root.location?.search).get('map')==='0'){
  fallbackReason='Basemap disabled (map=0).';
  status('Street basemap disabled for offline demo; Census outlines shown.');
  fallback();
  return;
 }
 loading=(async()=>{
  let timer;
  try{
   lib=root.maplibregl||await Promise.race([import(MODULE),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Map library timed out. Check internet access.')),18000);})]);
   if(!host)return;
   map=new lib.Map({container:document.getElementById('geoCanvas'),style:styleUrl(),center:[-118.30,34.025],zoom:10.1,pitch:20,bearing:0,canvasContextAttributes:{antialias:true}});
   map.addControl(new lib.NavigationControl({visualizePitch:true}),'top-right');
   map.addControl(new lib.ScaleControl({maxWidth:90,unit:'imperial'}),'bottom-left');
   const restoreStyle=()=>{
     ready=true;fallbackReason=null;fallback();
    try{
     const before=map.getStyle().layers.find(l=>l.type==='symbol'&&l.layout?.['text-field'])?.id;
     if(!map.getSource('powerup-osm-buildings'))map.addSource('powerup-osm-buildings',{type:'vector',url:'https://tiles.openfreemap.org/planet'});
     if(!map.getLayer?.('powerup-3d-buildings'))map.addLayer({id:'powerup-3d-buildings',type:'fill-extrusion',source:'powerup-osm-buildings','source-layer':'building',minzoom:15,filter:['!=',['get','hide_3d'],true],paint:{'fill-extrusion-color':theme==='light'?'#a8c4ce':'#275966','fill-extrusion-height':['coalesce',['get','render_height'],0],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.8}},before);
    }catch(e){/* Geographic 2D map remains available if optional building layer fails. */}
    status(geo?'ZIP areas loaded. Select one to see its example home.':'Map ready. Load electricity data to show ZIP areas.');draw();
   };
   map.on('load',restoreStyle);map.on('style.load',restoreStyle);
   map.on('error',()=>{status('Some map assets failed to load. Showing the Census outline fallback.');if(!ready){fallbackReason='Map tiles failed to load.';fallback();}});
   if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>map?.resize()).observe(host);
  }catch(e){fallbackReason='Map unavailable: '+e.message;fallback();status('Map unavailable: '+e.message+' Census outline fallback shown; no invented locations.');}
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
function setTheme(name){const next=name==='light'?'light':'dark';if(next===theme)return;theme=next;if(map){ready=false;map.setStyle(styleUrl());}fallback();}
root.PowerupScene={render,resize,zipOf,setTheme};
})(globalThis);
