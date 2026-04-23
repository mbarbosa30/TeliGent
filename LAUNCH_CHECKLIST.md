# TeliGent Production Launch Checklist

A checklist of operator-controlled settings to flip before going live. Many of these can stay on defaults for low-traffic launches; tighten them as load grows.

## 1. Required environment variables (production boot fails or degrades unsafely without these)

| Variable | Purpose | If missing in production |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for app data + sessions. | App fails to boot. |
| `SESSION_SECRET` | Cookie signing secret for express-session. Must be at least 32 chars and NOT equal to the dev fallback. | App refuses to boot (server/auth.ts). |
| `ADMIN_PASSPHRASE` | Guards `/admin` console and admin API routes. | `/api/admin/login` returns "admin not configured" and the admin console is unusable. |
| `OPENAI_API_KEY` (or Replit AI Integrations connection) | Powers all AI features. | Every AI call (scam check, AI replies, learning, digest, feedback) returns its safe fallback string; Telegram bots stay up but become non-AI. |
| `APP_URL` (or Replit's `REPLIT_DOMAINS`) | Used to construct Telegram webhook URLs. | Webhook activation falls back to localhost and Telegram cannot reach the bot. |

## 2. Optional environment variables (defaults shown, degradation behavior listed)

| Variable | Default | If missing |
|---|---|---|
| `MAX_BOTS_PER_USER` | `10` | Default cap applies. Tier-aware via `getLimitsForUser`. |
| `MAX_KB_ENTRIES_PER_BOT` | `500` | Default cap applies. |
| `MAX_GROUPS_PER_BOT` | `100` | Default cap applies. |
| `DAILY_AI_CALLS_PER_BOT` | `1000` | Default daily AI call budget per bot. When exhausted, AI paths return safe fallbacks and a `ai_budget_exhausted` activity log row is written once per bot per day. |
| `MAX_BOT_RESPONSE_CHARS` | `4000` | Default response truncation. |
| `REWARDS_SCHEDULER_MIN` | `15` | Scheduler tick interval (also flushes AI usage to Postgres). |
| `CELO_WALLET_PRIVATE_KEY` | unset | ERC-8004 bot registration and ERC-20 reward payouts on Celo / Base are disabled (endpoints respond with a clear "wallet not configured" error). |
| `BASE_WALLET_PRIVATE_KEY` | unset | Falls back to `CELO_WALLET_PRIVATE_KEY` for Base ERC-20 payouts. If both are missing, Base payouts are disabled. |
| `BANKR_API_KEY` | unset | `/price` command and crypto enrichment in AI replies fall back to "Bankr not configured". |
| `LOCUS_API_KEY` | unset | Agent-to-agent paid services skip Locus payment checks; Master Agent wallet panel reports "not configured". |
| `OPENSERV_API_KEY` | unset | OpenServ marketplace endpoints respond with "not configured"; the rest of the app keeps working. |
| `SYNTHESIS_API_KEY` | unset | Any Synthesis-backed feature degrades to its non-AI fallback. |
| `TELEGRAM_BOT_TOKEN` | unset | The platform-wide demo bot is not started; per-bot tokens stored in `bot_configs` are unaffected. |

## 3. Per-bot owner setup

Done from Settings inside the app:

- Bot Token + webhook activation.
- Personality, global context, knowledge base seed entries.
- Scam Detection sensitivity (low / medium / high).
- Widget: enable, then add allowed origins (one origin per line) under Widget > Allowed Origins. Empty list = open access; treat that as a quick-test option, not a launch state.
- Rewards & Engagement: only flip on after configuring chain, token contract, top N, and amount per winner.
- Community Feedback Loop: enable themes you actually want to act on.
- ERC-8004 Bot Registration on Celo: optional; needs `CELO_WALLET_PRIVATE_KEY` and on-chain gas.

## 4. Deployment configuration (Replit Deployments)

- Set machine to Reserved VM if you need always-on Telegram webhooks.
- Confirm the deployment URL matches the Telegram webhook URL after first deploy.
- Make sure all required secrets (Section 1) are set in the deployment, not just dev.

## 5. Operational checks

- `/admin` reachable; admin login works against `ADMIN_PASSPHRASE`.
- Master Agent dashboard at `/agent` shows wallet status if `LOCUS_API_KEY` is set.
- Trigger a `/leaderboard` and `/myscore` in a connected Telegram group.
- Send a small test message to a widget-enabled site from a non-allowed origin — expect a 403.
- Check the daily AI budget by hitting a bot many times; once exhausted you should see the budget skip log line.
- Run the rewards scheduler manually via Settings > Rewards & Engagement > "Run rewards now" before relying on the timer.

## 6. Backups & data

- Schedule managed Postgres backups via your hosting provider.
- Keep at least one verified restore drill in your runbook before going wide.
