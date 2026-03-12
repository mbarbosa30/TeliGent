# TeliGent - Intelligent Telegram Bot Manager (SaaS)

## Overview
TeliGent is a multi-tenant SaaS platform (teli.gent) for managing AI-powered Telegram group bots. Users can sign up, connect their Telegram bot tokens, and configure advanced AI capabilities. The platform supports managing multiple bots per user, with each bot operating with isolated configurations, knowledge bases, group data, and activity logs. It is designed to proactively detect and counter various types of scams, including financial shills, phishing, and impersonation, using a combination of deterministic rules and AI. The project aims to provide a robust, scalable, and secure solution for community management and scam prevention within Telegram.

## User Preferences
I prefer simple language and detailed explanations. I want iterative development and to be asked before major changes are made. Do not make changes to files in the `shared/` folder unless explicitly requested or if it's a critical bug fix affecting core functionality across both client and server.

## System Architecture
**Frontend**: Developed with React and TypeScript, utilizing Vite for building, Shadcn UI for components, TanStack Query for data fetching, and Wouter for routing. The UI features a refined minimal aesthetic with Space Grotesk + JetBrains Mono fonts, zero border-radius, no shadows, and a monochrome palette.
**Backend**: Built on Express.js, using Drizzle ORM for PostgreSQL database interactions.
**Authentication**: Custom email/password authentication system with bcrypt for password hashing and express-session for session management, stored in PostgreSQL.
**Telegram Bot Engine**: A modular multi-instance architecture (`server/telegram/`) where each user's bot configuration runs as an isolated TelegramBot instance, primarily operating in webhook mode for production. Split into focused modules: `index.ts` (engine/webhooks), `scam-detection.ts` (deterministic + AI scam checks), `normalization.ts` (homoglyph/unicode normalization), `commands.ts` (bot commands/AI response), `types.ts` (shared interfaces), `utils.ts` (OpenAI client, sendBotMessage).
**AI Integration**: Leverages OpenAI's GPT-5-mini via Replit AI Integrations for advanced scam detection and conversational capabilities.
**Multi-Bot Design**: Supports multiple bots per user, with all data (knowledge base, groups, activity logs) scoped by `botConfigId` via foreign keys. Storage methods and API endpoints are designed to be bot-scoped.
**Scam Detection**: A comprehensive system combining:
    - **Homoglyph Normalization**: Strips dots/commas, converts similar-looking characters (e.g., Cyrillic, I/l, 0/O) to prevent evasion.
    - **Deterministic Regex**: Extensive patterns to detect various scam types like migration/airdrop scams, DM solicitations, unsolicited service offers, pump/shill spam, wallet buying scams, and more.
    - **Name Impersonation Detection**: Identifies users whose display names mimic bot or group names without admin privileges.
    - **AI Fallback**: Utilizes GPT-5-mini with a scam-biased prompt for messages that bypass deterministic checks.
    - **Report-based Learning**: Allows the bot to learn new scam patterns from user reports, extracting and storing key phrase bigrams to auto-flag future matching messages.
    - **Auto-ban Feature**: Configurable per-bot, automatically bans Telegram users after a set number of auto-deleted scam messages.

