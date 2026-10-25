// @ts-nocheck
// Home Monitor Bot v4.2.3 Ordered Weather.
import { MAIN } from "./constants.js";
import { schema } from "./database.js";
import { tg, send } from "./telegram.js";
import { callback } from "./handlers/callbacks.js";
import { message } from "./handlers/messages.js";
import { agent } from "./jobs/agent.js";

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
