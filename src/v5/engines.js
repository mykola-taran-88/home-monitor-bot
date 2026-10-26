import { age, clamp, comfort, n } from "../constants.js";

export function explainScore(x, timeoutMinutes = 15) {
  const indoor = (x.zones || []).filter((z) => !z.is_outdoor && z.temperature != null && z.humidity != null),
    climate = indoor.length ? Math.round(indoor.reduce((sum,z)=>sum+comfort(z.temperature,z.humidity,z.device_id),0)/indoor.length) : null,
    offline = (x.zones || []).filter((z)=>age(z.created_at)==null||age(z.created_at)>timeoutMinutes).length,
    alerts = x.alerts || [], critical = alerts.filter(a=>a.severity==="critical").length,
    healthPenalty = offline*15+critical*20+alerts.length*3,
    health = clamp(100-healthPenalty),
    overall = clamp(Math.round((climate ?? health)*0.65+health*0.35)),
    confidence = climate==null ? 35 : 100,
    components = [
      ...(climate==null ? [] : [{ code:"climate",label:"Клімат",score:climate,weight:65,points:+(climate*.65).toFixed(2) }]),
      { code:"system",label:"Стан системи",score:health,weight:climate==null?100:35,points:+(health*(climate==null?1:.35)).toFixed(2) },
    ],
    deductions = [];
  if(climate!=null&&climate<100) deductions.push({code:"comfort",label:`Комфорт ${climate}/100`,points:+((100-climate)*.65).toFixed(2),evidence:{comfort:climate}});
  const raw=[{code:"offline_sensors",label:`${offline} несвіжих/offline датчиків`,value:offline*15},{code:"critical_alerts",label:`${critical} критичних алертів`,value:critical*20},{code:"active_alerts",label:`${alerts.length} активних алертів`,value:alerts.length*3}],
    scale=healthPenalty>100?100/healthPenalty:1;
  for(const d of raw) if(d.value) deductions.push({code:d.code,label:d.label,points:+(d.value*scale*(climate==null?1:.35)).toFixed(2),evidence:{count:d.value/(d.code==="offline_sensors"?15:d.code==="critical_alerts"?20:3)}});
  return {overall,comfort:climate,health,confidence,components,deductions,positives:[]};
}

export function prioritizeFacts(facts, max=5) {
  const rank={critical:4,high:3,warning:3,medium:2,info:1};
  return [...facts].sort((a,b)=>(rank[b.severity]||0)-(rank[a.severity]||0)||String(b.timestamp||"").localeCompare(String(a.timestamp||""))).slice(0,max);
}

export function stableFactsKey(facts) {
  let h=2166136261;
  for(const c of JSON.stringify(facts.map(f=>[f.id,f.source_type,f.source_id,f.severity,f.numeric_evidence,f.suggested_action]))) h=Math.imul(h^c.charCodeAt(0),16777619);
  return (h>>>0).toString(16).padStart(8,"0");
}

export function groupBufferedEvents(events) {
  const groups=new Map();
  for(const e of events){const k=e.group_key, g=groups.get(k)||{group_key:k,category_key:e.category_key,items:[],source_ids:[],first_seen_at:e.first_seen_at};g.items.push(...(Array.isArray(e.items)?e.items:[e.payload||e]));g.source_ids.push(...(e.source_ids||[]));groups.set(k,g);}
  return [...groups.values()].map(g=>({...g,source_ids:[...new Set(g.source_ids)]}));
}
