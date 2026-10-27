import { CATS, n, fmt, age, MAIN, HOME, ANALYTICS, EVENTS, NOTIFY, SETTINGS, HELP } from "../constants.js";
import { latest } from "../database.js";
import { ask } from "../ai.js";
import { homeSummaryRich, energyText, weatherTextRich, scoreText, chart, sleepText, caretakerReport } from "../reports.js";
import { cats, channels, channelDetails, channelCats, diag, help, live, recommendationCenter } from "../menus.js";
import { tg, send, edit } from "../telegram.js";

export async function callback(e, q) {
  await tg(e, "answerCallbackQuery", { callback_query_id: q.id });
  const id = String(q.message.chat.id),
    mid = q.message.message_id,
    d = q.data;
  if (d.startsWith("fb:")) {
    const [, logId, rating] = d.split(":"),
      row=await e.DB.prepare("SELECT dedupe FROM notification_log WHERE id=? AND chat_id=?").bind(n(logId),id).first();
    if(row) await e.DB.prepare("INSERT INTO notification_feedback(chat_id,dedupe,rating) VALUES(?,?,?)").bind(id,row.dedupe,n(rating)).run();
    return send(e, id, "Дякую, відгук збережено.");
  }
  if (d.startsWith("recs:")) {
    const view = await recommendationCenter(e, d.slice(5));
    return edit(e, id, mid, view.text, view.keyboard);
  }
  if (d.startsWith("recdone:")) {
    const rid = n(d.slice(8)), row = await e.DB.prepare("SELECT recommendation_key FROM recommendations WHERE id=? AND status='active'").bind(rid).first();
    if (!row) return send(e, id, "Рекомендацію вже закрито.");
    await e.DB.batch([
      e.DB.prepare("UPDATE recommendations SET status='resolved',resolved_at=CURRENT_TIMESTAMP WHERE id=?").bind(rid),
      e.DB.prepare("UPDATE recommendation_lifecycle SET active=0,resolved_at=CURRENT_TIMESTAMP WHERE recommendation_key=?").bind(row.recommendation_key),
      e.DB.prepare("INSERT INTO recommendation_feedback(recommendation_key,chat_id,action) VALUES(?,?,'done')").bind(row.recommendation_key,id),
    ]);
    const view = await recommendationCenter(e, "active");
    return edit(e,id,mid,view.text,view.keyboard);
  }
  if (d.startsWith("recsnooze:")) {
    const [, ridText, duration] = d.split(":"), rid=n(ridText),
      row=await e.DB.prepare("SELECT recommendation_key FROM recommendations WHERE id=? AND status='active'").bind(rid).first();
    if (!row) return send(e,id,"Рекомендацію вже закрито.");
    const modifier = duration === "tomorrow" ? "+1 day" : `+${Math.min(1440,Math.max(1,n(duration,60)))} minutes`;
    await e.DB.batch([
      e.DB.prepare("UPDATE recommendation_lifecycle SET snooze_until=datetime('now',?) WHERE recommendation_key=?").bind(modifier,row.recommendation_key),
      e.DB.prepare("INSERT INTO recommendation_feedback(recommendation_key,chat_id,action) VALUES(?,?,?)").bind(row.recommendation_key,id,`snooze:${duration}`),
    ]);
    const view=await recommendationCenter(e,"active");
    return edit(e,id,mid,view.text,view.keyboard);
  }
  if (d.startsWith("recbad:")) {
    const rid=n(d.slice(7)), row=await e.DB.prepare("SELECT recommendation_key FROM recommendations WHERE id=?").bind(rid).first();
    if (row) await e.DB.prepare("INSERT INTO recommendation_feedback(recommendation_key,chat_id,action) VALUES(?,?,'not_useful')").bind(row.recommendation_key,id).run();
    return send(e,id,"👎 Відгук збережено. Дякую.");
  }
  if (d.startsWith("recdetail:")) {
    const row=await e.DB.prepare("SELECT r.*,l.metadata_json,l.fingerprint,l.first_seen_at,l.last_seen_at FROM recommendations r LEFT JOIN recommendation_lifecycle l ON l.recommendation_key=r.recommendation_key WHERE r.id=?").bind(n(d.slice(10))).first();
    if (!row) return send(e,id,"Рекомендацію не знайдено.");
    let metadata={}; try { metadata=JSON.parse(row.metadata_json||"{}"); } catch {}
    return send(e,id,`📋 ${row.title}\n${row.message}\nДія: ${row.action||"—"}\nПріоритет: ${row.priority}\nКлюч: ${row.recommendation_key}\nВперше: ${row.first_seen_at||row.created_at||"—"}\nОновлено: ${row.last_seen_at||"—"}\nДані: ${JSON.stringify(metadata).slice(0,1000)}`);
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
  const payload = d.slice("schedtime:".length);
  const separator = payload.indexOf(":");
  const cat = payload.slice(0, separator);
  const time = payload.slice(separator + 1);

  if (!/^\d{2}:\d{2}$/.test(time)) {
    return send(e, id, "⚠️ Некоректний формат часу.");
  }

  await e.DB.prepare(`
    UPDATE notification_settings
    SET schedule_time = ?, enabled = 1
    WHERE category_key = ?
  `)
    .bind(time, cat)
    .run();

  return send(e, id, `✅ ${CATS[cat]?.[1] || cat}: ${time}`);
}
  if (d.startsWith("quietset:")) {
  const parts = d.split(":");
  const start = `${parts[1]}:${parts[2]}`;
  const end = `${parts[3]}:${parts[4]}`;

  await e.DB.prepare(`
    UPDATE notification_channels
    SET quiet_enabled = 1,
        quiet_start = ?,
        quiet_end = ?
    WHERE enabled = 1
  `)
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
  if (d === "m:caretaker") {
    const c=await caretakerReport(e);
    return send(e,id,c.text,c.keyboard);
  }
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
    if (k === "night") return send(e, id, await sleepText(e), HOME);
    if (k === "recs") {
      const view=await recommendationCenter(e,"active");
      return send(e,id,view.text,view.keyboard);
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
      "weather_forecast",
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
