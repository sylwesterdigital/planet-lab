/* Fictional settlement roles and dependency checks. These are taxonomies and
 * pedagogical simulation heuristics, not verified engineering or cost data. */
export const COMPONENT_CATALOG={
 residential:['House','Cottage','Apartment block','High-rise residence','Worker estate','Temporary accommodation','Student residence','Retirement residence','Hotel','Hostel','Holiday lodge'],
 commercial:['Shop','Supermarket','Shopping mall','Restaurant','Cafe','Nightclub','Office','Market hall','Warehouse','Bank','Repair workshop','Cinema'],
 civic:['School','University','Library','Hospital','Clinic','Fire station','Police station','Civic hall','Church / place of worship','Community centre','Stadium','Sports centre'],
 transport:['Bus stop','Bus depot','Train station','Tram stop','Metro station','Airport','Heliport','Port','Marina','Ferry terminal','Freight terminal','Interchange','Parking garage'],
 industry:['Factory','Data centre','Oil / fuel station','Power plant','Wind farm','Solar farm','Water treatment works','Recycling facility','Waste processing','Logistics depot','Mining site'],
 environment:['Park','Forest reserve','Lake','Pond','Reservoir','River embankment','Farm','Greenhouse','Community garden','Public square','Wetland','Canal'],
 infrastructure:['Road','Expressway','Cycle lane','Pedestrian path','Rail corridor','Power substation','Electrical grid','Water tank','Well','Pump station','Sewerage','Broadband exchange','Bridge','Dam']
};
export const ALL_CODES=Object.entries(COMPONENT_CATALOG).flatMap(([group,names])=>names.map(label=>({value:label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),label,group})));
export function analyseSystems(plan){
 const kinds=(plan?.landuse||[]).map(x=>x.usage);
 const has=(...types)=>types.some(t=>kinds.includes(t));
 const residential=kinds.filter(t=>['home','cottage','apartments','tower','workers','temporary','hotel'].includes(t)).length;
 const industry=kinds.filter(t=>['factory','data','power'].includes(t)).length;
 const roads=(plan?.tasks||[]).filter(t=>t.stage==='roads').length;
 const greens=kinds.filter(t=>['park','forest'].includes(t)).length;
 const cautions=[];
 if(residential>5&&!has('civic'))cautions.push('No civic / school site allocated');
 if(residential>8&&!has('station'))cautions.push('No transit station allocated');
 if(industry>0&&!has('power'))cautions.push('Industrial district without dedicated power plant');
 if(residential>0&&roads===0)cautions.push('Residential blocks without access road');
 if(residential>8&&greens<2)cautions.push('Very limited green space');
 if(!has('airport','station') && plan?.gridSize>=11)cautions.push('Large district has no planned major transport hub');
 // Conceptual unitless index; never a currency valuation.
 const index=Math.round((residential*2+industry*7+roads*.18+greens*.45)*10)/10;
 return {residential,industry,roads,greens,unitlessInfrastructureIndex:index,cautions,
  caveat:'Toy planning index only. No real pricing, GIS, accessibility or engineering verification.'};
}
const $=id=>document.getElementById(id);
function populate(){
 for(const id of ['snapshotType','buildingCodeType']){
  const sel=$(id);if(!sel)continue;sel.replaceChildren();
  for(const item of ALL_CODES){const opt=new Option(`${item.label} · ${item.group}`,item.value);sel.add(opt)}
  sel.value='house';
 }
}
function render(){const target=$('citySystemsSummary');if(!target)return;
 const plan=window.planetLabApp?.plan;
 if(!plan){target.textContent='Generate a masterplan first.';return}
 const a=analyseSystems(plan),el=document.createElement('div');
 const rows=[`${a.residential} residential plots · ${a.industry} industrial plots`,`${a.roads} road jobs · ${a.greens} green plots`, `Conceptual infrastructure index: ${a.unitlessInfrastructureIndex}`];
 for(const row of [...rows,...a.cautions.map(c=>'⚠ '+c)]){
  const p=document.createElement('p');p.textContent=row;el.append(p);
 }
 const fine=document.createElement('p');fine.textContent=a.caveat;fine.style.color='#8ba9b9';el.append(fine);
 target.replaceChildren(el);
}
let activeTask=null;
window.addEventListener('planetlab:building-selected',e=>{
 const task=e.detail.task;
 if(!task?.meta?.kind)return;
 activeTask=task;
 $('buildingSelectText').textContent=`Selected ${task.meta.kind} at ${task.x.toFixed(1)}, ${task.z.toFixed(1)}`;
 const type=task.meta.codeType;
 if(type&&ALL_CODES.some(x=>x.value===type))$('buildingCodeType').value=type;
 $('buildingCodeName').value=task.meta.codeName||'';
});
$('buildingCodeApply')?.addEventListener('click',()=>{
 if(!activeTask){$('buildingSelectText').textContent='Click an installed building before labelling.';return}
 const sim=window.planetLabApp,codeType=$('buildingCodeType').value;
 const name=$('buildingCodeName').value.trim().slice(0,60);
 const type=ALL_CODES.find(x=>x.value===codeType);
 if(!type){$('buildingSelectText').textContent='Choose a valid building function';return}
 for(const task of sim.plan?.tasks||[]){
   if(task.packageId===activeTask.packageId&&task.meta?.kind){
      task.meta.codeType=codeType;task.meta.codeName=name||type.label;
   }
 }
 $('buildingSelectText').textContent=`${name||type.label} · ${type.group} · saved with next snapshot`;
});
populate();$('citySystemsCheck')?.addEventListener('click',render);
render();
const current=window.planetLabApp;
if(current){const previous=current.createPlan.bind(current);current.createPlan=function(...args){const result=previous(...args);render();return result}}
window.planetLabSystemCatalog={all:ALL_CODES,analyse:analyseSystems};
