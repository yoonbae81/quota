/**
 * xcv.kr gateway paths — reverse proxy to Vercel apps.
 *
 * Routes handled (Workers routes on xcv.kr):
 *   xcv.kr/hwpx*  -> https://md2hwpx.vercel.app  (keeps /hwpx prefix)
 *   xcv.kr/mask*  -> https://mask-eta.vercel.app (keeps /mask prefix)
 *
 * Both Vercel apps are built with their base path (/hwpx, /mask) baked in,
 * so path-preserving proxying works with no rewriting.
 *
 * Deployed separately from the quota worker; see wrangler.toml.
 */

interface Env {}

const UPSTREAMS: { pattern: RegExp; host: string }[] = [
  { pattern: /^\/hwpx(\/|$)/, host: "md2hwpx.vercel.app" },
  { pattern: /^\/mask(\/|$)/, host: "mask-eta.vercel.app" },
];

function matchUpstream(pathname: string): string | undefined {
  for (const u of UPSTREAMS) {
    if (u.pattern.test(pathname)) return u.host;
  }
  return undefined;
}

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const host = matchUpstream(url.pathname);

    if (!host) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const upstream = new URL(request.url);
    upstream.hostname = host;
    upstream.protocol = "https:";
    upstream.port = "";

    const proxied = new Request(upstream.toString(), request);
    proxied.headers.set("Host", host);
    proxied.headers.set("X-Forwarded-Host", url.hostname);

    const resp = await fetch(proxied);
    const headers = new Headers(resp.headers);
    headers.delete("set-cookie"); // Vercel cookies are host-scoped; drop to avoid domain mismatch
    return new Response(resp.body, { status: resp.status, headers });
  },
};
