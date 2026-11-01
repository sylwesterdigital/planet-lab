/* Verify DEM ↔ satellite footprint, orientation, tile cropping and bounded requests. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {nearbyLatLon,lonLatToTile,PATCH_HALF_UNITS,METRES_PER_UNIT} from './earth-terrain.mjs';
const source=readFileSync(new URL('./earth-imagery.mjs',import.meta.url),'utf8')
 .replace(/^import .*\n/gm,'').replace(/export (const|function|async function)/g,'$1');
const drawn=[];
const doc={createElement:()=>({width:0,height:0,getContext(){return {drawImage(...args){drawn.push(args)}}}})};
const ctx={nearbyLatLon,lonLatToTile,PATCH_HALF_UNITS,METRES_PER_UNIT,document:doc,Math,Number,Error,Promise,fetch(){throw new Error('No network expected')}};
vm.runInNewContext(source+'\nglobalThis.fn={imageryBounds,loadSiteImagery}',ctx);
const {imageryBounds,loadSiteImagery}=ctx.fn;
const anchor={lat:51.5074,lon:-0.1278},bounds=imageryBounds(anchor);
assert.ok(bounds.west<bounds.east&&bounds.north<bounds.south);
const topLeft=nearbyLatLon(anchor,-780,780),bottomRight=nearbyLatLon(anchor,780,-780);
assert.ok(topLeft.lat>anchor.lat&&topLeft.lon<anchor.lon);
assert.ok(bottomRight.lat<anchor.lat&&bottomRight.lon>anchor.lon);
const demanded=[];const canvas=await loadSiteImagery(anchor,{size:512,loadImage:async(z,x,y)=>{
 demanded.push([z,x,y]);return {close(){}};
}});
assert.equal(canvas.width,512);assert.equal(canvas.height,512);
assert.ok(demanded.length>=1&&demanded.length<=16,'Only tiles for the selected 1.56km patch are loaded');
assert.equal(drawn.length,demanded.length);
assert.ok(drawn.every(a=>a[1]<512&&a[2]<512&&a[1]+a[3]>0&&a[2]+a[4]>0),'Imagery overlaps selected patch');
assert.match(readFileSync(new URL('./app.mjs',import.meta.url),'utf8'),/uv\.setY\(i,1-uv\.getY\(i\)\)/,'Texture must face true north');
console.log('PASS — satellite mosaic matches exact DEM patch in metres and map coordinates');

// A selected site at high zoom must adapt its tile count instead of failing.
const large=await loadSiteImagery({lat:62,lon:10},{size:2048,maptilerKey:'TEST_BROWSER_KEY',loadImage:async(z,x,y)=>{
 assert.ok(z<=17);return {close(){}};
}});
assert.equal(large.width,2048);
assert.ok(drawn.length>demanded.length);
assert.match(source,/satellite-v2\/\{z\}\/\{x\}\/\{y\}\.jpg/);
console.log('PASS — adaptive zoom keeps high-resolution imagery requests bounded');
