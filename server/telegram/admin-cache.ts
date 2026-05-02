import type TelegramBot from "node-telegram-bot-api";
import { log } from "../index";

const ADMIN_TTL_MS = 30 * 60 * 1000;

interface AdminEntry {
  ids: Set<string>;
  fetchedAt: number;
}

const cache = new Map<string, AdminEntry>();

function cacheKey(botConfigId: number, chatId: string | number): string {
  return `${botConfigId}:${chatId}`;
}

export async function getGroupAdminIds(
  bot: TelegramBot,
  botConfigId: number,
  chatId: string | number,
): Promise<Set<string>> {
  const key = cacheKey(botConfigId, chatId);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < ADMIN_TTL_MS) {
    return hit.ids;
  }
  try {
    const admins = await bot.getChatAdministrators(chatId);
    const ids = new Set<string>();
    for (const a of admins) {
      if (a.user?.id != null) ids.add(String(a.user.id));
    }
    cache.set(key, { ids, fetchedAt: now });
    return ids;
  } catch (err: any) {
    log(`Admin cache fetch failed for ${key}: ${err.message}`, "telegram");
    if (hit) return hit.ids;
    cache.set(key, { ids: new Set(), fetchedAt: now });
    return new Set();
  }
}

export async function isUserGroupAdmin(
  bot: TelegramBot,
  botConfigId: number,
  chatId: string | number,
  userId: string | number,
): Promise<boolean> {
  const ids = await getGroupAdminIds(bot, botConfigId, chatId);
  return ids.has(String(userId));
}

export function invalidateAdminCache(botConfigId: number, chatId: string | number): void {
  cache.delete(cacheKey(botConfigId, chatId));
}
