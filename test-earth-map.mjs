/* DOM-free Earth globe UI: map click, place search and georeferenced pins. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./earth-map.mjs',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export class EarthMap','class EarthMap');
const events={};let latestMap=null,lookupCalls=0,opened=[];
class Map{
 constructor(options){this.options=options;latestMap=this;this.markers=[];this.sources=[];this.layers=[];this.projection={type:'mercator'}}
 on(event,cb){events[event]=cb}
 addControl(){}
 getStyle(){return {layers:[{id:'roads',type:'line'},{id:'labels',type:'symbol'}]}}
 getSource(id){return this.sources.find(([key])=>key===id)?.[1]}
 addLayer(layer,before){this.layers.push([layer,before])}
 setProjection(projection){this.projection=projection}
 addSource(id,source){this.sources.push([id,source])}
 setTerrain(value){this.terrain=value}
 resize(){}
 flyTo(options){this.fly=options}
}
class Marker{
 constructor({element}){this.element=element}
 setLngLat(coordinates){this.coordinates=coordinates;return this}
 addTo(map){map.markers.push(this);return this}
 remove(){this.removed=true}
}
const maplibregl={Map,Marker,NavigationControl:class{},TerrainControl:class{}};
const elements={};
const document={createElement(tag){return {tagName:tag,listeners:{},addEventListener(type,cb){this.listeners[type]=cb}}},getElementById(id){return elements[id]||(elements[id]={textContent:''})}};
const context={maplibregl,document,console,URLSearchParams,Date,Number,Math,
 fetch:async()=>{lookupCalls++;return {ok:true,json:async()=>({features:[{geometry:{coordinates:[-0.128,51.507]},properties:{name:'London',country:'United Kingdom'}}]})}}};
vm.runInNewContext(`${source}\nglobalThis.EarthMap=EarthMap;`,context,{filename:'earth-map.mjs'});
const node={hidden:false},selected=[];
const earth=new context.EarthMap(node,coords=>selected.push(coords));
assert.equal(latestMap.projection.type,'mercator','A style can override the constructor projection');
events['style.load']();
assert.equal(latestMap.projection.type,'globe','Must be spherical after style.load');
assert.ok(latestMap.layers.find(([layer])=>layer.id==='earth-blue-marble-layer'));
assert.ok(latestMap.layers.find(([layer])=>layer.id==='earth-sentinel-layer'));
assert.match(latestMap.options.style,/openfreemap/);
events.load();
assert.ok(latestMap.terrain,'Measured elevation is activated');
assert.equal(latestMap.getSource('real-dem').encoding,'terrarium');
events.click({lngLat:{lat:51.5,lng:-.13}});
assert.equal(selected[0].lat,51.5);
assert.equal(earth.selectedPin.coordinates[0],-.13);
assert.equal(earth.selectedPin.coordinates[1],51.5);
const form={listeners:{},addEventListener(type,cb){this.listeners[type]=cb}},query={value:'London'},status={textContent:''};
earth.connectSearch(form,query,status);
await form.listeners.submit({preventDefault(){}});
assert.equal(lookupCalls,1);assert.equal(latestMap.fly.center[0],-.128);
assert.match(status.textContent,/Select an exact building site/);
earth.pinsFor([{id:1,geoSource:'fictional',anchor:{lat:20,lon:40}},{id:2,geoSource:'earth-dem',anchor:{lat:51.5,lon:-.13},title:'Saved Earth site'}],id=>opened.push(id));
assert.equal(latestMap.markers.filter(marker=>!marker.removed).length,2,'Only the clicked site and one saved Earth pin are shown');
latestMap.markers[1].element.listeners.click({stopPropagation(){}});
assert.deepEqual(opened,[2]);
console.log('PASS — real globe click, terrain source, place search and saved Earth pins');
