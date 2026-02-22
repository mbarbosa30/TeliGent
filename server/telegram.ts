import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { storage } from "./storage";
import { log } from "./index";
import type { BotConfig } from "@shared/schema";
import type { Express } from "express";
import crypto from "crypto";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface BotInstance {
  bot: TelegramBot;
  userId: string;
  token: string;
  webhookPath: string;
}

const activeBots = new Map<string, BotInstance>();
const cooldowns = new Map<string, number>();
let engineStarted = false;
let expressApp: Express | null = null;

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

export async function startBotEngine(app?: Express) {
  if (app) expressApp = app;

  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    log("Dev mode: skipping Telegram bots to avoid conflicts with production webhooks.", "telegram");
    return;
  }

  try {
    const allConfigs = await storage.getAllActiveConfigs();
    const configsWithTokens = allConfigs.filter(c => c.botToken && c.botToken.trim());

    log(`Bot engine: found ${configsWithTokens.length} active bot configs with tokens`, "telegram");

    const currentTokens = new Set(configsWithTokens.map(c => c.botToken));
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
      }
    }

    for (const config of configsWithTokens) {
      if (activeBots.has(config.botToken)) continue;
      await startSingleBot(config);
    }

    engineStarted = true;
  } catch (err: any) {
    log(`Bot engine error: ${err.message}`, "telegram");
  }
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

    expressApp.post(webhookPath, (req, res) => {
      const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
      if (headerSecret !== secret) {
        res.sendStatus(403);
        return;
      }
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });

    const webhookUrl = `${appUrl}${webhookPath}`;
    await bot.setWebHook(webhookUrl, { secret_token: secret });

    const me = await bot.getMe();
    log(`Bot started for user ${userId}: @${me.username} (webhook: ${webhookUrl})`, "telegram");

    await storage.upsertConfig(userId, { botName: me.first_name || "Bot" });

    const instance: BotInstance = { bot, userId, token, webhookPath };
    activeBots.set(token, instance);

    bot.on("message", (msg) => handleMessage(msg, instance));
    bot.on("new_chat_members", (msg) => handleNewMembers(msg, instance));
    bot.on("left_chat_member", (msg) => handleLeftMember(msg, instance));
  } catch (err: any) {
    log(`Failed to start bot for user ${userId}: ${err.message}`, "telegram");
  }
}

