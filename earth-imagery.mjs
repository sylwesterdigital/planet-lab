/* A 1,560-m square of *actual* satellite imagery, georeferenced to the
 * same DEM anchor and axes as the Three.js local terrain. Key-free public
 * Sentinel-2 cloudless 2016 tiles (EOX, CC BY 4.0). */
import {nearbyLatLon,lonLatToTile,PATCH_HALF_UNITS,METRES_PER_UNIT} from './earth-terrain.mjs';
export const IMAGERY_URL='https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
export function imageryBounds(anchor, zoom=14){
 const metres=PATCH_HALF_UNITS*METRES_PER_UNIT;
 const nw=nearbyLatLon(anchor,-metres,metres),se=nearbyLatLon(anchor,metres,-metres);
 const a=lonLatToTile(nw.lon,nw.lat,zoom),b=lonLatToTile(se.lon,se.lat,zoom);
 // Only small local patches, never an antimeridian-crossing mosaic.
 if(b.x<a.x){b.x+=2**zoom}
 return {west:a.x*256,north:a.y*256,east:b.x*256,south:b.y*256,zoom};
}
export async function loadSiteImagery(anchor,{zoom=14,size=1024,loadImage=loadRasterTile}={}){
 const bounds=imageryBounds(anchor,zoom),width=bounds.east-bounds.west,height=bounds.south-bounds.north;
 if(!(width>0&&height>0)||width>1800||height>1800)throw new Error('Satellite imagery bounds invalid');
 const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
 const minX=Math.floor(bounds.west/256),maxX=Math.floor((bounds.east-0.0001)/256);
 const minY=Math.floor(bounds.north/256),maxY=Math.floor((bounds.south-0.0001)/256);
 // Cropping tiles into this texture preserves the exact georeferenced footprint.
 const jobs=[];
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
  jobs.push((async()=>{
   const image=await loadImage(zoom,((x%2**zoom)+2**zoom)%2**zoom,y);
   return {x,y,image};
  })());
 }
 const images=await Promise.all(jobs);
 for(const {x,y,image} of images){
  ctx.drawImage(image,(x*256-bounds.west)/width*size,(y*256-bounds.north)/height*size,256/width*size,256/height*size);
  image.close?.();
 }
 return canvas;
}
export async function loadRasterTile(z,x,y){
 const url=IMAGERY_URL.replace('{z}',z).replace('{x}',x).replace('{y}',y);
 const response=await fetch(url,{mode:'cors'});
 if(!response.ok)throw new Error('Satellite imagery unavailable ('+response.status+')');
 return createImageBitmap(await response.blob());
}
