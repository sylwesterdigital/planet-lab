/* Camera+location continuity and per-account browser bookmarks.
 * No credentials, project blueprints or DEM tiles are stored here. */
import {sanitizeView,sanitizeHistory,viewAt,siteAt,samePatch,viewChanged} from './earth-views.mjs';
const $=id=>document.getElementById(id);
const sim=window.planetLabApp;
const PREFIX='planetlab.earth-views.v1.';
let scope=null,history=sanitizeHistory(null),restoring=false,restoreGeneration=0,attachedMap=null;
const storageKey=handle=>PREFIX+handle;
function read(handle){
 try{return sanitizeHistory(JSON.parse(localStorage.getItem(storageKey(handle))||'null'))}
 catch{return sanitizeHistory(null)}
}
function write(){if(!scope||restoring)return;
 try{localStorage.setItem(storageKey(scope),JSON.stringify(history))}
 catch{$('viewRestoreStatus').textContent='Browser storage is unavailable; bookmarks will not survive refresh.'}
}
const position=v=>v.map((n)=>Number(n));
function capture(){
 if(!sim||!sim.world)return null;
 const map=sim.world.earthMap?.map,mode=sim.world.mode;
 const center=map?.getCenter?.();
 const globe=map&&center?{center:[center.lng,center.lat],zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()}:null;
 const local=sim.config?.geoSource==='earth-dem'&&sim.earthDem;
 return sanitizeView({mode:mode==='region'&&local?'region':'planet',anchor:sim.anchor,site:sim.site,camera:position(sim.world.camera.position.toArray()),target:position(sim.world.controls.target.toArray()),map:globe});
}
function recordView(view){
 if(!view||!scope||restoring)return;
 const current=history.trail[history.cursor];
 if(current&&!viewChanged(current,view)){history.last=view;write();return}
 history.trail=history.trail.slice(0,history.cursor+1);
 history.trail.push(view);
 if(history.trail.length>36)history.trail.shift();
 history.cursor=history.trail.length-1;history.last=view;
 renderRecent();renderNavigation();write();
}
function renderNavigation(){
 const back=$('viewHistoryBack'),next=$('viewHistoryNext'),counter=$('viewHistoryCounter');
 if(!back||!next)return;
 back.disabled=history.cursor<=0;next.disabled=history.cursor>=history.trail.length-1;
 counter.textContent=history.trail.length?`${history.cursor+1} / ${history.trail.length}`:'No visited views';
}
async function navigateHistory(index){
 if(index<0||index>=history.trail.length)return;
 if(await restore(history.trail[index],{record:false})){history.cursor=index;history.last=history.trail[index];write();renderRecent()}
}
$('viewHistoryBack').onclick=()=>navigateHistory(history.cursor-1);
$('viewHistoryNext').onclick=()=>navigateHistory(history.cursor+1);
function saveView({recent=false}={}){
 if(restoring||!scope)return;
 const view=capture();if(!view)return;
 history.last=view;
 if(recent&&view.mode==='region'){
  const at=viewAt(view.anchor,view.site);
  history.recent=[view,...history.recent.filter(other=>{
   const p=viewAt(other.anchor,other.site);if(!p||!at)return false;
   const dlat=(p.lat-at.lat)*111195,dlon=(p.lon-at.lon)*111195*Math.cos(at.lat*Math.PI/180);
   return Math.hypot(dlat,dlon)>25;
  })].slice(0,8);
  renderRecent();
 }
 recordView(view);write();
}
function globePinItems(){return history.bookmarks.map(b=>({id:b.id,title:b.name,anchor:viewAt(b.view.anchor,b.view.site)})).filter(b=>b.anchor)}
function updateMarkers(){
 const map=sim?.world.earthMap;
 map?.bookmarksFor(globePinItems(),id=>openBookmark(id));
 const views=history.bookmarks.flatMap(b=>{
  const point=viewAt(b.view.anchor,b.view.site);
  return point&&samePatch(sim.anchor,point)?[{id:b.id,site:siteAt(sim.anchor,point)}]:[];
 });
 sim.world.showViewBookmarks(views);
}
function btn(text,click,aria){const node=document.createElement('button');node.type='button';node.textContent=text;node.setAttribute('aria-label',aria||text);node.addEventListener('click',click);return node}
function row(name,detail,onOpen,onRemove){
 const item=document.createElement('div');item.className='snapshot-entry';
 const header=document.createElement('div');header.className='snapshot-head';const title=document.createElement('strong');title.textContent=name;
 header.appendChild(title);item.appendChild(header);
 const small=document.createElement('small');small.textContent=detail;item.appendChild(small);
 const actions=document.createElement('div');actions.className='snapshot-actions';
 actions.appendChild(btn('Open view',onOpen,'Restore '+name));
 if(onRemove)actions.appendChild(btn('Remove',onRemove,'Remove '+name));
 item.appendChild(actions);return item;
}
function summary(view){if(view.mode==='planet'&&view.map)return `Globe ${view.map.center[1].toFixed(5)}°, ${view.map.center[0].toFixed(5)}° · zoom ${view.map.zoom.toFixed(1)}`;const point=viewAt(view.anchor,view.site);return point?`${point.lat.toFixed(5)}°, ${point.lon.toFixed(5)}° · saved camera + target`:'Invalid location'}
function renderBookmarks(){
 const list=$('viewBookmarkList');list.replaceChildren();
 if(!history.bookmarks.length){const hint=document.createElement('small');hint.className='hint';hint.textContent='No bookmarks yet.';list.appendChild(hint)}
 for(const bookmark of history.bookmarks){
  list.appendChild(row(bookmark.name,summary(bookmark.view),()=>openBookmark(bookmark.id),()=>{
   history.bookmarks=history.bookmarks.filter(b=>b.id!==bookmark.id);write();renderBookmarks();updateMarkers();
  }));
 }
 updateMarkers();
}
function renderRecent(){
 const list=$('viewRecentList');list.replaceChildren();
 // Include previous camera viewpoints, not just different latitude/longitude.
 history.trail.forEach((view,index)=>{
  const mode=view.mode==='region'?'3D terrain':'Earth globe';
  const selected=index===history.cursor;
  list.appendChild(row(`${selected?'Current · ':''}${mode} #${index+1}`,summary(view),()=>navigateHistory(index)));
 });
 renderNavigation();
}
async function restore(view,{record=true}={}){
 const sanitized=sanitizeView(view);if(!sanitized||!sim)return false;
 const generation=++restoreGeneration;restoring=true;
 try{
  if(sanitized.mode==='region'){
   const a=sanitized.anchor;
   const same=sim.earthDem&&sim.geoSource==='earth-dem'&&Math.abs(sim.anchor.lat-a.lat)<1e-8&&Math.abs(sim.anchor.lon-a.lon)<1e-8;
   if(!same){const loaded=await sim.selectEarthSite(a);if(!loaded||generation!==restoreGeneration)return false}
   sim.world.setMode('region');
   sim.changeSite(sanitized.site);
   if(sanitized.camera&&sanitized.target){
    sim.world.camera.position.fromArray(sanitized.camera);sim.world.controls.target.fromArray(sanitized.target);
    sim.world.controls.update();
   }
  }else{sim.world.setMode('planet')}
  const map=sim.world.earthMap?.map;
  if(map&&sanitized.map)map.jumpTo({...sanitized.map,center:sanitized.map.center});
  sim.updateMode();
  $('viewRestoreStatus').textContent='View restored at '+summary(sanitized);
  updateMarkers();
  return true;
 }catch(error){$('viewRestoreStatus').textContent='Could not restore view: '+error.message;return false}
 finally{
  if(generation===restoreGeneration){restoring=false;if(record)saveView({recent:true})}
 }
}
function openBookmark(id){const b=history.bookmarks.find(row=>row.id===id);if(b)restore(b.view)}
function connectMap(){
 const map=sim?.world.earthMap?.map;
 if(map&&map!==attachedMap){attachedMap=map;map.on('moveend',()=>{if(sim.world.mode==='planet')saveView({recent:true})})}
 updateMarkers();
}
function activate(handle){if(!handle||handle===scope)return;
 ++restoreGeneration;scope=handle;history=read(handle);renderBookmarks();renderRecent();
 if(history.last)void restore(history.last,{record:false});
 else $('viewRestoreStatus').textContent='Your current view will be remembered on this device.';
}
$('viewBookmarkSave').onclick=()=>{
 if(!scope){$('viewRestoreStatus').textContent='Sign in to bookmark this location.';return}
 const view=capture();if(!view||view.mode!=='region'){$('viewRestoreStatus').textContent='Choose a local Earth location first.';return}
 const field=$('viewBookmarkName'),name=field.value.trim().slice(0,80)||`View at ${summary(view).split(' · ')[0]}`;
 const id=crypto.randomUUID?.()||`view-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 history.bookmarks.unshift({id,name,view,created:Date.now()});history.bookmarks=history.bookmarks.slice(0,30);
 field.value='';saveView({recent:true});renderBookmarks();$('viewRestoreStatus').textContent='Bookmarked '+name;
};
window.addEventListener('planetlab:open-view-bookmark',event=>openBookmark(event.detail.id));
window.addEventListener('planetlab:auth-changed',event=>{
 const user=event.detail.user;
 if(user?.handle)activate(user.handle);
 else {++restoreGeneration;scope=null;history=sanitizeHistory(null);renderBookmarks();renderRecent()}
});
window.addEventListener('planetlab:earth-ready',connectMap);
window.addEventListener('planetlab:site-selected',()=>{if(!restoring){saveView({recent:true});renderBookmarks()}else updateMarkers()});
window.addEventListener('planetlab:site-changed',()=>{if(!restoring)saveView({recent:true});updateMarkers()});
window.addEventListener('planetlab:view-changed',()=>saveView({recent:true}));
sim?.world.controls.addEventListener('end',()=>saveView({recent:true}));
window.addEventListener('pagehide',()=>saveView());
connectMap();
if(window.planetLabAuthState?.user?.handle)activate(window.planetLabAuthState.user.handle);
window.planetLabViews={restore,openBookmark,view:()=>capture()};
