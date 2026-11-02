/* Building footprints from OpenFreeMap OpenMapTiles vector data, independent of
 * the rate-limited Overpass interpreter. Only mapped polygons are displayed.
 * OpenMapTiles render_height is an approximation, NOT a surveyed OSM height.
 * Data © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap. */
import {bboxForSite,localPoint} from './earth-buildings.mjs';
import {PATCH_HALF_UNITS} from './earth-terrain.mjs';

// Use our same-origin constrained tile endpoint: it avoids CORS and provides
// a bounded CDN cache. Direct OpenFreeMap is only a secondary fallback.
export const VECTOR_TILE_URL='/api/osm/tiles/{z}/{x}/{y}.pbf';
export const VECTOR_TILE_FALLBACK='https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf';
const Z=14, EXTENT_LIMIT=8192, TILE_LIMIT=2_500_000, RING_LIMIT=350;
const toTile=(lon,lat)=>{
 const sin=Math.sin(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180);
 const n=2**Z;
 return [(lon+180)/360*n,(1-Math.log((1+sin)/(1-sin))/(2*Math.PI))/2*n];
};
export function tilesForAnchor(anchor){
 const b=bboxForSite(anchor),sw=toTile(b.west,b.south),ne=toTile(b.east,b.north);
 const result=[],max=2**Z-1;
 for(let x=Math.max(0,Math.floor(sw[0]));x<=Math.min(max,Math.floor(ne[0]));x++)
  for(let y=Math.max(0,Math.floor(ne[1]));y<=Math.min(max,Math.floor(sw[1]));y++)result.push({z:Z,x,y});
 if(result.length>16)throw new Error('Vector building area unexpectedly large.');
 return result;
}

/* Small bounded protobuf reader, sufficient for MVT v2 Polygon layer data.
 * No third-party dependency and no eval or dynamic decoding of external scripts. */
