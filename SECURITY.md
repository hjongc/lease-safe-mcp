# Security Policy

## Supported Version

`main` is the only supported branch before PlayMCP registration. Security fixes should land on `main` and pass the full CI gate before deployment.

## Reporting A Vulnerability

Do not disclose vulnerabilities, runtime secrets, API keys, tokens, or exploit details in public issues, commit messages, screenshots, or CI logs.

For this competition build, report security issues privately to the repository owner and include:

- affected file, endpoint, or tool
- reproduction steps without secrets
- expected and actual behavior
- impact assessment
- suggested fix if known

## Secret Handling

- Never commit `.env`, `.env.*`, `DATA_GO_KR_SERVICE_KEY`, `MCP_AUTH_TOKEN`, or copied PlayMCP runtime secrets.
- Rotate `DATA_GO_KR_SERVICE_KEY` if it appears in chat, logs, issues, screenshots, or command history.
- After rotating, update GitHub Actions secrets and PlayMCP runtime environment, then run `npm run preflight:registration`.

## Security Gates

Every production-bound change should pass:

- `npm run scan:secrets`
- `npm test`
- `npm run validate:playmcp`
- `npm run smoke:http`
- `npm run smoke:rate-limit`
- `npm audit --omit=dev`
- Docker build and `npm run smoke:docker`

Before PlayMCP registration, `npm run preflight:registration` must pass with a live `DATA_GO_KR_SERVICE_KEY`.

## Dependency Updates

Dependabot is configured for npm dependencies and GitHub Actions. Dependency PRs should not be merged until CI is green and the PlayMCP validation still passes.
