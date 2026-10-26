import { CATS, age, fmt, n, kyivDateTime } from "../constants.js";
import { schema, latest, score, now } from "../database.js";
import { analyticsText, energyText, forecastDayLabel, homeSummaryRich, scoreText, weatherForecast48hText, smartMorningDigest, caretakerReport } from "../reports.js";
import { flushEventBuffer, maintenance, push, pushChartPack, stateEvent } from "../notifications.js";
import { live } from "../menus.js";
import { send } from "../telegram.js";
import { dueScheduledJob, shouldRunScheduledJob } from "../v5/scheduler.js";

export async function agent(e) {
  await schema(e);
  const p = now(),
    x = await latest(e),
    s = score(x);
  await maintenance(e, p);
  for (const a of x.alerts)
    if (a.severity === "critical" && a.alert_type !== "device_offline")
      await push(
        e,
        "critical_alerts",
        `alert:${a.id}`,
        `🔴 ${a.alert_message}`,
        true,
      );
  const offlineIds = new Set(
    x.alerts
      .filter((a) => a.alert_type === "device_offline" && a.resolved_at == null)
      .map((a) => String(a.device_id || a.alert_key || a.id)),
  );
  for (const z of x.zones) {
    const id = String(z.device_id),
      isOffline =
        offlineIds.has(id) ||
        age(z.created_at) == null ||
        age(z.created_at) > 15;
    const changed = await stateEvent(
      e,
      `sensor:${id}`,
      isOffline,
      "device_health",
      `📡 ${z.device_name || id}: датчик offline.`,
      `✅ ${z.device_name || id}: датчик знову online.`,
    );
  }
  const powerOffline =
    !x.power?.created_at || age(x.power.created_at) > 15,
    powerChanged = await stateEvent(
      e,
      "power-meter",
      powerOffline,
      "device_health",
      "⚡ Power Meter: немає даних понад 15 хв.",
      "✅ Power Meter: передачу даних відновлено.",
    );
  await flushEventBuffer(e);
  const max = n(
      (
        await e.DB.prepare(
          "SELECT setting_value FROM settings WHERE setting_key='max_power_alert_watts'",
        ).first()
      )?.setting_value,
      5000,
    ),
    highLoad = n(x.power?.power) > max * 0.85;
  await stateEvent(
    e,
    "high-load",
    highLoad,
    "load_warning",
    `⚡ Високе навантаження: ${fmt(x.power?.power, 0)} Вт`,
    `✅ Навантаження нормалізувалося: ${fmt(x.power?.power, 0)} Вт`,
    n(x.power?.power) > max,
  );
  const weatherRows = (
    await e.DB.prepare(
      "SELECT * FROM weather_hourly WHERE forecast_time>=? AND forecast_time<=? ORDER BY forecast_time ASC",
    ).bind(kyivDateTime(115), kyivDateTime(125)).all()
  ).results;
  const hazardRows=[];
  for (const h of weatherRows) {
    const code = Number(h.weather_code),
      probability = n(h.precipitation_probability),
      wind = n(h.wind_speed),
      hazards = [];
    if (
      probability >= 60 &&
      (code >= 51 && code <= 86 || code >= 95 && code <= 99)
    )
      hazards.push(`опади ${probability}%`);
    if (wind >= 50) hazards.push(`сильний вітер ${fmt(wind, 0)} км/год`);
    if (code === 45 || code === 48) hazards.push("густий туман");
    if (code >= 56 && code <= 67) hazards.push("ожеледь або крижаний дощ");
    if (code >= 71 && code <= 77 || code === 85 || code === 86) hazards.push("снігопад");
    if (code >= 95 && code <= 99) hazards.push("гроза");
    if (n(h.temperature) >= 35) hazards.push(`спека ${fmt(h.temperature, 0)} °C`);
    if (n(h.temperature) <= -15) hazards.push(`сильний мороз ${fmt(h.temperature, 0)} °C`);
    if (!hazards.length) continue;
    const at = String(h.forecast_time),
      time = `${forecastDayLabel(at.slice(0, 10))} о ${at.slice(11, 16)}`;
    hazardRows.push({at,time,hazards});
  }
  if(hazardRows.length){
    const items=hazardRows.map(x=>`• ${x.time}: ${x.hazards.join("; ")}`).join("\n"),
      fingerprint=hazardRows.map(x=>x.at).sort().join(","),
      urgency=hazardRows.some(x=>x.hazards.some(h=>h.includes("гроза")||h.includes("ожеледь")))?"🚨":"⚠️";
    await push(e,"weather_forecast",`hazard:${fingerprint}`,`${urgency} ПОГОДНЕ ЗАСТЕРЕЖЕННЯ · приблизно за 2 години\n${items}\nБудь ласка, врахуйте це під час планування справ і пересування.`,false,true);
  }
  const rainProb = n(x.daily[0]?.precipitation_probability),
    rainState = await e.DB.prepare(
      "SELECT state_value FROM agent_state WHERE state_key='event:rain'",
    ).first(),
    rainActive =
      rainState?.state_value === "active" ? rainProb >= 50 : rainProb >= 70;
  await stateEvent(
    e,
    "rain",
    rainActive,
    "weather_alerts",
    `☔ Високий ризик дощу: ${rainProb}% (${x.daily[0]?.forecast_date || p.date}).`,
    `✅ Ризик дощу знизився до ${rainProb}%.`,
  );
  for (const r of x.recs) {
    if (r.category === "device_health") continue;
    const stable = String(
      r.recommendation_key ||
        `${r.category || "general"}:${r.room_id || "home"}:${r.title || "recommendation"}`,
    ), occurrence = Math.max(1, n(r.occurrence_count, 1)),
      notificationKey = occurrence > 1 ? `${stable}:v${occurrence}` : stable,
      icon = r.category === "ventilation" ? "💨" : "💡",
      sent = await push(e, "recommendations", notificationKey, `${icon} ${r.title}\n${r.message}`, false, occurrence > 1);
    if (sent)
      await e.DB.prepare(
        "UPDATE recommendation_lifecycle SET last_notified_at=CURRENT_TIMESTAMP WHERE recommendation_key=?",
      ).bind(stable).run();
    if (r.priority === "high" && r.last_notified_at) {
      const reminderHours = n((await e.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='high_priority_reminder_hours'").first())?.setting_value, 24),
        last = new Date(String(r.last_notified_at).replace(" ", "T") + "Z");
      if (Date.now() - last.getTime() >= reminderHours * 3600000) {
        const reminderSent = await push(e, "recommendations", `${notificationKey}:reminder:${Math.floor(Date.now() / (reminderHours * 3600000))}`, `🔔 Нагадування · ${r.title}\n${r.message}${r.action ? `\nДія: ${r.action}` : ""}`);
        if (reminderSent) await e.DB.prepare("UPDATE recommendation_lifecycle SET last_notified_at=CURRENT_TIMESTAMP WHERE recommendation_key=?").bind(stable).run();
      }
    }
    if (r.category === "condensation")
      await stateEvent(
        e,
        `condensation:${r.room_id || stable}`,
        true,
        "condensation_risk",
        `💧 ${r.title}\n${r.message}`,
        null,
      );
  }
  const scheduled = (
    await e.DB.prepare(
      "SELECT * FROM notification_settings WHERE enabled=1 AND schedule_time IS NOT NULL",
    ).all()
  ).results;
  for (const q of scheduled) {
    const due = dueScheduledJob(q, new Date(), "Europe/Kyiv");
    if (!due) continue;
    const previous = await e.DB.prepare("SELECT last_success_at FROM scheduled_jobs_state WHERE job_key=?").bind(due.jobKey).first();
    if (!shouldRunScheduledJob(due, previous?.last_success_at)) continue;
    if (q.category_key === "ai_insights") {
      const morning = scheduled.find(x => x.category_key === "morning_report");
      if (morning) {
        const morningDue = dueScheduledJob(morning,new Date(),"Europe/Kyiv");
        const minute = (x)=>{const [h,m]=x.split(":").map(Number);return h*60+m;};
        if (morningDue && morningDue.localKey.slice(0,10)===due.localKey.slice(0,10) && Math.abs(minute(morning.schedule_time)-minute(q.schedule_time))<=120) {
          const morningState=await e.DB.prepare("SELECT last_success_at FROM scheduled_jobs_state WHERE job_key=?").bind(morningDue.jobKey).first();
          if (!morningState?.last_success_at || Date.parse(String(morningState.last_success_at).replace(" ","T")+"Z")<Date.parse(morningDue.dueAt.replace(" ","T")+"Z")) continue;
        }
      }
    }
    await e.DB.prepare("INSERT OR IGNORE INTO scheduled_jobs_state(job_key) VALUES(?)").bind(due.jobKey).run();
    const lock=await e.DB.prepare("UPDATE scheduled_jobs_state SET lock_until=datetime('now','+10 minutes'),last_started_at=CURRENT_TIMESTAMP,last_status='running',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_key=? AND (lock_until IS NULL OR lock_until<CURRENT_TIMESTAMP) AND (last_success_at IS NULL OR last_success_at<?)").bind(due.jobKey,due.dueAt).run();
    if (!(lock.meta?.changes>0)) continue;
    try {
      let msg, keyboard=null, key=due.jobKey;
      if (q.category_key === "morning_report") { const d=await smartMorningDigest(e); msg=d.text; keyboard=d.keyboard; }
      else if (q.category_key === "evening_report") msg=`🌙 ВЕЧІРНІЙ ПІДСУМОК\n${await energyText(e)}\n📊 Home Score: ${s.overall}/100 · впевненість ${s.confidence}%`;
      else if (q.category_key === "energy_cost") msg=`💰 КОНТРОЛЬ ВИТРАТ\n${await energyText(e)}`;
      else if (q.category_key === "weekly_digest") msg=`📈 ТИЖНЕВА АНАЛІТИКА\n${await analyticsText(e,7)}\n\n${await scoreText(e)}`;
      else if (q.category_key === "monthly_digest") msg=`📊 МІСЯЧНА АНАЛІТИКА\n${await analyticsText(e,30)}\n\n${await scoreText(e)}`;
      else if (q.category_key === "weather_forecast") msg=await weatherForecast48hText(e);
      else if (q.category_key === "ai_insights") { const c=await caretakerReport(e); msg=c.text; key=`caretaker:${c.dedupeKey}`; keyboard=c.keyboard; }
      else msg=`${CATS[q.category_key]?.[0]} ${CATS[q.category_key]?.[1]}\n${await homeSummaryRich(e)}`;
      const sent=await push(e,q.category_key,key,msg,false,false,keyboard);
      if(q.category_key==="weekly_digest") await pushChartPack(e,q.category_key,key,7);
      if(q.category_key==="monthly_digest") await pushChartPack(e,q.category_key,key,30);
      await e.DB.prepare("UPDATE scheduled_jobs_state SET last_due_at=?,last_success_at=CURRENT_TIMESTAMP,last_status=?,last_error=NULL,lock_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_key=?").bind(due.dueAt,sent?"sent":"completed",due.jobKey).run();
      console.log("SCHEDULE_JOB",JSON.stringify({job_key:due.jobKey,category:q.category_key,outcome:sent?"sent":"completed",duration_ms:0}));
    } catch(err) {
      await e.DB.prepare("UPDATE scheduled_jobs_state SET last_status='failed',last_error=?,lock_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_key=?").bind(String(err?.message||err).slice(0,500),due.jobKey).run();
      console.error("SCHEDULE_JOB",JSON.stringify({job_key:due.jobKey,category:q.category_key,outcome:"failed",error:String(err?.message||err).slice(0,250)}));
    }
  }
  const q = (
    await e.DB.prepare(
      "SELECT * FROM notification_queue WHERE status='pending' AND deliver_after<=CURRENT_TIMESTAMP ORDER BY id LIMIT 20",
    ).all()
  ).results;
  const queuedGroups=new Map();
  for(const item of q){const k=`${item.chat_id}:${item.category_key}`,group=queuedGroups.get(k)||[];group.push(item);queuedGroups.set(k,group);}
  for(const group of queuedGroups.values()) try {
    const first=group[0], text=`🌙 ПІДСУМОК ПІСЛЯ ТИХИХ ГОДИН\n${group.map(a=>`• ${a.message}`).join("\n\n")}`.slice(0,3900);
    await send(e,first.chat_id,text);
    await e.DB.batch(group.flatMap(a=>[
      e.DB.prepare("INSERT OR IGNORE INTO notification_log(dedupe,chat_id,category_key,message) VALUES(?,?,?,?)").bind(a.dedupe,a.chat_id,a.category_key,a.message),
      e.DB.prepare("DELETE FROM notification_queue WHERE id=?").bind(a.id),
    ]));
  } catch (err) {
    console.error("QUEUE_SEND", JSON.stringify({chat_id:group[0].chat_id,count:group.length,error:String(err?.message||err).slice(0,250)}));
  }
  const av = await e.DB.prepare(
      "SELECT AVG(power) a FROM power_logs WHERE created_at>=datetime('now','-1 hour')",
    ).first(),
    base = await e.DB.prepare(
      "SELECT AVG(power) a FROM power_logs WHERE created_at>=datetime('now','-7 days')",
    ).first();
  if (av?.a > base?.a * 1.8) {
    await push(
      e,
      "ai_insights",
      `anom:${p.date}:${p.hour}`,
      `🧠 Аномалія: ${fmt(av.a, 0)} Вт проти типових ${fmt(base.a, 0)} Вт`,
    );
    await e.DB.prepare(
      "INSERT INTO home_timeline(category,title,message,severity) VALUES('energy','Аномалія навантаження',?,'warning')",
    )
      .bind(`${av.a}/${base.a}`)
      .run();
  }
  await e.DB.prepare(
    "INSERT INTO agent_state VALUES('last_run',?,CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP",
  )
    .bind(JSON.stringify(p))
    .run();
  for (const c of (
    await e.DB.prepare("SELECT chat_id FROM live_status_cards").all()
  ).results)
    try {
      await live(e, c.chat_id);
    } catch {}
  return { ok: true };
}
