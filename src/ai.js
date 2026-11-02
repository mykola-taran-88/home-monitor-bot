import { MODELS, ALLOWED, BLOCK, fmt, age } from "./constants.js";
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

async function saveTurn(e, id, question, answer) {
  await e.DB.batch([
    e.DB.prepare(
      "INSERT INTO ai_chat_history(chat_id,role,content) VALUES(?,?,?)",
    ).bind(String(id), "user", question),
    e.DB.prepare(
      "INSERT INTO ai_chat_history(chat_id,role,content) VALUES(?,?,?)",
    ).bind(String(id), "assistant", answer),
  ]);
  return answer;
}

function asksLatestOutdoorReading(question) {
  return /(?:остан\w*|найсвіж\w*|коли)/i.test(question) &&
    /(?:зовніш\w*|надвор\w*|вулиц\w*|outdoor)/i.test(question) &&
    /(?:показник\w*|вимір\w*|дан\w*|датчик\w*|оновл\w*|температур\w*)/i.test(question);
}

function asksCurrentTariff(question) {
  return /тариф/i.test(question) &&
    /(?:зараз|тепер|поточн\w*|сьогодн\w*)/i.test(question);
}

function asksRecentEnergy(question) {
  return /(?:скільки|обсяг|кількість|витрат\w*|спожит\w*|споживан\w*)/i.test(question) &&
    /(?:електрик\w*|енерг\w*|кВт)/i.test(question) &&
    /(?:останні?\s*2\s*(?:год|h)|дві\s*годин|2\s*годин)/i.test(question);
}

async function currentTariffAnswer(e, id, question) {
  const settings = (
      await e.DB.prepare(
        "SELECT setting_key,setting_value FROM settings WHERE setting_key IN ('timezone','day_tariff','night_tariff','day_start','night_start')",
      ).all()
    ).results,
    values = Object.fromEntries(settings.map((row) => [row.setting_key, row.setting_value])),
    timezone = values.timezone || "Europe/Kyiv",
    time = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
    dayStart = values.day_start || "07:00",
    nightStart = values.night_start || "23:00",
    night = nightStart < dayStart
      ? time >= nightStart && time < dayStart
      : time >= nightStart || time < dayStart,
    zone = night ? "нічний" : "денний",
    rate = night ? values.night_tariff : values.day_tariff,
    price = rate == null || rate === "" ? "ставку не налаштовано" : `${fmt(rate, 2)} грн/кВт·год`,
    answer = `Зараз діє ${zone} тариф: ${price}. Період: ${night ? `${nightStart}–${dayStart}` : `${dayStart}–${nightStart}`} (${timezone}).`;
  return saveTurn(e, id, question, answer);
}

async function recentEnergyAnswer(e, id, question) {
  const [baseline, recent] = await Promise.all([
      e.DB.prepare(
        "SELECT energy_total,created_at FROM power_logs WHERE created_at>=datetime('now','-135 minutes') AND created_at<datetime('now','-2 hours') ORDER BY created_at DESC,id DESC LIMIT 1",
      ).first(),
      e.DB.prepare(
        "SELECT energy_total,created_at FROM power_logs WHERE created_at>=datetime('now','-2 hours') ORDER BY created_at,id LIMIT 500",
      ).all(),
    ]),
    rows = [...(baseline ? [baseline] : []), ...(recent.results || [])];
  let consumed = 0, validIntervals = 0;
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i].energy_total == null || rows[i - 1].energy_total == null
      ? NaN
      : Number(rows[i].energy_total) - Number(rows[i - 1].energy_total);
    if (Number.isFinite(delta) && delta >= 0 && delta <= 100) {
      consumed += delta;
      validIntervals++;
    }
  }
  let answer;
  if (!recent.results?.length) {
    answer = "За останні 2 години база не містить показників лічильника електроенергії.";
  } else if (!baseline || validIntervals === 0) {
    answer = "Не можу точно обчислити споживання за останні 2 години: у базі недостатньо послідовних показників лічильника.";
  } else {
    const first = formatKyivTimestamp(rows[0].created_at),
      last = formatKyivTimestamp(rows.at(-1).created_at),
      latestAge = age(rows.at(-1).created_at),
      stale = latestAge != null && latestAge > 20
        ? ` Останній показник отримано ${latestAge} хв тому, тому підрахунок охоплює лише наявні записи.`
        : "";
    answer = `За останні 2 години спожито приблизно ${fmt(consumed, 3)} кВт·год. Дані лічильника: ${first} — ${last}.${stale}`;
  }
  return saveTurn(e, id, question, answer);
}

