/**
 * Base classes and shared helpers for LLM quota providers.
 * TypeScript port of src/providers/base.py
 */

export interface QuotaMetrics {
  quotaPercentage: number;
  nextResetMs?: number;
}

export function formatResetInfo(nextResetMs: number, nowTs?: number): {
  nextReset: string;
  remainingTime: string;
} {
  const now = nowTs ?? Date.now() / 1000;
  // KST (UTC+9): shift by +9h then format as ISO8601 with +09:00
  const kstMs = nextResetMs + 9 * 3600 * 1000;
  const kst = new Date(kstMs);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  const ss = String(kst.getUTCSeconds()).padStart(2, "0");
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  const nextReset = `${year}-${month}-${day}T${hh}:${mm}:${ss}+09:00`;

  const diffSec = Math.max(0, nextResetMs / 1000 - now);
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const remainingTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return { nextReset, remainingTime };
}

export interface QuotaProvider {
  readonly name: string;
  readonly displayName: string;
  readonly envKey: string;

  /** Returns true when the provider's API key is configured in env vars. */
  isConfigured(env: Record<string, string | undefined>): boolean;

  /** Query the provider and return normalized quota metrics. */
  fetch(apiKey: string): Promise<QuotaMetrics>;
}

export interface ProviderStatus {
  configured: boolean;
  status: "ok" | "not_configured" | "error";
  error?: string;
  quotaPercentage: number;
  nextReset?: string;
  remainingTime?: string;
}
