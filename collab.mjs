/* Collaborative persistence / chat UI. Local planner remains the source of task simulation. */
const el = id => document.getElementById(id);
let csrf = '', currentUser = null, worldId = null, revision = null, socket = null;
function note(message) { el('cloudStatus').textContent = message; }
function state(message) { el('worldState').textContent = message; }
function log(message) { const entry=document.createElement('p');entry.textContent=message;el('chatLog').prepend(entry); while(el('chatLog').children.length>35)el('chatLog').lastElementChild.remove(); }
async function call(path, options={}) {
  const headers={...(options.body instanceof FormData ? {} : {'Content-Type':'application/json'}),...(options.headers||{})};
  if(options.method && !['GET','HEAD'].includes(options.method))headers['X-CSRF-Token']=csrf;
  const response=await fetch(path,{credentials:'same-origin', ...options,headers});
  const data=await response.json().catch(()=>({error:`HTTP ${response.status}`}));
  if(!response.ok)throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function setSession(user, token) {
  currentUser = user || null;
  csrf = token || '';
  const strip = el('accountStrip');
  strip.hidden = !currentUser;
  el('accountName').textContent = currentUser ? `@${currentUser.handle}` : '';
  note(currentUser ? `Signed in as ${currentUser.handle}` : 'Sign in to save and collaborate');
  window.planetLabAuthState = {user: currentUser, csrf};
  window.dispatchEvent(new CustomEvent('planetlab:auth-changed', {detail: {user: currentUser, csrf}}));
}
async function sessionInfo() {
  const s = await call('/api/session');
  setSession(s.user, s.csrf);
  return s;
}
async function worlds(){const d=await call('/api/worlds');const list=el('worldList'),selected=list.value;list.replaceChildren(new Option('Select world',''));
for(const w of d.worlds){list.add(new Option(`#${w.id} · ${w.title} · ${w.owner}${w.is_public?' · public':''}`,String(w.id)));}
if(Array.from(list.options).some(o=>o.value===selected))list.value=selected;
}
function blueprint(){const sim=window.planetLabApp;if(!sim?.plan)throw new Error('Generate a masterplan before saving');return {...sim.plan, governance:el('freeZone').checked?'voluntary-free-zone':'unspecified', tasks:sim.plan.tasks.map(t=>({...t}))};}
function readIntoScene(data){const sim=window.planetLabApp;if(!sim)throw new Error('3D engine has not loaded');const c=data.config||{};
for(const id of ['seed','geography','profile','level','budget','teams','brief'])if(c[id] !== undefined && el(id))el(id).value=String(c[id]);
sim.anchor=c.anchor||sim.anchor;sim.generateWorld();
if(Array.isArray(c.site)){sim.site=c.site;sim.world.setSite(sim.site);sim.updateLocation();}
sim.createPlan();el('freeZone').checked=data.governance==='voluntary-free-zone';sim.world.setVoluntaryZone(el('freeZone').checked);
const previous=new Map((data.tasks||[]).filter(t=>t.status==='installed').map(t=>[t.id,t]));
for(const task of sim.plan.tasks){if(previous.has(task.id)){task.status='installed';sim.world.makePart(task);}}
sim.updateUi();sim.drawMap();window.planetLabStudio?.applyStored(data);}
function connect(world){if(socket){socket.close();socket=null;}
if(!currentUser)return;
const protocol=location.protocol==='https:'?'wss:':'ws:';
const ws=new WebSocket(`${protocol}//${location.host}/ws/world/${world}`);socket=ws;
ws.addEventListener('open',()=>log(`Connected to world #${world}`));
ws.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.type==='chat')log(`${m.user}: ${m.text}`);else if(m.type==='presence')log(`${m.user} ${m.state} · ${m.online} online`);else if(m.type==='world_updated')state(`World updated remotely (revision ${m.revision}); load latest to view.`);}catch{}});
ws.addEventListener('close',()=>{if(socket===ws)log('World connection closed.');});
}
async function save(){if(!currentUser)throw new Error('Sign in first');let payload={title:el('worldTitle').value.trim()||'Unnamed world',is_public:el('worldPublic').checked,blueprint:blueprint()};
if(worldId){payload.revision=revision;const d=await call(`/api/worlds/${worldId}`,{method:'PUT',body:JSON.stringify(payload)});revision=d.revision;state(`Updated world #${worldId} · revision ${revision}`);}
else{const d=await call('/api/worlds',{method:'POST',body:JSON.stringify(payload)});worldId=d.id;revision=d.revision;state(`Created world #${worldId} · revision ${revision}`);}
await worlds();el('worldList').value=String(worldId);connect(worldId);}
async function load(){const id=Number(el('worldList').value);if(!id)throw new Error('Choose a saved world');const d=await call(`/api/worlds/${id}`);readIntoScene(d.blueprint);worldId=id;revision=d.revision;el('worldTitle').value=d.title;el('worldPublic').checked=d.is_public;state(`Loaded #${id} · revision ${revision}`);el('chatLog').replaceChildren();const chat=await call(`/api/worlds/${id}/messages`);for(const msg of chat.messages)log(`${msg.user}: ${msg.text}`);connect(id);}
async function action(fn){try{await fn();}catch(e){note(`Error: ${e.message}`);}}

