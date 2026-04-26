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
| `HELIXA_BASE_WALLET_PRIVATE_KEY` | unset | Per-bot Helixa minting on Base is disabled. `POST /api/bots/:botId/helixa/register` returns 503 "Helixa minting is not configured" and the Settings card shows the wallet as "Not configured". Use a dedicated key (separate from `CELO_*` / `BASE_*`) — this wallet pays the $1 USDC mint fee on every bot mint and signs the SIWA bearer used against api.helixa.xyz. Fund with at least 1 USDC per planned mint plus a small ETH balance for gas; the boot log warns at <5 USDC and refuses new mints at <1 USDC. |
| `BANKR_API_KEY` | unset | `/price` command and crypto enrichment in AI replies fall back to "Bankr not configured". |
| `LOCUS_API_KEY` | unset | Agent-to-agent paid services skip Locus payment checks; Master Agent wallet panel reports "not configured". |
| `OPENSERV_API_KEY` | unset | OpenServ marketplace endpoints respond with "not configured"; the rest of the app keeps working. |
| `SYNTHESIS_API_KEY` | unset | Any Synthesis-backed feature degrades to its non-AI fallback. |
| `TELEGRAM_BOT_TOKEN` | unset | The platform-wide demo bot is not started; per-bot tokens stored in `bot_configs` are unaffected. |
| `STRIPE_SECRET_KEY` | unset | Card checkout disabled; `/api/billing/checkout` returns 503 and the Pay-with-card button is hidden. Crypto rail keeps working. |
| `STRIPE_PUBLISHABLE_KEY` | unset | Surfaced via `/api/me/limits`; not strictly required server-side but useful for future client-side embeds. |
| `STRIPE_WEBHOOK_SECRET` | unset | `/api/billing/webhook` rejects any incoming event (signature check fails). Plan activation will not happen via Stripe until set. |
| `STRIPE_PRO_PRICE_ID_MONTHLY` / `..._ANNUAL` / `STRIPE_BUSINESS_PRICE_ID_MONTHLY` / `..._ANNUAL` | unset | Checkout returns 400 ("Missing price for plan"). Required to map a Stripe price back to our plan tiers. |
| `BASE_RPC_URL` | `https://mainnet.base.org` | Used by the crypto poller. Override if you have a private RPC for higher throughput. |
| `PLATFORM_RECEIVE_ADDRESS` | derived from `BASE_WALLET_PRIVATE_KEY` (or `CELO_WALLET_PRIVATE_KEY`) | If neither a private key nor an explicit address is set, `/api/billing/crypto/intent` returns 503 and crypto rail is disabled. |
| `USD_PER_TELI` | `0.10` | Fallback price used to convert plan USD into $TELI when `platform_settings.usd_per_teli` is unset. Operators can override at runtime via Admin > Plans. |

## 3. Per-bot owner setup

Done from Settings inside the app:

- Bot Token + webhook activation.
- Personality, global context, knowledge base seed entries.
- Scam Detection sensitivity (low / medium / high).
- Widget: enable, then add allowed origins (one origin per line) under Widget > Allowed Origins. Empty list = open access; treat that as a quick-test option, not a launch state.
- Rewards & Engagement: only flip on after configuring chain, token contract, top N, and amount per winner.
- Community Feedback Loop: enable themes you actually want to act on.
- ERC-8004 Bot Registration on Celo: optional; needs `CELO_WALLET_PRIVATE_KEY` and on-chain gas.

## 3b. Stripe setup (cards / Apple Pay)

Required only if you want to accept card payments. The crypto rail (USDC + $TELI on Base) works independently.

1. In the Stripe dashboard, create two recurring products: **TeliGent Pro** and **TeliGent Business**, each with a monthly and an annual price. Note the four `price_...` IDs.
2. Set the four `STRIPE_*_PRICE_ID_*` secrets to those price IDs, plus `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`.
3. In Stripe → Developers → Webhooks, add an endpoint pointing to `https://<your-domain>/api/billing/webhook`. Subscribe to: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Enable Apple Pay in Stripe → Payment methods (no extra code change needed — Stripe Checkout shows it automatically when the buyer's device supports it).
5. Test the end-to-end flow with a Stripe test card from a logged-in account on `/billing`. After webhook delivery, the user's plan should show as Pro/Business in the sidebar and `/api/me/limits`.

## 3c. Crypto rail setup (USDC + $TELI on Base)

1. Set `PLATFORM_RECEIVE_ADDRESS` (or `BASE_WALLET_PRIVATE_KEY` to derive it). All plan payments are settled to this single address.
2. Optional: set `BASE_RPC_URL` to a private Base RPC for higher rate limits.
3. From Admin > Plans, set the current USD-per-$TELI price. The poller runs once per scheduler tick (default 15 min) and matches incoming Transfer events by exact amount (per-intent unique-suffix wei).

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
