import assert from 'node:assert/strict';
import {generateCity,chooseSite,citySpec,terrainHeight,LEVELS,STAGES} from './planner.mjs';
const profiles=['mixed','agricultural','industrial','resort','spa','datacenter','metropolis'];
const geographies=['island','peninsula','coast','mainland','archipelago','valley','mountains'];
let count=0;
for(const profile of profiles)for(const level of Object.keys(LEVELS)){
  const cfg=citySpec({seed:'ODYSSEY-7',profile,level,geography:'mainland',budget:300,teams:10});
  cfg.site=chooseSite([0,0],cfg);
  const plan=generateCity(cfg),replay=generateCity(cfg);
  assert.equal(JSON.stringify(plan.tasks),JSON.stringify(replay.tasks),'deterministic build queue');
  assert.equal(plan.gridSize,LEVELS[level]);
  assert.ok(plan.tasks.length>10);
  assert.equal(new Set(plan.tasks.map(t=>t.id)).size,plan.tasks.length);
  assert.ok(plan.stats.estimatedCost<=cfg.budget);
  assert.ok(plan.tasks.every(t=>STAGES.some(s=>s[0]===t.stage)));
  count++;
}
for(const geo of geographies){const c=citySpec({geography:geo,seed:'7'});for(const [x,z] of [[0,0],[45,-12],[-35,30]]){assert.ok(Number.isFinite(terrainHeight(x,z,c)))}count++}
for(const budget of [.1,1,2,5,10,100]){
  const p=generateCity(citySpec({budget,profile:'datacenter',seed:'s',level:'super'}));
  assert.ok(p.stats.estimatedCost<=budget+0.000001);
  assert.ok(p.stats.tasks>0);count++;
}
console.log(`PASS — ${count} terrain/planner/budget test cases`);
