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
    const hasIsAdmin = await columnExists(client, "users", "is_admin");

    if (!hasIsAdmin) {
      log("Adding is_admin column to users table...");
      await client.query(`ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false`);
      const { rows: firstUser } = await client.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
      if (firstUser.length > 0) {
        await client.query(`UPDATE users SET is_admin = true WHERE id = $1`, [firstUser[0].id]);
        log(`Set first user ${firstUser[0].id} as admin`);
      }
      log("Added is_admin to users");
    } else {
      const { rows: adminCheck } = await client.query(`SELECT COUNT(*) as count FROM users WHERE is_admin = true`);
      if (parseInt(adminCheck[0].count) === 0) {
        const { rows: firstUser } = await client.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
        if (firstUser.length > 0) {
          await client.query(`UPDATE users SET is_admin = true WHERE id = $1`, [firstUser[0].id]);
          log(`No admin found — promoted first user ${firstUser[0].id} to admin`);
        }
      }
    }

    if (hasBotConfigIdOnKB && hasBotConfigIdOnGroups && hasBotConfigIdOnLogs) {
      await backfillBotConfigIds(client);
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

async function columnExists(client: any, table: string, column: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}
