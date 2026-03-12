import TelegramBot from "node-telegram-bot-api";

export interface BotInstance {
  bot: TelegramBot;
  userId: string;
  botConfigId: number;
  token: string;
  webhookPath: string;
  botUsername: string;
  botTelegramId: number;
}
