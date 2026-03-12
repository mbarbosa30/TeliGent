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

async function columnExists(client: any, table: string, column: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}
