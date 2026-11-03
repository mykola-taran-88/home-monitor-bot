import { CATS } from "./constants.js";
import { latest, score } from "./database.js";
import { energyOverview } from "./reports.js";

const HIDDEN_TABLE =
  /(?:secret|token|credential|password|session|login_attempt|auth|audit|chat_history|wizard_state|bot_users|sqlite_sequence)/i;
const HIDDEN_COLUMN =
  /(?:secret|token|password|credential|api.?key|private.?key|chat_id|ip_hash|session_hash|old_value_json|new_value_json)/i;
const HIDDEN_SETTING =
  /(?:secret|token|pass|credential|api.?key|(?:^|[_-])key(?:[_-]|$)|jwt|signing|auth|private)/i;
const SAFE_SETTINGS = [
  "timezone",
  "city",
  "latitude",
  "longitude",
  "day_tariff",
  "night_tariff",
  "day_start",
  "night_start",
  "device_timeout_minutes",
  "max_power_alert_watts",
  "voltage_low_alert",
  "voltage_high_alert",
  "default_temp_low",
  "default_temp_high",
  "default_humidity_high",
  "rain_alert_probability",
  "ventilation_humidity_threshold",
  "telegram_enabled",
  "climate_temp_delta_30m_c",
  "climate_humidity_delta_30m_pct",
  "climate_high_humidity_pct",
  "climate_low_humidity_pct",
  "condensation_margin_c",
  "bill_change_pct",
  "bill_change_uah",
  "sleep_start",
  "sleep_end",
  "event_group_window_min",
  "smart_digest_max_items",
  "climate_expected_interval_min",
  "high_priority_reminder_hours",
];
const PRIVATE_TABLES = new Set(["ai_chat_history"]);
let schemaCache = null;
let schemaCacheAt = 0;

export const BOT_LOGIC = `
Поведінка Home Monitor (з коду бота й API):
- Бот оновлює агента кожні 5 хвилин. Він читає поточні показники, оцінює умови, перевіряє події та планові звіти.
- Home Score: комфорт клімату й стан системи. Комфорт кімнати: 100 - |температура-22.5|*9 - |вологість-50|*1.2; додатково мінус 10 при вологості >70% або <25%; результат 0..100. Середній комфорт indoor-датчиків має вагу 65%, стан системи 35%; якщо клімату немає — використовується лише стан системи. Стан системи починається зі 100, мінус 15 за кожен offline/несвіжий датчик (>15 хв), мінус 20 за critical alert і мінус 3 за кожен активний alert, результат 0..100. Впевненість — частка свіжих indoor-датчиків.
- Sleep Score обчислюється API у вікні sleep_start–sleep_end (типово 22:00–07:00): клімат має вагу 40 і базується на середньому комфорті, надійність — 25 і залежить від частки датчиків, що передавали дані, енергія — 20, події — 15 і знижуються за кількістю нічних алертів. Зараз API передає energy=null, поки немає надійної багатонічної бази; відсутні компоненти виключаються з нормалізації, confidence — сума ваг доступних компонентів. Деталі останньої оцінки зберігаються в house_sleep_scores.components_json/reasons_json.
- Прогноз у звітах бота бере фактичні витрати від початку місяця й масштабує їх за кількістю днів. Його впевненість низька до 7 днів, висока від 20 днів та 80% покриття годин, середня від 50% покриття. API Caretaker окремо прогнозує денне/нічне споживання до кінця місяця за тарифами (або тарифами, оціненими з фактичних даних); рекомендація рахунку оновлюється, коли зміна досягає порогу у відсотках або гривнях.
- Енергетичні звіти беруть споживання й вартість із погодинних сум, а потужність/напругу обчислюють із сум, кількості вимірів і min/max. Графік «Сьогодні» показує годинні точки, «7 днів» — 3-годинні, «30 днів» — денні; кліматичні графіки використовують такі самі погодинні/денні агрегати.
- Планові сповіщення працюють за notification_settings: enabled, mode, schedule_time, weekday/monthday, cooldown. Розклад інтерпретується у Europe/Kyiv; Cron запускає перевірку кожні 5 хв, а стан/блокування в scheduled_jobs_state не дають відправляти повторно за той самий слот. Для weekly типовий день — понеділок, для monthly — задане число місяця. Для AI Caretaker звіт може чекати завершення ранкового звіту, якщо часи близько (до 2 годин).
- Кому надходять повідомлення: лише активним notification_channels; для конкретної категорії діє channel override з notification_channel_categories, а за відсутності override категорія увімкнена за замовчуванням. Глобальна категорія також має бути enabled.
- Тригерні сповіщення виникають при зміні стану/порогової умови: датчик offline понад 15 хв; високе навантаження вище 85% max_power_alert_watts, критичне — вище 100%; дощ — 70% для нового стану, 50% для підтримки активного; погодні ризики оцінюються на найближчі приблизно 2 години (опади, вітер від 50 км/год, туман, ожеледь, сніг, гроза, спека від 35°C, мороз до -15°C); рекомендації й конденсат беруться з активних правил API.
- Climate Anomaly Engine API використовує свіжі виміри за останні 130 хв: стрибок температури за ~30 хв від 3°C, ріст вологості за ~30 хв від 20 процентних пунктів (потрібні щонайменше 3 свіжі виміри), висока вологість від 75% з покриттям вимірів за годину не менше 80%, низька вологість до 25% з покриттям за 2 години не менше 80%. Пороги можна змінити в безпечних налаштуваннях D1. Подія переходить normal→pending→active при повторному підтвердженні; зникає після етапу recovering.
- Перед відправленням перевіряються дедуплікація та cooldown. Для recommendations мінімальний cooldown 12 годин, для рекомендацій рахунку — 24 години. Некритичні повідомлення у тихі години ставляться в чергу до їх завершення; critical можуть проходити тихі години й cooldown. Події датчиків групуються коротким буфером перед відправленням.
- SQL-помічник читає всі робочі таблиці D1, включно з безпечними налаштуваннями, розкладами, сповіщеннями, прогнозами та історією вимірювань. Токени, паролі, авторизаційні/адмінські таблиці й приватна історія AI-чатів приховані; секретні ключі налаштувань ідентифікуються та вилучаються з результатів. Для великих часових діапазонів використовуються погодинні зведення.
- AI може пояснювати дані та функції, але не змінює конфігурацію і не надсилає повідомлення за командою чату. Фактичні значення відповіді мають спиратися на передані рядки D1.
`.trim();

