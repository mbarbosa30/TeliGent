import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { storage } from "./storage";
import { log } from "./index";
import { db } from "./db";
import { users } from "@shared/schema";
import type { BotConfig } from "@shared/schema";
import type { Express } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface BotInstance {
  bot: TelegramBot;
  userId: string;
  botConfigId: number;
  token: string;
  webhookPath: string;
  botUsername: string;
  botTelegramId: number;
}

const activeBots = new Map<string, BotInstance>();
const cooldowns = new Map<string, number>();
const registeredWebhookPaths = new Set<string>();
const webhookPathToToken = new Map<string, string>();
let engineStarted = false;
let expressApp: Express | null = null;
let cooldownCleanupInterval: ReturnType<typeof setInterval> | null = null;

function getWebhookPath(token: string): string {
  const hash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
  return `/api/telegram-webhook/${hash}`;
}

function getWebhookSecret(token: string): string {
  return crypto.createHash("sha256").update(`webhook-secret-${token}`).digest("hex").slice(0, 32);
}

function getAppUrl(): string | null {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.REPLIT_DOMAINS) {
    const domain = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    if (domain) return `https://${domain}`;
  }
  if (process.env.REPLIT_DEPLOYMENT_URL) return `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
  return null;
}

export async function getWebhookStatus(botConfigId: number): Promise<any> {
  for (const [, instance] of Array.from(activeBots.entries())) {
    if (instance.botConfigId === botConfigId) {
      try {
        const info = await instance.bot.getWebHookInfo();
        return {
          active: true,
          botUsername: instance.botUsername,
          webhookUrl: info.url,
          pendingUpdates: info.pending_update_count,
          lastError: info.last_error_message || null,
          lastErrorDate: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
          hasCustomCert: info.has_custom_certificate,
          maxConnections: info.max_connections,
        };
      } catch (err: any) {
        return { active: true, error: err.message, stack: err.stack };
      }
    }
  }

  try {
    const config = await storage.getBotConfig(botConfigId);
    if (!config || !config.botToken) {
      return { active: false, error: "No bot config or token found" };
    }
    const tempBot = new TelegramBot(config.botToken);
    const info = await tempBot.getWebHookInfo();
    return {
      active: false,
      botName: config.botName,
      webhookUrl: info.url,
      pendingUpdates: info.pending_update_count,
      lastError: info.last_error_message || null,
      lastErrorDate: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
      hasCustomCert: info.has_custom_certificate,
      maxConnections: info.max_connections,
      note: "Bot is not in active instances — queried Telegram directly",
    };
  } catch (err: any) {
    return { active: false, error: err.message, stack: err.stack };
  }
}

export async function startBotEngine(app?: Express) {
  if (app) expressApp = app;

  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    log("Dev mode: skipping Telegram bots to avoid conflicts with production webhooks.", "telegram");
    return;
  }

  try {
    const allConfigs = await storage.getAllActiveConfigs();
    const configsWithTokens: BotConfig[] = [];
    for (const c of allConfigs) {
      if (!c.botToken || !c.botToken.trim()) continue;
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, c.userId)).limit(1);
      if (!user) {
        log(`Orphaned config for non-existent user ${c.userId} — skipping`, "telegram");
        continue;
      }
      configsWithTokens.push(c);
    }

    const tokenMap = new Map<string, BotConfig>();
    for (const c of configsWithTokens) {
      const existing = tokenMap.get(c.botToken);
      if (!existing || new Date(c.updatedAt) > new Date(existing.updatedAt)) {
        tokenMap.set(c.botToken, c);
      }
    }
    const dedupedConfigs = Array.from(tokenMap.values());

    if (dedupedConfigs.length < configsWithTokens.length) {
      log(`Bot engine: deduplicated ${configsWithTokens.length} configs to ${dedupedConfigs.length} unique tokens`, "telegram");
    }

    log(`Bot engine: found ${dedupedConfigs.length} active bot configs with tokens`, "telegram");

    const currentTokens = new Set(dedupedConfigs.map(c => c.botToken));
    for (const [token, instance] of Array.from(activeBots.entries())) {
      if (!currentTokens.has(token)) {
        log(`Stopping bot for user ${instance.userId} (config removed or deactivated)`, "telegram");
        try {
          await instance.bot.deleteWebHook();
          instance.bot.removeAllListeners();
        } catch (e: any) {
          log(`Error stopping bot: ${e.message}`, "telegram");
        }
        activeBots.delete(token);
        const path = getWebhookPath(token);
        webhookPathToToken.delete(path);
      }
    }

    const botsToStart = dedupedConfigs.filter(c => !activeBots.has(c.botToken));
    if (botsToStart.length > 0) {
      const results = await Promise.allSettled(botsToStart.map(c => startSingleBot(c)));
      const failed = results.filter(r => r.status === "rejected");
      if (failed.length > 0) {
        log(`Bot startup: ${botsToStart.length - failed.length} succeeded, ${failed.length} failed`, "telegram");
      }
    }

    engineStarted = true;

    startWebhookHealthCheck();
    startCooldownCleanup();
  } catch (err: any) {
    log(`Bot engine error: ${err.message}\n${err.stack || ""}`, "telegram");
  }
}

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

function startWebhookHealthCheck() {
  if (healthCheckInterval) return;
  const INTERVAL_MS = 5 * 60 * 1000;
  healthCheckInterval = setInterval(async () => {
    const appUrl = getAppUrl();
    if (!appUrl) return;
    for (const [token, instance] of Array.from(activeBots.entries())) {
      try {
        const info = await instance.bot.getWebHookInfo();
        const expectedPath = getWebhookPath(token);
        const expectedUrl = `${appUrl}${expectedPath}`;
        if (info.url !== expectedUrl) {
          log(`[HEALTH] Webhook mismatch for @${instance.botUsername}: expected=${expectedUrl}, actual=${info.url} — re-setting`, "telegram");
          const secret = getWebhookSecret(token);
          await instance.bot.deleteWebHook();
          await instance.bot.setWebHook(expectedUrl, { secret_token: secret });
          const newInfo = await instance.bot.getWebHookInfo();
          log(`[HEALTH] Webhook re-set for @${instance.botUsername}: url=${newInfo.url}, pending=${newInfo.pending_update_count}, error=${newInfo.last_error_message || "none"}`, "telegram");
        } else if (info.last_error_message) {
          log(`[HEALTH] Webhook error for @${instance.botUsername}: ${info.last_error_message} (date: ${info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : "unknown"})`, "telegram");
        }
      } catch (err: any) {
        log(`[HEALTH] Check failed for @${instance.botUsername}: ${err.message}`, "telegram");
      }
    }
  }, INTERVAL_MS);
  log("Webhook health check started (every 5 minutes)", "telegram");
}

function startCooldownCleanup() {
  if (cooldownCleanupInterval) return;
  const CLEANUP_INTERVAL = 10 * 60 * 1000;
  cooldownCleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, timestamp] of cooldowns) {
      if (now - timestamp > 3600 * 1000) {
        cooldowns.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log(`Cooldown cleanup: removed ${cleaned} stale entries (${cooldowns.size} remaining)`, "telegram");
    }
  }, CLEANUP_INTERVAL);
  log("Cooldown cleanup started (every 10 minutes)", "telegram");
}

async function startSingleBot(config: BotConfig) {
  const token = config.botToken;
  const userId = config.userId;
  const appUrl = getAppUrl();

  if (!appUrl || !expressApp) {
    log(`Cannot start bot for user ${userId}: no APP_URL or Express app`, "telegram");
    return;
  }

  try {
    const bot = new TelegramBot(token);
    const webhookPath = getWebhookPath(token);
    const secret = getWebhookSecret(token);

    const me = await bot.getMe();
    const botUsername = me.username || "";
    log(`Bot info fetched: @${botUsername} for user ${userId}`, "telegram");

    await storage.updateBotConfig(config.id, { botName: me.first_name || "Bot" });

    const instance: BotInstance = { bot, userId, botConfigId: config.id, token, webhookPath, botUsername, botTelegramId: me.id };
    activeBots.set(token, instance);

    bot.on("message", (msg) => handleMessage(msg, instance));
    bot.on("new_chat_members", (msg) => handleNewMembers(msg, instance));
    bot.on("left_chat_member", (msg) => handleLeftMember(msg, instance));

    webhookPathToToken.set(webhookPath, token);

    if (!registeredWebhookPaths.has(webhookPath)) {
      const capturedPath = webhookPath;
      expressApp.post(capturedPath, (req, res) => {
        const currentToken = webhookPathToToken.get(capturedPath);
        if (!currentToken) {
          log(`[WEBHOOK] No token mapped for ${capturedPath}`, "telegram");
          res.sendStatus(200);
          return;
        }
        const expectedSecret = getWebhookSecret(currentToken);
        const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
        if (headerSecret && headerSecret !== expectedSecret) {
          log(`[WEBHOOK] Auth FAILED for ${capturedPath} (secret mismatch)`, "telegram");
          res.sendStatus(403);
          return;
        }
        if (!headerSecret) {
          log(`[WEBHOOK] Rejected: no secret_token header for ${capturedPath}`, "telegram");
          res.sendStatus(401);
          return;
        }
        const inst = activeBots.get(currentToken);
        if (inst) {
          const body = req.body;
          const updateType = body.message ? "message" : body.edited_message ? "edited_message" : body.callback_query ? "callback_query" : body.my_chat_member ? "my_chat_member" : body.chat_member ? "chat_member" : "other";
          const msgText = body.message?.text?.substring(0, 50) || "(no text)";
          const chatType = body.message?.chat?.type || "unknown";
          log(`[WEBHOOK] Update for @${inst.botUsername}: type=${updateType}, chat=${chatType}, text="${msgText}"`, "telegram");
          inst.bot.processUpdate(body);
        } else {
          log(`[WEBHOOK] No active bot instance for token at ${capturedPath}`, "telegram");
        }
        res.sendStatus(200);
      });
      registeredWebhookPaths.add(webhookPath);
      log(`Registered webhook route: ${webhookPath}`, "telegram");
    } else {
      log(`Webhook route already registered: ${webhookPath} — updated token mapping`, "telegram");
    }

    const webhookUrl = `${appUrl}${webhookPath}`;
    try {
      await bot.deleteWebHook();
    } catch (e: any) {
      log(`Warning: deleteWebHook before set failed for @${botUsername}: ${e.message}`, "telegram");
    }
    const setResult = await bot.setWebHook(webhookUrl, { secret_token: secret });
    log(`setWebHook result for @${botUsername}: ${setResult}`, "telegram");

    const webhookInfo = await bot.getWebHookInfo();
    log(`Webhook info for @${botUsername}: url=${webhookInfo.url}, pending=${webhookInfo.pending_update_count}, last_error=${webhookInfo.last_error_message || "none"}, last_error_date=${webhookInfo.last_error_date || "none"}, has_custom_cert=${webhookInfo.has_custom_certificate}, max_connections=${webhookInfo.max_connections}`, "telegram");

    if (webhookInfo.last_error_message) {
      log(`WARNING: Telegram reports webhook error for @${botUsername}: ${webhookInfo.last_error_message}`, "telegram");
      log(`Retrying setWebHook for @${botUsername}...`, "telegram");
      await bot.deleteWebHook();
      await new Promise(r => setTimeout(r, 1000));
      const retryResult = await bot.setWebHook(webhookUrl, { secret_token: secret });
      log(`Retry setWebHook result for @${botUsername}: ${retryResult}`, "telegram");
      const retryInfo = await bot.getWebHookInfo();
      log(`Retry webhook info for @${botUsername}: url=${retryInfo.url}, pending=${retryInfo.pending_update_count}, last_error=${retryInfo.last_error_message || "none"}`, "telegram");
    }

    log(`Bot started for user ${userId}: @${botUsername} (webhook: ${webhookUrl})`, "telegram");
  } catch (err: any) {
    log(`Failed to start bot for user ${userId}: ${err.message}\n${err.stack || ""}`, "telegram");
    throw err;
  }
}

async function handleNewMembers(msg: TelegramBot.Message, instance: BotInstance) {
  if (!msg.new_chat_members || !msg.chat) return;
  const { bot, userId, botConfigId } = instance;

  const botJoined = msg.new_chat_members.some(m => m.id === instance.botTelegramId);

  if (botJoined) {
    const chatId = msg.chat.id.toString();
    const chatTitle = msg.chat.title || "Unknown Group";
    const memberCount = await bot.getChatMemberCount(msg.chat.id).catch(() => 0);

    await storage.upsertGroup(botConfigId, userId, {
      telegramChatId: chatId,
      name: chatTitle,
      memberCount,
      isActive: true,
    });

    await storage.createActivityLog(botConfigId, userId, {
      groupId: null,
      type: "join",
      userName: "Bot",
      userMessage: `Bot joined group "${chatTitle}"`,
      botResponse: null,
      isReport: false,
      metadata: null,
    });

    log(`Bot joined group: ${chatTitle} (user: ${userId})`, "telegram");
  }
}

async function handleLeftMember(msg: TelegramBot.Message, instance: BotInstance) {
  if (!msg.left_chat_member || !msg.chat) return;
  const { bot, userId, botConfigId } = instance;

  if (msg.left_chat_member.id === instance.botTelegramId) {
    const group = await storage.getGroupByChatId(botConfigId, msg.chat.id.toString());
    if (group) {
      await storage.updateGroup(botConfigId, group.id, { isActive: false });
    }
    log(`Bot removed from group: ${msg.chat.title} (user: ${userId})`, "telegram");
  }
}

const MIN_SCAM_CHECK_LENGTH = 30;

const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "shall", "can", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "out", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "and", "but", "or", "if", "while", "that", "this", "these", "those", "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she", "her", "it", "its", "they", "them", "their", "what", "which", "who", "whom"]);

function extractKeyPhrases(normalizedText: string): string[] {
  const words = normalizedText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  if (words.length < 2) return words.length > 0 ? [words.join(" ")] : [];
  const phrases: string[] = [];
  for (let i = 0; i <= words.length - 2; i++) {
    phrases.push(words.slice(i, i + 2).join(" "));
  }
  const unique = [...new Set(phrases)];
  return unique.slice(0, 15);
}

const learnedPatternsCache = new Map<number, { patterns: string[]; expiry: number }>();

function clearLearnedPatternsCache(botConfigId: number) {
  learnedPatternsCache.delete(botConfigId);
}

async function getLearnedPatterns(botConfigId: number): Promise<string[]> {
  const cached = learnedPatternsCache.get(botConfigId);
  if (cached && Date.now() < cached.expiry) return cached.patterns;
  const records = await storage.getReportedScamPatterns(botConfigId);
  const patterns = records.map(r => r.pattern);
  learnedPatternsCache.set(botConfigId, { patterns, expiry: Date.now() + 5 * 60 * 1000 });
  return patterns;
}

function checkLearnedPatterns(normalizedText: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const lower = normalizedText.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  let matchCount = 0;
  for (const pattern of patterns) {
    if (lower.includes(pattern)) {
      matchCount++;
      if (matchCount >= 3) return true;
    }
  }
  return false;
}

async function aiScamCheck(text: string, senderRole: string): Promise<{ isScam: boolean; reason: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You are an aggressive scam detection system for a crypto/Web3 Telegram group. The sender is a REGULAR USER (not an admin). Your job is to PROTECT the community. When in doubt, flag as scam — false positives are better than letting scams through.

A message IS a SCAM/SPAM if it does ANY of these:
- Poses as project leadership or makes official-sounding announcements (migrations, relaunches, contract changes, new CAs, airdrops, etc.)
- Asks people to DM/PM/inbox/contact/message them privately for ANY reason
- Uses "drop me a private message", "send me a message", "reach out to me", "contact me privately" or similar
- Asks for transaction hashes, wallet addresses, private keys, seed phrases, or screenshots of purchases
- Promotes fake airdrops, token swaps, or contract migrations
- Mentions "migration", "airdrop", "recover loss", "boost volume" — regular users don't announce these
- Asks people to connect wallets or click suspicious links
- Offers guaranteed returns, paid promotions, or investment services
- Creates false urgency (act now, limited time, within X hours)
- Promotes other tokens/projects unsolicited (shilling)
- Posts pump hype / financial shill content: multiplier claims (50x, 100x), "low-cap gems", "whales rotating in", "plays loading", "about to moon/explode", FOMO language — regular users don't post unsolicited investment hype
- Shares links to other Telegram groups, channels, or bots
- Offers services like "I can get you investors/listings/volume"
- Offers ANY unsolicited services: design, animation, NFTs, logos, banners, stickers, GIFs, marketing, promotion, community management, development, etc.
- Cold-pitches services nobody asked for (e.g. "I'd love to create X for your project", "I can make Y for you", "I offer Z services")
- Uses flattery followed by a pitch (e.g. "Love your project! I can create...", "Great community! I offer...")
- Claims to own/run a community/group/channel and offers services
- Pitches any kind of paid or free service to the group unsolicited
- Uses homoglyph evasion (replacing letters with look-alikes like I for l, 0 for O) — this is ALWAYS a scam indicator

CRITICAL — GIVEAWAY SCAMS (ALWAYS flag these):
- Any message offering to give/send/distribute crypto (SOL, ETH, BTC, tokens, etc.) to group members — this is ALWAYS a scam
- "I want to give some SOL to the first 5 members" → SCAM
- "Giving away ETH to the community" → SCAM  
- "Contact me with your wallet address" → SCAM
- "First X people to DM/contact/message me get free crypto" → SCAM
- ANY variation of "I will give/send/distribute crypto to people who contact me" → SCAM
- Regular users NEVER legitimately distribute crypto in group chats

EXAMPLES OF SCAMS (flag these):
- "HEY GUYS I WANT TO GIVE SOME SOL TO THE FIRST 5 MEMBERS OF THIS GROUP TO CONTACT ME WITH SOL ADDRESS" → SCAM (crypto giveaway scam)
- "gonna send some BTC to the first 3 holders who reach out" → SCAM (crypto giveaway scam)
- "Love your project! I'd love to create custom 2D/3D crypto meme animations using your mascot" → SCAM (unsolicited service offer)
- "Am working on migration and airdropping of all holders" → SCAM (impersonating authority, fake migration)  
- "Drop me a private message with your tx hash" → SCAM (DM solicitation + asking for tx data)
- "I can design NFTs, logos, banners for your project" → SCAM (unsolicited service pitch)
- "Great project! DM me for promotion services" → SCAM (flattery + service pitch)
- "I'm giving away 1000 USDT to the first 10 people who message me" → SCAM (giveaway scam)
- "I'm eyeing a few low-cap gems that could 50-100x once the whales start rotating in" → SCAM (pump hype / financial shill)
- "New plays loading… don't sleep on this one, about to explode 🔥💸" → SCAM (pump hype / FOMO)

A message is NOT a scam if it's:
- A normal question or discussion about the project
- General crypto discussion without solicitation
- Complaints or criticism (even harsh ones)
- Casual chat, memes, or banter
- Asking about project status WITHOUT making announcements
- Sharing a link directly relevant to an ongoing conversation (not unsolicited)

Respond with ONLY valid JSON: {"scam": true, "reason": "brief explanation"} or {"scam": false, "reason": "brief explanation"}`
        },
        { role: "user", content: text }
      ],
      max_completion_tokens: 100,
    }, { signal: controller.signal as any });

    clearTimeout(timeout);

    const content = response.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        log(`AI scam verdict: ${parsed.scam ? "SCAM" : "OK"} — ${parsed.reason || "no reason"} — msg: "${text.substring(0, 60)}"`, "telegram");
        return { isScam: !!parsed.scam, reason: parsed.reason || "" };
      } catch {}
    }
    log(`AI scam check returned unparseable response: ${content.substring(0, 100)}`, "telegram");
    return { isScam: false, reason: "unparseable" };
  } catch (e: any) {
    log(`AI scam check failed: ${e.message}`, "telegram");
    return { isScam: false, reason: "error" };
  }
}

