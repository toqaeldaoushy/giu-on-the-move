// Four-baseline ETA benchmark on the 26 finished simulated trips (identical evaluation points for every method).
// Run from the backend folder:  node scripts/eval-eta-baselines.js   (needs: npm install). Simulated data only: not proof of real accuracy.
import fs from 'node:fs';
import { buildRoute } from '../src/geo.js';
import { computeLive } from '../src/eta.js';
import { parseLocal } from '../src/time.js';
const rd=(n)=>{const [h,...ls]=fs.readFileSync('../data/'+n,'utf8').trim().split('\n');const c=h.split(',');return ls.map(l=>Object.fromEntries(l.split(',').map((v,i)=>[c[i],v])));};
const route=buildRoute(rd('route_points.csv').sort((a,b)=>a.seq-b.seq).map(p=>({lat:+p.lat,lon:+p.lon})));
const trips=Object.fromEntries(rd('trips.csv').map(t=>[t.id,t]));
const pings=rd('gps_pings.csv'); const allruns=rd('trip_runs.csv');
console.log('route km',route.totalKm.toFixed(2));
const st={};allruns.forEach(r=>st[r.status]=(st[r.status]||0)+1);console.log('run status',st);
console.log('runs with pings', new Set(pings.map(p=>p.trip_run_id)).size);
const runs=allruns.filter(r=>r.status==='completed');
const planned=route.totalKm/(71/60);
console.log('planned speed kmh',planned.toFixed(1));
const buckets=[[0,.25],[.25,.5],[.5,.75],[.75,.95]];
const mk=()=>buckets.map(()=>[]);
const E={blended:mk(),sched:mk(),recent:mk()}; const ALL={blended:[],sched:[],recent:[]};
const perTrip={}; const durs=[]; const spd=[];
for(const r of runs){const t=trips[r.trip_id];
 const rp=pings.filter(p=>p.trip_run_id===r.id).map(p=>({timestamp:p.timestamp,lat:+p.lat,lon:+p.lon,speed_kmh:+p.speed_kmh}));
 const arr=parseLocal(rp[rp.length-1].timestamp); durs.push((arr-parseLocal(rp[0].timestamp))/60000); rp.forEach(p=>spd.push(p.speed_kmh));
 const run={status:'in_progress',direction:t.direction,run_date:r.run_date,scheduled_time:t.scheduled_time};
 for(let i=1;i<rp.length-1;i++){
  const live=computeLive({run,route,pings:rp.slice(Math.max(0,i-5),i+1)});
  const now=parseLocal(rp[i].timestamp);
  const rem=live.remainingKm;
  const recent=Math.max(5,rp.slice(Math.max(0,i-5),i+1).reduce((a,p)=>a+p.speed_kmh,0)/rp.slice(Math.max(0,i-5),i+1).length);
  const pred={blended:now+live.etaMinutes*60000, sched:now+rem/planned*3600000, recent:now+rem/recent*3600000};
  const b=buckets.findIndex(([lo,hi])=>live.progress>=lo&&live.progress<hi);
  for(const k in pred){const e=(pred[k]-arr)/60000; if(b>=0)E[k][b].push(e); if(live.progress<.95)ALL[k].push(e);
   if(k==='blended'&&b===1){(perTrip[r.id]??=[]).push(e);} }
 }}
const mae=a=>a.reduce((s,x)=>s+Math.abs(x),0)/a.length, bias=a=>a.reduce((s,x)=>s+x,0)/a.length;
for(const k in E){console.log(k,'whole',mae(ALL[k]).toFixed(1),'n',ALL[k].length,'| by bucket',E[k].map(a=>mae(a).toFixed(1)).join(' / '));}
console.log('durations min: min',Math.min(...durs).toFixed(1),'max',Math.max(...durs).toFixed(1),'mean',(durs.reduce((a,b)=>a+b)/durs.length).toFixed(1));
console.log('speed min/max/mean',Math.min(...spd),Math.max(...spd),(spd.reduce((a,b)=>a+b)/spd.length).toFixed(1));
console.log('25-50% blended MAE per run:');
for(const [id,a] of Object.entries(perTrip)){const r=allruns.find(x=>x.id===id);const t=trips[r.trip_id];console.log(id,t.code,t.direction,r.run_date,'MAE',mae(a).toFixed(1),'bias',bias(a).toFixed(1),'n',a.length);}
// exclude run 9 (injected 12-min traffic delay)
const vals=[];
for(const [id,a] of Object.entries(perTrip)) if(id!=='9') vals.push(...a);
console.log('25-50% blended MAE excluding run 9:',mae(vals).toFixed(1),'n',vals.length);
