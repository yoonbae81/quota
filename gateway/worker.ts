/**
 * xcv.kr gateway paths — reverse proxy.
 *
 * Routes handled (Workers routes on xcv.kr):
 *   xcv.kr/hwpx*  -> https://md2hwpx.y-e2f.workers.dev  (Cloudflare 파일럿 Worker, prefix 유지)
 *
 * hwpx는 2026-10-18 운영 전환으로 Vercel(md2hwpx.vercel.app)에서 Cloudflare Worker로
 * upstream을 바꿨다. 롤백 시 아래 UPSTREAMS의 host를 md2hwpx.vercel.app으로 되돌리고
 * 재배포한다(배포는 main push CI).
 *
 * mask는 2026-10-18 CF static worker `mask`로 전환되며 gateway에서 완전히 빠졌다.
 * xcv.kr/mask* 라우트는 mask 워커 직결(mask 레포 wrangler.jsonc routes), edge Caddy의
 * mask 프록시 블록도 제거됐다. 이전 upstream은 mask-eta.vercel.app(Vercel, 롤백 대상).
 */

interface Env {}

const UPSTREAMS: { pattern: RegExp; host: string }[] = [
  { pattern: /^\/hwpx(\/|$)/, host: "md2hwpx.y-e2f.workers.dev" },
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
