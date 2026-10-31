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
  water:['Water services','#6eb9df','utilities'],
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
export function terrainHeight(x,z,config){
 const seed=hash(`${config.seed}|${config.anchor?.lat||0}|${config.anchor?.lon||0}`);
 const geography=config.geography||'mainland';
 const n=(noise(x*.032,z*.032,seed)-.5)*8 + (noise(x*.1,z*.1,seed+23)-.5)*2.4;
 const radial=Math.hypot(x*.83,z*1.05)/70;
 let h=4+n;
 if(geography==='island')h=7+n-12*Math.pow(radial,1.7);
 if(geography==='peninsula')h=6+n-12*Math.max(0,(x+z*.28-4)/75)-2*Math.max(0,(-x+z*.4-40)/80);
 if(geography==='coast')h=5+n-10*Math.max(0,(z+18)/85);
 if(geography==='archipelago'){
  const peaks=[[0,0,11],[40,-23,8],[-34,28,9],[38,43,8]];
  h=-5+n*.4;
  for(const [px,pz,p] of peaks)h+=p*Math.exp(-((x-px)**2+(z-pz)**2)/1050);
 }
 if(geography==='mountains')h=3+n+14*Math.pow(Math.abs(noise(x*.018,z*.018,seed+47)-.5)*2,2);
 if(geography==='valley')h=1.8+n*.45+Math.pow(Math.abs(x)/24,1.7)*5;
 // Natural freshwater depression; not present in extreme mountain terrain.
 if(!['mountains','archipelago'].includes(geography)){
  let lakeX=30,lakeZ=-23;
  const r=((x-lakeX)/17)**2+((z-lakeZ)/12)**2;
  if(r<2.6)h-=9*Math.exp(-r*.95);
 }
 return h;
}
export const atLand=(x,z,c)=>terrainHeight(x,z,c)>.28;
export function slopeAt(x,z,c,d=2.1){const h=[terrainHeight(x-d,z-d,c),terrainHeight(x+d,z-d,c),terrainHeight(x-d,z+d,c),terrainHeight(x+d,z+d,c)];return Math.max(...h)-Math.min(...h)}
export function chooseSite(request,c){
 const sx=Number(request?.[0])||0,sz=Number(request?.[1])||0;let best=[0,0],score=-Infinity;
 for(let r=0;r<=55;r+=5){for(let t=0;t<Math.max(12,r*2);t++){
   let angle=t/Math.max(12,r*2)*Math.PI*2;
   const x=Math.max(-60,Math.min(60,sx+Math.cos(angle)*r));
   const z=Math.max(-60,Math.min(60,sz+Math.sin(angle)*r));
   const h=terrainHeight(x,z,c);if(h<1.0)continue;
   const slope=slopeAt(x,z,c,8);
   const s=h*.1-slope*1.45-r*.13;
   if(s>score){score=s;best=[Math.round(x*2)/2,Math.round(z*2)/2]}
 }}
 return best;
}
function planetHash3(x,y,z,seed){return h2(Math.round(x*193+y*67),Math.round(z*181+y*173),seed)}
export function planetElevation(x,y,z,seed){
 // Sample coherent 3D texture by combining 2D noise on different axes.
 const s=hash(seed);
 const n1=noise(x*2.2+y*.35,z*2.2+y*.21,s);
 const n2=noise(y*3.8+z*.3,x*3.8+z*.15,s+17);
 const n3=noise(z*7+x*.7,y*7+x*.2,s+39);
 return (n1-.51)*1.05+(n2-.5)*.5+(n3-.5)*.12+.07*Math.cos(y*6);
}
export function citySpec({seed='42',geography='mainland',anchor={lat:0,lon:0},profile='mixed',level='average',budget=60,teams=8,brief='',site}={}){
 return {seed:String(seed),geography,anchor,profile:PROFILES[profile]?profile:'mixed',level:LEVELS[level]?level:'average',budget:Math.max(.1,Number(budget)||60),teams:Math.min(22,Math.max(2,Math.round(Number(teams)||8))),brief:String(brief),site:site||[0,0]};
}
const money=(v)=>Math.round(v*1000)/1000;
function styleFromPrompt(s,profile){const p=s.toLowerCase();if(/farm|agric|rolni/.test(p))return'agricultural';if(/resort|holiday|hotel|touris|vegas|wakac/.test(p))return'resort';if(/industrial|factory|fabryk/.test(p))return'industrial';if(/data cent|datacentre|server|gpu/.test(p))return'datacenter';if(/tower|skyscraper|dense|metro|wieżow/.test(p))return'metropolis';if(/spa|wellness/.test(p))return'spa';return profile}
export function generateCity(inConfig){
 const c=citySpec(inConfig),R=mulberry32(hash(c.seed+'|'+c.profile+'|'+c.brief+'|'+c.geography+'|'+JSON.stringify(c.site)));
 c.profile=styleFromPrompt(c.brief,c.profile);
 const N=LEVELS[c.level],half=Math.floor(N/2),cell=3.75,[sx,sz]=c.site;
 const tasks=[],landuse=[],packages=[];let serial=0,uid=0;
 const add=(type,stage,x,z,meta={},cost=.05)=>({id:'T'+String(++serial).padStart(4,'0'),type,stage,x,z,cost:money(cost),meta,status:'queued'});
 const pack=(priority,kind,items)=>{packages.push({key:'G'+ ++uid,priority,kind,items,cost:money(items.reduce((s,t)=>s+t.cost,0))})};
 pack(0,'survey',[add('survey','survey',sx,sz,{name:'Set out settlement reference'},.02)]);
 const valid=(x,z,limit=2.9)=>atLand(x,z,c)&&terrainHeight(x,z,c)>1&&slopeAt(x,z,c,1.9)<limit;
 const grid=new Map(),key=(i,j)=>`${i},${j}`;
 for(let i=-half;i<=half;i++)for(let j=-half;j<=half;j++){
  const x=sx+i*cell,z=sz+j*cell,y=terrainHeight(x,z,c);
  const nearRoad=i===0||j===0||(N>=9&&(Math.abs(i)===3||Math.abs(j)===3))||(N>=13&&(Math.abs(i)===6||Math.abs(j)===6));
  const ok=valid(x,z);
  const protectedArea=!ok|| (Math.abs(x-30)<15&&Math.abs(z+23)<11&&y<2);
  const info={i,j,x,z,y,nearRoad,buildable:ok&&!protectedArea,usage:protectedArea?'protected':'unassigned'};
  grid.set(key(i,j),info);
 }
 for(const g of grid.values())if(g.nearRoad&&g.buildable){
  g.usage='road'; const wide=g.i===0||g.j===0;
  pack(1,'roads',[add(wide?'arterial':'road','roads',g.x,g.z,{width:wide?2.8:2.1,cell,axis:(g.i===0||Math.abs(g.i)===3||Math.abs(g.i)===6)?'z':'x'},wide?.055:.039)]);
 }
 // Access paths along streets; no clearance grading, only visual snap to sampled land.
 for(const g of grid.values())if(g.buildable&&!g.nearRoad && R()<.63){
  const neighbors=[[g.i+1,g.j],[g.i-1,g.j],[g.i,g.j+1],[g.i,g.j-1]].map(([i,j])=>grid.get(key(i,j)));
  const road=neighbors.find(n=>n?.usage==='road');
  if(road){const dx=Math.sign(road.x-g.x),dz=Math.sign(road.z-g.z);
   pack(2,'paths',[add('path','paths',g.x+dx*cell*.4,g.z+dz*cell*.4,{rotation:dx?Math.PI/2:0},.014)]);
  }
 }
 const townCentre = [sx,sz];
 const buildSpots=[...grid.values()].filter(g=>g.buildable&&!g.nearRoad).sort((a,b)=>Math.hypot(a.i,a.j)-Math.hypot(b.i,b.j));
 const parkRatio= c.profile==='spa'||c.profile==='resort'?.28:c.profile==='agricultural'?.23:c.profile==='industrial'||c.profile==='datacenter'?.12:.18;
 const requirements={};
 if(['datacenter','industrial'].includes(c.profile))Object.assign(requirements,{data:2,power:1,workers:2,temporary:1,factory:c.profile==='industrial'?2:0});
 if(c.profile==='metropolis')Object.assign(requirements,{tower:3,apartments:3,mall:1,station:1,stadium:1});
 if(c.profile==='agricultural')Object.assign(requirements,{farm:3,power:1});
 if(c.profile==='resort')Object.assign(requirements,{hotel:2,mall:1,stadium:1});
 if(c.profile==='spa')Object.assign(requirements,{spa:2,hotel:1,park:2});
 if(c.level==='advanced'||c.level==='super')Object.assign(requirements,{station:Math.max(1,requirements.station||0),mall:Math.max(1,requirements.mall||0),civic:1});
 if(c.level==='super')Object.assign(requirements,{airport:1,stadium:Math.max(1,requirements.stadium||0)});
 const requirementQueue=[];for(const [type,amount] of Object.entries(requirements))for(let k=0;k<amount;k++)requirementQueue.push(type);
 function chooseBuilding(g){
  if(requirementQueue.length){
   const d=Math.hypot(g.i,g.j);
   const preferEdge=new Set(['airport','stadium','power','factory','farm','data','temporary']);
   const idx=requirementQueue.findIndex(type=>preferEdge.has(type)?d>=half*.62:d<=Math.max(1.8,half*.68));
   if(idx>=0){const pick=requirementQueue.splice(idx,1)[0];return pick;}
  }
  const d=Math.hypot(g.i,g.j),roll=R();
  if(roll<parkRatio)return R()<.35?'forest':'park';
  if(c.profile==='metropolis')return d<half*.6?(R()<.72?'tower':'apartments'):(R()<.6?'apartments':'home');
  if(c.profile==='industrial')return roll>.73?'factory':roll>.57?'workers':'home';
  if(c.profile==='datacenter')return roll>.78?'data':roll>.65?'workers':'home';
  if(c.profile==='agricultural')return roll>.64?'farm':R()<.72?'cottage':'home';
  if(c.profile==='resort')return roll>.75?'hotel':'cottage';
  if(c.profile==='spa')return roll>.76?'spa':'cottage';
  return d<half*.5&&N>=9&&R()>.55?'apartments':R()<.22?'cottage':'home';
 }
 const buildingSpecs={
  home:[1,1.1],cottage:[1,.86],apartments:[3,2.3],tower:[10,6.2],data:[2,3.9],power:[1,2.3],factory:[1,2.5],farm:[1,.8],hotel:[4,3.0],spa:[1.4,1.9],mall:[2,3.3],stadium:[2,5.3],airport:[2,7.8],station:[1.2,1.1],workers:[2,1.3],temporary:[1,.45],civic:[2,1.2]
 };
 let countBuildings=0, greens=0;
 for(const g of buildSpots){
  let b=chooseBuilding(g);g.usage=b;
  if(['park','forest'].includes(b)){
   greens++;pack(9,'nature',[add(b,'nature',g.x,g.z,{size:cell*.85,trees:2+Math.floor(R()*5)},b==='forest'?.02:.022)]);continue;
  }
  const [floors,mult]=buildingSpecs[b]||[1,1];
  // First few downtown lots are preferentially allocated for required infrastructure.
  const tone=Math.floor(R()*4),orientation=R()>.5?0:Math.PI/2;
  const h= b==='tower'?Math.round(8+R()*15):b==='apartments'?3+Math.round(R()*3):Math.max(1,Math.round(floors+R()*.75));
  const footprint=cell*(b==='tower'?.76:b==='factory'||b==='data'?.84:.68);
  const meta={kind:b,floors:h,width:footprint,depth:footprint*(b==='stadium'?1.12:.84),tone,orientation,plot:[g.i,g.j]};
  const structural= [add(b,'foundation',g.x,g.z,{...meta,part:'foundation'},.035*mult),add(b,'structure',g.x,g.z,{...meta,part:'structure'},.098*mult),add(b,'facade',g.x,g.z,{...meta,part:'facade'},.041*mult),add(b,'roof',g.x,g.z,{...meta,part:'roof'},.029*mult)];
  pack(4,'building',structural);
  countBuildings++;
 }
 // Deterministic utilities; placed near the development edge with own jobs.
 const validEdge=[...grid.values()].filter(g=>g.buildable&&g.nearRoad).sort((a,b)=>Math.hypot(b.i,b.j)-Math.hypot(a.i,a.j));
 const electric=validEdge.find(g=>Math.hypot(g.i,g.j)>1)||validEdge[0];
 if(electric){
  pack(3,'utilities',[add('grid','utilities',electric.x,electric.z,{height:3.0},.09)]);
  const water=validEdge[Math.floor(validEdge.length/3)];if(water)pack(3,'utilities',[add('water','utilities',water.x,water.z,{},.055)]);
 }
 if(N>=9){ // Transit spur along one edge, including station for larger settlements
  const edge=-half;
  for(let i=-half;i<=half;i++){
   const x=sx+i*cell,z=sz+edge*cell-1.55;
   if(valid(x,z,5))pack(2,'paths',[add('rail','paths',x,z,{rotation:Math.PI/2,width:cell},.027)]);
  }
 }
 // Real unbuilt spaces stay unbuilt; protect coastal/steep/forest cells.
 const reserved=[...grid.values()].filter(g=>g.usage==='protected').length;
 // Finite-budget packages: roads first, then city infrastructure, then buildings, finally parks.
 packages.sort((a,b)=>a.priority-b.priority);
 let spend=0,deferred=0,fundedBuildings=new Set();
 for(const pkg of packages){if(spend+pkg.cost<=c.budget+1e-8){
   spend+=pkg.cost;for(const t of pkg.items){t.packageId=pkg.key;tasks.push(t)}
   if(pkg.kind==='building')fundedBuildings.add(pkg.key);
  }else{deferred+=pkg.items.length;
   if(pkg.kind==='building'){const t=pkg.items[0],g=grid.get(key(...t.meta.plot));if(g)g.usage='unfunded'}
  }}
 const types={};for(const t of tasks)types[t.type]=(types[t.type]||0)+1;
 return {schema:'planet.city.plan.v1',planner:'procedural-prompt-and-seed',config:c,gridSize:N,cellSize:cell,cityCentre:[sx,sz],tasks,landuse:[...grid.values()].map(({i,j,x,z,y,usage,buildable})=>({i,j,x,z,y,usage,buildable})),stats:{tasks:tasks.length,buildings:fundedBuildings.size,roads:tasks.filter(t=>t.stage==='roads').length,parkLots:greens,protectedLots:reserved,budget:c.budget,estimatedCost:money(spend),deferred,types},createdBy:'PLANET LAB procedural planner; no AI API'};
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
