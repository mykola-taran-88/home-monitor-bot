// Shared bot constants, formatting helpers, and Telegram keyboards.
export const MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-sd",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];
export const CATS = {
  critical_alerts: ["🔴", "Критичні алерти", "event", 30],
  weather_alerts: ["⛈️", "Небезпечна погода", "event", 180],
  weather_forecast: ["🌦️", "Прогноз погоди та застереження", "daily", 1440, "07:00"],
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
export const ALLOWED = new Set([
  "power_logs",
  "climate_logs",
  "devices",
  "weather_current",
  "weather_hourly",
  "weather_forecast",
  "alerts",
  "recommendations",
]);
export const BLOCK =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|UPSERT|ATTACH|DETACH|PRAGMA|VACUUM|TRIGGER|BEGIN|COMMIT|ROLLBACK)\b/i;

export const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export const fmt = (v, d = 1) =>
  v == null || isNaN(+v)
    ? "—"
    : Number(v).toLocaleString("uk-UA", { maximumFractionDigits: d });
export const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
export const age = (v) =>
  v
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(String(v).replace(" ", "T") + "Z")) / 60000,
        ),
      )
    : null;
export const kyivDateTime = (offsetMinutes = 0) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(Date.now() + offsetMinutes * 60000))
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
export const comfort = (t, h) =>
  clamp(
    100 -
      Math.abs(n(t) - 22.5) * 9 -
      Math.abs(n(h) - 50) * 1.2 -
      (h > 70 || h < 25 ? 10 : 0),
  );

export const MAIN = {
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
export const HOME = {
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
export const ANALYTICS = {
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
export const EVENTS = {
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
export const NOTIFY = {
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
export const SETTINGS = {
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
export const HELP = {
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
