<div align="center">

<img src="https://teli.gent/og-image.png" alt="TeliGent" width="600" />

# TeliGent

**AI-powered Telegram community agents. Deploy in 5 minutes.**

[![Live](https://img.shields.io/badge/Live-teli.gent-000000?style=flat-square)](https://teli.gent)
[![Agents](https://img.shields.io/badge/Agents_Live-8-4ade80?style=flat-square)](#agents)
[![Scams Stopped](https://img.shields.io/badge/Scams_Stopped-1%2C556-ef4444?style=flat-square)](#agents)
[![ERC-8004](https://img.shields.io/badge/ERC--8004-Celo-fcff52?style=flat-square)](https://www.8004scan.io/agents/celo/3718)
[![Synthesis](https://img.shields.io/badge/Synthesis-Hackathon-7c3aed?style=flat-square)](https://synthesis.md)

[Live App](https://teli.gent) &middot; [Telegram](https://t.me/teli_gent) &middot; [X / Twitter](https://x.com/Teli_Gent_)

</div>

---

## What is TeliGent?

TeliGent is a multi-tenant SaaS platform where anyone can deploy an AI-powered agent to protect and engage their Telegram community.

Connect a bot token. Set a personality. Add your knowledge base. Your agent starts catching scams, answering questions, and learning from your community — so you don't have to moderate 24/7.

**8 agents are live in production today**, protecting 1,700+ members across crypto, gaming, and web3 communities. **1,556 scams stopped and counting.**

<div align="center">
<img src="https://teli.gent/teligent-dashboard.png" alt="TeliGent Dashboard" width="700" />
</div>

---

## How It Works

```
1. Connect     →  Paste your Telegram bot token from @BotFather
2. Configure   →  Set personality, knowledge base, and response style
3. Protect     →  Your agent goes live — catching scams and engaging members
```

No coding required. Setup takes under 5 minutes.

---

## Scam Detection

TeliGent doesn't rely on keyword lists. It uses a multi-layered detection system:

| Layer | What It Does |
|-------|-------------|
| **Homoglyph Normalization** | Decodes unicode evasion tricks (e.g. `frее mіnt` → `free mint`) |
| **Structural Pattern Analysis** | Language-agnostic detection of scam message structures |
| **Name Impersonation** | Catches users mimicking admin/bot names |
| **Report-Based Learning** | Extracts key phrases from community reports to improve detection |
| **AI Fallback (GPT-5.2)** | Contextual analysis for novel scam patterns |
| **Auto-Ban** | Configurable threshold for repeat offenders |

---

## Agents

8 community agents are registered on-chain with verified identities via [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) on Celo.

| Agent | Community | Scams Caught | Members | On-Chain Identity |
|-------|-----------|:------------:|:-------:|:-----------------:|
| **SelfClaw** | [@SelfClaw](https://t.me/SelfClaw) | 416 | 295 | [#3713](https://www.8004scan.io/agents/celo/3713) |
| **BuilderScout** | [@BuilderScout](https://t.me/BuilderScout) | 489 | 445 | [#3717](https://www.8004scan.io/agents/celo/3717) |
| **TeliGent** | [@teli_gent](https://t.me/teli_gent) | 376 | 32 | [#3718](https://www.8004scan.io/agents/celo/3718) |
| **WhiteClaw** | [@whiteclawman](https://t.me/whiteclawman) | 236 | 86 | [#3714](https://www.8004scan.io/agents/celo/3714) |
| **MiniPlay** | [@MiniPlay_AI_Bot](https://t.me/MiniPlay_AI_Bot) | 35 | 538 | [#3715](https://www.8004scan.io/agents/celo/3715) |
| **Oracle360** | [@oracle360](https://t.me/oracle360) | 4 | 225 | [#3716](https://www.8004scan.io/agents/celo/3716) |
| **NFTBootzBot** | [@NFTB00TZ](https://t.me/NFTB00TZ) | 0 | 71 | [#3719](https://www.8004scan.io/agents/celo/3719) |
| **Violet** | [@Raidsandshill](https://t.me/Raidsandshill) | 0 | 16 | [#3720](https://www.8004scan.io/agents/celo/3720) |

---

## Agent-to-Agent API

TeliGent exposes its threat intelligence as paid services for other AI agents.

```
POST /api/agent/services/threat-check    →  Scan any message for scam patterns
GET  /api/agent/services/community-health →  Aggregated community protection stats
GET  /api/agent/identity                  →  Full agent manifest
GET  /.well-known/agent.json              →  Agent card discovery
```

**Payment & Trust:**
- [Locus](https://paywithlocus.com) wallet for USDC payments on Base
- [Self Protocol](https://self.xyz) zero-knowledge identity verification — verified agents get 50% discount
- [OpenServ](https://openserv.co) marketplace for multi-agent discoverability
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) on-chain agent identity on Celo

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React)                     │
│  Dashboard · Knowledge Base · Activity Log · Settings    │
├─────────────────────────────────────────────────────────┤
│                   Backend (Express.js)                    │
│  Auth · REST API · Session Management · Admin Panel      │
├──────────────┬──────────────┬───────────────────────────┤
│  Telegram    │  AI Engine   │  Master Agent              │
│  Bot Engine  │  GPT-5.2     │  Agent-to-Agent API        │
│  (webhooks)  │  GPT-5-mini  │  Locus · Self · OpenServ   │
├──────────────┴──────────────┴───────────────────────────┤
│              PostgreSQL (Drizzle ORM)                     │
│  Users · Bots · Groups · Knowledge · Activity · Reports  │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Frontend** | React, TypeScript, Vite, Shadcn UI, TanStack Query, Wouter |
| **Backend** | Express.js, Node.js, TypeScript |
| **Database** | PostgreSQL, Drizzle ORM |
| **AI** | OpenAI GPT-5.2 (scam detection), GPT-5-mini (conversations) |
| **Messaging** | Telegram Bot API (webhook mode) |
| **Payments** | Locus API (USDC on Base) |
| **Identity** | Self Protocol (ZK proofs), ERC-8004 (Celo) |
| **Marketplace** | OpenServ (agent discovery) |
| **Styling** | Tailwind CSS, Space Grotesk, JetBrains Mono |
| **Hosting** | Replit |

---

## Features

- **Multi-tenant SaaS** — Multiple bots per user, isolated configs, data, and logs
- **Scam Detection** — Deterministic rules + AI fallback, 1,556 scams caught
- **Knowledge Base** — Custom Q&A entries per bot, auto-scraped from websites
- **Real-time Learning** — AI extracts facts from conversations into knowledge base
- **Conversation Memory** — 50-message ring buffer per group (4-hour TTL)
- **Group Context** — Fetches group descriptions and pinned messages for AI context
- **Configurable Personality** — Set tone, response style, and behavior per bot
- **Activity Dashboard** — Real-time logs of all bot interactions and scam reports
- **Auto-Ban** — Configurable threshold for repeat scam offenders
- **Embeddable Widget** — Chat widget for websites using the same AI engine
- **ERC-8004 Registration** — On-chain agent identity on Celo mainnet
- **Agent-to-Agent API** — Paid threat intelligence services for other agents

---

## Token

**$TELI** on Base: [`0x2822656E2Eec1c608a223752B4e0A651b50c4bA3`](https://basescan.org/token/0x2822656E2Eec1c608a223752B4e0A651b50c4bA3)

---

## Links

- **Live App:** [teli.gent](https://teli.gent)
- **Telegram:** [t.me/teli_gent](https://t.me/teli_gent)
- **X / Twitter:** [@Teli_Gent_](https://x.com/Teli_Gent_)
- **8004scan:** [TeliGent Agent #3718](https://www.8004scan.io/agents/celo/3718)
- **Celoscan:** [ERC-8004 Registry](https://celoscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)

---

## License

MIT

---

<div align="center">

**Built by [Team Zeno](https://zeno.vision) for [The Synthesis Hackathon](https://synthesis.md)**

</div>
