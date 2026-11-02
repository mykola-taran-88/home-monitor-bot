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
function climateCoverage(zones) {
  const indoor = zones.filter((z) => !z.is_outdoor),
    fresh = indoor.filter((z) => z.temperature != null && z.humidity != null && age(z.created_at) != null && age(z.created_at) <= 15).length;
  return { expected: indoor.length, fresh, percent: indoor.length ? Math.round(fresh / indoor.length * 100) : null };
}
export async function periodEnergy(e, start, end = null) {
  const row = await e.DB.prepare(
    end
      ? "SELECT COALESCE(SUM(energy_day),0) day,COALESCE(SUM(energy_night),0) night,COALESCE(SUM(cost_day+cost_night),0) cost,COALESCE(SUM(sample_count),0) samples FROM power_hourly WHERE hour_start>=? AND hour_start<?"
      : "SELECT COALESCE(SUM(energy_day),0) day,COALESCE(SUM(energy_night),0) night,COALESCE(SUM(cost_day+cost_night),0) cost,COALESCE(SUM(sample_count),0) samples FROM power_hourly WHERE hour_start>=?",
  )
    .bind(...(end ? [start, end] : [start]))
    .first();
  const day = n(row?.day),
    night = n(row?.night),
    cost = n(row?.cost);
  return { total: day + night, day, night, cost, samples: n(row?.samples) };
}
let energyOverviewMemo = null;
export async function energyOverview(e) {
  if (energyOverviewMemo && energyOverviewMemo.expiresAt > Date.now())
    return energyOverviewMemo.promise;

  const promise = (async () => {
    const p = now(),
      todayStart = `${p.date} 00:00:00`,
      weekStart = `${kyivDate(-6)} 00:00:00`,
      monthStartAt = monthStart(),
      starts = [todayStart, weekStart, monthStartAt],
      from = starts.reduce((a, b) => (a < b ? a : b)),
      [rows, current, peak] = await Promise.all([
        e.DB.prepare(
          "SELECT substr(hour_start,1,10) day, SUM(energy_day) energy_day, SUM(energy_night) energy_night, SUM(cost_day) cost_day, SUM(cost_night) cost_night, SUM(sample_count) sample_count, SUM(CASE WHEN sample_count>0 THEN 1 ELSE 0 END) observed_hours FROM power_hourly WHERE hour_start>=? GROUP BY substr(hour_start,1,10) ORDER BY day",
        )
          .bind(from)
          .all(),
        e.DB.prepare("SELECT * FROM power_logs ORDER BY id DESC LIMIT 1").first(),
        e.DB.prepare(
          "SELECT power_max AS power,power_peak_voltage AS voltage,power_peak_at AS created_at FROM power_hourly WHERE hour_start>=? ORDER BY power_max DESC LIMIT 1",
        )
          .bind(todayStart)
          .first(),
      ]),
      periods = [todayStart, weekStart, monthStartAt].map((start) => ({
        start,
        day: 0,
        night: 0,
        cost: 0,
        samples: 0,
      })),
      powerRows = rows.results;

    for (const row of powerRows) {
      for (const period of periods) {
        if (`${row.day} 00:00:00` < period.start) continue;
        period.samples += n(row.sample_count);
        period.day += n(row.energy_day);
        period.night += n(row.energy_night);
        period.cost += n(row.cost_day) + n(row.cost_night);
      }
    }

    const [today, week, month] = periods.map((period) => ({
        total: period.day + period.night,
        day: period.day,
        night: period.night,
        cost: period.cost,
        samples: period.samples,
      })),
      days = Math.max(1, n(p.day, 1)),
      daysInMonth = new Date(p.year, p.month, 0).getDate(),
      forecastKwh = (month.total / days) * daysInMonth,
      forecastCost = (month.cost / days) * daysInMonth,
      observedHours = powerRows.reduce((sum, row) => sum + n(row.observed_hours), 0),
      elapsedHours = Math.max(1, Math.min(days * 24, (days - 1) * 24 + p.hour + 1)),
      hourCoverage = Math.min(100, Math.round(observedHours / elapsedHours * 100)),
      forecastConfidence = days < 7 ? "низька · мало історії" : hourCoverage >= 80 && days >= 20 ? "висока" : hourCoverage >= 50 ? "середня" : "низька · є пропуски",
      dailyCosts = powerRows.filter((row) => n(row.sample_count) > 0).map((row) => n(row.cost_day) + n(row.cost_night)),
      dailyMean = dailyCosts.length ? dailyCosts.reduce((sum, value) => sum + value, 0) / dailyCosts.length : 0,
      dailyStdDev = dailyCosts.length > 1 ? Math.sqrt(dailyCosts.reduce((sum, value) => sum + (value - dailyMean) ** 2, 0) / dailyCosts.length) : 0,
      remainingDays = Math.max(0, daysInMonth - days),
      dailyUncertainty = days < 7 ? Math.max(dailyMean * 0.5, dailyStdDev) : Math.max(dailyMean * 0.1, dailyStdDev * 0.5),
      forecastLow = Math.max(0, forecastCost - dailyUncertainty * remainingDays),
      forecastHigh = forecastCost + dailyUncertainty * remainingDays;
    return { current, today, week, month, peak, forecastKwh, forecastCost, forecastLow, forecastHigh, forecastConfidence, hourCoverage, observedHours, elapsedHours };
  })();

  energyOverviewMemo = { expiresAt: Date.now() + 30_000, promise };
  try {
    return await promise;
  } catch (error) {
    if (energyOverviewMemo?.promise === promise) energyOverviewMemo = null;
    throw error;
  }
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
    `📊 Прогноз: ${fmt(x.forecastCost, 0)} грн · орієнтир ${fmt(x.forecastLow, 0)}–${fmt(x.forecastHigh, 0)} грн`,
    `Впевненість: ${x.forecastConfidence} · проєкція за середнім фактом на день`,
    `Середнє за день: ${fmt(x.month.cost / Math.max(1, now().day), 2)} грн · дані є за ${x.observedHours} з ${x.elapsedHours} год`,
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
  if (!rows.length) return "🌦 ПРОГНОЗ ПОГОДИ НА 27 ГОДИН\nНемає актуальних погодинних даних.";
  const groups = {};
  for (const h of rows) {
    const date = String(h.forecast_time || "").slice(0, 10);
    (groups[date] ??= []).push(h);
  }
  const lines = ["🌦 ПРОГНОЗ ПОГОДИ НА НАСТУПНІ 27 ГОДИН", "Крок прогнозу — 3 години."];
  for (const [date, items] of Object.entries(groups)) {
    lines.push("", `📅 ${forecastDayLabel(date)}`);
    for (const h of items)
      lines.push(
        `${String(h.forecast_time).slice(11, 16)} ${weatherEmoji(h.weather_code)} ${fmt(h.temperature)} °C · дощ ${fmt(h.precipitation_probability, 0)}%${n(h.wind_speed) >= 50 ? ` · вітер ${fmt(h.wind_speed, 0)} км/год` : ""}`,
      );
  }
  return lines.join("\n");
}
export async function scoreText(e) {
  const x = await latest(e),
    s = score(x),
    coverage = climateCoverage(x.zones),
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
    `Впевненість оцінки: ${s.confidence}%`,
    `Свіжі кліматичні дані: ${coverage.percent == null ? "немає кімнатних датчиків" : `${coverage.fresh}/${coverage.expected} датчиків · ${coverage.percent}%`}`,
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
  const roomLines = z.slice(0, 4).map((room) => {
    const minutes = age(room.created_at), fresh = minutes != null && minutes <= 15,
      roomComfort = room.humidity == null ? null : comfort(room.temperature, room.humidity);
    return `${roomComfort != null && roomComfort < 65 ? "🟠" : "🌡"} ${room.device_name || room.device_id}: ${fmt(room.temperature)}°C · ${fmt(room.humidity, 0)}% · комфорт ${roomComfort == null ? "—" : `${roomComfort}/100`} · ${fresh ? `дані ${minutes} хв тому` : `несвіжі дані${minutes == null ? "" : ` · ${minutes} хв`}`}`;
  });
  const coverage = climateCoverage(x.zones);
  return [
    "🏠 ЗВЕДЕННЯ ДОМУ",
    `📊 Home Score: ${s.overall}/100`,
    `🌡 Вдома: ${fmt(avg)} °C`,
    `📡 Свіжі кліматичні дані: ${coverage.percent == null ? "немає кімнатних датчиків" : `${coverage.fresh}/${coverage.expected} · ${coverage.percent}%`}`,
    ...roomLines,
    `⚡ Зараз: ${fmt(x.power?.power, 0)} Вт · ${fmt(x.power?.voltage, 1)} В · ${age(x.power?.created_at) == null ? "немає часу виміру" : `дані ${age(x.power.created_at)} хв тому`}`,
    `📅 Сьогодні: ${fmt(en.today.total, 3)} кВт·год · ${fmt(en.today.cost, 2)} грн`,
    `🗓 Місяць: ${fmt(en.month.total, 3)} кВт·год · ${fmt(en.month.cost, 2)} грн`,
    `🔮 Прогноз витрат: ${fmt(en.forecastCost, 0)} грн · орієнтир ${fmt(en.forecastLow, 0)}–${fmt(en.forecastHigh, 0)} грн · ${en.forecastConfidence}`,
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
    c.devices_total != null ? `📡 Датчики: ${c.devices_seen ?? 0}/${c.devices_total} працювали вночі` : "",
    c.coverage != null ? `Покриття вимірювань: ${fmt(c.coverage, 0)}%` : "",
    component("climate","🌡 Клімат",40),
    component("reliability","📡 Система",25),
    c.night_energy_available ? `⚡ Нічна енергія: ${fmt(c.night_energy_kwh,2)} кВт·год` : "⚡ Нічна енергія: немає базового порівняння",
    component("events","🚨 Події",15),
    reasons.length ? `\nГоловне: ${reasons[0]}` : "",
  ].filter(Boolean).join("\n");
}

