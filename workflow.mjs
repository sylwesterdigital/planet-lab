/* v0.4.13: focused, functional workspaces layered on the existing simulation.
 * Does not generate pretend AI output or create data without the user's action.
 */
const $=id=>document.getElementById(id);
const workspace=$('mainWorkspace');
const hint=$('workflowTip');
const buttons={world:'flowWorld',city:'flowCity',build:'flowBuild',places:'flowPlaces',insights:'flowInsights'};
const descriptions={
 world:'Real Earth: choose a location, then inspect its measured terrain and design a site.',
 city:'City site: set profile, budget and teams in the left tools, then Generate masterplan.',
 build:'Building: dimension and roof controls are in the right panel; use Build / update to preview massing.',
 places:'Save the current settlement with a name and planetary pin. Open, locate or star your saved plans.',
 insights:'These are conceptual simulation counts and dependencies, not real-world property or construction estimates.'
};
function show(mode){
 if(!buttons[mode])return;
 workspace.dataset.flow=mode;
 for(const [name,id] of Object.entries(buttons))$(id).setAttribute('aria-pressed',String(name===mode));
 hint.textContent=descriptions[mode];hint.hidden=false;
 if(mode==='world')$('planetMode').click();
 if(mode==='city'||mode==='build'||mode==='insights')$('regionMode').click();
 if(mode==='city')$('citySection').scrollIntoView({block:'start',behavior:'smooth'});
 if(mode==='build')$('aiStudio').scrollIntoView({block:'start',behavior:'smooth'});
 if(mode==='places'){
   $('placebookSection').scrollIntoView({block:'start',behavior:'smooth'});
   window.planetLabPlaces?.refresh?.().catch?.(()=>{});
 }
 if(mode==='world')workspace.querySelector('.left').scrollTop=0;
}
$('flowWorld').onclick=()=>show('world');
function needSite(mode){
 if(!window.planetLabApp?.config){show('world');$('earthStatus').textContent='Choose an Earth location before '+(mode==='build'?'designing a building.':'planning a settlement.');return}
 show(mode)
}
$('flowCity').onclick=()=>needSite('city');
$('flowBuild').onclick=()=>needSite('build');
$('flowPlaces').onclick=()=>show('places');
$('flowInsights').onclick=()=>show('insights');
$('flowSave').onclick=()=>{show('places');$('snapshotName')?.focus()};
$('startCity').onclick=()=>needSite('city');
$('startHouse').onclick=()=>{
 if(!window.planetLabApp?.config){needSite('build');return}
 show('build');$('manualBuilding').click()
};
$('startExplore').onclick=()=>show('world');
function welcomeFor(user){
 // Never interpolate the handle into HTML: usernames are untrusted text.
 const handle=typeof user?.handle==='string'?user.handle:'';
 $('welcomeUser').textContent=handle?`Welcome back, ${handle}`:'Welcome to PlanetLab';
}
window.addEventListener('planetlab:auth-changed',event=>welcomeFor(event.detail.user));
welcomeFor(window.planetLabAuthState?.user);
// Saved globe pins restore their project directly; placebook handles the loading.
window.addEventListener('planetlab:site-selected',()=>show('city'));
if(window.planetLabApp)show('world');
else window.addEventListener('planetlab:app-ready',()=>show('world'),{once:true});
window.planetLabWorkflow={show};
