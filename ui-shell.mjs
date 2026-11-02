import {tracedFetch,openApiConsole} from './api-console.mjs';
/* Three flat workspaces on one draggable tool dock, with optional BYOK storage. */
import {getProviderKey,setProviderKey,forgetProviderKey,rememberEnabled,setRememberEnabled} from './provider-keys.mjs';
const $=id=>document.getElementById(id);
const dock=$('toolDock'),handle=$('toolDockHandle'),content=$('toolDockContent');
const tabs={explore:$('tabExplore'),create:$('tabCreate'),projects:$('tabProjects')};
const groups={};
for(const key of Object.keys(tabs)){const area=document.createElement('div');area.className='tool-dock-group';area.dataset.group=key;content.append(area);groups[key]=area}
function take(id,group){const element=$(id);if(element)groups[group].append(element)}
function takeParent(id,group){const element=$(id);if(element?.parentElement)groups[group].append(element.parentElement)}
function takeSelector(selector,group){const element=document.querySelector(selector);if(element)groups[group].append(element)}
// Keep existing element IDs and event handlers; only rearrange their presentation.
takeSelector('.mode-tabs','explore');
take('existingBuildingsSection','explore');take('aerialOptions','explore');
takeParent('newWorld','explore');take('siteText','explore');take('viewHistorySection','explore');
take('perspectiveEditor','create');take('scenarioEditor','create');take('citySection','create');take('constructionSection','create');take('aiStudio','create');
take('feasibilitySection','create');take('landUseSection','create');take('teamsSection','create');take('catalogSection','create');take('systemsSection','create');take('feedSection','create');
take('aiConnectionsSection','create');
take('placebookSection','projects');take('collabPanel','projects');
// Flatten the only expandable sections used inside the tool dock.
for(const detail of dock.querySelectorAll('details')){
 const heading=detail.querySelector(':scope > summary');
 if(heading){const h=document.createElement('h3');h.textContent=heading.textContent;detail.replaceChild(h,heading)}
 const replacement=document.createElement('section');replacement.id=detail.id;
 replacement.className=(detail.className||'')+' flat-section';
 while(detail.firstChild)replacement.append(detail.firstChild);
 detail.replaceWith(replacement);
}
const labels={explore:'Explore Earth',create:'Create',projects:'Projects'};
let active='explore';
function show(group,focusId){if(!groups[group])return;active=group;
 dock.hidden=false;dock.classList.remove('collapsed');
 for(const [name,area] of Object.entries(groups)){area.hidden=name!==group;tabs[name].setAttribute('aria-pressed',String(name===group))}
 $('toolDockTitle').textContent=labels[group];
 if(focusId){const node=$(focusId);node?.scrollIntoView?.({block:'nearest'});}
}
for(const [name,button] of Object.entries(tabs))button.onclick=()=>show(name);
$('toolDockCollapse').onclick=()=>dock.classList.toggle('collapsed');
$('toolDockClose').onclick=()=>{dock.hidden=true};
$('toolDockToggle').onclick=()=>{dock.hidden=false;dock.classList.toggle('collapsed')};
$('topGlobe').onclick=()=>{$('planetMode')?.click();show('explore')};
$('topSite').onclick=()=>{$('regionMode')?.click();show('explore')};
$('flowWorld')?.addEventListener('click',()=>show('explore'));
$('flowCity')?.addEventListener('click',()=>show('create','citySection'));
$('flowBuild')?.addEventListener('click',()=>show('create','aiStudio'));
$('flowPlaces')?.addEventListener('click',()=>show('projects','placebookSection'));
$('flowInsights')?.addEventListener('click',()=>show('create','feasibilitySection'));
$('flowSave')?.addEventListener('click',()=>show('projects','placebookSection'));
window.addEventListener('planetlab:site-selected',()=>{if(!dock.hidden)show('explore')});
// A small draggable dock must never intercept the entire map.
let drag=null;
handle.addEventListener('pointerdown',event=>{
 if(event.target.closest('button'))return;
 drag={x:event.clientX,y:event.clientY,left:dock.offsetLeft,top:dock.offsetTop};
 handle.setPointerCapture(event.pointerId);event.preventDefault();
});
handle.addEventListener('pointermove',event=>{
 if(!drag)return;
 const maxLeft=Math.max(8,window.innerWidth-dock.offsetWidth-8),maxTop=Math.max(64,window.innerHeight-70);
 dock.style.left=Math.max(8,Math.min(maxLeft,drag.left+event.clientX-drag.x))+'px';
 dock.style.top=Math.max(64,Math.min(maxTop,drag.top+event.clientY-drag.y))+'px';
 dock.style.right='auto';
});
handle.addEventListener('pointerup',()=>drag=null);
handle.addEventListener('lostpointercapture',()=>drag=null);
// One credentials workspace: all providers, one non-billed test action per provider.
const dialog=$('providerKeysDialog');
const providers=['meta','xai','openai','tripo','maptiler'];
const verifications=Object.fromEntries(providers.map(p=>[p,'']));
let mapLoading=false;
function updateKeys(){
 $('rememberKeys').checked=rememberEnabled();
 for(const provider of providers){
  const has=!!getProviderKey(provider),note=$('providerState-'+provider);
  if(note)note.textContent=verifications[provider]||(has?(rememberEnabled()?'Saved on this device · untested':'Ready in this tab · untested'):'Not configured');
 }
}
function openKeys(){updateKeys();dialog.hidden=false;$('aiSetupBackdrop').hidden=true}
$('topKeys').onclick=openKeys;
$('scenarioKeysOpen').onclick=openKeys;
$('perspectiveKeysOpen').onclick=openKeys;
$('providerKeysClose').onclick=()=>{dialog.hidden=true};
$('rememberKeys').onchange=event=>{try{setRememberEnabled(event.target.checked);updateKeys()}catch(error){$('providerKeysStatus').textContent=error.message;event.target.checked=false}};
function setCheck(provider,message){verifications[provider]=message;updateKeys();$('providerKeysStatus').textContent=provider.toUpperCase()+': '+message}
async function checkMapTiler(key){
 // The key's allowed HTTP origin must be checked from planetlab.me (browser), not from Ubuntu.
 const response=await fetch('https://api.maptiler.com/tiles/satellite-v2/0/0/0.jpg?key='+encodeURIComponent(key),{mode:'cors',cache:'no-store'});
 return {ok:response.ok,status:response.status};
}
async function checkProvider(provider){
 const key=getProviderKey(provider),button=$('providerCheck-'+provider);
 if(!key){setCheck(provider,'Not configured. Save a key first.');return}
 button.disabled=true;setCheck(provider,'Checking (read-only)…');
 try{
  if(provider==='maptiler'){
   const result=await checkMapTiler(key);
   setCheck(provider,result.ok?'Verified on this site · satellite tiles accessible':'Rejected by MapTiler (HTTP '+result.status+'). Check domain restrictions');
  }else{
   const session=window.planetLabAuthState;
   if(!session?.user||!session.csrf)throw new Error('Sign in to test a provider');
   const header='X-PlanetLab-'+(provider==='xai'?'XAI':provider==='openai'?'OpenAI':provider==='meta'?'Meta':'Tripo')+'-Key';
   const response=await tracedFetch('/api/ai/provider-check/'+provider,{
    method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':session.csrf,[header]:key}});
   const result=await response.json();
   if(!response.ok)throw new Error('Test failed: '+(result.status||result.error||'HTTP '+response.status));
   if(provider==='tripo')setCheck(provider,'Verified · '+result.balance+' credits available · '+result.frozen+' frozen');
   else setCheck(provider,'Verified · '+result.model_count+' models visible'+(result.image_model_visible===true?' · image model listed':result.image_model_visible===false?' · image model NOT listed':'' )+' · billing unavailable with this key');
  }
 }catch(error){setCheck(provider,error.message);openApiConsole()}
 finally{button.disabled=false}
}
for(const provider of providers){
 const input=$('providerKey-'+provider);
 $('providerSave-'+provider).onclick=()=>{
  try{if(!input.value.trim())throw new Error('Enter a key first');setProviderKey(provider,input.value);input.value='';verifications[provider]='Saved · not yet tested';updateKeys();$('providerKeysStatus').textContent=provider.toUpperCase()+' key saved.';
   if(provider==='maptiler'&&$('quickImagery').checked)applyMapImagery(true);
  }catch(error){$('providerKeysStatus').textContent=error.message}
 };
 $('providerForget-'+provider).onclick=()=>{forgetProviderKey(provider);input.value='';verifications[provider]='';updateKeys();$('providerKeysStatus').textContent=provider.toUpperCase()+' key cleared.';
  if(provider==='maptiler'&&$('quickImagery').checked){$('quickImagery').checked=false;applyMapImagery(false)}
 };
 $('providerCheck-'+provider).onclick=()=>checkProvider(provider);
}
async function applyMapImagery(enabled){
 if(mapLoading)return;
 const app=window.planetLabApp;
 if(!app)return;
 const key=enabled?getProviderKey('maptiler'):'';
 if(enabled&&!key){$('quickImagery').checked=false;openKeys();setCheck('maptiler','Save a MapTiler key first.');return}
 mapLoading=true;
 try{
  await app.world.earthMap?.setImageryKey(key);
  app.imageryKey=key;
  if(app.world.mode==='region')app.world.refreshImagery();
  try{localStorage.setItem('planetlab:hd-imagery-enabled-v1',enabled?'yes':'no')}catch{}
 }catch(error){$('providerKeysStatus').textContent='MapTiler: '+error.message;$('quickImagery').checked=false;app.imageryKey=''}
 finally{mapLoading=false}
}
$('quickImagery').onchange=event=>applyMapImagery(event.target.checked);
$('quickRetryBuildings').onclick=()=>document.getElementById('retryBuildings')?.click();
$('quickBuildings').onchange=event=>{$('showExistingBuildings3d').checked=event.target.checked;$('showExistingBuildings3d').dispatchEvent(new Event('change'))};
$('quickOnlyBuildings').onchange=event=>{$('showOnlyExistingBuildings').checked=event.target.checked;$('showOnlyExistingBuildings').dispatchEvent(new Event('change'))};
$('showExistingBuildings3d').addEventListener('change',event=>{$('quickBuildings').checked=event.target.checked});
$('showOnlyExistingBuildings').addEventListener('change',event=>{$('quickOnlyBuildings').checked=event.target.checked});
window.addEventListener('planetlab:keys-changed',updateKeys);
// Restore the user's imagery preference when a stored key exists; never prompt on each visit.
try{if(localStorage.getItem('planetlab:hd-imagery-enabled-v1')==='yes'&&getProviderKey('maptiler')){
 $('quickImagery').checked=true;applyMapImagery(true);
}}catch{}
show('explore');
window.planetLabTools={show};

$('providerKeysForm')?.addEventListener('submit',event=>event.preventDefault());