async function caretakerFacts(e) {
  const x=await latest(e), s=score(x), en=await energyOverview(e), facts=[];
  const activeKeys=[...new Set(x.recs.map(r=>r.recommendation_key).filter(Boolean))],
    feedbackRows=activeKeys.length ? (await e.DB.prepare(
      `SELECT recommendation_key FROM recommendation_feedback WHERE action='not_useful' AND created_at>=datetime('now','-30 days') AND recommendation_key IN (${activeKeys.map(()=>"?").join(",")}) GROUP BY recommendation_key HAVING COUNT(DISTINCT substr(created_at,1,10))>=3`,
    ).bind(...activeKeys).all()).results : [],
    notUseful=new Set(feedbackRows.map(row=>row.recommendation_key));
  const add=(f)=>facts.push({...f,numeric_evidence:f.numeric_evidence??[...String(`${f.title} ${f.body}`).matchAll(/-?\d+(?:[.,]\d+)?/g)].map(m=>m[0])});
  for(const a of x.alerts.filter(a=>["critical","warning"].includes(a.severity)))
    add({id:`alert:${a.id}`,source_type:"alert",source_id:String(a.id),severity:a.severity,timestamp:a.created_at,numeric_evidence:{value:a.alert_value,threshold:a.alert_threshold},title:a.alert_message,body:a.alert_message,suggested_action:"Перевірити активну подію."});
  for(const r of x.recs) {
    if(notUseful.has(r.recommendation_key) && ["low","info"].includes(r.priority)) continue;
    add({id:`recommendation:${r.recommendation_key||r.id}`,source_type:"recommendation",source_id:String(r.recommendation_key||r.id),severity:r.priority==="critical"?"critical":r.priority==="high"?"high":r.priority==="medium"?"medium":"info",timestamp:r.last_seen_at||r.created_at,numeric_evidence:{value:r.recommendation_key==="bill"?r.metadata_json:null},title:r.title,body:r.message,suggested_action:r.action||""});
  }
  for(const d of s.deductions)
    add({id:`score:${d.code}`,source_type:"home_score",source_id:d.code,severity:"warning",timestamp:new Date().toISOString(),numeric_evidence:d.evidence,title:d.label,body:`Home Score ${s.overall}/100. ${d.label}.`,suggested_action:"Переглянути показники дому."});
  const sleep=await e.DB.prepare("SELECT * FROM house_sleep_scores ORDER BY sleep_date DESC LIMIT 1").first();
  if(sleep&&sleep.score!=null)
    add({id:`sleep:${sleep.sleep_date}`,source_type:"sleep_score",source_id:sleep.sleep_date,severity:"info",timestamp:sleep.created_at,numeric_evidence:{score:sleep.score,confidence:sleep.confidence},title:`Нічний Sleep Score ${sleep.score}/100`,body:`Даних ${sleep.confidence}%. ${JSON.parse(sleep.reasons_json||"[]")[0]||""}`,suggested_action:"Переглянути нічний підсумок."});
  const daily=x.daily[0];
  if(daily&&(n(daily.precipitation_probability)>=70||[45,48,65,75,82,86,95,96,99].includes(n(daily.weather_code))))
    add({id:`weather:${daily.forecast_date}`,source_type:"weather",source_id:String(daily.forecast_date),severity:"high",timestamp:daily.forecast_date,numeric_evidence:{precipitation_probability:n(daily.precipitation_probability),weather_code:n(daily.weather_code)},title:"Погодні умови потребують уваги",body:`Опади ${fmt(daily.precipitation_probability,0)}% · ${String(daily.forecast_date).slice(0,10)}.`,suggested_action:"Перевірити прогноз перед виходом."});
  if(en.month.samples>1)
    add({id:`energy:${now().date}`,source_type:"energy",source_id:now().date,severity:"info",timestamp:new Date().toISOString(),numeric_evidence:{month_kwh:en.month.total,month_cost:en.month.cost,forecast_cost:en.forecastCost,confidence:en.forecastConfidence,observed_hours:en.observedHours},title:"Енергія та прогноз рахунку",body:`Місяць: ${fmt(en.month.total,1)} кВт·год · ${fmt(en.month.cost,0)} грн. Прогноз: ${fmt(en.forecastCost,0)} грн (${en.forecastConfidence}).`,suggested_action:"Переглянути споживання день/ніч."});
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
  const climateData=climateCoverage(x.zones);
  lines.push(`📡 Свіжі датчики: ${climateData.percent==null?"немає":`${climateData.fresh}/${climateData.expected} (${climateData.percent}%)`}`);
  if(s.deductions.length)lines.push(`Причини: ${s.deductions.slice(0,2).map(d=>d.label).join("; ")}`);
  if(sleep)lines.push(`\n🌙 Sleep Score: ${sleep.score??"—"}/100 · даних ${sleep.confidence}%`);
  lines.push(`\n🌦 Погода: ${today?`${fmt(today.temp_min)}…${fmt(today.temp_max)} °C · опади ${fmt(today.precipitation_probability,0)}%`:"даних немає"}`);
  lines.push(`⚡ Вчора: ${fmt(yEnergy.total,2)} кВт·год · місяць: ${fmt(en.month.total,1)} кВт·год / ${fmt(en.month.cost,0)} грн`);
  const bill=x.recs.find(r=>r.recommendation_key==="bill"); if(bill)lines.push(`💰 ${bill.message.split("\n")[0]} · орієнтир ${fmt(en.forecastLow,0)}–${fmt(en.forecastHigh,0)} грн · ${en.forecastConfidence}`);
  return {text:lines.join("\n").slice(0,1500),keyboard:{inline_keyboard:[[{text:"📋 Деталі",callback_data:"a:home"},{text:"🧠 Caretaker",callback_data:"m:caretaker"}],[{text:"🌙 Ніч",callback_data:"a:night"},{text:"⚡ Енергія",callback_data:"a:energy"},{text:"🚨 Події",callback_data:"m:events"}]]}};
}
export async function analyticsText(e, days) {
  const start = `${kyivDate(-(days - 1))} 00:00:00`,
    en = await periodEnergy(e, start),
    r = await e.DB.prepare(
      "SELECT ROUND(SUM(power_sum)/NULLIF(SUM(power_count),0),1) avg_power,ROUND(MAX(power_max),1) peak_power,ROUND(SUM(voltage_sum)/NULLIF(SUM(voltage_count),0),1) avg_voltage,ROUND(MIN(voltage_min),1) min_voltage,ROUND(MAX(voltage_max),1) max_voltage FROM power_hourly WHERE hour_start>=?",
    )
      .bind(start)
      .first(),
    t = await e.DB.prepare(
      "SELECT ROUND(SUM(temperature_sum)/NULLIF(SUM(temperature_count),0),1) avg_temp,ROUND(MIN(temperature_min),1) min_temp,ROUND(MAX(temperature_max),1) max_temp FROM climate_hourly WHERE hour_start>=?",
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
      "SELECT substr(hour_start,1,10) d,ROUND(SUM(power_sum)/NULLIF(SUM(power_count),0),0) avg_power,ROUND(MAX(power_max),0) peak_power,ROUND(SUM(voltage_sum)/NULLIF(SUM(voltage_count),0),1) avg_v,ROUND(MIN(voltage_min),1) min_v,ROUND(MAX(voltage_max),1) max_v,COALESCE(SUM(energy_day+energy_night),0) energy,COALESCE(SUM(cost_day+cost_night),0) cost FROM power_hourly WHERE hour_start>=? GROUP BY substr(hour_start,1,10) ORDER BY d",
    )
      .bind(start)
      .all()
  ).results;
  const climate = (
    await e.DB.prepare(
      "SELECT substr(c.hour_start,1,10) d,c.device_id,COALESCE(d.device_name,c.device_id) name,ROUND(SUM(c.temperature_sum)/NULLIF(SUM(c.temperature_count),0),1) temp FROM climate_hourly c LEFT JOIN devices d ON d.device_id=c.device_id WHERE c.hour_start>=? GROUP BY substr(c.hour_start,1,10),c.device_id ORDER BY d",
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
    return x ? n(x.energy) : null;
  });
  const cost = labels.map((d, i) => {
    const x = byDay[d];
    return x == null || kwh[i] == null ? null : +n(x.cost).toFixed(2);
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
