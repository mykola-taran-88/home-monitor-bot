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

## v5 migration, verification, and rollback

The v5 bot code depends on tables created by `../home-monitor-api/migrations/0001_home_monitor_v5.sql`. Back up the shared D1 database before applying it. The migration adds scheduler state, recommendation lifecycle and feedback, buffered events, climate anomaly state, caretaker runs, and nightly sleep scores. It also retires the `rain_window`, `home_score`, and `ventilation` notification overrides/settings as specified by v5. On an empty D1 it bootstraps settings and notification configuration; the existing API continues to own its telemetry/core tables.

Run the migration against a local/preview D1 first:

```sh
npx wrangler d1 migrations apply DB --local --directory ../home-monitor-api/migrations
npm test
npx wrangler deploy --dry-run
```

After reviewing the preview and backup, the production sequence is to apply that migration once with `--remote` from `home-monitor-api`, deploy the API Worker, then deploy this bot Worker. This repository's deploy workflow does not apply D1 migrations automatically. Do not deploy v5 bot code against a database missing migration version 1.

Rollback: deploy the previous API and bot Worker versions from Cloudflare. The migration is additive apart from the explicitly retired category rows; restore those rows from the D1 backup if the older Worker needs them. The new tables can remain in place for a code rollback. Do not drop them during rollback.

## v5 operational behavior

- Offline/online device changes are grouped for five minutes and sent on the `device_health` category; unchanged offline state does not emit a new message every cron run.
- Notification quiet-hours queue items are due at the channel's configured quiet end. Event and scheduled-job outcomes can be inspected in Telegram → Diagnostics.
- Recommendation lifecycle, Sleep Score, and caretaker reports require the shared D1 migration. The Home Score and Sleep Score remain on-demand/menu or digest content, not independent push categories.
- Configure the v5 defaults in the API admin settings page. Current defaults are in the migration SQL; no new Worker secrets are introduced.
