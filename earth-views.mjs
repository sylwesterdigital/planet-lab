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
export function sanitizeHistory(data){return {last:sanitizeView(data?.last),bookmarks:(Array.isArray(data?.bookmarks)?data.bookmarks:[]).slice(0,60).map(sanitizeBookmark).filter(Boolean).slice(0,30),recent:(Array.isArray(data?.recent)?data.recent:[]).slice(0,16).map(sanitizeView).filter(v=>v?.mode==='region').slice(0,8)};}
