# Lease Safe Operations Runbook

This runbook is for PlayMCP registration, demo day checks, and post-launch operation. Do not store secrets in this repository.

## Required Runtime Settings

- `DATA_GO_KR_SERVICE_KEY`: required in production and CI live smoke; encoded and decoded keys are accepted, but whitespace is rejected.
- `MCP_ALLOWED_HOSTS`: required in production for DNS rebinding protection.
- `MCP_MAX_BODY_BYTES`: optional MCP POST body limit, default `262144`, maximum `1048576`.
- `MCP_RATE_LIMIT_PER_MINUTE`: optional MCP POST rate limit per client, default `120`, maximum `10000`, set `0` to disable.
- `PUBLIC_DATA_TIMEOUT_MS`: optional official public-data timeout, default `8000`, maximum `60000`.
- `MCP_AUTH_TOKEN`: optional bearer token for private direct deployments; must be a real visible-ASCII token, not a placeholder, at least 16 characters, and free of whitespace when set.

The server fails at startup when required production settings are missing or malformed. Fix configuration instead of adding fallback data.

## Secret Setup

GitHub Actions live public-data smoke:

```bash
gh secret set DATA_GO_KR_SERVICE_KEY --repo hjongc/lease-safe-mcp
npm run check:github-secret
gh secret list --repo hjongc/lease-safe-mcp
gh workflow run CI --repo hjongc/lease-safe-mcp --ref main
gh workflow run "Registration Preflight" --repo hjongc/lease-safe-mcp --ref main
npm run check:registration-readiness
```

After setting the secret, run `npm run check:github-secret` and confirm that `gh secret list --repo hjongc/lease-safe-mcp` shows `DATA_GO_KR_SERVICE_KEY`. These commands check only secret names and metadata, not the secret value. If the secret is absent, do not treat a green CI run as registration evidence because the live public-data smoke will be skipped.

Before registering, run `npm run check:registration-readiness` from a clean worktree. It fails unless the current commit has the GitHub repository secret configured, `CI` completed successfully with `Live public-data smoke` passed instead of skipped, and `Registration Preflight` completed successfully with its evidence summary published for that exact commit on `main`.

If the default live demo region or month returns zero official samples, rerun the manual `Registration Preflight` workflow with verified public demo inputs:

```bash
gh workflow run "Registration Preflight" --repo hjongc/lease-safe-mcp --ref main \
  -f public_data_smoke_region="서울 관악구" \
  -f public_data_smoke_lawd_cd=11620 \
  -f public_data_smoke_deal_ymd=202605 \
  -f public_data_smoke_deposit_manwon=30000
```

PlayMCP runtime:

- Set `DATA_GO_KR_SERVICE_KEY` in the PlayMCP runtime environment.
- Set `MCP_ALLOWED_HOSTS` to the PlayMCP host or custom deployment domain. Use unique plain hostnames only; do not include `https://`, ports, paths, wildcards, userinfo, query strings, fragments, backslashes, whitespace, blank comma-separated entries, underscores, empty labels, or labels that start or end with `-`.
- Put the primary PlayMCP host first in `MCP_ALLOWED_HOSTS`; the Docker `HEALTHCHECK` dials loopback but sends that first allowed host as the `Host` header, so DNS rebinding protection and container liveness checks do not conflict.
- Leave `MCP_AUTH_TOKEN` unset unless the deployment is private and the client can send bearer auth. If set, use a real visible-ASCII token, not a placeholder, with at least 16 characters and no whitespace.

Never paste secrets into issues, commits, README examples, screenshots, or CI logs.

## Pre-Registration Evidence

Collect this evidence before registering or updating the PlayMCP build:

- `npm run preflight:registration` passes with `DATA_GO_KR_SERVICE_KEY` set locally.
- GitHub Actions `Registration Preflight` workflow passes on the submitted commit.
- GitHub Actions `Registration Preflight` job summary shows the submitted commit, workflow run URL, required command, GitHub public-data secret status without printing the value, live public-data requirement, required housing coverage, sanitized and length-limited demo smoke input values, working-tree/staged/committed whitespace diff check coverage, root route minimality smoke coverage, MCP request-id smoke coverage, Docker runtime smoke coverage, non-root runtime evidence, scriptless npm install evidence, and the extracted live public-data evidence lines.
- Latest GitHub Actions `CI` run is green and its summary shows required housing coverage, working-tree/staged/committed whitespace diff checks, root route minimality smoke evidence, MCP request-id smoke evidence, Docker runtime smoke evidence, non-root runtime evidence, scriptless npm install evidence, and extracted live public-data evidence lines when the repository secret is configured.
- `npm run check:registration-readiness` passes on the clean submitted commit, including CI live public-data smoke step success and Registration Preflight evidence-summary success.
- GitHub Actions `Live public-data smoke` is passed, not skipped, after the repository secret is configured.
- Docker runtime smoke passes after image build.
- Demo tool is `assess_lease_safety`.
- Demo input uses a positive `depositManwon` plus a verified `lawdCd`, `dealYmd`, and `housingType` with positive live rent and sale sample counts.

Recommended demo input:

```json
{
  "housingType": "apartment",
  "lawdCd": "11620",
  "dealYmd": "202605",
  "region": "서울 관악구",
  "contractType": "jeonse",
  "depositManwon": 30000,
  "concerns": "대리계약이고 오늘 계약금을 보내라고 합니다. 근저당도 걱정됩니다."
}
```

