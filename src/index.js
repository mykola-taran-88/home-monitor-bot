// @ts-nocheck
// Home Monitor Bot v4.2.3 Ordered Weather.
import { MAIN } from "./constants.js";
import { schema } from "./database.js";
import { tg, send } from "./telegram.js";
import { callback } from "./handlers/callbacks.js";
import { message } from "./handlers/messages.js";
import { agent } from "./jobs/agent.js";
import { ask } from "./ai.js";

async function dashboardChat(req, env, url) {
  const expected = env.DASHBOARD_AI_INTERNAL_SECRET;
  if (!expected || req.headers.get("X-Dashboard-AI-Secret") !== expected)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ip = req.headers.get("X-Home-Monitor-Client-IP") || "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ip),
  );
  const ipHash = [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
  const chatId = `web:${ipHash.slice(0, 24)}:${url.searchParams.get("conversation") || ""}`;
  if (!/^web:[a-f0-9]{24}:[a-f0-9-]{36}$/.test(chatId))
    return Response.json(
      { error: "Некоректний ідентифікатор чату." },
      { status: 400 },
    );

  if (url.pathname === "/internal/web-chat/clear" && req.method === "POST") {
    await env.DB.prepare("DELETE FROM ai_chat_history WHERE chat_id=?")
      .bind(chatId)
      .run();
    return Response.json({ success: true });
  }
  if (url.pathname !== "/internal/web-chat" || req.method !== "POST")
    return Response.json({ error: "Not Found" }, { status: 404 });

  const input = await req.json().catch(() => ({}));
  const question = String(input.message || "").trim();
  if (!question || question.length > 1200)
    return Response.json(
      { error: "Повідомлення має містити до 1200 символів." },
      { status: 400 },
    );

  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS dashboard_ai_limits(ip_hash TEXT PRIMARY KEY,minute_bucket INTEGER NOT NULL,minute_count INTEGER NOT NULL,day_bucket TEXT NOT NULL,day_count INTEGER NOT NULL)",
  ).run();
  const minuteBucket = Math.floor(Date.now() / 60000);
  const dayBucket = new Date().toISOString().slice(0, 10);
  const limit = await env.DB.prepare(
    "INSERT INTO dashboard_ai_limits(ip_hash,minute_bucket,minute_count,day_bucket,day_count) VALUES(?,?,1,?,1) ON CONFLICT(ip_hash) DO UPDATE SET minute_count=CASE WHEN minute_bucket=excluded.minute_bucket THEN minute_count+1 ELSE 1 END,minute_bucket=excluded.minute_bucket,day_count=CASE WHEN day_bucket=excluded.day_bucket THEN day_count+1 ELSE 1 END,day_bucket=excluded.day_bucket RETURNING minute_count,day_count",
  )
    .bind(ipHash, minuteBucket, dayBucket)
    .first();
  if (Number(limit?.minute_count) > 24 || Number(limit?.day_count) > 200)
    return Response.json(
      { error: "Забагато запитів. Спробуйте трохи пізніше." },
      { status: 429 },
    );

  try {
    const answer = await ask(env, chatId, question);
    return Response.json({ answer });
  } catch (error) {
    const message = String(error?.message || error);
    console.error("DASHBOARD_AI", message);
    if (/4006|daily free allocation|neurons/i.test(message))
      return Response.json(
        {
          error:
            "Вичерпано денний безкоштовний ресурс Cloudflare Workers AI. AI-відповіді відновляться після оновлення квоти; для безперервної роботи потрібен платний план Workers AI.",
        },
        { status: 503 },
      );
    return Response.json(
      { error: "AI-помічник тимчасово недоступний. Спробуйте ще раз пізніше." },
      { status: 503 },
    );
  }
}

export default {
  async fetch(req, e) {
    await schema(e);
    const u = new URL(req.url);
    if (u.pathname.startsWith("/internal/web-chat"))
      return dashboardChat(req, e, u);
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
