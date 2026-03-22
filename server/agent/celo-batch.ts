import TelegramBot from "node-telegram-bot-api";
import { pool } from "../db";
import { registerBotOnCelo } from "./celo";

interface BatchResult {
  botId: number;
  botName: string;
  status: "registered" | "skipped" | "failed";
  agentId?: number;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  announcementsSent?: number;
  announcementsFailed?: number;
}

async function getEligibleBots(): Promise<Array<{
  id: number;
  botName: string;
  botToken: string;
  celoTxHash: string | null;
  groupCount: number;
}>> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT bc.id, bc.bot_name, bc.bot_token, bc.celo_tx_hash,
        (SELECT COUNT(*) FROM groups g WHERE g.bot_config_id = bc.id AND g.is_active = true) as group_count
      FROM bot_configs bc
      WHERE bc.bot_token IS NOT NULL AND bc.bot_token != ''
        AND (SELECT COUNT(*) FROM groups g WHERE g.bot_config_id = bc.id AND g.is_active = true) > 0
      ORDER BY bc.id
    `);
    return rows.map(r => ({
      id: r.id,
      botName: r.bot_name,
      botToken: r.bot_token,
      celoTxHash: r.celo_tx_hash,
      groupCount: parseInt(r.group_count),
    }));
  } finally {
    client.release();
  }
}

async function getGroupsForBot(botId: number): Promise<Array<{ telegramChatId: string; name: string }>> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT telegram_chat_id, name FROM groups WHERE bot_config_id = $1 AND is_active = true`,
      [botId]
    );
    return rows.map(r => ({ telegramChatId: r.telegram_chat_id, name: r.name }));
  } finally {
    client.release();
  }
}

async function sendAnnouncementToGroups(
  botToken: string,
  botName: string,
  agentId: number,
  txHash: string,
  groups: Array<{ telegramChatId: string; name: string }>
): Promise<{ sent: number; failed: number }> {
  const bot = new TelegramBot(botToken);
  const explorerUrl = `https://celoscan.io/tx/${txHash}`;

  const message = [
    `*${botName}* now has a verified on-chain identity on Celo`,
    ``,
    `This bot has been registered on the ERC-8004 Agent Identity Registry — a blockchain standard for verifiable AI agent identities.`,
    ``,
    `Agent ID: *#${agentId}*`,
    `Chain: Celo`,
    `Registry: ERC-8004`,
    ``,
    `[View on Celoscan](${explorerUrl})`,
    ``,
    `_Powered by TeliGent — teli.gent_`,
  ].join("\n");

  let sent = 0;
  let failed = 0;

  for (const group of groups) {
    try {
      try {
        await bot.sendMessage(group.telegramChatId, message, { parse_mode: "Markdown" });
      } catch {
        const plainMessage = message
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/_([^_]+)_/g, "$1")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
        await bot.sendMessage(group.telegramChatId, plainMessage);
      }
      sent++;
      console.log(`[celo-batch] Announcement sent to "${group.name}" (${group.telegramChatId}) for ${botName}`);
    } catch (err: any) {
      failed++;
      console.error(`[celo-batch] Failed to send announcement to "${group.name}" (${group.telegramChatId}): ${err.message}`);
    }
  }

  return { sent, failed };
}

export async function batchRegisterAllBots(baseUrl: string): Promise<{
  results: BatchResult[];
  summary: { total: number; registered: number; skipped: number; failed: number; announcementsSent: number };
}> {
  console.log("[celo-batch] Starting batch ERC-8004 registration on Celo...");

  const bots = await getEligibleBots();
  console.log(`[celo-batch] Found ${bots.length} eligible bots with group activity`);

  const results: BatchResult[] = [];
  let totalAnnouncements = 0;

  for (const bot of bots) {
    if (bot.celoTxHash) {
      console.log(`[celo-batch] Skipping bot ${bot.id} (${bot.botName}) — already registered`);
      results.push({
        botId: bot.id,
        botName: bot.botName,
        status: "skipped",
      });
      continue;
    }

    console.log(`[celo-batch] Registering bot ${bot.id} (${bot.botName}) — ${bot.groupCount} groups...`);

    try {
      const { agentId, txHash } = await registerBotOnCelo(bot.id, baseUrl);
      console.log(`[celo-batch] Bot ${bot.id} (${bot.botName}) registered: agentId=${agentId}, tx=${txHash}`);

      let announcementsSent = 0;
      let announcementsFailed = 0;

      const groups = await getGroupsForBot(bot.id);
      if (groups.length > 0 && bot.botToken) {
        const announcementResult = await sendAnnouncementToGroups(
          bot.botToken,
          bot.botName,
          agentId,
          txHash,
          groups
        );
        announcementsSent = announcementResult.sent;
        announcementsFailed = announcementResult.failed;
        totalAnnouncements += announcementsSent;
      }

      results.push({
        botId: bot.id,
        botName: bot.botName,
        status: "registered",
        agentId,
        txHash,
        explorerUrl: `https://celoscan.io/tx/${txHash}`,
        announcementsSent,
        announcementsFailed,
      });

      await new Promise(r => setTimeout(r, 2000));
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("already registered")) {
        console.log(`[celo-batch] Bot ${bot.id} (${bot.botName}) was already registered (concurrent run?)`);
        results.push({
          botId: bot.id,
          botName: bot.botName,
          status: "skipped",
          error: msg,
        });
      } else {
        console.error(`[celo-batch] Failed to register bot ${bot.id} (${bot.botName}): ${msg}`);
        results.push({
          botId: bot.id,
          botName: bot.botName,
          status: "failed",
          error: msg,
        });
      }
    }
  }

  const summary = {
    total: results.length,
    registered: results.filter(r => r.status === "registered").length,
    skipped: results.filter(r => r.status === "skipped").length,
    failed: results.filter(r => r.status === "failed").length,
    announcementsSent: totalAnnouncements,
  };

  console.log(`[celo-batch] Batch complete: ${summary.registered} registered, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.announcementsSent} announcements sent`);

  return { results, summary };
}
