import TelegramBot from "node-telegram-bot-api";
import { storage } from "../storage";
import { log } from "../index";
import { db } from "../db";
import { users } from "@shared/schema";
import type { BotConfig } from "@shared/schema";
import type { Express } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";

import type { BotInstance } from "./types";
import { sendBotMessage } from "./utils";
import { detectAndHandleScam } from "./scam-detection";
import { handleCommand, handleDeleteRequest, checkIfReport, shouldBotRespond, generateAIResponse } from "./commands";
import { addMessage, getRecentMessages, cleanupOldHistories } from "./conversation-history";
import { maybeLearnFromMessage } from "./realtime-learning";

const activeBots = new Map<string, BotInstance>();
const cooldowns = new Map<string, number>();
const webhookPathToToken = new Map<string, string>();
let engineStarted = false;
let webhookRouteRegistered = false;
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

function registerWebhookRoute(app: Express) {
  app.post("/api/telegram-webhook/:hash", (req, res) => {
    const webhookPath = `/api/telegram-webhook/${req.params.hash}`;
    const currentToken = webhookPathToToken.get(webhookPath);
    if (!currentToken) {
      log(`[WEBHOOK] No token mapped for ${webhookPath}`, "telegram");
      res.sendStatus(200);
      return;
    }
    const expectedSecret = getWebhookSecret(currentToken);
    const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (headerSecret && headerSecret !== expectedSecret) {
      log(`[WEBHOOK] Auth FAILED for ${webhookPath} (secret mismatch)`, "telegram");
      res.sendStatus(403);
      return;
    }
    if (!headerSecret) {
      log(`[WEBHOOK] Rejected: no secret_token header for ${webhookPath}`, "telegram");
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

      if (body.my_chat_member) {
        handleMyChatMember(body.my_chat_member, inst);
      }

      inst.bot.processUpdate(body);
    } else {
      log(`[WEBHOOK] No active bot instance for token at ${webhookPath}`, "telegram");
    }
    res.sendStatus(200);
  });
  log("Registered parameterized webhook route: /api/telegram-webhook/:hash", "telegram");
}

export async function startBotEngine(app?: Express) {
  if (app) expressApp = app;

  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    log("Dev mode: skipping Telegram bots to avoid conflicts with production webhooks.", "telegram");
    return;
  }

  if (app && !webhookRouteRegistered) {
    registerWebhookRoute(app);
    webhookRouteRegistered = true;
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
    cleanupOldHistories();
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
    log(`Mapped webhook path ${webhookPath} to bot @${botUsername}`, "telegram");

    const webhookUrl = `${appUrl}${webhookPath}`;
    try {
      await bot.deleteWebHook();
    } catch (e: any) {
      log(`Warning: deleteWebHook before set failed for @${botUsername}: ${e.message}`, "telegram");
    }
    const webhookOptions: any = {
      secret_token: secret,
      allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member", "chat_member"],
    };
    const setResult = await bot.setWebHook(webhookUrl, webhookOptions);
    log(`setWebHook result for @${botUsername}: ${setResult}`, "telegram");

    const webhookInfo = await bot.getWebHookInfo();
    log(`Webhook info for @${botUsername}: url=${webhookInfo.url}, pending=${webhookInfo.pending_update_count}, last_error=${webhookInfo.last_error_message || "none"}, last_error_date=${webhookInfo.last_error_date || "none"}, has_custom_cert=${webhookInfo.has_custom_certificate}, max_connections=${webhookInfo.max_connections}`, "telegram");

    if (webhookInfo.last_error_message) {
      log(`WARNING: Telegram reports webhook error for @${botUsername}: ${webhookInfo.last_error_message}`, "telegram");
      log(`Retrying setWebHook for @${botUsername}...`, "telegram");
      await bot.deleteWebHook();
      await new Promise(r => setTimeout(r, 1000));
      const retryResult = await bot.setWebHook(webhookUrl, webhookOptions);
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

async function handleMyChatMember(update: any, instance: BotInstance) {
  try {
    const chat = update.chat;
    const newStatus = update.new_chat_member?.status;
    const oldStatus = update.old_chat_member?.status;

    if (!chat || chat.type === "private") return;

    const isJoined = (newStatus === "member" || newStatus === "administrator") &&
      (oldStatus === "left" || oldStatus === "kicked");
    const isLeft = (newStatus === "left" || newStatus === "kicked") &&
      (oldStatus === "member" || oldStatus === "administrator");

    const { bot, userId, botConfigId } = instance;

    if (isJoined) {
      const chatId = chat.id.toString();
      const chatTitle = chat.title || "Unknown Group";
      const memberCount = await bot.getChatMemberCount(chat.id).catch(() => 0);

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
        userMessage: `Bot added to group "${chatTitle}"`,
        botResponse: null,
        isReport: false,
        metadata: null,
      });

      log(`Bot added to group via my_chat_member: ${chatTitle} (user: ${userId})`, "telegram");
    } else if (isLeft) {
      const group = await storage.getGroupByChatId(botConfigId, chat.id.toString());
      if (group) {
        await storage.updateGroup(botConfigId, group.id, { isActive: false });
      }
      log(`Bot removed from group via my_chat_member: ${chat.title} (user: ${userId})`, "telegram");
    }
  } catch (err: any) {
    log(`Error handling my_chat_member: ${err.message}`, "telegram");
  }
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

    addMessage(botConfigId, chatId, {
      role: "user",
      name: userName,
      content: messageText,
      timestamp: Date.now(),
    });

    maybeLearnFromMessage(botConfigId, userId, messageText, userName).catch(err =>
      log(`Learning error: ${err.message}`, "telegram")
    );

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

      const conversationHistory = getRecentMessages(botConfigId, chatId, 20);
      const response = await generateAIResponse(botConfigId, messageText, userName, config, groupRecord?.name || "Unknown", instance.botUsername, replyContext, replyIsFromBot, conversationHistory);
      log(`AI response for ${userName}: "${(response || "").substring(0, 60)}..."`, "telegram");

      if (response && response.trim() && response.trim() !== "[[SKIP]]") {
        await sendBotMessage(bot, msg.chat.id, response, msg.message_id);
        log(`Reply sent to ${userName} in chat ${chatId}`, "telegram");
        cooldowns.set(cooldownKey, now);

        addMessage(botConfigId, chatId, {
          role: "assistant",
          name: config.botName,
          content: response,
          timestamp: Date.now(),
        });

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
