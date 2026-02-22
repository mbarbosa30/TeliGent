# ContextBot - Multi-Tenant Telegram Bot Manager (SaaS)

## Overview
A multi-tenant SaaS platform where users sign up, connect their own Telegram bot tokens, and configure AI-powered group bots. Each user has isolated data (configs, knowledge base, groups, activity logs). Uses Replit Auth for authentication and supports per-user bot instances running concurrently.

## Recent Changes
- 2026-02-22: **Multi-tenant SaaS conversion** — Replit Auth, per-user data isolation, multi-bot engine, landing page, bot token onboarding
- 2026-02-22: All tables now have userId column for data isolation
- 2026-02-22: Bot token stored per-user in botConfigs (no more env var)
- 2026-02-22: Multi-bot engine manages concurrent TelegramBot instances per user
- 2026-02-22: Landing page for unauthenticated users, auth-gated dashboard
- 2026-02-20: Deterministic pre-check catches DM solicitation scams before AI runs
- 2026-02-20: AI scam detection prompt strengthened with more patterns
- 2026-02-20: Proactive scam detection — auto-deletes and warns on scam messages with admin bypass
- 2026-02-20: Per-user cooldowns, slash commands, token-safe context truncation
- 2026-02-20: Initial MVP built with dashboard, knowledge base, activity log, reports, and settings pages

## Architecture
- **Frontend**: React + TypeScript with Vite, Shadcn UI, TanStack Query, Wouter routing
- **Backend**: Express.js with Drizzle ORM on PostgreSQL
- **Auth**: Replit Auth (OpenID Connect) with PostgreSQL session storage
- **Telegram Bot**: Multi-instance bot engine — one TelegramBot per user, webhook mode in production
- **AI**: OpenAI via Replit AI Integrations (gpt-5-mini)

## Key Files
- `shared/schema.ts` - Database schema with userId on all tables, exports auth models
- `shared/models/auth.ts` - Users and sessions tables for Replit Auth
- `server/index.ts` - Express app with auth setup before routes
- `server/routes.ts` - Auth-protected API endpoints with userId scoping
- `server/storage.ts` - Database operations scoped by userId
- `server/telegram.ts` - Multi-bot engine managing per-user TelegramBot instances
- `server/replit_integrations/auth/` - Replit Auth module (do not modify)
- `client/src/App.tsx` - Auth-gated app with landing page for logged-out users
- `client/src/pages/landing.tsx` - Public landing page
- `client/src/pages/` - Dashboard, Knowledge, Activity, Reports, Settings pages
- `client/src/hooks/use-auth.ts` - Auth hook for React components
- `client/src/components/app-sidebar.tsx` - Sidebar with user profile and logout

## Multi-Tenant Design
- Each user provides their own Telegram bot token via Settings page
- All data tables (botConfigs, knowledgeBase, groups, activityLogs) have userId foreign key
- Storage methods are scoped: `storage.getConfig(userId)`, `storage.getGroups(userId)`, etc.
- Bot engine starts/stops individual bots based on active configs with tokens
- Webhooks use hashed tokens for unique per-bot paths

## API Endpoints (all require auth)
- `GET/PATCH /api/config` - Bot configuration (includes botToken, globalContext, websiteUrl)
- `GET/POST/PATCH/DELETE /api/knowledge` - Knowledge base CRUD
- `POST /api/scrape-website` - Fetch and extract text from a website URL
- `GET /api/groups` - Connected Telegram groups
- `GET /api/activity` - Activity logs
- Auth routes: `/api/login`, `/api/logout`, `/api/auth/user`, `/api/callback`

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection
- `SESSION_SECRET` - Session encryption key
- `AI_INTEGRATIONS_OPENAI_API_KEY` - Auto-set by Replit
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - Auto-set by Replit
- `REPLIT_DOMAINS` - Auto-set in production, used for webhook URL

## Running
- `npm run dev` starts both frontend (Vite) and backend (Express) on port 5000
- `npm run db:push` syncs database schema
