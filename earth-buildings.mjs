/* Observed OSM buildings within the selected 1.56 km DEM patch.
 * Never synthesize footprints, storeys or heights. Unknown heights stay 2D.
 * Public Overpass is best-effort, so results are cached per selected site.
 */
import {nearbyLatLon,EARTH_RADIUS_M,PATCH_HALF_UNITS,METRES_PER_UNIT} from './earth-terrain.mjs';
const RAD=Math.PI/180,HALF_M=PATCH_HALF_UNITS*METRES_PER_UNIT;
// Try the currently less-loaded public instance before the often-overloaded main server.
// Both providers are best-effort; do not turn failures into fabricated footprints.
export const OVERPASS_URL='https://overpass.private.coffee/api/interpreter';
export const OVERPASS_FALLBACK_URL='https://overpass-api.de/api/interpreter';
export const OVERPASS_THIRD_URL='https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const ENDPOINTS=[OVERPASS_URL,OVERPASS_FALLBACK_URL,OVERPASS_THIRD_URL];
const BACKOFF_MS=45_000;
const failures=new Map();
const cache=new Map(),CACHE_MS=20*60*1000;
const PERSIST_MS=7*24*60*60*1000;
const STALE_MS=30*24*60*60*1000;
const DB_NAME='planetlab-osm-footprints-v1';
let storagePromise;
function openStorage(){
 if(typeof indexedDB==='undefined')return Promise.resolve(null);
 if(!storagePromise)storagePromise=new Promise(resolve=>{
  try{const req=indexedDB.open(DB_NAME,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('footprints'))req.result.createObjectStore('footprints',{keyPath:'key'})};
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);req.onblocked=()=>resolve(null);
  }catch{resolve(null)}
 });
 return storagePromise;
}
async function persisted(key){
 const db=await openStorage();if(!db)return null;
 return new Promise(resolve=>{try{const req=db.transaction('footprints','readonly').objectStore('footprints').get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>resolve(null)}catch{resolve(null)}});
}
async function saveFootprints(key,data){
 const db=await openStorage();if(!db)return;
 return new Promise(resolve=>{try{const transaction=db.transaction('footprints','readwrite');transaction.objectStore('footprints').put({key,at:Date.now(),data});transaction.oncomplete=()=>resolve();transaction.onerror=()=>resolve()}catch{resolve()}});
}
function validStored(record,anchor){
 if(!record||!Number.isFinite(record.at)||Date.now()-record.at>STALE_MS)return false;
 const d=record.data;
 return d?.source==='openstreetmap'&&d.anchor?.lat===anchor.lat&&d.anchor?.lon===anchor.lon&&Array.isArray(d.buildings)&&d.buildings.length<=1800&&d.buildings.every(b=>
  typeof b.id==='string'&&b.id.startsWith('way/')&&Array.isArray(b.outline)&&b.outline.length>=3&&b.outline.length<=350&&b.outline.every(v=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=78))&&b.bounds&&Object.values(b.bounds).every(Number.isFinite));
}
function cachedResult(record,stale=false){return {...record.data,cacheStatus:stale?'stale':'fresh',cachedAt:record.at}}
export function bboxForSite(anchor,half=HALF_M){
 const sw=nearbyLatLon(anchor,-half,-half),ne=nearbyLatLon(anchor,half,half);
 return {south:sw.lat,west:sw.lon,north:ne.lat,east:ne.lon};
}
export function buildingQuery(anchor){
 const b=bboxForSite(anchor),n=v=>v.toFixed(7);
 // `out geom` gives actual outline coordinates, rather than only OSM node ids.
 return `[out:json][timeout:20];way["building"](${n(b.south)},${n(b.west)},${n(b.north)},${n(b.east)});out tags geom;`;
}
export function localPoint(anchor,lat,lon){
 const east=(lon-anchor.lon)*RAD*EARTH_RADIUS_M*Math.cos(anchor.lat*RAD);
 const north=(lat-anchor.lat)*RAD*EARTH_RADIUS_M;
 return [east/METRES_PER_UNIT,north/METRES_PER_UNIT];
}
export function recordedHeight(tags={}){
 // Only a recorded OSM height in metres or feet. Levels are NOT a height.
 const input=String(tags.height??'').trim();
 const match=input.match(/^([0-9]+(?:\.[0-9]+)?)\s*(m|metres?|meters?|ft|feet|')?$/i);
 if(!match)return null;
 const metres=Number(match[1]) * (/^(ft|feet|')$/i.test(match[2]||'')?.3048:1);
 return Number.isFinite(metres)&&metres>=1.5&&metres<=900?metres:null;
}
export function estimatedStoreyHeight(tags={}){
 // Explicit OSM floor count, approximate 3 m/storey — NOT a measured height.
 const value=String(tags['building:levels']??'').trim();
 if(!/^[1-9][0-9]?(?:\.[05])?$/.test(value))return null;
 const floors=Number(value);return floors>=1&&floors<=80?Math.round(floors*30)/10:null;
}
function compactRing(points){
 const out=[];
 for(const p of points){if(!out.length||Math.hypot(p[0]-out.at(-1)[0],p[1]-out.at(-1)[1])>.025)out.push(p)}
 if(out.length>2&&Math.hypot(out[0][0]-out.at(-1)[0],out[0][1]-out.at(-1)[1])<.1)out.pop();
 return out;
}
export function parseBuildings(payload,anchor,{limit=1800}={}){
 if(!Array.isArray(payload?.elements))throw new Error('Building data response invalid');
 const buildings=[];let clipped=0;
 for(const item of payload.elements){
  if(item.type!=='way'||!item.tags?.building||!Array.isArray(item.geometry)||item.geometry.length<4)continue;
  const coordinates=item.geometry;
  if(Math.abs(coordinates[0].lat-coordinates.at(-1).lat)>1e-7||Math.abs(coordinates[0].lon-coordinates.at(-1).lon)>1e-7)continue;
  const ring=compactRing(coordinates.map(p=>localPoint(anchor,p.lat,p.lon)));
  if(ring.length<3||ring.length>350||ring.some(p=>!p.every(Number.isFinite)))continue;
  const bounds={minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minZ:Math.min(...ring.map(p=>p[1])),maxZ:Math.max(...ring.map(p=>p[1]))};
  if(bounds.maxX < -PATCH_HALF_UNITS || bounds.minX>PATCH_HALF_UNITS || bounds.maxZ < -PATCH_HALF_UNITS || bounds.minZ>PATCH_HALF_UNITS)continue;
  // Entirely clipping complex polygons can corrupt the shape; omit buildings outside the patch.
  if(Math.max(...ring.map(p=>Math.max(Math.abs(p[0]),Math.abs(p[1])))) > PATCH_HALF_UNITS-1){clipped++;continue}
  buildings.push({id:`way/${item.id}`,outline:ring,bounds,heightMetres:recordedHeight(item.tags),estimatedHeightMetres:recordedHeight(item.tags)===null?estimatedStoreyHeight(item.tags):null,levels:item.tags['building:levels']||null,kind:item.tags.building});
 }
 // Dense city centers can contain more than the renderer's safe preview budget.
 // Keep real footprints nearest the selected point rather than failing the entire site.
 if(buildings.length>limit){
  buildings.sort((a,b)=>{
   const da=((a.bounds.minX+a.bounds.maxX)/2)**2+((a.bounds.minZ+a.bounds.maxZ)/2)**2;
   const db=((b.bounds.minX+b.bounds.maxX)/2)**2+((b.bounds.minZ+b.bounds.maxZ)/2)**2;
   return da-db;
  });
  clipped+=buildings.length-limit;buildings.length=limit;
 }
 return {source:'openstreetmap',attribution:'© OpenStreetMap contributors (ODbL)',anchor:{...anchor},buildings,clipped,updatedAt:payload.osm3s?.timestamp_osm_base||null};
}
export function pointInRing(point,ring){
 let inside=false;const [x,y]=point;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];
  if((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
export function occupiedByBuilding(x,z,data,buffer=1.5){
 for(const b of data?.buildings||[]){
  if(x<b.bounds.minX-buffer||x>b.bounds.maxX+buffer||z<b.bounds.minZ-buffer||z>b.bounds.maxZ+buffer)continue;
  if(pointInRing([x,z],b.outline))return true;
  for(let i=0;i<b.outline.length;i++){
   const [ax,az]=b.outline[i],[bx,bz]=b.outline[(i+1)%b.outline.length];
   const t=Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(z-az)*(bz-az))/((bx-ax)**2+(bz-az)**2||1)));
   if(Math.hypot(x-ax-t*(bx-ax),z-az-t*(bz-az))<=buffer)return true;
  }
 }
 return false;
}
export async function fetchSiteBuildings(anchor,{fetchImpl=fetch,signal}={}){
 const key=`${anchor.lat.toFixed(7)},${anchor.lon.toFixed(7)}`;
 const previous=cache.get(key);
 if(previous&&Date.now()-previous.at<CACHE_MS)return previous.data;
 const disk=await persisted(key);
 const known=validStored(disk,anchor)?disk:null;
 if(known&&Date.now()-known.at<PERSIST_MS){
  const saved=cachedResult(known);
  cache.set(key,{at:Date.now(),data:saved});
  return saved;
 }
 const failure=failures.get(key);
 if(failure&&Date.now()-failure.at<BACKOFF_MS){
  if(known)return cachedResult(known,true);
  throw new Error('OpenStreetMap building service temporarily unavailable. Retry shortly. '+failure.message);
 }
 const issues=[];
 // Bound each public-provider attempt: an overloaded server must not block the
 // fallback indefinitely. The caller's cancellation still interrupts the query.
 for(const endpoint of ENDPOINTS){
  const controller=typeof AbortController==='function'?new AbortController():null;
  const cancel=()=>controller?.abort();
  const timer=controller?setTimeout(cancel,13000):null;
  if(signal?.aborted){if(timer)clearTimeout(timer);throw new Error('Building request cancelled')}
  signal?.addEventListener?.('abort',cancel,{once:true});
  try{
   const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:buildingQuery(anchor)}),mode:'cors',signal:controller?.signal||signal});
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   const body=await response.json(),data=parseBuildings(body,anchor);
   data.provider=new URL(endpoint).hostname;
   cache.set(key,{at:Date.now(),data});if(cache.size>12)cache.delete(cache.keys().next().value);
   failures.delete(key);
   void saveFootprints(key,data);
   return data;
  }catch(error){
   if(signal?.aborted)throw error;
   issues.push(`${new URL(endpoint).hostname}: ${error.name==='AbortError'?'timed out':error.message}`);
  }finally{
   if(timer)clearTimeout(timer);
   signal?.removeEventListener?.('abort',cancel);
  }
 }
 const message=issues.join(' · ');
 failures.set(key,{at:Date.now(),message});
 if(known)return cachedResult(known,true);
 throw new Error('OpenStreetMap buildings unavailable; all public Overpass services failed. '+message);
}
