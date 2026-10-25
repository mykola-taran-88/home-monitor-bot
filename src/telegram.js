export async function tg(e, m, p = {}) {
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

export const send = (e, id, t, k) =>
  tg(e, "sendMessage", {
    chat_id: id,
    text: String(t).slice(0, 4000),
    reply_markup: k,
    disable_web_page_preview: true,
  });

export async function edit(e, id, mid, t, k) {
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
