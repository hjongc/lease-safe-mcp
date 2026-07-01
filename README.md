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
- GitHub Actions CI runs secret scan, tests, PlayMCP validation, local MCP HTTP smoke, MCP boundary rejection smoke, rate-limit smoke, production dependency audit, Docker build, and Docker runtime smoke

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
- 국세청
- 위택스

`DATA_GO_KR_SERVICE_KEY` is required for API-backed tools: `assess_lease_safety`, `resolve_legal_dong_code`, `compare_rent_market`, and `compare_deposit_to_sale_market`. Encoded and decoded data.go.kr keys are both accepted. Missing keys, placeholder values, malformed percent-encoding, short or syntactically invalid keys, or data.go.kr rejections fail clearly instead of using fake sample data.

## Flagship Tool

`assess_lease_safety` is the primary tool to show in a demo. It takes `housingType`, `lawdCd`, `dealYmd`, `depositManwon`, and optional situation details, then returns:

- an overall risk level with explicit reasons
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

Use unique plain hostnames only. Do not include `https://`, ports, paths, whitespace, wildcards, blank comma-separated entries, underscores, empty labels, or labels that start or end with `-`.

Production also requires the official public-data key at startup because the flagship tool depends on live legal-dong, rent, and sale APIs:

```bash
DATA_GO_KR_SERVICE_KEY=your-data-go-kr-service-key
```

Optional bearer-token protection is available for direct deployments:

```bash
MCP_AUTH_TOKEN=replace-with-runtime-secret
```

When `MCP_AUTH_TOKEN` is set, it must be a real token, not a placeholder, and at least 16 characters. `POST /mcp` then requires `Authorization: Bearer <token>`.

Optional request-size hardening is available for deployments with stricter ingress limits:

```bash
MCP_MAX_BODY_BYTES=262144
```

The default MCP request body limit is 262144 bytes. Invalid values fail at startup instead of silently changing runtime behavior.

Optional MCP request rate limiting is available for public deployments:

```bash
MCP_RATE_LIMIT_PER_MINUTE=120
```

The default MCP POST rate limit is 120 requests per client per minute. Set `MCP_RATE_LIMIT_PER_MINUTE=0` to disable it when an upstream gateway already enforces stricter limits.

Optional public-data timeout tuning is available when the deployment ingress has a tighter request budget:

```bash
PUBLIC_DATA_TIMEOUT_MS=8000
```

The default official public-data API timeout is 8000ms, with a maximum accepted value of 60000ms. Invalid values fail before requests are made.

## Run Locally

Use Node.js 20 or newer with npm 10 or newer. `.npmrc` enables `engine-strict=true`, so unsupported runtimes fail during `npm ci`. It also sets `ignore-scripts=true`, so dependency lifecycle scripts do not run during install.

```bash
npm ci --ignore-scripts
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

Start a local server and run the MCP HTTP smoke in one command:

```bash
npm run smoke:http
```

Release preflight:

```bash
npm run preflight
```

`npm run preflight` runs working-tree, staged, and committed whitespace diff checks, secret scan, unit tests, PlayMCP validation, local MCP HTTP smoke with root route minimality, DNS-rebinding Host rejection, unsupported-method, invalid-JSON, unsupported-content-type, bearer-auth, and oversized-request rejection checks, MCP rate-limit smoke, production dependency audit, Docker build, Docker runtime smoke with the same MCP boundary checks, and live public-data smoke with extracted evidence-line validation when `DATA_GO_KR_SERVICE_KEY` is set.

Registration preflight:

```bash
DATA_GO_KR_SERVICE_KEY=... npm run preflight:registration
```

`npm run preflight:registration` runs the same checks but requires the live public-data smoke to run, pass for every supported housing type, and produce extractable registration evidence lines. Use it before PlayMCP registration.

For registration evidence in GitHub Actions, run the manual **Registration Preflight** workflow after adding `DATA_GO_KR_SERVICE_KEY` as a repository secret. Unlike the normal CI workflow, this workflow fails instead of skipping when the live public-data key is missing.

Live public-data smoke before production rollout:

```bash
DATA_GO_KR_SERVICE_KEY=... npm run smoke:public-data
```

By default, the live public-data smoke checks legal-dong lookup, rent-market APIs for all four housing types, sale-market APIs for all four housing types, and the flagship one-shot assessment for every selected housing type. Successful registration evidence includes `legal_dong=ok`, `rent_market[...]`, `sale_market[...]`, and `lease_assessment[...]` log lines for every selected housing type.

Optional overrides:

```bash
PUBLIC_DATA_SMOKE_REGION="서울 관악구" PUBLIC_DATA_SMOKE_LAWD_CD=11620 PUBLIC_DATA_SMOKE_DEAL_YMD=202605 DATA_GO_KR_SERVICE_KEY=... npm run smoke:public-data
```

To narrow the live smoke while debugging one source:

```bash
PUBLIC_DATA_SMOKE_HOUSING_TYPES=apartment,rowhouse DATA_GO_KR_SERVICE_KEY=... npm run smoke:public-data
```

Do not use a narrowed `PUBLIC_DATA_SMOKE_HOUSING_TYPES` list as registration evidence. `npm run preflight:registration` fails unless all supported housing types are included.

## CI Gate

The repository includes `.github/workflows/ci.yml` for `main`. It runs:

- `npm ci --ignore-scripts`
- `npm test`
- `npm run scan:secrets`
- `npm run validate:playmcp`
- `npm run smoke:http`
- `npm run smoke:rate-limit`
- `npm audit --omit=dev`
- `docker build -t lease-safe-mcp-ci .`
- `npm run smoke:docker`

If the GitHub repository has a `DATA_GO_KR_SERVICE_KEY` secret, CI also runs the live public-data smoke against all supported housing types in registration mode and publishes the extracted live public-data evidence lines in the job summary. Without that secret, the live API smoke is skipped and local pre-submission smoke should be run with the key.

## Submission Checklist

Before registering in PlayMCP:

- Review `SECURITY.md`
- Review `docs/submission.md`
- Review `docs/operations.md`
- Run `npm run preflight:registration` locally with `DATA_GO_KR_SERVICE_KEY` set
- Run the manual GitHub Actions `Registration Preflight` workflow on the submitted commit
- Confirm the latest GitHub Actions CI run is green
- Confirm GitHub Actions live public-data smoke is passed, not skipped
- Configure the same `DATA_GO_KR_SERVICE_KEY` as a PlayMCP runtime environment variable
- Set `MCP_ALLOWED_HOSTS` to the PlayMCP host or deployment domain
- Use `assess_lease_safety` as the demo entry tool

PlayMCP in KC Git-source build:

- Git URL: `https://github.com/hjongc/lease-safe-mcp.git`
- Branch/ref: `main`
- Dockerfile path: `Dockerfile`
- PAT: empty if the repository is public
