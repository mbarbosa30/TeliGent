# TeliGent - Intelligent Telegram Bot Manager (SaaS)
## Domain: teli.gent

## Overview
A multi-tenant SaaS platform (branded as **TeliGent**, domain **teli.gent**) where users sign up with email/password, connect their own Telegram bot tokens, and configure AI-powered group bots. Each user can manage multiple bots, with each bot having isolated data (configs, knowledge base, groups, activity logs). Supports per-user multi-bot instances running concurrently.

## Recent Changes
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
