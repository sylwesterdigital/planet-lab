/* Persistent per-account snapshot pins, backed by existing world blueprints.
 * Uses only the current authenticated user's owned worlds for modifications.
 * Legacy snapshots are procedural; only explicit earth-dem snapshots belong on Earth.
 */
const $=id=>document.getElementById(id);
const api=async(path,options={})=>window.planetLabWorlds.api(path,options);
let cache=[],loading=false;
const say=(text)=>{$('snapshotStatus').textContent=text};
const key=(a)=>a&&Number.isFinite(a.lat)&&Number.isFinite(a.lon)?`${a.lat.toFixed(1)},${a.lon.toFixed(1)}`:'';
const regionMatches=(world,sim)=>{if(!world?.anchor||!sim)return false;if(world.geoSource!=='earth-dem'||sim.geoSource!=='earth-dem')return world.seed===sim.config?.seed;const lat=(world.anchor.lat-sim.anchor.lat)*111195,lon=(world.anchor.lon-sim.anchor.lon)*111195*Math.cos(sim.anchor.lat*Math.PI/180);return Math.hypot(lat,lon)<=1100};
function visible(){
 const filter=$('snapshotFilter').value,sim=window.planetLabApp;
 return cache.filter(w=>filter==='all'||filter==='stars'&&w.starred||filter==='area'&&regionMatches(w,sim));
}
function refreshPins(){
 const sim=window.planetLabApp;
 if(sim?.world){
  const markers=cache.filter(w=>w.anchor&&w.geoSource==='earth-dem');
  if(sim.plan?.tasks?.length)markers.push({id:'__draft__',anchor:{...sim.anchor},seed:sim.config?.seed,starred:false,draft:true,title:'Unsaved plan'});
  sim.world.earthMap?.pinsFor(markers,id=>window.dispatchEvent(new CustomEvent('planetlab:open-pin',{detail:{id}})));
  sim.world.renderPlacePins(cache.filter(w=>w.geoSource!=='earth-dem'&&w.anchor));
 }
}
function render(){
 const list=$('snapshotList');list.replaceChildren();
 const rows=visible();
 if(!rows.length){const blank=document.createElement('span');blank.className='hint';blank.textContent='No snapshots for this view. Save a plan to add a geo pin.';list.append(blank)}
 for(const w of rows){
  const item=document.createElement('div');item.className='snapshot-entry';
  const head=document.createElement('div');head.className='snapshot-head';
  const title=document.createElement('strong');title.textContent=w.title;
  const favorite=document.createElement('span');favorite.className='snapshot-star';favorite.textContent=w.starred?'★':'';
  head.append(title,favorite);
  const detail=document.createElement('small');
  const date=w.updated_at?new Date(w.updated_at).toLocaleString():'unknown date';
  detail.textContent=`${w.codename||'site'} · ${key(w.anchor)||'unlocated'} · ${date}`;
  const actions=document.createElement('div');actions.className='snapshot-actions';
  const open=document.createElement('button');open.type='button';open.textContent='Open';
  open.addEventListener('click',()=>act(()=>openSnapshot(w)));
  const star=document.createElement('button');star.type='button';star.textContent=w.starred?'★ Unstar':'☆ Star';star.className='snapshot-star';
  const user=window.planetLabWorlds?.user();const owns=user?.handle===w.owner;
  star.disabled=!owns;
  star.addEventListener('click',()=>act(async()=>{
    try{
      const result=await api(`/api/worlds/${w.id}/star`,{method:'PATCH',body:JSON.stringify({starred:!w.starred,revision:w.revision})});
      w.starred=result.starred;w.revision=result.revision;render();refreshPins();say(`Snapshot #${w.id} ${w.starred?'starred':'unstarred'}.`);
    }catch(error){
      if(/Revision conflict/.test(error.message))await update();
      throw error;
    }
  }));
  const visit=document.createElement('button');visit.type='button';visit.textContent='Locate';
  visit.disabled=!w.anchor;
  visit.addEventListener('click',()=>{
    const sim=window.planetLabApp;if(!sim)return;
    if(w.geoSource!=='earth-dem'){say('Legacy fictional location: open the saved project to inspect it. Its coordinates are not Earth coordinates.');return}
    sim.changeAnchor(w.anchor);
    say(`Visited saved planetary region ${key(w.anchor)}. Open snapshot to restore the built plan.`);
    render();refreshPins();
  });
  actions.append(open,visit,star);item.append(head,detail,actions);list.append(item);
 }
 refreshPins();
}
async function update(){
 if(loading||!window.planetLabWorlds?.user())return;
 loading=true;
 try{const data=await api('/api/worlds');cache=data.worlds||[];render();say(`${cache.length} accessible snapshots · ${cache.filter(w=>w.starred).length} starred`)}
 finally{loading=false}
}
async function openSnapshot(w){
 if(w.seed&&$('seed'))$('seed').value=w.seed;
 await window.planetLabWorlds.loadId(w.id);
 render();say(`Loaded snapshot #${w.id} · ${w.title}`);
 window.planetLabWorkflow?.show('city');
}
async function act(fn){try{await fn()}catch(e){say('Error: '+e.message)}}
async function snapshot(){
 const sim=window.planetLabApp;
 if(!sim?.plan)throw new Error('Generate a plan before saving');
 const blueprint=window.planetLabWorlds.getBlueprint();
 const codename=$('snapshotType').value||'settlement';
 blueprint.place={starred:false,codename, savedAt:new Date().toISOString(),
   site:sim.site.slice(),source:sim.geoSource==='earth-dem'?'Mapterhorn Earth elevation':'Legacy procedural geography'};
 const title=$('snapshotName').value.trim()||`${codename} · ${sim.config.profile} · ${new Date().toLocaleString()}`;
 const body={title:title.slice(0,100),is_public:$('worldPublic').checked,blueprint};
 const result=await api('/api/worlds',{method:'POST',body:JSON.stringify(body)});
 say(`Saved snapshot #${result.id} · ${title}`);
 await update();
 $('snapshotFilter').value='area';render();
}
$('snapshotSave').addEventListener('click',()=>act(snapshot));
$('snapshotRefresh').addEventListener('click',()=>act(update));
$('snapshotFilter').addEventListener('change',render);
window.addEventListener('planetlab:auth-changed',e=>{
 if(e.detail.user)act(update);
 else {cache=[];render()}
});
window.addEventListener('planetlab:open-pin',e=>{
 if(e.detail.id==='__draft__'){
   say('Current construction plan (unsaved). Choose Save snapshot + pin to preserve it.');return;
 }
 const w=cache.find(row=>row.id===e.detail.id);
 if(!w)return;
 $('snapshotFilter').value='all';render();
 say(`Opening saved site: ${w.title}`);
 act(()=>openSnapshot(w));
});
// Existing collab module may finish session boot before this module evaluates.
if(window.planetLabAuthState?.user)act(update);
const sim=window.planetLabApp;
// Repaint saved pin markers after changing planets or regenerating terrain.
window.addEventListener('planetlab:earth-ready',refreshPins);
if(sim){const old=sim.generateWorld.bind(sim);sim.generateWorld=function(...args){const result=old(...args);queueMicrotask(()=>refreshPins());return result};
 const oldPlan=sim.createPlan.bind(sim);sim.createPlan=function(...args){const result=oldPlan(...args);queueMicrotask(()=>render());return result};}
window.planetLabPlaces={refresh:update};
