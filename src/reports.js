import { ANALYTICS, n, fmt, age, comfort, kyivDateTime } from "./constants.js";
import { latest, score, now } from "./database.js";
import { tg, send } from "./telegram.js";
import { prioritizeFacts, stableFactsKey } from "./v5/engines.js";

export function kyivDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export function monthStart() {
  return kyivDate().slice(0, 7) + "-01 00:00:00";
}
export function weatherName(c) {
  return (
    {
      0: "ясно",
      1: "переважно ясно",
      2: "мінлива хмарність",
      3: "хмарно",
      45: "туман",
      48: "туман",
      51: "мряка",
      53: "мряка",
      55: "сильна мряка",
      61: "невеликий дощ",
      63: "дощ",
      65: "сильний дощ",
      71: "слабкий сніг",
      73: "сніг",
      75: "сильний сніг",
      80: "зливи",
      81: "зливи",
      82: "сильні зливи",
      95: "гроза",
      96: "гроза з градом",
      99: "сильна гроза",
    }[n(c)] || "невідомі умови"
  );
}
export function weatherEmoji(c) {
  c = n(c);
  if (c === 0) return "☀️";
  if (c <= 3) return "⛅";
  if (c === 45 || c === 48) return "🌫";
  if (c <= 67) return "🌧";
  if (c <= 77) return "❄️";
  if (c <= 82) return "🌦";
  return "⛈";
}
export async function periodEnergy(e, start, end = null) {
  const r = (
    await e.DB.prepare(
      end
        ? "SELECT energy_total,tariff_zone,cost_per_kwh,created_at FROM power_logs WHERE created_at>=? AND created_at<? ORDER BY id"
        : "SELECT energy_total,tariff_zone,cost_per_kwh,created_at FROM power_logs WHERE created_at>=? ORDER BY id",
    )
      .bind(...(end ? [start, end] : [start]))
      .all()
  ).results;
  let day = 0,
    night = 0,
    cost = 0;
  for (let i = 1; i < r.length; i++) {
    const d = n(r[i].energy_total) - n(r[i - 1].energy_total);
    if (!isFinite(d) || d < 0 || d > 100) continue;
    if (r[i].tariff_zone === "night") night += d;
    else day += d;
    cost += d * n(r[i].cost_per_kwh);
  }
  return { total: day + night, day, night, cost, samples: r.length };
}
export async function energyOverview(e) {
  const p = now(),
    today = await periodEnergy(e, `${p.date} 00:00:00`),
    week = await periodEnergy(e, `${kyivDate(-6)} 00:00:00`),
    month = await periodEnergy(e, monthStart()),
    current = await e.DB.prepare(
      "SELECT * FROM power_logs ORDER BY id DESC LIMIT 1",
    ).first(),
    peak = await e.DB.prepare(
      "SELECT power,voltage,created_at FROM power_logs WHERE created_at>=? ORDER BY power DESC LIMIT 1",
    )
      .bind(`${p.date} 00:00:00`)
      .first(),
    days = Math.max(1, n(p.day, 1)),
    daysInMonth = new Date(p.year, p.month, 0).getDate(),
    forecastKwh = (month.total / days) * daysInMonth,
    forecastCost = (month.cost / days) * daysInMonth;
  return { current, today, week, month, peak, forecastKwh, forecastCost };
}
export async function energyText(e) {
  const x = await energyOverview(e);
  return [
    "⚡ ЕНЕРГІЯ",
    `Поточна потужність: ${fmt(x.current?.power, 0)} Вт`,
    `Напруга: ${fmt(x.current?.voltage, 1)} В`,
    `Струм: ${fmt(x.current?.current, 2)} А`,
    `Частота: ${fmt(x.current?.frequency, 1)} Гц`,
    "",
    `📅 Сьогодні: ${fmt(x.today.total, 3)} кВт·год · ${fmt(x.today.cost, 2)} грн`,
    `📆 7 днів: ${fmt(x.week.total, 3)} кВт·год · ${fmt(x.week.cost, 2)} грн`,
    `🗓 Цей місяць: ${fmt(x.month.total, 3)} кВт·год · ${fmt(x.month.cost, 2)} грн`,
    `🌙 День / ніч: ${fmt(x.month.day, 3)} / ${fmt(x.month.night, 3)} кВт·год`,
    "",
    `📈 Пік сьогодні: ${fmt(x.peak?.power, 0)} Вт${x.peak?.created_at ? ` о ${String(x.peak.created_at).slice(11, 16)}` : ""}`,
    `🔮 Прогноз місяця: ${fmt(x.forecastKwh, 1)} кВт·год · ${fmt(x.forecastCost, 0)} грн`,
  ].join("\n");
}
export function forecastDayLabel(date) {
  const today = kyivDate(),
    tomorrow = kyivDate(1);
  if (date === today) return "Сьогодні";
  if (date === tomorrow) return "Завтра";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(date + "T12:00:00Z"));
}
export async function weatherTextRich(e) {
  const from = kyivDateTime(),
    to = kyivDateTime(24 * 60),
    x = await latest(e),
    rows = (
      await e.DB.prepare(
        "SELECT * FROM weather_hourly WHERE forecast_time>=? AND forecast_time<=? ORDER BY forecast_time ASC",
      ).bind(from, to).all()
    ).results;
  const groups = {};
  for (const h of rows) {
    const raw = String(h.forecast_time || ""),
      date = raw.slice(0, 10);
    (groups[date] ??= []).push(h);
  }
  const hourly = [];
  for (const [date, items] of Object.entries(groups)) {
    hourly.push(`📅 ${forecastDayLabel(date)}`);
    for (const h of items)
      hourly.push(
        `${String(h.forecast_time).slice(11, 16)} ${weatherEmoji(h.weather_code)} ${fmt(h.temperature)} °C · дощ ${fmt(h.precipitation_probability, 0)}%`,
      );
    hourly.push("");
  }
  const daily = x.daily.slice(0, 3);
  return [
    "🌦 ПОГОДА",
    `${weatherEmoji(x.weather?.weather_code)} Зараз: ${fmt(x.weather?.temperature)} °C · ${fmt(x.weather?.humidity, 0)}%`,
    `Умови: ${weatherName(x.weather?.weather_code)}`,
    `Вітер: ${fmt(x.weather?.wind_speed, 1)} км/год · Тиск: ${fmt(x.weather?.pressure, 0)} гПа`,
    "",
    "📅 Прогноз на 3 дні:",
    ...daily.map(
      (d) =>
        `${weatherEmoji(d.weather_code)} ${forecastDayLabel(String(d.forecast_date).slice(0, 10))}: ${fmt(d.temp_min)}…${fmt(d.temp_max)} °C · дощ ${fmt(d.precipitation_probability, 0)}%`,
    ),
    "",
    "🕒 Найближчі 24 години (крок 3 год):",
    ...hourly,
  ]
    .join("\n")
    .trim();
}
export async function weatherForecast48hText(e) {
  const from = kyivDateTime(), to = kyivDateTime(27 * 60);
  const rows = (
    await e.DB.prepare(
      "SELECT * FROM weather_hourly WHERE forecast_time>=? AND forecast_time<=? ORDER BY forecast_time ASC",
    ).bind(from, to).all()
  ).results;
  if (!rows.length) return "🌦 ПРОГНОЗ ПОГОДИ НА 24 ГОДИНИ\nНемає актуальних погодинних даних.";
  const groups = {};
  for (const h of rows) {
    const date = String(h.forecast_time || "").slice(0, 10);
    (groups[date] ??= []).push(h);
  }
  const lines = ["🌦 ПРОГНОЗ ПОГОДИ НА НАСТУПНІ 24 ГОДИНИ", "Крок прогнозу — 3 години."];
  for (const [date, items] of Object.entries(groups)) {
    lines.push("", `📅 ${forecastDayLabel(date)}`);
    for (const h of items)
      lines.push(
        `${String(h.forecast_time).slice(11, 16)} ${weatherEmoji(h.weather_code)} ${fmt(h.temperature)} °C · дощ ${fmt(h.precipitation_probability, 0)}%`,
      );
  }
  return lines.join("\n");
}
export async function scoreText(e) {
  const x = await latest(e),
    s = score(x),
    indoor = x.zones.filter((z) => !z.is_outdoor && z.temperature != null),
    offline = x.zones.filter(
      (z) => age(z.created_at) > 15 || age(z.created_at) == null,
    ),
    critical = x.alerts.filter((a) => a.severity === "critical"),
    roomScores = indoor
      .map((z) => ({
        name: z.device_name || z.device_id,
        v: comfort(z.temperature, z.humidity),
      }))
      .sort((a, b) => b.v - a.v),
    reasons = [];
  if (s.comfort == null)
    reasons.push("ℹ️ Кліматичний компонент: недостатньо даних");
  else if (s.comfort >= 90)
    reasons.push("✅ Клімат у кімнатах близький до оптимального");
  else reasons.push(`⚠️ Комфорт знижений: середня оцінка ${s.comfort}/100`);
  if (!offline.length) reasons.push("✅ Усі датчики передають свіжі дані");
  else reasons.push(`⚠️ Несвіжі/offline датчики: ${offline.length}`);
  if (critical.length) reasons.push(`🔴 Критичні алерти: ${critical.length}`);
  else reasons.push("✅ Критичних алертів немає");
  if (x.alerts.length)
    reasons.push(`ℹ️ Усього активних алертів: ${x.alerts.length}`);
  if (x.power?.voltage >= 200 && x.power?.voltage <= 250)
    reasons.push("✅ Напруга в нормальному діапазоні");
  return [
    "📊 HOME SCORE",
    `Загальна оцінка: ${s.overall}/100`,
    `Клімат: ${s.comfort == null ? "немає достатніх даних" : `${s.comfort}/100`}`,
    `Стан системи: ${s.health}/100`,
    `Впевненість: ${s.confidence}%`,
    "",
    "Що вплинуло на оцінку:",
    ...(s.deductions.length
      ? s.deductions.map((d) => `−${fmt(d.points, 0)}: ${d.label}`)
      : ["✅ Немає зафіксованих списань балів"]),
    "",
    "Що добре:",
    ...reasons.filter((x) => x.startsWith("✅")),
    ...reasons.filter((x) => !x.startsWith("✅")),
    "",
    roomScores.length
      ? `🏆 Найкраща кімната: ${roomScores[0].name} · ${roomScores[0].v}/100`
      : "",
    roomScores.length > 1
      ? `📉 Потребує уваги: ${roomScores.at(-1).name} · ${roomScores.at(-1).v}/100`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
export async function homeSummaryRich(e) {
  const x = await latest(e),
    en = await energyOverview(e),
    s = score(x),
    today = x.daily[0],
    tomorrow = x.daily[1],
    z = x.zones.filter((a) => !a.is_outdoor && a.temperature != null),
    avg = z.length
      ? z.reduce((q, a) => q + n(a.temperature), 0) / z.length
      : null;
  return [
    "🏠 ЗВЕДЕННЯ ДОМУ",
    `📊 Home Score: ${s.overall}/100`,
    `🌡 Вдома: ${fmt(avg)} °C`,
    `⚡ Зараз: ${fmt(x.power?.power, 0)} Вт · ${fmt(x.power?.voltage, 1)} В`,
    `📅 Сьогодні: ${fmt(en.today.total, 3)} кВт·год · ${fmt(en.today.cost, 2)} грн`,
    `🗓 Місяць: ${fmt(en.month.total, 3)} кВт·год · ${fmt(en.month.cost, 2)} грн`,
    "",
    `🌦 Сьогодні: ${today ? `${fmt(today.temp_min)}…${fmt(today.temp_max)} °C · дощ ${fmt(today.precipitation_probability, 0)}%` : "—"}`,
    `🌦 Завтра: ${tomorrow ? `${fmt(tomorrow.temp_min)}…${fmt(tomorrow.temp_max)} °C · дощ ${fmt(tomorrow.precipitation_probability, 0)}%` : "—"}`,
    `🚨 Активні алерти: ${x.alerts.length}`,
    x.recs[0]
      ? `💡 ${x.recs[0].title}: ${x.recs[0].message}`
      : "✅ Термінових рекомендацій немає",
  ].join("\n");
}

export async function sleepText(e) {
  const row = await e.DB.prepare("SELECT * FROM house_sleep_scores ORDER BY sleep_date DESC LIMIT 1").first();
  if (!row) return "🌙 НІЧНИЙ ПІДСУМОК\nОцінку ще не розраховано: потрібні нічні дані після 07:00.";
  let c={}, reasons=[];
  try { c=JSON.parse(row.components_json||"{}"); reasons=JSON.parse(row.reasons_json||"[]"); } catch {}
  const component = (key,label,max) => c.components?.find(x=>x.key===key)?.available
    ? `${label}: ${fmt(c.components.find(x=>x.key===key).score,0)}/${max}`
    : `${label}: недостатньо даних`;
  return [
    "🌙 НІЧНИЙ ПІДСУМОК",
    `Sleep Score дому: ${row.score ?? "—"}/100 · даних ${row.confidence}%`,
    component("climate","🌡 Клімат",40),
    component("reliability","📡 Система",25),
    c.night_energy_available ? `⚡ Нічна енергія: ${fmt(c.night_energy_kwh,2)} кВт·год` : "⚡ Нічна енергія: немає базового порівняння",
    component("events","🚨 Події",15),
    reasons.length ? `\nГоловне: ${reasons[0]}` : "",
  ].filter(Boolean).join("\n");
}

async function caretakerFacts(e) {
  const x=await latest(e), s=score(x), en=await energyOverview(e), facts=[];
  const add=(f)=>facts.push({...f,numeric_evidence:f.numeric_evidence??[...String(`${f.title} ${f.body}`).matchAll(/-?\d+(?:[.,]\d+)?/g)].map(m=>m[0])});
  for(const a of x.alerts.filter(a=>["critical","warning"].includes(a.severity)))
    add({id:`alert:${a.id}`,source_type:"alert",source_id:String(a.id),severity:a.severity,timestamp:a.created_at,numeric_evidence:{value:a.alert_value,threshold:a.alert_threshold},title:a.alert_message,body:a.alert_message,suggested_action:"Перевірити активну подію."});
  for(const r of x.recs)
    add({id:`recommendation:${r.recommendation_key||r.id}`,source_type:"recommendation",source_id:String(r.recommendation_key||r.id),severity:r.priority==="critical"?"critical":r.priority==="high"?"high":r.priority==="medium"?"medium":"info",timestamp:r.last_seen_at||r.created_at,numeric_evidence:{value:r.recommendation_key==="bill"?r.metadata_json:null},title:r.title,body:r.message,suggested_action:r.action||""});
  for(const d of s.deductions)
    add({id:`score:${d.code}`,source_type:"home_score",source_id:d.code,severity:"warning",timestamp:new Date().toISOString(),numeric_evidence:d.evidence,title:d.label,body:`Home Score ${s.overall}/100. ${d.label}.`,suggested_action:"Переглянути показники дому."});
  const sleep=await e.DB.prepare("SELECT * FROM house_sleep_scores ORDER BY sleep_date DESC LIMIT 1").first();
  if(sleep&&sleep.score!=null)
    add({id:`sleep:${sleep.sleep_date}`,source_type:"sleep_score",source_id:sleep.sleep_date,severity:"info",timestamp:sleep.created_at,numeric_evidence:{score:sleep.score,confidence:sleep.confidence},title:`Нічний Sleep Score ${sleep.score}/100`,body:`Даних ${sleep.confidence}%. ${JSON.parse(sleep.reasons_json||"[]")[0]||""}`,suggested_action:"Переглянути нічний підсумок."});
  const daily=x.daily[0];
  if(daily&&(n(daily.precipitation_probability)>=70||[45,48,65,75,82,86,95,96,99].includes(n(daily.weather_code))))
    add({id:`weather:${daily.forecast_date}`,source_type:"weather",source_id:String(daily.forecast_date),severity:"high",timestamp:daily.forecast_date,numeric_evidence:{precipitation_probability:n(daily.precipitation_probability),weather_code:n(daily.weather_code)},title:"Погодні умови потребують уваги",body:`Опади ${fmt(daily.precipitation_probability,0)}% · ${String(daily.forecast_date).slice(0,10)}.`,suggested_action:"Перевірити прогноз перед виходом."});
  if(en.month.samples>1)
    add({id:`energy:${now().date}`,source_type:"energy",source_id:now().date,severity:"info",timestamp:new Date().toISOString(),numeric_evidence:{month_kwh:en.month.total,month_cost:en.month.cost,forecast_cost:en.forecastCost},title:"Енергія та прогноз рахунку",body:`Місяць: ${fmt(en.month.total,1)} кВт·год · ${fmt(en.month.cost,0)} грн. Прогноз: ${fmt(en.forecastCost,0)} грн.`,suggested_action:"Переглянути споживання день/ніч."});
  const unique=new Map(); for(const f of facts) if(!unique.has(f.id)) unique.set(f.id,f);
  return prioritizeFacts([...unique.values()],30);
}

export async function caretakerReport(e) {
  const facts=await caretakerFacts(e), picked=prioritizeFacts(facts,5), ids=new Set(picked.map(f=>f.id));
  let ordered=picked, fallbackUsed=true;
  if(picked.length&&e.AI) try {
    const prompt=JSON.stringify(picked.map(({id,source_type,severity,title,body,suggested_action})=>({id,source_type,severity,title,body,suggested_action})));
    const res=await e.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast",{messages:[{role:"system",content:"You may only reorder and deduplicate the supplied fact IDs. Return JSON {ids:[...]}, with at most five IDs. Add no facts, text, numbers or IDs."},{role:"user",content:prompt}],temperature:0,max_tokens:300});
    const parsed=JSON.parse(String(res.response||"").slice(String(res.response||"").indexOf("{"),String(res.response||"").lastIndexOf("}")+1));
    const order=[...new Set((parsed.ids||[]).filter(id=>ids.has(id)))], map=new Map(picked.map(f=>[f.id,f]));
    if(order.length){ordered=order.map(id=>map.get(id));fallbackUsed=false;}
  } catch {}
  const critical=ordered.filter(f=>f.severity==="critical"), today=ordered.filter(f=>["high","warning","medium"].includes(f.severity)),
    other=ordered.filter(f=>!critical.includes(f)&&!today.includes(f)), savings=other.filter(f=>f.source_type==="energy"||f.source_id==="bill"),
    recommended=other.filter(f=>!savings.includes(f)), lines=["🧠 AI CARETAKER"];
  const section=(title,items)=>{if(items.length){lines.push("",title);for(const f of items)lines.push(`• ${f.title}${f.body&&f.body!==f.title?`: ${f.body}`:""}${f.suggested_action?`\n  Дія: ${f.suggested_action}`:""}`);}};
  section("🔴 Критично",critical); section("🟠 Сьогодні",today); section("🟢 Рекомендовано",recommended); section("💰 Економія",savings);
  if(!ordered.length) lines.push("\n✅ Немає активних проблем, що потребують дії.");
  const text=lines.join("\n").slice(0,3900), dedupeKey=stableFactsKey(ordered), sourceIds=ordered.map(f=>f.source_id);
  await e.DB.prepare("INSERT OR IGNORE INTO caretaker_runs(dedupe_key,facts_json,output_text,fallback_used,output_length) VALUES(?,?,?,?,?)").bind(dedupeKey,JSON.stringify(ordered),text,fallbackUsed?1:0,text.length).run();
  const first=ordered.find(f=>f.source_type==="recommendation"&&f.source_id), rid=first?await e.DB.prepare("SELECT id FROM recommendations WHERE recommendation_key=? AND status='active' ORDER BY id DESC LIMIT 1").bind(first.source_id).first():null;
  return {text,facts:ordered,dedupeKey,sourceIds,fallbackUsed,keyboard:{inline_keyboard:[...(rid?[[{text:"✅ Виконано",callback_data:`recdone:${rid.id}`},{text:"🔕 Нагадати",callback_data:`recsnooze:${rid.id}:60` }]]:[]),[{text:"📋 Усі поради",callback_data:"recs:active"}]]}};
}

export async function smartMorningDigest(e) {
  const digestLimit=Math.min(5,Math.max(1,n((await e.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='smart_digest_max_items'").first())?.setting_value,3))),
    x=await latest(e), s=score(x), en=await energyOverview(e), facts=prioritizeFacts((await caretakerFacts(e)).filter(f=>f.source_type!=="home_score"),digestLimit),
    today=x.daily[0], sleep=await e.DB.prepare("SELECT * FROM house_sleep_scores ORDER BY sleep_date DESC LIMIT 1").first(),
    yesterday=kyivDate(-1), yEnergy=await periodEnergy(e,`${yesterday} 00:00:00`,`${kyivDate()} 00:00:00`),
    issueCount=x.recs.filter(r=>r.category!=="cost").length+x.alerts.filter(a=>a.severity==="critical").length,
    lines=[issueCount?`⚠️ Потрібна увага до ${issueCount} речей`:"✅ Усе добре","\n🔎 Головне"];
  for(const f of facts)lines.push(`• ${f.title}${f.body&&f.body!==f.title?`: ${f.body}`:""}`);
  lines.push(`\n📊 Home Score: ${s.overall}/100 · впевненість ${s.confidence}%`);
  if(s.deductions.length)lines.push(`Причини: ${s.deductions.slice(0,2).map(d=>d.label).join("; ")}`);
  if(sleep)lines.push(`\n🌙 Sleep Score: ${sleep.score??"—"}/100 · даних ${sleep.confidence}%`);
  lines.push(`\n🌦 Погода: ${today?`${fmt(today.temp_min)}…${fmt(today.temp_max)} °C · опади ${fmt(today.precipitation_probability,0)}%`:"даних немає"}`);
  lines.push(`⚡ Вчора: ${fmt(yEnergy.total,2)} кВт·год · місяць: ${fmt(en.month.total,1)} кВт·год / ${fmt(en.month.cost,0)} грн`);
  const bill=x.recs.find(r=>r.recommendation_key==="bill"); if(bill)lines.push(`💰 ${bill.message.split("\n")[0]}`);
  return {text:lines.join("\n").slice(0,1500),keyboard:{inline_keyboard:[[{text:"📋 Деталі",callback_data:"a:home"},{text:"🧠 Caretaker",callback_data:"m:caretaker"}],[{text:"🌙 Ніч",callback_data:"a:night"},{text:"⚡ Енергія",callback_data:"a:energy"},{text:"🚨 Події",callback_data:"m:events"}]]}};
}
export async function analyticsText(e, days) {
  const start = `${kyivDate(-(days - 1))} 00:00:00`,
    en = await periodEnergy(e, start),
    r = await e.DB.prepare(
      "SELECT ROUND(AVG(power),1) avg_power,ROUND(MAX(power),1) peak_power,ROUND(AVG(voltage),1) avg_voltage,ROUND(MIN(voltage),1) min_voltage,ROUND(MAX(voltage),1) max_voltage FROM power_logs WHERE created_at>=?",
    )
      .bind(start)
      .first(),
    t = await e.DB.prepare(
      "SELECT ROUND(AVG(temperature),1) avg_temp,ROUND(MIN(temperature),1) min_temp,ROUND(MAX(temperature),1) max_temp FROM climate_logs WHERE created_at>=?",
    )
      .bind(start)
      .first();
  return [
    `📊 АНАЛІТИКА · ${days === 1 ? "СЬОГОДНІ" : days + " ДНІВ"}`,
    `⚡ Споживання: ${fmt(en.total, 3)} кВт·год`,
    `💰 Вартість: ${fmt(en.cost, 2)} грн`,
    `📅 Середньодобове: ${fmt(en.total / Math.max(1, days), 3)} кВт·год`,
    `📈 Середня / пікова потужність: ${fmt(r?.avg_power, 0)} / ${fmt(r?.peak_power, 0)} Вт`,
    `🔌 Напруга min / avg / max: ${fmt(r?.min_voltage, 1)} / ${fmt(r?.avg_voltage, 1)} / ${fmt(r?.max_voltage, 1)} В`,
    `🌡 Температура min / avg / max: ${fmt(t?.min_temp)} / ${fmt(t?.avg_temp)} / ${fmt(t?.max_temp)} °C`,
  ].join("\n");
}
export function chartUrl(config) {
  return `https://quickchart.io/chart?width=900&height=500&backgroundColor=white&version=4&c=${encodeURIComponent(JSON.stringify(config))}`;
}
export async function chartConfigs(e, days) {
  const start = `${kyivDate(-(days - 1))} 00:00:00`;
  const power = (
    await e.DB.prepare(
      "SELECT substr(created_at,1,10) d,ROUND(AVG(power),0) avg_power,ROUND(MAX(power),0) peak_power,ROUND(AVG(voltage),1) avg_v,ROUND(MIN(voltage),1) min_v,ROUND(MAX(voltage),1) max_v,MIN(energy_total) e0,MAX(energy_total) e1,ROUND(AVG(cost_per_kwh),3) tariff FROM power_logs WHERE created_at>=? GROUP BY substr(created_at,1,10) ORDER BY d",
    )
      .bind(start)
      .all()
  ).results;
  const climate = (
    await e.DB.prepare(
      "SELECT substr(c.created_at,1,10) d,c.device_id,COALESCE(d.device_name,c.device_id) name,ROUND(AVG(c.temperature),1) temp FROM climate_logs c LEFT JOIN devices d ON d.device_id=c.device_id WHERE c.created_at>=? GROUP BY substr(c.created_at,1,10),c.device_id ORDER BY d",
    )
      .bind(start)
      .all()
  ).results;
  if (!power.length && !climate.length) return [];
  const labels = [
    ...new Set([...power.map((x) => x.d), ...climate.map((x) => x.d)]),
  ].sort();
  const byDay = Object.fromEntries(power.map((x) => [x.d, x]));
  const kwh = labels.map((d) => {
    const x = byDay[d];
    return x ? Math.max(0, n(x.e1) - n(x.e0)) : null;
  });
  const cost = labels.map((d, i) => {
    const x = byDay[d];
    return x == null || kwh[i] == null
      ? null
      : +(kwh[i] * n(x.tariff)).toFixed(2);
  });
  const temps = {};
  for (const x of climate) (temps[x.name] ??= []).push({ d: x.d, v: x.temp });
  const dayLabels = labels.map((x) => x.slice(5));
  return [
    {
      caption: `⚡ Споживання за ${days} дн.`,
      config: {
        type: "bar",
        data: {
          labels: dayLabels,
          datasets: [
            { label: "кВт·год", data: kwh, backgroundColor: "#35b9c7" },
          ],
        },
        options: {
          plugins: {
            title: { display: true, text: "Споживання електроенергії" },
          },
        },
      },
    },
    {
      caption: `💰 Вартість за ${days} дн.`,
      config: {
        type: "bar",
        data: {
          labels: dayLabels,
          datasets: [{ label: "грн", data: cost, backgroundColor: "#f6b73c" }],
        },
        options: {
          plugins: {
            title: { display: true, text: "Вартість електроенергії" },
          },
        },
      },
    },
    {
      caption: `🔌 Напруга за ${days} дн.`,
      config: {
        type: "line",
        data: {
          labels: dayLabels,
          datasets: [
            {
              label: "Min V",
              data: labels.map((d) => byDay[d]?.min_v ?? null),
              borderColor: "#ff647c",
              spanGaps: true,
            },
            {
              label: "Avg V",
              data: labels.map((d) => byDay[d]?.avg_v ?? null),
              borderColor: "#35b9c7",
              spanGaps: true,
            },
            {
              label: "Max V",
              data: labels.map((d) => byDay[d]?.max_v ?? null),
              borderColor: "#7656d9",
              spanGaps: true,
            },
          ],
        },
        options: {
          plugins: {
            title: { display: true, text: "Напруга min / avg / max" },
          },
        },
      },
    },
    {
      caption: `🌡 Температура за ${days} дн.`,
      config: {
        type: "line",
        data: {
          labels: dayLabels,
          datasets: Object.entries(temps)
            .slice(0, 6)
            .map(([name, arr], i) => ({
              label: name,
              data: labels.map((d) => arr.find((x) => x.d === d)?.v ?? null),
              borderColor: [
                "#e74c3c",
                "#3498db",
                "#2ecc71",
                "#9b59b6",
                "#f39c12",
                "#34495e",
              ][i],
              spanGaps: true,
            })),
        },
        options: {
          plugins: {
            title: { display: true, text: "Температура по кімнатах" },
          },
        },
      },
    },
  ];
}
export async function chart(e, id, days) {
  await send(e, id, await analyticsText(e, days), ANALYTICS);
  return sendChartPack(e, id, days);
}
export async function sendChartPack(e, id, days) {
  const cs = await chartConfigs(e, days);
  if (!cs.length) return send(e, id, "Немає даних для графіків.");
  for (const x of cs)
    try {
      await tg(e, "sendPhoto", {
        chat_id: id,
        photo: chartUrl(x.config),
        caption: x.caption,
      });
    } catch (err) {
      console.error("CHART_SEND", err);
    }
}
