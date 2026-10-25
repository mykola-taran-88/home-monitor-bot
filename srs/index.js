// @ts-nocheck
// Home Monitor Bot v4.2.3 Ordered Weather - stateful alerts and chronological today/tomorrow forecast
const MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-sd",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];
const CATS = {
  critical_alerts: ["🔴", "Критичні алерти", "event", 30],
  weather_alerts: ["⛈️", "Небезпечна погода", "event", 180],
  ventilation: ["💨", "Провітрювання", "event", 720],
  morning_report: ["🌅", "Ранковий звіт", "daily", 1440, "07:30"],
  evening_report: ["🌙", "Вечірній звіт", "daily", 1440, "21:30"],
  energy_cost: ["💰", "Контроль витрат", "daily", 1440, "18:00"],
  weekly_digest: ["📈", "Тижневий звіт", "weekly", 10080, "08:00"],
  monthly_digest: ["📊", "Місячний звіт", "monthly", 43200, "08:00"],
  ai_insights: ["🧠", "AI Insights", "daily", 1440, "12:00"],
  recommendations: ["💡", "Рекомендації", "event", 720],
  device_health: ["📡", "Стан датчиків", "event", 60],
  home_score: ["🏆", "Home Score", "event", 180],
  rain_window: ["☔", "Наближення дощу", "event", 180],
  condensation_risk: ["💧", "Ризик конденсату", "event", 240],
  load_warning: ["⚡", "Навантаження", "event", 30],
  useful_info: ["ℹ️", "Корисна інформація", "weekly", 10080, "10:00"],
};
const ALLOWED = new Set([
    "power_logs",
    "climate_logs",
    "devices",
    "weather_current",
    "weather_hourly",
    "weather_forecast",
    "alerts",
    "recommendations",
  ]),
  BLOCK =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|UPSERT|ATTACH|DETACH|PRAGMA|VACUUM|TRIGGER|BEGIN|COMMIT|ROLLBACK)\b/i;
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d),
  fmt = (v, d = 1) =>
    v == null || isNaN(+v)
      ? "—"
      : Number(v).toLocaleString("uk-UA", { maximumFractionDigits: d }),
  clamp = (v) => Math.max(0, Math.min(100, Math.round(v))),
  age = (v) =>
    v
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(String(v).replace(" ", "T") + "Z")) / 60000,
          ),
        )
      : null,
  comfort = (t, h) =>
    clamp(
      100 -
        Math.abs(n(t) - 22.5) * 9 -
        Math.abs(n(h) - 50) * 1.2 -
        (h > 70 || h < 25 ? 10 : 0),
    );
