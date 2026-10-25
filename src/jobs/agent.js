import { CATS, age, fmt, n } from "../constants.js";
import { schema, latest, score, now } from "../database.js";
import { ask } from "../ai.js";
import { analyticsText, energyText, homeSummaryRich, scoreText } from "../reports.js";
import { maintenance, push, pushChartPack, stateEvent } from "../notifications.js";
import { live } from "../menus.js";
import { send } from "../telegram.js";

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
    if (isOffline && !changed)
      await push(
        e,
        "device_health",
        `sensor-current:${id}`,
        `📡 ${z.device_name || id}: датчик offline.`,
        false,
        true,
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
  if (powerOffline && !powerChanged)
    await push(
      e,
      "device_health",
      "power-meter-current",
      "⚡ Power Meter: немає даних понад 15 хв.",
      false,
      true,
    );
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
    );
    await push(e, "recommendations", stable, `💡 ${r.title}\n${r.message}`);
    if (r.category === "ventilation")
      await push(e, "ventilation", stable, `💨 ${r.title}\n${r.message}`);
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
    const [h, m] = q.schedule_time.split(":").map(Number);
    if (p.hour !== h || Math.abs(p.minute - m) > 4) continue;
    if (q.mode === "weekly" && q.weekday !== p.weekday) continue;
    if (q.mode === "monthly" && q.monthday !== p.day) continue;
    let msg;
    if (q.category_key === "morning_report")
      msg = `🌅 РАНКОВИЙ ЗВІТ\n${await homeSummaryRich(e)}`;
    else if (q.category_key === "evening_report")
      msg = `🌙 ВЕЧІРНІЙ ЗВІТ\n${await energyText(e)}\n\n${await scoreText(e)}`;
    else if (q.category_key === "energy_cost")
      msg = `💰 КОНТРОЛЬ ВИТРАТ\n${await energyText(e)}`;
    else if (q.category_key === "weekly_digest")
      msg = `📈 ТИЖНЕВА АНАЛІТИКА\n${await analyticsText(e, 7)}\n\n${await scoreText(e)}`;
    else if (q.category_key === "monthly_digest")
      msg = `📊 МІСЯЧНА АНАЛІТИКА\n${await analyticsText(e, 30)}\n\n${await scoreText(e)}`;
    else if (q.category_key === "ai_insights")
      msg = `🧠 AI Insights\n${await ask(e, "agent", "Дай 4 важливі інсайти і практичні дії, використовуючи фактичні дані Home Monitor")}`;
    else
      msg = `${CATS[q.category_key]?.[0]} ${CATS[q.category_key]?.[1]}\n${await homeSummaryRich(e)}`;
    await push(e, q.category_key, `${p.date}:${q.schedule_time}`, msg);
    if (q.category_key === "weekly_digest")
      await pushChartPack(e, q.category_key, `${p.date}:${q.schedule_time}`, 7);
    if (q.category_key === "monthly_digest")
      await pushChartPack(
        e,
        q.category_key,
        `${p.date}:${q.schedule_time}`,
        30,
      );
    if (q.category_key === "ai_insights")
      await pushChartPack(e, q.category_key, `${p.date}:${q.schedule_time}`, 7);
  }
  const q = (
    await e.DB.prepare(
      "SELECT * FROM notification_queue WHERE status='pending' AND deliver_after<=CURRENT_TIMESTAMP ORDER BY id LIMIT 20",
    ).all()
  ).results;
  for (const a of q)
    try {
      await send(e, a.chat_id, `🌙 Подія з тихих годин\n${a.message}`);
      await e.DB.batch([
        e.DB.prepare(
          "INSERT OR IGNORE INTO notification_log(dedupe,chat_id,category_key,message) VALUES(?,?,?,?)",
        ).bind(a.dedupe, a.chat_id, a.category_key, a.message),
        e.DB.prepare("DELETE FROM notification_queue WHERE id=?").bind(a.id),
      ]);
    } catch (err) {
      console.error("QUEUE_SEND", err?.message || err);
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
