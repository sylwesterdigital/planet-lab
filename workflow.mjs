/* v0.4.9: focused, functional workspaces layered on the existing simulation.
 * Does not generate pretend AI output or create data without the user's action.
 */
const $=id=>document.getElementById(id);
const workspace=$('mainWorkspace');
const intro=$('workflowEntry');
const hint=$('workflowTip');
const buttons={world:'flowWorld',city:'flowCity',build:'flowBuild',places:'flowPlaces',insights:'flowInsights'};
const descriptions={
 world:'Globe: click a region to choose the site. Use left tools to change the world seed and geography.',
 city:'City site: set profile, budget and teams in the left tools, then Generate masterplan.',
 build:'Building: dimension and roof controls are in the right panel; use Build / update to preview massing.',
 places:'Save the current settlement with a name and planetary pin. Open, locate or star your saved plans.',
 insights:'These are conceptual simulation counts and dependencies, not real-world property or construction estimates.'
};
function show(mode){
 if(!buttons[mode])return;
 workspace.dataset.flow=mode;
 intro.hidden=true;
 for(const [name,id] of Object.entries(buttons))$(id).setAttribute('aria-pressed',String(name===mode));
 hint.textContent=descriptions[mode];hint.hidden=false;
 if(mode==='world')$('planetMode').click();
 if(mode==='city'||mode==='build'||mode==='insights')$('regionMode').click();
 if(mode==='places')window.planetLabPlaces?.refresh?.().catch?.(()=>{});
}
$('flowWorld').onclick=()=>show('world');
$('flowCity').onclick=()=>show('city');
$('flowBuild').onclick=()=>show('build');
$('flowPlaces').onclick=()=>show('places');
$('flowInsights').onclick=()=>show('insights');
$('flowSave').onclick=()=>{show('places');$('snapshotName')?.focus()};
$('startCity').onclick=()=>{show('city');$('plan').click()};
$('startHouse').onclick=()=>{show('build');$('manualBuilding').click()};
$('startExplore').onclick=()=>{show('world');$('planetMode').click()};
window.addEventListener('planetlab:open-pin',()=>show('places'));
window.addEventListener('planetlab:site-selected',()=>show('city'));
if(window.planetLabApp)show('world');
else window.addEventListener('planetlab:app-ready',()=>show('world'),{once:true});
window.planetLabWorkflow={show};
