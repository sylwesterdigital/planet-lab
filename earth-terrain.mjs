/* Real Earth elevation sampling. Mapterhorn Terrain RGB/terrarium data,
 * 512px tiles; values are measured elevation in metres above sea level.
 * This is a DEM-based visualisation, not a land survey or hazard model.
 */
export const EARTH_RADIUS_M = 6378137;
export const METRES_PER_UNIT = 10;
export const PATCH_HALF_UNITS = 78;
export const GRID_STEPS = 104;
const RAD = Math.PI / 180;
const MAX_LAT = 85.05112878;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export function nearbyLatLon(anchor, eastMetres=0, northMetres=0){
 const lat=clamp(anchor.lat+northMetres / EARTH_RADIUS_M / RAD,-MAX_LAT,MAX_LAT);
 const lon=anchor.lon+eastMetres / (EARTH_RADIUS_M * Math.cos(anchor.lat*RAD)) / RAD;
 return {lat,lon:((lon+180)%360+360)%360-180};
}
export function lonLatToTile(lon,lat,z){
 const n=2**z,phi=clamp(lat,-MAX_LAT,MAX_LAT)*RAD;
 return {x:(lon+180)/360*n,y:(1-Math.log(Math.tan(phi)+1/Math.cos(phi))/Math.PI)/2*n};
}
export function terrariumHeight(r,g,b){return r*256+g+b/256-32768}
export function sampleElevation(grid,x,z){
 if(!grid||!Array.isArray(grid.heights)||grid.heights.length!==(grid.steps+1)**2)throw new Error('Missing measured Earth elevation grid');
 const n=grid.steps,half=grid.half;
 const u=clamp((x+half)/(2*half)*n,0,n),v=clamp((z+half)/(2*half)*n,0,n);
 const ix=Math.min(n-1,Math.floor(u)),iz=Math.min(n-1,Math.floor(v));
 const a=u-ix,b=v-iz,k=(i,j)=>grid.heights[j*(n+1)+i];
 return (1-b)*((1-a)*k(ix,iz)+a*k(ix+1,iz))+b*((1-a)*k(ix,iz+1)+a*k(ix+1,iz+1));
}
export function sceneElevation(grid,x,z){return 2+(sampleElevation(grid,x,z)-grid.centerAltitude)/METRES_PER_UNIT}
export function validateEarthGrid(grid){return !!grid&&grid.source==='mapterhorn-dem'&&grid.steps===GRID_STEPS&&grid.half===PATCH_HALF_UNITS&&Array.isArray(grid.heights)&&grid.heights.length===(GRID_STEPS+1)**2&&grid.heights.every(h=>Number.isFinite(h)&&h>=-12000&&h<=9000)&&Number.isFinite(grid.centerAltitude)}
/* Image decoder is injectable so tile math can be tested without network or canvas. */
export async function fetchEarthGrid(anchor,{zoom=12,loadTile=loadTileImage}={}){
 if(!Number.isFinite(anchor?.lat)||!Number.isFinite(anchor?.lon)||Math.abs(anchor.lat)>84.95||Math.abs(anchor.lon)>180)throw new Error('Choose a location between 85°N and 85°S');
 const loaded=new Map(), steps=GRID_STEPS, half=PATCH_HALF_UNITS, heights=[];
 async function tileAt(tx,ty){
  const n=2**zoom,x=((tx%n)+n)%n,key=`${zoom}/${x}/${ty}`;
  if(ty<0||ty>=n)throw new Error('Elevation data outside coverage');
  if(!loaded.has(key))loaded.set(key,loadTile(zoom,x,ty));
  return loaded.get(key);
 }
 // Adjacent elevations are interpolated across tile boundaries (no synthetic fill).
 async function readPixel(px,py){
  const tx=Math.floor(px/512),ty=Math.floor(py/512);
  const tile=await tileAt(tx,ty),i=Math.floor(px-tx*512),j=Math.floor(py-ty*512);
  const off=(j*512+i)*4;
  if(!tile||tile.length!==512*512*4)throw new Error('Invalid terrain tile');
  return terrariumHeight(tile[off],tile[off+1],tile[off+2]);
 }
 async function value(east,north){
  const {lat,lon}=nearbyLatLon(anchor,east,north),t=lonLatToTile(lon,lat,zoom),px=t.x*512,py=t.y*512;
  const i=Math.floor(px),j=Math.floor(py),u=px-i,v=py-j;
  const [a,b,c,d]=await Promise.all([readPixel(i,j),readPixel(i+1,j),readPixel(i,j+1),readPixel(i+1,j+1)]);
  return (1-v)*((1-u)*a+u*b)+v*((1-u)*c+u*d);
 }
 // Keep a bounded tile cache; the whole patch needs only a handful of z12 tiles.
 // Chunk promises to avoid issuing all 11k point requests at once.
 for(let j=0;j<=steps;j++){
  const row=[];
  for(let i=0;i<=steps;i++)row.push(value((-half+i*2*half/steps)*10,(-half+j*2*half/steps)*10));
  heights.push(...await Promise.all(row));
 }
 const centerAltitude=heights[(steps/2)*(steps+1)+(steps/2)];
 const grid={source:'mapterhorn-dem',zoom,anchor:{lat:anchor.lat,lon:anchor.lon},half,steps,centerAltitude,heights};
 if(!validateEarthGrid(grid))throw new Error('Elevation tiles are incomplete');
 return grid;
}
export async function loadTileImage(z,x,y){
 const url=`https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
 const response=await fetch(url,{mode:'cors'});
 if(!response.ok)throw new Error(`Elevation tiles unavailable (${response.status})`);
 const bmp=await createImageBitmap(await response.blob());
 if(bmp.width!==512||bmp.height!==512){bmp.close();throw new Error('Unexpected elevation tile dimensions')}
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0);bmp.close();
 return ctx.getImageData(0,0,512,512).data;
}
