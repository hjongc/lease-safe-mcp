# Lease Safe MCP

`Lease Safe(전월세안전내비)` is a PlayMCP-compatible remote MCP server for Korean lease, jeonse, wolse, and moving-safety guidance.

It uses official public data and reviewed official guidance to help users:

- run a one-shot lease safety assessment that combines rent market, sale market, red flags, and next actions
- convert a region name into official legal-dong codes through the official legal-dong API
- compare nearby reported rent deposits when a data.go.kr API key is configured
- compare a deposit against nearby sale prices to estimate sale-price-to-deposit risk
- detect contract red flags without making legal conclusions
- plan move-in protection steps such as move-in report, fixed date, and lease report
- prepare questions for landlords, agents, and official institutions
- route users to Government24, RTMS, Internet Registry Office, HUG, and lease dispute mediation paths
- summarize common lease-dispute prevention steps

## PlayMCP Fit

- Streamable HTTP transport: `POST /mcp`
- Stateless server
- Tool count: 10
- No `kakao` string in server or tool names
- Required tool annotations included
- Compact Korean markdown outputs
- Dockerfile included for PlayMCP in KC Git source build

## Data Sources

Automatic data:

- 행정안전부 행정표준코드 법정동코드 OpenAPI
- 국토교통부 아파트, 연립다세대, 단독/다가구, 오피스텔 전월세 실거래가 OpenAPI
- 국토교통부 아파트, 연립다세대, 단독/다가구, 오피스텔 매매 실거래가 OpenAPI

Reviewed official guidance:

- 정부24
- 부동산거래관리시스템 RTMS
- 인터넷등기소
- 법제처 찾기쉬운 생활법령
- 국가법령정보센터
- 한국부동산원·LH 임대차분쟁조정위원회
- HUG 주택도시보증공사

`DATA_GO_KR_SERVICE_KEY` is required for API-backed tools: `assess_lease_safety`, `resolve_legal_dong_code`, `compare_rent_market`, and `compare_deposit_to_sale_market`. Encoded and decoded data.go.kr keys are both accepted. If the key is missing or rejected by data.go.kr, those tools fail clearly instead of using fake sample data.

## Flagship Tool

`assess_lease_safety` is the primary tool to show in a demo. It takes `housingType`, `lawdCd`, `dealYmd`, `depositManwon`, and optional situation details, then returns:

- nearby rent-market median and sample transactions
- nearby sale-market median and deposit-to-sale ratio
- contract red flags from the user's situation
- immediate official next actions for registry, move-in report, fixed date, lease report, and HUG checks
- official source links used for the assessment

## Production Configuration

Production requires DNS rebinding protection:

```bash
MCP_ALLOWED_HOSTS=your.playmcp.host,your.custom.domain
```

Optional bearer-token protection is available for direct deployments:

```bash
MCP_AUTH_TOKEN=replace-with-runtime-secret
```

When `MCP_AUTH_TOKEN` is set, `POST /mcp` requires `Authorization: Bearer <token>`.

## Run Locally

```bash
npm install
npm run build
MCP_ALLOWED_HOSTS=127.0.0.1,localhost npm start
```

MCP endpoint:

```text
http://127.0.0.1:3000/mcp
```

Smoke:

```bash
MCP_ENDPOINT=http://127.0.0.1:3000/mcp npm run smoke
```

Live public-data smoke before production rollout:

```bash
DATA_GO_KR_SERVICE_KEY=... npm run smoke:public-data
```

Optional overrides:

```bash
PUBLIC_DATA_SMOKE_REGION="서울 관악구" PUBLIC_DATA_SMOKE_LAWD_CD=11620 PUBLIC_DATA_SMOKE_DEAL_YMD=202605 DATA_GO_KR_SERVICE_KEY=... npm run smoke:public-data
```

PlayMCP in KC Git-source build:

- Git URL: this repository URL
- Branch/ref: submission branch
- Dockerfile path: `Dockerfile`
- PAT: empty if the repository is public