## Recent Changes
- 2026-03-12: **telegram.ts modular split** — Refactored monolithic 1590-line `server/telegram.ts` into `server/telegram/` module directory: `index.ts` (bot engine, webhook management, message routing), `scam-detection.ts` (deterministic regex patterns, AI scam check, learned patterns, executeScamAction), `normalization.ts` (HOMOGLYPH_MAP, normalizeUnicode, hasHomoglyphEvasion, checkNameImpersonation), `commands.ts` (handleCommand, handleDeleteRequest, handleReportCommand, generateAIResponse, shouldBotRespond), `types.ts` (BotInstance interface), `utils.ts` (OpenAI client, sendBotMessage). Improved HTML scraping in `scrapeUrl()` — added stripping for comments, noscript, svg, aside, iframe tags; proper block-element line breaks; correct HTML entity decoding (nbsp, amp, lt, gt, quot, numeric entities).
- 2026-03-12: **Platform audit completion** — Backend: PATCH `/api/auth/user` and `/api/auth/password` endpoints with email validation; `bot.getMe()` cached as `botTelegramId` on BotInstance (eliminated 6+ redundant API calls per message); cooldown map cleanup interval (every 10 min, removes entries >1h old); parallel bot startup via `Promise.allSettled`; `startSingleBot` rethrows on failure for accurate failure tracking. Frontend: React ErrorBoundary in App.tsx; Account settings page (`/account`) with profile + password forms; knowledge base delete confirmation via AlertDialog; dashboard connection status indicator; staleTime changed from Infinity to 30s; landing page error message parsing fixed; SEO meta tags updated to "Intelligent Community Agents" messaging; sidebar Account link.
- 2026-03-09: **Scam detection: language-agnostic structural patterns** — New `hasRevenueSplitScam` catches multi-language revenue split pitches (2+ percentages OR money range + percentage, combined with @handle at end of message, 3+ lines). New `hasFormattedPitchScam` catches formatted scam pitches (3+ ✅ checkmarks + urgency emojis 🚨💰⚠️❗ + @handle at end). Both run on raw text (not normalized) and work regardless of language. Added to `hasAnyScamSignal` and `runDeterministicScamCheck()`.
- 2026-03-07: **Fix: false positive in channelManagementPitch** — Tightened `channelManagementClaim` to require first-person pronoun ("I"/"we") before verbs, removed overly generic "own"/"have" from verb list, and removed "network" from community-word list. Was catching legitimate crypto discussion (staking, agent economy) because "own" + number word + "network" + "growth"/"collaboration" matched. Also added raw-text digit fallback (`/\d+/.test(text)`) since normalizer destroys numbers (50→so, 10→lo).
- 2026-03-06: **Security: rate limiting on auth endpoints** — Added in-memory rate limiter to `server/auth.ts` for login/register (10 attempts per 15 min per IP) and admin login (5 attempts per 15 min per IP). Returns 429 with Retry-After header when exceeded. Auto-cleanup every 60s.
- 2026-03-06: **Performance: database indexes** — Added 7 indexes to schema and migrations: `bot_configs(user_id)`, `bot_configs(is_active)`, `knowledge_base(bot_config_id)`, `groups(bot_config_id, telegram_chat_id)`, `activity_logs(bot_config_id, created_at)`, `activity_logs(bot_config_id, telegram_user_id)`, `reported_scam_patterns(bot_config_id)`. Indexes created via `CREATE INDEX IF NOT EXISTS` in migrations for safe idempotent runs.
- 2026-03-06: **Scam detection: token call card spam** — New `hasTokenCallCard` catches formatted token shill posts (contract address + market data like Vol/MC/Liq, percentage gains, safety scores). Patterns: (1) 0x hex address + Vol/MC/Liq keywords, (2) 0x address + percentage + safety/score, (3) Vol+MC + Liq + percentage combo without address, (4) CA/contract label + address + market data. Added to `hasAnyScamSignal` and `runDeterministicScamCheck()`.
- 2026-03-05: **Scam detection: cold pitch promo & volume service spam** — New `hasColdPitchPromo` patterns catch TikTok/influencer promo pitches: "crypto project" + growth/exposure/followers/campaign/media kit, "elevate/grow your project", "media kit" + campaign, "partner with" + growth + platform, N+ followers + crypto context. New `hasVolumeServiceSpam` detects "I will provide volume" + my community/support, numeric volume ranges on raw text, and "pin post" + "my community" + volume combo. Both added to `hasAnyScamSignal` and `runDeterministicScamCheck()`.

## External Dependencies
- **PostgreSQL**: Primary database for all application and session data.
- **OpenAI (GPT-5-mini)**: Integrated via Replit AI Integrations for AI-powered scam detection and bot responses.
- **Telegram Bot API**: Core platform for bot interaction and management.
- **Vite**: Frontend build tool.
- **Shadcn UI**: UI component library for React.
- **TanStack Query**: Data fetching and caching library.
- **Wouter**: React routing library.
- **bcrypt**: For password hashing.
- **express-session**: Session management middleware.
- **connect-pg-simple**: PostgreSQL store for express-session.
- **Drizzle ORM**: ORM for TypeScript and PostgreSQL.