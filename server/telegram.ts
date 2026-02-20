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

  try {
    const appUrl = isProduction ? getAppUrl() : null;
    const useWebhook = isProduction && app && appUrl;

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
      if (isProduction && !appUrl) {
        log("No APP_URL or REPLIT_DOMAINS found in production, falling back to polling", "telegram");
      }

      const tempBot = new TelegramBot(token);
      try {
        await tempBot.deleteWebHook();
        log("Cleared existing webhook before starting polling", "telegram");
      } catch (e: any) {
        log(`Warning: could not clear webhook: ${e.message}`, "telegram");
      }

      bot = new TelegramBot(token, { polling: true });

      bot.on("polling_error", (err) => {
        log(`Polling error: ${err.message}`, "telegram");
      });
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

const SCAM_PATTERNS: { pattern: RegExp; weight: number; label: string }[] = [
  { pattern: /\b(contract\s*(address|upgrade|migration))\b/i, weight: 3, label: "contract migration" },
  { pattern: /\b(v2\s*(airdrop|contract|token|upgrade|migration))\b/i, weight: 3, label: "v2 migration scam" },
  { pattern: /\b(PM\s*me|DM\s*me|message\s*me)\b.*\b(token|airdrop|register|secure|claim)\b/i, weight: 4, label: "PM-for-tokens" },
  { pattern: /\b(register\s*now|claim\s*now|act\s*now|hurry)\b.*\b(token|airdrop|reward)\b/i, weight: 3, label: "urgency scam" },
  { pattern: /\b(no\s*registration.*no\s*airdrop)\b/i, weight: 4, label: "conditional airdrop threat" },
  { pattern: /\b(send|transfer)\s*\d+\s*(ETH|BTC|SOL|BNB|USDT|USDC)\b/i, weight: 5, label: "send-crypto scam" },
  { pattern: /\b(validate|verify|sync)\s*(your\s*)?(wallet|metamask)\b/i, weight: 5, label: "wallet phishing" },
  { pattern: /\b(connect\s*wallet)\b.*\b(claim|airdrop|reward|token)\b/i, weight: 4, label: "connect-wallet scam" },
  { pattern: /\b(guaranteed\s*(return|profit|gain)|100x|1000x|moonshot)\b/i, weight: 3, label: "guaranteed returns" },
  { pattern: /\b(market\s*cap|mcap)\b.*\b(\d+[kmb]|\d{5,})\b/i, weight: 2, label: "market cap promise" },
  { pattern: /\b(DM\s*(me|us)|PM\s*(me|us))\b.*\b(invest|market|promot|listing|shill)\b/i, weight: 4, label: "paid promotion DM" },
  { pattern: /\b(fake|free)\s*(investor|investment)\b/i, weight: 3, label: "fake investors" },
  { pattern: /\b(I\s*can\s*(get|help)\s*(you|your))\b.*\b(investor|listing|exchange|volume|pump)\b/i, weight: 4, label: "service scam" },
  { pattern: /\b(earn\s*\$?\d+\s*(daily|hourly|weekly))\b/i, weight: 4, label: "earnings promise" },
  { pattern: /\b(private\s*sale|pre-?sale)\b.*\b(token|coin|join|register)\b/i, weight: 3, label: "presale scam" },
  { pattern: /\b(snapshot|migrate|swap)\b.*\b(within\s*\d+\s*(hour|day|minute))\b/i, weight: 3, label: "time-pressure migration" },
];

const SCAM_THRESHOLD = 5;

function detectScamPatterns(text: string): { isScam: boolean; score: number; matches: string[] } {
  let score = 0;
  const matches: string[] = [];

  for (const { pattern, weight, label } of SCAM_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
      matches.push(label);
    }
  }

  const warningEmojis = (text.match(/🚨|⚠️|🔥|🚀|💰|💎|⚡|💸|🤑/g) || []).length;
  if (warningEmojis >= 3) {
    score += 1;
    matches.push("alarm emojis");
  }

  return { isScam: score >= SCAM_THRESHOLD, score, matches };
}

