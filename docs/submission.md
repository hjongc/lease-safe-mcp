# PlayMCP Submission Pack

## Service Summary

Lease Safe(전월세안전내비) is a Korean lease-safety MCP server for people checking jeonse, wolse, and move-in risks before signing or paying. It combines official legal-dong lookup, MOLIT rent transactions, MOLIT sale transactions, contract red-flag triage, and official next-step routing.

## Recommended Registration Fields

- Name: `Lease Safe(전월세안전내비)`
- MCP server name: `lease-safe`
- Transport: Streamable HTTP
- Endpoint path: `/mcp`
- Health path: `/healthz` and Docker `HEALTHCHECK`
- Source build: Git repository + `Dockerfile`
- Container runtime user: non-root `node`
- Container smoke: image starts in production mode and passes `/healthz` plus MCP handshake/list-tools
- Branch: `main`
- Demo entry tool: `assess_lease_safety`

## Runtime Environment

Required:

- `DATA_GO_KR_SERVICE_KEY`: data.go.kr service key for legal-dong, rent, and sale transaction APIs
- `MCP_ALLOWED_HOSTS`: PlayMCP host or deployment domain for DNS rebinding protection, using plain hostnames or `host:port` values only

Optional:

- `MCP_AUTH_TOKEN`: bearer token of at least 16 characters for direct deployments that need private access control
- `MCP_MAX_BODY_BYTES`: MCP POST request body limit, default `262144`
- `MCP_RATE_LIMIT_PER_MINUTE`: MCP POST rate limit per client, default `120`, set `0` to disable
- `PUBLIC_DATA_TIMEOUT_MS`: official public-data API timeout, default `8000`, maximum `60000`
- `PORT`: HTTP port, default `3000`, integer `1..65535`

Do not commit runtime secrets. Configure them in PlayMCP or deployment environment settings.

The production server fails at startup if `MCP_ALLOWED_HOSTS` or `DATA_GO_KR_SERVICE_KEY` is missing. This is intentional: missing official-data configuration should be fixed before the demo, not hidden until a user calls the flagship tool.

The server also rejects oversized MCP request bodies, rate-limits MCP POST traffic, fails clearly on public-data timeout, disables `x-powered-by`, and handles container shutdown signals so PlayMCP can stop the image cleanly.

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
DATA_GO_KR_SERVICE_KEY=... npm run preflight:registration
```

Then confirm the latest GitHub Actions CI run is green. If `DATA_GO_KR_SERVICE_KEY` is configured as a GitHub repository secret, CI also runs the live public-data smoke.

CI also runs `npm run smoke:docker` after building the image, so registration should use a commit whose Docker image has been proven to boot and answer MCP requests before the optional live API smoke.

The live public-data smoke is intentionally stricter than a connectivity check: `PUBLIC_DATA_SMOKE_DEPOSIT_MANWON` must be positive, and rent and sale APIs must return positive sample counts for the configured demo region/month. A zero-sample official response means the demo input is not registration-ready yet.

Use `docs/operations.md` as the final registration runbook. Registration is not evidence-complete until `npm run preflight:registration` and the GitHub Actions live public-data smoke are passed, not skipped.
