import assert from 'node:assert/strict';
import {nearbyLatLon,lonLatToTile,terrariumHeight,fetchEarthGrid,sampleElevation,sceneElevation,validateEarthGrid} from './earth-terrain.mjs';
import {citySpec,terrainHeight,assessTerrain,generateCity} from './planner.mjs';
assert.equal(terrariumHeight(128,0,0),0);
assert.equal(terrariumHeight(128,10,0),10);
assert.ok(Math.abs(nearbyLatLon({lat:51.5,lon:0},1000,0).lon-0.0144)<0.002);
assert.ok(Math.abs(nearbyLatLon({lat:0,lon:0},0,1000).lat-0.00898)<0.0002);
const t=lonLatToTile(0,0,12);assert.equal(t.x,2048);assert.equal(t.y,2048);
const tile=new Uint8ClampedArray(512*512*4);for(let i=0;i<tile.length;i+=4){tile[i]=128;tile[i+1]=50;tile[i+2]=0;tile[i+3]=255;}
let calls=0;const dem=await fetchEarthGrid({lat:51.5074,lon:-0.1278},{loadTile:async()=>{calls++;return tile}});
assert.ok(calls<=8,`expected bounded tile requests, got ${calls}`);
assert.ok(validateEarthGrid(dem));assert.ok(Math.abs(sampleElevation(dem,0,0)-50)<.0001);
assert.ok(Math.abs(sceneElevation(dem,0,0)-2)<.0001);
const c=citySpec({seed:'test',anchor:{lat:51.5074,lon:-0.1278},geoSource:'earth-dem',dem});
assert.equal(terrainHeight(0,0,c),2);
assert.equal(assessTerrain(0,0,c).water,false);
assert.equal(generateCity(c).config.geoSource,'earth-dem');
assert.throws(()=>citySpec({geoSource:'earth-dem',dem:{}}),/elevation/);
console.log('PASS — WGS84, bounded DEM tiles, measured terrain planner, no fictitious fallback');
