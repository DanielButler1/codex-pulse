import type { AppSettings, AppStatus, UsageSnapshot } from "../../../shared/types";
import type { UsageDatabase } from "../db";
import { calculateBurnRates, estimateLimitHit } from "./predictor";
import { CodexUsageService } from "./codex-usage";
import {
  hasMaterialLimitDrop,
  REQUIRED_LIMIT_DROP_CONFIRMATIONS,
} from "./snapshot-validation";

type SchedulerDeps = {
  db: UsageDatabase;
  usageService: CodexUsageService;
  settings: AppSettings;
  onUpdate?: (snapshot: UsageSnapshot | null, status: AppStatus) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;
const FAILURE_BACKOFF_SECONDS = 5 * 60;
const FAILURE_BACKOFF_THRESHOLD = 3;
const FIXED_POLL_SECONDS = 60;

type PendingLimitDrop = {
  confirmations: number;
};

export class UsageScheduler {
  private readonly db: UsageDatabase;
  private readonly usageService: CodexUsageService;
  private readonly onUpdate?: (snapshot: UsageSnapshot | null, status: AppStatus) => void;
  private timer: NodeJS.Timeout | null = null;
  private pollInFlight: Promise<UsageSnapshot | null> | null = null;
  private pendingLimitDrop: PendingLimitDrop | null = null;
  private running = false;
  private lastCleanupAt = 0;
  private latestSnapshot: UsageSnapshot | null;
  private status: AppStatus;

  constructor({ db, usageService, settings, onUpdate }: SchedulerDeps) {
    this.db = db;
    this.usageService = usageService;
    void settings;
    this.onUpdate = onUpdate;
    this.latestSnapshot = this.db.getLatestSnapshot();
    this.status = {
      authStatus: "not_found",
      authMessage: null,
      lastCheckedAt: null,
      lastSuccessAt: this.latestSnapshot?.checkedAt ?? null,
      lastError: null,
      pollIntervalSeconds: FIXED_POLL_SECONDS,
      effectivePollIntervalSeconds: FIXED_POLL_SECONDS,
      consecutiveFailures: 0,
      usingBackoff: false,
      providerMode: "none",
      burnRatePercentPerHour: null,
      estimatedLimitHitAt: null,
    };

    if (this.latestSnapshot) {
      this.recomputePredictorState(this.latestSnapshot);
    }
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.scheduleNext(0);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getLatestSnapshot(): UsageSnapshot | null {
    return this.latestSnapshot;
  }

  getStatus(): AppStatus {
    return { ...this.status };
  }

  updateSettings(settings: AppSettings) {
    void settings;
    this.status.pollIntervalSeconds = FIXED_POLL_SECONDS;
    if (this.running) {
      this.scheduleNext(this.currentIntervalMs());
    }
  }

  async refreshNow(): Promise<UsageSnapshot> {
    const snapshot = await this.runPoll();
    if (!snapshot) {
      throw new Error(this.status.lastError ?? "Unable to refresh usage.");
    }
    return snapshot;
  }

  private scheduleNext(delayMs: number) {
    if (!this.running) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick() {
    await this.runPoll();
    this.scheduleNext(this.currentIntervalMs());
  }

  private async runPoll(): Promise<UsageSnapshot | null> {
    if (this.pollInFlight) {
      return this.pollInFlight;
    }

    this.pollInFlight = this.executePoll().finally(() => {
      this.pollInFlight = null;
    });
    return this.pollInFlight;
  }

  private async executePoll(): Promise<UsageSnapshot | null> {
    this.status.lastCheckedAt = Date.now();
    let result;
    try {
      result = await this.usageService.pollUsage();
    } catch (error) {
      this.recordFailure(error instanceof Error ? error.message : "Unexpected usage refresh failure.");
      return null;
    }

    this.status.authStatus = result.authStatus;
    this.status.authMessage = result.authMessage;
    this.status.providerMode = result.providerMode;

    if (result.snapshot) {
      const acceptedSnapshot = this.confirmSnapshot(result.snapshot);
      if (!acceptedSnapshot) {
        this.recordSuccessfulPoll();
        this.emitUpdate(this.latestSnapshot);
        return this.latestSnapshot;
      }

      if (this.latestSnapshot && !hasMeaningfulUsageChange(this.latestSnapshot, acceptedSnapshot)) {
        this.latestSnapshot = {
          ...acceptedSnapshot,
          id: this.latestSnapshot.id,
        };
      } else {
        const id = this.db.insertSnapshot(acceptedSnapshot);
        this.latestSnapshot = { ...acceptedSnapshot, id };
      }
      this.status.lastSuccessAt = acceptedSnapshot.checkedAt;
      this.recordSuccessfulPoll();
      this.recomputePredictorState(this.latestSnapshot);
      this.cleanupOldRowsIfDue();
      this.emitUpdate(this.latestSnapshot);
      return this.latestSnapshot;
    }

    this.recordFailure(result.errorMessage ?? "Usage endpoint failed.");
    return null;
  }

  private recordFailure(message: string) {
    this.status.lastError = message;
    this.status.consecutiveFailures += 1;
    this.status.usingBackoff = this.status.consecutiveFailures >= FAILURE_BACKOFF_THRESHOLD;
    this.status.effectivePollIntervalSeconds = this.status.usingBackoff
      ? FAILURE_BACKOFF_SECONDS
      : FIXED_POLL_SECONDS;
    this.emitUpdate(this.latestSnapshot);
  }

  private recordSuccessfulPoll() {
    this.status.lastError = null;
    this.status.consecutiveFailures = 0;
    this.status.usingBackoff = false;
    this.status.effectivePollIntervalSeconds = FIXED_POLL_SECONDS;
  }

  private confirmSnapshot(snapshot: UsageSnapshot): UsageSnapshot | null {
    if (!this.latestSnapshot || !hasMaterialLimitDrop(this.latestSnapshot, snapshot)) {
      this.pendingLimitDrop = null;
      return snapshot;
    }

    const confirmations = (this.pendingLimitDrop?.confirmations ?? 0) + 1;
    if (confirmations < REQUIRED_LIMIT_DROP_CONFIRMATIONS) {
      this.pendingLimitDrop = { confirmations };
      return null;
    }

    this.pendingLimitDrop = null;
    return snapshot;
  }

  private currentIntervalMs(): number {
    const seconds = this.status.usingBackoff
      ? FAILURE_BACKOFF_SECONDS
      : FIXED_POLL_SECONDS;
    return seconds * 1000;
  }

  private cleanupOldRowsIfDue() {
    if (Date.now() - this.lastCleanupAt < DAY_MS) {
      return;
    }
    this.db.cleanupOlderThan(Date.now() - RETENTION_MS);
    this.lastCleanupAt = Date.now();
  }

  private recomputePredictorState(latest: UsageSnapshot) {
    const since = Date.now() - 7 * DAY_MS;
    const history = this.db.getSnapshotsSince(since);
    const rates = calculateBurnRates(history);
    this.status.burnRatePercentPerHour = rates.defaultRate;
    this.status.estimatedLimitHitAt = estimateLimitHit(latest, rates.defaultRate);
  }

  private emitUpdate(snapshot: UsageSnapshot | null) {
    this.onUpdate?.(snapshot, this.getStatus());
  }
}

function hasMeaningfulUsageChange(previous: UsageSnapshot, next: UsageSnapshot): boolean {
  const keys: Array<keyof UsageSnapshot> = [
    "provider",
    "accountLabel",
    "planType",
    "primaryUsedPercent",
    "primaryWindowMinutes",
    "secondaryUsedPercent",
    "secondaryWindowMinutes",
    "creditsBalance",
    "creditsGranted",
    "creditsUsed",
  ];

  for (const key of keys) {
    if (previous[key] !== next[key]) {
      return true;
    }
  }
  return false;
}
