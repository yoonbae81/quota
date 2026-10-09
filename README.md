# Quota

Query LLM usage quota limits across providers from one place and output calculated metrics in JSON format.

**Live deployment:** https://xcv.kr/quota — runs as a Cloudflare Worker (TypeScript). The Python CLI/server in `src/` remains for local use.

- Production: `https://xcv.kr/quota` (aggregate), `https://xcv.kr/quota/zai` (single provider)
  - Also available at `https://zai-quota.y-e2f.workers.dev/quota`
  - Custom-domain routing: Workers route `xcv.kr/quota*` requires the root DNS record to be **Proxied** (orange cloud)
- Deploys: push to `main` → GitHub Actions runs typecheck + `wrangler deploy`
- Local dev: `npm install && npm run dev` (requires `wrangler login`; set `ZAI_API_KEY` via `npx wrangler secret put ZAI_API_KEY`)

## Features

- Provider-based architecture: adding a new LLM provider takes one small module
- Comprehensive view: all configured providers in a single JSON response
- Per-provider endpoints with normalized output (`quotaPercentage`, `nextReset`, `remainingTime`)
- Cloudflare Worker deployment (TypeScript, no server to maintain)
- Local CLI / web server mode (Python standard library only)
- Reverse-proxy friendly (`BASE_URL` / `BASE_URL_ALIASES`)

## Providers

| Provider   | Slug  | Env key       | Status    |
|------------|-------|---------------|-----------|
| Z.ai (GLM) | `zai` | `ZAI_API_KEY` | Supported |

## Installation

### Cloudflare Worker (production)

```bash
# Install dependencies
npm install

# Login to Cloudflare (once)
npx wrangler login

# Set the provider API key as a Worker secret (once)
npx wrangler secret put ZAI_API_KEY

# Deploy manually (CI does this automatically on push to main)
npm run deploy
```

GitHub Actions requires the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

### Python CLI / local server

#### Prerequisites

- Python 3.9 or higher

#### Setup

```bash
# Clone repository
git clone <repository-url>
cd quota

# Run setup script
./scripts/setup-env.sh

# Configure environment variables
nano .env
```

Set your provider API keys and optional port / base URL in `.env`:
```
ZAI_API_KEY=your_api_key_here
PORT=9999
BASE_URL=/quota
BASE_URL_ALIASES=
```

- `BASE_URL`: main path served by the web server (default: `/quota`)
- `BASE_URL_ALIASES`: additional comma-separated paths to accept (e.g. `/zai-quota` to keep an old reverse-proxy path working)

## Usage

### CLI

```bash
# Comprehensive view of all providers (uses keys from .env)
./scripts/run.sh

# Single provider
./scripts/run.sh zai

# List registered providers and their configuration status
./scripts/run.sh --list

# Start web server (port from .env or --port)
./scripts/run.sh --server
./scripts/run.sh --server --port 8080
```

API keys are read from the environment (`.env` is loaded by `run.sh`).

### Web Server Routes

With the default `BASE_URL=/quota`:

```bash
# Comprehensive view across all providers
curl http://localhost:9999/quota

# Single provider
curl http://localhost:9999/quota/zai
```

**Production (Cloudflare Worker):** the same routes are live at
`https://xcv.kr/quota` and `https://xcv.kr/quota/zai` (also at `https://zai-quota.y-e2f.workers.dev`).

If HAProxy (or any reverse proxy) forwards additional paths, list them in `BASE_URL_ALIASES`. For example, with `BASE_URL=/quota` and `BASE_URL_ALIASES=/zai-quota`, both `/quota` and `/zai-quota` work identically. (On the Worker, the same options are set in `wrangler.toml` `[vars]`.)

Unknown paths return `404` with a JSON error. A failing provider never breaks the comprehensive view — it is reported with a per-provider `status`.

### systemd Service (Linux)

```bash
# Install systemd service (runs web server)
./scripts/install-systemd.sh

# Check service status
systemctl --user status quota.service

# View logs
journalctl --user -u quota.service -f

# Stop service
systemctl --user stop quota.service

# Restart service
systemctl --user restart quota.service
```

The systemd service runs the web server continuously with auto-restart on failure. Port is configured via the `PORT` environment variable in `.env` (default: 9999).

### xcv.kr Routing Map

