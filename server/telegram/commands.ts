import TelegramBot from "node-telegram-bot-api";
import { storage } from "../storage";
import { log } from "../index";
import type { BotConfig } from "@shared/schema";
import type { BotInstance } from "./types";
import { openai, sendBotMessage } from "./utils";
import { normalizeUnicode } from "./normalization";
import { runDeterministicScamCheck, extractKeyPhrases, clearLearnedPatternsCache } from "./scam-detection";

export { sendBotMessage };

export async function handleDeleteRequest(bot: TelegramBot, msg: TelegramBot.Message, text: string, userName: string, instance: BotInstance): Promise<boolean> {
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

export async function handleCommand(bot: TelegramBot, msg: TelegramBot.Message, config: BotConfig, groupRecord: any, userId: string, botConfigId: number, instance: BotInstance): Promise<boolean> {
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

export function checkIfReport(text: string, config: BotConfig): boolean {
  const lower = text.toLowerCase();
  const keywords = config.reportKeywords || ["report", "issue", "bug", "problem", "broken"];
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

export async function shouldBotRespond(msg: TelegramBot.Message, config: BotConfig, instance: BotInstance): Promise<boolean> {
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

export async function generateAIResponse(botConfigId: number, userMessage: string, userName: string, config: BotConfig, groupName: string, botUsername: string, replyContext?: string | null, replyIsFromBot?: boolean): Promise<string> {
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
