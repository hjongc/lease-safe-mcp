# Lease Safe Operations Runbook

This runbook is for PlayMCP registration, demo day checks, and post-launch operation. Do not store secrets in this repository.

## Required Runtime Settings

- `DATA_GO_KR_SERVICE_KEY`: required in production and CI live smoke.
- `MCP_ALLOWED_HOSTS`: required in production for DNS rebinding protection.
- `MCP_MAX_BODY_BYTES`: optional MCP POST body limit, default `262144`.
- `MCP_RATE_LIMIT_PER_MINUTE`: optional MCP POST rate limit per client, default `120`, set `0` to disable.
- `PUBLIC_DATA_TIMEOUT_MS`: optional official public-data timeout, default `8000`, maximum `60000`.
- `MCP_AUTH_TOKEN`: optional bearer token for private direct deployments.

The server fails at startup when required production settings are missing or malformed. Fix configuration instead of adding fallback data.

## Secret Setup

GitHub Actions live public-data smoke:

```bash
gh secret set DATA_GO_KR_SERVICE_KEY --repo hjongc/lease-safe-mcp
gh workflow run CI --repo hjongc/lease-safe-mcp --ref main
```

PlayMCP runtime:

- Set `DATA_GO_KR_SERVICE_KEY` in the PlayMCP runtime environment.
- Set `MCP_ALLOWED_HOSTS` to the PlayMCP host or custom deployment domain.
- Leave `MCP_AUTH_TOKEN` unset unless the deployment is private and the client can send bearer auth.

Never paste secrets into issues, commits, README examples, screenshots, or CI logs.

## Pre-Registration Evidence

Collect this evidence before registering or updating the PlayMCP build:

- `npm run preflight:registration` passes with `DATA_GO_KR_SERVICE_KEY` set locally.
- Latest GitHub Actions `CI` run is green.
- GitHub Actions `Live public-data smoke` is passed, not skipped, after the repository secret is configured.
- Docker runtime smoke passes after image build.
- Demo tool is `assess_lease_safety`.
- Demo input uses a verified `lawdCd`, `dealYmd`, and `housingType` with live rent and sale samples.

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

- `GET /healthz` must return `ok: true`, `service: lease-safe`, `transport: streamable-http`, `stateless: true`, `maxBodyBytes`, `rateLimitPerMinute`, and `publicDataTimeoutMs`.
- `npm run smoke:http` verifies local HTTP MCP handshake, tool metadata, a lightweight tool call, and oversized request rejection.
- `npm run smoke:rate-limit` verifies the MCP POST rate limiter returns `429` with `Retry-After`.
- `npm run smoke:docker` verifies the built image starts in production mode, answers `/healthz`, rejects oversized MCP requests, and completes MCP handshake/list-tools.
- `npm run smoke:public-data` verifies legal-dong lookup, all rent APIs, all sale APIs, and the flagship assessment against live official APIs.
- `npm run preflight:registration` runs the full release preflight and fails if live public-data smoke cannot run.

## Incident Response

If API-backed tools fail:

1. Check whether `DATA_GO_KR_SERVICE_KEY` is configured in the runtime and has active data.go.kr approvals.
2. Run `npm run smoke:public-data` with the same key outside the deployment.
3. If data.go.kr returns an auth or quota payload, keep the original error visible and rotate or re-approve the key.
4. If requests time out, lower demo scope only by changing `PUBLIC_DATA_SMOKE_HOUSING_TYPES`; do not add fake sample data.
5. If all live public-data checks pass locally but fail in deployment, inspect host allowlist, egress/network policy, and runtime env injection.

## Key Rotation

1. Add or renew the data.go.kr service key approvals for all required APIs.
2. Update the GitHub repository secret `DATA_GO_KR_SERVICE_KEY`.
3. Update the PlayMCP runtime `DATA_GO_KR_SERVICE_KEY`.
4. Run GitHub Actions `CI` and confirm live public-data smoke passes.
5. Run the PlayMCP demo entry tool once with the recommended input.

Do not remove the old key until both CI and the runtime smoke have passed with the new key.

## Boundaries

Lease Safe provides official-source guidance and risk signals. It does not provide legal advice, final registry rights analysis, HUG eligibility decisions, or a guarantee that a specific property is safe.
