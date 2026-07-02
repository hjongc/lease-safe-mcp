# PlayMCP Submission Pack

## Service Summary

Lease Safe(전월세안전내비) is a Korean lease-safety MCP server for people checking jeonse, wolse, and move-in risks before signing or paying. It combines official legal-dong lookup, MOLIT rent transactions, MOLIT sale transactions, contract red-flag triage, and official next-step routing.

## Recommended Registration Fields

- Name: `Lease Safe(전월세안전내비)`
- MCP server name: `lease-safe`
- Transport: Streamable HTTP
- Endpoint path: `/mcp`
- Health path: `/healthz` with minimal liveness metadata and Docker `HEALTHCHECK`
- Preferred build: Docker image or Git repository + `Dockerfile`, only when runtime secret settings are available
- Git URL: `https://github.com/hjongc/lease-safe-mcp.git`
- Immutable image: `ghcr.io/hjongc/lease-safe-mcp:sha-<short-sha>`
- Moving image: `ghcr.io/hjongc/lease-safe-mcp:main`
- Container platform: `linux/amd64`
- Container runtime user: non-root `node`
- Container smoke: image is `linux/amd64`, starts in production mode, and passes `/healthz`, root route minimality, and MCP handshake/list-tools
- Remote endpoint smoke: `MCP_ENDPOINT=https://<playmcp-host>/mcp MCP_AUTH_TOKEN=... npm run smoke:remote` after PlayMCP issues the endpoint
- Branch: `main`
- Demo entry tool: `assess_lease_safety`

## Runtime Environment

Required:

- `DATA_GO_KR_SERVICE_KEY`: data.go.kr service key for legal-dong, rent, and sale transaction APIs; encoded and decoded keys are accepted, but whitespace is rejected
- `MCP_ALLOWED_HOSTS`: PlayMCP host or deployment domain for DNS rebinding protection, using unique plain hostnames only; URL schemes, ports, paths, userinfo, query strings, fragments, wildcards, backslashes, whitespace, blank comma-separated entries, underscores, empty labels, and labels that start or end with `-` are rejected
- `MCP_AUTH_TOKEN`: production bearer token of at least 16 visible ASCII characters without whitespace; placeholders are rejected

Optional:

- `MCP_MAX_BODY_BYTES`: MCP POST request body limit, default `262144`, maximum `1048576`; blank configured values are rejected
- `MCP_RATE_LIMIT_PER_MINUTE`: MCP POST rate limit per client, default `120`, maximum `10000`, set `0` to disable; blank configured values are rejected
- `PUBLIC_DATA_TIMEOUT_MS`: official public-data API timeout, default `8000`, maximum `60000`; blank configured values are rejected
- `PORT`: HTTP port, default `3000`, integer `1..65535`; blank configured values are rejected

Do not commit runtime secrets. Configure them in PlayMCP or deployment environment settings.

Do not bake secrets into the image with Dockerfile `ENV`, build args, committed files, or hardcoded source. If PlayMCP image registration does not provide runtime secret settings, deploy the verified image to a secret-capable HTTPS runtime and register that external HTTPS endpoint in PlayMCP instead.

Use the immutable `sha-<short-sha>` GHCR image from the `Publish Image` workflow for submission evidence. If PlayMCP cannot pull private GHCR packages, make the package public or deploy the same image to a runtime that can authenticate to GHCR.

The production server fails at startup if `MCP_ALLOWED_HOSTS`, `DATA_GO_KR_SERVICE_KEY`, or `MCP_AUTH_TOKEN` is missing, or if official source registry metadata is invalid or stale. This is intentional: missing official-data configuration, unauthenticated MCP exposure, or broken official-source evidence should be fixed before the demo, not hidden until a user calls the flagship tool.

The Docker `HEALTHCHECK` connects to loopback but sends the first configured `MCP_ALLOWED_HOSTS` value as the `Host` header, so a production allowlist containing only the PlayMCP host can still pass container liveness checks.