async function executeScamAction(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  userId: string,
  botConfigId: number,
  groupRecord: any,
  reason: string
): Promise<boolean> {
  log(`SCAM DETECTED from ${userName} (${reason}): ${text.substring(0, 100)}`, "telegram");

  const tgUserId = msg.from?.id ? String(msg.from.id) : undefined;

  let deleted = false;
  try {
    await bot.deleteMessage(msg.chat.id, msg.message_id);
    deleted = true;
    log(`Deleted scam message from ${userName}`, "telegram");
  } catch (e: any) {
    log(`Could not delete scam message (bot may not be admin): ${e.message}`, "telegram");
  }

  if (!deleted) {
    try {
      await sendBotMessage(bot, msg.chat.id, `⚠️ Warning: The message above from ${userName} looks like a scam/spam. Do NOT click links, send crypto, or DM anyone offering tokens.`);
    } catch (e: any) {
      log(`Could not send scam warning: ${e.message}`, "telegram");
    }
  }

  if (groupRecord) {
    await storage.createActivityLog(botConfigId, userId, {
      groupId: groupRecord.id,
      type: "report",
      telegramUserId: tgUserId,
      userName,
      userMessage: text,
      botResponse: deleted ? "(silently deleted)" : "(warned — could not delete)",
      isReport: true,
      metadata: { autoDetected: true, reason },
    });
  }

  if (tgUserId && deleted) {
    try {
      const config = await storage.getBotConfig(botConfigId);
      if (config && config.autoBanThreshold > 0) {
        const scamCount = await storage.getScamCountForUser(botConfigId, tgUserId);
        if (scamCount >= config.autoBanThreshold) {
          await bot.banChatMember(msg.chat.id, Number(tgUserId));
          log(`AUTO-BANNED user ${userName} (tgId: ${tgUserId}) after ${scamCount} scam deletions (threshold: ${config.autoBanThreshold})`, "telegram");
          if (groupRecord) {
            await storage.createActivityLog(botConfigId, userId, {
              groupId: groupRecord.id,
              type: "report",
              telegramUserId: tgUserId,
              userName,
              userMessage: `Auto-banned after ${scamCount} scam messages`,
              botResponse: "(user banned)",
              isReport: true,
              metadata: { autoDetected: true, reason: `Auto-ban: ${scamCount} scam deletions reached threshold of ${config.autoBanThreshold}` },
            });
          }
        }
      }
    } catch (e: any) {
      log(`Auto-ban check/action failed for ${userName}: ${e.message}`, "telegram");
    }
  }

  return true;
}

const HOMOGLYPH_MAP: Record<string, string> = {
  '\u0410': 'A', '\u0430': 'a', '\u0412': 'B', '\u0421': 'C', '\u0441': 'c',
  '\u0415': 'E', '\u0435': 'e', '\u041D': 'H', '\u043E': 'o', '\u041E': 'O',
  '\u0420': 'P', '\u0440': 'p', '\u0422': 'T', '\u0443': 'y', '\u0425': 'X',
  '\u0445': 'x', '\u0417': '3', '\u0456': 'i', '\u0406': 'I',
  '\u0131': 'i', '\u0130': 'I',
  '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
  '\u2013': '-', '\u2014': '-',
  '\u200B': '', '\u200C': '', '\u200D': '', '\uFEFF': '', '\u00AD': '',
  '\u2060': '', '\u180E': '',
  '\u00B0': ' ', '\u00B7': ' ', '\u2022': ' ', '\u2023': ' ', '\u2043': ' ',
  '\u25E6': ' ', '\u2219': ' ', '\u22C5': ' ', '\u2027': ' ',
  '\u2024': '.', '\u2025': '..', '\u2026': '...',
  '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2004': ' ', '\u2005': ' ',
  '\u2006': ' ', '\u2007': ' ', '\u2008': ' ', '\u2009': ' ', '\u200A': ' ',
  '\u202F': ' ', '\u205F': ' ', '\u3000': ' ',
  '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
  '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7',
  '\u2078': '8', '\u2079': '9',
  '\u2080': '0', '\u2081': '1', '\u2082': '2', '\u2083': '3',
  '\u2084': '4', '\u2085': '5', '\u2086': '6', '\u2087': '7',
  '\u2088': '8', '\u2089': '9',
  '\uFF10': '0', '\uFF11': '1', '\uFF12': '2', '\uFF13': '3',
  '\uFF14': '4', '\uFF15': '5', '\uFF16': '6', '\uFF17': '7',
  '\uFF18': '8', '\uFF19': '9',
  '\u2500': '-', '\u2501': '-', '\u2502': '|', '\u2503': '|',
  '\uFE4D': '_', '\uFE4E': '_', '\uFE4F': '_',
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '-',
  '\uFE58': '-', '\uFE63': '-', '\uFF0D': '-',
};

