import { CATS, NOTIFY, n, age } from "./constants.js";
import { latest, now } from "./database.js";
import { homeSummaryRich } from "./reports.js";
import { tg, send } from "./telegram.js";

export async function homeText(e) {
  return homeSummaryRich(e);
}
export function help(k) {
  return (
    {
      start:
        "🚀 ШВИДКИЙ СТАРТ\nНатискайте кнопки. Для AI просто пишіть питання. Канали додаються через Сповіщення → Канали.",
      features:
        "🏠 МОЖЛИВОСТІ\nСтан дому, AI Caretaker із перевіреними фактами, Smart Morning Digest, Recommendation Center, нічний Sleep Score, пояснюваний Home Score, погода, енергія та канали.",
      channels:
        "📣 КАНАЛИ\nДодайте бота адміністратором каналу, потім використайте майстер «Додати канал».",
      notify:
        "🔔 СПОВІЩЕННЯ\nAI Caretaker, Smart Digest, стан датчиків і небезпечна погода налаштовуються окремими категоріями. Рекомендації групуються за ключем і не повторюються без зміни.",
      schedule:
        "🕒 РОЗКЛАДИ\nЧас Europe/Kyiv. Scheduler надолужує останній пропущений звіт та не дублює виконаний запуск.",
      ai: "🤖 AI\nAI Caretaker групує факти про критичні події, клімат, енергію, погоду, Home Score і Sleep Score. Якщо AI недоступний, надсилається детермінований звіт. Загальні питання використовують read-only SQL.",
      security:
        "🔐 БЕЗПЕКА\nАдмін — TELEGRAM_CHAT_ID. SQL тільки SELECT. /agent/run вимагає AGENT_SECRET.",
    }[k] || "❓ Оберіть розділ довідки."
  );
}
export async function recommendationCenter(e, filter = "active") {
  const clauses = {
      critical: "r.status='active' AND r.priority='critical'",
      today: "r.status='active' AND r.priority IN ('high','warning','medium') AND (l.snooze_until IS NULL OR l.snooze_until<=CURRENT_TIMESTAMP)",
      later: "r.status='active' AND (l.snooze_until>CURRENT_TIMESTAMP OR r.priority IN ('low','info'))",
      done: "r.status IN ('resolved','expired')",
      active: "r.status='active' AND (l.snooze_until IS NULL OR l.snooze_until<=CURRENT_TIMESTAMP)",
    },
    rows = (await e.DB.prepare(
      `SELECT r.*,l.occurrence_count,l.first_seen_at,l.last_seen_at,l.snooze_until,l.metadata_json lifecycle_json FROM recommendations r LEFT JOIN recommendation_lifecycle l ON l.recommendation_key=r.recommendation_key WHERE ${clauses[filter] || clauses.active} ORDER BY CASE r.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,r.created_at DESC LIMIT 8`,
    ).all()).results,
    lines = [`💡 РЕКОМЕНДАЦІЇ · ${({ critical: "Критичні", today: "Сьогодні", later: "Пізніше", done: "Виконані", active: "Активні" })[filter] || "Активні"}`],
    keyboard = [];
  for (const r of rows) {
    let evidence = {};
    try { evidence = JSON.parse(r.lifecycle_json || r.metadata_json || "{}"); } catch {}
    lines.push(`\n${r.priority === "critical" ? "🔴" : r.priority === "high" || r.priority === "warning" ? "🟠" : "ℹ️"} ${r.title}${r.room_id ? ` · ${r.room_id}` : ""}\n${r.message}${r.action ? `\nДія: ${r.action}` : ""}${r.last_seen_at ? `\nОновлено: ${r.last_seen_at}` : ""}`);
    if (filter === "done") continue;
    keyboard.push([{ text: "✅ Виконано", callback_data: `recdone:${r.id}` }, { text: "🔕 1 год", callback_data: `recsnooze:${r.id}:60` }, { text: "🔕 До завтра", callback_data: `recsnooze:${r.id}:tomorrow` }]);
    keyboard.push([{ text: "📋 Деталі", callback_data: `recdetail:${r.id}` }, { text: "👎 Не корисно", callback_data: `recbad:${r.id}` }]);
  }
  if (!rows.length) lines.push("\nНемає рекомендацій у цій групі.");
  keyboard.push([
    { text: "🔴 Критичні", callback_data: "recs:critical" },
    { text: "🟠 Сьогодні", callback_data: "recs:today" },
  ], [
    { text: "⏳ Пізніше", callback_data: "recs:later" },
    { text: "✅ Виконані", callback_data: "recs:done" },
  ], [{ text: "⬅️ Назад", callback_data: "m:home" }]);
  return { text: lines.join("\n").slice(0, 3800), keyboard: { inline_keyboard: keyboard } };
}
export async function cats(e, page = 0) {
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
export async function channels(e) {
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
export async function channelDetails(e, channelId) {
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
export async function channelCats(e, channelId, page = 0) {
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
export async function wizard(e, id, text) {
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

export async function diag(e) {
  const x = await latest(e),
    st = await e.DB.prepare(
      "SELECT * FROM agent_state WHERE state_key='last_run'",
    ).first(),
    off = x.zones.filter(
      (a) => age(a.created_at) > 15 || age(a.created_at) == null,
    ).length,
    jobs=await e.DB.prepare("SELECT last_status,COUNT(*) count,MAX(last_success_at) last_success_at,MAX(last_error) last_error FROM scheduled_jobs_state GROUP BY last_status ORDER BY last_status").all(),
    pending=await e.DB.prepare("SELECT COUNT(*) count,MIN(flush_after) next_flush FROM event_buffer WHERE status='pending'").first(),
    recs=await e.DB.prepare("SELECT COUNT(*) count FROM recommendations WHERE status='active'").first();
  return [
    "🩺 ДІАГНОСТИКА",
    `D1 ${e.DB ? "✅" : "⛔"}`,
    `AI ${e.AI ? "✅" : "⛔"}`,
    `Telegram ${e.TELEGRAM_BOT_TOKEN ? "✅" : "⛔"}`,
    `Cron ${st ? st.updated_at : "немає"}`,
    `Weather ${x.weather ? "✅" : "⛔"}`,
    `Nodes ${x.zones.length - off}/${x.zones.length}`,
    `Active recommendations ${recs?.count ?? "—"}`,
    `Buffered event groups ${pending?.count ?? 0}${pending?.next_flush ? ` · next ${pending.next_flush}` : ""}`,
    ...jobs.results.map(j=>`Scheduler ${j.last_status}: ${j.count} · last success ${j.last_success_at||"—"}${j.last_error?` · ${j.last_error}`:""}`),
    `Power ${x.power && age(x.power.created_at) <= 15 ? "✅" : "⛔"}`,
  ].join("\n");
}
export async function live(e, id) {
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
