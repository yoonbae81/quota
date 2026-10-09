/**
 * Z.ai (GLM) quota provider for Cloudflare Worker.
 * Adapted from src/providers/zai.py.
 *
 * Uses Cloudflare Worker `fetch()` instead of Python `urllib.request`.
 * Reads API key from `event.secrets.ZAI_API_KEY` (mapped to env.ZAI_API_KEY).
 */

import type { QuotaMetrics, QuotaProvider } from "./base";

const USAGE_API_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

export class ZaiProvider implements QuotaProvider {
  readonly name = "zai";
  readonly displayName = "Z.ai";
  readonly envKey = "ZAI_API_KEY";

  isConfigured(env: Record<string, string | undefined>): boolean {
    return Boolean(env[this.envKey]);
  }

  async fetch(apiKey: string): Promise<QuotaMetrics> {
    const data = await this._fetchUsageData(apiKey);
    const tokenLimit = this._extractTokenLimit(data);
    return {
      quotaPercentage: tokenLimit.percentage ?? 0,
      nextResetMs: tokenLimit.nextResetTime,
    };
  }

  private async _fetchUsageData(apiKey: string): Promise<Record<string, unknown>> {
    const resp = await fetch(USAGE_API_URL, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept-Language": "en-US,en",
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(`HTTP Error: ${resp.status} ${resp.statusText}`);
    }

    const data = (await resp.json()) as Record<string, unknown>;

    if (data.code !== 200) {
      throw new Error(
        `API Error: ${data.msg ?? "Unknown error"} (code: ${data.code})`
      );
    }

    return data;
  }

  private _extractTokenLimit(data: Record<string, unknown>): {
    percentage?: number;
    nextResetTime?: number;
  } {
    const limits =
      (data.data as { limits?: unknown[] })?.limits ?? [];
    const item = limits.find(
      (i: unknown) =>
        typeof i === "object" &&
        i !== null &&
        (i as { type?: string }).type === "TOKENS_LIMIT"
    );

    if (!item) {
      throw new Error("TOKENS_LIMIT not found in response data");
    }

    return {
      percentage: (item as { percentage?: number }).percentage,
      nextResetTime: (item as { nextResetTime?: number }).nextResetTime,
    };
  }
}
