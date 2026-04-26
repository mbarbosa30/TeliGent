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
    await ensureCeloColumns(client);
    await ensureHelixaColumns(client);
    await ensureBankrColumns(client);
    await ensureRewardsColumns(client);
    await ensureRewardsTables(client);
    await ensureFeedbackColumnsAndTable(client);
    await ensureScamSensitivityColumn(client);
    await ensureScamAllowlistTable(client);
    await ensureWidgetAllowedOriginsColumn(client);
    await ensureAiUsageDailyTable(client);
    await ensureBillingSchema(client);

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
    // Replay protection: a single on-chain tx hash can only ever back ONE matched
    // crypto intent. Partial index keeps pending/expired rows free of constraint.
    { name: "idx_plan_payment_intents_matched_tx_unique", sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_payment_intents_matched_tx_unique ON plan_payment_intents (tx_hash) WHERE status = 'matched' AND tx_hash IS NOT NULL" },
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
        self_verified BOOLEAN DEFAULT false,
        self_agent_address TEXT,
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
    const hasSelfVerified = await columnExists(client, "agent_service_logs", "self_verified");
    if (!hasSelfVerified) {
      await client.query(`ALTER TABLE agent_service_logs ADD COLUMN self_verified BOOLEAN DEFAULT false`);
      await client.query(`ALTER TABLE agent_service_logs ADD COLUMN self_agent_address TEXT`);
      log("Added self_verified and self_agent_address columns to agent_service_logs");
    }
  }
}

