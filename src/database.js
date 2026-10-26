import { CATS, n } from "./constants.js";
import { explainScore } from "./v5/engines.js";

export async function schema(e) {
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

export async function latest(e) {
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
      "SELECT r.*,l.fingerprint,l.occurrence_count,l.first_seen_at,l.last_seen_at,l.last_notified_at,l.snooze_until FROM recommendations r LEFT JOIN recommendation_lifecycle l ON l.recommendation_key=r.recommendation_key WHERE r.status='active' AND (l.snooze_until IS NULL OR l.snooze_until<=CURRENT_TIMESTAMP) ORDER BY r.score DESC LIMIT 50",
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

export function score(x) {
  return explainScore(x);
}

export async function energy(e, start) {
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

export function now() {
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
