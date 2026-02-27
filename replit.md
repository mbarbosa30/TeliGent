# TeliGent - Intelligent Telegram Bot Manager (SaaS)
## Domain: teli.gent

## Overview
A multi-tenant SaaS platform (branded as **TeliGent**, domain **teli.gent**) where users sign up with email/password, connect their own Telegram bot tokens, and configure AI-powered group bots. Each user can manage multiple bots, with each bot having isolated data (configs, knowledge base, groups, activity logs). Supports per-user multi-bot instances running concurrently.

## Recent Changes
- 2026-02-25: **Report-based learning** — `/report` now teaches the bot. When a reported message is confirmed as scam, key phrase bigrams are extracted and stored in `reportedScamPatterns` table. Future messages matching 3+ learned bigrams from any report are auto-flagged. Per-bot isolation, 5-minute cache, deduplication.
- 2026-02-25: **Scam detection: fake project shutdown + token relaunch** — New patterns catch "1:1 of relaunched tokens" scam template, fake project shutdowns with token swap promises, and homoglyph I→l evasion in "reIaunched"/"heId". Fixed `relaunch(ed|ing)?` regex to match past tense. Patterns run on raw text to avoid normalization destroying "1:1".
- 2026-02-27: **Critical fix: multiplier claims (100x) destroyed by normalizer** — `fixHomoglyphWords` was converting digits (1→l, 0→o), turning `100x` into `loox`. Multiplier regex now runs on raw text instead of normalized text. Fixes all `Nx` detection.
- 2026-02-27: **Scam detection: low mc gem shill** — New `hasLowMcGemShill` pattern catches "low mc" + "gems" + "launched" combo as standalone shill (no multiplier needed). Also expanded pump hype: "new gems", "found gems", "next play/gem", "get ready" standalone, "low mc".
- 2026-02-27: **FOMO urgency fixes** — Added consecutive 🔥🔥, "don't miss", "make sure...miss", "in private...100x". Removed "don't miss" from pump hype (was causing false positives on "don't miss the community call"). Fixed "coming now" urgency.
- 2026-02-27: **Forwarded message handling** — Forwarded messages now go through the same scam detection pipeline. Bot also processes `msg.caption` (media captions) for scam checking.
- 2026-02-25: **Scam detection: OTC/investment service pitch** — New `hasInvestmentServicePitch` pattern catches unsolicited OTC/investment service offers ("I help teams access OTC capital", "we unlock $250K–$10M in institutional capital", "are you open for X OTC Investment?", "strategic investors/buyers"). Hard-flagged and included in AI fallback.
- 2026-02-25: **Scam detection: expanded pump hype & FOMO** — Added "fill your/ur bags", "lfg" (and variants), "aped this/it", "something huge/big/massive is coming", "get ready folks/guys" to pump hype language. Added "before the train leaves", consecutive 🚀🚀, "train leaving" to FOMO urgency. Still requires 2+ signal types to avoid false positives.
- 2026-02-25: **Scam detection: polished cold-pitch service offers** — Expanded `hasUnsolicitedServiceOffer` to catch "I specialize in community engagement/moderation/FUD control", "I'd love to support your community", "alongside your bot", "turn passive members into active participants", "maximize engagement." These soft-language community management pitches now trigger deterministic detection.
- 2026-02-25: **Landing page live metrics** — Public stats section between hero and features on landing page. Shows animated count-up of scams blocked, AI conversations, groups protected, and active bots. Fetched from `/api/public/stats` (no auth, 5-min cache). Auto-hides when all stats are zero.
- 2026-02-25: **Auto-ban feature** — Configurable auto-ban threshold per bot (Settings page). After N auto-deleted scam messages from the same Telegram user, the bot bans them from the group. Telegram user IDs now tracked in activity logs for reliable repeat-offender counting. Default: 0 (disabled).
- 2026-02-25: **Scam detection: financial shill/pump hype** — New `hasFinancialShillHype` pattern catches pump hype spam (multiplier claims like 50-100x + hype language like "low-cap gems", "whales rotating", "don't sleep" + FOMO urgency emojis/phrases). Requires 2+ signal types to avoid false positives on normal crypto discussion. Updated AI prompt with pump hype examples.
- 2026-02-23: **Scam detection: major expansion** — Channel management cold-pitch now handles spelled-out numbers ("four communities") and no-number variants ("whale communities"). Fake exchange listing impersonation (Binance, Biconomy, OKX, etc. + "listing cooperation"). Soft collaboration invites ("let me know if you're open to collaborating", "who should I contact"). AI fallback: when AI returns unparseable/error + strong scam signals present, flags as scam instead of silently passing.
- 2026-02-23: **Scam detection: channel management cold-pitch** — New pattern detects "I manage X channels/communities" paired with marketing buzzwords (engagement, volume, MC, growth). Expanded DM solicitation to catch "DM to discuss/collaborate". Hashtag stripping in normalizer (#Telegram→Telegram). New `hasChannelManagementPitch` detection rule.
- 2026-02-23: **Admin dashboard (standalone)** — Separate admin page at /admin with passphrase-based access (ADMIN_PASSPHRASE env secret). Not tied to user accounts. Shows all users, bots, activity, and scam stats across the platform. Bot tokens masked in admin view.
- 2026-02-23: **Scam detection: punctuation insertion evasion** — Normalizer now strips dots/commas between letters (D.m→DM, air.drop→airdrop). Added V2/V3 token relaunch scam, DM-with-proof phishing, and Telegram invite link spam patterns.
- 2026-02-22: **Rebranded to TeliGent** — Platform renamed from ContextBot to TeliGent (teli.gent domain), updated all UI, meta tags, user-agent strings, and internal references
- 2026-02-22: **Multi-bot architecture** — Users can create/manage multiple bots per account. Bot switcher in sidebar, all data bot-scoped via botConfigId FK. Delete bot with confirmation dialog.
- 2026-02-22: **Design overhaul — refined minimal aesthetic** — Space Grotesk + JetBrains Mono fonts, zero border-radius, no shadows, monochrome palette, sharp edges, font-mono on stats/timestamps/badges only
- 2026-02-22: **Replaced Replit Auth with email/password auth** — bcrypt password hashing, session-based auth, register/login forms
- 2026-02-22: **Scam detection massively improved** — homoglyph normalization (I/l, 0/O, Cyrillic), unsolicited service offer detection, migration/airdrop scam patterns, name impersonation detection, strengthened AI prompt
- 2026-02-22: Multi-tenant SaaS conversion — per-user data isolation, multi-bot engine, landing page, bot token onboarding
- 2026-02-20: Proactive scam detection, per-user cooldowns, slash commands, token-safe context truncation
- 2026-02-20: Initial MVP built with dashboard, knowledge base, activity log, reports, and settings pages

## Architecture
- **Frontend**: React + TypeScript with Vite, Shadcn UI, TanStack Query, Wouter routing
- **Backend**: Express.js with Drizzle ORM on PostgreSQL
- **Auth**: Email/password with bcrypt, express-session with PostgreSQL session store (connect-pg-simple)
- **Telegram Bot**: Multi-instance bot engine — one TelegramBot per bot config, webhook mode in production
- **AI**: OpenAI via Replit AI Integrations (gpt-5-mini)
- **Bot Context**: React context (BotProvider) manages selected bot state, persisted in localStorage

## Key Files
- `shared/schema.ts` - Database schema with botConfigId on all data tables, exports auth models
- `shared/models/auth.ts` - Users (with passwordHash) and sessions tables
- `server/auth.ts` - Email/password auth: register, login, logout, session middleware
- `server/index.ts` - Express app with auth setup before routes
- `server/routes.ts` - Auth-protected API endpoints with bot-scoped routing (/api/bots/:botId/*)
- `server/storage.ts` - Database operations scoped by botConfigId
- `server/telegram.ts` - Multi-bot engine with advanced scam detection (homoglyphs, impersonation, AI)
- `client/src/App.tsx` - Auth-gated app with BotProvider wrapping authenticated content
- `client/src/hooks/use-bot.tsx` - Bot context: selected bot state, bot switcher logic
- `client/src/pages/landing.tsx` - Public landing page with login/register forms
- `client/src/pages/` - Dashboard, Knowledge, Activity, Reports, Settings, SetupGuide pages
- `client/src/hooks/use-auth.ts` - Auth hook with login/register/logout mutations
- `client/src/components/app-sidebar.tsx` - Sidebar with bot switcher dropdown, nav, user profile

## Multi-Bot Design
- Each user can create multiple bots via sidebar dropdown
- All data tables (knowledgeBase, groups, activityLogs) have botConfigId foreign key
- Storage methods are bot-scoped: `storage.getGroups(botConfigId)`, `storage.getActivityLogs(botConfigId)`, etc.
- Bot engine starts/stops individual bots based on active configs with tokens
- requireBotOwnership middleware validates bot belongs to authenticated user
- Webhooks use hashed tokens for unique per-bot paths
- BotProvider context manages selected bot, auto-selects first bot, handles stale IDs

## API Endpoints (all require auth)
- `GET/POST /api/bots` - List/create bot configs
- `DELETE /api/bots/:botId` - Delete bot and all associated data
- `GET/PATCH /api/bots/:botId/config` - Bot configuration (includes botToken, globalContext, websiteUrl)
- `GET/POST/PATCH/DELETE /api/bots/:botId/knowledge` - Knowledge base CRUD
- `POST /api/bots/:botId/scrape-website` - Fetch and extract text from a website URL
- `GET /api/bots/:botId/groups` - Connected Telegram groups
- `GET /api/bots/:botId/activity` - Activity logs
- Auth routes: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/user`, `POST /api/auth/logout`

## Scam Detection
- **Homoglyph normalization**: Cyrillic, zero-width chars, fancy Unicode, Latin look-alikes (I/l, 0/O)
- **Deterministic regex**: Migration/airdrop scams, DM solicitation, unsolicited service offers, crypto service pitches, flattery+pitch combos, pump/shill/raid spam, wallet buying, insider calls
- **Name impersonation**: Flags non-admins whose display name matches bot/group name
- **AI fallback**: GPT-5-mini for messages that pass regex checks, with aggressive scam-biased prompt

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection
- `SESSION_SECRET` - Session encryption key
- `AI_INTEGRATIONS_OPENAI_API_KEY` - Auto-set by Replit
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - Auto-set by Replit
- `REPLIT_DOMAINS` - Auto-set in production, used for webhook URL

## Running
- `npm run dev` starts both frontend (Vite) and backend (Express) on port 5000
- `npm run db:push` syncs database schema
