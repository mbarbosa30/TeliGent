# ContextBot - Telegram Bot Manager

## Overview
A web dashboard for configuring and managing an AI-powered Telegram group bot. The bot uses OpenAI (via Replit AI Integrations) to understand group context, answer questions from a knowledge base, detect reports, and respond intelligently without being spammy.

## Recent Changes
- 2026-02-20: Fixed "smart" mode to ONLY respond when bot is mentioned or replied to — no more false triggers on question words
- 2026-02-20: Proactive scam detection — auto-deletes and warns on scam messages (contract migration, PM-for-tokens, wallet phishing, etc.) with admin bypass
- 2026-02-20: Per-user cooldowns (instead of per-chat) so multiple users get responses simultaneously
- 2026-02-20: Dev mode clears webhook before polling to prevent 409 conflicts and message loss
- 2026-02-20: Added slash commands (/start, /help, /report) with AI-powered report moderation
- 2026-02-20: Token-safe context truncation (6000 char budget across global/website/knowledge)
- 2026-02-20: Fixed settings form race condition that could wipe globalContext on save
- 2026-02-20: Dashboard setup banner when Global Context is empty
- 2026-02-20: Bot now understands reply context (includes its previous message in AI conversation)
- 2026-02-20: Knowledge base auto-scrapes URLs when sourceUrl is provided
- 2026-02-20: Added Global Context, Website Import, and Paste Content features for richer bot context
- 2026-02-20: Switched to webhook mode in production, polling in development to avoid 409 conflicts
- 2026-02-20: Initial MVP built with dashboard, knowledge base, activity log, reports, and settings pages

## Architecture
- **Frontend**: React + TypeScript with Vite, Shadcn UI, TanStack Query, Wouter routing
- **Backend**: Express.js with Drizzle ORM on PostgreSQL
- **Telegram Bot**: node-telegram-bot-api with polling (dev) / webhook (production)
- **AI**: OpenAI via Replit AI Integrations (gpt-5-mini for cost-effective responses)

## Key Files
- `shared/schema.ts` - Database schema (botConfigs, knowledgeBase, groups, activityLogs)
- `server/routes.ts` - API endpoints including website scraping
- `server/storage.ts` - Database operations (DatabaseStorage class)
- `server/telegram.ts` - Telegram bot logic with AI response generation, webhook/polling modes
- `server/seed.ts` - Database seeding
- `client/src/App.tsx` - Main app with sidebar layout
- `client/src/pages/` - Dashboard, Knowledge, Activity, Reports, Settings pages

## Bot Context Sources
1. **Global Context** - Free-text description of project/community (Settings page)
2. **Website Import** - Scrapes a URL and stores extracted text content (Settings page)
3. **Knowledge Base** - Individual entries with categories (Knowledge Base page)
4. **Paste Content** - Bulk text import into knowledge base (Knowledge Base page)

## API Endpoints
- `GET/PATCH /api/config` - Bot configuration (includes globalContext, websiteUrl, websiteContent)
- `GET/POST/PATCH/DELETE /api/knowledge` - Knowledge base CRUD
- `POST /api/scrape-website` - Fetch and extract text from a website URL
- `GET /api/groups` - Connected Telegram groups
- `GET /api/activity` - Activity logs

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `AI_INTEGRATIONS_OPENAI_API_KEY` - Auto-set by Replit
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - Auto-set by Replit
- `REPLIT_DOMAINS` - Auto-set in production, used for webhook URL

## Running
- `npm run dev` starts both frontend (Vite) and backend (Express) on port 5000
- `npm run db:push` syncs database schema
