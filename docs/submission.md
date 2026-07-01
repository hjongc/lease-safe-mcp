# PlayMCP Submission Pack

## Service Summary

Lease Safe(전월세안전내비) is a Korean lease-safety MCP server for people checking jeonse, wolse, and move-in risks before signing or paying. It combines official legal-dong lookup, MOLIT rent transactions, MOLIT sale transactions, contract red-flag triage, and official next-step routing.

## Recommended Registration Fields

- Name: `Lease Safe(전월세안전내비)`
- MCP server name: `lease-safe`
- Transport: Streamable HTTP
- Endpoint path: `/mcp`
- Health path: `/healthz`
- Source build: Git repository + `Dockerfile`
- Branch: `main`
- Demo entry tool: `assess_lease_safety`

## Runtime Environment

Required:

- `DATA_GO_KR_SERVICE_KEY`: data.go.kr service key for legal-dong, rent, and sale transaction APIs
- `MCP_ALLOWED_HOSTS`: PlayMCP host or deployment domain for DNS rebinding protection

Optional:

- `MCP_AUTH_TOKEN`: bearer token for direct deployments that need private access control
- `PORT`: HTTP port, default `3000`

Do not commit runtime secrets. Configure them in PlayMCP or deployment environment settings.

The production server fails at startup if `MCP_ALLOWED_HOSTS` or `DATA_GO_KR_SERVICE_KEY` is missing. This is intentional: missing official-data configuration should be fixed before the demo, not hidden until a user calls the flagship tool.

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
- nearby rent-market sample count and deposit median
- nearby sale-market sample count and deposit-to-sale ratio
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
DATA_GO_KR_SERVICE_KEY=... npm run preflight
```

Then confirm the latest GitHub Actions CI run is green. If `DATA_GO_KR_SERVICE_KEY` is configured as a GitHub repository secret, CI also runs the live public-data smoke.
