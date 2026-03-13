import TelegramBot from "node-telegram-bot-api";

export interface GroupContext {
  description: string;
  pinnedMessage: string | null;
  fetchedAt: number;
}

export interface BotInstance {
  bot: TelegramBot;
  userId: string;
  botConfigId: number;
  token: string;
  webhookPath: string;
  botUsername: string;
  botTelegramId: number;
  groupContexts: Map<string, GroupContext>;
}
