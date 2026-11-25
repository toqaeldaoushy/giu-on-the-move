import fs from 'node:fs';
import { buildRoute } from '../src/geo.js';
import { parseLocal } from '../src/time.js';
const rd=(n)=>{const [h,...ls]=fs.readFileSync('../data/'+n,'utf8').trim().split('\n');const c=h.split(',');return ls.map(l=>Object.fromEntries(l.split(',').map((v,i)=>[c[i],v])));};
const route=buildRoute(rd('route_points.csv').sort((a,b)=>a.seq-b.seq).map(p=>({lat:+p.lat,lon:+p.lon})));
const trips=Object.fromEntries(rd('trips.csv').map(t=>[t.id,t]));
const pings=rd('gps_pings.csv'); const runs=rd('trip_runs.csv').filter(r=>r.status==='completed');
const L=route.totalKm, planned=L/(71/60);
// run 9 speeds
const r9=pings.filter(p=>p.trip_run_id==='9').map(p=>+p.speed_kmh);
console.log('run 9 pings',r9.length,'speeds:',r9.join(' '));
const methods={timetable:[],sched:[],blended:[],cap50:[],schedPlusDelay:[]};
for(const r of runs){const t=trips[r.trip_id];const inb=t.direction==='inbound';
 const rp=pings.filter(p=>p.trip_run_id===r.id).map(p=>({ts:parseLocal(p.timestamp),lat:+p.lat,lon:+p.lon,v:+p.speed_kmh}));
 const arr=rp[rp.length-1].ts, dep=rp[0].ts, schedDep=parseLocal(`${r.run_date}T${t.scheduled_time}`);
 for(let i=1;i<rp.length-1;i++){const p=rp[i];const s=route.project(p.lat,p.lon).sKm;const prog=inb?s:L-s;const rem=Math.max(0,L-prog);
  if(prog/L>=.95)continue;
  const w=rp.slice(Math.max(0,i-5),i+1);const recent=Math.max(5,w.reduce((a,x)=>a+x.v,0)/w.length);
  const trust=Math.min(1,prog/(L*.25));
  const blend=(tr)=>p.ts+rem/((1-tr)*planned+tr*recent)*3600000;
  // schedule + delay so far: planned time for remaining distance, plus nothing else (delay already in 'now')
  const expectedElapsed=prog/planned*60; // min the plan says it should have taken
  const pred={timetable:schedDep+40*60000, sched:p.ts+rem/planned*3600000, blended:blend(trust), cap50:blend(Math.min(.5,trust)),
   schedPlusDelay:p.ts+rem/planned*3600000};
  for(const k in pred)methods[k].push((pred[k]-arr)/60000);}}
const mae=a=>a.reduce((s,x)=>s+Math.abs(x),0)/a.length;
for(const k in methods)console.log(k.padEnd(15),'MAE',mae(methods[k]).toFixed(2),'n',methods[k].length);
