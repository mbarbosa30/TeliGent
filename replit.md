# ContextBot - Telegram Bot Manager

## Overview
A web dashboard for configuring and managing an AI-powered Telegram group bot. The bot uses OpenAI (via Replit AI Integrations) to understand group context, answer questions from a knowledge base, detect reports, and respond intelligently without being spammy.

## Recent Changes
- 2026-02-20: Initial MVP built with dashboard, knowledge base, activity log, reports, and settings pages
- Telegram bot connected via polling with AI-powered responses
- Database seeded with sample knowledge base entries

## Architecture
- **Frontend**: React + TypeScript with Vite, Shadcn UI, TanStack Query, Wouter routing
- **Backend**: Express.js with Drizzle ORM on PostgreSQL
- **Telegram Bot**: node-telegram-bot-api with polling
- **AI**: OpenAI via Replit AI Integrations (gpt-5-mini for cost-effective responses)

## Key Files
- `shared/schema.ts` - Database schema (botConfigs, knowledgeBase, groups, activityLogs)
- `server/routes.ts` - API endpoints
- `server/storage.ts` - Database operations (DatabaseStorage class)
- `server/telegram.ts` - Telegram bot logic with AI response generation
- `server/seed.ts` - Database seeding
- `client/src/App.tsx` - Main app with sidebar layout
- `client/src/pages/` - Dashboard, Knowledge, Activity, Reports, Settings pages

## API Endpoints
- `GET/PATCH /api/config` - Bot configuration
- `GET/POST/PATCH/DELETE /api/knowledge` - Knowledge base CRUD
- `GET /api/groups` - Connected Telegram groups
- `GET /api/activity` - Activity logs

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `AI_INTEGRATIONS_OPENAI_API_KEY` - Auto-set by Replit
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - Auto-set by Replit

## Running
- `npm run dev` starts both frontend (Vite) and backend (Express) on port 5000
- `npm run db:push` syncs database schema
