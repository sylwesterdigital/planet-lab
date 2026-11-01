/* The main globe is real Earth, not a procedural terrain ball.
 * MapLibre globe, OSM cartography from OpenFreeMap, real 3D DEM from Mapterhorn.
 * No API key or account required for either provider.
 */
import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs';
const MAP_STYLE='https://tiles.openfreemap.org/styles/liberty';
const TERRAIN='https://tiles.mapterhorn.com/tilejson.json';
export class EarthMap{
 constructor(node,onSelect){
  this.node=node;this.onSelect=onSelect;this.pins=[];this.ready=false;
  this.map=new maplibregl.Map({container:node,style:MAP_STYLE,center:[0,20],zoom:1.65,projection:{type:'globe'},pitch:0,attributionControl:true});
  this.map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'top-right');
  this.map.on('load',()=>{
   this.ready=true;
   this.map.addSource('real-dem',{type:'raster-dem',url:TERRAIN,tileSize:512,encoding:'terrarium',attribution:'Terrain: Mapterhorn (CC BY 4.0)'});
   this.map.setTerrain({source:'real-dem',exaggeration:1});
   this.map.addControl(new maplibregl.TerrainControl({source:'real-dem',exaggeration:1}),'top-right');
  });
  this.map.on('click',e=>{
   // Clicking any named street, country or mountain selects that actual coordinate.
   const anchor={lat:Number(e.lngLat.lat.toFixed(6)),lon:Number(e.lngLat.lng.toFixed(6))};
   this.onSelect(anchor);
  });
  this.map.on('error',e=>{
   if(this.node.hidden)return;
   const status=document.getElementById('earthStatus');
   if(status)status.textContent='Map data unavailable. Check map tile connectivity.';
   console.warn('Earth map provider:',e.error?.message||e);
  });
 }
 connectSearch(form,input,status){
  this.lastSearch=0;this.cache=new Map();
  form.addEventListener('submit',async event=>{
   event.preventDefault();
   const term=input.value.trim();if(term.length<2)return;
   const now=Date.now();if(now-this.lastSearch<1500){status.textContent='Please wait before searching again.';return}this.lastSearch=now;
   status.textContent='Finding '+term+'…';
   try{
    let data=this.cache.get(term.toLowerCase());
    if(!data){
     const response=await fetch('https://photon.komoot.io/api/?'+new URLSearchParams({q:term,limit:'3'}).toString(),{mode:'cors'});
     if(!response.ok)throw new Error('Place search unavailable');
     data=await response.json();this.cache.set(term.toLowerCase(),data);
    }
    const first=data.features?.[0],coordinates=first?.geometry?.coordinates;
    if(!Array.isArray(coordinates)||!Number.isFinite(coordinates[0])||!Number.isFinite(coordinates[1]))throw new Error('No matching place found');
    this.map.flyTo({center:coordinates,zoom:11,pitch:40,essential:true,duration:1400});
    const props=first.properties||{};
    const name=[props.name,props.city||props.county,props.country].filter(Boolean).join(', ');
    status.textContent=(name||term)+' · Select an exact building site on the map.';
   }catch(error){status.textContent=error.message;console.warn('Place search:',error)}
  });
 }
 show(){this.node.hidden=false;this.map.resize()}
 hide(){this.node.hidden=true}
 focus(anchor){this.map.flyTo({center:[anchor.lon,anchor.lat],zoom:12,pitch:50,duration:1700,essential:true})}
 pinsFor(entries=[],open){
  this.pins.forEach(pin=>pin.remove());this.pins=[];
  for(const item of entries){
   // Pre-Earth snapshots were generated on a fictional planet; do not claim
   // that their numeric lat/lon identifies a physical location on Earth.
   if(item.geoSource!=='earth-dem'||!Number.isFinite(item.anchor?.lat)||!Number.isFinite(item.anchor?.lon))continue;
   const node=document.createElement('button');node.type='button';node.className='earth-pin';node.title=item.title||'Saved project';node.textContent='●';
   node.addEventListener('click',event=>{event.stopPropagation();open(item.id)});
   const pin=new maplibregl.Marker({element:node}).setLngLat([item.anchor.lon,item.anchor.lat]).addTo(this.map);
   this.pins.push(pin);
  }
 }
}
