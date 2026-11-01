/* Model invariants: terrain continuity, constraint screening, connected road access,
 * deterministic packages, and no city on the sea. All tests run without a browser. */
import assert from 'node:assert/strict';
import {generateCity,chooseSite,citySpec,terrainHeight,planetElevation,planetNormalAt,
  planetPatchPoint,planetSurfaceHeight,assessTerrain,LEVELS,STAGES} from './planner.mjs';
let checks=0;
const cfg=citySpec({seed:'x',anchor:{lat:0,lon:0},budget:300});
for(const anchor of [{lat:0,lon:0},{lat:32.6,lon:-87.3},{lat:-61,lon:179.9},{lat:90,lon:0}]){
 const c=citySpec({...cfg,anchor});
 assert.ok(Math.abs(terrainHeight(0,0,c)-planetSurfaceHeight(planetNormalAt(anchor.lat,anchor.lon),c.seed))<1e-8);
 // Same sampled height irrespective of arbitrary old island/peninsula presets.
 for(const geography of ['island','peninsula','valley','mountains']){
   assert.equal(terrainHeight(22,-27,c),terrainHeight(22,-27,{...c,geography}));checks++;
 }
 // Coordinates across the opposite sides of the international longitude seam agree.
}
for(const lat of [-70,0,47]){
 const east=planetNormalAt(lat,180),west=planetNormalAt(lat,-180);
 assert.ok(Math.max(...east.map((v,i)=>Math.abs(v-west[i])))<1e-12);
 checks++;
}
for(const profile of ['mixed','agricultural','industrial','resort','spa','datacenter','metropolis']){
 for(const level of Object.keys(LEVELS)){
  const c=citySpec({seed:'x',anchor:{lat:0,lon:0},profile,level,budget:300,teams:10});
  c.site=chooseSite([0,0],c);
  assert.ok(c.site,'This fixed test anchor is land');
  const p=generateCity(c),repeat=generateCity(c);
  assert.equal(JSON.stringify(p),JSON.stringify(repeat),'All generation must be deterministic');
  assert.equal(p.schema,'planet.city.plan.v2');
  assert.equal(p.feasibility.status,'screened');
  assert.equal(p.gridSize,LEVELS[level]);
  assert.ok(p.stats.tasks>=10);
  assert.ok(p.stats.estimatedCost<=c.budget);
  assert.ok(p.tasks.every(t=>STAGES.some(s=>s[0]===t.stage)));
  assert.ok(p.feasibility.findings.some(t=>t.includes('unverified')));
  assert.ok(!p.tasks.some(t=>['airport','rail','stadium','tower'].includes(t.type)));
  assert.equal(new Set(p.tasks.map(t=>t.id)).size,p.tasks.length);
  const roads=p.landuse.filter(g=>g.usage==='road');
  assert.equal(roads.length,p.stats.roads,'All roads funded on this fixture');
  assert.ok(roads.length>0);
  const indexed=new Map(roads.map(g=>[`${g.i},${g.j}`,g]));
  const visited=new Set(),frontier=[roads[0]];
  while(frontier.length){
   const g=frontier.pop(),id=`${g.i},${g.j}`;
   if(visited.has(id))continue;visited.add(id);
   for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const n=indexed.get(`${g.i+di},${g.j+dj}`);if(n)frontier.push(n);
   }
  }
  assert.equal(visited.size,roads.length,'Roads must be a connected network');
  const parcels=new Map(p.landuse.map(g=>[`${g.i},${g.j}`,g]));
  for(const task of p.tasks.filter(t=>t.stage==='foundation')){
   const parcel=parcels.get(task.meta.plot.join(','));
   assert.ok(parcel?.buildable,'Building on flood/water/steep parcel');
   const road=parcels.get(task.meta.accessRoad.join(','));
   assert.equal(road?.usage,'road','Every building has a road connection');
   assert.equal(Math.abs(road.i-parcel.i)+Math.abs(road.j-parcel.j),1,'Direct adjacency');
  }
  checks++;
 }
}
const ocean=citySpec({seed:'ODYSSEY-7',anchor:{lat:0,lon:0},site:[0,0],budget:300});
assert.equal(chooseSite([0,0],ocean),null,'Ocean is not silently replaced with another island');
const empty=generateCity(ocean);
assert.equal(empty.feasibility.status,'blocked');
assert.equal(empty.stats.buildings,0);
assert.equal(empty.stats.roads,0);
checks++;
for(const budget of [.1,.5,1,2,3,10,100]){
 const c={...cfg,site:chooseSite([0,0],cfg),budget,level:'super'};
 const p=generateCity(c);
 assert.ok(p.stats.estimatedCost<=budget+.000001);
 if(p.stats.buildings>0){assert.equal(p.feasibility.status,'screened');
  for(const type of ['grid','water','wastewater'])assert.ok(p.tasks.some(t=>t.type===type));}
 if(p.stats.roads>0)assert.ok(p.tasks.some(t=>t.stage==='survey'));
 checks++;
}
console.log(`PASS — ${checks} planet/topography/access/budget/feasibility cases`);