async function handleNewMembers(msg: TelegramBot.Message, instance: BotInstance) {
  if (!msg.new_chat_members || !msg.chat) return;
  const { bot, userId } = instance;

  const botInfo = await bot.getMe();
  const botJoined = msg.new_chat_members.some(m => m.id === botInfo.id);

  if (botJoined) {
    const chatId = msg.chat.id.toString();
    const chatTitle = msg.chat.title || "Unknown Group";
    const memberCount = await bot.getChatMemberCount(msg.chat.id).catch(() => 0);

    await storage.upsertGroup(userId, {
      telegramChatId: chatId,
      name: chatTitle,
      memberCount,
      isActive: true,
    });

    await storage.createActivityLog(userId, {
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
  const { bot, userId } = instance;

  const botInfo = await bot.getMe();
  if (msg.left_chat_member.id === botInfo.id) {
    const group = await storage.getGroupByChatId(userId, msg.chat.id.toString());
    if (group) {
      await storage.updateGroup(userId, group.id, { isActive: false });
    }
    log(`Bot removed from group: ${msg.chat.title} (user: ${userId})`, "telegram");
  }
}

const MIN_SCAM_CHECK_LENGTH = 50;

async function aiScamCheck(text: string, senderRole: string): Promise<{ isScam: boolean; reason: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You are a scam detection system for a crypto/Web3 Telegram group. The sender is a REGULAR USER (not an admin or owner). Analyze their message and determine if it is a SCAM or SPAM.

A message is a SCAM/SPAM if it does ANY of these:
- Poses as project leadership or makes official-sounding announcements (migrations, relaunches, contract changes, new CAs, etc.) — a regular user has no authority to do this
- Asks people to DM/PM/inbox/contact them for refunds, airdrops, tokens, or anything
- Asks for transaction hashes, wallet addresses, private keys, or seed phrases
- Promotes fake airdrops, token swaps, or contract migrations
- Asks people to connect wallets or click suspicious links
- Offers guaranteed returns, paid promotions, or investment services
- Creates false urgency (act now, limited time, within X hours)
- Promotes other tokens/projects unsolicited (shilling)
- Shares links to other Telegram groups, channels, or bots to promote them (e.g. t.me/SomeOtherGroup)
- Offers services like "I can get you investors/listings/volume"
- Claims to own/run a "community", "group", or "channel" and offers promotion, engagement, or marketing services — this is unsolicited self-promotion
- Pitches any kind of paid service (promotion, marketing, listing, volume boosting, community building) to the group
- Uses flattery + DM solicitation pattern (e.g. "Hello sir, DM me for...")

A message is NOT a scam if it's:
- A normal question or discussion about the project
- General crypto discussion without solicitation
- Complaints or criticism (even harsh ones)
- Casual chat, memes, or banter
- Asking about project status without making announcements
- Sharing a link that is directly relevant to an ongoing conversation someone else started (not unsolicited promotion)

Respond with ONLY valid JSON, no other text: {"scam": true, "reason": "brief explanation"} or {"scam": false, "reason": "brief explanation"}`
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
    return { isScam: false, reason: "" };
  } catch (e: any) {
    log(`AI scam check failed: ${e.message}`, "telegram");
    return { isScam: false, reason: "" };
  }
}

async function executeScamAction(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  userId: string,
  groupRecord: any,
  reason: string
): Promise<boolean> {
  log(`SCAM DETECTED from ${userName} (${reason}): ${text.substring(0, 100)}`, "telegram");

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
    await storage.createActivityLog(userId, {
      groupId: groupRecord.id,
      type: "report",
      userName,
      userMessage: text,
      botResponse: deleted ? "(silently deleted)" : "(warned — could not delete)",
      isReport: true,
      metadata: { autoDetected: true, reason },
    });
  }

  return true;
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
  result = result.replace(/\b([A-Za-z])\s+(?=[A-Za-z]\b)/g, '$1');
  return result;
}

async function detectAndHandleScam(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  userId: string,
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

  const hasDmSolicitation = /\b(dm|pm|inbox|message|contact)\s*(me|us)\b|\bsend\s*(me\s*)?(a\s*)?(dm|pm|message)\b|\b(inbox|dm|pm)\b.*\b(for|me)\b/i.test(normalized);
  const hasScamOffer = /\b(promot|engag|market|listing|volume|investor|communit(y|ies).*\b(own|run|manag|lead)|(own|run|manag|lead).*\bcommunit(y|ies)|\d+\s*(eth|btc|usdt|bnb|sol)\b|free\s*(token|coin|airdrop|eth|btc|crypto)|guaranteed\s*(return|profit))\b/i.test(normalized);
  const sexualEmojis = ['🍆', '🍑', '💦', '🔥', '🥵', '😈', '💋'];
  const hasSexualSpam = sexualEmojis.some(e => text.includes(e)) && /\b(inbox|dm|pm|message|contact|send)\b/i.test(normalized);
  const hasSolicitationSpam = /\b(inbox|dm|pm)\b/i.test(normalized) && /\b(fun|service|interest|offer|available)\b/i.test(normalized);

  const hasRaidShillSpam = /\b(raid\s*(team|group|squad|crew|service)s?|raid\s*team\s*of\s*\d+|shill(er)?s?\s*(team|group|squad|crew|service)s?|shill(er)?s?\s*to\s*boost|raider(s)?\s*(and|&)\s*shill(er)?s?|verified\s*(raider|shiller)s?|boost(ing)?\s*engag(ement|e)|engag(ement|e)\s*boost(ing|er|service|team|farm)?|free\s*test\s*run|paid\s*(raid|shill|promo|market)|hire\s*(raid|shill|market))\b/i.test(normalized);
  const hasPaidServiceSpam = /\b(growth\s*service|marketing\s*service|promotion\s*service|listing\s*service|trending\s*service|cmc\s*(list|trend)|coingecko\s*(list|trend)|dextools\s*trend|twitter\s*(raid|growth|boost)|telegram\s*(growth|member|boost))\b/i.test(normalized);

  const hasDmWithUsername = /\b(dm|pm)\s*.{0,5}@\w+/i.test(normalized) && /\b(call|signal|insider|profit|trade|print|miss|join|part)\b/i.test(normalized);
  const hasInsiderCallSpam = (/\b(insider|my\s*(call|signal)|vip\s*(call|group|channel|access)|paid\s*(call|group|signal)|fading\s*me)\b/i.test(normalized) && /\b(dm|pm)\s*.{0,10}@\w+/i.test(normalized)) || /\binsider\b.{0,20}\b(cook|member|call|signal|group)s?\b.{0,30}(print|profit|money|gain|earning)/i.test(normalized) || /\bdrop\s*(cook|call|signal)s?\b.{0,20}(print|profit|member)/i.test(normalized) || /\b(inner\s*circle|private\s*circle)\b.{0,40}(print|profit|\dx|\d+x\b|money|earning|gain)/i.test(normalized) || /\d+(\.\d+)?x\s*(done|profit|gain|made)\b.{0,30}\b(inner|circle|member|private)/i.test(normalized);
  const hasAggressiveDmSpam = /\b(dm\s*now|dm\s*me\s*now|send\s*(a\s*)?dm|check\s*(my\s*)?dm|kindly\s*(send|dm)|holders?\s*dm|dm\s*if\s*you|dm\s*for\s*(promo|promotion|detail|info|offer|deal|signal|call))\b/i.test(normalized);
  const hasWalletBuyingSelling = /\b(buy|sell|get|need|want|pay)\b.{0,30}\b(wallet|account)\b.{0,30}\b(history|transaction|old|empty|aged|month|year)\b/i.test(normalized) || /\b(old|empty|aged)\s*(wallet|account)\b.{0,30}\b(pay|buy|sell|solana|sol|eth|usdt|btc)\b/i.test(normalized) || /\b(wallet|account)\s*(with|that\s*has)\s*.{0,20}(transaction|history|activit)/i.test(normalized);
  const hasPumpPromoSpam = /\b(pump|boost)\s*(your|ur)\s*(token|project|coin|mc|market\s*cap)\b/i.test(normalized) || /\b(i\s*(can|will)\s*(pump|boost|promote))\b.{0,40}\b(token|project|coin|mc|market\s*cap|profit)\b/i.test(normalized) || /\bpromotion\s*on\s*my\s*(telegram|channel|group)\b/i.test(normalized) || /\b(investor|holder)s?\s*(who\s*will|that\s*will|to)\s*(pump|buy|invest)/i.test(normalized) || /\b(contact|message|reach)\s*(me|us)\s*(in\s*)?(my\s*)?(inbox|dm|pm)\b.{0,30}\b(pump|promo|boost)/i.test(normalized);

  if (hasAggressiveDmSpam || hasDmWithUsername) {
    return await executeScamAction(bot, msg, text, userName, userId, groupRecord, "Aggressive DM solicitation spam");
  }
  if (hasInsiderCallSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, groupRecord, "Insider trading / paid call scam");
  }
  if (hasWalletBuyingSelling) {
    return await executeScamAction(bot, msg, text, userName, userId, groupRecord, "Wallet buying/selling scam");
  }
  if (hasDmSolicitation && hasScamOffer) {
    return await executeScamAction(bot, msg, text, userName, userId, groupRecord, "DM solicitation with scam/promo offer");
  }
  if (hasSexualSpam || hasSolicitationSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, groupRecord, "Solicitation/adult spam");
  }
  if (hasRaidShillSpam || hasPaidServiceSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, groupRecord, "Raid/shill/paid promotion service offer");
  }
  if (hasPumpPromoSpam) {
    return await executeScamAction(bot, msg, text, userName, userId, groupRecord, "Token pump / paid promotion service offer");
  }

  const hasUrl = /https?:\/\/|t\.me\//i.test(text);
  if (!hasUrl && normalized.length < MIN_SCAM_CHECK_LENGTH) {
    return false;
  }

  const { isScam, reason } = await aiScamCheck(normalized, "regular_user");
  if (!isScam) return false;

  return await executeScamAction(bot, msg, text, userName, userId, groupRecord, `AI: ${reason}`);
}

async function handleMessage(msg: TelegramBot.Message, instance: BotInstance) {
  try {
    if (!msg.text || !msg.chat || msg.chat.type === "private") return;
    if (msg.from?.is_bot) return;

    const { bot, userId } = instance;
    const config = await storage.getConfig(userId);
    if (!config || !config.isActive) return;

    const chatId = msg.chat.id.toString();
    const userName = msg.from?.first_name || msg.from?.username || "Unknown";
    const messageText = msg.text;

    const group = await storage.getGroupByChatId(userId, chatId);
    if (!group) {
      const memberCount = await bot.getChatMemberCount(msg.chat.id).catch(() => 0);
      await storage.upsertGroup(userId, {
        telegramChatId: chatId,
        name: msg.chat.title || "Unknown",
        memberCount,
        isActive: true,
      });
    }
    const groupRecord = await storage.getGroupByChatId(userId, chatId);

    if (messageText.startsWith("/")) {
      const handled = await handleCommand(bot, msg, config, groupRecord, userId);
      if (handled) return;
    }

    const scamDetected = await detectAndHandleScam(bot, msg, messageText, userName, userId, config, groupRecord);
    if (scamDetected) return;

    const deleteHandled = await handleDeleteRequest(bot, msg, messageText, userName);
    if (deleteHandled) return;

    const isReport = checkIfReport(messageText, config);
    if (isReport && config.trackReports) {
      await storage.createActivityLog(userId, {
        groupId: groupRecord?.id || null,
        type: "report",
        userName,
        userMessage: messageText,
        botResponse: null,
        isReport: true,
        metadata: null,
      });
    }

    const shouldRespond = await shouldBotRespond(bot, msg, config);
    if (!shouldRespond) return;

    const tgUserId = msg.from?.id?.toString() || "unknown";
    const cooldownKey = `${chatId}:${tgUserId}`;
    const now = Date.now();
    const lastResponse = cooldowns.get(cooldownKey) || 0;
    if (now - lastResponse < config.cooldownSeconds * 1000) return;

    try {
      let replyContext: string | null = null;
      let replyIsFromBot = false;
      if (msg.reply_to_message?.text) {
        const botInfo = await bot.getMe();
        replyIsFromBot = msg.reply_to_message.from?.id === botInfo.id;
        const replyAuthor = replyIsFromBot
          ? config.botName
          : (msg.reply_to_message.from?.first_name || msg.reply_to_message.from?.username || "Someone");
        replyContext = `${replyAuthor} said: ${msg.reply_to_message.text}`;
      }

      const response = await generateAIResponse(userId, messageText, userName, config, groupRecord?.name || "Unknown", replyContext, replyIsFromBot);
      if (response && response.trim() && response.trim() !== "[[SKIP]]") {
        await sendBotMessage(bot, msg.chat.id, response, msg.message_id);
        cooldowns.set(cooldownKey, now);

        await storage.createActivityLog(userId, {
          groupId: groupRecord?.id || null,
          type: "response",
          userName,
          userMessage: messageText,
          botResponse: response,
          isReport: false,
          metadata: null,
        });
      } else if (!response || !response.trim()) {
        await sendBotMessage(bot, msg.chat.id, "Sorry, I couldn't process that. Try asking again.", msg.message_id);
      }
    } catch (err: any) {
      log(`Error generating response for ${userName}: ${err.message}`, "telegram");
      try {
        await sendBotMessage(bot, msg.chat.id, "Something went wrong processing your message. Try again in a moment.", msg.message_id);
      } catch (_) {}
    }
  } catch (outerErr: any) {
    log(`CRITICAL: Unhandled error processing message: ${outerErr.message}`, "telegram");
  }
}

async function handleDeleteRequest(bot: TelegramBot, msg: TelegramBot.Message, text: string, userName: string): Promise<boolean> {
  const botInfo = await bot.getMe();
  const botUsername = botInfo.username || "";
  const isMentioned = text.includes(`@${botUsername}`);

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

async function handleCommand(bot: TelegramBot, msg: TelegramBot.Message, config: BotConfig, groupRecord: any, userId: string): Promise<boolean> {
  const text = msg.text || "";
  const chatId = msg.chat.id;
  const userName = msg.from?.first_name || msg.from?.username || "Unknown";
  const botInfo = await bot.getMe();
  const botUsername = botInfo.username || "";

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
    await storage.createActivityLog(userId, {
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
    await storage.createActivityLog(userId, {
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
    await handleReportCommand(bot, msg, config, groupRecord, userName, args, userId);
    return true;
  }

  return false;
}

async function handleReportCommand(bot: TelegramBot, msg: TelegramBot.Message, config: BotConfig, groupRecord: any, userName: string, args: string, userId: string) {
  const chatId = msg.chat.id;
  const reportedMsg = msg.reply_to_message;

  if (!reportedMsg) {
    await sendBotMessage(bot, chatId, "To report a message, reply to the message you want to report with /report", msg.message_id);
    return;
  }

  const botInfo = await bot.getMe();
  if (reportedMsg.from?.id === botInfo.id) {
    await sendBotMessage(bot, chatId, "You can't report the bot's own messages.", msg.message_id);
    return;
  }

  const reportedAuthor = reportedMsg.from?.first_name || reportedMsg.from?.username || "Unknown";
  const reportedText = reportedMsg.text || reportedMsg.caption || "[media/non-text content]";
  const reportReason = args || "No reason provided";

  try {
    const assessment = await evaluateReportedMessage(reportedText, reportedAuthor, config, groupRecord?.name || "Unknown", reportReason);

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

    await storage.createActivityLog(userId, {
      groupId: groupRecord?.id || null,
      type: "report",
      userName,
      userMessage: `[/report by ${userName}] Reported message from ${reportedAuthor}: "${reportedText.slice(0, 200)}"${reportReason !== "No reason provided" ? ` | Reason: ${reportReason}` : ""}`,
      botResponse: `Action: ${actionTaken}. ${assessment.reason}`,
      isReport: true,
      metadata: JSON.stringify({ reportedAuthor, actionTaken, assessment: assessment.category }),
    });
  } catch (err: any) {
    log(`Error processing /report: ${err.message}`, "telegram");
    await sendBotMessage(bot, chatId, "Report logged. An admin will review this.", msg.message_id);
    await storage.createActivityLog(userId, {
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

async function shouldBotRespond(bot: TelegramBot, msg: TelegramBot.Message, config: BotConfig): Promise<boolean> {
  if (!msg.text) return false;

  const botInfo = await bot.getMe();
  const botUsername = botInfo.username || "";
  const isMentioned = msg.text.includes(`@${botUsername}`);
  const isReplyToBot = msg.reply_to_message?.from?.id === botInfo.id;

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

async function generateAIResponse(userId: string, userMessage: string, userName: string, config: BotConfig, groupName: string, replyContext?: string | null, replyIsFromBot?: boolean): Promise<string> {
  const knowledgeEntries = await storage.getActiveKnowledgeEntries(userId);

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

  const systemPrompt = `You are "${config.botName}", a bot assistant in the Telegram group "${groupName}".

${config.personality}
${globalContextSection}${websiteSection}${knowledgeContext}

--- YOUR ROLE ---
- You are a helpful community assistant that answers questions and provides information based on your context.
- Scam/spam detection runs AUTOMATICALLY in the background — it is a separate system. You do NOT need to talk about it.

--- BEHAVIOR RULES ---
- Use the context above confidently. You KNOW this project — answer with authority, never say "I don't have info" if the answer is in your context.
- Keep responses SHORT — 1-3 sentences max (under ${config.maxResponseLength} characters). No walls of text.
- NEVER talk about your moderation abilities, spam detection, or message deletion in normal responses.
- NEVER claim you just "handled", "removed", or "deleted" a specific message.
- If someone asks you about a link or message, give your honest opinion about it.
- NEVER guess or improvise specific data like contract addresses, token prices, wallet addresses, stats, or numbers.
- NEVER ask users to send screenshots, timestamps, usernames, or "more details". Just answer directly.
- NEVER mention admins, admin review, or "flagging for admins".
- If a message is trivial/casual with nothing useful to add, respond with ONLY "[[SKIP]]".
- Match the group's casual tone. Be direct, not corporate.`;

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
