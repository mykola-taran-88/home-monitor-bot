import { MAIN } from "../constants.js";
import { ask } from "../ai.js";
import { wizard } from "../menus.js";
import { send } from "../telegram.js";

export async function message(e, m) {
  const id = String(m.chat.id),
    t = m.text || "";
  if (await wizard(e, id, t)) return;
  if (t === "/start" || t === "/menu" || t === "🏠 Меню")
    return send(e, id, "🏠 HOME MONITOR\nОберіть розділ:", MAIN);
  if (t === "/clear") {
    await e.DB.prepare("DELETE FROM ai_chat_history WHERE chat_id=?")
      .bind(id)
      .run();
    return send(e, id, "🧹 AI-контекст очищено", MAIN);
  }
  return send(e, id, await ask(e, id, t), MAIN);
}
