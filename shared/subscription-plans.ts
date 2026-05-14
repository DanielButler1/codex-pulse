import type { SubscriptionPlan } from "./types";

export const SUBSCRIPTION_PLAN_META: Record<
  SubscriptionPlan,
  { label: string; monthlyCostUsd: number }
> = {
  free: { label: "Free", monthlyCostUsd: 0 },
  go: { label: "Go", monthlyCostUsd: 8 },
  plus: { label: "Plus", monthlyCostUsd: 20 },
  pro_5x: { label: "Pro 5x", monthlyCostUsd: 100 },
  pro_20x: { label: "Pro 20x", monthlyCostUsd: 200 },
};

