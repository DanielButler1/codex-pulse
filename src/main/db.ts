import Database from "better-sqlite3";
import { normalizeCodexLimitWindows } from "../../shared/codex-limit-windows";
import type { HistoryRange, UsageSnapshot } from "../../shared/types";
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
    `);
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
