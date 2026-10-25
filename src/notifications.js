import { now } from "./database.js";
import { n } from "./constants.js";
import { send } from "./telegram.js";
import { sendChartPack } from "./reports.js";

export async function categoryChannels(e, cat) {
  return (
    await e.DB.prepare(
      "SELECT c.* FROM notification_channels c LEFT JOIN notification_channel_categories x ON x.chat_id=c.chat_id AND x.category_key=? WHERE c.enabled=1 AND COALESCE(x.enabled,1)=1",
    )
      .bind(cat)
      .all()
  ).results;
}
export async function pushChartPack(e, cat, key, days) {
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

export function quiet(ch, p) {
  if (!ch.quiet_enabled) return false;
  return ch.quiet_start < ch.quiet_end
    ? p.time >= ch.quiet_start && p.time < ch.quiet_end
    : p.time >= ch.quiet_start || p.time < ch.quiet_end;
}
export async function push(
  e,
  cat,
  key,
  msg,
  critical = false,
  bypassCooldown = false,
) {
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
    const configuredCooldown = n(s.cooldown, 60) || 60,
      cooldown =
        cat === "recommendations"
          ? Math.max(720, configuredCooldown)
          : configuredCooldown,
      recent = await e.DB.prepare(
      "SELECT 1 ok FROM notification_log WHERE chat_id=? AND category_key=? AND sent_at>=datetime(\'now\',?) LIMIT 1",
    )
      .bind(c.chat_id, cat, `-${cooldown} minutes`)
      .first();
    if (recent && !critical && !bypassCooldown) continue;
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
export async function stateEvent(
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
    await push(
      e,
      cat,
      `${stateKey}:on:${Date.now()}`,
      onMessage,
      critical,
      cat === "device_health",
    );
  else if (prev === "active" && offMessage)
    await push(
      e,
      cat,
      `${stateKey}:off:${Date.now()}`,
      offMessage,
      false,
      cat === "device_health",
    );
  return true;
}
export async function maintenance(e, p) {
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
