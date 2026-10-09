/**
 * Quota Cloudflare Worker entry point.
 * Ported from src/main.py.
 *
 * Routes:
 *   /quota      -> comprehensive view of all providers
 *   /quota/zai  -> single provider metrics
 *   /           -> redirects to /quota when BASE_URL=/quota
 *   /zai-quota  -> alias route when BASE_URL_ALIASES includes it
 *   anything else -> 404
 *
 * Env vars (set via wrangler.toml [vars] or `wrangler secret`):
 *   ZAI_API_KEY      - required for Z.ai provider
 *   BASE_URL         - main path prefix (default: /quota)
 *   BASE_URL_ALIASES - comma-separated alias paths
 */

import {
  type QuotaMetrics,
  formatResetInfo,
  type QuotaProvider,
  type ProviderStatus,
} from "./providers/base";
import { ZaiProvider } from "./providers/zai";

// ---------------------------------------------------------------------------
// Providers (keep in sync with src/providers/__init__.py)
// ---------------------------------------------------------------------------

const PROVIDERS: QuotaProvider[] = [new ZaiProvider()];
const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.name, p]));

function getProvider(name: string): QuotaProvider | undefined {
  return PROVIDER_MAP.get(name);
}

// ---------------------------------------------------------------------------
// Routing helpers (mirrors src/main.py resolve_route / get_allowed_base_paths)
// ---------------------------------------------------------------------------

function normalizeBasePath(path: string): string {
  const normalized = path?.trim() ?? "";
  if (!normalized || normalized === "/") return "";
  const stripped = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  return stripped ? `/${stripped}` : "";
}

function getBaseConfig(env: Env): { baseUrl: string; aliases: string } {
  const baseUrl = (env.BASE_URL as string) || "/quota";
  const aliases = (env.BASE_URL_ALIASES as string) || "";
  return { baseUrl, aliases };
}

function getBasePaths(baseUrl: string, aliases: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  const raw = [baseUrl];
  if (aliases.trim()) {
    aliases.split(",").forEach((a) => {
      const trimmed = a.trim();
      if (trimmed) raw.push(trimmed);
    });
  }

  for (const r of raw) {
    const normalized = normalizeBasePath(r);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      paths.push(normalized);
    }
  }

  return paths.length > 0 ? paths : [""];
}

/**
 * Resolve a request URL pathname against configured base paths.
 * Returns { subPath, matchedBase } or null.
 * subPath is "" for the base route or a provider slug.
 */
function resolveRoute(
  pathname: string
): { subPath: string; matchedBase: string } | null {
  const { baseUrl, aliases } = getBaseConfig(globalThis as unknown as Env);
  const basePaths = getBasePaths(baseUrl, aliases);

  // Strip query string
  const path = pathname.split("?")[0].replace(/\/+$/, "");

  for (const base of basePaths) {
    if (base === "") {
      if (path === "") return { subPath: "", matchedBase: "" };
      const rest = path.replace(/^\/+/, "");
      if (rest && !rest.includes("/")) return { subPath: rest, matchedBase: base };
      continue;
    }

    if (path === base) return { subPath: "", matchedBase: base };
    if (path.startsWith(base + "/")) {
      const rest = path.slice(base.length + 1).replace(/^\/+/, "").replace(/\/+$/, "");
      if (rest && !rest.includes("/")) return { subPath: rest, matchedBase: base };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

async function buildProviderStatus(
  provider: QuotaProvider,
  env: Env,
  nowMs: number
): Promise<ProviderStatus> {
  if (!provider.isConfigured(env)) {
    return {
      configured: false,
      status: "not_configured" as const,
      quotaPercentage: 0,
    };
  }

  try {
    const apiKey = env[provider.envKey] || "";
    const metrics = await provider.fetch(apiKey);
    const result: ProviderStatus = {
      configured: true,
      status: "ok" as const,
      quotaPercentage: metrics.quotaPercentage,
    };
    if (metrics.nextResetMs) {
      const resetInfo = formatResetInfo(metrics.nextResetMs, nowMs / 1000);
      result.nextReset = resetInfo.nextReset;
      result.remainingTime = resetInfo.remainingTime;
    }
    return result;
  } catch (err) {
    return {
      configured: true,
      status: "error" as const,
      error: err instanceof Error ? err.message : String(err),
      quotaPercentage: 0,
    };
  }
}

async function buildComprehensiveView(env: Env, nowMs: number): Promise<Record<string, unknown>> {
  const providers: Record<string, unknown> = {};

  for (const provider of PROVIDERS) {
    providers[provider.name] = await buildProviderStatus(provider, env, nowMs);
  }

  return {
    generatedAt: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
    providers,
  };
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const nowMs = Date.now();
  const route = resolveRoute(new URL(request.url).pathname);

  if (!route) {
    const { baseUrl, aliases } = getBaseConfig(env);
    const allPaths = getBasePaths(baseUrl, aliases);
    const providerSlugs = PROVIDERS.map((p) => p.name);
    const paths = allPaths.map((b) =>
      providerSlugs.map((s) => `${b}/${s}`).join(", ")
    ).join(" or ");

    return jsonResponse(404, {
      error: `Not found. Use ${allPaths.length === 1 && allPaths[0] === "" ? "/" : allPaths[0]} or ${paths}`,
    });
  }

  const { subPath, matchedBase } = route;

  if (subPath === "") {
    // Comprehensive view
    return jsonResponse(200, await buildComprehensiveView(env, nowMs));
  }

  // Single provider
  const provider = getProvider(subPath);
  if (!provider) {
    const available = PROVIDERS.map((p) => p.name).join(", ");
    return jsonResponse(404, {
      error: `Unknown provider '${subPath}'. Available: ${available}`,
    });
  }

  if (!provider.isConfigured(env)) {
    return jsonResponse(500, {
      error: `API Key is missing. Set ${provider.envKey} environment variable.`,
    });
  }

  try {
    const apiKey = env[provider.envKey] || "";
    const metrics = await provider.fetch(apiKey);
    return jsonResponse(200, metrics);
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Export for Cloudflare Workers
// ---------------------------------------------------------------------------

interface Env {
  ZAI_API_KEY?: string;
  BASE_URL?: string;
  BASE_URL_ALIASES?: string;
  [key: string]: string | undefined;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Handle CORS for development / browser usage
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(405, { error: "Method not allowed. Use GET." });
    }

    return handleRequest(request, env);
  },
};
