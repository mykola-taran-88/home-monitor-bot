import { now } from "./database.js";
import { n } from "./constants.js";
import { send } from "./telegram.js";
import { sendChartPack } from "./reports.js";
import { quietEndUtc as getQuietEndUtc } from "./v5/scheduler.js";

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
  const setting=await e.DB.prepare("SELECT enabled FROM notification_settings WHERE category_key=?").bind(cat).first();
  if (!setting?.enabled) return;
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

export async function flushEventBuffer(e) {
  const rows=(await e.DB.prepare("SELECT * FROM event_buffer WHERE status='pending' AND flush_after<=CURRENT_TIMESTAMP ORDER BY first_seen_at LIMIT 20").all()).results;
  for (const row of rows) {
    const claim=await e.DB.prepare("UPDATE event_buffer SET status='processing',attempt_count=attempt_count+1 WHERE id=? AND status='pending'").bind(row.id).run();
    if (!(claim.meta?.changes>0)) continue;
    try {
      const payload=JSON.parse(row.payload_json||"{}"), items=payload.items||[], active=payload.active!==false,
        heading=active?"📡 Датчики offline":"✅ Відновлення датчиків",
        body=items.map(x=>`• ${x.message||x.name}`).join("\n"),
        key=`event-buffer:${row.id}`;
      const accepted=await push(e,row.category_key,key,`${heading}\n${body}`,false,false);
      if(!accepted) throw new Error("No eligible notification channel accepted the event");
      await e.DB.prepare("UPDATE event_buffer SET status='sent',delivered_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=?").bind(row.id).run();
    } catch(err) {
      await e.DB.prepare("UPDATE event_buffer SET status='pending',flush_after=datetime('now','+5 minutes'),last_error=? WHERE id=?").bind(String(err?.message||err).slice(0,500),row.id).run();
      console.error("EVENT_BUFFER",JSON.stringify({id:row.id,error:String(err?.message||err).slice(0,250)}));
    }
  }
}

export function quiet(ch, p) {
  if (!ch.quiet_enabled) return false;
  return ch.quiet_start < ch.quiet_end
    ? p.time >= ch.quiet_start && p.time < ch.quiet_end
    : p.time >= ch.quiet_start || p.time < ch.quiet_end;
}
function quietEndUtc(ch, p) {
  return getQuietEndUtc(ch,p,"Europe/Kyiv");
}
export async function push(
  e,
  cat,
  key,
  msg,
  critical = false,
  bypassCooldown = false,
  replyMarkup = null,
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
  let accepted = false;
  for (const c of cs) {
    const repeatable = false,
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
      keyCooldown =
        cat === "recommendations" && key === "bill"
          ? Math.max(1440, cooldown)
          : cooldown,
      recent = await e.DB.prepare(
      "SELECT 1 ok FROM notification_log WHERE chat_id=? AND category_key=? AND sent_at>=datetime(\'now\',?) LIMIT 1",
    )
      .bind(c.chat_id, cat, `-${cooldown} minutes`)
      .first();
    const recentKey =
      cat === "recommendations" && key === "bill"
        ? await e.DB.prepare(
            "SELECT 1 ok FROM notification_log WHERE chat_id=? AND dedupe=? AND sent_at>=datetime('now',?) LIMIT 1",
          )
            .bind(c.chat_id, dedupe, `-${keyCooldown} minutes`)
            .first()
        : null;
    if ((recent || recentKey) && !critical && !bypassCooldown) continue;
    if (!critical && quiet(c, p)) {
      await e.DB.prepare(
        "INSERT INTO notification_queue(chat_id,category_key,message,dedupe,status,deliver_after) VALUES(?,?,?,?,'pending',?) ON CONFLICT(chat_id,category_key,dedupe) WHERE status='pending' DO UPDATE SET message=excluded.message,deliver_after=excluded.deliver_after",
      )
        .bind(c.chat_id, cat, msg, dedupe, quietEndUtc(c, p))
        .run();
      accepted = true;
      continue;
    }
    try {
      await e.DB.prepare(
        "INSERT INTO notification_log(dedupe,chat_id,category_key,message) VALUES(?,?,?,?) ON CONFLICT(dedupe,chat_id) DO UPDATE SET category_key=excluded.category_key,message=excluded.message,sent_at=CURRENT_TIMESTAMP",
      ).bind(dedupe, c.chat_id, cat, msg).run();
      const log = await e.DB.prepare("SELECT id FROM notification_log WHERE dedupe=? AND chat_id=?").bind(dedupe,c.chat_id).first();
      await send(e, c.chat_id, msg, replyMarkup || {
        inline_keyboard: [
          [
            { text: "👍", callback_data: `fb:${log?.id}:1` },
            { text: "👎", callback_data: `fb:${log?.id}:-1` },
          ],
        ],
      });
      accepted = true;
    } catch (err) {
      await e.DB.prepare("DELETE FROM notification_log WHERE dedupe=? AND chat_id=?").bind(dedupe,c.chat_id).run();
      console.error("PUSH", cat, err?.message || err);
    }
  }
  return accepted;
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
  if (cat === "device_health" && (active || prev === "active")) {
    const groupKey=`${cat}:${active?"offline":"recovered"}`,
      item={message:active?onMessage:offMessage,source_id:stateKey},
      windowMin=Math.min(60,Math.max(1,n((await e.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='event_group_window_min'").first())?.setting_value,5))),
      oldGroup=await e.DB.prepare("SELECT id,payload_json,source_ids_json FROM event_buffer WHERE group_key=? AND status='pending'").bind(groupKey).first();
    if (oldGroup) {
      const payload=JSON.parse(oldGroup.payload_json||"{}"), ids=JSON.parse(oldGroup.source_ids_json||"[]");
      if (!ids.includes(stateKey)) { payload.items=[...(payload.items||[]),item]; ids.push(stateKey); }
      await e.DB.prepare("UPDATE event_buffer SET payload_json=?,source_ids_json=?,last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify({...payload,active}),JSON.stringify(ids),oldGroup.id).run();
    } else {
      await e.DB.prepare("INSERT INTO event_buffer(group_key,category_key,payload_json,source_ids_json,flush_after) VALUES(?,?,?,?,datetime('now',?))").bind(groupKey,cat,JSON.stringify({active,items:[item]}),JSON.stringify([stateKey]),`+${windowMin} minutes`).run();
    }
  } else if (active)
    await push(
      e,
      cat,
      `${stateKey}:on`,
      onMessage,
      critical,
      false,
    );
  else if (prev === "active" && offMessage)
    await push(
      e,
      cat,
      `${stateKey}:off`,
      offMessage,
      false,
      false,
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
    e.DB.prepare("UPDATE event_buffer SET status='expired' WHERE status='pending' AND first_seen_at<datetime('now','-1 day')"),
    e.DB.prepare("DELETE FROM event_buffer WHERE status IN ('sent','cancelled','expired') AND first_seen_at<datetime('now','-30 days')"),
    e.DB.prepare(
      "DELETE FROM alert_actions WHERE created_at<datetime(\'now\',\'-30 days\')",
    ),
    e.DB.prepare(
      "INSERT INTO agent_state(state_key,state_value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP",
    ).bind(k, p.date),
  ]);
}
