/* Observed OSM buildings within the selected 1.56 km DEM patch.
 * Never synthesize footprints, storeys or heights. Unknown heights stay 2D.
 * Public Overpass is best-effort, so results are cached per selected site.
 */
import {nearbyLatLon,EARTH_RADIUS_M,PATCH_HALF_UNITS,METRES_PER_UNIT} from './earth-terrain.mjs';
const RAD=Math.PI/180,HALF_M=PATCH_HALF_UNITS*METRES_PER_UNIT;
export const OVERPASS_URL='https://overpass-api.de/api/interpreter';
const cache=new Map(),CACHE_MS=15*60*1000;
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
  buildings.push({id:`way/${item.id}`,outline:ring,bounds,heightMetres:recordedHeight(item.tags),levels:item.tags['building:levels']||null,kind:item.tags.building});
  if(buildings.length>=limit)throw new Error('Site has more mapped buildings than preview supports; choose a smaller study area');
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
 const key=`${anchor.lat.toFixed(7)},${anchor.lon.toFixed(7)}`;const previous=cache.get(key);
 if(previous&&Date.now()-previous.at<CACHE_MS)return previous.data;
 const response=await fetchImpl(OVERPASS_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:buildingQuery(anchor)}),mode:'cors',signal});
 if(!response.ok)throw new Error(`OpenStreetMap buildings unavailable (HTTP ${response.status})`);
 const body=await response.json(),data=parseBuildings(body,anchor);
 cache.set(key,{at:Date.now(),data});if(cache.size>12)cache.delete(cache.keys().next().value);
 return data;
}
