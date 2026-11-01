/* Opt-in BYOK key ring. LocalStorage is accessible to scripts on this origin;
 * therefore persistent storage is disabled unless the user explicitly opts in. */
const STORE='planetlab:byok-keys-v1';
const ENABLE='planetlab:byok-remember-v1';
const names=['meta','xai','openai'];
const memory=Object.fromEntries(names.map(name=>[name,'']));
let remembering=false;
try {
 remembering=localStorage.getItem(ENABLE)==='yes';
 if(remembering){const disk=JSON.parse(localStorage.getItem(STORE)||'{}');
   for(const name of names)if(typeof disk[name]==='string')memory[name]=disk[name];}
} catch { remembering=false; }
const emit=()=>window.dispatchEvent(new Event('planetlab:keys-changed'));
function persist(){try{if(remembering){localStorage.setItem(ENABLE,'yes');localStorage.setItem(STORE,JSON.stringify(memory));}else{localStorage.removeItem(ENABLE);localStorage.removeItem(STORE);}}catch(e){if(remembering)throw new Error('Device storage unavailable: '+e.message)}}
export function getProviderKey(name){return names.includes(name)?memory[name]||'':''}
export function rememberEnabled(){return remembering}
export function setRememberEnabled(on){remembering=!!on;persist();emit()}
export function setProviderKey(name,value){if(!names.includes(name))throw new Error('Unknown provider');const v=(value||'').trim();if(v&&(v.length<12||v.length>4096||/\s/.test(v)))throw new Error('API key must be 12–4096 characters without whitespace');memory[name]=v;persist();emit()}
export function forgetProviderKey(name){setProviderKey(name,'')}