async function detectAndHandleScam(
  msg: TelegramBot.Message,
  text: string,
  userName: string,
  config: BotConfig,
  groupRecord: any
): Promise<boolean> {
  const { isScam, score, matches } = detectScamPatterns(text);
  if (!isScam) return false;

  try {
    const member = await bot!.getChatMember(msg.chat.id, msg.from!.id);
    if (["creator", "administrator"].includes(member.status)) {
      log(`Scam patterns matched but sender ${userName} is ${member.status} — skipping`, "telegram");
      return false;
    }
  } catch (e: any) {
    log(`Could not check sender role: ${e.message}`, "telegram");
  }

  log(`SCAM DETECTED from ${userName} (score: ${score}, flags: ${matches.join(", ")}): ${text.substring(0, 100)}`, "telegram");

  let deleted = false;
  try {
    await bot!.deleteMessage(msg.chat.id, msg.message_id);
    deleted = true;
    log(`Deleted scam message from ${userName}`, "telegram");
  } catch (e: any) {
    log(`Could not delete scam message (bot may not be admin): ${e.message}`, "telegram");
  }

  const warningText = deleted
    ? `⚠️ A message from ${userName} was automatically removed — it matched scam/spam patterns (${matches.slice(0, 3).join(", ")}). Stay safe: never share wallet keys or send crypto to strangers.`
    : `⚠️ Warning: The message above from ${userName} looks like a scam/spam (${matches.slice(0, 3).join(", ")}). Do NOT click links, send crypto, or DM anyone offering tokens. Admins, please review.`;

  try {
    await sendBotMessage(msg.chat.id, warningText);
  } catch (e: any) {
    log(`Could not send scam warning: ${e.message}`, "telegram");
  }

  await storage.createActivityLog({
    groupId: groupRecord?.id || null,
    type: "report",
    userName,
    userMessage: text,
    botResponse: warningText,
    isReport: true,
    metadata: JSON.stringify({ autoDetected: true, scamScore: score, flags: matches }),
  });

  return true;
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
  if (!shouldRespond) return;

  const userId = msg.from?.id?.toString() || "unknown";
  const cooldownKey = `${chatId}:${userId}`;
  const now = Date.now();
  const lastResponse = cooldowns.get(cooldownKey) || 0;
  if (now - lastResponse < config.cooldownSeconds * 1000) {
    log(`Skipping response to ${userName} (user cooldown: ${Math.ceil((config.cooldownSeconds * 1000 - (now - lastResponse)) / 1000)}s remaining)`, "telegram");
    return;
  }

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
    if (response && response.trim()) {
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
    }
  } catch (err: any) {
    log(`Error generating response: ${err.message}`, "telegram");
  }
  } catch (outerErr: any) {
    log(`CRITICAL: Unhandled error processing message from ${msg.from?.first_name || "unknown"}: ${outerErr.message}`, "telegram");
  }
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
• Ask a question (messages with ?) and I may respond in smart mode`;
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
      } catch (deleteErr: any) {
        log(`Failed to delete reported message: ${deleteErr.message}`, "telegram");
        actionTaken = "flagged (could not delete — bot may need admin rights)";
      }
    }

    let responseText: string;
    if (actionTaken === "deleted") {
      responseText = `Report received. The message from ${reportedAuthor} was removed — ${assessment.reason}`;
    } else if (actionTaken.includes("could not delete")) {
      responseText = `Report received. The message should be removed but I don't have admin rights to delete messages. An admin should review this. ${assessment.reason}`;
    } else {
      responseText = `Report received and logged for admin review. ${assessment.reason}`;
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

Recommend deletion for SPAM, SCAM_PROMOTION, or INAPPROPRIATE messages. When in doubt about OFF_TOPIC, flag for admin review.`;

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
    return isMentioned || isReplyToBot || msg.text.includes("?") || /^(what|how|why|when|where|who|can|is|are|do|does|help)\b/i.test(msg.text);
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

--- BEHAVIOR RULES ---
- Always use the context provided above to answer questions. You have detailed knowledge about this project/community — use it confidently.
- Keep responses concise (under ${config.maxResponseLength} characters)
- Be helpful but not spammy
- If someone is reporting an issue, acknowledge it and note what they reported
- Only say you don't know if the question is truly unrelated to any of the context above
- Don't repeat information unnecessarily
- Match the tone of the conversation
- Do NOT engage positively with spam, scam promotions, or "DM me for investors/marketing" type messages. If someone offers paid promotion, fake investors, market cap promises, or shilling services, politely shut it down — this community is focused on genuine utility and organic growth, not paid pumps or fake engagement.`;

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

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages,
    max_completion_tokens: 500,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}
