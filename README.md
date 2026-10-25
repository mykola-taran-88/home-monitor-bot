# Home Monitor Telegram Bot

Cloudflare Worker for the Home Monitor Telegram bot. The worker uses the shared D1 database and Workers AI binding configured in `wrangler.jsonc`.

## Local development

1. Install Node.js and npm.
2. Run `npm install` in this directory.
3. Copy `.dev.vars.example` to `.dev.vars` and enter the five secret values.
4. Run `npm run dev`.

The D1 database is configured in Wrangler. Local development uses Wrangler's local D1 unless remote bindings are explicitly enabled.

## Source layout

`src/index.js` is the Worker entry point. The rest of `src/` is split by responsibility:

- `constants.js` — categories, shared formatters, and keyboards
- `database.js` — D1 schema, queries, and home-score helpers
- `ai.js` — Workers AI prompts and chat history
- `reports.js` — energy, weather, analytics, and charts
- `notifications.js` — notification delivery, deduplication, and state changes
- `menus.js` — Telegram menu data and channel-management helpers
- `handlers/` — callback and message handlers
- `jobs/agent.js` — scheduled notification and maintenance work
- `telegram.js` — Telegram Bot API calls

## Deploy

1. Run `npx wrangler login` once to authorize the Cloudflare account.
2. Set each production secret from this directory:

   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   npx wrangler secret put WEBHOOK_SECRET
   npx wrangler secret put AGENT_SECRET
   npx wrangler secret put SETUP_SECRET
   ```

3. Deploy with `npm run deploy`.
4. Check `https://<worker-subdomain>.workers.dev/health` and confirm `db`, `ai`, and `token` are true.
5. Configure the Telegram webhook once using the setup secret:

   ```sh
   curl -X POST \
     -H "Authorization: Bearer <SETUP_SECRET>" \
     https://<worker-subdomain>.workers.dev/setup
   ```

   Then send `/start` to the bot.

Cron runs every five minutes. Scheduled reports use the `Europe/Kyiv` timezone in the bot code.

The bot and API use the same D1 database. Do not create a new database for the bot unless you also update the API to use it.
