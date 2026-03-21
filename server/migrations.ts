import { pool } from "./db";

function log(message: string) {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [migrations] ${message}`);
}

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await ensureBotMemoriesTable(client);
    await ensureWidgetColumns(client);
    await ensureWidgetTables(client);
    await ensureAgentServiceLogsTable(client);

    const hasBotConfigIdOnKB = await columnExists(client, "knowledge_base", "bot_config_id");
    const hasBotConfigIdOnGroups = await columnExists(client, "groups", "bot_config_id");
    const hasBotConfigIdOnLogs = await columnExists(client, "activity_logs", "bot_config_id");
    if (hasBotConfigIdOnKB && hasBotConfigIdOnGroups && hasBotConfigIdOnLogs) {
      await backfillBotConfigIds(client);
      await addNotNullConstraints(client);
      await createIndexes(client);
      log("Migration check complete — all columns present");
      return;
    }

    log("Running schema migration: adding bot_config_id columns...");

    await client.query("BEGIN");

    if (!hasBotConfigIdOnKB) {
      await client.query(`ALTER TABLE knowledge_base ADD COLUMN bot_config_id INTEGER REFERENCES bot_configs(id) ON DELETE CASCADE`);
      log("Added bot_config_id to knowledge_base");
    }

    if (!hasBotConfigIdOnGroups) {
      await client.query(`ALTER TABLE groups ADD COLUMN bot_config_id INTEGER REFERENCES bot_configs(id) ON DELETE CASCADE`);
      log("Added bot_config_id to groups");
    }

    if (!hasBotConfigIdOnLogs) {
      await client.query(`ALTER TABLE activity_logs ADD COLUMN bot_config_id INTEGER REFERENCES bot_configs(id) ON DELETE CASCADE`);
      log("Added bot_config_id to activity_logs");
    }

    await client.query("COMMIT");

    await backfillBotConfigIds(client);
    await addNotNullConstraints(client);
    await createIndexes(client);

    log("Schema migration complete");
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    log(`Migration error: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

async function backfillBotConfigIds(client: any) {
  const { rows: nullKB } = await client.query(
    `SELECT COUNT(*) as count FROM knowledge_base WHERE bot_config_id IS NULL`
  );
  const { rows: nullGroups } = await client.query(
    `SELECT COUNT(*) as count FROM groups WHERE bot_config_id IS NULL`
  );
  const { rows: nullLogs } = await client.query(
    `SELECT COUNT(*) as count FROM activity_logs WHERE bot_config_id IS NULL`
  );

  const totalNull = parseInt(nullKB[0].count) + parseInt(nullGroups[0].count) + parseInt(nullLogs[0].count);
  if (totalNull === 0) return;

  log(`Backfilling bot_config_id for ${totalNull} rows...`);

  await client.query("BEGIN");

  await client.query(`
    UPDATE knowledge_base kb
    SET bot_config_id = (
      SELECT bc.id FROM bot_configs bc
      WHERE bc.user_id = kb.user_id
      ORDER BY bc.created_at ASC
      LIMIT 1
    )
    WHERE kb.bot_config_id IS NULL
  `);

  await client.query(`
    UPDATE groups g
    SET bot_config_id = (
      SELECT bc.id FROM bot_configs bc
      WHERE bc.user_id = g.user_id
      ORDER BY bc.created_at ASC
      LIMIT 1
    )
    WHERE g.bot_config_id IS NULL
  `);

  await client.query(`
    UPDATE activity_logs al
    SET bot_config_id = (
      SELECT bc.id FROM bot_configs bc
      WHERE bc.user_id = al.user_id
      ORDER BY bc.created_at ASC
      LIMIT 1
    )
    WHERE al.bot_config_id IS NULL
  `);

  await client.query("COMMIT");

  log("Backfill complete");
}

async function addNotNullConstraints(client: any) {
  const tables = [
    { table: "knowledge_base", column: "bot_config_id" },
    { table: "groups", column: "bot_config_id" },
    { table: "activity_logs", column: "bot_config_id" },
  ];
  for (const { table, column } of tables) {
    try {
      const { rows } = await client.query(
        `SELECT COUNT(*) as count FROM ${table} WHERE ${column} IS NULL`
      );
      if (parseInt(rows[0].count) > 0) {
        log(`Skipping NOT NULL on ${table}.${column}: ${rows[0].count} null rows remain`);
        continue;
      }
      await client.query(`ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL`);
    } catch (err: any) {
      if (!err.message.includes("is already")) {
        log(`NOT NULL constraint on ${table}.${column}: ${err.message}`);
      }
    }
  }

  try {
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_bot_config_chat_unique ON groups (bot_config_id, telegram_chat_id)`
    );
  } catch (err: any) {
    log(`Unique constraint on groups: ${err.message}`);
  }
}

async function createIndexes(client: any) {
  const indexes = [
    { name: "idx_bot_configs_user_id", sql: "CREATE INDEX IF NOT EXISTS idx_bot_configs_user_id ON bot_configs (user_id)" },
    { name: "idx_bot_configs_is_active", sql: "CREATE INDEX IF NOT EXISTS idx_bot_configs_is_active ON bot_configs (is_active)" },
    { name: "idx_knowledge_base_bot_config_id", sql: "CREATE INDEX IF NOT EXISTS idx_knowledge_base_bot_config_id ON knowledge_base (bot_config_id)" },
    { name: "idx_groups_bot_config_chat", sql: "CREATE INDEX IF NOT EXISTS idx_groups_bot_config_chat ON groups (bot_config_id, telegram_chat_id)" },
    { name: "idx_activity_logs_bot_config_created", sql: "CREATE INDEX IF NOT EXISTS idx_activity_logs_bot_config_created ON activity_logs (bot_config_id, created_at)" },
    { name: "idx_activity_logs_telegram_user", sql: "CREATE INDEX IF NOT EXISTS idx_activity_logs_telegram_user ON activity_logs (bot_config_id, telegram_user_id)" },
    { name: "idx_reported_scam_patterns_bot_config_id", sql: "CREATE INDEX IF NOT EXISTS idx_reported_scam_patterns_bot_config_id ON reported_scam_patterns (bot_config_id)" },
  ];

  let created = 0;
  for (const idx of indexes) {
    try {
      await client.query(idx.sql);
      created++;
    } catch (err: any) {
      log(`Index ${idx.name} error: ${err.message}`);
    }
  }
  if (created > 0) {
    log(`Ensured ${created} database indexes exist`);
  }
}

async function ensureBotMemoriesTable(client: any) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'bot_memories'`
  );
  if (rows.length > 0) return;

  log("Creating bot_memories table...");
  await client.query(`
    CREATE TABLE bot_memories (
      id SERIAL PRIMARY KEY,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'insight',
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto',
      confidence INTEGER NOT NULL DEFAULT 70,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_bot_memories_bot_config_id ON bot_memories (bot_config_id)`);
  log("Created bot_memories table");
}

async function ensureWidgetColumns(client: any) {
  if (!(await columnExists(client, "bot_configs", "widget_enabled"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN widget_enabled BOOLEAN NOT NULL DEFAULT false`);
    log("Added widget_enabled to bot_configs");
  }
  if (!(await columnExists(client, "bot_configs", "widget_key"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN widget_key VARCHAR(64)`);
    log("Added widget_key to bot_configs");
  }
}

async function ensureWidgetTables(client: any) {
  const { rows: convRows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'widget_conversations'`
  );
  if (convRows.length === 0) {
    log("Creating widget_conversations table...");
    await client.query(`
      CREATE TABLE widget_conversations (
        id SERIAL PRIMARY KEY,
        bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
        session_id VARCHAR(64) NOT NULL,
        visitor_name TEXT,
        page_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_widget_conversations_bot_config_id ON widget_conversations (bot_config_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_widget_conversations_session ON widget_conversations (bot_config_id, session_id)`);
    log("Created widget_conversations table");
  }

  const { rows: msgRows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'widget_messages'`
  );
  if (msgRows.length === 0) {
    log("Creating widget_messages table...");
    await client.query(`
      CREATE TABLE widget_messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES widget_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_widget_messages_conversation_id ON widget_messages (conversation_id)`);
    log("Created widget_messages table");
  }
}

async function ensureAgentServiceLogsTable(client: any) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_service_logs'`
  );
  if (rows.length === 0) {
    await client.query(`
      CREATE TABLE agent_service_logs (
        id SERIAL PRIMARY KEY,
        service TEXT NOT NULL,
        caller_identifier TEXT,
        input_length INTEGER,
        is_scam BOOLEAN,
        method TEXT,
        reason TEXT,
        pricing_tier TEXT NOT NULL DEFAULT 'free',
        amount_usdc TEXT DEFAULT '0',
        payment_id TEXT,
        payment_verified BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_service_logs_created ON agent_service_logs (created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_service_logs_service ON agent_service_logs (service)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_service_logs_payment_id ON agent_service_logs (payment_id) WHERE payment_id IS NOT NULL`);
    log("Created agent_service_logs table");
  } else {
    const hasPaymentId = await columnExists(client, "agent_service_logs", "payment_id");
    if (!hasPaymentId) {
      await client.query(`ALTER TABLE agent_service_logs ADD COLUMN payment_id TEXT`);
      await client.query(`ALTER TABLE agent_service_logs ADD COLUMN payment_verified BOOLEAN DEFAULT false`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_service_logs_payment_id ON agent_service_logs (payment_id) WHERE payment_id IS NOT NULL`);
      log("Added payment_id and payment_verified columns to agent_service_logs");
    }
  }
}

async function columnExists(client: any, table: string, column: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}