function fixHomoglyphWords(text: string): string {
  return text.replace(/\b\w+\b/g, (word) => {
    const lower = word.toLowerCase();
    if (/[A-Z]/.test(word) && /[a-z]/.test(word)) {
      const fixed = word
        .replace(/I(?=[a-z])/g, 'l')
        .replace(/(?<=[a-z])I/g, 'l');
      if (fixed !== word) return fixed;
    }
    const allLower = lower
      .replace(/0/g, 'o')
      .replace(/1/g, 'l')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/5/g, 's')
      .replace(/\$/g, 's');
    if (allLower !== lower) {
      return word.length === lower.length ? allLower : word;
    }
    return word;
  });
}

function normalizeUnicode(text: string): string {
  const ranges: [number, number, number][] = [
    [0x1D400, 0x1D419, 0x41], [0x1D41A, 0x1D433, 0x61],
    [0x1D434, 0x1D44D, 0x41], [0x1D44E, 0x1D467, 0x61],
    [0x1D468, 0x1D481, 0x41], [0x1D482, 0x1D49B, 0x61],
    [0x1D49C, 0x1D4B5, 0x41], [0x1D4B6, 0x1D4CF, 0x61],
    [0x1D4D0, 0x1D4E9, 0x41], [0x1D4EA, 0x1D503, 0x61],
    [0x1D504, 0x1D51D, 0x41], [0x1D51E, 0x1D537, 0x61],
    [0x1D538, 0x1D551, 0x41], [0x1D552, 0x1D56B, 0x61],
    [0x1D56C, 0x1D585, 0x41], [0x1D586, 0x1D59F, 0x61],
    [0x1D5A0, 0x1D5B9, 0x41], [0x1D5BA, 0x1D5D3, 0x61],
    [0x1D5D4, 0x1D5ED, 0x41], [0x1D5EE, 0x1D607, 0x61],
    [0x1D608, 0x1D621, 0x41], [0x1D622, 0x1D63B, 0x61],
    [0x1D63C, 0x1D655, 0x41], [0x1D656, 0x1D66F, 0x61],
    [0x1D670, 0x1D689, 0x41], [0x1D68A, 0x1D6A3, 0x61],
    [0xFF21, 0xFF3A, 0x41], [0xFF41, 0xFF5A, 0x61],
    [0x24B6, 0x24CF, 0x41], [0x24D0, 0x24E9, 0x61],
  ];

  let result = "";
  for (const char of text) {
    if (HOMOGLYPH_MAP[char] !== undefined) {
      result += HOMOGLYPH_MAP[char];
      continue;
    }
    const cp = char.codePointAt(0)!;
    let mapped = false;
    for (const [start, end, base] of ranges) {
      if (cp >= start && cp <= end) {
        result += String.fromCharCode(base + (cp - start));
        mapped = true;
        break;
      }
    }
    if (!mapped) {
      result += char;
    }
  }
  result = result.replace(/\s{2,}/g, ' ').trim();
  result = result.replace(/\b([A-Za-z])\s+(?=[A-Za-z]\b)/g, '$1');
  result = result.replace(/(?<=[A-Za-z0-9])[.,;:!?]+(?=[A-Za-z0-9])/g, '');
  result = result.replace(/#(\w)/g, '$1');
  result = fixHomoglyphWords(result);
  return result;
}

function hasHomoglyphEvasion(original: string, normalized: string): boolean {
  if (original === normalized) return false;
  const ilSwaps = /[A-Z]/.test(original) && /I/.test(original);
  const origWords = original.split(/\s+/);
  const normWords = normalized.split(/\s+/);
  let letterSwaps = 0;
  for (let i = 0; i < Math.min(origWords.length, normWords.length); i++) {
    const ow = origWords[i];
    const nw = normWords[i];
    if (ow === nw || ow.length < 4) continue;
    const owClean = ow.replace(/[^a-zA-Z]/g, "");
    const nwClean = nw.replace(/[^a-zA-Z]/g, "");
    if (owClean.length === nwClean.length && owClean !== nwClean) {
      let diffs = 0;
      for (let j = 0; j < owClean.length; j++) {
        if (owClean[j] !== nwClean[j]) diffs++;
      }
      if (diffs > 0 && diffs <= 2) letterSwaps++;
    }
  }
  return ilSwaps && letterSwaps >= 2;
}

function checkNameImpersonation(msg: TelegramBot.Message, config: BotConfig): boolean {
  const senderName = (
    (msg.from?.first_name || "") + " " + (msg.from?.last_name || "")
  ).trim().toLowerCase();
  const senderUsername = (msg.from?.username || "").toLowerCase();
  const botName = (config.botName || "").toLowerCase().trim();
  const groupName = (msg.chat.title || "").toLowerCase().trim();

  if (!senderName && !senderUsername) return false;
  if (botName.length < 3 && groupName.length < 3) return false;

  const normalize = (s: string) => s.replace(/[^a-z0-9]/g, "");
  const senderNorm = normalize(senderName);
  const senderUserNorm = normalize(senderUsername);

  if (botName.length >= 3) {
    const botNorm = normalize(botName);
    if (botNorm.length >= 3 && (senderNorm.includes(botNorm) || senderUserNorm.includes(botNorm))) {
      return true;
    }
  }
  if (groupName.length >= 3) {
    const groupNorm = normalize(groupName);
    if (groupNorm.length >= 3 && (senderNorm.includes(groupNorm) || senderUserNorm.includes(groupNorm))) {
      return true;
    }
  }
  return false;
}

async function detectAndHandleScam(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  userId: string,
  botConfigId: number,
  config: BotConfig,
  groupRecord: any
): Promise<boolean> {
  try {
    const member = await bot.getChatMember(msg.chat.id, msg.from!.id);
    if (["creator", "administrator"].includes(member.status)) {
      return false;
    }
  } catch (e: any) {
    log(`Could not check sender role: ${e.message}`, "telegram");
  }

  const normalized = normalizeUnicode(text);
  if (normalized !== text) {
    log(`Unicode normalized: "${text.substring(0, 60)}" → "${normalized.substring(0, 60)}"`, "telegram");
  }

  const evasionDetected = hasHomoglyphEvasion(text, normalized);
  if (evasionDetected) {
    log(`Homoglyph evasion detected in message from ${userName}`, "telegram");
  }

  const isImpersonator = checkNameImpersonation(msg, config);
  if (isImpersonator) {
    log(`Name impersonation detected: "${userName}" mimics bot/group name`, "telegram");
  }

  const hasMigrationAirdropScam = /\b(migrat(ion|ing|e)|airdrop(ping|s)?)\b.{0,60}\b(holder|hoIder|volume|voIume|loss|Ioss|recover|boost|all)\b/i.test(normalized) ||
    /\b(recover|boost)\b.{0,30}\b(loss|volume|price)\b/i.test(normalized) ||
    /\b(drop\s*(event|alert|claim|link|distribution))\b.{0,60}\b(holder|member|exclusively|private|select)\b/i.test(normalized) ||
    (/\b(hosting|holding|launching|announcing)\b.{0,30}\b(drop|airdrop)\b/i.test(normalized) && /\b(holder|member|private|exclusive|select)\b/i.test(normalized)) ||
    /\b(working\s*on|announcing|starting)\s*(a\s*)?(migration|airdrop|token\s*swap|contract\s*change)\b/i.test(normalized) ||
    /\b(re\s*launch|relaunch)(ed|ing)?\b.{0,40}\b(token|contract|v2|v3)\b/i.test(normalized) ||
    (/1\s*:\s*1/.test(text) && /\btoken/i.test(text) && /\b(relaunch|re.?launch|recieve|receive|swap|migrat|airdrop|claim)\b/i.test(text)) ||
    (/\b(halt|apologiz|ceas|shut.?down|wind.?down|discontinu)\b/i.test(text) && /\btoken/i.test(text) && /\b(relaunch|re.?launch|recieve|receive|fairness|1\s*:\s*1)\b/i.test(text)) ||
    /\b(v2|v3)\s*(token|contract|launch|version)\b.{0,40}\b(swap|migrat|airdrop|claim|new\s*ca|clean\s*ca)\b/i.test(normalized) ||
    /\b(swap|exchange|convert)\s*(your\s*)?(old\s*)?(token|holding)\b.{0,40}\b(new|v2|v3|airdrop|claim)\b/i.test(normalized) ||
    /\b(new|clean)\s*(ca|contract\s*address)\b.{0,40}\b(swap|migrat|airdrop|token|claim|hold)\b/i.test(normalized) ||
    /\b(dm|pm|message|inbox|send)\b.{0,30}\b(proof|screenshot|address|wallet)\b.{0,30}\b(hold|token|airdrop|swap|claim)\b/i.test(normalized) ||
    /\b(hold|token|airdrop)\b.{0,30}\b(dm|pm|message|inbox|send)\b.{0,30}\b(proof|screenshot|address|wallet)\b/i.test(normalized) ||
    /\b(send|show|share)\b.{0,20}\b(screenshot|proof|address)\b.{0,30}\b(token|hold|buy|purchase|airdrop)\b/i.test(normalized);

  const hasPrivateMessageSolicitation = /\b(private\s*message|send\s*me\s*(a\s*)?(message|msg)|drop\s*(me\s*)?(a\s*)?(message|msg|line|dm|pm)|reach\s*out\s*to\s*me|contact\s*me\s*(privately|directly)|write\s*me\s*(a\s*)?(message|privately|directly))\b/i.test(normalized) ||
    /\b(private|direct)\s*(message|msg|chat)\b.{0,20}\b(with|your|tx|hash|screenshot|purchase)\b/i.test(normalized);

  const hasTxHashRequest = /\b(tx\s*hash|transaction\s*hash|screenshot\s*of\s*(your\s*)?(purchase|transaction|buy|tx)|proof\s*of\s*(purchase|transaction|buy))\b/i.test(normalized);

  const hasUnsolicitedServiceOffer =
    /\b(i('d| would)?\s*(love|like)\s*to\s*(create|make|design|build|develop|offer|support|help|assist|handle|manage))\b/i.test(normalized) ||
    /\b(i\s*(can|will|offer|provide|specialize|do)\s*(create|make|design|build|develop|custom|professional))\b/i.test(normalized) ||
    /\b(i\s*speciali[sz]e\s*in)\b.{0,40}\b(engag|moderat|communit|management|growth|fud|support|marketing|promot|discussion|organiz)/i.test(normalized) ||
    /\b(hire\s*me|my\s*services|my\s*portfolio|check\s*my\s*(work|portfolio|profile))\b/i.test(normalized) ||
    /\b(looking\s*for\s*(a\s*)?(designer|developer|animator|artist|creator)\s*\?\s*i)\b/i.test(normalized) ||
    /\b(alongside\s*your\s*(bot|team|mod|admin))\b/i.test(normalized) ||
    /\b(turn(ing)?\s*(passive|quiet|inactive)\s*(member|user|viewer)s?\s*into\s*(active|engag))/i.test(normalized) ||
    /\b(maximize|increase|drive|boost)\s*(engag|trust|growth|retention|activit)/i.test(normalized) && /\b(your\s*(community|group|project|channel)|i('d| would| can| will))\b/i.test(normalized);

  const hasCryptoServiceKeywords = /\b(nft|logo|banner|sticker|gif|animation|mascot|meme\s*(coin|token|animation)|dex\s*banner|coin\s*logo|token\s*logo|2d|3d)\b/i.test(normalized) &&
    /\b(creat|design|make|build|custom|your\s*(project|token|coin|mascot))\b/i.test(normalized);

  const hasFlattery = /\b(love\s*your|great\s*(project|community|token)|amazing\s*(project|community|token)|awesome\s*(project|community))\b/i.test(normalized);
  const hasServicePitch = /\b(creat|design|make|build|develop|offer|provid|along\s*with|services?)\b/i.test(normalized) &&
    /\b(nft|logo|banner|sticker|gif|animation|mascot|emoji|promot|market|listing|website|app|bot|smart\s*contract)\b/i.test(normalized);
  const hasFlatteryPitch = hasFlattery && hasServicePitch;

  const hasDmSolicitation = /\b(dm|pm|inbox|message|contact)\s*(me|us)\b|\bsend\s*(me\s*)?(a\s*)?(dm|pm|message)\b|\b(inbox|dm|pm)\b.*\b(for|me)\b|\bshould\s*(dm|pm|message|inbox)\b|\b(dm|pm)\s*(to|for)\s*(discuss|talk|chat|collaborate|partner|detail|info|more|inquir)/i.test(normalized);
  const hasSoftCollaborationInvite = /\b(let\s*me\s*know|reach\s*out|get\s*in\s*touch|open\s*to)\s*.{0,20}\b(collaborat|partner|work\s*together|discuss|interest)/i.test(normalized) ||
    /\b(who(m)?\s*should\s*i\s*contact|who(m)?\s*can\s*i\s*(talk|speak|reach)|who(m)?\s*(to|should\s*i)\s*(contact|message|reach))\b/i.test(normalized);
  const exchangeNames = /\b(binance|biconomy|okx|kucoin|bybit|gate\.?io|mexc|huobi|htx|bitget|bitmart|lbank|poloniex|crypto\.?com|coinbase|kraken|gemini|weex|xt\.?com|phemex|upbit|bithumb|bitfinex)\b/i;
  const hasFakeExchangeListing = (
    /\b(official\s*represent\w*|represent\w*\s*(of|from)|partner\s*(of|from)|agent\s*(of|from)|ambassador\s*(of|for|from)|(i'?m|we'?re|i\s*am|we\s*are)\s*.{0,15}(from|at|with))\b/i.test(normalized) && exchangeNames.test(normalized)
  ) || (
    exchangeNames.test(normalized) && /\b(listing\s*(proposal|cooperat|opportunit))\b/i.test(normalized) &&
    /\b(contact|whom|who|reach|discuss|dm|pm)\b/i.test(normalized)
  ) || (
    /\bverify\b.{0,30}\b(bio|identity)\b/i.test(normalized) && exchangeNames.test(normalized) &&
    /\b(official|represent\w*|partner|agent|ambassador|listing|contact)\b/i.test(normalized)
  );
  const serviceMenuKeywordsGlobal = /\b(sticker|logo|banner|meme|gif|emoji|animation|video|website|white\s*paper|whitepaper|buybot|buy\s*bot|drawing|promo|design|nft|mascot|flyer|poster|thumbnail|graphic|branding|merch)s?\b/ig;
  const serviceMenuCount = (normalized.match(serviceMenuKeywordsGlobal) || []).length;
  const hasDmServiceMenu = /\b(dm|pm|inbox|message|contact)\s*.{0,20}@\w+/i.test(normalized) && serviceMenuCount >= 2;
  const hasServiceListSpam = serviceMenuCount >= 3 && /\b(dm|pm|inbox|message|contact|order|hire|available|and\s*more)\b/i.test(normalized);
  const hasScamOffer = /\b(promot|promo\b|engag|market|listing|volume|investor|communit(y|ies).*\b(own|run|manag|lead)|(own|run|manag|lead).*\bcommunit(y|ies)|\d+\s*(eth|btc|usdt|bnb|sol)\b|free\s*(token|coin|airdrop|eth|btc|crypto)|guaranteed\s*(return|profit))\b/i.test(normalized);
  const wordNumbers = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|several|multiple|many|various|numerous|large|huge|big)/i;
  const channelManagementClaim = /\b(i\s+|we\s+)(manage|run|lead|operat|head|built)\w*\s+/i.test(normalized) &&
    (wordNumbers.test(normalized) || /\d+/.test(text)) &&
    /\b(channel|communit|group|chat)\w*\b/i.test(normalized);
  const channelManagementNoNumber = /\b(i\s+|we\s+)(manage|run|lead|operat|head)\w*\s+(active\s+|trusted\s+|large\s+|big\s+|whale\s+|crypto\s+|trading\s+|investor\s+)*(channel|communit|group|chat)/i.test(normalized);
  const marketingBuzzwords = /\b(engag|volume|growth|grow\s*(faster|quick)|mc\b|market\s*cap|investor|serious\s*investor|right\s*audience|sustain|expan|promot|boost|collaborat|partner|listing\s*cooperat)/i.test(normalized);
  const hasChannelManagementPitch = (channelManagementClaim || channelManagementNoNumber) && marketingBuzzwords;
  const hasColdPitchPromo = /\b(promo|promot(e|ion|ing)|market(ing)?|boost(ing)?|advertis(e|ing)|shill(ing)?)\s*.{0,30}\b(your|ur)\s*(project|token|coin|community|group|channel)\b/i.test(normalized) ||
    /\b(we\s*(will|can|offer|provide|do)|i\s*(will|can|offer|provide|do))\s*(promo|promot(e|ion|ing)|market(ing)?|boost(ing)?|advertis(e|ing)|shill(ing)?|trend(ing)?|list(ing)?)\s*.{0,20}\b(your|ur)\b/i.test(normalized) ||
    /\b(low\s*cost|cheap|affordable|best\s*price|discount|free\s*trial)\b.{0,40}\b(promo|promot|market|boost|advertis|listing|trending)/i.test(normalized) ||
    /\b(promo|promot|market|boost|advertis|listing|trending)\b.{0,40}\b(low\s*cost|cheap|affordable|best\s*price|discount|free\s*trial)/i.test(normalized) ||
    /\b(top|best|big|major)\s*(channel|group|platform)s?\b.{0,30}\b(low\s*cost|cheap|affordable|promo|promot|advertis)/i.test(normalized) ||
    (/\b(crypto\s*project|your\s*(project|token|coin|brand))\b/i.test(normalized) && /\b(growth|exposure|followers?|campaign|media\s*kit|viral)\b/i.test(normalized)) ||
    (/\b(elevat|grow|scale|skyrocket|supercharg|amplif|maximiz)\w*\s*(your|ur)\s*(crypto|project|token|coin|brand|community)\b/i.test(normalized)) ||
    (/\b(media\s*kit|rate\s*card|pricing\s*sheet)\b/i.test(normalized) && /\b(campaign|promo|promot|advertis|partner|collaborat)\b/i.test(normalized)) ||
    (/\b(partner\s*with)\b/i.test(normalized) && /\b(growth|exposure|followers?|viral|engag|massive|authentic)\b/i.test(normalized) && /\b(crypto|tiktok|twitter|youtube|influenc)\b/i.test(normalized)) ||
    (/\b\d+[\s,]*\d*(?:[kKmM])?\+?\s*(followers?|subscribers?|members?|audience|enthusiasts?)\b/i.test(text) && /\b(crypto|project|token|coin|campaign|promo|growth|exposure)\b/i.test(normalized) && /\b(partner|collaborat|promot|advertis|offer|provide|elevat|grow|boost|media\s*kit|campaign|viral|drop\s*(us|me)\s*(a\s*)?message)\b/i.test(normalized));
  const hasVolumeServiceSpam = (/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate|create|make|do|give|bring|get)\b/i.test(normalized) && /\b(volume|liquidity|trading|holders?|pin\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group)|check\s*out|support)\b/i.test(normalized)) ||
    (/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate)\b.{0,30}\b\d+[-–—]\d+k?\s*(volume|liquidity|holders?)\b/i.test(text)) ||
    (/\b(pin\s*post|pinned\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group))\b/i.test(normalized) && /\b(volume|support|promo|boost|service)\b/i.test(normalized));
  const hasTokenCallCard = (/0x[a-f0-9]{40}/i.test(text) && /\b(vol|volume|mc|market\s*cap|liq|liquidity)\b/i.test(text)) ||
    (/0x[a-f0-9]{40}/i.test(text) && /[+\-]\d+[\d.]*%/.test(text) && /\b(safety|score|audit)\b/i.test(text)) ||
    (/\b(vol|volume)\b.{0,15}\b(mc|market\s*cap)\b/i.test(text) && /\b(liq|liquidity)\b/i.test(text) && /[+\-]\d+[\d.]*%/.test(text) && (/0x[a-f0-9]{40}/i.test(text) || /[📊💹💰📋🔗]/.test(text))) ||
    (/\b(CA|contract)\b.{0,20}(0x[a-f0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/i.test(text) && /\b(vol|volume|mc|market\s*cap|liq|liquidity|pump)\b/i.test(text));
  const hasCryptoGiveawayScam = /\b(giv(e|ing)\s*(away|out|free|you|them|my))\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) ||
    /\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b.{0,40}\b(giv(e|ing)\s*(away|out|free))\b/i.test(normalized) ||
    /\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|give|free|win|claim|airdrop)\b/i.test(text) ||
    (/\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(dm|pm|message|inbox)\b/i.test(text) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|give|free|airdrop)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
    /\b(i\s*)?(will|am|'m|want\s*to|wanna|gonna|going\s*to)\s*(giv(e|ing)|send(ing)?|distribut(e|ing)|drop(ping)?)\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) ||
    (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b.{0,60}\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b/i.test(text) && /\b(give|send|dm|pm|message|contact|free|claim|win|airdrop)\b/i.test(normalized)) ||
    /\b(giv(e|ing)\s*(some|away|out|free|you|them|my|the))\b.{0,40}\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) ||
    /\b(contact|reach|hit)\s*me\b.{0,40}\b(sol|eth|btc|bnb|usdt|wallet|address|crypto)\b/i.test(normalized) && /\b(give|free|send|airdrop|first\s*\d+|claim)\b/i.test(text) ||
    /\b(not\s*interested\s*in\s*crypto|don'?t\s*(want|need)\s*(the\s*)?(crypto|sol|eth|btc))\b.{0,60}\b(dm|pm|message|give|free)\b/i.test(normalized) ||
    (/\bgiveaway\b/i.test(normalized) && /\b(dm|pm|message|inbox)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
    (/\b(dm|pm|message)\b/i.test(normalized) && /\b(get|gets|receive|claim|win)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text)) ||
    (/\b(first|frist)\s*(to\s*)?(dm|pm|message)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|free|giveaway|give)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
    (/\b(first\s*\d+)\b.{0,40}\b(dm|pm|message)\b/i.test(text) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text)) ||
    (/\b(free|giveaway)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text));
  const sexualEmojis = ['🍆', '🍑', '💦', '🔥', '🥵', '😈', '💋'];
  const hasSexualSpam = sexualEmojis.some(e => text.includes(e)) && /\b(inbox|dm|pm|message|contact|send)\b/i.test(normalized);
  const hasSolicitationSpam = /\b(inbox|dm|pm)\b/i.test(normalized) && /\b(fun|service|interest|offer|available)\b/i.test(normalized);

  const hasRaidShillSpam = /\b(raid\s*(team|group|squad|crew|service)s?|raid\s*team\s*of\s*\d+|shill(er)?s?\s*(team|group|squad|crew|service)s?|shill(er)?s?\s*to\s*boost|raider(s)?\s*(and|&)\s*shill(er)?s?|verified\s*(raider|shiller)s?|boost(ing)?\s*engag(ement|e)|engag(ement|e)\s*boost(ing|er|service|team|farm)?|free\s*test\s*run|paid\s*(raid|shill|promo|market)|hire\s*(raid|shill|market))\b/i.test(normalized);
  const hasPaidServiceSpam = /\b(growth\s*service|marketing\s*service|promotion\s*service|listing\s*service|trending\s*service|cmc\s*(list|trend)|coingecko\s*(list|trend)|dextools\s*trend|twitter\s*(raid|growth|boost)|telegram\s*(growth|member|boost))\b/i.test(normalized);
  const hasBoostBotPromo = /@\w*(boost|trend|trending|pump|volume|shill|raid)\w*bot\b/i.test(text) ||
    /\b(get|getting)\s*(us|a)\s*(a\s*)?(spot|listed|trending|featured)\b.{0,40}\b(bot|service|channel)\b/i.test(normalized) ||
    /\b(look\s*into|check\s*out|try|use)\b.{0,30}@\w*(boost|trend|pump|shill|raid)\w*/i.test(text);

  const hasTelegramLink = /t\.me\/[A-Za-z0-9_]+/i.test(text);
  const hasTelegramInviteLink = /(?:t\.me|telegram\.me)\/(\+|joinchat\/)[A-Za-z0-9_-]+/i.test(text);
  const hasGroupPromoShill = hasTelegramLink && (
    /\b(join|check\s*out|visit|come\s*to|head\s*to|look\s*at)\b/i.test(normalized) &&
    /\b(tag|follow|support|help|pls|please|guys|fam|fren|ape)\b/i.test(normalized)
  );
  const hasUnsolicitedGroupLink = hasTelegramLink && /\b(join\s*(us|our|my|this|the)|come\s*join|check\s*(this|my|our)|new\s*(group|channel|community))\b/i.test(normalized);

  const hasMultiplierClaim = /\b(\d{2,})\s*[-–—]?\s*(\d+)?\s*[xхΧχ×](?=\s|$|[^\w])|\b\d+[xхΧχ×]\s*(gain|return|profit|potential|move|play|gem|from\s*here)\b/i.test(text);
  const hasPumpHypeLanguage = /\b(low[\s-]*(cap|mc)\s*(gem|play|pick|token|coin)?|hidden\s*gems?|new\s*gems?|found\s*.{0,10}gems?|next\s*\d+x|next\s*(play|move|call|gem)|moon\s*(shot|play|bag)|whale|rotate|rotating|accumulating|load(ing|ed)\s*(up|bag)|eye(ing)?\s*(a\s*few|some|these)|ape[ds]?\s*(in|into|now|early|before|this|it)|degen\s*(play|call|move)|don'?t\s*(sleep|fade)|early\s*(entry|bird|call)|bag\s*(these|this|it|now)|about\s*to\s*(pop|explode|moon|pump|rip|run|send|fly|break\s*out)|fill\s*(your|ur)\s*bag|lfg+\b|something\s*(huge|big|massive)\s*(is\s*)?(coming|brewing|loading|cooking)|get\s*ready|plays?\s*loading|print(ing)?\s*(money|gains?)|gonna\s*(be\s*)?print(ing)?)\b/i.test(normalized);
  const hasEmojiDmSolicitation = /[📩📬📭📮✉💌📧]\s*(me|us|now)\b/i.test(text) || /\b(send|drop|shoot)\s*(a\s*)?[📩📬📭📮✉💌📧]/i.test(text);
  const hasFomoUrgency = /🔥.*💸|💸.*🔥|🚀.*💰|💰.*🚀|🚀\s*🚀|🔥\s*🔥|\b(before\s*(it'?s?\s*too\s*late|the\s*(pump|train|bus|ship)|whales|liftoff|breakout|everyone)|still\s*early|not\s*too\s*late|thank\s*me\s*later|you'?ll\s*regret|mark\s*my\s*words|remember\s*(this|i\s*told)|nfa\s*(but|tho|though)|this\s*is\s*(it|the\s*one)|train\s*leav(es|ing)|make\s*sure.{0,20}don'?t\s*miss|don'?t\s*miss\s*out|secure\s*(your|a|my)\s*(spot|place|position|allocation|slot))\b/i.test(normalized) || /🔥\s*🔥/i.test(text) || /\b(in\s*private)\b.{0,20}\b\d+x\b/i.test(text);
  const isForwardedMessage = !!msg.forward_date;
  const hasLowMcGemShill = /\b(low[\s-]*(cap|mc)|gems?)\b/i.test(normalized) && /\b(found|new|hidden|just\s*launched|launched)\b/i.test(normalized) && /\b(gem|mc|cap)\b/i.test(normalized);
  const hasFinancialShillHype = (hasMultiplierClaim && hasPumpHypeLanguage) ||
    (hasMultiplierClaim && hasFomoUrgency) ||
    (hasPumpHypeLanguage && hasFomoUrgency) ||
    hasLowMcGemShill ||
    (isForwardedMessage && (hasMultiplierClaim || hasPumpHypeLanguage || hasFomoUrgency));

  const hasDmWithUsername = /\b(dm|pm)\s*.{0,5}@\w+/i.test(normalized) && /\b(call|signal|insider|profit|trade|print|miss|join|part|sticker|logo|banner|design|animation|website|promo|nft|mascot|gif|emoji|video|meme|drawing|whitepaper|white\s*paper|branding|graphic)s?\b/i.test(normalized);
  const hasInsiderCallSpam = (/\b(insider|my\s*(call|signal)|vip\s*(call|group|channel|access)|paid\s*(call|group|signal)|fading\s*me)\b/i.test(normalized) && /\b(dm|pm)\s*.{0,10}@\w+/i.test(normalized)) || /\binsider\b.{0,20}\b(cook|member|call|signal|group)s?\b.{0,30}(print|profit|money|gain|earning)/i.test(normalized) || /\bdrop\s*(cook|call|signal)s?\b.{0,20}(print|profit|member)/i.test(normalized) || /\b(inner\s*circle|private\s*circle)\b.{0,40}(print|profit|\dx|\d+x\b|money|earning|gain)/i.test(normalized) || /\d+(\.\d+)?x\s*(done|profit|gain|made)\b.{0,30}\b(inner|circle|member|private)/i.test(normalized);
  const aggressiveDmRegex = /\b(dm\s*now|dm\s*me\s*now|send\s*(a\s*)?dm|check\s*(my\s*)?dm|kindly\s*(send|dm)|holders?\s*dm|dm\s*if\s*you|dm\s*for\s*(promo|promotion|detail|info|offer|deal|signal|call))\b/i;
  const hasAggressiveDmSpam = aggressiveDmRegex.test(normalized) || aggressiveDmRegex.test(text);
  const hasWalletBuyingSelling = (/\b(buy|sell|pay(ing)?)\b.{0,30}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|month|year)\b/i.test(normalized)) || (/\b(need|want|looking\s*for)\b.{0,15}\b(wall+ets?|accounts?)\b.{0,30}\b(history|transactions?|old|empty|aged|month|year)\b/i.test(normalized) && /\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm|\dsol|\deth)\b/i.test(normalized)) || /\b(old|empty|aged)\s*(wall+ets?|accounts?)\b.{0,60}\b(pay|buy|sell|solana|sol|eth|usdt|btc)\b/i.test(normalized) || (/\b(need|want|looking\s*for)\b.{0,10}\b(old|empty|aged)\b.{0,10}\b(wall+ets?|accounts?)\b/i.test(normalized) && /\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm)\b/i.test(normalized)) || (/\b(need|want)\b.{0,20}\b(wall+ets?|accounts?)\b.{0,60}\b(pay|buy|paying)\b/i.test(text) && /\d+\.?\d*\s*(sol|eth|usdt|btc|bnb)\b/i.test(text)) || (/\b(wall+ets?|accounts?)\s*(with|that\s*(has|have))\s*.{0,30}(transactions?|history|activit)/i.test(normalized) && /\b(pay|buy|sell|sol|eth|usdt|write\s*me|contact|dm|pm|\dsol|\deth|need|want)\b/i.test(normalized)) || (/\b(need|want|looking\s*for|buy)\b.{0,30}\b(solana|sol|eth|ethereum|crypto|btc|bitcoin)\b.{0,20}\b(wall+ets?|accounts?)\b/i.test(normalized) && /\b(pay|buy|\dsol|\deth|write\s*me|contact|dm|pm)\b/i.test(normalized));
  const hasPumpPromoSpam = /\b(pump|boost)\s*(your|ur)\s*(token|project|coin|mc|market\s*cap)\b/i.test(normalized) || /\b(i\s*(can|will)\s*(pump|boost|promote))\b.{0,40}\b(token|project|coin|mc|market\s*cap|profit)\b/i.test(normalized) || /\bpromotion\s*on\s*my\s*(telegram|channel|group)\b/i.test(normalized) || /\b(investor|holder)s?\s*(who\s*will|that\s*will|to)\s*(pump|buy|invest)/i.test(normalized) || /\b(contact|message|reach)\s*(me|us)\s*(in\s*)?(my\s*)?(inbox|dm|pm)\b.{0,30}\b(pump|promo|boost)/i.test(normalized);
  const hasInvestmentServicePitch =
    (/\b(i\s*help|we\s*help|i\s*connect|we\s*connect|we\s*unlock|i\s*unlock)\b/i.test(normalized) && /\b(otc|capital|fund(ing|s)?|institutional|strategic\s*(investor|buyer)|liquidity|market\s*disruption)\b/i.test(normalized)) ||
    /\b(are\s*you\s*open\s*(for|to))\b.{0,40}\b(otc|invest|capital|fund|partner)/i.test(normalized) ||
    /\b(otc\s*(capital|deal|invest|round|fund|buy|service|partner|opportunit))/i.test(normalized) && /\b(unlock|access|enabl|private|institutional|strategic)\b/i.test(normalized) ||
    /\b(unlock|access|secur)\b.{0,20}\$?\d+[km]?\s*[-–—]?\s*\$?\d*[km]?\s*(in\s*)?(capital|fund|invest|otc|liquidity)/i.test(normalized);

  const percentages = text.match(/\d+\s*%%?/g) || [];
  const hasAtHandleAtEnd = /@\w{3,}\s*$/.test(text.trim());
  const multiLine = text.split(/\n/).length >= 3;
  const hasRevenueSplitScam =
    (percentages.length >= 2 && hasAtHandleAtEnd && multiLine) ||
    (/\d+\s*(a|to|-|–|—)\s*\d+\s*(?:k|mil)\b/i.test(text) && percentages.length >= 1 && hasAtHandleAtEnd && multiLine);
  const checkmarkCount = (text.match(/✅/g) || []).length;
  const hasFormattedPitchScam = checkmarkCount >= 3 && hasAtHandleAtEnd && /[🚨💰⚠️❗]/.test(text) && multiLine;

  const learnedPatterns = await getLearnedPatterns(botConfigId);
  const hasLearnedPatternMatch = checkLearnedPatterns(normalized, learnedPatterns);

  const hasAnyScamSignal = hasMigrationAirdropScam || hasPrivateMessageSolicitation || hasTxHashRequest ||
    hasUnsolicitedServiceOffer || hasCryptoServiceKeywords || hasFlatteryPitch ||
    hasDmSolicitation || hasScamOffer || hasCryptoGiveawayScam || hasAggressiveDmSpam || hasEmojiDmSolicitation || hasPumpPromoSpam || hasBoostBotPromo ||
    hasDmServiceMenu || hasServiceListSpam || hasColdPitchPromo || hasVolumeServiceSpam || hasTokenCallCard || hasChannelManagementPitch || hasFakeExchangeListing || hasFinancialShillHype || hasInvestmentServicePitch || hasRevenueSplitScam || hasFormattedPitchScam || hasLearnedPatternMatch;
  if (evasionDetected && hasAnyScamSignal) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Homoglyph evasion with scam content (character substitution to bypass filters)");
  }
  if (evasionDetected) {
    log(`Homoglyph evasion without scam keywords — escalating to AI check`, "telegram");
  }
  if (isImpersonator && (hasMigrationAirdropScam || hasPrivateMessageSolicitation || hasDmSolicitation)) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Impersonation + scam (name mimics bot/group)");
  }
  if (hasMigrationAirdropScam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Fake migration/airdrop scam");
  }
  if (hasPrivateMessageSolicitation || (hasDmSolicitation && hasTxHashRequest)) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "DM solicitation / tx hash phishing");
  }
  if (hasFlatteryPitch || hasCryptoServiceKeywords || hasUnsolicitedServiceOffer) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Unsolicited service offer / cold-pitch spam");
  }
  if (hasDmServiceMenu || hasServiceListSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "DM service menu spam (unsolicited service listing)");
  }
  if (hasColdPitchPromo) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Cold-pitch promotion / paid promo service offer");
  }
  if (hasVolumeServiceSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Volume/liquidity service spam (unsolicited paid service)");
  }
  if (hasTokenCallCard) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Token call card spam (contract address + market data shill)");
  }
  if (hasChannelManagementPitch) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Channel/community management cold-pitch spam");
  }
  if (hasFakeExchangeListing) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Fake exchange listing impersonation scam");
  }
  if (hasSoftCollaborationInvite && (hasChannelManagementPitch || hasScamOffer || hasColdPitchPromo)) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Soft collaboration invite with scam/promo pitch");
  }
  if (hasAggressiveDmSpam || hasDmWithUsername) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Aggressive DM solicitation spam");
  }
  if (hasInsiderCallSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Insider trading / paid call scam");
  }
  if (hasWalletBuyingSelling) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Wallet buying/selling scam");
  }
  if (hasCryptoGiveawayScam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Crypto giveaway / free token scam");
  }
  if (hasDmSolicitation && (hasScamOffer || hasChannelManagementPitch)) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "DM solicitation with scam/promo offer");
  }
  if (hasSexualSpam || hasSolicitationSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Solicitation/adult spam");
  }
  if (hasTelegramInviteLink) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Unsolicited Telegram invite link spam");
  }
  if (hasGroupPromoShill || hasUnsolicitedGroupLink) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Telegram group/channel promotion spam");
  }
  if (hasRaidShillSpam || hasPaidServiceSpam || hasBoostBotPromo) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Raid/shill/boost bot promotion spam");
  }
  if (hasPumpPromoSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Token pump / paid promotion service offer");
  }
  if (hasFinancialShillHype) {
    const fwdTag = isForwardedMessage ? " [forwarded]" : "";
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, `Financial shill / pump hype spam${fwdTag} (multiplier claims + hype language)`);
  }
  if (hasInvestmentServicePitch) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Unsolicited OTC / investment service pitch");
  }
  if (hasRevenueSplitScam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Revenue split scam — percentage split pitch with contact handle");
  }
  if (hasFormattedPitchScam) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Formatted scam pitch — checkmark bullet list with urgency emojis and contact handle");
  }
  if (hasLearnedPatternMatch) {
    return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "Matched previously reported scam pattern (learned from /report)");
  }
  const hasUrl = /https?:\/\/|t\.me\//i.test(text);
  const hasCryptoKeywords = /\b(sol|eth|btc|bnb|usdt|usdc|crypto|token|coin|nft|wallet|airdrop|giveaway|give\s*away|migration|migrat(e|ing)|swap|dex|defi|staking|stake|yield|liquidity|rug|pump|dump|shill|raid|shitcoin|memecoin|meme\s*coin|presale|pre\s*sale|whitelist|white\s*list|seed\s*phrase|private\s*key|contract\s*address|ca\b|mint|bridge|chain|blockchain|web3|solana|ethereum|bitcoin|tether|binance|phantom|metamask|ledger|trezor)\b/i.test(normalized);
  const hasDmKeywords = /\b(dm|pm|inbox|private\s*message|contact\s*me|reach\s*out|message\s*me|send\s*me|write\s*me|hit\s*me\s*up)\b/i.test(normalized);
  const hasFinancialKeywords = /\b(invest|profit|trading|signal|call|insider|roi|return|earn|income|passive|guarantee|risk\s*free|double\s*your|triple\s*your|x\d+|\d+[xхΧχ×]\b|moon|lambo)\b/i.test(normalized);
  const needsAiCheck = hasUrl || hasCryptoKeywords || hasDmKeywords || hasFinancialKeywords || isImpersonator || evasionDetected;
  if (!needsAiCheck && normalized.length < MIN_SCAM_CHECK_LENGTH) {
    return false;
  }

  const aiContext = isImpersonator
    ? `[SUSPICIOUS: This user's display name "${userName}" closely matches the bot/group name. Non-admins impersonating official accounts is a common scam tactic. Be extra vigilant.]\n\n${normalized}`
    : normalized;
  const { isScam, reason } = await aiScamCheck(aiContext, "regular_user");
  if (!isScam) {
    if ((reason === "unparseable" || reason === "error") && (hasSoftCollaborationInvite || hasDmSolicitation || hasFakeExchangeListing || hasChannelManagementPitch || hasFinancialShillHype || hasInvestmentServicePitch)) {
      log(`AI failed but strong scam signals present — flagging as scam`, "telegram");
      return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, "AI unavailable + strong scam signals detected");
    }
    return false;
  }

  const aiReason = isImpersonator ? `AI (impersonator): ${reason}` : `AI: ${reason}`;
  return await executeScamAction(bot, msg, text, userName, userId, botConfigId, groupRecord, aiReason);
}

