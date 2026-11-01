import {occupiedByBuilding} from './earth-buildings.mjs';
import {sceneElevation,sampleElevation,validateEarthGrid} from './earth-terrain.mjs';
/* PLANET / SETTLEMENT procedural planning model. Browser-free and testable in Node. */
export const STAGES = [
  ['survey','Survey + staking'], ['roads','Road network'], ['paths','Paths + transit'],
  ['utilities','Utilities + energy'], ['foundation','Building foundations'],
  ['structure','Building shells'], ['facade','Doors + glazing'],
  ['roof','Roof + completion'], ['nature','Parks + ecology']
];
export const PROFILES = {
  mixed: {name:'Balanced settlement', hue:'#8ece9c'},
  agricultural:{name:'Agricultural village',hue:'#d7cf87'},
  industrial:{name:'Industrial hub',hue:'#f3a56c'},
  resort:{name:'Holiday / leisure town',hue:'#78dacf'},
  spa:{name:'Spa + wellness town',hue:'#b9b8ff'},
  datacenter:{name:'Data + power city',hue:'#76aaf7'},
  metropolis:{name:'High-density metropolis',hue:'#c48ef0'}
};
export const LEVELS={basic:5,simple:7,average:9,advanced:11,super:13};
export const TYPES = {
  survey:['Survey beacon','#8ce6ef','survey'],
  road:['Paved road','#566575','roads'],
  arterial:['Arterial road','#677a88','roads'],
  path:['Pedestrian path','#bfa98b','paths'],
  rail:['Rail segment','#7d9aa4','paths'],
  power:['Power generation','#f4be70','utilities'],
  grid:['Grid distribution','#f6d69d','utilities'],
  water:['Potable water connection','#6eb9df','utilities'],
  wastewater:['Wastewater connection','#78b1c8','utilities'],
  drain:['Stormwater outfall (indicative)','#76abb1','utilities'],
  home:['Small home','#d6af8b','building'],
  cottage:['Cottage','#c4a274','building'],
  apartments:['Apartment block','#abbbc4','building'],
  tower:['High-rise tower','#a4b9d0','building'],
  data:['Data centre','#8db7e8','building'],
  factory:['Factory','#cf9e80','building'],
  farm:['Agricultural building','#b9ae77','building'],
  hotel:['Hotel','#e7bc93','building'],
  spa:['Spa complex','#9cc9c3','building'],
  mall:['Shopping centre','#d8b7bd','building'],
  stadium:['Stadium','#bfc8ce','building'],
  airport:['Airport terminal','#bac2cf','building'],
  station:['Rail station','#a9c2c2','building'],
  workers:['Worker housing','#e1b49e','building'],
  temporary:['Temporary estate','#b4a895','building'],
  civic:['Civic facility','#c9c3ae','building'],
  park:['Park / lawn','#71bc72','nature'],
  forest:['Protected woodland','#438e58','nature'],
  pond:['Pond / lake','#66b6c8','nature']
};
export const hash=(s)=>{let h=2166136261;for(const c of String(s)){h=Math.imul(h^c.charCodeAt(0),16777619)}return h>>>0};
export function mulberry32(seed){let a=seed>>>0;return ()=>{a+=0x6d2b79f5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
function h2(x,z,seed){let n=Math.imul(x,374761393)+Math.imul(z,668265263)+Math.imul(seed,1013904223);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295}
const smooth=t=>t*t*(3-2*t);
function noise(x,z,s){let xi=Math.floor(x),zi=Math.floor(z),tx=smooth(x-xi),tz=smooth(z-zi);let a=h2(xi,zi,s),b=h2(xi+1,zi,s),c=h2(xi,zi+1,s),d=h2(xi+1,zi+1,s);return (a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz}
// One immutable planetary elevation field powers both the globe and every local tile.
// Coordinates use the same axes as THREE.SphereGeometry: x=cos(lat)cos(lon),
// y=sin(lat), z=cos(lat)sin(lon). All places on a seed share one coastline.
export const PLANET_PATCH_SCALE = 10 / 6371000; // one scene unit = 10m; 156 units ≈ 1.56km
function h3(x,y,z,s){
 let n=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,1442695041)^Math.imul(s,1013904223);
 n=Math.imul(n^(n>>>13),1274126177);
 return ((n^(n>>>16))>>>0)/4294967295;
}
function noise3(x,y,z,s){
 const a=Math.floor(x),b=Math.floor(y),c=Math.floor(z);
 const u=smooth(x-a),v=smooth(y-b),w=smooth(z-c);
 const mix=(p,q,t)=>p+(q-p)*t;
 const layer=(k)=>mix(mix(h3(a,b,c+k,s),h3(a+1,b,c+k,s),u),mix(h3(a,b+1,c+k,s),h3(a+1,b+1,c+k,s),u),v);
 return mix(layer(0),layer(1),w);
}
export function planetNormalAt(lat,lon){
 const a=lat*Math.PI/180,b=lon*Math.PI/180;
 return [Math.cos(a)*Math.cos(b),Math.sin(a),Math.cos(a)*Math.sin(b)];
}
export function planetPatchPoint(anchor,x=0,z=0){
 const lat=Number(anchor?.lat)||0,lon=Number(anchor?.lon)||0;
 const n=planetNormalAt(lat,lon),a=lat*Math.PI/180,b=lon*Math.PI/180;
 const east=[-Math.sin(b),0,Math.cos(b)];
 const north=[-Math.sin(a)*Math.cos(b),Math.cos(a),-Math.sin(a)*Math.sin(b)];
 const u=x*PLANET_PATCH_SCALE,v=z*PLANET_PATCH_SCALE;
 // Great-circle exponential map: a local tangent plane projected onto the sphere.
 const r=Math.hypot(u,v);
 if(r===0)return n;
 const s=Math.sin(r)/r;
 return [n[0]*Math.cos(r)+s*(u*east[0]+v*north[0]),
         n[1]*Math.cos(r)+s*(u*east[1]+v*north[1]),
         n[2]*Math.cos(r)+s*(u*east[2]+v*north[2])];
}
export function planetElevation(x,y,z,seed){
 const s=hash(seed);
 // Stable 3D multiscale field (no seam at longitude +/-180 degrees).
 // Low frequencies describe continents; high frequencies shape bays and ranges.
 const broad=noise3(x*2.25+13,y*2.25+7,z*2.25-19,s);
 const medium=noise3(x*5.1-5,y*5.1+9,z*5.1+17,s+17);
 const detail=noise3(x*11.6+3,y*11.6-8,z*11.6+10,s+37);
 const fine=noise3(x*30-11,y*30+19,z*30+2,s+67);
 return (broad-.5)*.69+(medium-.5)*.33+(detail-.5)*.13+(fine-.5)*.045-.018;
}
// Globe elevation, detailed down to the district scale. This is procedural geology,
// NOT actual Earth DEM, and the same continuous function is evaluated everywhere.
export function planetSurfaceHeight(normal,seed){
 const [x,y,z]=normal,continental=planetElevation(x,y,z,seed);
 if(continental<=0)return .23+continental*50; // seabed below fixed sea level
 const s=hash(seed);
 const ridge=Math.pow(1-Math.abs(noise3(x*3800+7,y*3800-13,z*3800+11,s+91)*2-1),3);
 const watershed=(noise3(x*11500,y*11500,z*11500,s+107)-.5)*7.5;
 const hills=(noise3(x*41000+3,y*41000-7,z*41000-11,s+131)-.5)*2.9;
 const local=(noise3(x*175000-13,y*175000+5,z*175000+2,s+157)-.5)*.55;
 const mountain=continental>.065?ridge*Math.min(15,(continental-.065)*95):0;
 // Near the coast the relief gently declines toward sea level.
 const relief=Math.min(1,Math.max(0,continental*18));
 return .23+Math.max(.015,continental*125+relief*(watershed+hills+local+mountain));
}
export function terrainHeight(x,z,config){
 if(config?.geoSource==='earth-dem'){if(!config.dem)throw new Error('Real Earth elevations are required');return sceneElevation(config.dem,x,z)}
 return planetSurfaceHeight(planetPatchPoint(config.anchor,x,z),config.seed);
}
export const atLand=(x,z,c)=>terrainHeight(x,z,c)>.24;
export function terrainGrade(x,z,c,d=2.5){
 const E=terrainHeight(x+d,z,c),W=terrainHeight(x-d,z,c);
 const N=terrainHeight(x,z+d,c),S=terrainHeight(x,z-d,c);
 return Math.hypot((E-W)/(2*d),(N-S)/(2*d));
}
export function slopeAt(x,z,c,d=2.1){
 const h=[terrainHeight(x-d,z-d,c),terrainHeight(x+d,z-d,c),terrainHeight(x-d,z+d,c),terrainHeight(x+d,z+d,c)];
 return Math.max(...h)-Math.min(...h);
}
// Screening, not certification: no subsurface soil, drainage catchments, measured
// flood maps, utilities operator data, building codes or surveyed elevations.
export function assessTerrain(x,z,c){
 const elevation=terrainHeight(x,z,c),grade=terrainGrade(x,z,c);
 if(c?.geoSource==='earth-dem'){
  const alt=sampleElevation(c.dem,x,z);
  const nearby=[[9,0],[-9,0],[0,9],[0,-9]].map(([dx,dz])=>sampleElevation(c.dem,x+dx,z+dz));
  const water=alt<=.25,coast=nearby.some(v=>v<=.25);
  // Only screen visible height/grade; DEM alone is not a flood model.
  const flood=false,steep=grade>.28;
  const occupied=occupiedByBuilding(x,z,c.existingBuildings);
  const viable=!water&&!occupied&&grade<=.16;
  return {elevation,altitudeMetres:alt,grade,water,flood,steep,occupied,viable,roadViable:!water&&!occupied&&grade<=.14,coast};
 }
 const coast= [[9,0],[-9,0],[0,9],[0,-9]].some(([dx,dz])=>terrainHeight(x+dx,z+dz,c)<=.23);
 const water=elevation<=.23;
 const flood= !water && (elevation<1.15 || coast && elevation<1.9);
 const steep=grade>.28;
 const viable=!water&&!flood&&grade<=.16&&elevation>1.1;
 const roadViable=!water&&!flood&&grade<=.14;
 return {elevation,grade,water,flood,steep,viable,roadViable,coast};
}
export function chooseSite(request,c){
 const sx=Number(request?.[0])||0,sz=Number(request?.[1])||0;
 let best=null,score=-Infinity;
 for(let r=0;r<=65;r+=5){
  const steps=Math.max(12,Math.round(r*1.5));
  for(let t=0;t<steps;t++){
   const angle=t/steps*Math.PI*2;
   const x=Math.max(-70,Math.min(70,sx+Math.cos(angle)*r));
   const z=Math.max(-70,Math.min(70,sz+Math.sin(angle)*r));
   const a=assessTerrain(x,z,c);
   if(!a.viable||!a.roadViable)continue;
   const s= -a.grade*25-r*.085-(a.coast?1:0);
   if(s>score){score=s;best=[Math.round(x*2)/2,Math.round(z*2)/2]}
  }
 }
 return best; // null means no suitable site exists in this patch
}
export function citySpec({seed='42',geography='mainland',anchor={lat:0,lon:0},profile='mixed',level='average',budget=60,teams=8,brief='',site,geoSource,dem,existingBuildings}={}){
 const c={seed:String(seed),geography,anchor,profile:PROFILES[profile]?profile:'mixed',level:LEVELS[level]?level:'average',budget:Math.max(.1,Number(budget)||60),teams:Math.min(22,Math.max(2,Math.round(Number(teams)||8))),brief:String(brief),site:site||[0,0]};
 if(geoSource==='earth-dem'){if(!validateEarthGrid(dem))throw new Error('Real Earth elevation tiles missing');c.geoSource=geoSource;c.dem=dem;if(existingBuildings?.source==='openstreetmap'&&Array.isArray(existingBuildings.buildings))c.existingBuildings=existingBuildings}
 return c;
}
const money=(v)=>Math.round(v*1000)/1000;
function styleFromPrompt(s,profile){const p=s.toLowerCase();if(/farm|agric|rolni/.test(p))return'agricultural';if(/resort|holiday|hotel|touris|vegas|wakac/.test(p))return'resort';if(/industrial|factory|fabryk/.test(p))return'industrial';if(/data cent|datacentre|server|gpu/.test(p))return'datacenter';if(/tower|skyscraper|dense|metro|wieżow/.test(p))return'metropolis';if(/spa|wellness/.test(p))return'spa';return profile}
// Route construction is deliberately constrained to a connected road network.
// This is a concept feasibility model; it never claims verified utility capacity.
export function generateCity(inConfig){
 const c=citySpec(inConfig),R=mulberry32(hash(c.seed+'|'+c.profile+'|'+c.brief+'|'+JSON.stringify(c.site)));
 c.profile=styleFromPrompt(c.brief,c.profile);
 const N=LEVELS[c.level],half=Math.floor(N/2),cell=3.75;
 const [sx,sz]=c.site||[0,0],grid=new Map(),key=(i,j)=>`${i},${j}`;
 const tasks=[],landuse=[],packages=[];let serial=0,uid=0;
 const add=(type,stage,x,z,meta={},cost=.05)=>({id:'T'+String(++serial).padStart(4,'0'),type,stage,x,z,cost:money(cost),meta,status:'queued'});
 const pack=(priority,kind,items)=>packages.push({key:'G'+ ++uid,priority,kind,items,cost:money(items.reduce((s,t)=>s+t.cost,0))});
 const neighbours=g=>[[1,0],[-1,0],[0,1],[0,-1]].map(([a,b])=>grid.get(key(g.i+a,g.j+b))).filter(Boolean);
 for(let i=-half;i<=half;i++)for(let j=-half;j<=half;j++){
  const x=sx+i*cell,z=sz+j*cell,a=assessTerrain(x,z,c);
  grid.set(key(i,j),{i,j,x,z,y:a.elevation,grade:a.grade,roadViable:a.roadViable,buildable:a.viable,usage:a.viable?'unassigned':'protected',reason:a.water?'water':a.occupied?'existing building':a.flood?'flood':a.steep?'slope':'unsuitable'});
 }
 const center=[...grid.values()].filter(g=>g.roadViable).sort((a,b)=>Math.hypot(a.i,a.j)-Math.hypot(b.i,b.j))[0];
 const findings=[];const data={water:[...grid.values()].filter(g=>g.reason==='water').length,
  flood:[...grid.values()].filter(g=>g.reason==='flood').length,
  slope:[...grid.values()].filter(g=>g.reason==='slope').length};
 const roads=new Set();
 // Dijkstra: a proposed street may only traverse suitable ground and must connect
 // to a common node. Sharp grades are penalised rather than ignored.
 function route(start,goal){
  const dist=new Map([[key(start.i,start.j),0]]),prev=new Map(),queue=[start],seen=new Set();
  while(queue.length){
   queue.sort((a,b)=>(dist.get(key(a.i,a.j))??Infinity)-(dist.get(key(b.i,b.j))??Infinity));
   const g=queue.shift(),k=key(g.i,g.j);if(seen.has(k))continue;seen.add(k);
   if(k===key(goal.i,goal.j)){
    const path=[];let walk=k;while(walk){path.push(grid.get(walk));walk=prev.get(walk)}
    return path.reverse();
   }
   for(const n of neighbours(g)){
    const nk=key(n.i,n.j);if(!n.roadViable||seen.has(nk))continue;
    const grade=Math.abs(n.y-g.y)/cell;
    if(grade>.14)continue; // no impossible street-gradient connections
    const nd=dist.get(k)+1+grade*12+n.grade*3;
    if(nd<(dist.get(nk)??Infinity)){dist.set(nk,nd);prev.set(nk,k);queue.push(n)}
   }
  }
  return null;
 }
 if(center){
  const destinations=[...grid.values()].filter(g=>g.roadViable)
   .sort((a,b)=>Math.hypot(b.i,b.j)-Math.hypot(a.i,a.j));
  roads.add(key(center.i,center.j));
  // Three to four different directions, only if physically reachable.
  const quadrants=new Set();
  for(const target of destinations){
   const quadrant=Math.abs(target.i)>=Math.abs(target.j)?(target.i<0?'W':'E'):(target.j<0?'S':'N');
   if(quadrants.has(quadrant))continue;
   const path=route(center,target);
   if(!path||path.length<2)continue;
   quadrants.add(quadrant);for(const g of path)roads.add(key(g.i,g.j));
   if(quadrants.size>=4)break;
  }
 }
 const connected=roads.size>=3;
 if(!center||!connected)findings.push('No connected, low-gradient road corridor: settlement generation blocked. Select another location.');
 if(data.water)findings.push(`${data.water} water-covered plots excluded.`);
 if(data.flood)findings.push(`${data.flood} coastal/flood-exposed plots excluded; flood modelling still required.`);
 if(data.slope)findings.push(`${data.slope} steep plots excluded; geotechnical survey still required.`);
 if(connected){
  pack(0,'survey',[add('survey','survey',center.x,center.z,{name:'Survey benchmark — unverified coordinates'},.04)]);
  const roadItems=[];
  for(const g of grid.values())if(roads.has(key(g.i,g.j))){
   const nearby=neighbours(g).filter(n=>roads.has(key(n.i,n.j)));
   const axisX=nearby.some(n=>n.i!==g.i),axisZ=nearby.some(n=>n.j!==g.j);
   const axis=axisX&&axisZ?'junction':axisX?'x':'z';
   g.usage='road';
   roadItems.push(add(axis==='junction'?'arterial':'road','roads',g.x,g.z,{axis,width:axis==='junction'?1.25:.75,cell,grade:g.grade},.045+g.grade*.035));
  }
  pack(1,'roads',roadItems); // all-or-nothing network funding
  // Parcels need direct access to an actual planned road.
  const spots=[...grid.values()].filter(g=>g.buildable&&!roads.has(key(g.i,g.j))&&neighbours(g).some(n=>roads.has(key(n.i,n.j))));
  spots.sort((a,b)=>Math.hypot(a.i,a.j)-Math.hypot(b.i,b.j));
  const needs={};
  if(c.profile==='industrial')Object.assign(needs,{factory:2,workers:2});
  if(c.profile==='datacenter')Object.assign(needs,{data:2,workers:2});
  if(c.profile==='agricultural')Object.assign(needs,{farm:3});
  if(c.profile==='resort')Object.assign(needs,{hotel:2});
  if(c.profile==='spa')Object.assign(needs,{spa:2,hotel:1});
  if(c.profile==='metropolis')Object.assign(needs,{apartments:3,civic:1});
  if(N>=9)Object.assign(needs,{civic:Math.max(1,needs.civic||0)});
  // Airports, stadiums, towers and railways require independent regional
  // transport, capacity and land studies; they are not auto-sited on a 1.56km tile.
  const queue=Object.entries(needs).flatMap(([t,n])=>Array(n).fill(t));
  const buildingSpecs={home:[1,0.22],cottage:[1,.19],apartments:[3,1.4],data:[2,2.4],factory:[1,1.7],farm:[1,.31],hotel:[3,1.9],spa:[1,.78],workers:[2,.46],civic:[2,.95]};
  const parkRatio=c.profile==='spa'||c.profile==='resort'?.27:c.profile==='agricultural'?.23:.2;
  for(const g of spots){
   const adjacent=neighbours(g).find(n=>roads.has(key(n.i,n.j)));
   const dx=Math.sign(adjacent.x-g.x),dz=Math.sign(adjacent.z-g.z);
   pack(2,'paths',[add('path','paths',g.x+dx*cell*.40,g.z+dz*cell*.40,{rotation:dx?Math.PI/2:0},.018)]);
   let type=queue.shift();
   if(!type){const roll=R();type=roll<parkRatio?(R()<.25?'forest':'park'):
     c.profile==='agricultural'&&R()<.4?'farm':
     c.profile==='metropolis'&&R()<.6?'apartments':R()<.25?'cottage':'home'}
   g.usage=type;
   if(type==='park'||type==='forest'){
    pack(9,'nature',[add(type,'nature',g.x,g.z,{size:cell*.8,trees:2+Math.floor(R()*5)},.045)]);continue;
   }
   const [floors,cost]=buildingSpecs[type]||[1,.25];
   const footprint=cell*(type==='factory'||type==='data'?.69:type==='apartments'||type==='hotel'?.58:.37);
   const meta={kind:type,floors,width:footprint*10,depth:footprint*8.3,tone:Math.floor(R()*4),orientation:dx?Math.PI/2:0,plot:[g.i,g.j],accessRoad:[adjacent.i,adjacent.j],grade:g.grade};
   pack(5,'building',[
    add(type,'foundation',g.x,g.z,{...meta,part:'foundation'},cost*.19),
    add(type,'structure',g.x,g.z,{...meta,part:'structure'},cost*.55),
    add(type,'facade',g.x,g.z,{...meta,part:'facade'},cost*.17),
    add(type,'roof',g.x,g.z,{...meta,part:'roof'},cost*.09)
   ]);
  }
  if(spots.length){
   const edge=[...grid.values()].filter(g=>roads.has(key(g.i,g.j))).sort((a,b)=>Math.hypot(b.i,b.j)-Math.hypot(a.i,a.j));
   const top=edge[0],low=[...edge].sort((a,b)=>a.y-b.y)[0];
   // Proposed connections and drainage only: utility providers / discharge
   // authority have not granted capacity, permits or easements.
   const utilities=[
    add('grid','utilities',top.x,top.z,{connection:'unverified external electrical feed'},.36),
    add('water','utilities',top.x,top.z,{connection:'unverified potable water source'},.31),
    add('wastewater','utilities',low.x,low.z,{connection:'unverified treatment/discharge'},.39)];
   if(low.y>1.15)utilities.push(add('drain','utilities',low.x,low.z,{connection:'stormwater strategy requires catchment study'},.22));
   pack(3,'utilities',utilities); // all-or-nothing basic service allowances
  }
  findings.push('Road access is topologically connected, but right-of-way and offsite links are unverified.');
  findings.push('Electrical, drinking-water, sewage and drainage capacity are unverified; do not infer service availability.');
  if(!spots.length)findings.push('No parcels with direct road access; no buildings allocated.');
 }
 // The budget gates whole packages, without pretending these are market prices.
 packages.sort((a,b)=>a.priority-b.priority);
 let spend=0,deferred=0;const fundedBuildings=new Set();
 for(const pkg of packages){
  const roadReady=tasks.some(t=>t.stage==='roads');
  const servicesReady=['grid','water','wastewater'].every(type=>tasks.some(t=>t.type===type));
  if((pkg.kind==='building'||pkg.kind==='paths'||pkg.kind==='nature')&&(!roadReady||(pkg.kind==='building'&&!servicesReady))){
   deferred+=pkg.items.length;
   if(pkg.kind==='building'){const g=grid.get(key(...pkg.items[0].meta.plot));if(g)g.usage='unfunded'}
   continue;
  }
  if(spend+pkg.cost<=c.budget+1e-8){
   spend+=pkg.cost;for(const t of pkg.items){t.packageId=pkg.key;tasks.push(t)}
   if(pkg.kind==='building')fundedBuildings.add(pkg.key);
  }else{
   deferred+=pkg.items.length;
   if(pkg.kind==='building'){
    const g=grid.get(key(...pkg.items[0].meta.plot));if(g)g.usage='unfunded';
   }
  }
 }
 const roadTasks=tasks.filter(t=>t.stage==='roads');
 if(connected&&roadTasks.length!==roads.size)findings.push('Road budget insufficient: network is incomplete, so construction must not be treated as accessible.');
 const utilityTypes=new Set(tasks.filter(t=>t.stage==='utilities').map(t=>t.type));
 if(connected&&roads.size&&['grid','water','wastewater'].some(type=>!utilityTypes.has(type)))
  findings.push('Utility budget insufficient: building occupation cannot proceed.');
 const types={};for(const t of tasks)types[t.type]=(types[t.type]||0)+1;
 const usable=connected&&roads.size===roadTasks.length&&(!fundedBuildings.size||['grid','water','wastewater'].every(type=>utilityTypes.has(type)));
 return {schema:'planet.city.plan.v2',planner:'terrain-constrained-screening',config:c,gridSize:N,cellSize:cell,cityCentre:[sx,sz],
  tasks,landuse:[...grid.values()].map(({i,j,x,z,y,usage,buildable,grade,reason})=>({i,j,x,z,y,usage,buildable,grade,reason})),
  feasibility:{status:!connected?'blocked':usable?'screened':'incomplete',findings,excluded:data,roadConnected:connected,buildableParcels:[...grid.values()].filter(g=>g.buildable).length,roadAccessParcels:[...grid.values()].filter(g=>g.buildable&&!roads.has(key(g.i,g.j))&&neighbours(g).some(n=>roads.has(key(n.i,n.j)))).length,limitations:c.geoSource==='earth-dem'?'Measured DEM for topography only; no verified flood, soils, services, parcels, road access or legal permission.':'Procedural terrain and indicative unit costs only. Not measured DEM, hydrology, GIS, engineering or statutory approval.'},
  stats:{tasks:tasks.length,buildings:fundedBuildings.size,roads:roadTasks.length,parkLots:tasks.filter(t=>t.stage==='nature').length,protectedLots:[...grid.values()].filter(g=>g.usage==='protected').length,budget:c.budget,estimatedCost:money(spend),deferred,types},
  createdBy:c.geoSource==='earth-dem'?'PLANET LAB measured elevation / conceptual infrastructure; no verified utilities or parcels':'PLANET LAB feasibility-screened procedural planner; no real GIS or verified utility data'};
}
export const TEAM_ROLES=[
 ['ROADS','Road crew','#f2b374',['roads']],
 ['BUILD','Builders','#a3d4ff',['foundation','structure','facade','roof']],
 ['MAKER','Fabricators','#cbb2fa',['structure','facade','roof']],
 ['GREEN','Ecology crew','#8dd58b',['nature']],
 ['POWER','Utilities','#f4d48a',['utilities']],
 ['PATH','Transport crew','#86d8d8',['paths']],
 ['SURVEY','Surveyors','#d4e9f5',['survey']],
 ['BUILD','Builders','#a3d4ff',['foundation','structure','facade','roof']],
 ['ROADS','Road crew','#f2b374',['roads']],
 ['BUILD','Builders','#a3d4ff',['foundation','structure','facade','roof']],
 ['PATH','Transport crew','#86d8d8',['paths']],
 ['GREEN','Ecology crew','#8dd58b',['nature']],
 ['POWER','Utilities','#f4d48a',['utilities']],
 ['BUILD','Builders','#a3d4ff',['foundation','structure','facade','roof']],
 ['MAKER','Fabricators','#cbb2fa',['structure','facade','roof']],
 ['ROADS','Road crew','#f2b374',['roads']],
 ['BUILD','Builders','#a3d4ff',['foundation','structure','facade','roof']],
 ['GREEN','Ecology crew','#8dd58b',['nature']],
 ['PATH','Transport crew','#86d8d8',['paths']],
 ['BUILD','Builders','#a3d4ff',['foundation','structure','facade','roof']],
 ['POWER','Utilities','#f4d48a',['utilities']],
 ['SURVEY','Surveyors','#d4e9f5',['survey']]
];
