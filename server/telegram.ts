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

async function handleMessage(msg: TelegramBot.Message) {
  if (!msg.text || !msg.chat || msg.chat.type === "private") return;
  if (msg.from?.is_bot) return;

  const config = await storage.getConfig();
  if (!config || !config.isActive) return;

  const chatId = msg.chat.id.toString();
  const userName = msg.from?.first_name || msg.from?.username || "Unknown";
  const messageText = msg.text;

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

  const cooldownKey = `${chatId}`;
  const now = Date.now();
  const lastResponse = cooldowns.get(cooldownKey) || 0;
  if (now - lastResponse < config.cooldownSeconds * 1000) return;

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
1. SPAM — unsolicited promotion, ads, scam links, repeated self-promotion
2. INAPPROPRIATE — offensive, hateful, harassing, or NSFW content
3. OFF_TOPIC — completely unrelated to the group's purpose (only if clearly irrelevant)
4. LEGITIMATE — the message is acceptable and doesn't violate guidelines

Respond in this exact JSON format only:
{"shouldDelete": true/false, "reason": "brief 1-sentence explanation", "category": "SPAM|INAPPROPRIATE|OFF_TOPIC|LEGITIMATE"}

Only recommend deletion for SPAM, INAPPROPRIATE, or clearly OFF_TOPIC messages. When in doubt, keep the message and flag for admin review.`;

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
- Match the tone of the conversation`;

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
