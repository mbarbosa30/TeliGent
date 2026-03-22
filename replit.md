# TeliGent - Intelligent Telegram Bot Manager (SaaS)

## Overview
TeliGent is a multi-tenant SaaS platform for managing AI-powered Telegram group bots. It allows users to connect bot tokens and configure advanced AI capabilities for community management and scam prevention. The platform proactively detects and counters various types of scams (financial shills, phishing, impersonation) using deterministic rules and AI. It supports multiple bots per user, with isolated configurations, knowledge bases, group data, and activity logs, aiming for a robust, scalable, and secure solution.

## User Preferences
I prefer simple language and detailed explanations. I want iterative development and to be asked before major changes are made. Do not make changes to files in the `shared/` folder unless explicitly requested or if it's a critical bug fix affecting core functionality across both client and server.

## System Architecture
**Frontend**: Developed with React and TypeScript, using Vite, Shadcn UI for components, TanStack Query for data fetching, and Wouter for routing. The UI features a minimal aesthetic with Space Grotesk + JetBrains Mono fonts, zero border-radius, no shadows, and a monochrome palette. An embeddable chat widget (`client/public/widget.js`) reuses the AI engine, knowledge base, and memories for website integration.
**Backend**: Built on Express.js with Drizzle ORM for PostgreSQL.
**Authentication**: Custom email/password system using bcrypt for hashing and express-session for session management.
**Telegram Bot Engine**: A modular, multi-instance architecture (`server/telegram/`) with isolated configurations for each bot, primarily operating in webhook mode. Key modules include scam detection, homoglyph/unicode normalization, bot commands/AI response, conversation history, and real-time AI learning.
**AI Integration**: Utilizes GPT-5.2 for scam detection, content moderation, and knowledge extraction, and GPT-5-mini for faster conversational responses, both via Replit AI Integrations.
**Conversation Memory**: An in-memory ring buffer stores the last 50 messages per group (4-hour TTL) for AI context.
**Real-time Learning**: AI extracts facts from substantive messages, saving them to a bot's knowledge base (max 50 per bot, with cooldown).
**Multi-Bot Design**: All data (knowledge base, groups, activity logs) is scoped by `botConfigId` via foreign keys.
**Scam Detection**: Combines homoglyph normalization, extensive deterministic regex patterns, name impersonation detection, and an AI fallback (GPT-5.2). It includes report-based learning to extract and store key phrase bigrams from user reports, and a configurable auto-ban feature for repeat offenders. Structural and token-based scam patterns are implemented for language-agnostic detection.
**Group Context**: Bot fetches and caches group descriptions and pinned messages, injecting them into the AI system prompt.
**Website Auto-scrape**: Bots can automatically scrape a configured `websiteUrl` for content if empty, using a shared scraper module.
**Master Agent (Agent-to-Agent API)**: An autonomous agent layer (`server/agent/`) that exposes TeliGent's scam detection and threat intelligence as public API services for other agents. Includes Locus payment integration on Base (USDC) for paid service calls, Self Protocol proof-of-human identity on Celo, OpenServ marketplace integration for multi-agent discoverability, and ERC-8004 on-chain agent identity standard. Endpoints: `/api/agent/identity` (full manifest with OpenServ-compatible fields — pricing, payment, trust, endpoints, erc8004), `/api/agent/services/threat-check` (scam analysis), `/api/agent/services/community-health` (aggregated stats), `/api/agent/wallet/status` (Locus wallet), `/api/agent/openserv/invoke` (OpenServ capability invocation), `/api/agent/openserv/health` (OpenServ health), `/.well-known/agent.json` (agent card discovery), `/api/agent/erc8004/registration` (ERC-8004 compliant agent registration JSON). All routes on main server port 5000. Service requests logged in `agent_service_logs` table. Dashboard at `/agent` in the frontend.
**ERC-8004 Bot Registration on Celo**: Each bot can be registered on the ERC-8004 Agent Identity Registry on Celo (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) via `server/agent/celo.ts`. Registration creates an on-chain identity with the bot's real stats (groups, members, activity, KB entries) encoded as a base64 data URI. Uses viem for transaction signing. Endpoints: `POST /api/bots/:botId/erc8004/register` (trigger registration), `GET /api/bots/:botId/erc8004/status` (check status). Data stored in `celo_agent_id`, `celo_tx_hash`, `celo_registered_at` columns on `bot_configs`. UI in bot settings page shows registration status with Celoscan tx link. Row-level locking prevents duplicate registrations. Env: `CELO_WALLET_PRIVATE_KEY`.

## External Dependencies
- **PostgreSQL**: Primary database.
- **OpenAI (GPT-5-mini)**: For AI-powered scam detection and bot responses (via Replit AI Integrations).
- **Telegram Bot API**: For bot interaction.
- **Vite**: Frontend build tool.
- **Shadcn UI**: UI component library.
- **TanStack Query**: Data fetching and caching.
- **Wouter**: React routing.
- **bcrypt**: Password hashing.
- **express-session**: Session management.
- **connect-pg-simple**: PostgreSQL store for sessions.
- **Drizzle ORM**: ORM for TypeScript and PostgreSQL.
- **Locus API**: Agent wallet and payment infrastructure on Base (USDC). Used for agent-to-agent service payments.
- **Self Protocol (@selfxyz/agent-sdk)**: Proof-of-human identity verification on Celo. Optional trust upgrade for agent-to-agent callers — Self-verified agents get 50% pricing discount and higher rate limits (60/min vs 30/min). Verification via `x-self-agent-address`, `x-self-agent-signature`, `x-self-agent-timestamp` request headers.
- **OpenServ**: Multi-agent marketplace integration. TeliGent registers as a discoverable agent on the OpenServ platform with 3 capabilities (threat-check, threat-check-ai, community-health). Routes are registered on the main Express server (same port 5000) at `/api/agent/openserv/invoke` and `/api/agent/openserv/health`. Serves `/.well-known/agent.json` for agent card discovery with full pricing, payment, trust model, and endpoint metadata. Invocations are logged through the service logging pipeline. Env: `OPENSERV_API_KEY`.