The server keeps `GET /` to a text/plain MCP usage hint, rejects unknown and odd encoded routes with JSON `404`, bounds unexpected Express bad requests with JSON `400`, rejects unsupported `/mcp` methods with `Allow: POST`, rejects invalid JSON, compressed request bodies, non-JSON MCP POST bodies, malformed `Content-Length` headers, and oversized MCP request bodies before transport handling, advertises bearer authentication failures with `WWW-Authenticate`, rate-limits MCP POST traffic, verifies API-backed tools fail clearly when `DATA_GO_KR_SERVICE_KEY` is absent, fails clearly on public-data timeout, disables `x-powered-by`, emits `X-Request-Id` for log correlation, sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store`, and handles container shutdown signals so PlayMCP can stop the image cleanly.

## Demo Scenario

Use `assess_lease_safety` first.

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

Expected value shown in one response:

- overall risk level and explicit reasons
- nearby positive rent-market sample count and deposit median
- nearby positive sale-market sample count and deposit-to-sale ratio
- red flags such as proxy contract, mortgage, or rushed deposit pressure
- immediate next actions for registry, move-in report, fixed date, lease report, and HUG checks
- official source links

## Tool Lineup

- `assess_lease_safety`: one-shot flagship assessment
- `resolve_legal_dong_code`: region to legal-dong and `LAWD_CD`
- `compare_rent_market`: MOLIT rent transaction comparison
- `compare_deposit_to_sale_market`: MOLIT sale transaction ratio check
- `check_lease_red_flags`: contract risk signal triage
- `build_move_in_protection_plan`: move-in, fixed-date, and lease-report checklist
- `prepare_contract_questions`: questions for broker or landlord
- `route_official_help`: official service routing
- `explain_dispute_prevention`: dispute-prevention evidence guide
- `explain_data_availability`: data-source and boundary explanation

## Trust Boundaries

The service does not provide legal advice, final registry rights analysis, HUG eligibility decisions, or property safety guarantees. It fails clearly when official public-data APIs or required runtime configuration are unavailable.

## Final Preflight

Before registration:

```bash
DATA_GO_KR_SERVICE_KEY=... MCP_AUTH_TOKEN=... npm run preflight:registration
```

Then confirm the latest GitHub Actions CI run is green. If `DATA_GO_KR_SERVICE_KEY` is configured as a GitHub repository secret, CI also runs the live public-data smoke in registration mode and publishes the official source freshness gate, required housing coverage, and extracted live public-data evidence lines in the job summary.

Before trusting CI live-smoke evidence, run `npm run check:github-secret` and confirm the GitHub repository secrets exist. This check reads only GitHub secret names and metadata, not secret values.

For the final go/no-go check, run `npm run check:registration-readiness` from a clean worktree. It fails unless local `HEAD` matches the remote `main` HEAD, the current commit has the GitHub repository secrets configured, the `CI` workflow completed successfully with every required `Quality Gate` evidence step passed, including official source freshness, Docker build/runtime, live public-data smoke, and `Publish live public-data status`, the `Registration Preflight` workflow completed successfully with its evidence summary published inside the `Registration Evidence` job, and the `Publish Image` workflow published the verified GHCR image for that exact commit on `main`.

For shareable registration evidence, trigger the manual GitHub Actions **Registration Preflight** workflow on the submitted commit. This workflow runs `npm run preflight:registration`, includes working-tree, staged, and committed whitespace diff checks, fails when `DATA_GO_KR_SERVICE_KEY` or `MCP_AUTH_TOKEN` is missing instead of treating registration evidence as optional, and publishes a GitHub Actions job summary with the commit, workflow run URL, required command, GitHub public-data and MCP auth secret status without printing values, official source freshness coverage, live public-data requirement, required housing coverage, sanitized, length-limited demo smoke input values, root route minimality smoke coverage, API-backed missing-key smoke coverage when applicable, MCP request-id smoke coverage, Docker runtime smoke coverage, non-root runtime evidence, scriptless npm install evidence, and extracted live public-data evidence lines.

CI also runs `npm run smoke:docker` after building the image, so registration should use a commit whose Docker image has been proven to boot and answer MCP requests before the optional live API smoke.

The live public-data smoke is intentionally stricter than a connectivity check: `PUBLIC_DATA_SMOKE_DEPOSIT_MANWON` must be positive, `npm run preflight:registration` must cover every supported housing type, rent, sale, and flagship assessment API paths must return positive sample counts plus official `totalCount` evidence for the configured demo region/month, and the captured output must produce extractable registration evidence lines. The shareable log evidence should include a `legal_dong=ok lawd_cd=...` line matching the configured LAWD code, plus `rent_market[...]`, `sale_market[...]`, and `lease_assessment[...]` lines for every supported housing type. Each flagship `lease_assessment[...]` line must include `risk_level=high` or `risk_level=very_high`, proving the high-risk demo concerns are classified as high risk against live official data. A zero-sample official response or low-risk flagship demo result means the demo input is not registration-ready yet.

Use `docs/operations.md` as the final registration runbook. Registration is not evidence-complete until `npm run preflight:registration`, the GitHub Actions **Registration Preflight** workflow summary, and the GitHub Actions live public-data smoke are passed, not skipped.
