import { log } from "../index";

export interface ChatMessage {
  role: "user" | "assistant";
  name: string;
  content: string;
  timestamp: number;
}

const MAX_MESSAGES_PER_GROUP = 50;
const MAX_MESSAGE_AGE_MS = 4 * 60 * 60 * 1000;

const histories = new Map<string, ChatMessage[]>();

function getKey(botConfigId: number, chatId: string): string {
  return `${botConfigId}:${chatId}`;
}

export function addMessage(botConfigId: number, chatId: string, message: ChatMessage): void {
  const key = getKey(botConfigId, chatId);
  let history = histories.get(key);
  if (!history) {
    history = [];
    histories.set(key, history);
  }

  history.push(message);

  if (history.length > MAX_MESSAGES_PER_GROUP) {
    history.splice(0, history.length - MAX_MESSAGES_PER_GROUP);
  }
}

export function getRecentMessages(botConfigId: number, chatId: string, limit: number = 20): ChatMessage[] {
  const key = getKey(botConfigId, chatId);
  const history = histories.get(key);
  if (!history || history.length === 0) return [];

  const cutoff = Date.now() - MAX_MESSAGE_AGE_MS;
  const recent = history.filter(m => m.timestamp >= cutoff);

  return recent.slice(-limit);
}

export function cleanupOldHistories(): void {
  const cutoff = Date.now() - MAX_MESSAGE_AGE_MS;
  let cleaned = 0;

  for (const [key, history] of histories.entries()) {
    const filtered = history.filter(m => m.timestamp >= cutoff);
    if (filtered.length === 0) {
      histories.delete(key);
      cleaned++;
    } else if (filtered.length < history.length) {
      histories.set(key, filtered);
    }
  }

  if (cleaned > 0) {
    log(`Conversation history cleanup: removed ${cleaned} empty group histories`, "telegram");
  }
}