async function ensureCeloColumns(client: any) {
  if (!(await columnExists(client, "bot_configs", "celo_agent_id"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN celo_agent_id INTEGER`);
    log("Added celo_agent_id to bot_configs");
  }
  if (!(await columnExists(client, "bot_configs", "celo_tx_hash"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN celo_tx_hash TEXT`);
    log("Added celo_tx_hash to bot_configs");
  }
  if (!(await columnExists(client, "bot_configs", "celo_registered_at"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN celo_registered_at TIMESTAMP`);
    log("Added celo_registered_at to bot_configs");
  }
}

async function ensureBankrColumns(client: any) {
  if (!(await columnExists(client, "bot_configs", "bankr_enabled"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN bankr_enabled BOOLEAN NOT NULL DEFAULT false`);
    log("Added bankr_enabled to bot_configs");
  }
  if (!(await columnExists(client, "bot_configs", "bankr_api_key"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN bankr_api_key TEXT`);
    log("Added bankr_api_key to bot_configs");
  }
}

async function ensureRewardsColumns(client: any) {
  const cols: Array<[string, string]> = [
    ["rewards_enabled", "BOOLEAN NOT NULL DEFAULT false"],
    ["reward_token_chain", "TEXT NOT NULL DEFAULT 'base'"],
    ["reward_token_address", "TEXT DEFAULT ''"],
    ["reward_token_symbol", "TEXT DEFAULT ''"],
    ["reward_token_decimals", "INTEGER NOT NULL DEFAULT 18"],
    ["reward_period_days", "INTEGER NOT NULL DEFAULT 7"],
    ["reward_top_n", "INTEGER NOT NULL DEFAULT 5"],
    ["reward_amount_per_winner", "TEXT DEFAULT '0'"],
    ["reward_pool_per_period", "TEXT DEFAULT '0'"],
    ["reward_min_days_active", "INTEGER NOT NULL DEFAULT 3"],
    ["reward_last_distribution_at", "TIMESTAMP"],
    ["proactive_enabled", "BOOLEAN NOT NULL DEFAULT false"],
    ["proactive_mode", "TEXT NOT NULL DEFAULT 'queue'"],
    ["proactive_cadence_hours", "INTEGER NOT NULL DEFAULT 24"],
    ["proactive_last_at", "TIMESTAMP"],
    ["referral_enabled", "BOOLEAN NOT NULL DEFAULT false"],
    ["referral_reward_amount", "TEXT DEFAULT '0'"],
    ["referral_activation_days", "INTEGER NOT NULL DEFAULT 3"],
    ["reward_max_per_user_per_period", "INTEGER NOT NULL DEFAULT 1"],
    ["share_anonymized_events", "BOOLEAN NOT NULL DEFAULT false"],
    ["public_alias", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, def] of cols) {
    if (!(await columnExists(client, "bot_configs", name))) {
      await client.query(`ALTER TABLE bot_configs ADD COLUMN ${name} ${def}`);
      log(`Added ${name} to bot_configs`);
    }
  }
}

async function ensureRewardsTables(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS member_wallets (
      id SERIAL PRIMARY KEY,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      telegram_user_id TEXT NOT NULL,
      user_name TEXT,
      wallet_address VARCHAR(64) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_member_wallets_unique ON member_wallets (bot_config_id, telegram_user_id)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS contribution_scores (
      id SERIAL PRIMARY KEY,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      telegram_user_id TEXT NOT NULL,
      user_name TEXT,
      period_start TIMESTAMP NOT NULL,
      period_end TIMESTAMP NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      breakdown JSONB,
      days_active INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_contribution_scores_unique ON contribution_scores (bot_config_id, telegram_user_id, period_start)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_contribution_scores_bot_period ON contribution_scores (bot_config_id, period_start)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS reward_distributions (
      id SERIAL PRIMARY KEY,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      period_start TIMESTAMP NOT NULL,
      period_end TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total_recipients INTEGER NOT NULL DEFAULT 0,
      token_chain TEXT NOT NULL,
      token_address TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      amount_per_winner TEXT NOT NULL DEFAULT '0',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      completed_at TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_reward_distributions_bot_created ON reward_distributions (bot_config_id, created_at)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS reward_payouts (
      id SERIAL PRIMARY KEY,
      distribution_id INTEGER NOT NULL REFERENCES reward_distributions(id) ON DELETE CASCADE,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      telegram_user_id TEXT NOT NULL,
      user_name TEXT,
      wallet_address TEXT,
      amount TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'pending',
      tx_hash TEXT,
      error_message TEXT,
      rank INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'leaderboard',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_reward_payouts_distribution ON reward_payouts (distribution_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_reward_payouts_bot_created ON reward_payouts (bot_config_id, created_at)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS proactive_prompts (
      id SERIAL PRIMARY KEY,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      pattern_id INTEGER REFERENCES collective_patterns(id) ON DELETE SET NULL,
      question TEXT NOT NULL,
      rationale TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      posted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_proactive_prompts_bot_status ON proactive_prompts (bot_config_id, status)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      referrer_telegram_user_id TEXT NOT NULL,
      referrer_user_name TEXT,
      referee_telegram_user_id TEXT NOT NULL,
      referee_user_name TEXT,
      telegram_chat_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      joined_group_at TIMESTAMP,
      credited_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_unique_referee ON referrals (bot_config_id, referee_telegram_user_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_referrals_bot_status ON referrals (bot_config_id, status)`);
  if (!(await columnExists(client, "referrals", "joined_group_at"))) {
    await client.query(`ALTER TABLE referrals ADD COLUMN joined_group_at TIMESTAMP`);
    log("Added joined_group_at to referrals");
  }
  if (!(await columnExists(client, "proactive_prompts", "posted_message_id"))) {
    await client.query(`ALTER TABLE proactive_prompts ADD COLUMN posted_message_id INTEGER`);
    log("Added posted_message_id to proactive_prompts");
  }
  if (!(await columnExists(client, "contribution_scores", "group_id"))) {
    await client.query(`ALTER TABLE contribution_scores ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE`);
    await client.query(`DROP INDEX IF EXISTS idx_contribution_scores_unique`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_contribution_scores_unique_grp ON contribution_scores (bot_config_id, group_id, telegram_user_id, period_start)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contribution_scores_bot_group_period ON contribution_scores (bot_config_id, group_id, period_start)`);
    log("Added group_id to contribution_scores");
  }
  if (!(await columnExists(client, "reward_distributions", "group_id"))) {
    await client.query(`ALTER TABLE reward_distributions ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL`);
    log("Added group_id to reward_distributions");
  }
  if (!(await columnExists(client, "reward_payouts", "explorer_url"))) {
    await client.query(`ALTER TABLE reward_payouts ADD COLUMN explorer_url TEXT`);
    log("Added explorer_url to reward_payouts");
  }
  if (!(await columnExists(client, "member_wallets", "self_verified"))) {
    await client.query(`ALTER TABLE member_wallets ADD COLUMN self_verified BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE member_wallets ADD COLUMN self_verified_at TIMESTAMP`);
    log("Added self_verified to member_wallets");
  }
  if (!(await columnExists(client, "bot_configs", "reward_max_per_user_per_period_verified"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN reward_max_per_user_per_period_verified INTEGER NOT NULL DEFAULT 2`);
    await client.query(`ALTER TABLE bot_configs ADD COLUMN reward_require_self_verified BOOLEAN NOT NULL DEFAULT false`);
    log("Added reward verified cap columns to bot_configs");
  }
}

async function ensureFeedbackColumnsAndTable(client: any) {
  if (!(await columnExists(client, "bot_configs", "feedback_enabled"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN feedback_enabled BOOLEAN NOT NULL DEFAULT false`);
    log("Added feedback_enabled to bot_configs");
  }
  if (!(await columnExists(client, "bot_configs", "feedback_themes"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN feedback_themes TEXT[] NOT NULL DEFAULT ARRAY['improvements','feature_requests','pain_points']`);
    log("Added feedback_themes to bot_configs");
  }
  if (!(await columnExists(client, "bot_configs", "feedback_mix_ratio"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN feedback_mix_ratio INTEGER NOT NULL DEFAULT 40`);
    log("Added feedback_mix_ratio to bot_configs");
  }
  if (!(await columnExists(client, "proactive_prompts", "kind"))) {
    await client.query(`ALTER TABLE proactive_prompts ADD COLUMN kind TEXT NOT NULL DEFAULT 'pattern'`);
    log("Added kind to proactive_prompts");
  }
  if (!(await columnExists(client, "proactive_prompts", "theme"))) {
    await client.query(`ALTER TABLE proactive_prompts ADD COLUMN theme TEXT`);
    log("Added theme to proactive_prompts");
  }
  await client.query(`
    CREATE TABLE IF NOT EXISTS feedback_items (
      id SERIAL PRIMARY KEY,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      prompt_id INTEGER REFERENCES proactive_prompts(id) ON DELETE SET NULL,
      telegram_user_id TEXT NOT NULL,
      user_name TEXT,
      theme TEXT,
      raw_text TEXT NOT NULL,
      category TEXT,
      sentiment TEXT,
      summary TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_feedback_items_bot_created ON feedback_items (bot_config_id, created_at)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_feedback_items_bot_theme ON feedback_items (bot_config_id, theme)`);
}

async function ensureScamSensitivityColumn(client: any) {
  if (!(await columnExists(client, "bot_configs", "scam_sensitivity"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN scam_sensitivity TEXT NOT NULL DEFAULT 'medium'`);
    log("Added scam_sensitivity to bot_configs");
  }
}

async function ensureScamAllowlistTable(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS scam_allowlist (
      id SERIAL PRIMARY KEY,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      original_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      bigrams TEXT[] NOT NULL DEFAULT '{}',
      source_activity_log_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_scam_allowlist_bot_config_id ON scam_allowlist (bot_config_id)`);
}

async function ensureWidgetAllowedOriginsColumn(client: any) {
  if (!(await columnExists(client, "bot_configs", "widget_allowed_origins"))) {
    await client.query(`ALTER TABLE bot_configs ADD COLUMN widget_allowed_origins TEXT[] NOT NULL DEFAULT '{}'`);
    log("Added widget_allowed_origins to bot_configs");
  }
}

async function ensureAiUsageDailyTable(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      id SERIAL PRIMARY KEY,
      bot_config_id INTEGER NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
      usage_date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_daily_unique ON ai_usage_daily (bot_config_id, usage_date)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_date ON ai_usage_daily (usage_date)`);
}

async function columnExists(client: any, table: string, column: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function ensureBillingSchema(client: any) {
  // users plan columns (Free/Pro/Business + crypto/Stripe rails + TELI flag)
  const userCols: Array<[string, string]> = [
    ["plan", "VARCHAR NOT NULL DEFAULT 'free'"],
    ["plan_rail", "VARCHAR NOT NULL DEFAULT 'none'"],
    ["plan_period_end", "TIMESTAMP"],
    ["plan_cancel_at_period_end", "BOOLEAN NOT NULL DEFAULT false"],
    ["teli_paid", "BOOLEAN NOT NULL DEFAULT false"],
    ["stripe_customer_id", "VARCHAR"],
    ["stripe_subscription_id", "VARCHAR"],
  ];
  for (const [name, def] of userCols) {
    if (!(await columnExists(client, "users", name))) {
      await client.query(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
      log(`Added ${name} to users`);
    }
  }
  // Backfill safety: ensure no nulls in plan/plan_rail for legacy rows
  await client.query(`UPDATE users SET plan = 'free' WHERE plan IS NULL`);
  await client.query(`UPDATE users SET plan_rail = 'none' WHERE plan_rail IS NULL`);

  // platform_settings (key/value config used by admin Plans tab, e.g. USD-per-TELI rate)
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id SERIAL PRIMARY KEY,
      key VARCHAR(64) NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_settings_key ON platform_settings (key)`);

  // plan_payment_intents (crypto rail micro-amount intent matching)
  await client.query(`
    CREATE TABLE IF NOT EXISTS plan_payment_intents (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR NOT NULL,
      plan VARCHAR NOT NULL,
      billing_period VARCHAR NOT NULL DEFAULT 'monthly',
      rail VARCHAR NOT NULL,
      receive_address VARCHAR NOT NULL,
      expected_amount TEXT NOT NULL,
      token_address VARCHAR NOT NULL,
      token_symbol VARCHAR NOT NULL,
      token_decimals INTEGER NOT NULL DEFAULT 18,
      usd_amount TEXT NOT NULL,
      status VARCHAR NOT NULL DEFAULT 'pending',
      tx_hash VARCHAR,
      matched_at TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_plan_payment_intents_user ON plan_payment_intents (user_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_plan_payment_intents_status ON plan_payment_intents (status)`);

  // plan_periods (history of every active plan window)
  await client.query(`
    CREATE TABLE IF NOT EXISTS plan_periods (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR NOT NULL,
      plan VARCHAR NOT NULL,
      rail VARCHAR NOT NULL,
      billing_period VARCHAR NOT NULL DEFAULT 'monthly',
      teli_paid BOOLEAN NOT NULL DEFAULT false,
      starts_at TIMESTAMP NOT NULL,
      ends_at TIMESTAMP NOT NULL,
      intent_id INTEGER REFERENCES plan_payment_intents(id) ON DELETE SET NULL,
      stripe_subscription_id VARCHAR,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_plan_periods_user ON plan_periods (user_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_plan_periods_user_endsat ON plan_periods (user_id, ends_at)`);
}