function formatKyivTimestamp(value) {
  const raw = String(value || "").replace(" ", "T"),
    iso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`,
    date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const day = new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv", day: "numeric", month: "long", year: "numeric",
    }).format(date),
    time = new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(date);
  return `${day} о ${time}`;
}

async function latestOutdoorAnswer(e, id, question) {
  const row = await e.DB.prepare(
    "SELECT d.device_name,c.temperature,c.humidity,c.created_at FROM devices d LEFT JOIN climate_logs c ON c.id=(SELECT MAX(id) FROM climate_logs x WHERE x.device_id=d.device_id) WHERE d.device_type='climate' AND d.enabled=1 AND d.is_outdoor=1 ORDER BY c.id DESC LIMIT 1",
  ).first();
  let answer;
  if (!row) {
    answer = "У базі немає зареєстрованого зовнішнього датчика.";
  } else if (!row.created_at) {
    answer = `Для датчика «${row.device_name || "Зовнішній датчик"}» у базі ще немає вимірювань.`;
  } else {
    const timestamp = formatKyivTimestamp(row.created_at),
      minutes = age(row.created_at),
      ageText = minutes == null ? "" : minutes < 60
        ? ` Минуло ${minutes} хв.`
        : ` Минуло ${Math.floor(minutes / 60)} год${minutes % 60 ? ` ${minutes % 60} хв` : ""}.`,
      readings = [
        row.temperature == null ? null : `${fmt(row.temperature)} °C`,
        row.humidity == null ? null : `вологість ${fmt(row.humidity, 0)}%`,
      ].filter(Boolean).join(" · ");
    answer = `Останнє вимірювання датчика «${row.device_name || "Зовнішній датчик"}»${readings ? `: ${readings}` : ""}. Час за Києвом: ${timestamp || row.created_at}.${ageText}${minutes != null && minutes > 15 ? " Дані застарілі: датчик давно не передавав нових показників." : ""}`;
  }
  return saveTurn(e, id, question, answer);
}

async function validateDatabaseAnswer(e, question, evidence, answer) {
  const raw = await runAI(e, [
    {
      role: "system",
      content: "Ти перевіряєш відповідь на відповідність наданим рядкам бази даних. Не відповідай на запитання і не використовуй зовнішні знання. Поверни лише JSON: {\"supported\":true} або {\"supported\":false}. true дозволено тільки якщо кожне фактичне твердження, дата, час, назва датчика й число у чернетці прямо підтверджені EVIDENCE. Якщо є сумнів, значення в evidence відсутнє або твердження робить зайвий висновок — поверни false.",
    },
    {
      role: "user",
      content: `QUESTION:${question}\nEVIDENCE:${JSON.stringify(evidence).slice(0, 22000)}\nDRAFT:${answer}`,
    },
  ], 0);
  try {
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    return JSON.parse(json).supported === true;
  } catch {
    return false;
  }
}

export async function ask(e, id, q) {
  if (asksLatestOutdoorReading(q)) return latestOutdoorAnswer(e, id, q);
  if (asksCurrentTariff(q)) return currentTariffAnswer(e, id, q);
  if (asksRecentEnergy(q)) return recentEnergyAnswer(e, id, q);
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
  if (!["current", "sql", "general"].includes(p.mode)) p.mode = "current";
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
          content: `Відповідай українською. mode=${p.mode}. Для current/sql використовуй лише EVIDENCE, не вигадуй числа. Якщо показники застарілі, неповні або їх недостатньо, чітко скажи це перед висновком. Не роби впевнених висновків із тестових чи одиничних вимірювань. Не показуй JSON/SQL. Для general почни «💬 Загальна відповідь:».`,
        },
        ...h,
        {
          role: "user",
          content: `QUESTION:${q}\nEVIDENCE:${JSON.stringify(ev).slice(0, 22000)}`,
        },
      ],
      p.mode === "general" ? 0.45 : 0.12,
    );
  if (p.mode !== "general") {
    let supported = false;
    try {
      supported = await validateDatabaseAnswer(e, q, ev, ans);
    } catch (error) {
      console.error("AI_ANSWER_VALIDATION", error?.message || error);
    }
    if (!supported)
      return saveTurn(
        e,
        id,
        q,
        "⚠️ Не вдалося підтвердити відповідь за даними бази. Уточніть назву датчика або період, про який запитуєте.",
      );
  }
  return saveTurn(e, id, q, ans);
}