async function handleMessage(msg: TelegramBot.Message, instance: BotInstance) {
  try {
    const msgText = msg.text || msg.caption;
    if (!msgText || !msg.chat || msg.chat.type === "private") {
      log(`Message skipped: no text, no chat, or private chat`, "telegram");
      return;
    }
    if (msg.from?.is_bot) return;

    const { bot, userId, botConfigId } = instance;
    log(`Message from ${msg.from?.first_name || "Unknown"}${msg.forward_date ? " [forwarded]" : ""} in "${msg.chat.title || "?"}" (user: ${userId}, bot: ${botConfigId}): "${msgText.substring(0, 80)}"`, "telegram");

    const config = await storage.getBotConfig(botConfigId);
    if (!config || !config.isActive) {
      log(`Bot inactive or no config for bot ${botConfigId}`, "telegram");
      return;
    }

    const chatId = msg.chat.id.toString();
    const userName = msg.from?.first_name || msg.from?.username || "Unknown";
    const messageText = msgText;

    const group = await storage.getGroupByChatId(botConfigId, chatId);
    if (!group) {
      const memberCount = await bot.getChatMemberCount(msg.chat.id).catch(() => 0);
      await storage.upsertGroup(botConfigId, userId, {
        telegramChatId: chatId,
        name: msg.chat.title || "Unknown",
        memberCount,
        isActive: true,
      });
    }
    const groupRecord = await storage.getGroupByChatId(botConfigId, chatId);

    if (messageText.startsWith("/")) {
      const handled = await handleCommand(bot, msg, config, groupRecord, userId, botConfigId, instance);
      if (handled) return;
    }

    const scamDetected = await detectAndHandleScam(bot, msg, messageText, userName, userId, botConfigId, config, groupRecord);
    if (scamDetected) {
      log(`Scam detected from ${userName} — handled`, "telegram");
      return;
    }

    const deleteHandled = await handleDeleteRequest(bot, msg, messageText, userName, instance);
    if (deleteHandled) return;

    const isReport = checkIfReport(messageText, config);
    if (isReport && config.trackReports) {
      await storage.createActivityLog(botConfigId, userId, {
        groupId: groupRecord?.id || null,
        type: "report",
        userName,
        userMessage: messageText,
        botResponse: null,
        isReport: true,
        metadata: null,
      });
    }

    const shouldRespond = await shouldBotRespond(msg, config, instance);
    if (!shouldRespond) {
      log(`Not responding (mention/reply rules) to "${messageText.substring(0, 40)}" from ${userName}`, "telegram");
      return;
    }

    const tgUserId = msg.from?.id?.toString() || "unknown";
    const cooldownKey = `${chatId}:${tgUserId}`;
    const now = Date.now();
    const lastResponse = cooldowns.get(cooldownKey) || 0;
    if (now - lastResponse < config.cooldownSeconds * 1000) {
      log(`Cooldown active for ${userName} (${Math.round((config.cooldownSeconds * 1000 - (now - lastResponse)) / 1000)}s left)`, "telegram");
      return;
    }

    log(`Generating AI response for ${userName} in "${groupRecord?.name || "?"}"...`, "telegram");

    try {
      let replyContext: string | null = null;
      let replyIsFromBot = false;
      if (msg.reply_to_message?.text) {
        replyIsFromBot = msg.reply_to_message.from?.id === instance.botTelegramId;
        const replyAuthor = replyIsFromBot
          ? config.botName
          : (msg.reply_to_message.from?.first_name || msg.reply_to_message.from?.username || "Someone");
        replyContext = `${replyAuthor} said: ${msg.reply_to_message.text}`;
      }

      const response = await generateAIResponse(botConfigId, messageText, userName, config, groupRecord?.name || "Unknown", instance.botUsername, replyContext, replyIsFromBot);
      log(`AI response for ${userName}: "${(response || "").substring(0, 60)}..."`, "telegram");

      if (response && response.trim() && response.trim() !== "[[SKIP]]") {
        await sendBotMessage(bot, msg.chat.id, response, msg.message_id);
        log(`Reply sent to ${userName} in chat ${chatId}`, "telegram");
        cooldowns.set(cooldownKey, now);

        await storage.createActivityLog(botConfigId, userId, {
          groupId: groupRecord?.id || null,
          type: "response",
          userName,
          userMessage: messageText,
          botResponse: response,
          isReport: false,
          metadata: null,
        });
      } else if (response && response.trim() === "[[SKIP]]") {
        log(`AI chose to skip message from ${userName}`, "telegram");
      } else if (!response || !response.trim()) {
        log(`AI returned empty response for ${userName} — sending fallback`, "telegram");
        await sendBotMessage(bot, msg.chat.id, "Sorry, I couldn't process that. Try asking again.", msg.message_id);
      }
    } catch (err: any) {
      log(`Error generating response for ${userName}: ${err.message}\n${err.stack || ""}`, "telegram");
      try {
        await sendBotMessage(bot, msg.chat.id, "Something went wrong processing your message. Try again in a moment.", msg.message_id);
      } catch (_) {}
    }
  } catch (outerErr: any) {
    log(`CRITICAL: Unhandled error processing message: ${outerErr.message}\n${outerErr.stack || ""}`, "telegram");
  }
}

