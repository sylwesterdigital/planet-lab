const button=document.getElementById('updatesToggle');
const panel=document.getElementById('updatesPanel');
const close=document.getElementById('updatesClose');
const list=document.getElementById('updatesList');
button?.addEventListener('click',()=>{panel.hidden=!panel.hidden});
close?.addEventListener('click',()=>{panel.hidden=true});
try{
 const response=await fetch('./updates.json',{cache:'no-store'});
 if(!response.ok)throw new Error(`HTTP ${response.status}`);
 const data=await response.json();list.replaceChildren();
 let deployments=[];
 try{
  const history=await fetch('/api/releases',{cache:'no-store'});
  if(history.ok)deployments=(await history.json()).releases||[];
 }catch{}
 const observed=new Map(deployments.map(row=>[row.version,row]));
 const notes=data.releases||[];
 const entries=[...notes];
 for(const deployment of deployments){if(!entries.some(note=>note.version===deployment.version))entries.push({version:deployment.version,date:'',changes:'Deployed release'})}
 for(const r of entries.slice(0,10)){
  const row=document.createElement('div');row.className='update-entry';
  const version=document.createElement('b');version.textContent=`v${r.version}`;
  const stamp=document.createElement('time');
  const actual=observed.get(r.version)?.deployedAt;
  stamp.dateTime=actual||r.date;
  stamp.textContent=actual?new Date(actual).toLocaleString():`${r.date} · release notes`;
  stamp.title=actual?'Verified deployment time':'Release date (deployment time unavailable)';
  const description=document.createElement('p');description.textContent=r.changes;
  row.append(version,stamp,description);list.append(row);
 }
}catch(e){list.textContent='Release history unavailable: '+e.message}
