# TeliGent - Intelligent Telegram Bot Manager (SaaS)

## Overview
TeliGent is a multi-tenant SaaS platform (teli.gent) for managing AI-powered Telegram group bots. Users can sign up, connect their Telegram bot tokens, and configure advanced AI capabilities. The platform supports managing multiple bots per user, with each bot operating with isolated configurations, knowledge bases, group data, and activity logs. It is designed to proactively detect and counter various types of scams, including financial shills, phishing, and impersonation, using a combination of deterministic rules and AI. The project aims to provide a robust, scalable, and secure solution for community management and scam prevention within Telegram.

## User Preferences
I prefer simple language and detailed explanations. I want iterative development and to be asked before major changes are made. Do not make changes to files in the `shared/` folder unless explicitly requested or if it's a critical bug fix affecting core functionality across both client and server.

## System Architecture
**Frontend**: Developed with React and TypeScript, utilizing Vite for building, Shadcn UI for components, TanStack Query for data fetching, and Wouter for routing. The UI features a refined minimal aesthetic with Space Grotesk + JetBrains Mono fonts, zero border-radius, no shadows, and a monochrome palette.
**Backend**: Built on Express.js, using Drizzle ORM for PostgreSQL database interactions.
**Authentication**: Custom email/password authentication system with bcrypt for password hashing and express-session for session management, stored in PostgreSQL.
**Telegram Bot Engine**: A multi-instance architecture where each user's bot configuration runs as an isolated TelegramBot instance, primarily operating in webhook mode for production.
**AI Integration**: Leverages OpenAI's GPT-5-mini via Replit AI Integrations for advanced scam detection and conversational capabilities.
**Multi-Bot Design**: Supports multiple bots per user, with all data (knowledge base, groups, activity logs) scoped by `botConfigId` via foreign keys. Storage methods and API endpoints are designed to be bot-scoped.
**Scam Detection**: A comprehensive system combining:
    - **Homoglyph Normalization**: Strips dots/commas, converts similar-looking characters (e.g., Cyrillic, I/l, 0/O) to prevent evasion.
    - **Deterministic Regex**: Extensive patterns to detect various scam types like migration/airdrop scams, DM solicitations, unsolicited service offers, pump/shill spam, wallet buying scams, and more.
    - **Name Impersonation Detection**: Identifies users whose display names mimic bot or group names without admin privileges.
    - **AI Fallback**: Utilizes GPT-5-mini with a scam-biased prompt for messages that bypass deterministic checks.
    - **Report-based Learning**: Allows the bot to learn new scam patterns from user reports, extracting and storing key phrase bigrams to auto-flag future matching messages.
    - **Auto-ban Feature**: Configurable per-bot, automatically bans Telegram users after a set number of auto-deleted scam messages.

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