| Path         | Served by |
|--------------|-----------|
| `/quota`     | Cloudflare Worker (`worker/`) — https://xcv.kr/quota |
| `/hwpx`      | Cloudflare Worker (`gateway/`) → md2hwpx.vercel.app |
| `/mask`      | Cloudflare Worker (`gateway/`) → mask-eta.vercel.app |
| `/blog`      | Caddy → xcvkr.vercel.app |
| `/math`      | Caddy → 10.0.0.2:3141 |
| `/pe-gtd`    | Caddy → 10.0.0.2:7000 |
| `/shs-exams` | Caddy → 10.0.0.2:8767 |

`quota`, `hwpx`, and `mask` no longer depend on the Caddy gateway host — they run entirely on Cloudflare Workers.

## Adding a New Provider

1. Create `src/providers/<name>.py` with a `QuotaProvider` subclass:

```python
from .base import QuotaMetrics, QuotaProvider


class MyProvider(QuotaProvider):
    name = "myprovider"          # URL slug: /quota/myprovider
    display_name = "My Provider"
    env_key = "MYPROVIDER_API_KEY"

    def fetch(self, api_key: str) -> QuotaMetrics:
        # Query the provider API and normalize the result
        ...
        return QuotaMetrics(
            quota_percentage=percentage,
            next_reset_ms=next_reset_epoch_ms,  # or omit if unknown
        )
```

2. Register it in `src/providers/__init__.py`:

```python
from .myprovider import MyProvider

PROVIDERS = [
    ZaiProvider(),
    MyProvider(),
]
```

The slug, aggregate view, CLI, and configuration checks are wired up automatically.

## Output Format

Single provider (`/quota/zai`, CLI `zai`):

```json
{
  "quotaPercentage": 100,
  "nextReset": "14:10",
  "remainingTime": "00:17"
}
```

- `quotaPercentage`: Percentage of quota currently used (0-100)
- `nextReset`: Local time when quota resets (HH:mm)
- `remainingTime`: Time remaining until reset (HH:mm)

Comprehensive view (`/quota`, CLI without arguments):

```json
{
  "generatedAt": "2026-09-26T19:30:59",
  "providers": {
    "zai": {
      "configured": true,
      "status": "ok",
      "quotaPercentage": 100,
      "nextReset": "14:10",
      "remainingTime": "00:17"
    }
  }
}
```

Per-provider `status` is one of `ok`, `not_configured`, or `error` (with an `error` message).

## Sample Raw Z.ai API Response

```json
{
  "code": 200,
  "msg": "Operation successful",
  "data": {
    "limits": [
      {
        "type": "TOKENS_LIMIT",
        "unit": 3,
        "number": 5,
        "percentage": 100,
        "nextResetTime": 1771391456700
      }
    ],
    "level": "lite"
  },
  "success": true
}
```

## Project Structure

```
quota/
├── worker/                 # Cloudflare Worker (TypeScript, production)
│   ├── index.ts            # HTTP routing, aggregation, JSON responses
│   └── providers/          # Provider framework
│       ├── base.ts         # QuotaProvider interface + helpers
│       └── zai.ts          # Z.ai provider
├── wrangler.toml           # Worker config (name, vars, routes)
├── package.json            # npm scripts: dev / deploy / typecheck
├── src/                    # Python CLI / local server
│   ├── main.py             # HTTP server, routing, CLI
│   └── providers/          # Provider framework
│       ├── __init__.py     # Provider registry
│       ├── base.py         # QuotaProvider ABC + QuotaMetrics
│       └── zai.py          # Z.ai provider
├── tests/                  # Python test suite
│   ├── __init__.py
│   ├── test_main.py
│   ├── test_server_routing.py
│   └── README.md
├── scripts/                # Local setup scripts
│   ├── setup-env.sh        # Environment setup
│   ├── run.sh              # Main execution script
│   └── systemd/            # systemd configuration files (local server)
│       └── quota.service
├── .env.example            # Environment variable template
├── .gitignore              # Git ignore file
└── README.md               # This file
```

## Running Tests

```bash
# Run all tests
python3 -m unittest discover tests

# Run specific test file
python3 -m unittest tests.test_main

# Verbose output
python3 -m unittest discover tests -v
```

## License

MIT License