export async function safeTableSchema(e) {
  if (schemaCache && Date.now() - schemaCacheAt < 10 * 60_000)
    return schemaCache;
  const rows =
    (
      await e.DB.prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      ).all()
    ).results || [];
  schemaCache = rows
    .filter(
      (row) => !HIDDEN_TABLE.test(row.name) && !PRIVATE_TABLES.has(row.name),
    )
    .map((row) => ({ name: row.name, sql: row.sql || "" }));
  schemaCacheAt = Date.now();
  return schemaCache;
}

export function safeSqlError(sql, params, tables) {
  const query = String(sql)
    .trim()
    .replace(/^```(?:sql)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/;\s*$/, "")
    .trim();
  if (query.length > 6000) return "Запит завеликий.";
  if (!/^(?:SELECT|WITH)\b/i.test(query) || /;|--|\/\*|\*\//.test(query))
    return "Кожен запит має бути окремим SELECT лише для читання.";
  if (
    /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|UPSERT|ATTACH|DETACH|PRAGMA|VACUUM|TRIGGER|BEGIN|COMMIT|ROLLBACK)\b/i.test(
      query,
    )
  )
    return "Дозволені лише запити читання.";
  const resultLimit = query.match(/\bLIMIT\s+(\d+)(?:\s+OFFSET\s+\d+)?\s*$/i);
  if (
    !resultLimit ||
    Number(resultLimit[1]) < 1 ||
    Number(resultLimit[1]) > 1000
  )
    return "LIMIT має бути додатним і не більшим за 1000 рядків.";
  if (
    /\b(?:ai_chat_history|sqlite_master|sqlite_schema|pragma_\w*)\b/i.test(
      query,
    )
  )
    return "Запит містить приватну або системну таблицю.";
  const selectClause = query.slice(0, query.search(/\bFROM\b/i));
  if (HIDDEN_COLUMN.test(selectClause))
    return "Секретні та ідентифікаційні поля не можна повертати у відповідях.";
  const joinsOnly = query.replace(
    /\bON\b[^)]*?\b(?:\w+\.)?chat_id\s*=\s*(?:\w+\.)?chat_id\b/gi,
    "",
  );
  if (/\bchat_id\b/i.test(joinsOnly))
    return "Ідентифікатори чатів дозволені лише для об’єднання таблиць.";
  const refs = [
    ...query.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi),
  ].map((x) => x[1].toLowerCase());
  const uniqueRefs = [...new Set(refs)];
  if (!uniqueRefs.length || uniqueRefs.some((name) => !tables.has(name)))
    return "Таблиця відсутня у списку доступних таблиць.";
  if (
    uniqueRefs.includes("settings") &&
    !/^SELECT\s+(?:\w+\.)?setting_key\s*,\s*(?:\w+\.)?setting_value\s+FROM\s+settings\b/i.test(
      query,
    )
  )
    return "Налаштування читаються лише як пари ключ-значення з автоматичним вилученням секретів.";
  const rawRefs = uniqueRefs.filter(
    (name) => name === "power_logs" || name === "climate_logs",
  );
  if (rawRefs.length) {
    const timeBound = query.match(
      /\bcreated_at\s*>=\s*datetime\(\s*'now'\s*,\s*['"]-(\d+)\s*(hours?|days?)['"]\s*\)/i,
    );
    if (rawRefs.length > 1 || !timeBound)
      return "Для сирих журналів задай межу created_at не давнішу за 90 днів. Для довгих періодів використовуй погодинні зведення.";
    const amount = Number(timeBound[1]),
      unit = timeBound[2].toLowerCase(),
      hours = unit.startsWith("day") ? amount * 24 : amount;
    if (hours > 90 * 24)
      return "Сирі журнали доступні максимум за 90 днів; для довших періодів використовуй погодинні зведення.";
  }
  const rollupRefs = uniqueRefs.filter(
    (name) => name === "power_hourly" || name === "climate_hourly",
  );
  if (rollupRefs.length) {
    const bound = query.match(
      /\bhour_start\s*>=\s*datetime\(\s*'now'\s*,\s*['"]-(\d+)\s*(hours?|days?)['"]\s*\)/i,
    );
    if (bound) {
      const amount = Number(bound[1]),
        unit = bound[2].toLowerCase(),
        hours = unit.startsWith("day") ? amount * 24 : amount;
      if (hours > 24 * 365)
        return "Період погодинного зведення має бути не більшим за рік.";
    } else {
      const range = query.match(
        /\bhour_start\s*>=\s*\?\s+AND\s+(?:\w+\.)?hour_start\s*<\s*\?/i,
      );
      if (!range) return "Для погодинних зведень задай часові межі до 90 днів.";
      const firstParam = (sql.slice(0, range.index).match(/\?/g) || []).length,
        start = Date.parse(params[firstParam]),
        end = Date.parse(params[firstParam + 1]);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        end - start > 365 * 86400_000
      )
        return "Діапазон погодинного зведення має бути коректним і не більшим за рік.";
    }
  }
  if (
    params.length > 50 ||
    params.some((value) => typeof value === "object" && value !== null)
  )
    return "Забагато або неприпустимі параметри.";
  return null;
}

const asksNotifications = (q) =>
  /сповіщ|повідомлен|канал|чат|тихі годин|cooldown|кулдаун|розклад|тригер|порог|правил.*спрацю/i.test(
    q,
  );
const asksScore = (q) =>
  /home\s*score|sleep\s*score|оцінк|рейтинг|балів|комфорт/i.test(q);
const asksEnergy = (q) =>
  /рахунк|витрат|енерг|електрик|тариф|споживан/i.test(q);
const asksWhy = (q) =>
  /чому|поясн|причин|вплива|розрахун|формул|як\s+(?:раху|обчисл|форму)/i.test(
    q,
  );
const asksSettings = (q) =>
  /налашт|порог|ставк|тариф|правил|температур|вологіст|таймаут/i.test(q);

export async function getBotEvidence(e, question) {
  const evidence = { currentCodeLogic: BOT_LOGIC };
  if (asksNotifications(question)) {
    const [settings, channels] = await Promise.all([
      e.DB.prepare(
        "SELECT category_key,enabled,mode,schedule_time,weekday,monthday,cooldown FROM notification_settings LIMIT 100",
      ).all(),
      e.DB.prepare(
        "SELECT c.id,c.channel_name,c.enabled,c.quiet_enabled,c.quiet_start,c.quiet_end,x.category_key,x.enabled category_enabled FROM notification_channels c LEFT JOIN notification_channel_categories x ON x.chat_id=c.chat_id LIMIT 200",
      ).all(),
    ]);
    evidence.notificationCategories = (settings.results || []).map((row) => ({
      ...row,
      category: CATS[row.category_key]?.[1] || row.category_key,
      defaultMode: CATS[row.category_key]?.[2] || null,
      defaultCooldown: CATS[row.category_key]?.[3] || null,
      defaultTime: CATS[row.category_key]?.[4] || null,
    }));
    const channelMap = new Map();
    for (const row of channels.results || []) {
      const item = channelMap.get(row.id) || {
        channel: row.channel_name || `Канал ${row.id}`,
        enabled: Boolean(row.enabled),
        quietHours: row.quiet_enabled
          ? `${row.quiet_start}–${row.quiet_end}`
          : "вимкнені",
        categories: [],
      };
      if (row.category_key)
        item.categories.push({
          category: CATS[row.category_key]?.[1] || row.category_key,
          enabled:
            row.category_enabled == null ? true : Boolean(row.category_enabled),
        });
      channelMap.set(row.id, item);
    }
    evidence.notificationChannels = [...channelMap.values()];
  }
  if (asksSettings(question) || asksEnergy(question)) {
    const safeSettings = await e.DB.prepare(
      `SELECT setting_key,setting_value FROM settings WHERE setting_key IN (${SAFE_SETTINGS.map(() => "?").join(",")})`,
    )
      .bind(...SAFE_SETTINGS)
      .all();
    evidence.safeSettings = (safeSettings.results || []).filter(
      (row) => !HIDDEN_SETTING.test(row.setting_key),
    );
  }
  if (asksScore(question) && asksWhy(question)) {
    const current = await latest(e);
    evidence.homeScore = {
      calculation: score(current),
      rooms: current.zones.map((row) => ({
        device: row.device_name || row.device_id,
        outdoor: Boolean(row.is_outdoor),
        temperature: row.temperature,
        humidity: row.humidity,
        created_at: row.created_at,
      })),
      activeAlerts: current.alerts.map((row) => ({
        type: row.alert_type,
        severity: row.severity,
        message: row.alert_message,
        created_at: row.created_at,
      })),
    };
    const sleep = await e.DB.prepare(
      "SELECT sleep_date,score,confidence,components_json,reasons_json,created_at FROM house_sleep_scores ORDER BY sleep_date DESC LIMIT 1",
    ).first();
    if (sleep) evidence.latestSleepScore = sleep;
  }
  if (asksEnergy(question) && asksWhy(question))
    evidence.energyReport = await energyOverview(e);
  return evidence;
}

export function capabilitiesAnswer() {
  const categories = Object.values(CATS).map((row) => row[1]);
  return [
    "🤖 Я можу допомогти розібратися з Home Monitor:",
    "• показати й пояснити поточні дані датчиків, електроенергії та погоди;",
    "• відповідати на питання про історичні дані й обмежені періоди;",
    "• пояснити Home Score, Sleep Score, комфорт, прогноз рахунку та причини оцінки;",
    "• пояснити функції бота, налаштування сповіщень, канали, розклади, тригери, пороги й тихі години;",
    "• розповісти про активні події, рекомендації, аномалії й діагностику.",
    "",
    `Категорії сповіщень у поточному коді: ${categories.join("; ")}.`,
    "Питай, наприклад: «Чому Home Score 72?», «Які канали отримують попередження про погоду?» або «Які пороги виявляють offline датчик?»",
    "Я лише пояснюю та читаю дані; змінювати налаштування через AI-чат не можу.",
  ].join("\n");
}

export function isCapabilitiesQuestion(question) {
  return /що\s+(?:ти|бот)\s+(?:вмієш|можеш)|що\s+можна\s+тебе\s+спитати|які\s+(?:в тебе|у тебе|в бота|у бота)\s+(?:є\s+)?(?:функц|можливост)|перелік\s+функц|можливост.*бот/i.test(
    question,
  );
}

export function redactDatabaseRows(rows) {
  return rows
    .filter(
      (row) =>
        !(row.setting_key && HIDDEN_SETTING.test(String(row.setting_key))),
    )
    .map((row) =>
      Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => !HIDDEN_COLUMN.test(key))
          .map(([key, value]) => [
            key,
            typeof value === "string" ? value.slice(0, 1200) : value,
          ]),
      ),
    );
}
