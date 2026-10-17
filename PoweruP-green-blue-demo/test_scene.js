const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const nodes={};function node(id){return nodes[id]??={innerHTML:'',textContent:'',style:{setProperty(){}},setAttribute(){},querySelectorAll:()=>[]};}
for(const id of ['geoCanvas','geoFit','geoTilt','geoRetry','geoStatus','geoList'])node(id);
let instance,positions=[],requestedUrl;
class MockMap{constructor(){instance=this;this.sources={};this.events={};}on(event,...args){const cb=args.at(-1);this.events[event]=cb;if(event==='load')setTimeout(cb,0);return this;}addControl(){}getStyle(){return{layers:[]}}addSource(id,s){this.sources[id]={...s,setData(d){this.data=d}}}getSource(id){return this.sources[id]}addLayer(){}fitBounds(b){this.bounds=b}resize(){}remove(){}getCanvas(){return{style:{}}}flyTo(o){this.fly=o}getPitch(){return 20}easeTo(){}}
class Marker{constructor(){}setLngLat(p){positions.push(p);return this}addTo(){return this}remove(){}}
class Bounds{constructor(a,b){this.coords=[a,b]}extend(c){this.coords.push(c);return this}}
const geo={type:'FeatureCollection',features:[{type:'Feature',properties:{zip:'90002',lat:33.95,lon:-118.25},geometry:{type:'Polygon',coordinates:[[[-118.26,33.94],[-118.24,33.94],[-118.24,33.96],[-118.26,33.94]]]}}],missing:[]};
const ctx={console,setTimeout,clearTimeout,AbortSignal,location:{protocol:'http:'},source:{},document:{getElementById:id=>nodes[id]||null,createElement:()=>node('marker')},maplibregl:{Map:MockMap,Marker,LngLatBounds:Bounds,NavigationControl:class{},ScaleControl:class{}},fetch:async url=>{requestedUrl=url;return {ok:true,json:async()=>geo}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/scene.js','utf8'),ctx);
const options={homes:[{id:1,name:'ZIP 90002',online:true,measurement:{kind:'zip-benchmark',location:'ZIP 90002'}}],selected:1,viewBudget:()=>({runtime:20,targetMet:false}),projectedEnergy:()=>11.76,select:()=>{}};
ctx.PowerupScene.render(node('map'),options);
setTimeout(()=>{try{
 assert(requestedUrl.includes('/api/geography?zips=90002'));
 assert(positions.some(p=>p[0]===-118.25&&p[1]===33.95));
 assert.equal(instance.getSource('powerup-zctas').data.features.length,1);
 assert.equal(instance.getSource('powerup-zctas').data.features[0].properties.zip,'90002');
 assert(ctx.source.geography);assert(!nodes.map.innerHTML.includes('city-scene'));
 assert.equal(ctx.PowerupScene.zipOf({name:'ZIP 90002',measurement:{kind:'other'}}),null);
 console.log('Geographic renderer passed: real-coordinate placement, Census polygons, saved geography, and no guessed household locations.');
}catch(e){console.error(e);process.exitCode=1}},30);
