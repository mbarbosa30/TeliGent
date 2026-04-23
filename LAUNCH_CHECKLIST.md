# TeliGent Production Launch Checklist

A checklist of operator-controlled settings to flip before going live. Many of these can stay on defaults for low-traffic launches; tighten them as load grows.

## 1. Required environment variables

- `DATABASE_URL` — PostgreSQL connection string.
- `SESSION_SECRET` — strong random value, at least 32 chars, must NOT equal the dev fallback. The server refuses to boot in production if this is missing or weak.
- `ADMIN_PASSPHRASE` — strong passphrase guarding the in-app `/admin` console.
- `OPENAI_API_KEY` (or Replit AI Integrations connection) — required for any AI feature.

## 2. Optional environment variables (defaults shown)

- `MAX_BOTS_PER_USER=10` — hard cap on bots per account. Tier-aware via `getLimitsForUser`.
- `MAX_KB_ENTRIES_PER_BOT=500` — knowledge base soft cap per bot.
- `MAX_GROUPS_PER_BOT=100` — Telegram groups per bot.
- `DAILY_AI_CALLS_PER_BOT=1000` — per-bot daily AI call budget. Enforced by `tryConsumeAiBudget` in scam detection, real-time learning, command triage, AI replies, proactive prompts, and feedback classification. Persisted via the `ai_usage_daily` table.
- `MAX_BOT_RESPONSE_CHARS=4000` — response truncation cap.
- `REWARDS_SCHEDULER_MIN=15` — scheduler tick interval. Also flushes AI usage to the database.
- `CELO_WALLET_PRIVATE_KEY` — wallet for ERC-8004 registrations and ERC-20 reward payouts on Celo (also used as fallback on Base).
- `BASE_WALLET_PRIVATE_KEY` — optional Base-specific wallet; if unset the Celo key is reused.
- `BANKR_API_KEY`, `LOCUS_API_KEY`, `OPENSERV_API_KEY`, `SYNTHESIS_API_KEY`, `TELEGRAM_BOT_TOKEN` — service integrations as needed.

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
