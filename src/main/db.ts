import Database from "better-sqlite3";
import { normalizeCodexLimitWindows } from "../../shared/codex-limit-windows";
import type { HistoryRange, UsageEfficiencyWeek, UsageSnapshot } from "../../shared/types";
import { filterTransientLimitDrops } from "./services/snapshot-validation";

type SnapshotRow = {
  id: number;
  checked_at: number;
  provider: string;
  account_label: string | null;
  plan_type: string | null;
  primary_used_percent: number | null;
  primary_reset_after_seconds: number | null;
  primary_window_minutes: number | null;
  secondary_used_percent: number | null;
  secondary_reset_after_seconds: number | null;
  secondary_window_minutes: number | null;
  credits_balance: number | null;
  credits_granted: number | null;
  credits_used: number | null;
  raw_json: string | null;
};

export type ModelUsageRollup = {
  bucketStart: number;
  model: string;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

type ModelUsageFileRow = {
  file_path: string;
  size_bytes: number;
  modified_at: number;
};

type ModelUsageRollupRow = {
  bucket_start: number;
  model: string;
  requests: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
};

type UsageEfficiencyWeekRow = {
  reset_at: number;
  observed_from: number;
  observed_to: number;
  observed_usage_percent: number;
  total_tokens: number;
  tokens_per_percent: number | null;
  projected_weekly_tokens: number | null;
  observations: number;
};

const RANGE_TO_MS: Record<HistoryRange, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export class UsageDatabase {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    const existingRollupColumns = this.db
      .prepare<unknown[], { name: string }>("PRAGMA table_info(model_usage_rollups)")
      .all();
    if (
      existingRollupColumns.length > 0 &&
      (!existingRollupColumns.some((column) => column.name === "file_path") ||
        !existingRollupColumns.some((column) => column.name === "bucket_start"))
    ) {
      // Older betas stored one disposable JSON cache row under this table name.
      // Raw rollout logs remain the source of truth, so rebuild the derived cache
      // without touching usage_snapshots or settings.
      this.db.exec("DROP TABLE model_usage_rollups");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        checked_at INTEGER NOT NULL,
        provider TEXT NOT NULL,
        account_label TEXT,
        plan_type TEXT,

        primary_used_percent REAL,
        primary_reset_after_seconds INTEGER,
        primary_window_minutes INTEGER,

        secondary_used_percent REAL,
        secondary_reset_after_seconds INTEGER,
        secondary_window_minutes INTEGER,

        credits_balance REAL,
        credits_granted REAL,
        credits_used REAL,

        raw_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_usage_snapshots_checked_at
      ON usage_snapshots(checked_at);

      CREATE TABLE IF NOT EXISTS model_usage_files (
        file_path TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        modified_at REAL NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_usage_rollups (
        file_path TEXT NOT NULL,
        bucket_start INTEGER NOT NULL,
        model TEXT NOT NULL,
        requests INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        estimated_cost_usd REAL NOT NULL,
        PRIMARY KEY (file_path, bucket_start, model),
        FOREIGN KEY (file_path) REFERENCES model_usage_files(file_path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_model_usage_rollups_bucket
      ON model_usage_rollups(bucket_start);

      CREATE TABLE IF NOT EXISTS model_usage_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_efficiency_weeks (
        reset_at INTEGER PRIMARY KEY,
        observed_from INTEGER NOT NULL,
        observed_to INTEGER NOT NULL,
        observed_usage_percent REAL NOT NULL,
        total_tokens INTEGER NOT NULL,
        tokens_per_percent REAL,
        projected_weekly_tokens REAL,
        observations INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.db.pragma("foreign_keys = ON");
  }

  insertSnapshot(snapshot: UsageSnapshot): number {
    const statement = this.db.prepare(`
      INSERT INTO usage_snapshots (
        checked_at,
        provider,
        account_label,
        plan_type,
        primary_used_percent,
        primary_reset_after_seconds,
        primary_window_minutes,
        secondary_used_percent,
        secondary_reset_after_seconds,
        secondary_window_minutes,
        credits_balance,
        credits_granted,
        credits_used,
        raw_json
      ) VALUES (
        @checked_at,
        @provider,
        @account_label,
        @plan_type,
        @primary_used_percent,
        @primary_reset_after_seconds,
        @primary_window_minutes,
        @secondary_used_percent,
        @secondary_reset_after_seconds,
        @secondary_window_minutes,
        @credits_balance,
        @credits_granted,
        @credits_used,
        @raw_json
      )
    `);

    const result = statement.run({
      checked_at: snapshot.checkedAt,
      provider: snapshot.provider,
      account_label: snapshot.accountLabel ?? null,
      plan_type: snapshot.planType ?? null,
      primary_used_percent: snapshot.primaryUsedPercent ?? null,
      primary_reset_after_seconds: snapshot.primaryResetAfterSeconds ?? null,
      primary_window_minutes: snapshot.primaryWindowMinutes ?? null,
      secondary_used_percent: snapshot.secondaryUsedPercent ?? null,
      secondary_reset_after_seconds: snapshot.secondaryResetAfterSeconds ?? null,
      secondary_window_minutes: snapshot.secondaryWindowMinutes ?? null,
      credits_balance: snapshot.creditsBalance ?? null,
      credits_granted: snapshot.creditsGranted ?? null,
      credits_used: snapshot.creditsUsed ?? null,
      raw_json: snapshot.raw ? JSON.stringify(snapshot.raw) : null,
    });

    return Number(result.lastInsertRowid);
  }

  getLatestSnapshot(): UsageSnapshot | null {
    const statement = this.db.prepare<unknown[], SnapshotRow>(`
      SELECT * FROM usage_snapshots
      ORDER BY checked_at DESC
      LIMIT 1
    `);

    const row = statement.get();
    return row ? mapRowToSnapshot(row) : null;
  }
  getHistory(range: HistoryRange): UsageSnapshot[] {
    const since = Date.now() - RANGE_TO_MS[range];
    return this.getSnapshotsSince(since);
  }

  getSnapshotsSince(since: number): UsageSnapshot[] {
    const statement = this.db.prepare<[number], SnapshotRow>(`
      SELECT * FROM usage_snapshots
      WHERE checked_at >= ?
      ORDER BY checked_at ASC
    `);

    return filterTransientLimitDrops(statement.all(since).map(mapRowToSnapshot));
  }

  /**
   * Model-usage calculations only need the weekly percentage. Avoid selecting
   * and parsing every stored raw provider response for long ranges.
   */
  getLimitHistorySince(since: number): UsageSnapshot[] {
    const statement = this.db.prepare<[number], SnapshotRow>(`
      SELECT
        id, checked_at, provider, account_label, plan_type,
        primary_used_percent, primary_reset_after_seconds, primary_window_minutes,
        secondary_used_percent, secondary_reset_after_seconds, secondary_window_minutes,
        credits_balance, credits_granted, credits_used,
        NULL AS raw_json
      FROM usage_snapshots
      WHERE checked_at >= ?
      ORDER BY checked_at ASC
    `);

    return filterTransientLimitDrops(statement.all(since).map(mapRowToSnapshot));
  }

  getModelUsageFileStates(): Map<string, { sizeBytes: number; modifiedAt: number }> {
    const rows = this.db.prepare<unknown[], ModelUsageFileRow>(`
      SELECT file_path, size_bytes, modified_at FROM model_usage_files
    `).all();
    return new Map(rows.map((row) => [row.file_path, {
      sizeBytes: row.size_bytes,
      modifiedAt: row.modified_at,
    }]));
  }

  ensureModelUsageIndexVersion(version: string): boolean {
    let rebuilt = false;
    const migrate = this.db.transaction(() => {
      const row = this.db.prepare<[], { value: string }>(`
        SELECT value FROM model_usage_metadata WHERE key = 'index_version'
      `).get();
      if (row?.value === version) return;
      this.db.prepare(`DELETE FROM model_usage_rollups`).run();
      this.db.prepare(`DELETE FROM model_usage_files`).run();
      this.db.prepare(`
        INSERT INTO model_usage_metadata (key, value) VALUES ('index_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(version);
      rebuilt = true;
    });
    migrate();
    return rebuilt;
  }

  replaceModelUsageFile(
    file: { filePath: string; sizeBytes: number; modifiedAt: number },
    rollups: ModelUsageRollup[],
  ): void {
    const replace = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM model_usage_rollups WHERE file_path = ?`).run(file.filePath);
      this.db.prepare(`
        INSERT INTO model_usage_files (file_path, size_bytes, modified_at, indexed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          size_bytes = excluded.size_bytes,
          modified_at = excluded.modified_at,
          indexed_at = excluded.indexed_at
      `).run(file.filePath, file.sizeBytes, file.modifiedAt, Date.now());
      const insert = this.db.prepare(`
        INSERT INTO model_usage_rollups (
          file_path, bucket_start, model, requests, input_tokens, cached_input_tokens,
          output_tokens, reasoning_output_tokens, total_tokens, estimated_cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of rollups) {
        insert.run(
          file.filePath, row.bucketStart, row.model, row.requests, row.inputTokens,
          row.cachedInputTokens, row.outputTokens, row.reasoningOutputTokens,
          row.totalTokens, row.estimatedCostUsd,
        );
      }
    });
    replace();
  }

  removeMissingModelUsageFiles(existingPaths: Set<string>): void {
    const states = this.getModelUsageFileStates();
    const remove = this.db.prepare(`DELETE FROM model_usage_files WHERE file_path = ?`);
    const transaction = this.db.transaction(() => {
      for (const filePath of states.keys()) {
        if (!existingPaths.has(filePath)) {
          remove.run(filePath);
        }
      }
    });
    transaction();
  }

  getModelUsageRollupsSince(since: number): ModelUsageRollup[] {
    const rows = this.db.prepare<[number], ModelUsageRollupRow>(`
      SELECT
        bucket_start, model,
        SUM(requests) AS requests,
        SUM(input_tokens) AS input_tokens,
        SUM(cached_input_tokens) AS cached_input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(reasoning_output_tokens) AS reasoning_output_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(estimated_cost_usd) AS estimated_cost_usd
      FROM model_usage_rollups
      WHERE bucket_start >= ?
      GROUP BY bucket_start, model
      ORDER BY bucket_start ASC
    `).all(since);
    return rows.map((row) => ({
      bucketStart: row.bucket_start,
      model: row.model,
      requests: row.requests,
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens,
      reasoningOutputTokens: row.reasoning_output_tokens,
      totalTokens: row.total_tokens,
      estimatedCostUsd: row.estimated_cost_usd,
    }));
  }

  upsertUsageEfficiencyWeeks(weeks: UsageEfficiencyWeek[]): void {
    const statement = this.db.prepare(`
      INSERT INTO usage_efficiency_weeks (
        reset_at, observed_from, observed_to, observed_usage_percent, total_tokens,
        tokens_per_percent, projected_weekly_tokens, observations, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(reset_at) DO UPDATE SET
        observed_from = excluded.observed_from,
        observed_to = excluded.observed_to,
        observed_usage_percent = excluded.observed_usage_percent,
        total_tokens = excluded.total_tokens,
        tokens_per_percent = excluded.tokens_per_percent,
        projected_weekly_tokens = excluded.projected_weekly_tokens,
        observations = excluded.observations,
        updated_at = excluded.updated_at
      WHERE excluded.reset_at > usage_efficiency_weeks.updated_at
    `);
    const transaction = this.db.transaction(() => {
      for (const week of weeks) {
        statement.run(
          week.resetAt, week.observedFrom, week.observedTo, week.observedUsagePercent,
          week.totalTokens, week.tokensPerPercent, week.projectedWeeklyTokens,
          week.observations, Date.now(),
        );
      }
    });
    transaction();
  }

  getUsageEfficiencyWeeks(): UsageEfficiencyWeek[] {
    const rows = this.db.prepare<unknown[], UsageEfficiencyWeekRow>(`
      SELECT reset_at, observed_from, observed_to, observed_usage_percent, total_tokens,
        tokens_per_percent, projected_weekly_tokens, observations
      FROM usage_efficiency_weeks
      ORDER BY reset_at DESC
    `).all();
    return rows.map((row) => ({
      resetAt: row.reset_at,
      observedFrom: row.observed_from,
      observedTo: row.observed_to,
      observedUsagePercent: row.observed_usage_percent,
      totalTokens: row.total_tokens,
      tokensPerPercent: row.tokens_per_percent,
      projectedWeeklyTokens: row.projected_weekly_tokens,
      observations: row.observations,
    }));
  }

  cleanupOlderThan(cutoffMs: number): number {
    const statement = this.db.prepare<[number]>(`
      DELETE FROM usage_snapshots
      WHERE checked_at < ?
    `);
    return statement.run(cutoffMs).changes;
  }

  close() {
    this.db.close();
  }
}

function mapRowToSnapshot(row: SnapshotRow): UsageSnapshot {
  let raw: unknown = undefined;
  if (row.raw_json) {
    try {
      raw = JSON.parse(row.raw_json);
    } catch {
      raw = { parseError: true };
    }
  }

  return normalizeCodexLimitWindows({
    id: row.id,
    checkedAt: row.checked_at,
    provider: "codex",
    accountLabel: row.account_label ?? undefined,
    planType: row.plan_type ?? undefined,
    primaryUsedPercent: row.primary_used_percent,
    primaryResetAfterSeconds: row.primary_reset_after_seconds,
    primaryWindowMinutes: row.primary_window_minutes,
    secondaryUsedPercent: row.secondary_used_percent,
    secondaryResetAfterSeconds: row.secondary_reset_after_seconds,
    secondaryWindowMinutes: row.secondary_window_minutes,
    creditsBalance: row.credits_balance,
    creditsGranted: row.credits_granted,
    creditsUsed: row.credits_used,
    raw,
  });
}