class Reader{
 constructor(bytes){this.data=bytes;this.p=0;this.end=bytes.length}
 varint(){let value=0,pow=1;for(let i=0;i<10;i++){
  if(this.p>=this.end)throw new Error('Truncated vector tile');
  const b=this.data[this.p++];if(i<8)value+=(b&127)*pow;
  if(!(b&128))return value;pow*=128;
 }throw new Error('Invalid vector tile integer')}
 bytesField(){const len=this.varint();if(!Number.isSafeInteger(len)||len<0||this.p+len>this.end)throw new Error('Invalid vector tile length');const out=this.data.subarray(this.p,this.p+len);this.p+=len;return out}
 skip(wire){if(wire===0){this.varint();return}
  if(wire===2){this.bytesField();return}
  if(wire===1||wire===5){const n=wire===1?8:4;if(this.p+n>this.end)throw new Error('Invalid vector tile field');this.p+=n;return}
  throw new Error('Unsupported vector tile wire type')}
 fields(fn){while(this.p<this.end){const tag=this.varint(),number=tag>>>3,wire=tag&7;if(!number)throw new Error('Invalid vector tile field');fn(number,wire,this)}}
}
const stringFrom=b=>new TextDecoder('utf-8',{fatal:false}).decode(b);
function allVarints(bytes){const r=new Reader(bytes),result=[];while(r.p<r.end){result.push(r.varint());if(result.length>100000)throw new Error('Vector tile property overflow')}return result}
const zigzag=n=>n%2?-(n+1)/2:n/2;
function decodeValue(bytes){const r=new Reader(bytes);let out=null;r.fields((f,w,a)=>{
 if(f===1&&w===2)out=stringFrom(a.bytesField());
 else if((f===2&&w===5)||(f===3&&w===1)){const field=w===5?4:8;const bytes=a.data.subarray(a.p,a.p+field);a.p+=field;const dv=new DataView(bytes.buffer,bytes.byteOffset,field);out=w===5?dv.getFloat32(0,true):dv.getFloat64(0,true)}
 else if([4,5,6].includes(f)&&w===0){const v=a.varint();out=f===6?zigzag(v):v}
 else if(f===7&&w===0)out=!!a.varint();else a.skip(w)
 });return out;
}
function decodeGeometry(bytes){const nums=allVarints(bytes),rings=[];let x=0,y=0,i=0,ring=[],instructions=0;
 while(i<nums.length){if(++instructions>100000)throw new Error('Vector geometry too complex');const command=nums[i++],op=command&7,count=command>>>3;if(!count||count>10000)throw new Error('Invalid vector geometry command');
  if(op===1||op===2){for(let n=0;n<count;n++){if(i+1>=nums.length)throw new Error('Invalid vector geometry coordinates');x+=zigzag(nums[i++]);y+=zigzag(nums[i++]);if(op===1){if(ring.length>=3)rings.push(ring);ring=[]}ring.push([x,y]);}}
  else if(op===7){if(ring.length>=3){rings.push(ring);ring=[]}}
  else throw new Error('Unsupported vector geometry command');
 }
 if(ring.length>=3)rings.push(ring);
 return rings;
}
function parseFeature(bytes){const out={id:null,type:0,properties:[],geometry:null};const r=new Reader(bytes);r.fields((f,w,a)=>{
  if(f===1&&w===0)out.id=a.varint();
  else if(f===2&&w===2)out.properties=allVarints(a.bytesField());
  else if(f===3&&w===0)out.type=a.varint();
  else if(f===4&&w===2)out.geometry=a.bytesField();
  else a.skip(w);
 });return out;
}
function parseLayer(bytes){const layer={name:'',extent:4096,keys:[],values:[],features:[]};const r=new Reader(bytes);r.fields((f,w,a)=>{
  if(f===1&&w===2)layer.name=stringFrom(a.bytesField());
  else if(f===2&&w===2){if(layer.features.length<6000)layer.features.push(a.bytesField());else a.bytesField()}
  else if(f===3&&w===2)layer.keys.push(stringFrom(a.bytesField()));
  else if(f===4&&w===2)layer.values.push(decodeValue(a.bytesField()));
  else if(f===5&&w===0)layer.extent=a.varint();else a.skip(w);
 });return layer;
}
function polygonArea(ring){let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1]}return area*.5}
function buildMappedPolygon(points,anchor,tile,extent,id,height){
 if(points.length<3||points.length>RING_LIMIT)return null;
 // MVT can clip polygons to the tile edge. Those clipping edges are not
 // real OSM building walls, so omit these fragments rather than draw them.
 if(points.some(([x,y])=>x<=0||y<=0||x>=extent||y>=extent))return null;
 const ring=[];
 for(const [tx,ty] of points){
  const worldX=(tile.x+tx/extent)/2**tile.z,worldY=(tile.y+ty/extent)/2**tile.z;
  const lon=worldX*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*worldY)))*180/Math.PI;
  ring.push(localPoint(anchor,lat,lon));
 }
 if(ring.length>2&&Math.hypot(ring[0][0]-ring.at(-1)[0],ring[0][1]-ring.at(-1)[1])<.02)ring.pop();
 if(ring.length<3||ring.some(p=>!p.every(Number.isFinite)))return null;
 const bounds={minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minZ:Math.min(...ring.map(p=>p[1])),maxZ:Math.max(...ring.map(p=>p[1]))};
 if(bounds.minX>PATCH_HALF_UNITS||bounds.maxX< -PATCH_HALF_UNITS||bounds.minZ>PATCH_HALF_UNITS||bounds.maxZ< -PATCH_HALF_UNITS)return null;
 // Tile-edge fragments or buildings crossing the DEM patch cannot be safely
 // reconstructed without the original whole polygon. Omit, never invent edges.
 if(ring.some(p=>Math.abs(p[0])>PATCH_HALF_UNITS-1||Math.abs(p[1])>PATCH_HALF_UNITS-1))return null;
 // The OpenMapTiles schema defaults missing source heights to 5 m.
 // Do not turn that default into fictitious 3D geometry.
 const estimate=Number.isFinite(height)&&height>=2&&height<=900&&height!==5?height:null;
 return {id:`tile/${tile.z}/${tile.x}/${tile.y}/${id}`,outline:ring,bounds,heightMetres:null,estimatedHeightMetres:estimate,levels:null,kind:'building',heightSource:estimate?'openmaptiles-render-height':null};
}
export function parseVectorBuildings(input,anchor,tile,{limit=1800}={}){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 if(bytes.length> TILE_LIMIT)throw new Error('Vector tile exceeds size budget');
 const layers=[],r=new Reader(bytes);r.fields((f,w,a)=>{if(f===3&&w===2)layers.push(parseLayer(a.bytesField()));else a.skip(w)});
 const found=[];
 for(const layer of layers){if(layer.name!=='building')continue;
  if(!Number.isInteger(layer.extent)||layer.extent<256||layer.extent>EXTENT_LIMIT)throw new Error('Invalid vector tile extent');
  for(const raw of layer.features){
   const feature=parseFeature(raw);if(feature.type!==3||!feature.geometry)continue;
   let height=null;
   for(let i=0;i+1<feature.properties.length;i+=2){
    if(layer.keys[feature.properties[i]]==='render_height')height=Number(layer.values[feature.properties[i+1]]);
   }
   const rings=decodeGeometry(feature.geometry);
   for(const points of rings){
    if(polygonArea(points)<=0)continue; // OpenMapTiles polygon exterior; skip holes.
    const b=buildMappedPolygon(points,anchor,tile,layer.extent,feature.id??found.length,height);
    if(b)found.push(b);
    if(found.length>=limit)return found;
   }
  }
 }
 return found;
}
export async function loadVectorBuildings(anchor,{fetchImpl=fetch,signal}={}){
 const tiles=tilesForAnchor(anchor);
 const data={source:'openstreetmap',provider:'tiles.openfreemap.org',attribution:'© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap',anchor:{...anchor},buildings:[],clipped:0,updatedAt:null,sourceType:'vector-tile'};
 const failures=[];
 // Limit simultaneous tile requests; normal sites need 4-9 tiles.
 for(let i=0;i<tiles.length;i+=4){
  const group=tiles.slice(i,i+4);
  const results=await Promise.all(group.map(async tile=>{
   const makeUrl=template=>template.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);
   const problems=[];
   for(const template of [VECTOR_TILE_URL,VECTOR_TILE_FALLBACK]){
    const url=makeUrl(template);
    const controller=new AbortController();
    const cancel=()=>controller.abort();
    if(signal?.aborted)throw new Error('Building request cancelled');
    signal?.addEventListener?.('abort',cancel,{once:true});
    const timeout=setTimeout(cancel,7500);
    try{
     const response=await fetchImpl(url,{mode:'cors',signal:controller.signal,cache:'force-cache'});
     if(!response.ok)throw new Error(`HTTP ${response.status}`);
     const size=Number(response.headers?.get?.('content-length')||0);
     if(size>TILE_LIMIT)throw new Error('Oversized tile');
     const bytes=await response.arrayBuffer();
     if(bytes.byteLength>TILE_LIMIT)throw new Error('Oversized tile');
     const buildings=parseVectorBuildings(bytes,anchor,tile);
     if(template===VECTOR_TILE_FALLBACK)data.provider='tiles.openfreemap.org (direct fallback)';
     return buildings;
    }catch(error){
     if(signal?.aborted)throw error;
     problems.push(`${template===VECTOR_TILE_URL?'local proxy':'OpenFreeMap'}: ${controller.signal.aborted?'timed out':error.message}`);
    }finally{clearTimeout(timeout);signal?.removeEventListener?.('abort',cancel)}
   }
   failures.push(`${tile.x}/${tile.y} (${problems.join(', ')})`);
   return null;
  }));
  for(const buildings of results)if(buildings)data.buildings.push(...buildings);
 }
 if(failures.length){
  data.partial=true;data.failedTiles=failures.length;data.totalTiles=tiles.length;
  data.warning='OSM vector tiles partly unavailable: '+failures.slice(0,2).join(' · ');
  // Partial *verified* footprints are still useful; never discard several
  // successfully loaded city tiles solely because another tile failed.
  if(!data.buildings.length)throw new Error('Vector tiles unavailable ('+failures.slice(0,3).join(' · ')+')');
 }
 // Source can be legitimately empty, e.g. rural locations: no guessing.
 const seen=new Set();data.buildings=data.buildings.filter(b=>{
  if(seen.has(b.id))return false;seen.add(b.id);return true;
 }).sort((a,b)=>{
  const pa=((a.bounds.minX+a.bounds.maxX)/2)**2+((a.bounds.minZ+a.bounds.maxZ)/2)**2;
  const pb=((b.bounds.minX+b.bounds.maxX)/2)**2+((b.bounds.minZ+b.bounds.maxZ)/2)**2;
  return pa-pb;
 });
 if(data.buildings.length>1800){data.clipped=data.buildings.length-1800;data.buildings.length=1800}
 return data;
}
