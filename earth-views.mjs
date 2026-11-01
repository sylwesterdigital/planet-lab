/* Real-Earth view bookmarks. Never store DEM, imagery keys, tokens or project data here. */
import {nearbyLatLon} from './earth-terrain.mjs';
import {localPoint} from './earth-buildings.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function validAnchor(p){return !!p&&finite(p.lat)&&finite(p.lon)&&Math.abs(p.lat)<=84.95&&Math.abs(p.lon)<=180}
const vector=(a,max=600)=>Array.isArray(a)&&a.length===3&&a.every(v=>finite(v)&&Math.abs(v)<=max)?[...a]:null;
export function validSite(s){return Array.isArray(s)&&s.length===2&&s.every(v=>finite(v)&&Math.abs(v)<=78)}
export function viewAt(anchor,site){return validAnchor(anchor)&&validSite(site)?nearbyLatLon(anchor,site[0]*10,site[1]*10):null}
export function siteAt(anchor,point){return validAnchor(anchor)&&validAnchor(point)?localPoint(anchor,point.lat,point.lon):null}
export function samePatch(anchor,point){const s=siteAt(anchor,point);return !!s&&Math.abs(s[0])<=77&&Math.abs(s[1])<=77}
export function sanitizeView(v){
 if(!v||!validAnchor(v.anchor))return null;
 const mode=v.mode==='region'?'region':'planet';
 if(mode==='region'&&!validSite(v.site))return null;
 const camera=vector(v.camera),target=vector(v.target);
 const map=v.map&&Array.isArray(v.map.center)&&v.map.center.length===2&&finite(v.map.center[0])&&finite(v.map.center[1])&&Math.abs(v.map.center[1])<=85.06&&finite(v.map.zoom)&&v.map.zoom>=0&&v.map.zoom<=23?{center:[...v.map.center],zoom:v.map.zoom,pitch:finite(v.map.pitch)?Math.max(0,Math.min(75,v.map.pitch)):0,bearing:finite(v.map.bearing)?v.map.bearing:0}:null;
 return {mode,anchor:{lat:v.anchor.lat,lon:v.anchor.lon},site:validSite(v.site)?[...v.site]:[0,0],camera:camera&&target?camera:null,target:camera&&target?target:null,map};
}
export function sanitizeBookmark(b){const view=sanitizeView(b?.view);if(!view||view.mode!=='region')return null;
 const id=typeof b.id==='string'&&/^[a-z0-9-]{6,80}$/i.test(b.id)?b.id:null;
 if(!id)return null;
 return {id,name:String(b.name||'Saved view').slice(0,80),view,created:finite(b.created)?b.created:0};
}
export function viewChanged(a,b){
 if(!a||!b||a.mode!==b.mode)return true;
 const p=viewAt(a.anchor,a.site),q=viewAt(b.anchor,b.site);
 if(!p||!q||Math.hypot((p.lat-q.lat)*111195,(p.lon-q.lon)*111195*Math.cos(p.lat*Math.PI/180))>10)return true;
 if(a.mode==='region'){
  if(!a.camera||!b.camera||!a.target||!b.target)return true;
  return Math.hypot(...a.camera.map((v,i)=>v-b.camera[i]))>3 || Math.hypot(...a.target.map((v,i)=>v-b.target[i]))>2;
 }
 if(!a.map||!b.map)return true;
 const distance=Math.hypot(a.map.center[0]-b.map.center[0],a.map.center[1]-b.map.center[1]);
 return distance>Math.max(.0005,1/2**a.map.zoom)||Math.abs(a.map.zoom-b.map.zoom)>.25||Math.abs(a.map.pitch-b.map.pitch)>3||Math.abs(a.map.bearing-b.map.bearing)>3;
}
export function sanitizeHistory(data){
 const bookmarks=(Array.isArray(data?.bookmarks)?data.bookmarks:[]).slice(0,60).map(sanitizeBookmark).filter(Boolean).slice(0,30);
 const recent=(Array.isArray(data?.recent)?data.recent:[]).slice(0,16).map(sanitizeView).filter(v=>v?.mode==='region').slice(0,8);
 const trailSource=Array.isArray(data?.trail)?data.trail:[...recent].reverse();
 const trail=trailSource.slice(-48).map(sanitizeView).filter(Boolean);
 const cursor=Number.isInteger(data?.cursor)?Math.max(0,Math.min(data.cursor,trail.length-1)):trail.length-1;
 return {last:sanitizeView(data?.last),bookmarks,recent,trail,cursor};
}
