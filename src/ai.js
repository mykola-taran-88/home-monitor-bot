import { MODELS, ALLOWED, BLOCK } from "./constants.js";
import { latest, now } from "./database.js";

async function runAI(e, msg, temp = 0.15) {
  let er;
  for (const m of MODELS)
    try {
      const r = await e.AI.run(m, {
        messages: msg,
        max_tokens: 650,
        temperature: temp,
        top_p: 0.85,
        repetition_penalty: 1.15,
      });
      return (
        r.response ||
        r.choices?.[0]?.text ||
        r.choices?.[0]?.message?.content ||
        ""
      ).trim();
    } catch (x) {
      er = x;
    }
  throw er;
}

const DBSCHEMA =
  "power_logs(voltage,current,power,frequency,energy_total,tariff_zone,cost_per_kwh,created_at); climate_logs(device_id,temperature,humidity,wifi_rssi,created_at); devices(device_id,device_name,is_outdoor,enabled); weather_current; weather_hourly; weather_forecast; alerts; recommendations. Units: power W, energy_total cumulative kWh, temperature C.";

export async function ask(e, id, q) {
  const planner = await runAI(
    e,
    [
      {
        role: "system",
        content: `Return JSON only. mode=current|sql|general. For sql create one SQLite SELECT with ? params, LIMIT 100, allowed tables only. Never modify DB. Today ${now().date}. Schema:${DBSCHEMA}`,
      },
      { role: "user", content: q },
    ],
    0.05,
  );
  let p;
  try {
    p = JSON.parse(
      planner.slice(planner.indexOf("{"), planner.lastIndexOf("}") + 1),
    );
  } catch {
    p = { mode: "current" };
  }
  let ev;
  if (p.mode === "general") ev = { note: "No home data used" };
  else if (p.mode === "sql") {
    let sql = String(p.sql || "")
      .trim()
      .replace(/;$/, "");
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)].map(
      (x) => x[1],
    );
    if (
      BLOCK.test(sql) ||
      !/^(SELECT|WITH)/i.test(sql) ||
      sql.includes(";") ||
      tables.some((x) => !ALLOWED.has(x))
    )
      p.mode = "current";
    else {
      if (!/\bLIMIT\b/i.test(sql)) sql += " LIMIT 100";
      const st = e.DB.prepare(sql),
        rr = (p.params || []).length
          ? await st.bind(...p.params).all()
          : await st.all();
      ev = { rows: rr.results || [] };
    }
  }
  if (p.mode === "current" || !ev) ev = await latest(e);
  const h = (
      await e.DB.prepare(
        "SELECT role,content FROM ai_chat_history WHERE chat_id=? ORDER BY id DESC LIMIT 6",
      )
        .bind(String(id))
        .all()
    ).results.reverse(),
    ans = await runAI(
      e,
      [
        {
          role: "system",
          content: `Відповідай українською. mode=${p.mode}. Для current/sql використовуй лише EVIDENCE, не вигадуй числа. Не показуй JSON/SQL. Для general почни «💬 Загальна відповідь:».`,
        },
        ...h,
        {
          role: "user",
          content: `QUESTION:${q}\nEVIDENCE:${JSON.stringify(ev).slice(0, 22000)}`,
        },
      ],
      p.mode === "general" ? 0.45 : 0.12,
    );
  await e.DB.batch([
    e.DB.prepare(
      "INSERT INTO ai_chat_history(chat_id,role,content) VALUES(?,?,?)",
    ).bind(String(id), "user", q),
    e.DB.prepare(
      "INSERT INTO ai_chat_history(chat_id,role,content) VALUES(?,?,?)",
    ).bind(String(id), "assistant", ans),
  ]);
  return ans;
}