async function handleDeleteRequest(bot: TelegramBot, msg: TelegramBot.Message, text: string, userName: string, instance: BotInstance): Promise<boolean> {
  const isMentioned = text.includes(`@${instance.botUsername}`);

  if (!isMentioned) return false;

  const deletePattern = /\b(delete|remove|del)\s*(this|that|it|the\s*message|msg)?\b/i;
  if (!deletePattern.test(text)) return false;

  if (!msg.reply_to_message) {
    await sendBotMessage(bot, msg.chat.id, "Reply to the message you want me to delete.", msg.message_id);
    return true;
  }

  try {
    await bot.deleteMessage(msg.chat.id, msg.reply_to_message.message_id);
    await bot.deleteMessage(msg.chat.id, msg.message_id);
  } catch (e: any) {
    await sendBotMessage(bot, msg.chat.id, "I don't have permission to delete that message — make sure I'm an admin with delete rights.", msg.message_id);
  }
  return true;
}

async function sendBotMessage(bot: TelegramBot, chatId: number | string, text: string, replyToMessageId?: number) {
  const opts: TelegramBot.SendMessageOptions = {};
  if (replyToMessageId) opts.reply_to_message_id = replyToMessageId;
  opts.parse_mode = "Markdown";
  try {
    await bot.sendMessage(chatId, text, opts);
  } catch {
    delete opts.parse_mode;
    await bot.sendMessage(chatId, text, opts);
  }
}

