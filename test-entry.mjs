/* DOM-free interaction checks for v0.4.11 initial journey (requires Node only). */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function environment(){
 const elements=new Map(),events=new Map();
 const get=id=>{
  if(!elements.has(id))elements.set(id,{
    id,hidden:id==='aiSetupBackdrop',value:'',textContent:'',dataset:{},attributes:{},
    clicks:0,scrolls:0,focuses:0,listeners:{},scrollTop:10,
    setAttribute(name,value){this.attributes[name]=value},
    addEventListener(name,cb){this.listeners[name]=cb},
    click(){this.clicks++;this.onclick?.();this.listeners.click?.()},
    scrollIntoView(){this.scrolls++},focus(){this.focuses++}
  });
  return elements.get(id);
 };
 const window={planetLabApp:{},planetLabAuthState:{user:{handle:'existing_user'}},
   addEventListener(name,cb){(events.get(name)||events.set(name,[]).get(name)).push(cb)},
   emit(name,detail){for(const cb of events.get(name)||[])cb({detail})},
   planetLabPlaces:{refresh:()=>Promise.resolve()}};
 const document={getElementById:get,activeElement:{focus(){}},addEventListener(){}};
 get('mainWorkspace').querySelector=()=>get('left');
 get('workflowEntry').hidden=false;
 get('aiMetaModel').value='muse-spark-1.3';
 return {get,window,document};
}
const x=environment();
vm.runInNewContext(readFileSync(new URL('./workflow.mjs',import.meta.url),'utf8'),x,{filename:'workflow.mjs'});
assert.equal(x.get('welcomeUser').textContent,'Welcome back, existing_user');
assert.equal(x.get('workflowEntry').hidden,false,'Start guidance must not disappear on boot');
assert.equal(x.get('mainWorkspace').dataset.flow,'world');
assert.equal(x.get('planetMode').clicks,1,'Starts in explorable globe');
x.window.emit('planetlab:auth-changed',{user:{handle:'visitor_2'}});
assert.equal(x.get('welcomeUser').textContent,'Welcome back, visitor_2');
x.window.emit('planetlab:auth-changed',{user:null});
assert.equal(x.get('welcomeUser').textContent,'Welcome to PlanetLab');
x.get('startCity').click();
assert.equal(x.get('mainWorkspace').dataset.flow,'city');
assert.equal(x.get('plan').clicks,1);
assert.equal(x.get('citySection').scrolls,1,'City settings should become visible');
x.get('startHouse').click();
assert.equal(x.get('mainWorkspace').dataset.flow,'build');
assert.equal(x.get('manualBuilding').clicks,1);
assert.equal(x.get('aiStudio').scrolls,1,'Building settings should become visible');
x.get('startExplore').click();
assert.equal(x.get('mainWorkspace').dataset.flow,'world');
assert.equal(x.get('workflowEntry').hidden,false,'Welcome remains available after navigation');

const a=environment();
const aiSource=readFileSync(new URL('./ai-connections.mjs',import.meta.url),'utf8')
 .replace(/^import .*\n/gm,'').replace(/^export /gm,'');
vm.runInNewContext(aiSource,{...a,tracedFetch(){},openApiConsole(){},console},{filename:'ai-connections.mjs'});
assert.equal(a.get('aiSetupBackdrop').hidden,true,'No AI modal on initial load');
a.window.emit('planetlab:auth-changed',{user:{handle:'returning_user'}});
assert.equal(a.get('aiSetupBackdrop').hidden,true,'No AI modal when session resumes');
a.get('aiSetupTop').click();
assert.equal(a.get('aiSetupBackdrop').hidden,false,'Explicit AI Setup opens modal');
a.get('aiSetupClose').click();
assert.equal(a.get('aiSetupBackdrop').hidden,true,'AI setup closes on request');
console.log('PASS — welcome, globe navigation, working starter actions and on-demand AI keys');
