import { createWalletClient, createPublicClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { pool } from "../db";

const REGISTRY_ADDRESS = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

const REGISTRY_ABI = parseAbi([
  "function register(string agentURI) external returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

interface BotRegistrationData {
  botId: number;
  botName: string;
  description: string;
  groupsProtected: number;
  membersServed: number;
  conversationsHandled: number;
  knowledgeEntries: number;
  capabilities: string[];
}

export interface RegistrationOverrides {
  nameOverride?: string;
  descriptionOverride?: string;
  imageUrl?: string;
  externalUrl?: string;
}

function buildAgentURI(data: BotRegistrationData, baseUrl: string, overrides?: RegistrationOverrides): string {
  const name = overrides?.nameOverride || data.botName;
  const description = overrides?.descriptionOverride || data.description;
  const image = overrides?.imageUrl || null;
  const externalUrl = overrides?.externalUrl || "https://teli.gent";

  const metadata: Record<string, any> = {
    name,
    description,
    external_url: externalUrl,
    attributes: [
      { trait_type: "Platform", value: "TeliGent" },
      { trait_type: "Chain", value: "Celo" },
      { trait_type: "Registry", value: "ERC-8004" },
      { trait_type: "Groups Protected", value: data.groupsProtected, display_type: "number" },
      { trait_type: "Members Served", value: data.membersServed, display_type: "number" },
      { trait_type: "Conversations Handled", value: data.conversationsHandled, display_type: "number" },
      { trait_type: "Knowledge Entries", value: data.knowledgeEntries, display_type: "number" },
      ...data.capabilities.map(c => ({ trait_type: "Capability", value: c })),
    ],
    properties: {
      botId: data.botId,
      endpoints: {
        platform: baseUrl,
        identity: `${baseUrl}/api/agent/identity`,
        agentCard: `${baseUrl}/.well-known/agent.json`,
      },
      registry: REGISTRY_ADDRESS,
      communication: {
        website: "https://teli.gent",
        telegram: "https://t.me/teli_gent",
        twitter: "https://x.com/Teli_Gent_",
      },
      operator: {
        name: "TeliGent",
        url: "https://teli.gent",
      },
    },
  };

  if (image) {
    metadata.image = image;
  }

  const jsonStr = JSON.stringify(metadata);
  const base64 = Buffer.from(jsonStr).toString("base64");
  return `data:application/json;base64,${base64}`;
}

async function getBotStats(botId: number): Promise<BotRegistrationData> {
  const client = await pool.connect();
  try {
    const [botResult, groupResult, memberResult, activityResult, kbResult] = await Promise.all([
      client.query(`SELECT bot_name, personality FROM bot_configs WHERE id = $1`, [botId]),
      client.query(`SELECT COUNT(*) as count FROM groups WHERE bot_config_id = $1`, [botId]),
      client.query(`SELECT COALESCE(SUM(member_count), 0) as total FROM groups WHERE bot_config_id = $1`, [botId]),
      client.query(`SELECT COUNT(*) as count FROM activity_logs WHERE bot_config_id = $1`, [botId]),
      client.query(`SELECT COUNT(*) as count FROM knowledge_base WHERE bot_config_id = $1`, [botId]),
    ]);

    const bot = botResult.rows[0];
    if (!bot) throw new Error(`Bot ${botId} not found`);

    return {
      botId,
      botName: bot.bot_name,
      description: `${bot.bot_name} — AI-powered Telegram community agent by TeliGent. Protects ${groupResult.rows[0].count} groups with ${parseInt(memberResult.rows[0].total)} members. Scam detection, content moderation, and knowledge-based assistance.`,
      groupsProtected: parseInt(groupResult.rows[0].count),
      membersServed: parseInt(memberResult.rows[0].total),
      conversationsHandled: parseInt(activityResult.rows[0].count),
      knowledgeEntries: parseInt(kbResult.rows[0].count),
      capabilities: [
        "scam_detection",
        "community_moderation",
        "knowledge_base_qa",
        "real_time_learning",
        "homoglyph_normalization",
        "impersonation_detection",
      ],
    };
  } finally {
    client.release();
  }
}

export async function registerBotOnCelo(botId: number, baseUrl: string, overrides?: RegistrationOverrides & { force?: boolean }): Promise<{
  agentId: number;
  txHash: string;
}> {
  const privateKey = process.env.CELO_WALLET_PRIVATE_KEY;
  if (!privateKey) throw new Error("CELO_WALLET_PRIVATE_KEY is not configured");

  const botData = await getBotStats(botId);
  if (botData.groupsProtected === 0) {
    throw new Error("Bot has no group activity. Only bots with at least one active group can be registered on Celo.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: lockRows } = await client.query(
      `SELECT celo_tx_hash FROM bot_configs WHERE id = $1 FOR UPDATE`,
      [botId]
    );
    if (lockRows[0]?.celo_tx_hash && !overrides?.force) {
      await client.query("ROLLBACK");
      throw new Error("Bot is already registered on Celo");
    }
    if (lockRows[0]?.celo_tx_hash && overrides?.force) {
      await client.query(
        `UPDATE bot_configs SET celo_agent_id = NULL, celo_tx_hash = NULL, celo_registered_at = NULL WHERE id = $1`,
        [botId]
      );
      console.log(`[erc8004] Force mode: cleared old registration for bot ${botId}`);
    }

    const formattedKey = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
    const account = privateKeyToAccount(formattedKey);

    const walletClient = createWalletClient({
      account,
      chain: celo,
      transport: http(),
    });

    const publicClient = createPublicClient({
      chain: celo,
      transport: http(),
    });

    const agentURI = buildAgentURI(botData, baseUrl, overrides);

    const txHash = await walletClient.writeContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "register",
      args: [agentURI],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      await client.query("ROLLBACK");
      throw new Error(`Transaction reverted: ${txHash}`);
    }

    let agentId = 0;
    for (const log of receipt.logs) {
      try {
        if (
          log.address.toLowerCase() === REGISTRY_ADDRESS.toLowerCase() &&
          log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        ) {
          const parsed = Number(BigInt(log.topics[3] || "0"));
          if (parsed > 0) {
            agentId = parsed;
            break;
          }
        }
      } catch (e) {
        console.error("[erc8004] Error parsing Transfer event log:", e);
      }
    }

    if (agentId === 0) {
      await client.query("ROLLBACK");
      throw new Error(`Registration transaction succeeded but could not extract agent ID from receipt: ${txHash}`);
    }

    await client.query(
      `UPDATE bot_configs SET celo_agent_id = $1, celo_tx_hash = $2, celo_registered_at = NOW() WHERE id = $3`,
      [agentId, txHash, botId]
    );

    await client.query("COMMIT");
    return { agentId, txHash };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getCeloRegistrationStatus(botId: number): Promise<{
  registered: boolean;
  agentId: number | null;
  txHash: string | null;
  registeredAt: string | null;
  explorerUrl: string | null;
}> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT celo_agent_id, celo_tx_hash, celo_registered_at FROM bot_configs WHERE id = $1`,
      [botId]
    );
    if (!rows[0]) return { registered: false, agentId: null, txHash: null, registeredAt: null, explorerUrl: null };

    const row = rows[0];
    const registered = !!row.celo_tx_hash;
    return {
      registered,
      agentId: row.celo_agent_id || null,
      txHash: row.celo_tx_hash || null,
      registeredAt: row.celo_registered_at ? new Date(row.celo_registered_at).toISOString() : null,
      explorerUrl: row.celo_tx_hash ? `https://celoscan.io/tx/${row.celo_tx_hash}` : null,
    };
  } finally {
    client.release();
  }
}