async function handleCommand(bot: TelegramBot, msg: TelegramBot.Message, config: BotConfig, groupRecord: any, userId: string, botConfigId: number, instance: BotInstance): Promise<boolean> {
  const text = msg.text || "";
  const chatId = msg.chat.id;
  const userName = msg.from?.first_name || msg.from?.username || "Unknown";
  const botUsername = instance.botUsername;

  const cmdMatch = text.match(/^\/(\w+)(?:@(\w+))?(?:\s+([\s\S]*))?$/);
  if (!cmdMatch) return false;

  const command = cmdMatch[1].toLowerCase();
  const targetBot = cmdMatch[2];
  const args = cmdMatch[3]?.trim() || "";

  if (targetBot && targetBot.toLowerCase() !== botUsername.toLowerCase()) return false;

  if (command === "start") {
    let intro = `Hi! I'm *${config.botName}*, the assistant bot for this group.`;
    if (config.globalContext?.trim()) {
      const summary = config.globalContext.slice(0, 300);
      const ellipsis = config.globalContext.length > 300 ? "..." : "";
      intro += `\n\n${summary}${ellipsis}`;
    }
    intro += `\n\nType /help to see what I can do.`;
    await sendBotMessage(bot, chatId, intro, msg.message_id);
    await storage.createActivityLog(botConfigId, userId, {
      groupId: groupRecord?.id || null,
      type: "command",
      userName,
      userMessage: "/start",
      botResponse: intro,
      isReport: false,
      metadata: null,
    });
    return true;
  }

  if (command === "help") {
    const helpText = `*Available Commands:*

/start — Introduction and project overview
/help — Show this list of commands
/report — Reply to a message with /report to flag it for review

*Other ways to interact:*
• Mention me with @${botUsername} to ask a question
• Reply to my messages to continue a conversation
• In smart mode, I only respond when mentioned or replied to`;
    await sendBotMessage(bot, chatId, helpText, msg.message_id);
    await storage.createActivityLog(botConfigId, userId, {
      groupId: groupRecord?.id || null,
      type: "command",
      userName,
      userMessage: "/help",
      botResponse: helpText,
      isReport: false,
      metadata: null,
    });
    return true;
  }

  if (command === "report") {
    await handleReportCommand(bot, msg, config, groupRecord, userName, args, userId, botConfigId, instance);
    return true;
  }

  return false;
}

