/* Building Studio rendering regression: no browser or paid AI key required. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('./studio.mjs',import.meta.url),'utf8');
const start=source.indexOf('function putBuilding('), end=source.indexOf('function enterBuilding()',start);
assert.ok(start>=0&&end>start,'putBuilding implementation found');
const created=[],removed=[],saved=[];
let surface=2;
class Group{
  children=[];
  scale={setScalar:v=>{this.size=v}};
  position={set:(...xyz)=>{this.coords=xyz}};
  add(object){this.children.push(object);created.push(object)}
  remove(object){this.children=this.children.filter(v=>v!==object);removed.push(object)}
  traverse(fn){for(const child of this.children)fn(child)}
}
const world={height:()=>surface,studioGroup:new Group(),scene:{},mode:'planet',
  setMode(mode){this.mode=mode},camera:{position:{set(...v){saved.push(v)}}},
  controls:{target:{set(...v){saved.push(v)}},update(){}}};
const app={site:[1,2],world,updateMode(){},plan:{}};
const ctx={THREE:{Group},sim:()=>app,box:(group)=>group.add({geometry:{dispose(){}},material:{dispose(){}}}),
  roof:()=>{},showResult:()=>{},notice:()=>{},Number,Math};
vm.runInNewContext(`let buildingGroup=null,currentBuilding=null;${source.slice(start,end)}\n`+
  `putBuilding({name:'Lakeside house',width:10,depth:8,floors:2,floorHeight:3,style:'modern',roof:'gable',windowsPerSide:3,interiorRooms:3,material:'wood and glass'});`,ctx);
assert.equal(world.studioGroup.children.length,1,'model attached to visible local-world group');
assert.equal(world.studioGroup.children[0].size,.1,'metre-to-scene scale applied');
assert.equal(world.mode,'region','building generation navigates to local terrain');
assert.ok(saved.length>=2,'camera focused on the result');
assert.equal(app.plan.studioBuildings[0].interiorRooms,3,'model data preserved for saving');
const oldGroup=world.studioGroup.children[0];
surface=0;
assert.throws(()=>vm.runInNewContext(`putBuilding({width:10,depth:8,floors:2})`,ctx),/shoreline/);
assert.equal(world.studioGroup.children[0],oldGroup,'invalid site does not destroy previous preview');
console.log('Building Studio scene attachment, camera, scale, saving and shoreline checks passed');
