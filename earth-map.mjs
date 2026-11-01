/* The main globe is real Earth, not a procedural terrain ball.
 * MapLibre globe, OSM cartography from OpenFreeMap, real 3D DEM from Mapterhorn.
 * No API key or account required for either provider.
 */
import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.16.0/dist/maplibre-gl.mjs';
const MAP_STYLE='https://tiles.openfreemap.org/styles/liberty';
// Globe is a spherical imagery viewer; measured DEM is loaded ONLY for the selected site.
// The previous globe-wide raster-dem source requested non-existent z13/z14 tiles.
// NASA's 500-m Blue Marble and EOX's CC BY 4.0 2016 Sentinel-2 mosaic.
// A single coordinate system is shared by this globe and the selected DEM patch.
const BLUE_MARBLE='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const SENTINEL='https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
export class EarthMap{
 constructor(node,onSelect){
  this.node=node;this.onSelect=onSelect;this.pins=[];this.ready=false;this.selectedPin=null;this.imageryKey='';this.tileTemplate='';
  this.map=new maplibregl.Map({container:node,style:MAP_STYLE,center:[0,15],zoom:1.8,pitch:0,attributionControl:true,
   pixelRatio:Math.min(typeof window==='undefined'?1:window.devicePixelRatio||1,1.5),maxCanvasSize:[6144,6144],
   // OpenFreeMap Liberty currently ships invalid numeric filters in these US road
   // shield symbol layers. Removing only the three invalid symbols preserves road
   // geometry, building map features, and the rest of the cartography.
   transformStyle:(_prior,next)=>({...next,layers:next.layers.filter(layer=>
    !['highway-shield-non-us','highway-shield-us-interstate','road_shield_us'].includes(layer.id))})});
  this.map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'top-right');
  // Styles can override projection specified in the constructor. ALWAYS set it after
  // style.load; without this, MapLibre displays a flat world even at globe zoom.
  this.map.on('style.load',()=>{
   this.map.setProjection({type:'globe'});
   const firstLabel=this.map.getStyle().layers.find(layer=>layer.type==='symbol')?.id;
   if(!this.map.getSource('earth-blue-marble')){
    this.map.addSource('earth-blue-marble',{type:'raster',tiles:[BLUE_MARBLE],tileSize:256,maxzoom:8,
     attribution:'Imagery: NASA EOSDIS GIBS (Blue Marble)'});
    this.map.addLayer({id:'earth-blue-marble-layer',type:'raster',source:'earth-blue-marble',
     paint:{'raster-fade-duration':150}},firstLabel);
   }
   if(!this.map.getSource('earth-sentinel')){
    this.map.addSource('earth-sentinel',{type:'raster',tiles:[SENTINEL],tileSize:256,minzoom:5,maxzoom:14,
     attribution:'Imagery: EOX Sentinel-2 cloudless 2016 (CC BY 4.0; Copernicus data)'});
    this.map.addLayer({id:'earth-sentinel-layer',type:'raster',source:'earth-sentinel',minzoom:5,
     paint:{'raster-opacity':['interpolate',['linear'],['zoom'],5,0,7,1], 'raster-fade-duration':200}},firstLabel);
   }
   this.addHighResolutionLayer();
  });
  this.map.on('load',()=>{this.ready=true});
  this.map.on('click',e=>{
   // Ignore sky clicks (there is no Earth surface there in the globe projection).
   if(this.map.transform?.isPointOnMapSurface && !this.map.transform.isPointOnMapSurface(e.point))return;
   if(!e.lngLat||!Number.isFinite(e.lngLat.lat)||!Number.isFinite(e.lngLat.lng))return;
   const anchor={lat:Number(e.lngLat.lat.toFixed(7)),lon:Number(e.lngLat.lng.toFixed(7))};
   this.markSelection(anchor);
   this.onSelect(anchor);
  });
  this.map.on('error',e=>{
   if(this.node.hidden)return;
   const status=document.getElementById('earthStatus');
   if(status&&!this.ready)status.textContent='Earth map unavailable. Check map tile connectivity.';
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
 addHighResolutionLayer(){
  if(!this.imageryKey||this.map.getSource('earth-aerial'))return;
  // The key remains in this browser session; it is never saved with projects.
  const key=encodeURIComponent(this.imageryKey);
  this.map.addSource('earth-aerial',{type:'raster',url:`https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=${key}`,tileSize:512,
   attribution:'Aerial imagery © MapTiler, © imagery providers'});
  const firstLabel=this.map.getStyle().layers.find(layer=>layer.type==='symbol')?.id;
  this.map.addLayer({id:'earth-aerial-layer',type:'raster',source:'earth-aerial',minzoom:5},firstLabel);
 }
 async setImageryKey(key){
  const value=String(key||'').trim();
  // Validate metadata before mutating the active layer or storing the key.
  // A failed request must leave the working public imagery untouched.
  let tileTemplate='';
  if(value){
   const response=await fetch(`https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=${encodeURIComponent(value)}`,{mode:'cors'});
   if(!response.ok)throw new Error(response.status===403?'MapTiler key or HTTP-origin restriction rejected (403)':`MapTiler satellite imagery unavailable (HTTP ${response.status})`);
   const meta=await response.json();
   if(!Array.isArray(meta.tiles)||!meta.tiles.length)throw new Error('MapTiler satellite tileset returned invalid metadata');
   // Only allow actual provider endpoints, not arbitrary URLs in TileJSON.
   tileTemplate=meta.tiles.find(url=>typeof url==='string'&&/^https:\/\/api\.maptiler\.com\/tiles\/satellite-v2\//.test(url)&&url.includes('{z}')&&url.includes('{x}')&&url.includes('{y}'))||'';
   if(!tileTemplate)throw new Error('MapTiler satellite TileJSON has no compatible satellite-v2 raster tiles');
   // A valid metadata response alone is insufficient: an origin-restricted key
   // can still fail on image tile requests. Verify before enabling the layer.
   const tile=tileTemplate.replace('{z}','3').replace('{x}','4').replace('{y}','2').replace('{key}',encodeURIComponent(value));
   const tileResponse=await fetch(tile,{mode:'cors'});
   if(!tileResponse.ok)throw new Error(`MapTiler imagery tile rejected (HTTP ${tileResponse.status}); check domain restrictions and tileset access`);
  }
  this.imageryKey=value;this.tileTemplate=tileTemplate;
  if(this.map.getLayer?.('earth-aerial-layer'))this.map.removeLayer('earth-aerial-layer');
  if(this.map.getSource('earth-aerial'))this.map.removeSource('earth-aerial');
  this.addHighResolutionLayer();
 }

 show(){this.node.hidden=false;this.map.resize()}
 hide(){this.node.hidden=true}
 markSelection(anchor){
  this.selectedPin?.remove();
  const element=document.createElement('div');element.className='earth-selection-marker';element.title='Selected location';
  this.selectedPin=new maplibregl.Marker({element,anchor:'center'}).setLngLat([anchor.lon,anchor.lat]).addTo(this.map);
 }
 focus(anchor){
  // Preserve the exact clicked coordinate; no snapped fictional island/region.
  this.map.flyTo({center:[anchor.lon,anchor.lat],zoom:12,pitch:0,duration:1500,essential:true});
 }
 pinsFor(entries=[],open){this.projectEntries=entries;this.openProject=open;this.updatePins()}
 bookmarksFor(entries=[],open){this.bookmarkEntries=entries;this.openBookmark=open;this.updatePins()}
 updatePins(){
  this.pins.forEach(pin=>pin.remove());this.pins=[];
  const add=(entry,kind,callback)=>{
   if(!Number.isFinite(entry.anchor?.lat)||!Number.isFinite(entry.anchor?.lon))return;
   const node=document.createElement('button');node.type='button';node.className='earth-pin'+(kind==='bookmark'?' earth-bookmark-pin':'');
   node.title=entry.title||'Saved location';node.setAttribute('aria-label',node.title);node.textContent=kind==='bookmark'?'★':'●';
   node.addEventListener('click',event=>{event.stopPropagation();callback?.(entry.id)});
   this.pins.push(new maplibregl.Marker({element:node}).setLngLat([entry.anchor.lon,entry.anchor.lat]).addTo(this.map));
  };
  for(const item of this.projectEntries||[])if(item.geoSource==='earth-dem')add(item,'project',this.openProject);
  for(const item of this.bookmarkEntries||[])add(item,'bookmark',this.openBookmark);
 }
}
