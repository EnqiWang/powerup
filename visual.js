/* Layout controls only. All planning and data provenance stay in their existing modules. */
(function(root){
'use strict';
function view(name){
 document.querySelectorAll('[data-app-view]').forEach(el=>el.hidden=el.dataset.appView!==name);
 document.querySelectorAll('.rail-button').forEach(el=>el.classList.toggle('active',el.dataset.view===name));
 if(name==='operations'&&root.PowerupScene)setTimeout(()=>root.PowerupScene.resize(),20);
 document.querySelector('.pagehead .eyebrow').textContent={operations:'OPERATIONS / LOS ANGELES',data:'EVIDENCE / LOS ANGELES',residents:'OUTREACH / LOS ANGELES'}[name];
}
function sync(){
 const known=homes.filter(h=>h.online),energy=known.reduce((n,h)=>n+projectedEnergy(h),0),capacity=known.reduce((n,h)=>n+h.capacity,0),fraction=capacity?Math.max(0,Math.min(1,energy/capacity)):0;
 $('visualGauge').innerHTML=`<svg viewBox="0 0 140 94" aria-hidden="true"><path d="M20 76A50 50 0 0 1 100 16" fill="none" stroke="#253b4d" stroke-width="6" stroke-linecap="round"/><path d="M20 76A50 50 0 0 1 100 16" fill="none" stroke="#50dfbb" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="${fraction*100} 100"/><text x="70" y="59" fill="#c5f5e9" font-size="25" text-anchor="middle" font-family="Segoe UI,Arial">${capacity?Math.round(fraction*100)+'%':'—'}</text><text x="70" y="77" fill="#678d9f" font-size="6.5" text-anchor="middle" font-family="Consolas,monospace">MODELED RESERVE</text></svg><div><b>${known.length} online in model</b><span>${homes.length-known.length} unknown · battery state assumed</span></div>`;
}
function offline(){
 // Historical records copied from the user's successful ORNL/SCE API output.
 // These are real ZIP aggregates, not six measured household traces.
 const records=[['90002',3255,1225332,376.446082949309],['90008',674,318086,471.937685459941],['90022',16599,4656899,280.552985119586],['90040',3291,1046865,318.09936189608],['90045',444,101423,228.43018018018],['90046',11434,2481229,217.004460381319]];
 sceSnapshots=records.map(([zip,totalaccounts,totalkwh,averagekwh])=>({kind:'zip-benchmark',zip,source:'SCE monthly ZIP aggregates via ORNL OpenEnergy Hub',fetchedAt:'2026-10-17T04:56:08Z',cached:true,stale:true,apiUrl:'https://openenergyhub.ornl.gov/api/explore/v2.1/catalog/datasets/sce-energy-data/records?limit=20',captureNote:'Historical snapshot transcribed from user-provided successful API response, October 16, 2026; not refreshed by this demo action.',records:[],latest:{zip_code:zip,customer_class:'Residential',combined:'N',year:2024,month:6,totalaccounts,totalkwh,averagekwh,days:30,dailyKwh:averagekwh/30,meanKw:averagekwh/720,usable:true}}));
 $('applySce').onclick();$('sceStatus').textContent='Offline June 2024 SCE snapshot from your supplied API output. No live request made; refresh API for current portal availability.';
 $('dataBadge').textContent='SAVED SCE AGGREGATES / SCENARIO BATTERIES';view('operations');
}
root.PowerupVisual={view,offline,sync};
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
 $('jumpNotify').onclick=()=>view('residents');
 $('offlineData').onclick=offline;
 const oldLoad=$('loadSce').onclick;
 $('loadSce').onclick=async()=>{await oldLoad();if(source?.kind==='zip-benchmark'&&homes.length)view('operations');};
 const oldGuide=$('guided').onclick;
 $('guided').onclick=()=>{if(!source||homes.length<2){view('data');$('sceStatus').textContent='Load ZIP records first, then start the guided demo.';return;}view('operations');oldGuide();};
 view('operations');sync();
})(globalThis);
