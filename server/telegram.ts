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

let bot: TelegramBot | null = null;
let botStarted = false;
const cooldowns = new Map<string, number>();

export function getBot(): TelegramBot | null {
  return bot;
}

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

export async function startTelegramBot(app?: Express) {
  if (botStarted) {
    log("Bot already started, skipping", "telegram");
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log("TELEGRAM_BOT_TOKEN not set, skipping bot initialization", "telegram");
    return;
  }

  botStarted = true;
  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    log("Dev mode: skipping Telegram bot to avoid conflicts with production webhook. The published version handles all Telegram messages.", "telegram");
    return;
  }

  try {
    const appUrl = getAppUrl();
    const useWebhook = app && appUrl;

    if (useWebhook) {
      bot = new TelegramBot(token);

      const webhookPath = getWebhookPath(token);
      const secret = getWebhookSecret(token);

      app.post(webhookPath, (req, res) => {
        const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
        if (headerSecret !== secret) {
          log(`Webhook request rejected: invalid secret`, "telegram");
          res.sendStatus(403);
          return;
        }
        if (bot) {
          bot.processUpdate(req.body);
        }
        res.sendStatus(200);
      });

      const webhookUrl = `${appUrl}${webhookPath}`;
      await bot.setWebHook(webhookUrl, { secret_token: secret });
      log(`Webhook set: ${webhookUrl}`, "telegram");
    } else {
      log("No APP_URL or REPLIT_DOMAINS found in production, cannot set webhook", "telegram");
      botStarted = false;
      return;
    }

    const me = await bot.getMe();
    log(`Telegram bot started (${useWebhook ? "webhook" : "polling"} mode): @${me.username}`, "telegram");

    await storage.upsertConfig({ botName: me.first_name || "Bot" });

    bot.on("message", handleMessage);
    bot.on("new_chat_members", handleNewMembers);
    bot.on("left_chat_member", handleLeftMember);
  } catch (err: any) {
    log(`Failed to start Telegram bot: ${err.message}`, "telegram");
    botStarted = false;
  }
}

async function handleNewMembers(msg: TelegramBot.Message) {
  if (!msg.new_chat_members || !msg.chat) return;

  const botInfo = await bot!.getMe();
  const botJoined = msg.new_chat_members.some(m => m.id === botInfo.id);

  if (botJoined) {
    const chatId = msg.chat.id.toString();
    const chatTitle = msg.chat.title || "Unknown Group";
    const memberCount = await bot!.getChatMemberCount(msg.chat.id).catch(() => 0);

    await storage.upsertGroup({
      telegramChatId: chatId,
      name: chatTitle,
      memberCount,
      isActive: true,
    });

    await storage.createActivityLog({
      groupId: null,
      type: "join",
      userName: "Bot",
      userMessage: `Bot joined group "${chatTitle}"`,
      botResponse: null,
      isReport: false,
      metadata: null,
    });

    log(`Bot joined group: ${chatTitle}`, "telegram");
  }
}