const MAIN = {
  inline_keyboard: [
    [
      { text: "🏠 Стан дому", callback_data: "m:home" },
      { text: "🤖 Запитати AI", callback_data: "m:ai" },
    ],
    [
      { text: "📊 Аналітика", callback_data: "m:analytics" },
      { text: "🚨 Події", callback_data: "m:events" },
    ],
    [
      { text: "🔔 Сповіщення", callback_data: "m:notify" },
      { text: "⚙️ Налаштування", callback_data: "m:settings" },
    ],
    [
      { text: "❓ Допомога", callback_data: "m:help" },
      { text: "🩺 Діагностика", callback_data: "m:health" },
    ],
  ],
};
const HOME = {
  inline_keyboard: [
    [
      { text: "🌡 Клімат", callback_data: "a:climate" },
      { text: "⚡ Енергія", callback_data: "a:energy" },
    ],
    [
      { text: "🌦 Погода", callback_data: "a:weather" },
      { text: "📊 Score", callback_data: "a:score" },
    ],
    [
      { text: "💡 Рекомендації", callback_data: "a:recs" },
      { text: "📋 Зведення", callback_data: "a:home" },
    ],
    [{ text: "⬅️ Меню", callback_data: "m:main" }],
  ],
};
const ANALYTICS = {
  inline_keyboard: [
    [
      { text: "📅 Сьогодні", callback_data: "chart:1" },
      { text: "📆 7 днів", callback_data: "chart:7" },
    ],
    [
      { text: "🗓 30 днів", callback_data: "chart:30" },
      { text: "🔥 Піки", callback_data: "q:peaks" },
    ],
    [
      { text: "💰 Витрати", callback_data: "q:cost" },
      { text: "⚖️ Порівняти", callback_data: "q:compare" },
    ],
    [{ text: "⬅️ Меню", callback_data: "m:main" }],
  ],
};
const EVENTS = {
  inline_keyboard: [
    [
      { text: "🚨 Активні", callback_data: "inbox:active" },
      { text: "✅ Вирішені", callback_data: "inbox:resolved" },
    ],
    [
      { text: "📜 Timeline", callback_data: "timeline" },
      { text: "📡 Датчики", callback_data: "a:climate" },
    ],
    [{ text: "⬅️ Меню", callback_data: "m:main" }],
  ],
};
const NOTIFY = {
  inline_keyboard: [
    [
      { text: "📣 Канали", callback_data: "channels" },
      { text: "🔔 Категорії", callback_data: "cats:0" },
    ],
    [
      { text: "🕒 Розклади", callback_data: "schedules" },
      { text: "🌙 Тихі години", callback_data: "quiet" },
    ],
    [
      { text: "📜 Журнал", callback_data: "nlog" },
      { text: "🧪 Тест", callback_data: "ntest" },
    ],
    [{ text: "⬅️ Меню", callback_data: "m:main" }],
  ],
};
const SETTINGS = {
  inline_keyboard: [
    [
      { text: "🏠 Режим дому", callback_data: "modes" },
      { text: "🤖 AI", callback_data: "aiset" },
    ],
    [
      { text: "👥 Ролі", callback_data: "roles" },
      { text: "💡 Пороги", callback_data: "thresholds" },
    ],
    [
      { text: "📌 Live Card", callback_data: "live" },
      { text: "📤 Експорт", callback_data: "export" },
    ],
    [{ text: "⬅️ Меню", callback_data: "m:main" }],
  ],
};
const HELP = {
  inline_keyboard: [
    [
      { text: "🚀 Швидкий старт", callback_data: "h:start" },
      { text: "🏠 Можливості", callback_data: "h:features" },
    ],
    [
      { text: "📣 Канали", callback_data: "h:channels" },
      { text: "🔔 Сповіщення", callback_data: "h:notify" },
    ],
    [
      { text: "🕒 Розклади", callback_data: "h:schedule" },
      { text: "🤖 AI", callback_data: "h:ai" },
    ],
    [
      { text: "🔐 Безпека", callback_data: "h:security" },
      { text: "🩺 Діагностика", callback_data: "m:health" },
    ],
    [{ text: "⬅️ Меню", callback_data: "m:main" }],
  ],
};
async function tg(e, m, p = {}) {
  const r = await fetch(
      `https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/${m}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      },
    ),
    j = await r.json();
  if (!j.ok) throw Error(j.description || m);
  return j.result;
}
const send = (e, id, t, k) =>
  tg(e, "sendMessage", {
    chat_id: id,
    text: String(t).slice(0, 4000),
    reply_markup: k,
    disable_web_page_preview: true,
  });
async function schema(e) {
  await e.DB.batch([
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS ai_chat_history(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT,role TEXT,content TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS bot_users(chat_id TEXT PRIMARY KEY,role TEXT DEFAULT 'viewer',enabled INTEGER DEFAULT 1)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS bot_wizard_state(chat_id TEXT PRIMARY KEY,wizard_type TEXT,step TEXT,draft_json TEXT,expires_at DATETIME)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS notification_channels(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT UNIQUE,channel_name TEXT,enabled INTEGER DEFAULT 1,quiet_enabled INTEGER DEFAULT 0,quiet_start TEXT DEFAULT '23:00',quiet_end TEXT DEFAULT '07:00')",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS notification_settings(category_key TEXT PRIMARY KEY,enabled INTEGER DEFAULT 1,mode TEXT,schedule_time TEXT,weekday INTEGER,monthday INTEGER,cooldown INTEGER DEFAULT 60)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS notification_channel_categories(chat_id TEXT,category_key TEXT,enabled INTEGER DEFAULT 1,PRIMARY KEY(chat_id,category_key))",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS notification_log(id INTEGER PRIMARY KEY AUTOINCREMENT,dedupe TEXT,chat_id TEXT,category_key TEXT,message TEXT,sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,UNIQUE(dedupe,chat_id))",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS notification_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT,category_key TEXT,message TEXT,dedupe TEXT,status TEXT DEFAULT 'pending',deliver_after DATETIME)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS notification_feedback(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT,dedupe TEXT,rating INTEGER,created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS alert_actions(id INTEGER PRIMARY KEY AUTOINCREMENT,alert_id INTEGER,chat_id TEXT,action TEXT,snooze_until DATETIME,created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS home_timeline(id INTEGER PRIMARY KEY AUTOINCREMENT,category TEXT,title TEXT,message TEXT,severity TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS home_modes(mode_key TEXT PRIMARY KEY,title TEXT,enabled INTEGER DEFAULT 0)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS live_status_cards(chat_id TEXT PRIMARY KEY,message_id TEXT,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    ),
    e.DB.prepare(
      "CREATE TABLE IF NOT EXISTS agent_state(state_key TEXT PRIMARY KEY,state_value TEXT,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    ),
    e.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_queue_pending ON notification_queue(chat_id,category_key,dedupe) WHERE status='pending'",
    ),
    e.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_notification_log_lookup ON notification_log(chat_id,category_key,sent_at)",
    ),
    e.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_agent_state_updated ON agent_state(updated_at)",
    ),
  ]);
  for (const [k, v] of Object.entries(CATS))
    await e.DB.prepare(
      "INSERT OR IGNORE INTO notification_settings(category_key,enabled,mode,schedule_time,weekday,monthday,cooldown) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        k,
        1,
        v[2],
        v[4] || null,
        k === "weekly_digest" ? 1 : k === "useful_info" ? 6 : null,
        k === "monthly_digest" ? 1 : null,
        v[3],
      )
      .run();
  for (const [k, t] of Object.entries({
    normal: "🏠 Звичайний",
    night: "🌙 Ніч",
    vacation: "🏖 Відпустка",
    maintenance: "🔧 Обслуговування",
    dnd: "🔕 Не турбувати",
    saving: "⚡ Енергозбереження",
  }))
    await e.DB.prepare("INSERT OR IGNORE INTO home_modes VALUES(?,?,?)")
      .bind(k, t, k === "normal" ? 1 : 0)
      .run();
}
async function latest(e) {
  const [z, p, w, a, r, d] = await Promise.all([
    e.DB.prepare(
      "SELECT d.device_id,d.device_name,d.is_outdoor,c.temperature,c.humidity,c.wifi_rssi,c.created_at FROM devices d LEFT JOIN climate_logs c ON c.id=(SELECT MAX(id) FROM climate_logs x WHERE x.device_id=d.device_id) WHERE d.device_type='climate' AND d.enabled=1",
    ).all(),
    e.DB.prepare("SELECT * FROM power_logs ORDER BY id DESC LIMIT 1").first(),
    e.DB.prepare(
      "SELECT wc.*,x.dew_point FROM weather_current wc LEFT JOIN weather_cache x ON x.id=(SELECT MAX(id) FROM weather_cache) ORDER BY wc.id DESC LIMIT 1",
    ).first(),
    e.DB.prepare(
      "SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 30",
    ).all(),
    e.DB.prepare(
      "SELECT * FROM recommendations WHERE status='active' ORDER BY score DESC LIMIT 20",
    ).all(),
    e.DB.prepare(
      "SELECT * FROM weather_forecast ORDER BY forecast_date LIMIT 7",
    ).all(),
  ]);
  return {
    zones: z.results,
    power: p,
    weather: w,
    alerts: a.results,
    recs: r.results,
    daily: d.results,
  };
}
function score(x) {
  const z = x.zones.filter((a) => !a.is_outdoor && a.temperature != null),
    c = z.length
      ? Math.round(
          z.reduce((s, a) => s + comfort(a.temperature, a.humidity), 0) /
            z.length,
        )
      : 0,
    o = x.zones.filter(
      (a) => age(a.created_at) > 15 || age(a.created_at) == null,
    ).length,
    h = clamp(
      100 -
        o * 15 -
        x.alerts.filter((a) => a.severity === "critical").length * 20 -
        x.alerts.length * 3,
    );
  return { comfort: c, health: h, overall: clamp(c * 0.65 + h * 0.35) };
}
async function energy(e, start) {
  const r = await e.DB.prepare(
    "SELECT energy_total,tariff_zone,cost_per_kwh FROM power_logs WHERE created_at>=? ORDER BY id",
  )
    .bind(start)
    .all();
  let d = 0,
    nn = 0,
    c = 0;
  for (let i = 1; i < r.results.length; i++) {
    const x = n(r.results[i].energy_total) - n(r.results[i - 1].energy_total);
    if (x < 0 || !isFinite(x)) continue;
    r.results[i].tariff_zone === "night" ? (nn += x) : (d += x);
    c += x * n(r.results[i].cost_per_kwh);
  }
  return { total: d + nn, day: d, night: nn, cost: c };
}
function now() {
  const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date()),
    o = Object.fromEntries(
      p.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
    );
  return {
    date: `${o.year}-${o.month}-${o.day}`,
    time: `${o.hour}:${o.minute}`,
    year: +o.year,
    month: +o.month,
    hour: +o.hour,
    minute: +o.minute,
    day: +o.day,
    weekday: { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }[
      o.weekday
    ],
  };
}
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
async function ask(e, id, q) {
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

function kyivDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
function monthStart() {
  return kyivDate().slice(0, 7) + "-01 00:00:00";
}
function weatherName(c) {
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
function weatherEmoji(c) {
  c = n(c);
  if (c === 0) return "☀️";
  if (c <= 3) return "⛅";
  if (c === 45 || c === 48) return "🌫";
  if (c <= 67) return "🌧";
  if (c <= 77) return "❄️";
  if (c <= 82) return "🌦";
  return "⛈";
}
async function periodEnergy(e, start) {
  const r = (
    await e.DB.prepare(
      "SELECT energy_total,tariff_zone,cost_per_kwh,created_at FROM power_logs WHERE created_at>=? ORDER BY id",
    )
      .bind(start)
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
async function energyOverview(e) {
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
async function energyText(e) {
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
function forecastDayLabel(date) {
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
async function weatherTextRich(e) {
  const x = await latest(e),
    rows = (
      await e.DB.prepare(
        "SELECT * FROM weather_hourly WHERE forecast_time>=datetime('now') ORDER BY forecast_time ASC LIMIT 48",
      ).all()
    ).results;
  const sorted = [...rows].sort((a, b) =>
      String(a.forecast_time).localeCompare(String(b.forecast_time)),
    ),
    sampled = sorted.filter((_, i) => i % 3 === 0).slice(0, 8),
    groups = {};
  for (const h of sampled) {
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
async function scoreText(e) {
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
  if (s.comfort >= 90)
    reasons.push("✅ Клімат у кімнатах близький до оптимального");
  else reasons.push(`⚠️ Комфорт знижений: середня оцінка ${s.comfort}/100`);
  if (!offline.length) reasons.push("✅ Усі датчики передають свіжі дані");
  else reasons.push(`⚠️ Несвіжі/offline датчики: ${offline.length}`);
  if (critical.length) reasons.push(`🔴 Критичні алерти: ${critical.length}`);
  else reasons.push("✅ Критичних алертів немає");
  if (x.alerts.length)
    reasons.push(`ℹ️ Усього активних алертів: ${x.alerts.length}`);
  return [
    "📊 HOME SCORE",
    `Загальна оцінка: ${s.overall}/100`,
    `Клімат: ${s.comfort}/100`,
    `Стан системи: ${s.health}/100`,
    "",
    "Обґрунтування:",
    ...reasons,
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
async function homeSummaryRich(e) {
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
async function analyticsText(e, days) {
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
function chartUrl(config) {
  return `https://quickchart.io/chart?width=900&height=500&backgroundColor=white&version=4&c=${encodeURIComponent(JSON.stringify(config))}`;
}
async function chartConfigs(e, days) {
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
async function chart(e, id, days) {
  await send(e, id, await analyticsText(e, days), ANALYTICS);
  return sendChartPack(e, id, days);
}
async function sendChartPack(e, id, days) {
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
async function categoryChannels(e, cat) {
  return (
    await e.DB.prepare(
      "SELECT c.* FROM notification_channels c LEFT JOIN notification_channel_categories x ON x.chat_id=c.chat_id AND x.category_key=? WHERE c.enabled=1 AND COALESCE(x.enabled,1)=1",
    )
      .bind(cat)
      .all()
  ).results;
}
async function pushChartPack(e, cat, key, days) {
  const channels = await categoryChannels(e, cat);
  for (const c of channels) {
    const dedupe = `chart:${cat}:${key}:${c.chat_id}`,
      exists = await e.DB.prepare(
        "SELECT 1 ok FROM notification_log WHERE dedupe=? AND chat_id=?",
      )
        .bind(dedupe, c.chat_id)
        .first();
    if (exists) continue;
    try {
      await sendChartPack(e, c.chat_id, days);
      await e.DB.prepare(
        "INSERT OR IGNORE INTO notification_log(dedupe,chat_id,category_key,message) VALUES(?,?,?,?)",
      )
        .bind(dedupe, c.chat_id, cat, `Chart pack ${days}d`)
        .run();
    } catch (err) {
      console.error("PUSH_CHART", err);
    }
  }
}

async function homeText(e) {
  return homeSummaryRich(e);
}
async function edit(e, id, mid, t, k) {
  try {
    return await tg(e, "editMessageText", {
      chat_id: id,
      message_id: mid,
      text: t,
      reply_markup: k,
    });
  } catch {
    return send(e, id, t, k);
  }
}
function help(k) {
  return (
    {
      start:
        "🚀 ШВИДКИЙ СТАРТ\nНатискайте кнопки. Для AI просто пишіть питання. Канали додаються через Сповіщення → Канали.",
      features:
        "🏠 МОЖЛИВОСТІ\nСтан, AI SQL, звіти, графіки, канали, inbox, timeline, snooze, ролі, режими, Live Card, аномалії.",
      channels:
        "📣 КАНАЛИ\nДодайте бота адміністратором каналу, потім використайте майстер «Додати канал».",
      notify:
        "🔔 СПОВІЩЕННЯ\nКатегорії перемикаються кнопками. Події тихих годин потрапляють у чергу.",
      schedule:
        "🕒 РОЗКЛАДИ\nЧас Europe/Kyiv. Cron запускайте кожні 30 хвилин.",
      ai: "🤖 AI\nПитання про історію використовують read-only SQL. Загальні питання не отримують дані дому.",
      security:
        "🔐 БЕЗПЕКА\nАдмін — TELEGRAM_CHAT_ID. SQL тільки SELECT. /agent/run вимагає AGENT_SECRET.",
    }[k] || "❓ Оберіть розділ довідки."
  );
}
async function cats(e, page = 0) {
  const r = (
      await e.DB.prepare(
        "SELECT * FROM notification_settings ORDER BY category_key",
      ).all()
    ).results,
    b = r
      .slice(page * 8, page * 8 + 8)
      .map((x) => [
        {
          text: `${x.enabled ? "✅" : "⛔"} ${CATS[x.category_key]?.[1] || x.category_key}`,
          callback_data: `ct:${x.category_key}:${page}`,
        },
      ]);
  b.push(
    [
      { text: "⬅️", callback_data: `cats:${Math.max(0, page - 1)}` },
      {
        text: "➡️",
        callback_data: `cats:${Math.min(Math.ceil(r.length / 8) - 1, page + 1)}`,
      },
    ],
    [{ text: "🏠 Назад", callback_data: "m:notify" }],
  );
  return { inline_keyboard: b };
}
async function channels(e) {
  const r = (
      await e.DB.prepare(
        "SELECT * FROM notification_channels ORDER BY id",
      ).all()
    ).results,
    b = r.map((x) => [
      {
        text: `${x.enabled ? "✅" : "⛔"} ${x.channel_name || x.chat_id}`,
        callback_data: `ch:${x.id}`,
      },
    ]);
  b.push(
    [{ text: "➕ Додати", callback_data: "ch:add" }],
    [{ text: "⬅️ Назад", callback_data: "m:notify" }],
  );
  return { inline_keyboard: b };
}
async function channelDetails(e, channelId) {
  const c = await e.DB.prepare("SELECT * FROM notification_channels WHERE id=?")
    .bind(channelId)
    .first();
  if (!c) return null;
  const overrides =
    (
      await e.DB.prepare(
        "SELECT COUNT(*) n FROM notification_channel_categories WHERE chat_id=?",
      )
        .bind(c.chat_id)
        .first()
    )?.n || 0;
  return {
    text: [
      "📣 КАНАЛ",
      `Назва: ${c.channel_name || "—"}`,
      `Chat ID: ${c.chat_id}`,
      `Статус: ${c.enabled ? "✅ увімкнений" : "⛔ вимкнений"}`,
      `Тихі години: ${c.quiet_enabled ? `${c.quiet_start}–${c.quiet_end}` : "вимкнені"}`,
      `Індивідуальні категорії: ${overrides}`,
    ].join("\\n"),
    keyboard: {
      inline_keyboard: [
        [
          {
            text: c.enabled ? "⛔ Вимкнути канал" : "✅ Увімкнути канал",
            callback_data: `cht:${c.id}`,
          },
        ],
        [{ text: "🔔 Категорії каналу", callback_data: `chc:${c.id}:0` }],
        [
          { text: "🌙 Тихі години", callback_data: `chquiet:${c.id}` },
          { text: "🧪 Тест", callback_data: `chtest:${c.id}` },
        ],
        [{ text: "🗑 Видалити", callback_data: `chdel:${c.id}` }],
        [{ text: "⬅️ До каналів", callback_data: "channels" }],
      ],
    },
  };
}
async function channelCats(e, channelId, page = 0) {
  const c = await e.DB.prepare("SELECT * FROM notification_channels WHERE id=?")
    .bind(channelId)
    .first();
  if (!c) return null;
  const rows = (
    await e.DB.prepare(
      "SELECT s.category_key,s.enabled global_enabled,x.enabled channel_enabled FROM notification_settings s LEFT JOIN notification_channel_categories x ON x.category_key=s.category_key AND x.chat_id=? ORDER BY s.category_key",
    )
      .bind(c.chat_id)
      .all()
  ).results;
  const maxPage = Math.max(0, Math.ceil(rows.length / 8) - 1);
  page = Math.max(0, Math.min(maxPage, page));
  const b = rows.slice(page * 8, page * 8 + 8).map((x) => {
    const enabled =
      x.channel_enabled == null ? x.global_enabled : x.channel_enabled;
    return [
      {
        text: `${enabled ? "✅" : "⛔"} ${CATS[x.category_key]?.[1] || x.category_key}`,
        callback_data: `chct:${channelId}:${x.category_key}:${page}`,
      },
    ];
  });
  b.push(
    [
      {
        text: "⬅️",
        callback_data: `chc:${channelId}:${Math.max(0, page - 1)}`,
      },
      {
        text: `${page + 1}/${maxPage + 1}`,
        callback_data: `chc:${channelId}:${page}`,
      },
      {
        text: "➡️",
        callback_data: `chc:${channelId}:${Math.min(maxPage, page + 1)}`,
      },
    ],
    [
      {
        text: "↩️ Використовувати глобальні",
        callback_data: `chreset:${channelId}`,
      },
    ],
    [{ text: "⬅️ До каналу", callback_data: `ch:${channelId}` }],
  );
  return {
    title: `🔔 ${c.channel_name || c.chat_id}\\nНатисніть категорію, щоб перемкнути.`,
    keyboard: { inline_keyboard: b },
  };
}
async function wizard(e, id, text) {
  const w = await e.DB.prepare(
    "SELECT * FROM bot_wizard_state WHERE chat_id=? AND expires_at>CURRENT_TIMESTAMP",
  )
    .bind(String(id))
    .first();
  if (!w) return false;
  let d = JSON.parse(w.draft_json || "{}");
  if (w.step === "channel_id") {
    d.chat = text.trim();
    await e.DB.prepare(
      "UPDATE bot_wizard_state SET step='channel_name',draft_json=?,expires_at=datetime('now','+30 minutes') WHERE chat_id=?",
    )
      .bind(JSON.stringify(d), String(id))
      .run();
    await send(e, id, "Введіть назву каналу:", { force_reply: true });
    return true;
  }
  if (w.step === "channel_name") {
    await e.DB.prepare(
      "INSERT INTO notification_channels(chat_id,channel_name,enabled) VALUES(?,?,1) ON CONFLICT(chat_id) DO UPDATE SET channel_name=excluded.channel_name,enabled=1",
    )
      .bind(d.chat, text.trim())
      .run();
    await e.DB.prepare("DELETE FROM bot_wizard_state WHERE chat_id=?")
      .bind(String(id))
      .run();
    try {
      await send(e, d.chat, "✅ Home Monitor підключено.");
    } catch {}
    await send(e, id, "✅ Канал додано.", NOTIFY);
    return true;
  }
  return false;
}

async function diag(e) {
  const x = await latest(e),
    st = await e.DB.prepare(
      "SELECT * FROM agent_state WHERE state_key='last_run'",
    ).first(),
    off = x.zones.filter(
      (a) => age(a.created_at) > 15 || age(a.created_at) == null,
    ).length;
  return [
    "🩺 ДІАГНОСТИКА",
    `D1 ${e.DB ? "✅" : "⛔"}`,
    `AI ${e.AI ? "✅" : "⛔"}`,
    `Telegram ${e.TELEGRAM_BOT_TOKEN ? "✅" : "⛔"}`,
    `Cron ${st ? st.updated_at : "немає"}`,
    `Weather ${x.weather ? "✅" : "⛔"}`,
    `Nodes ${x.zones.length - off}/${x.zones.length}`,
    `Power ${x.power && age(x.power.created_at) <= 15 ? "✅" : "⛔"}`,
  ].join("\n");
}
async function live(e, id) {
  const t = (await homeText(e)) + `\nОновлено ${now().time}`,
    o = await e.DB.prepare(
      "SELECT message_id FROM live_status_cards WHERE chat_id=?",
    )
      .bind(String(id))
      .first();
  let m;
  if (o)
    try {
      m = await tg(e, "editMessageText", {
        chat_id: id,
        message_id: o.message_id,
        text: t,
      });
    } catch {}
  if (!m) m = await tg(e, "sendMessage", { chat_id: id, text: t });
  await e.DB.prepare(
    "INSERT INTO live_status_cards VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(chat_id) DO UPDATE SET message_id=excluded.message_id,updated_at=CURRENT_TIMESTAMP",
  )
    .bind(String(id), String(m.message_id))
    .run();
}
async function callback(e, q) {
  await tg(e, "answerCallbackQuery", { callback_query_id: q.id });
  const id = String(q.message.chat.id),
    mid = q.message.message_id,
    d = q.data;
  if (d.startsWith("fb:")) {
    const [, key, rating] = d.split(":");
    await e.DB.prepare(
      "INSERT INTO notification_feedback(chat_id,dedupe,rating) VALUES(?,?,?)",
    )
      .bind(id, key, n(rating))
      .run();
    return send(e, id, "Дякую, відгук збережено.");
  }
  if (d.startsWith("alert:ack:")) {
    const aid = n(d.split(":")[2]);
    await e.DB.prepare(
      "INSERT INTO alert_actions(alert_id,chat_id,action) VALUES(?,?,'acknowledge')",
    )
      .bind(aid, id)
      .run();
    return send(e, id, "✅ Подію прийнято до уваги.");
  }
  if (d.startsWith("alert:resolve:")) {
    const aid = n(d.split(":")[2]);
    await e.DB.batch([
      e.DB.prepare(
        "INSERT INTO alert_actions(alert_id,chat_id,action) VALUES(?,?,'resolve')",
      ).bind(aid, id),
      e.DB.prepare(
        "UPDATE alerts SET resolved_at=COALESCE(resolved_at,CURRENT_TIMESTAMP) WHERE id=?",
      ).bind(aid),
    ]);
    return send(e, id, "✔️ Подію позначено вирішеною.");
  }
  if (d.startsWith("alert:snooze:")) {
    const aid = n(d.split(":")[2]),
      mins = n(d.split(":")[3], 60);
    await e.DB.prepare(
      "INSERT INTO alert_actions(alert_id,chat_id,action,snooze_until) VALUES(?,?,'snooze',datetime('now',?))",
    )
      .bind(aid, id, `+${mins} minutes`)
      .run();
    return send(e, id, `🔕 Відкладено на ${mins} хв.`);
  }
  if (d.startsWith("schedcat:")) {
    const cat = d.split(":")[1];
    return edit(e, id, mid, `🕒 ${CATS[cat]?.[1] || cat}\nОберіть час:`, {
      inline_keyboard: [
        ["07:00", "08:00", "09:00"].map((t) => ({
          text: t,
          callback_data: `schedtime:${cat}:${t}`,
        })),
        ["12:00", "18:00", "21:30"].map((t) => ({
          text: t,
          callback_data: `schedtime:${cat}:${t}`,
        })),
        [{ text: "⬅️", callback_data: "schedules" }],
      ],
    });
  }
  if (d.startsWith("schedtime:")) {
    const [, cat, time] = d.split(":");
    await e.DB.prepare(
      "UPDATE notification_settings SET schedule_time=?,enabled=1 WHERE category_key=?",
    )
      .bind(time, cat)
      .run();
    return send(e, id, `✅ ${CATS[cat]?.[1] || cat}: ${time}`);
  }
  if (d.startsWith("quietset:")) {
    const [, start, end] = d.split(":");
    await e.DB.prepare(
      "UPDATE notification_channels SET quiet_enabled=1,quiet_start=?,quiet_end=? WHERE enabled=1",
    )
      .bind(start, end)
      .run();
    return send(e, id, `✅ Тихі години ${start}-${end}`);
  }
  if (d === "m:main")
    return edit(e, id, mid, "🏠 HOME MONITOR\nОберіть розділ:", MAIN);
  if (d === "m:home") return edit(e, id, mid, "🏠 Стан дому", HOME);
  if (d === "m:analytics") return edit(e, id, mid, "📊 Аналітика", ANALYTICS);
  if (d === "m:events") return edit(e, id, mid, "🚨 Події", EVENTS);
  if (d === "m:notify") return edit(e, id, mid, "🔔 Центр сповіщень", NOTIFY);
  if (d === "m:settings") return edit(e, id, mid, "⚙️ Налаштування", SETTINGS);
  if (d === "m:help") return edit(e, id, mid, "❓ Центр допомоги", HELP);
  if (d === "m:health")
    return edit(e, id, mid, await diag(e), {
      inline_keyboard: [[{ text: "⬅️ Меню", callback_data: "m:main" }]],
    });
  if (d.startsWith("h:"))
    return edit(e, id, mid, help(d.slice(2)), {
      inline_keyboard: [[{ text: "⬅️ Назад", callback_data: "m:help" }]],
    });
  if (d === "m:ai")
    return send(
      e,
      id,
      "Напишіть запитання звичайним текстом. Наприклад: «Коли був найбільший пік?»",
    );
  if (d.startsWith("a:")) {
    const k = d.slice(2);
    if (k === "home") return send(e, id, await homeSummaryRich(e), HOME);
    if (k === "climate") {
      const x = await latest(e);
      return send(
        e,
        id,
        x.zones
          .map(
            (a) =>
              `${a.is_outdoor ? "🌳" : "🏠"} ${a.device_name}: ${fmt(a.temperature)}°C · ${fmt(a.humidity, 0)}% · ${age(a.created_at) <= 15 ? "online" : "offline"}`,
          )
          .join("\n"),
        HOME,
      );
    }
    if (k === "energy") return send(e, id, await energyText(e), HOME);
    if (k === "weather") return send(e, id, await weatherTextRich(e), HOME);
    if (k === "score") return send(e, id, await scoreText(e), HOME);
    if (k === "recs") {
      const x = await latest(e);
      return send(
        e,
        id,
        x.recs
          .map(
            (a) =>
              `💡 ${a.title}: ${a.message}${a.action ? `\nДія: ${a.action}` : ""}`,
          )
          .join("\n\n") || "Немає рекомендацій",
        HOME,
      );
    }
  }
  if (d.startsWith("chart:")) return chart(e, id, n(d.split(":")[1], 7));
  if (d.startsWith("q:"))
    return send(
      e,
      id,
      await ask(
        e,
        id,
        {
          peaks: "Назви 5 найбільших піків за 30 днів",
          cost: "Проаналізуй витрати цього місяця",
          compare: "Порівняй останні 7 днів з попередніми 7",
        }[d.slice(2)],
      ),
    );
  if (d.startsWith("inbox:")) {
    const resolved = d.endsWith("resolved"),
      r = (
        await e.DB.prepare(
          `SELECT * FROM alerts WHERE resolved_at IS ${resolved ? "NOT " : ""}NULL ORDER BY id DESC LIMIT 15`,
        ).all()
      ).results;
    if (!r.length) return edit(e, id, mid, "Подій немає", EVENTS);
    const first = r[0];
    return edit(
      e,
      id,
      mid,
      r
        .map(
          (a) =>
            `${a.severity === "critical" ? "🔴" : "🟠"} #${a.id} ${a.alert_message}`,
        )
        .join("\n"),
      {
        inline_keyboard: [
          [
            { text: "✅ Прийнято", callback_data: `alert:ack:${first.id}` },
            { text: "🔕 60 хв", callback_data: `alert:snooze:${first.id}:60` },
          ],
          [{ text: "✔️ Вирішено", callback_data: `alert:resolve:${first.id}` }],
          [{ text: "⬅️", callback_data: "m:events" }],
        ],
      },
    );
  }
  if (d === "timeline") {
    const r = (
      await e.DB.prepare(
        "SELECT * FROM home_timeline ORDER BY id DESC LIMIT 20",
      ).all()
    ).results;
    return edit(
      e,
      id,
      mid,
      r
        .map(
          (a) => `${a.created_at.slice(5, 16)} ${a.title}\n${a.message || ""}`,
        )
        .join("\n\n") || "Timeline порожній",
      EVENTS,
    );
  }
  if (d === "channels") return edit(e, id, mid, "📣 Канали", await channels(e));
  if (d.startsWith("ch:") && d !== "ch:add") {
    const channelId = n(d.split(":")[1]);
    const view = await channelDetails(e, channelId);
    if (!view)
      return edit(e, id, mid, "⚠️ Канал не знайдено.", await channels(e));
    return edit(e, id, mid, view.text, view.keyboard);
  }
  if (d.startsWith("cht:")) {
    const channelId = n(d.split(":")[1]);
    await e.DB.prepare(
      "UPDATE notification_channels SET enabled=CASE enabled WHEN 1 THEN 0 ELSE 1 END WHERE id=?",
    )
      .bind(channelId)
      .run();
    const view = await channelDetails(e, channelId);
    return edit(e, id, mid, view.text, view.keyboard);
  }
  if (d.startsWith("chtest:")) {
    const channelId = n(d.split(":")[1]),
      c = await e.DB.prepare("SELECT * FROM notification_channels WHERE id=?")
        .bind(channelId)
        .first();
    if (!c) return send(e, id, "⚠️ Канал не знайдено.");
    try {
      await send(
        e,
        c.chat_id,
        "✅ Тест Home Monitor\\nКанал підключений і готовий отримувати повідомлення.",
      );
      return send(e, id, `✅ Тест надіслано в ${c.channel_name || c.chat_id}.`);
    } catch (err) {
      return send(e, id, `⚠️ Telegram відхилив тест: ${err.message}`);
    }
  }
  if (d.startsWith("chc:")) {
    const [, channelId, page] = d.split(":");
    const view = await channelCats(e, n(channelId), n(page));
    if (!view) return send(e, id, "⚠️ Канал не знайдено.");
    return edit(e, id, mid, view.title, view.keyboard);
  }
  if (d.startsWith("chct:")) {
    const [, channelId, key, page] = d.split(":"),
      c = await e.DB.prepare(
        "SELECT chat_id FROM notification_channels WHERE id=?",
      )
        .bind(n(channelId))
        .first();
    if (!c) return send(e, id, "⚠️ Канал не знайдено.");
    const global = await e.DB.prepare(
        "SELECT enabled FROM notification_settings WHERE category_key=?",
      )
        .bind(key)
        .first(),
      current = await e.DB.prepare(
        "SELECT enabled FROM notification_channel_categories WHERE chat_id=? AND category_key=?",
      )
        .bind(c.chat_id, key)
        .first(),
      effective =
        current == null ? n(global?.enabled, 1) : n(current.enabled, 1),
      next = effective ? 0 : 1;
    await e.DB.prepare(
      "INSERT INTO notification_channel_categories(chat_id,category_key,enabled) VALUES(?,?,?) ON CONFLICT(chat_id,category_key) DO UPDATE SET enabled=excluded.enabled",
    )
      .bind(c.chat_id, key, next)
      .run();
    const view = await channelCats(e, n(channelId), n(page));
    return edit(e, id, mid, view.title, view.keyboard);
  }
  if (d.startsWith("chreset:")) {
    const channelId = n(d.split(":")[1]),
      c = await e.DB.prepare(
        "SELECT chat_id FROM notification_channels WHERE id=?",
      )
        .bind(channelId)
        .first();
    if (c)
      await e.DB.prepare(
        "DELETE FROM notification_channel_categories WHERE chat_id=?",
      )
        .bind(c.chat_id)
        .run();
    const view = await channelCats(e, channelId, 0);
    return edit(e, id, mid, view.title, view.keyboard);
  }
  if (d.startsWith("chquiet:")) {
    const channelId = n(d.split(":")[1]);
    return edit(e, id, mid, "🌙 Тихі години для каналу", {
      inline_keyboard: [
        [{ text: "23:00–07:00", callback_data: `chq:${channelId}:2300:0700` }],
        [{ text: "22:00–08:00", callback_data: `chq:${channelId}:2200:0800` }],
        [{ text: "00:00–06:00", callback_data: `chq:${channelId}:0000:0600` }],
        [
          {
            text: "🔕 Вимкнути тихі години",
            callback_data: `chqoff:${channelId}`,
          },
        ],
        [{ text: "⬅️ Назад", callback_data: `ch:${channelId}` }],
      ],
    });
  }
  if (d.startsWith("chq:")) {
    const [, channelId, ss, ee] = d.split(":"),
      tm = (x) => `${x.slice(0, 2)}:${x.slice(2)}`;
    await e.DB.prepare(
      "UPDATE notification_channels SET quiet_enabled=1,quiet_start=?,quiet_end=? WHERE id=?",
    )
      .bind(tm(ss), tm(ee), n(channelId))
      .run();
    const view = await channelDetails(e, n(channelId));
    return edit(e, id, mid, view.text, view.keyboard);
  }
  if (d.startsWith("chqoff:")) {
    const channelId = n(d.split(":")[1]);
    await e.DB.prepare(
      "UPDATE notification_channels SET quiet_enabled=0 WHERE id=?",
    )
      .bind(channelId)
      .run();
    const view = await channelDetails(e, channelId);
    return edit(e, id, mid, view.text, view.keyboard);
  }
  if (d.startsWith("chdel:")) {
    const channelId = n(d.split(":")[1]),
      c = await e.DB.prepare("SELECT * FROM notification_channels WHERE id=?")
        .bind(channelId)
        .first();
    if (!c) return edit(e, id, mid, "Канал не знайдено.", await channels(e));
    return edit(
      e,
      id,
      mid,
      `🗑 Видалити канал «${c.channel_name || c.chat_id}»?\\n\\nБуде видалено канал та його індивідуальні налаштування.`,
      {
        inline_keyboard: [
          [{ text: "🗑 Так, видалити", callback_data: `chdelok:${channelId}` }],
          [{ text: "⬅️ Скасувати", callback_data: `ch:${channelId}` }],
        ],
      },
    );
  }
  if (d.startsWith("chdelok:")) {
    const channelId = n(d.split(":")[1]),
      c = await e.DB.prepare(
        "SELECT chat_id FROM notification_channels WHERE id=?",
      )
        .bind(channelId)
        .first();
    if (c)
      await e.DB.batch([
        e.DB.prepare(
          "DELETE FROM notification_channel_categories WHERE chat_id=?",
        ).bind(c.chat_id),
        e.DB.prepare("DELETE FROM notification_channels WHERE id=?").bind(
          channelId,
        ),
      ]);
    return edit(e, id, mid, "✅ Канал видалено.", await channels(e));
  }
  if (d === "ch:add") {
    if (!e.TELEGRAM_CHAT_ID || id !== String(e.TELEGRAM_CHAT_ID))
      return send(e, id, "⛔ Лише owner");
    await e.DB.prepare(
      "INSERT INTO bot_wizard_state VALUES(?,?,?,?,datetime('now','+30 minutes')) ON CONFLICT(chat_id) DO UPDATE SET wizard_type='channel',step='channel_id',draft_json='{}',expires_at=datetime('now','+30 minutes')",
    )
      .bind(id, "channel", "channel_id", "{}")
      .run();
    return send(e, id, "Введіть @username або Chat ID каналу:", {
      force_reply: true,
    });
  }
  if (d.startsWith("cats:"))
    return edit(
      e,
      id,
      mid,
      "🔔 Категорії",
      await cats(e, n(d.split(":")[1], 0)),
    );
  if (d.startsWith("ct:")) {
    const [, k, p] = d.split(":"),
      r = await e.DB.prepare(
        "SELECT enabled FROM notification_settings WHERE category_key=?",
      )
        .bind(k)
        .first();
    await e.DB.prepare(
      "UPDATE notification_settings SET enabled=? WHERE category_key=?",
    )
      .bind(r.enabled ? 0 : 1, k)
      .run();
    return edit(e, id, mid, "🔔 Категорії", await cats(e, n(p)));
  }
  if (d === "ntest") {
    const r = (
      await e.DB.prepare(
        "SELECT * FROM notification_channels WHERE enabled=1",
      ).all()
    ).results;
    for (const x of r)
      try {
        await send(e, x.chat_id, "✅ Тест Home Monitor");
      } catch {}
    return send(e, id, `Тест: ${r.length} каналів`);
  }
  if (d === "schedules") {
    const ks = [
      "morning_report",
      "evening_report",
      "energy_cost",
      "weekly_digest",
      "monthly_digest",
      "ai_insights",
      "useful_info",
    ];
    return edit(e, id, mid, "🕒 Оберіть звіт:", {
      inline_keyboard: [
        ...ks.map((k) => [
          {
            text: `${CATS[k][0]} ${CATS[k][1]}`,
            callback_data: `schedcat:${k}`,
          },
        ]),
        [{ text: "⬅️", callback_data: "m:notify" }],
      ],
    });
  }
  if (d === "quiet")
    return edit(e, id, mid, "🌙 Оберіть тихі години для активних каналів:", {
      inline_keyboard: [
        [{ text: "23:00–07:00", callback_data: "quietset:23:00:07:00" }],
        [{ text: "22:00–08:00", callback_data: "quietset:22:00:08:00" }],
        [{ text: "00:00–06:00", callback_data: "quietset:00:00:06:00" }],
        [{ text: "⬅️", callback_data: "m:notify" }],
      ],
    });
  if (d === "modes") {
    const r = (await e.DB.prepare("SELECT * FROM home_modes").all()).results;
    return edit(e, id, mid, "🏠 Режим", {
      inline_keyboard: [
        ...r.map((x) => [
          {
            text: `${x.enabled ? "✅" : "○"} ${x.title}`,
            callback_data: `mode:${x.mode_key}`,
          },
        ]),
        [{ text: "⬅️", callback_data: "m:settings" }],
      ],
    });
  }
  if (d.startsWith("mode:")) {
    await e.DB.batch([
      e.DB.prepare("UPDATE home_modes SET enabled=0"),
      e.DB.prepare("UPDATE home_modes SET enabled=1 WHERE mode_key=?").bind(
        d.slice(5),
      ),
    ]);
    return send(e, id, "✅ Режим активовано");
  }
  if (d === "live") {
    await live(e, id);
    return send(e, id, "✅ Live Card оновлено");
  }
  if (d === "export") {
    const r = await e.DB.prepare("SELECT * FROM notification_settings").all();
    return send(e, id, JSON.stringify(r.results, null, 2).slice(0, 3900));
  }
  if (d === "aiset")
    return edit(
      e,
      id,
      mid,
      "🤖 AI: read-only SQL, пам'ять, general chat, /clear",
      SETTINGS,
    );
  if (d === "roles")
    return edit(e, id, mid, "👥 Owner · Admin · Viewer", SETTINGS);
  if (d === "thresholds")
    return edit(e, id, mid, "💡 Пороги зберігаються у settings API.", SETTINGS);
}
function quiet(ch, p) {
  if (!ch.quiet_enabled) return false;
  return ch.quiet_start < ch.quiet_end
    ? p.time >= ch.quiet_start && p.time < ch.quiet_end
    : p.time >= ch.quiet_start || p.time < ch.quiet_end;
}
async function push(e, cat, key, msg, critical = false) {
  const s = await e.DB.prepare(
    "SELECT * FROM notification_settings WHERE category_key=?",
  )
    .bind(cat)
    .first();
  if (!s?.enabled) return;
  const p = now(),
    dedupe = `${cat}:${key}`,
    cs = (
      await e.DB.prepare(
        "SELECT c.* FROM notification_channels c LEFT JOIN notification_channel_categories x ON x.chat_id=c.chat_id AND x.category_key=? WHERE c.enabled=1 AND COALESCE(x.enabled,1)=1",
      )
        .bind(cat)
        .all()
    ).results;
  for (const c of cs) {
    const repeatable = cat === "recommendations" || cat === "ventilation",
      already = await e.DB.prepare(
        "SELECT 1 ok FROM notification_log WHERE dedupe=? AND chat_id=? LIMIT 1",
      )
        .bind(dedupe, c.chat_id)
        .first();
    if (already && !repeatable) continue;
    const recent = await e.DB.prepare(
      "SELECT 1 ok FROM notification_log WHERE chat_id=? AND category_key=? AND sent_at>=datetime(\'now\',?) LIMIT 1",
    )
      .bind(c.chat_id, cat, `-${s.cooldown || 60} minutes`)
      .first();
    if (recent && !critical) continue;
    if (!critical && quiet(c, p)) {
      await e.DB.prepare(
        "INSERT OR IGNORE INTO notification_queue(chat_id,category_key,message,dedupe,status,deliver_after) VALUES(?,?,?,?,\'pending\',datetime(\'now\',\'+8 hours\'))",
      )
        .bind(c.chat_id, cat, msg, dedupe)
        .run();
      continue;
    }
    try {
      await send(e, c.chat_id, msg, {
        inline_keyboard: [
          [
            { text: "👍", callback_data: `fb:${key}:1` },
            { text: "👎", callback_data: `fb:${key}:-1` },
          ],
        ],
      });
      await e.DB.prepare(
        "INSERT OR IGNORE INTO notification_log(dedupe,chat_id,category_key,message) VALUES(?,?,?,?)",
      )
        .bind(dedupe, c.chat_id, cat, msg)
        .run();
    } catch (err) {
      console.error("PUSH", cat, err?.message || err);
    }
  }
}
async function stateEvent(
  e,
  stateKey,
  active,
  cat,
  onMessage,
  offMessage = null,
  critical = false,
) {
  const key = `event:${stateKey}`,
    old = await e.DB.prepare(
      "SELECT state_value FROM agent_state WHERE state_key=?",
    )
      .bind(key)
      .first(),
    prev = old?.state_value;
  const next = active ? "active" : "normal";
  if (prev === next) return false;
  await e.DB.prepare(
    "INSERT INTO agent_state(state_key,state_value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP",
  )
    .bind(key, next)
    .run();
  if (active)
    await push(e, cat, `${stateKey}:on:${Date.now()}`, onMessage, critical);
  else if (prev === "active" && offMessage)
    await push(e, cat, `${stateKey}:off:${Date.now()}`, offMessage, false);
  return true;
}
async function maintenance(e, p) {
  const k = "maintenance:last_date",
    r = await e.DB.prepare(
      "SELECT state_value FROM agent_state WHERE state_key=?",
    )
      .bind(k)
      .first();
  if (r?.state_value === p.date) return;
  await e.DB.batch([
    e.DB.prepare("DELETE FROM recommendations WHERE status=\'expired\'"),
    e.DB.prepare(
      "DELETE FROM notification_queue WHERE status=\'sent\' OR deliver_after<datetime(\'now\',\'-1 day\')",
    ),
    e.DB.prepare(
      "DELETE FROM notification_log WHERE sent_at<datetime(\'now\',\'-30 days\')",
    ),
    e.DB.prepare(
      "DELETE FROM alert_actions WHERE created_at<datetime(\'now\',\'-30 days\')",
    ),
    e.DB.prepare(
      "INSERT INTO agent_state(state_key,state_value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP",
    ).bind(k, p.date),
  ]);
}
async function agent(e) {
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
    await stateEvent(
      e,
      `sensor:${id}`,
      isOffline,
      "device_health",
      `📡 ${z.device_name || id}: датчик offline.`,
      `✅ ${z.device_name || id}: датчик знову online.`,
    );
  }
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
async function message(e, m) {
  const id = String(m.chat.id),
    t = m.text || "";
  if (await wizard(e, id, t)) return;
  if (t === "/start" || t === "/menu" || t === "🏠 Меню")
    return send(e, id, "🏠 HOME MONITOR\nОберіть розділ:", MAIN);
  if (t === "/clear") {
    await e.DB.prepare("DELETE FROM ai_chat_history WHERE chat_id=?")
      .bind(id)
      .run();
    return send(e, id, "🧹 AI-контекст очищено", MAIN);
  }
  return send(e, id, await ask(e, id, t), MAIN);
}
export default {
  async fetch(req, e) {
    await schema(e);
    const u = new URL(req.url);
    if (u.pathname === "/")
      return Response.json({
        service: "Home Monitor",
        version: "4.2.3",
        status: "online",
      });
    if (u.pathname === "/health")
      return Response.json({
        ok: true,
        db: !!e.DB,
        ai: !!e.AI,
        token: !!e.TELEGRAM_BOT_TOKEN,
      });
    if (u.pathname === "/setup") {
      if (
        !e.SETUP_SECRET ||
        req.headers.get("Authorization") !== `Bearer ${e.SETUP_SECRET}`
      )
        return new Response("Unauthorized", { status: 401 });
      const o = u.origin,
        p = {
          url: `${o}/webhook`,
          allowed_updates: ["message", "edited_message", "callback_query"],
        };
      if (e.WEBHOOK_SECRET) p.secret_token = e.WEBHOOK_SECRET;
      await Promise.all([
        tg(e, "setWebhook", p),
        tg(e, "setMyCommands", {
          commands: [
            { command: "menu", description: "Головне меню" },
            { command: "help", description: "Допомога" },
            { command: "clear", description: "Очистити AI" },
          ],
        }),
      ]);
      return Response.json({ ok: true, webhook: p.url });
    }
    if (u.pathname === "/agent/run") {
      if (!e.AGENT_SECRET || u.searchParams.get("secret") !== e.AGENT_SECRET)
        return new Response("Unauthorized", { status: 401 });
      return Response.json(await agent(e));
    }
    if (u.pathname === "/webhook" && req.method === "POST") {
      if (
        e.WEBHOOK_SECRET &&
        req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== e.WEBHOOK_SECRET
      )
        return new Response("Unauthorized", { status: 401 });
      const x = await req.json();
      try {
        x.callback_query
          ? await callback(e, x.callback_query)
          : await message(e, x.message || x.edited_message);
      } catch (z) {
        console.error(z);
        const id = x.message?.chat?.id || x.callback_query?.message?.chat?.id;
        if (id) await send(e, id, "⚠️ Помилка. Перевірте логи.", MAIN);
      }
      return new Response("OK");
    }
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(c, e, ctx) {
    ctx.waitUntil(agent(e).catch(console.error));
  },
};
