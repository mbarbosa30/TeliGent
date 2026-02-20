import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { storage } from "./storage";
import { log } from "./index";
import type { BotConfig } from "@shared/schema";

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

export async function startTelegramBot() {
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

  try {
    bot = new TelegramBot(token, { polling: true });
    const me = await bot.getMe();
    log(`Telegram bot started: @${me.username}`, "telegram");

    await storage.upsertConfig({ botName: me.first_name || "Bot" });

    bot.on("message", handleMessage);
    bot.on("new_chat_members", handleNewMembers);
    bot.on("left_chat_member", handleLeftMember);

    bot.on("polling_error", (err) => {
      log(`Polling error: ${err.message}`, "telegram");
    });
  } catch (err: any) {
    log(`Failed to start Telegram bot: ${err.message}`, "telegram");
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
    const response = await generateAIResponse(messageText, userName, config, groupRecord?.name || "Unknown");
    if (response && response.trim()) {
      await bot!.sendMessage(msg.chat.id, response, {
        reply_to_message_id: msg.message_id,
        parse_mode: "Markdown",
      }).catch(async () => {
        await bot!.sendMessage(msg.chat.id, response, {
          reply_to_message_id: msg.message_id,
        });
      });

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

async function generateAIResponse(userMessage: string, userName: string, config: BotConfig, groupName: string): Promise<string> {
  const knowledgeEntries = await storage.getActiveKnowledgeEntries();

  let knowledgeContext = "";
  if (knowledgeEntries.length > 0) {
    knowledgeContext = "\n\n--- KNOWLEDGE BASE ---\n" +
      knowledgeEntries.map(e => {
        let entry = `[${e.category}] ${e.title}:\n${e.content}`;
        if (e.sourceUrl) entry += `\nSource: ${e.sourceUrl}`;
        return entry;
      }).join("\n\n");
  }

  const systemPrompt = `${config.personality}

You are a bot assistant in the Telegram group "${groupName}".
Your name is "${config.botName}".

Important rules:
- Keep responses concise (under ${config.maxResponseLength} characters)
- Be helpful but not spammy
- If someone is reporting an issue, acknowledge it and note what they reported
- If you don't know something, say so honestly
- Use the knowledge base below to answer questions when relevant
- Don't repeat information unnecessarily
- Match the tone of the conversation
${knowledgeContext}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${userName} says: ${userMessage}` },
    ],
    max_completion_tokens: 500,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}
