import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function sendBotMessage(bot: TelegramBot, chatId: number | string, text: string, replyToMessageId?: number) {
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