/* Initial experience: one modal, one form, session cookie managed by Flask. */
const overlay=el('authBackdrop'), form=el('authForm'), message=el('authMessage');
let authMode='register', authBusy=false;
function showAuth() {
  overlay.hidden=false;
  el('authLoading').hidden=true;
  el('authFailed').hidden=true;
  el('authPanel').hidden=false;
  message.hidden=true;
  el('authHandle').focus();
}
function hideAuth() {
  overlay.hidden=true;
  el('authPassword').value='';
  message.hidden=true;
}
function authError(error){message.textContent=error;message.hidden=false;}
function mode(value) {
  if(authBusy)return;
  authMode=value;
  const signingIn=value==='login';
  el('authTabRegister').setAttribute('aria-selected',String(!signingIn));
  el('authTabLogin').setAttribute('aria-selected',String(signingIn));
  el('authFormTitle').textContent=signingIn?'Welcome back':'Create your account';
  el('authPassword').autocomplete=signingIn?'current-password':'new-password';
  el('authPassword').placeholder=signingIn?'Your password':'At least 12 characters';
  el('authPassword').minLength=signingIn?1:12;
  el('authPasswordHelp').textContent=signingIn?'Sign in with your existing password.':'At least 12 characters; stored securely on the server.';
  el('authHandleHelp').hidden=signingIn;
  el('authSubmit').textContent=signingIn?'Sign in & enter':'Create account & enter';
  message.hidden=true;
}
el('authTabRegister').onclick=()=>mode('register');
el('authTabLogin').onclick=()=>mode('login');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(authBusy)return;
  const handle=el('authHandle').value.trim();
  const password=el('authPassword').value;
  if(!/^[a-z0-9_-]{3,32}$/i.test(handle))return authError('Username must be 3–32 letters, numbers, _ or -.');
  if(authMode==='register' && (password.length<12||password.length>200))return authError('Choose a password between 12 and 200 characters.');
  if(!password)return authError('Enter your password.');
  authBusy=true;
  el('authSubmit').disabled=true;
  el('authSubmit').textContent=authMode==='register'?'Creating account…':'Signing in…';
  message.hidden=true;
  try {
    const response=await call(authMode==='register'?'/api/register':'/api/login',{
      method:'POST',body:JSON.stringify({handle,password})
    });
    setSession({id:response.id,handle:response.handle},response.csrf);
    hideAuth();
    await action(worlds);
  } catch (error) {
    authError(error.message);
  } finally {
    authBusy=false;
    el('authSubmit').disabled=false;
    el('authSubmit').textContent=authMode==='register'?'Create account & enter':'Sign in & enter';
  }
});

el('accountSignout').onclick=()=>action(async()=>{
  const result=await call('/api/logout',{method:'POST'});
  if(socket){socket.close();socket=null;}
  worldId=null;revision=null;
  setSession(null,result.csrf);
  mode('login');
  showAuth();
  await worlds();
});
el('saveWorld').onclick=()=>action(save);
el('loadWorld').onclick=()=>action(load);
el('refreshWorlds').onclick=()=>action(worlds);
el('worldList').onchange=()=>{worldId=null;revision=null;state('Selected world; press Load world.');};
function sendChat(){if(!socket||socket.readyState!==WebSocket.OPEN){note('Load a world and connect first');return;}const text=el('chatInput').value.trim();if(text){socket.send(JSON.stringify({type:'chat',text}));el('chatInput').value='';}}
el('chatSend').onclick=sendChat;
el('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendChat();});
el('uploadMedia').onclick=()=>action(async()=>{if(!worldId)throw new Error('Load or save a world first');const file=el('mediaFile').files[0];if(!file)throw new Error('Select a media file');if(file.size>50*1024*1024)throw new Error('50 MB maximum');const form=new FormData();form.append('file',file);const result=await call(`/api/worlds/${worldId}/media`,{method:'POST',body:form});state(`Uploaded ${result.filename} (${result.size} bytes) to world #${worldId}`);el('mediaFile').value='';});
async function bootAuth(){
  el('authLoading').hidden=false;el('authPanel').hidden=true;el('authFailed').hidden=true;overlay.hidden=false;
  try {
    const user=await sessionInfo();
    if(user.user){hideAuth();}
    else {mode('register');showAuth();}
    await action(worlds);
  } catch(error) {
    el('authLoading').hidden=true;el('authPanel').hidden=true;el('authFailed').hidden=false;
    note('API unavailable');
    console.error('Session check failed',error);
  }
}
el('authRetry').onclick=bootAuth;
await bootAuth();