## Health And Smoke Checks

- `GET /` must return only a text/plain MCP usage hint. It must not expose runtime configuration names or tuning values.
- `GET /healthz` must return only minimal liveness metadata: `ok: true`, `service: lease-safe`, and `version`. It must not expose request-size, rate-limit, or public-data timeout tuning values.
- HTTP responses must set a safe `X-Request-Id` for log correlation, preserve safe inbound request IDs, regenerate unsafe inbound values, and set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store`; they must not expose `X-Powered-By`.
- `npm run smoke:http` verifies local HTTP MCP handshake, tool metadata, root route minimality, DNS-rebinding Host rejection, unknown-route rejection and encoded-path rejection with JSON `404`, unsupported-method rejection with `Allow: POST`, invalid-JSON rejection, unsupported-content-type rejection, compressed-request rejection, bearer-auth rejection with `WWW-Authenticate` and JSON-RPC `-32001`, oversized request rejection in JSON-RPC `-32600` format, a lightweight tool call, and official source registry access.
- `npm run smoke:rate-limit` verifies the MCP POST rate limiter returns `429` with `Retry-After`, preserves the same security headers used by normal responses, and keeps the rejection in JSON-RPC `-32002` format.
- `npm run smoke:docker` verifies the built image starts in production mode as a non-root runtime user, answers `/healthz`, keeps the public root route minimal, proves the Docker `HEALTHCHECK` still works when `MCP_ALLOWED_HOSTS` contains only an external deployment host, rejects disallowed Host headers, unknown routes, encoded paths, unsupported methods, invalid JSON, unsupported content types, compressed requests, unauthenticated requests in JSON-RPC `-32001` format, and oversized MCP requests in JSON-RPC `-32600` format, then completes MCP handshake/list-tools and official source registry access.
- `npm run smoke:public-data` verifies legal-dong lookup, all rent APIs, all sale APIs, and the flagship assessment for every selected housing type against live official APIs. It prints a `public_data_smoke_config` line with `registration_mode` plus the non-secret demo region, LAWD code, deal month, housing types, and deposit used for evidence. A successful registration run must also show `legal_dong=ok`, `rent_market[...]`, `sale_market[...]`, and `lease_assessment[...]` evidence lines for every selected housing type. It fails when `PUBLIC_DATA_SMOKE_DEPOSIT_MANWON` is not positive or when a rent, sale, or flagship assessment API path returns zero samples, because registration evidence must prove a real demo data path.
- `npm run preflight:registration` runs the full release preflight, including working-tree, staged, and committed whitespace diff checks, and fails if live public-data smoke cannot run for every supported housing type or if its output does not contain extractable registration evidence lines. The Docker build step retries transient Docker or registry failures up to 3 times, then still fails if the image cannot be built.
- GitHub Actions `Registration Preflight` runs `npm run preflight:registration` manually and fails when `DATA_GO_KR_SERVICE_KEY` is missing, so use it as shareable registration evidence.

## Incident Response

If API-backed tools fail:

1. Check whether `DATA_GO_KR_SERVICE_KEY` is configured in the runtime and has active data.go.kr approvals.
2. Run `npm run smoke:public-data` with the same key outside the deployment.
3. If data.go.kr returns an auth or quota payload, keep the original error visible and rotate or re-approve the key.
4. If requests time out or a region/month returns zero samples, narrow `PUBLIC_DATA_SMOKE_HOUSING_TYPES` only to isolate the failing source with `npm run smoke:public-data`, or choose a verified `PUBLIC_DATA_SMOKE_LAWD_CD` and `PUBLIC_DATA_SMOKE_DEAL_YMD`; do not use a narrowed smoke as registration evidence and do not add fake sample data.
5. If all live public-data checks pass locally but fail in deployment, inspect host allowlist, egress/network policy, and runtime env injection.

If a security issue or leaked secret is reported:

1. Do not discuss the secret value or exploit details in public issues, commits, screenshots, or logs.
2. Rotate the affected runtime secret.
3. Update GitHub Actions secrets and PlayMCP runtime environment.
4. Run `npm run preflight:registration`.
5. Review `SECURITY.md` before publishing the fix.

## Key Rotation

1. Add or renew the data.go.kr service key approvals for all required APIs.
2. Update the GitHub repository secret `DATA_GO_KR_SERVICE_KEY`.
3. Update the PlayMCP runtime `DATA_GO_KR_SERVICE_KEY`.
4. Run GitHub Actions `CI` and `Registration Preflight`, then confirm live public-data smoke passes.
5. Run the PlayMCP demo entry tool once with the recommended input.

Do not remove the old key until both CI and the runtime smoke have passed with the new key.

## Dependency Maintenance

- Dependabot monitors npm packages, GitHub Actions, and Docker base images weekly.
- Dependabot ignores semver-major version updates before registration; review major upgrades as planned release work after the contest submission is stable.
- Do not merge dependency PRs unless GitHub Actions CI is green.
- For production dependencies, also check `npm audit --omit=dev` and `npm run validate:playmcp`.

## Boundaries

Lease Safe provides official-source guidance and risk signals. It does not provide legal advice, final registry rights analysis, HUG eligibility decisions, or a guarantee that a specific property is safe.