async function handleLeftMember(msg: TelegramBot.Message) {
  if (!msg.left_chat_member || !msg.chat) return;
  const botInfo = await bot!.getMe();
  if (msg.left_chat_member.id === botInfo.id) {
    const group = await storage.getGroupByChatId(msg.chat.id.toString());
    if (group) {
      await storage.updateGroup(group.id, { isActive: false });
    }
    log(`Bot removed from group: ${msg.chat.title}`, "telegram");
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
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  groupRecord: any,
  reason: string
): Promise<boolean> {
  log(`SCAM DETECTED from ${userName} (${reason}): ${text.substring(0, 100)}`, "telegram");

  let deleted = false;
  try {
    await bot!.deleteMessage(msg.chat.id, msg.message_id);
    deleted = true;
    log(`Deleted scam message from ${userName}`, "telegram");
  } catch (e: any) {
    log(`Could not delete scam message (bot may not be admin): ${e.message}`, "telegram");
  }

  if (!deleted) {
    try {
      await sendBotMessage(msg.chat.id, `⚠️ Warning: The message above from ${userName} looks like a scam/spam. Do NOT click links, send crypto, or DM anyone offering tokens.`);
    } catch (e: any) {
      log(`Could not send scam warning: ${e.message}`, "telegram");
    }
  }

  if (groupRecord) {
    await storage.createActivityLog({
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
    [0x1D400, 0x1D419, 0x41], // Math Bold A-Z
    [0x1D41A, 0x1D433, 0x61], // Math Bold a-z
    [0x1D434, 0x1D44D, 0x41], // Math Italic A-Z
    [0x1D44E, 0x1D467, 0x61], // Math Italic a-z
    [0x1D468, 0x1D481, 0x41], // Math Bold Italic A-Z
    [0x1D482, 0x1D49B, 0x61], // Math Bold Italic a-z
    [0x1D49C, 0x1D4B5, 0x41], // Math Script A-Z
    [0x1D4B6, 0x1D4CF, 0x61], // Math Script a-z
    [0x1D4D0, 0x1D4E9, 0x41], // Math Bold Script A-Z
    [0x1D4EA, 0x1D503, 0x61], // Math Bold Script a-z
    [0x1D504, 0x1D51D, 0x41], // Math Fraktur A-Z
    [0x1D51E, 0x1D537, 0x61], // Math Fraktur a-z
    [0x1D538, 0x1D551, 0x41], // Math Double-Struck A-Z
    [0x1D552, 0x1D56B, 0x61], // Math Double-Struck a-z
    [0x1D56C, 0x1D585, 0x41], // Math Bold Fraktur A-Z
    [0x1D586, 0x1D59F, 0x61], // Math Bold Fraktur a-z
    [0x1D5A0, 0x1D5B9, 0x41], // Math Sans A-Z
    [0x1D5BA, 0x1D5D3, 0x61], // Math Sans a-z
    [0x1D5D4, 0x1D5ED, 0x41], // Math Sans Bold A-Z
    [0x1D5EE, 0x1D607, 0x61], // Math Sans Bold a-z
    [0x1D608, 0x1D621, 0x41], // Math Sans Italic A-Z
    [0x1D622, 0x1D63B, 0x61], // Math Sans Italic a-z
    [0x1D63C, 0x1D655, 0x41], // Math Sans Bold Italic A-Z
    [0x1D656, 0x1D66F, 0x61], // Math Sans Bold Italic a-z
    [0x1D670, 0x1D689, 0x41], // Math Monospace A-Z
    [0x1D68A, 0x1D6A3, 0x61], // Math Monospace a-z
    [0xFF21, 0xFF3A, 0x41],   // Fullwidth A-Z
    [0xFF41, 0xFF5A, 0x61],   // Fullwidth a-z
    [0x24B6, 0x24CF, 0x41],   // Circled A-Z
    [0x24D0, 0x24E9, 0x61],   // Circled a-z
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
  return result;
}

async function detectAndHandleScam(
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  config: BotConfig,
  groupRecord: any
): Promise<boolean> {
  try {
    const member = await bot!.getChatMember(msg.chat.id, msg.from!.id);
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
  const hasInsiderCallSpam = (/\b(insider|my\s*(call|signal)|vip\s*(call|group|channel|access)|paid\s*(call|group|signal)|fading\s*me)\b/i.test(normalized) && /\b(dm|pm)\s*.{0,10}@\w+/i.test(normalized)) || /\binsider\b.{0,20}\b(cook|member|call|signal|group)s?\b.{0,30}(print|profit|money|gain|earning)/i.test(normalized) || /\bdrop\s*(cook|call|signal)s?\b.{0,20}(print|profit|member)/i.test(normalized);
  const hasAggressiveDmSpam = /\b(dm\s*now|dm\s*me\s*now|send\s*(a\s*)?dm|check\s*(my\s*)?dm|kindly\s*(send|dm)|holders?\s*dm|dm\s*if\s*you|dm\s*for\s*(promo|promotion|detail|info|offer|deal|signal|call))\b/i.test(normalized);
  const hasWalletBuyingSelling = /\b(buy|sell|get|need|want|pay)\b.{0,30}\b(wallet|account)\b.{0,30}\b(history|transaction|old|empty|aged|month|year)\b/i.test(normalized) || /\b(old|empty|aged)\s*(wallet|account)\b.{0,30}\b(pay|buy|sell|solana|sol|eth|usdt|btc)\b/i.test(normalized) || /\b(wallet|account)\s*(with|that\s*has)\s*.{0,20}(transaction|history|activit)/i.test(normalized);
  const hasPumpPromoSpam = /\b(pump|boost)\s*(your|ur)\s*(token|project|coin|mc|market\s*cap)\b/i.test(normalized) || /\b(i\s*(can|will)\s*(pump|boost|promote))\b.{0,40}\b(token|project|coin|mc|market\s*cap|profit)\b/i.test(normalized) || /\bpromotion\s*on\s*my\s*(telegram|channel|group)\b/i.test(normalized) || /\b(investor|holder)s?\s*(who\s*will|that\s*will|to)\s*(pump|buy|invest)/i.test(normalized) || /\b(contact|message|reach)\s*(me|us)\s*(in\s*)?(my\s*)?(inbox|dm|pm)\b.{0,30}\b(pump|promo|boost)/i.test(normalized);

  if (hasAggressiveDmSpam || hasDmWithUsername) {
    log(`Deterministic spam match (aggressive DM solicitation) from ${userName}: "${text.substring(0, 80)}"`, "telegram");
    return await executeScamAction(msg, text, userName, groupRecord, "Aggressive DM solicitation spam");
  }
  if (hasInsiderCallSpam) {
    log(`Deterministic spam match (insider/call scam) from ${userName}: "${text.substring(0, 80)}"`, "telegram");
    return await executeScamAction(msg, text, userName, groupRecord, "Insider trading / paid call scam");
  }
  if (hasWalletBuyingSelling) {
    log(`Deterministic spam match (wallet buying/selling) from ${userName}: "${text.substring(0, 80)}"`, "telegram");
    return await executeScamAction(msg, text, userName, groupRecord, "Wallet buying/selling scam");
  }
  if (hasDmSolicitation && hasScamOffer) {
    log(`Deterministic scam match from ${userName}: "${text.substring(0, 80)}"`, "telegram");
    return await executeScamAction(msg, text, userName, groupRecord, "DM solicitation with scam/promo offer");
  }
  if (hasSexualSpam || hasSolicitationSpam) {
    log(`Deterministic spam match (solicitation) from ${userName}: "${text.substring(0, 80)}"`, "telegram");
    return await executeScamAction(msg, text, userName, groupRecord, "Solicitation/adult spam");
  }
  if (hasRaidShillSpam || hasPaidServiceSpam) {
    log(`Deterministic spam match (raid/shill/service) from ${userName}: "${text.substring(0, 80)}"`, "telegram");
    return await executeScamAction(msg, text, userName, groupRecord, "Raid/shill/paid promotion service offer");
  }
  if (hasPumpPromoSpam) {
    log(`Deterministic spam match (pump/promo service) from ${userName}: "${text.substring(0, 80)}"`, "telegram");
    return await executeScamAction(msg, text, userName, groupRecord, "Token pump / paid promotion service offer");
  }

  const hasUrl = /https?:\/\/|t\.me\//i.test(text);
  if (!hasUrl && normalized.length < MIN_SCAM_CHECK_LENGTH) {
    log(`Scam check skipped (short msg, no URL): "${text.substring(0, 40)}"`, "telegram");
    return false;
  }

  const { isScam, reason } = await aiScamCheck(normalized, "regular_user");
  if (!isScam) return false;

  return await executeScamAction(msg, text, userName, groupRecord, `AI: ${reason}`);
}

async function handleMessage(msg: TelegramBot.Message) {
  try {
  if (!msg.text || !msg.chat || msg.chat.type === "private") return;
  if (msg.from?.is_bot) return;

  const config = await storage.getConfig();
  if (!config || !config.isActive) return;

  const chatId = msg.chat.id.toString();
  const userName = msg.from?.first_name || msg.from?.username || "Unknown";
  const messageText = msg.text;
  log(`Message from ${userName}: ${messageText.substring(0, 80)}`, "telegram");

  const group = await storage.getGroupByChatId(chatId);
  if (!group) {
    const memberCount = await bot!.getChatMemberCount(msg.chat.id).catch(() => 0);
    await storage.upsertGroup({
      telegramChatId: chatId,
      name: msg.chat.title || "Unknown",
      memberCount,
      isActive: true,
    });
  }
  const groupRecord = await storage.getGroupByChatId(chatId);

  if (messageText.startsWith("/")) {
    const handled = await handleCommand(msg, config, groupRecord);
    if (handled) return;
  }

  const scamDetected = await detectAndHandleScam(msg, messageText, userName, config, groupRecord);
  if (scamDetected) return;

  const deleteHandled = await handleDeleteRequest(msg, messageText, userName);
  if (deleteHandled) return;

  const isReport = checkIfReport(messageText, config);
  if (isReport && config.trackReports) {
    await storage.createActivityLog({
      groupId: groupRecord?.id || null,
      type: "report",
      userName,
      userMessage: messageText,
      botResponse: null,
      isReport: true,
      metadata: null,
    });
  }

  const shouldRespond = await shouldBotRespond(msg, config);
  if (!shouldRespond) {
    log(`Not responding to ${userName} (shouldRespond=false, mode=${config.responseMode})`, "telegram");
    return;
  }

  const userId = msg.from?.id?.toString() || "unknown";
  const cooldownKey = `${chatId}:${userId}`;
  const now = Date.now();
  const lastResponse = cooldowns.get(cooldownKey) || 0;
  if (now - lastResponse < config.cooldownSeconds * 1000) {
    log(`Skipping response to ${userName} (user cooldown: ${Math.ceil((config.cooldownSeconds * 1000 - (now - lastResponse)) / 1000)}s remaining)`, "telegram");
    return;
  }

  log(`Generating AI response for ${userName}...`, "telegram");
  try {
    let replyContext: string | null = null;
    let replyIsFromBot = false;
    if (msg.reply_to_message?.text) {
      const botInfo = await bot!.getMe();
      replyIsFromBot = msg.reply_to_message.from?.id === botInfo.id;
      const replyAuthor = replyIsFromBot
        ? config.botName
        : (msg.reply_to_message.from?.first_name || msg.reply_to_message.from?.username || "Someone");
      replyContext = `${replyAuthor} said: ${msg.reply_to_message.text}`;
    }

    const response = await generateAIResponse(messageText, userName, config, groupRecord?.name || "Unknown", replyContext, replyIsFromBot);
    if (response && response.trim() && response.trim() !== "[[SKIP]]") {
      log(`AI response ready for ${userName} (${response.length} chars), sending...`, "telegram");
      await sendBotMessage(msg.chat.id, response, msg.message_id);

      cooldowns.set(cooldownKey, now);

      await storage.createActivityLog({
        groupId: groupRecord?.id || null,
        type: "response",
        userName,
        userMessage: messageText,
        botResponse: response,
        isReport: false,
        metadata: null,
      });
      log(`Response sent to ${userName}`, "telegram");
    } else if (response && response.trim() === "[[SKIP]]") {
      log(`AI chose to skip response to ${userName} (trivial message)`, "telegram");
    } else {
      log(`AI returned empty response for ${userName}`, "telegram");
      await sendBotMessage(msg.chat.id, "Sorry, I couldn't process that. Try asking again.", msg.message_id);
    }
  } catch (err: any) {
    log(`Error generating response for ${userName}: ${err.message}`, "telegram");
    try {
      await sendBotMessage(msg.chat.id, "Something went wrong processing your message. Try again in a moment.", msg.message_id);
    } catch (_) {}
  }
  } catch (outerErr: any) {
    log(`CRITICAL: Unhandled error processing message from ${msg.from?.first_name || "unknown"}: ${outerErr.message}`, "telegram");
  }
}

async function handleDeleteRequest(msg: TelegramBot.Message, text: string, userName: string): Promise<boolean> {
  const botInfo = await bot!.getMe();
  const botUsername = botInfo.username || "";
  const isMentioned = text.includes(`@${botUsername}`);

  if (!isMentioned) return false;

  const deletePattern = /\b(delete|remove|del)\s*(this|that|it|the\s*message|msg)?\b/i;
  if (!deletePattern.test(text)) return false;

  if (!msg.reply_to_message) {
    await sendBotMessage(msg.chat.id, "Reply to the message you want me to delete.", msg.message_id);
    return true;
  }

  try {
    await bot!.deleteMessage(msg.chat.id, msg.reply_to_message.message_id);
    await bot!.deleteMessage(msg.chat.id, msg.message_id);
    log(`Deleted message on request from ${userName}`, "telegram");
  } catch (e: any) {
    log(`Could not delete message on request (bot may not be admin): ${e.message}`, "telegram");
    await sendBotMessage(msg.chat.id, "I don't have permission to delete that message — make sure I'm an admin with delete rights.", msg.message_id);
  }
  return true;
}

async function sendBotMessage(chatId: number | string, text: string, replyToMessageId?: number) {
  const opts: TelegramBot.SendMessageOptions = {};
  if (replyToMessageId) opts.reply_to_message_id = replyToMessageId;
  opts.parse_mode = "Markdown";
  try {
    await bot!.sendMessage(chatId, text, opts);
  } catch {
    delete opts.parse_mode;
    await bot!.sendMessage(chatId, text, opts);
  }
}

async function handleCommand(msg: TelegramBot.Message, config: BotConfig, groupRecord: any): Promise<boolean> {
  const text = msg.text || "";
  const chatId = msg.chat.id;
  const userName = msg.from?.first_name || msg.from?.username || "Unknown";
  const botInfo = await bot!.getMe();
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
    await sendBotMessage(chatId, intro, msg.message_id);
    await storage.createActivityLog({
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
    await sendBotMessage(chatId, helpText, msg.message_id);
    await storage.createActivityLog({
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
    await handleReportCommand(msg, config, groupRecord, userName, args);
    return true;
  }

  return false;
}

async function handleReportCommand(msg: TelegramBot.Message, config: BotConfig, groupRecord: any, userName: string, args: string) {
  const chatId = msg.chat.id;
  const reportedMsg = msg.reply_to_message;

  if (!reportedMsg) {
    await sendBotMessage(chatId, "To report a message, reply to the message you want to report with /report", msg.message_id);
    return;
  }

  const botInfo = await bot!.getMe();
  if (reportedMsg.from?.id === botInfo.id) {
    await sendBotMessage(chatId, "You can't report the bot's own messages.", msg.message_id);
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
        await bot!.deleteMessage(chatId, reportedMsg.message_id);
        actionTaken = "deleted";
        try {
          await bot!.deleteMessage(chatId, msg.message_id);
        } catch (_) {}
      } catch (deleteErr: any) {
        log(`Failed to delete reported message: ${deleteErr.message}`, "telegram");
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

    await sendBotMessage(chatId, responseText, msg.message_id);

    await storage.createActivityLog({
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
    await sendBotMessage(chatId, "Report logged. An admin will review this.", msg.message_id);
    await storage.createActivityLog({
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

This community values genuine utility, real growth, and authentic community support. Messages offering paid promotion, fake investor connections, market cap manipulation, or any "get rich quick" schemes should be treated as SPAM/SCAM and deleted.

Respond in this exact JSON format only:
{"shouldDelete": true/false, "reason": "brief 1-sentence explanation", "category": "SPAM|SCAM_PROMOTION|INAPPROPRIATE|OFF_TOPIC|LEGITIMATE"}

ALWAYS recommend deletion (shouldDelete: true) for SPAM, SCAM_PROMOTION, and INAPPROPRIATE messages — these should be removed immediately without hesitation. For OFF_TOPIC, only recommend deletion if it's clearly disruptive; otherwise flag it. Only mark as LEGITIMATE if the message is genuinely acceptable.`;

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

async function shouldBotRespond(msg: TelegramBot.Message, config: BotConfig): Promise<boolean> {
  if (!msg.text) return false;

  const botInfo = await bot!.getMe();
  const botUsername = botInfo.username || "";
  const isMentioned = msg.text.includes(`@${botUsername}`);
  const isReplyToBot = msg.reply_to_message?.from?.id === botInfo.id;

  if (config.onlyRespondWhenMentioned) {
    return isMentioned;
  }

  if (config.respondToReplies && isReplyToBot) {
    return true;
  }

  if (isMentioned) return true;

  if (config.responseMode === "always") return true;
  if (config.responseMode === "mentioned") return isMentioned;

  if (config.responseMode === "questions") {
    return msg.text.includes("?") || /^(what|how|why|when|where|who|can|is|are|do|does|will|would|should|could)\b/i.test(msg.text);
  }

  if (config.responseMode === "smart") {
    return isMentioned || isReplyToBot;
  }

  return false;
}

async function generateAIResponse(userMessage: string, userName: string, config: BotConfig, groupName: string, replyContext?: string | null, replyIsFromBot?: boolean): Promise<string> {
  const knowledgeEntries = await storage.getActiveKnowledgeEntries();

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
- NEVER talk about your moderation abilities, spam detection, or message deletion in normal responses. Don't say "I can delete", "I automatically detect", "I handle scam detection", or describe any of your internal capabilities. Just be a helpful assistant.
- ONLY if someone DIRECTLY asks "can you delete messages?" or "what can you do?" — then briefly confirm you help with moderation. Otherwise NEVER bring it up.
- NEVER claim you just "handled", "removed", or "deleted" a specific message. Scam detection is automatic and separate from your responses.
- If someone asks you about a link or message, give your honest opinion about it. Don't say "handled" or "taken care of" — share your actual thoughts.
- NEVER guess or improvise specific data like contract addresses, token prices, wallet addresses, stats, or numbers. If the exact data isn't in your context above, say "I don't have that specific info right now" — NEVER fabricate or confuse one address/number for another.
- NEVER ask users to send screenshots, timestamps, usernames, or "more details". Just answer directly.
- NEVER mention admins, admin review, or "flagging for admins".
- NEVER ask users to do anything — don't say "share the text", "provide details", "reply with examples", etc.
- If a message is trivial/casual with nothing useful to add (like "sorry", "ok", "lol", "thanks", "gm", emojis-only), just stay silent — respond with ONLY the text "[[SKIP]]" and nothing else. Don't engage with filler messages.
- If someone reports spam/scam, just acknowledge it briefly ("Got it, noted" or similar).
- Only say you don't know if the question is truly unrelated to ALL context above.
- Match the group's casual tone. Be direct, not corporate.
- If asked about an external link or promo, give your honest take on it.`;

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

    const choice = response.choices[0];
    const content = choice?.message?.content?.trim() || "";

    if (!content) {
      log(`Empty AI response — finish_reason: ${choice?.finish_reason}, refusal: ${(choice?.message as any)?.refusal || "none"}, choices: ${JSON.stringify(response.choices).substring(0, 300)}`, "telegram");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}
