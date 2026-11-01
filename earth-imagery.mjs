/* A 1,560-m square of *actual* satellite imagery, georeferenced to the
 * same DEM anchor and axes as the Three.js local terrain. Key-free public
 * Sentinel-2 cloudless 2016 tiles (EOX, CC BY 4.0). */
import {nearbyLatLon,lonLatToTile,PATCH_HALF_UNITS,METRES_PER_UNIT} from './earth-terrain.mjs';
export const IMAGERY_URL='https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
export const AERIAL_URL='https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}';
export function geoUV(x,z,half=PATCH_HALF_UNITS){return [(x+half)/(2*half),(z+half)/(2*half)]}
export function imageryBounds(anchor, zoom=14){
 const metres=PATCH_HALF_UNITS*METRES_PER_UNIT;
 const nw=nearbyLatLon(anchor,-metres,metres),se=nearbyLatLon(anchor,metres,-metres);
 const a=lonLatToTile(nw.lon,nw.lat,zoom),b=lonLatToTile(se.lon,se.lat,zoom);
 // Only small local patches, never an antimeridian-crossing mosaic.
 if(b.x<a.x){b.x+=2**zoom}
 return {west:a.x*256,north:a.y*256,east:b.x*256,south:b.y*256,zoom};
}
export async function loadSiteImagery(anchor,{zoom,size,loadImage=loadRasterTile,maptilerKey='',tileTemplate=''}={}){
 const highRes=Boolean(maptilerKey);zoom??=highRes?17:14;size??=highRes?2048:1024;
 // The physical area spans more tiles at high latitudes and large zoom levels.
 // Reduce zoom for a bounded number of genuine image requests; never invent
 // pixels or reject a legitimate local site because of an arbitrary pixel cap.
 let bounds,width,height,minX,maxX,minY,maxY,tileCount;
 do{
  bounds=imageryBounds(anchor,zoom);width=bounds.east-bounds.west;height=bounds.south-bounds.north;
  if(!(width>0&&height>0)||!Number.isFinite(width+height))throw new Error('Satellite imagery coordinates invalid');
  minX=Math.floor(bounds.west/256);maxX=Math.floor((bounds.east-0.0001)/256);
  minY=Math.floor(bounds.north/256);maxY=Math.floor((bounds.south-0.0001)/256);
  tileCount=(maxX-minX+1)*(maxY-minY+1);
  if(tileCount<=36)break;
  zoom--;
 }while(zoom>=0);
 if(tileCount>36)throw new Error('Satellite imagery requires too many tiles');
 const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
 // Cropping tiles into this texture preserves the exact georeferenced footprint.
 const jobs=[];
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
  jobs.push(async()=>{
   const image=await loadImage(zoom,((x%2**zoom)+2**zoom)%2**zoom,y,maptilerKey,tileTemplate);
   return {x,y,image};
  });
 }
 // Limit concurrent downloads; especially important for metered aerial imagery.
 const images=[];for(let offset=0;offset<jobs.length;offset+=6)images.push(...await Promise.all(jobs.slice(offset,offset+6).map(job=>job())));
 for(const {x,y,image} of images){
  ctx.drawImage(image,(x*256-bounds.west)/width*size,(y*256-bounds.north)/height*size,256/width*size,256/height*size);
  image.close?.();
 }
 return canvas;
}
export async function loadRasterTile(z,x,y,maptilerKey='',tileTemplate=''){
 const url=(maptilerKey?(tileTemplate||AERIAL_URL):IMAGERY_URL).replace('{z}',z).replace('{x}',x).replace('{y}',y).replace('{key}',encodeURIComponent(maptilerKey));
 const response=await fetch(url,{mode:'cors'});
 if(!response.ok)throw new Error((maptilerKey?'High-resolution aerial':'Sentinel-2')+' imagery unavailable (HTTP '+response.status+')');
 return createImageBitmap(await response.blob());
}
