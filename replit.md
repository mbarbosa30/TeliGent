# TeliGent - Intelligent Telegram Bot Manager (SaaS)

## Overview
TeliGent is a multi-tenant SaaS platform designed for managing AI-powered Telegram group bots. Its primary purpose is to provide advanced AI capabilities for community management, scam prevention, and real-time content moderation within Telegram groups. The platform aims to detect and counter various types of scams using deterministic rules and AI, offering a robust, scalable, and secure solution with isolated configurations and data for multiple bots per user. Key capabilities include AI-driven scam detection, real-time learning, configurable rewards systems, and an embeddable chat widget.

## User Preferences
I prefer simple language and detailed explanations. I want iterative development and to be asked before major changes are made. Do not make changes to files in the `shared/` folder unless explicitly requested or if it's a critical bug fix affecting core functionality across both client and server.

## System Architecture
**Frontend**: Built with React, TypeScript, Vite, Shadcn UI, TanStack Query, and Wouter. Features a minimal UI with a monochrome palette. An embeddable chat widget (`client/public/widget.js`) integrates AI, knowledge base, and memory for website support.
**Backend**: Utilizes Express.js with Drizzle ORM for PostgreSQL.
**Authentication**: Custom email/password system with bcrypt and express-session. Includes email verification and self-serve password recovery via single-use, hashed, expiring tokens (24h verify, 60min reset). Outbound email goes through `server/email/mailer.ts`, which prefers Resend when configured and falls back to a console-log stub in development. The `requireVerifiedEmail` middleware gates paid actions (`/api/billing/checkout`, `/api/billing/crypto/intent`, `/api/bots/:id/erc8004/register`). Public pages `/forgot-password`, `/reset-password`, and `/verify-email` are accessible without a session. A successful password reset force-deletes all other sessions for that user.
**Telegram Bot Engine**: Modular, multi-instance architecture supporting isolated configurations for each bot, primarily via webhooks. Includes scam detection, AI response, conversation history, and real-time AI learning.
**AI Integration**: Leverages GPT-5.2 for scam detection and content moderation, and GPT-5-mini for conversational responses, all via Replit AI Integrations.
**Conversation Memory**: An in-memory ring buffer stores recent messages for AI context.
**Real-time Learning**: AI extracts and stores facts from messages into a bot's knowledge base.
**Multi-Bot Design**: All bot-specific data is scoped by `botConfigId`.
**Scam Detection**: Employs homoglyph normalization, regex patterns, name impersonation detection, and GPT-5.2 as an AI fallback. Features report-based learning, configurable auto-ban, and per-bot scam sensitivity settings.
**Group Context**: Bots fetch and cache group descriptions and pinned messages for AI system prompts.
**Website Auto-scrape**: Bots can automatically scrape a configured `websiteUrl` for content.
**Master Agent (Agent-to-Agent API)**: An autonomous agent layer exposing TeliGent's scam detection and threat intelligence as public API services. Includes Locus payment integration, Self Protocol for proof-of-human identity, OpenServ marketplace integration, and ERC-8004 agent identity standard.
**Bankr Crypto Intelligence**: Optional per-bot feature integrating the Bankr REST API for real-time crypto data, enabling `/price` commands and enriching AI responses with market data.
**Passive CEO Rewards Loop**: Configurable per-bot system for reputation, leaderboards, proactive engagement, ERC-20 token rewards, and referral tracking.
**Proactive Community Feedback Loop**: Optional feature extending the proactive prompt engine to gather structured feedback, categorized and summarized by AI, presented in a dashboard.
**ERC-8004 Bot Registration on Celo**: Bots can register on the ERC-8004 Agent Identity Registry on Celo, creating an on-chain identity with bot stats.
**Plans & Billing**: Three SaaS tiers (Free, Pro, Business) with features and quotas defined in `server/limits.ts`. Supports Stripe for card payments and crypto payments on Base (USDC + $TELI) via on-chain transfer monitoring. $TELI token offers perks like discounts and rewards multipliers. Paywall enforcement is managed by `server/billing/gates.ts`.
**Production Configuration**: Includes robust session secret validation, centralized resource limits (`server/limits.ts`), daily AI call budget enforcement via `ai_usage_daily` table, and widget origin allowlisting.
**Public Activity Feed**: Bots can opt in via `bot_configs.shareAnonymizedEvents` (off by default). When opted in, the public `GET /api/public/recent-events` endpoint streams the last 24h of category-only events (scam_removed, ai_answer, reward, new_member) with telegram handles redacted to a salted `@x***NN` form and bot identity hidden behind "a community". Output is capped at 12 events and cached in-memory for 30s. The landing page hero card includes a `live-feed` scenario that polls this endpoint and falls back to a scripted scenario when the feed is empty.

## External Dependencies
- **PostgreSQL**: Primary database.
- **OpenAI (GPT-5.2, GPT-5-mini)**: For AI capabilities via Replit AI Integrations.
- **Telegram Bot API**: For bot interaction.
- **Vite**: Frontend build tool.
- **Shadcn UI**: UI component library.
- **TanStack Query**: Data fetching.
- **Wouter**: React routing.
- **bcrypt**: Password hashing.
- **express-session**: Session management.
- **connect-pg-simple**: PostgreSQL session store.
- **Drizzle ORM**: ORM for TypeScript and PostgreSQL.
- **Locus API**: Agent wallet and payment infrastructure on Base (USDC).
- **Self Protocol (@selfxyz/agent-sdk)**: Proof-of-human identity verification on Celo.
- **OpenServ**: Multi-agent marketplace integration.
- **Bankr API**: Crypto trading and wallet API (`api.bankr.bot`).