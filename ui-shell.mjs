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
// Unified credentials available to building, site imagery and perspective generation.
const dialog=$('providerKeysDialog');
function updateKeys(){
 $('rememberKeys').checked=rememberEnabled();
 for(const provider of ['meta','xai','openai']){
  const has=!!getProviderKey(provider);
  $('providerState-'+provider).textContent=has?(rememberEnabled()?'Saved on this device':'Ready for this tab'):'Not configured';
 }
}
$('topKeys').onclick=()=>{updateKeys();dialog.hidden=false};
$('providerKeysClose').onclick=()=>{dialog.hidden=true};
$('rememberKeys').onchange=event=>{try{setRememberEnabled(event.target.checked);updateKeys()}catch(error){$('providerKeysStatus').textContent=error.message;event.target.checked=false}};
for(const provider of ['meta','xai','openai']){
 const input=$('providerKey-'+provider);
 $('providerSave-'+provider).onclick=()=>{
  try{if(!input.value.trim())throw new Error('Enter a key first');setProviderKey(provider,input.value);input.value='';updateKeys();$('providerKeysStatus').textContent=provider.toUpperCase()+' key ready.'}
  catch(error){$('providerKeysStatus').textContent=error.message}
 };
 $('providerForget-'+provider).onclick=()=>{forgetProviderKey(provider);input.value='';updateKeys();$('providerKeysStatus').textContent=provider.toUpperCase()+' key cleared.'};
}
window.addEventListener('planetlab:keys-changed',updateKeys);
show('explore');
window.planetLabTools={show};