function runDeterministicScamCheck(text: string): { isScam: boolean; reason: string } {
  const normalized = normalizeUnicode(text);

  if ((/\b(buy|sell|pay)\b.{0,30}\b(wall+et|account)\b.{0,30}\b(history|transactions?|old|empty|aged|month|year)\b/i.test(normalized)) || (/\b(need|want|looking\s*for)\b.{0,15}\b(wall+et|account)\b.{0,30}\b(history|transactions?|old|empty|aged|month|year)\b/i.test(normalized) && /\b(pay|buy|sol|eth|usdt|write\s*me|contact|dm|pm|\dsol|\deth)\b/i.test(normalized)) || /\b(old|empty|aged)\s*(wall+et|account)\b.{0,30}\b(pay|buy|sell|solana|sol|eth|usdt|btc)\b/i.test(normalized) || (/\b(wall+et|account)\s*(with|that\s*(has|have))\s*.{0,30}(transactions?|history|activit)/i.test(normalized) && /\b(pay|buy|sell|sol|eth|usdt|write\s*me|contact|dm|pm|\dsol|\deth|need|want)\b/i.test(normalized)) || (/\b(need|want|looking\s*for|buy)\b.{0,30}\b(solana|sol|eth|ethereum|crypto|btc|bitcoin)\b.{0,20}\b(wall+et|account)\b/i.test(normalized) && /\b(pay|buy|\dsol|\deth|write\s*me|contact|dm|pm)\b/i.test(normalized))) {
    return { isScam: true, reason: "Wallet buying/selling scam — attempting to purchase crypto wallets with transaction history" };
  }

  if (/\b(airdrop|claim|free\s*(token|coin|nft|crypto)|migration|connect\s*(your\s*)?wallet)\b/i.test(normalized) && /https?:\/\//i.test(text)) {
    return { isScam: true, reason: "Airdrop/migration scam with suspicious link" };
  }

  const exchangeNames = /\b(binance|biconomy|okx|kucoin|bybit|gate\.?io|mexc|huobi|htx|bitget|bitmart|lbank|poloniex|crypto\.?com|coinbase|kraken|gemini|weex|xt\.?com|phemex|upbit|bithumb|bitfinex)\b/i;
  if ((/\b(official\s*represent\w*|represent\w*\s*(of|from)|partner\s*(of|from)|agent\s*(of|from)|ambassador\s*(of|for|from))\b/i.test(normalized) && exchangeNames.test(normalized)) ||
      (exchangeNames.test(normalized) && /\b(listing\s*(proposal|cooperat|opportunit))\b/i.test(normalized) && /\b(contact|whom|who|reach|discuss|dm|pm)\b/i.test(normalized))) {
    return { isScam: true, reason: "Fake exchange listing impersonation" };
  }

  if (/\b(dm|pm|inbox|message|contact)\s*(me|us)\b/i.test(normalized) && (/\b(promo|market|boost|pump|shill|volume|listing|invest|fund|capital|otc)\b/i.test(normalized) || /\b(i\s*(can|will)\s*(help|boost|promote|pump|grow|increase))\b/i.test(normalized))) {
    return { isScam: true, reason: "Unsolicited service offer with DM solicitation" };
  }

  if (/\b(i\s*manage|managing)\b.{0,20}\b(channel|communit|group)s?\b/i.test(normalized) && /\b(engag|growth|volume|mc|market\s*cap|member|organic|promot)\b/i.test(normalized)) {
    return { isScam: true, reason: "Channel management cold-pitch spam" };
  }

  if ((/\b(crypto\s*project|your\s*(project|token|coin|brand))\b/i.test(normalized) && /\b(growth|exposure|followers?|campaign|media\s*kit|viral)\b/i.test(normalized)) ||
      (/\b(elevat|grow|scale|skyrocket|supercharg|amplif|maximiz)\w*\s*(your|ur)\s*(crypto|project|token|coin|brand|community)\b/i.test(normalized)) ||
      (/\b(media\s*kit|rate\s*card|pricing\s*sheet)\b/i.test(normalized) && /\b(campaign|promo|promot|advertis|partner|collaborat)\b/i.test(normalized)) ||
      (/\b(partner\s*with)\b/i.test(normalized) && /\b(growth|exposure|followers?|viral|engag|massive|authentic)\b/i.test(normalized) && /\b(crypto|tiktok|twitter|youtube|influenc)\b/i.test(normalized)) ||
      (/\b\d+[\s,]*\d*(?:[kKmM])?\+?\s*(followers?|subscribers?|members?|audience|enthusiasts?)\b/i.test(text) && /\b(crypto|project|token|coin|campaign|promo|growth|exposure)\b/i.test(normalized) && /\b(partner|collaborat|promot|advertis|offer|provide|elevat|grow|boost|media\s*kit|campaign|viral|drop\s*(us|me)\s*(a\s*)?message)\b/i.test(normalized))) {
    return { isScam: true, reason: "Cold-pitch promotion / paid promo service offer" };
  }

  if ((/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate|create|make|do|give|bring|get)\b/i.test(normalized) && /\b(volume|liquidity|trading|holders?|pin\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group)|check\s*out|support)\b/i.test(normalized)) ||
      (/\b(i\s*(will|can)|we\s*(will|can))\s*(provide|offer|deliver|generate)\b.{0,30}\b\d+[-–—]\d+k?\s*(volume|liquidity|holders?)\b/i.test(text)) ||
      (/\b(pin\s*post|pinned\s*post)\b/i.test(normalized) && /\b(my\s*(community|channel|group))\b/i.test(normalized) && /\b(volume|support|promo|boost|service)\b/i.test(normalized))) {
    return { isScam: true, reason: "Volume/liquidity service spam — unsolicited paid service offer" };
  }

  if ((/0x[a-f0-9]{40}/i.test(text) && /\b(vol|volume|mc|market\s*cap|liq|liquidity)\b/i.test(text)) ||
      (/0x[a-f0-9]{40}/i.test(text) && /[+\-]\d+[\d.]*%/.test(text) && /\b(safety|score|audit)\b/i.test(text)) ||
      (/\b(vol|volume)\b.{0,15}\b(mc|market\s*cap)\b/i.test(text) && /\b(liq|liquidity)\b/i.test(text) && /[+\-]\d+[\d.]*%/.test(text) && (/0x[a-f0-9]{40}/i.test(text) || /[📊💹💰📋🔗]/.test(text))) ||
      (/\b(CA|contract)\b.{0,20}(0x[a-f0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/i.test(text) && /\b(vol|volume|mc|market\s*cap|liq|liquidity|pump)\b/i.test(text))) {
    return { isScam: true, reason: "Token call card spam — contract address + market data shill" };
  }

  const detPercentages = text.match(/\d+\s*%%?/g) || [];
  const detHasAtEnd = /@\w{3,}\s*$/.test(text.trim());
  const detMultiLine = text.split(/\n/).length >= 3;
  if (((detPercentages.length >= 2 && detHasAtEnd && detMultiLine) ||
      (/\d+\s*(a|to|-|–|—)\s*\d+\s*(?:k|mil)\b/i.test(text) && detPercentages.length >= 1 && detHasAtEnd && detMultiLine))) {
    return { isScam: true, reason: "Revenue split scam — percentage split pitch with contact handle" };
  }
  const detCheckmarks = (text.match(/✅/g) || []).length;
  if (detCheckmarks >= 3 && detHasAtEnd && /[🚨💰⚠️❗]/.test(text) && detMultiLine) {
    return { isScam: true, reason: "Formatted scam pitch — checkmark bullet list with urgency emojis and contact handle" };
  }

  if (/\b(send|give|transfer)\b.{0,15}\b(sol|eth|btc|usdt|crypto|token|nft)\b.{0,30}\b(receive|get|back|return|double|triple)\b/i.test(normalized)) {
    return { isScam: true, reason: "Crypto doubling/advance fee scam" };
  }

  if ((/\bgiveaway\b/i.test(normalized) && /\b(dm|pm|message|inbox)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
      (/\b(dm|pm|message)\b/i.test(normalized) && /\b(get|gets|receive|claim|win)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text)) ||
      (/\b(first|frist)\s*(to\s*)?(dm|pm|message)\b/i.test(normalized) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|free|giveaway|give)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
      (/\b(first\s*\d+)\b.{0,40}\b(dm|pm|message)\b/i.test(text) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text)) ||
      (/\b(first\s*\d+(\s*(lucky\s*)?(people|person|member|holder|user|follower)s?)?)\b.{0,60}\b(dm|pm|message|inbox)\b/i.test(text) && (/\b(sol|eth|btc|bnb|usdt|crypto|token|coin|nft|give|free|airdrop)\b/i.test(normalized) || /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) ||
      (/\b(free|giveaway)\b/i.test(normalized) && /\$?\d+\s*(sol|eth|btc|bnb|usdt)\b/i.test(text))) {
    return { isScam: true, reason: "Fake crypto giveaway scam — DM solicitation with free crypto lure" };
  }

  return { isScam: false, reason: "" };
}

async function handleReportCommand(bot: TelegramBot, msg: TelegramBot.Message, config: BotConfig, groupRecord: any, userName: string, args: string, userId: string, botConfigId: number, instance: BotInstance) {
  const chatId = msg.chat.id;
  const reportedMsg = msg.reply_to_message;

  if (!reportedMsg) {
    await sendBotMessage(bot, chatId, "To report a message, reply to the message you want to report with /report", msg.message_id);
    return;
  }

  if (reportedMsg.from?.id === instance.botTelegramId) {
    await sendBotMessage(bot, chatId, "You can't report the bot's own messages.", msg.message_id);
    return;
  }

  const reportedAuthor = reportedMsg.from?.first_name || reportedMsg.from?.username || "Unknown";
  const reportedText = reportedMsg.text || reportedMsg.caption || "[media/non-text content]";
  const reportReason = args || "No reason provided";

  try {
    const deterministicCheck = runDeterministicScamCheck(reportedText);

    let assessment: { shouldDelete: boolean; reason: string; category: string };
    if (deterministicCheck.isScam) {
      assessment = { shouldDelete: true, reason: deterministicCheck.reason, category: "SCAM_PROMOTION" };
    } else {
      assessment = await evaluateReportedMessage(reportedText, reportedAuthor, config, groupRecord?.name || "Unknown", reportReason);
      if (assessment.category === "UNKNOWN") {
        assessment = { shouldDelete: true, reason: "Reported by group member — removed for review", category: "REPORTED" };
      }
    }

    let actionTaken = "flagged";
    if (assessment.shouldDelete) {
      try {
        await bot.deleteMessage(chatId, reportedMsg.message_id);
        actionTaken = "deleted";
        try { await bot.deleteMessage(chatId, msg.message_id); } catch (_) {}
      } catch (deleteErr: any) {
        actionTaken = "flagged (could not delete — bot may need admin rights)";
      }
    }

    let responseText: string;
    if (actionTaken === "deleted") {
      responseText = `⚠️ The message from ${reportedAuthor} has been removed — ${assessment.reason}. Stay safe and don't engage with suspicious content.`;
    } else if (assessment.shouldDelete && actionTaken.includes("could not delete")) {
      responseText = `⚠️ That message looks like ${assessment.category.toLowerCase().replace("_", " ")} — ${assessment.reason}. I couldn't remove it automatically, but do NOT engage with it.`;
    } else if (assessment.category === "LEGITIMATE") {
      responseText = `Reviewed — this message looks fine. ${assessment.reason}`;
    } else {
      responseText = `⚠️ Flagged as ${assessment.category.toLowerCase().replace("_", " ")} — ${assessment.reason}. Do not engage with suspicious content.`;
    }

    await sendBotMessage(bot, chatId, responseText, msg.message_id);

    await storage.createActivityLog(botConfigId, userId, {
      groupId: groupRecord?.id || null,
      type: "report",
      userName,
      userMessage: `[/report by ${userName}] Reported message from ${reportedAuthor}: "${reportedText.slice(0, 200)}"${reportReason !== "No reason provided" ? ` | Reason: ${reportReason}` : ""}`,
      botResponse: `Action: ${actionTaken}. ${assessment.reason}`,
      isReport: true,
      metadata: JSON.stringify({ reportedAuthor, actionTaken, assessment: assessment.category }),
    });

    if (assessment.category !== "LEGITIMATE") {
      try {
        const normalizedReported = normalizeUnicode(reportedText);
        const phrases = extractKeyPhrases(normalizedReported);
        for (const phrase of phrases) {
          await storage.createReportedScamPattern(botConfigId, phrase, reportedText.slice(0, 500));
        }
        if (phrases.length > 0) {
          clearLearnedPatternsCache(botConfigId);
          log(`Learned ${phrases.length} patterns from /report for bot ${botConfigId}`, "telegram");
        }
      } catch (learnErr: any) {
        log(`Failed to learn from report: ${learnErr.message}`, "telegram");
      }
    }
  } catch (err: any) {
    log(`Error processing /report: ${err.message}`, "telegram");
    await sendBotMessage(bot, chatId, "Report logged. An admin will review this.", msg.message_id);
    await storage.createActivityLog(botConfigId, userId, {
      groupId: groupRecord?.id || null,
      type: "report",
      userName,
      userMessage: `[/report by ${userName}] Reported message from ${reportedAuthor}: "${reportedText.slice(0, 200)}"`,
      botResponse: "Report logged (AI evaluation failed)",
      isReport: true,
      metadata: null,
    });
  }
}

async function evaluateReportedMessage(
  messageText: string,
  author: string,
  config: BotConfig,
  groupName: string,
  reportReason: string
): Promise<{ shouldDelete: boolean; reason: string; category: string }> {
  let contextInfo = "";
  if (config.globalContext?.trim()) {
    contextInfo = `\nGroup/Project context: ${config.globalContext.slice(0, 500)}`;
  }

  const sanitize = (s: string) => s.replace(/"/g, "'").replace(/\\/g, "");

  const prompt = `You are a content moderator for the Telegram group "${sanitize(groupName)}".${contextInfo}

A user has reported the following message. Evaluate whether it should be deleted.

Reported message by "${sanitize(author)}": "${sanitize(messageText)}"
Report reason: "${sanitize(reportReason)}"

Evaluate the message against these criteria:
1. SPAM — unsolicited promotion, ads, scam links, repeated self-promotion, paid shilling offers
2. SCAM_PROMOTION — offering fake investors, promising market cap, asking to DM for paid promotion, offering to "pump" or "shill" tokens, promising unrealistic returns, offering to buy/sell followers or engagement, any "DM me for investors/marketing" type messages
3. INAPPROPRIATE — offensive, hateful, harassing, or NSFW content
4. OFF_TOPIC — completely unrelated to the group's purpose (only if clearly irrelevant)
5. LEGITIMATE — the message is acceptable and doesn't violate guidelines

Respond in this exact JSON format only:
{"shouldDelete": true/false, "reason": "brief 1-sentence explanation", "category": "SPAM|SCAM_PROMOTION|INAPPROPRIATE|OFF_TOPIC|LEGITIMATE"}

ALWAYS recommend deletion (shouldDelete: true) for SPAM, SCAM_PROMOTION, and INAPPROPRIATE messages.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 150,
  });

  const content = response.choices[0]?.message?.content?.trim() || "";

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        shouldDelete: Boolean(parsed.shouldDelete),
        reason: String(parsed.reason || "Evaluated by AI"),
        category: String(parsed.category || "UNKNOWN"),
      };
    }
  } catch {}

  return { shouldDelete: false, reason: "Could not evaluate — flagged for admin review.", category: "UNKNOWN" };
}

function checkIfReport(text: string, config: BotConfig): boolean {
  const lower = text.toLowerCase();
  const keywords = config.reportKeywords || ["report", "issue", "bug", "problem", "broken"];
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

async function shouldBotRespond(msg: TelegramBot.Message, config: BotConfig, instance: BotInstance): Promise<boolean> {
  if (!msg.text) return false;

  const botUsername = instance.botUsername;
  const isMentioned = msg.text.includes(`@${botUsername}`);
  const isReplyToBot = msg.reply_to_message?.from?.id === instance.botTelegramId;

  if (config.onlyRespondWhenMentioned) return isMentioned;
  if (config.respondToReplies && isReplyToBot) return true;
  if (isMentioned) return true;
  if (config.responseMode === "always") return true;
  if (config.responseMode === "mentioned") return isMentioned;
  if (config.responseMode === "questions") {
    return msg.text.includes("?") || /^(what|how|why|when|where|who|can|is|are|do|does|will|would|should|could)\b/i.test(msg.text);
  }
  if (config.responseMode === "smart") return isMentioned || isReplyToBot;
  return false;
}

async function generateAIResponse(botConfigId: number, userMessage: string, userName: string, config: BotConfig, groupName: string, botUsername: string, replyContext?: string | null, replyIsFromBot?: boolean): Promise<string> {
  const knowledgeEntries = await storage.getActiveKnowledgeEntries(botConfigId);

  const MAX_CONTEXT_CHARS = 6000;
  let usedChars = 0;

  let globalContextSection = "";
  if (config.globalContext && config.globalContext.trim()) {
    const globalText = config.globalContext.slice(0, 2000);
    globalContextSection = `\n\n--- ABOUT THIS PROJECT/COMMUNITY ---\n${globalText}`;
    usedChars += globalText.length;
  }

  let websiteSection = "";
  if (config.websiteContent && config.websiteContent.trim()) {
    const maxWebsite = Math.min(2000, MAX_CONTEXT_CHARS - usedChars);
    if (maxWebsite > 100) {
      const websiteText = config.websiteContent.slice(0, maxWebsite);
      websiteSection = `\n\n--- WEBSITE CONTENT (from ${config.websiteUrl || "website"}) ---\n${websiteText}`;
      usedChars += websiteText.length;
    }
  }

  let knowledgeContext = "";
  if (knowledgeEntries.length > 0) {
    const maxKnowledge = Math.max(0, MAX_CONTEXT_CHARS - usedChars);
    let kbText = "";
    for (const e of knowledgeEntries) {
      let entry = `[${e.category}] ${e.title}:\n${e.content}`;
      if (e.sourceUrl) entry += `\nSource: ${e.sourceUrl}`;
      if (kbText.length + entry.length + 2 > maxKnowledge) break;
      kbText += (kbText ? "\n\n" : "") + entry;
    }
    if (kbText) {
      knowledgeContext = `\n\n--- KNOWLEDGE BASE ---\n${kbText}`;
    }
  }

  const usernameClause = botUsername ? ` Your Telegram handle is @${botUsername} — when people mention @${botUsername}, they are talking to YOU.` : "";
  const systemPrompt = `You are "${config.botName}", a bot assistant in the Telegram group "${groupName}".${usernameClause}

--- PERSONALITY & COMMUNICATION STYLE (HIGHEST PRIORITY) ---
The following instructions define your tone, personality, and communication style. You MUST follow these instructions in every response. They override any default behavior:

${config.personality}

--- END PERSONALITY ---
${globalContextSection}${websiteSection}${knowledgeContext}

--- YOUR ROLE ---
- You are a community assistant that answers questions and provides information based on your context and personality above.
- When users mention your @handle or your name, they are addressing YOU directly. Never refer to yourself as a separate entity.
- Scam/spam detection runs AUTOMATICALLY in the background — it is a separate system. You do NOT need to talk about it.

--- BEHAVIOR RULES ---
- ALWAYS maintain the personality and tone defined above. This is the most important instruction.
- Use the context above confidently. You KNOW this project — answer with authority, never say "I don't have info" if the answer is in your context.
- Keep responses SHORT — 1-3 sentences max (under ${config.maxResponseLength} characters). No walls of text.
- NEVER talk about your moderation abilities, spam detection, or message deletion in normal responses.
- NEVER claim you just "handled", "removed", or "deleted" a specific message.
- If someone asks you about a link or message, give your honest opinion about it.
- NEVER guess or improvise specific data like contract addresses, token prices, wallet addresses, stats, or numbers.
- NEVER ask users to send screenshots, timestamps, usernames, or "more details". Just answer directly.
- NEVER mention admins, admin review, or "flagging for admins".
- If a message is trivial/casual with nothing useful to add, respond with ONLY "[[SKIP]]".
- Match the personality and tone above. Be direct, not corporate.`;

  const messages: { role: "system" | "assistant" | "user"; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  if (replyContext) {
    if (replyIsFromBot) {
      const botContent = replyContext.replace(/^.*? said: /, "");
      messages.push({ role: "assistant", content: botContent });
    } else {
      messages.push({ role: "user", content: `[Replying to this message] ${replyContext}` });
    }
  }

  messages.push({ role: "user", content: `${userName} says: ${userMessage}` });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages,
      max_completion_tokens: 1000,
    }, { signal: controller.signal as any });

    return response.choices[0]?.message?.content?.trim() || "";
  } finally {
    clearTimeout(timeout);
  }
}
