import { readFileSync } from "node:fs";
import { LEGAL_DONG_API, RENT_API_SPECS, SALE_API_SPECS, SOURCES } from "../src/sources.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertIncludesInOrder(text: string, values: string[], message: string): void {
  let cursor = -1;
  for (const value of values) {
    const next = text.indexOf(value, cursor + 1);
    assert(next > cursor, `${message}: ${value}`);
    cursor = next;
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  name: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};

for (const file of ["Dockerfile", ".dockerignore", ".github/workflows/ci.yml", ".github/workflows/registration-preflight.yml", ".github/dependabot.yml", "README.md", "SECURITY.md", "docs/data-design.md", "docs/submission.md", "docs/operations.md", "package-lock.json", "src/server.ts", "src/domain.ts", "src/sources.ts", "scripts/docker-image-reference.ts", "scripts/registration-preflight.ts", "scripts/require-registration-env.mjs", "scripts/rate-limit-smoke.ts"]) {
  readFileSync(file, "utf8");
}

assert(!/kakao/i.test(packageJson.name), "package name must not include kakao");
assert(packageJson.dependencies?.["@modelcontextprotocol/sdk"] === "1.29.0", "MCP SDK version must be pinned");
assert(packageJson.scripts?.build, "build script is required");
assert(packageJson.scripts?.test, "test script is required");
assert(packageJson.scripts?.["scan:secrets"], "secret scan script is required");
assert(packageJson.scripts?.smoke, "smoke script is required");
assert(packageJson.scripts?.["smoke:http"], "HTTP smoke script is required");
assert(packageJson.scripts?.["smoke:docker"], "Docker smoke script is required");
assert(packageJson.scripts?.["smoke:rate-limit"], "rate-limit smoke script is required");
assert(packageJson.scripts?.preflight, "preflight script is required");
assert(packageJson.scripts?.["preflight:registration"], "registration preflight script is required");
assert(/require-registration-env\.mjs/.test(packageJson.scripts?.["preflight:registration"] ?? ""), "registration preflight must check required live-data env before building");
assert(packageJson.scripts?.["validate:playmcp"], "PlayMCP validation script is required");

const registrationEnvCheck = readFileSync("scripts/require-registration-env.mjs", "utf8");
assert(/decodeURIComponent/.test(registrationEnvCheck), "registration env check must accept encoded data.go.kr service keys");
assert(/not a placeholder/.test(registrationEnvCheck), "registration env check must reject placeholder public-data keys before build");
assert(/must look like a real data\.go\.kr service key/.test(registrationEnvCheck), "registration env check must reject malformed public-data keys before build");

const dockerfile = readFileSync("Dockerfile", "utf8");
assert((dockerfile.match(/^FROM node:20-bookworm-slim@sha256:[a-f0-9]{64}/gm) ?? []).length === 3, "Dockerfile must pin every Node base image stage by digest");
assert(/COPY package\*\.json \.\//.test(dockerfile), "Dockerfile must copy package-lock.json for reproducible builds");
assert(/RUN npm ci/.test(dockerfile), "Dockerfile must use npm ci");
assert(/EXPOSE 3000/.test(dockerfile), "Dockerfile must expose port 3000");
assert(/USER node/.test(dockerfile), "Dockerfile runtime must use the non-root node user");
assert(/HEALTHCHECK[\s\S]*\/healthz/.test(dockerfile), "Dockerfile must healthcheck /healthz");
assert(/CMD \["node", "dist\/src\/server\.js"\]/.test(dockerfile), "Dockerfile CMD must start built server");

const dockerignore = readFileSync(".dockerignore", "utf8");
for (const pattern of [".git", ".env", ".env.*", "node_modules", "dist"]) {
  assert(dockerignore.split(/\r?\n/).includes(pattern), `.dockerignore must exclude ${pattern}`);
}

const secretScanSource = readFileSync("scripts/secret-scan.ts", "utf8");
assert(/"\.mjs"/.test(secretScanSource), "secret scan must cover checked-in ESM helper scripts");

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const registrationWorkflow = readFileSync(".github/workflows/registration-preflight.yml", "utf8");
const dependabot = readFileSync(".github/dependabot.yml", "utf8");
for (const workflow of [ci, registrationWorkflow]) {
  assert(/actions\/checkout@[a-f0-9]{40}/.test(workflow), "GitHub workflows must pin actions/checkout by commit SHA");
  assert(/actions\/setup-node@[a-f0-9]{40}/.test(workflow), "GitHub workflows must pin actions/setup-node by commit SHA");
  assert(!/actions\/(?:checkout|setup-node)@v\d+/.test(workflow), "GitHub workflows must not use mutable action version tags");
}
for (const command of ["npm ci", "npm run scan:secrets", "npm test", "npm run validate:playmcp", "npm run smoke:http", "npm run smoke:rate-limit", "npm audit --omit=dev", "docker build", "npm run smoke:docker"]) {
  assert(ci.includes(command), `CI must run ${command}`);
}
assertIncludesInOrder(ci, [
  "Scan for committed secrets",
  "Test",
  "Validate PlayMCP readiness",
  "Smoke local MCP HTTP server",
  "Smoke MCP rate limit",
  "Audit production dependencies",
  "Build Docker image",
  "Smoke Docker runtime",
  "Live public-data smoke",
  "Publish live public-data status"
], "CI evidence gates must run in release-risk order");
assert(/DATA_GO_KR_SERVICE_KEY/.test(ci), "CI must support optional live public-data smoke through DATA_GO_KR_SERVICE_KEY");
assert(/REQUIRE_LIVE_PUBLIC_DATA:\s*"1"/.test(ci), "CI live public-data smoke must use registration-mode coverage rules when a key is configured");
assert(/Publish live public-data status/.test(ci), "CI must publish whether live public-data smoke executed or skipped");
assert(/skipped because DATA_GO_KR_SERVICE_KEY is not configured/.test(ci), "CI summary must make skipped live public-data evidence explicit");
assert(/Registration Preflight workflow to pass/.test(ci), "CI summary must point operators to required registration evidence");
assert(/workflow_dispatch/.test(registrationWorkflow), "registration preflight workflow must be manually dispatchable");
for (const input of [
  "public_data_smoke_region",
  "public_data_smoke_lawd_cd",
  "public_data_smoke_deal_ymd",
  "public_data_smoke_deposit_manwon"
]) {
  assert(registrationWorkflow.includes(input), `registration preflight workflow must expose input: ${input}`);
}
assert(/DATA_GO_KR_SERVICE_KEY/.test(registrationWorkflow), "registration preflight workflow must inject DATA_GO_KR_SERVICE_KEY from secrets");
for (const envName of [
  "PUBLIC_DATA_SMOKE_REGION",
  "PUBLIC_DATA_SMOKE_LAWD_CD",
  "PUBLIC_DATA_SMOKE_DEAL_YMD",
  "PUBLIC_DATA_SMOKE_DEPOSIT_MANWON"
]) {
  assert(registrationWorkflow.includes(envName), `registration preflight workflow must pass demo env: ${envName}`);
  assert(registrationWorkflow.includes(`SAFE_${envName}`), `registration preflight summary must use sanitized demo env: ${envName}`);
}
assert(/Verify live public-data secret/.test(registrationWorkflow), "registration preflight workflow must fail fast when the live public-data secret is missing");
assert(/repository secret is required for registration evidence/.test(registrationWorkflow), "registration preflight workflow must explain the missing secret clearly");
assert(/npm run preflight:registration/.test(registrationWorkflow), "registration preflight workflow must run npm run preflight:registration");
assert(/GITHUB_STEP_SUMMARY/.test(registrationWorkflow), "registration preflight workflow must publish a shareable evidence summary");
assert(/sanitize_summary_value\(\)/.test(registrationWorkflow), "registration preflight summary must sanitize workflow-dispatch inputs");
assert(/local max_length=120/.test(registrationWorkflow), "registration preflight summary must bound workflow-dispatch input length");
assert(/\$\{#value\}/.test(registrationWorkflow), "registration preflight summary must measure sanitized input length before publishing");
assert(/\$\{value:0:\$max_length\}\.\.\./.test(registrationWorkflow), "registration preflight summary must truncate long workflow-dispatch inputs");
assert(/\$\{value\/\/\$'\\r'\/ \}/.test(registrationWorkflow), "registration preflight summary must neutralize carriage returns");
assert(/\$\{value\/\/\$'\\n'\/ \}/.test(registrationWorkflow), "registration preflight summary must neutralize line breaks");
assert(/\$\{value\/\/\$'\\t'\/ \}/.test(registrationWorkflow), "registration preflight summary must neutralize tabs");
assert(/\$\{value\/\/\\`\/ \}/.test(registrationWorkflow), "registration preflight summary must neutralize Markdown backticks");
assert(/Lease Safe Registration Evidence/.test(registrationWorkflow), "registration preflight summary must be clearly titled");
assert(/GITHUB_SHA/.test(registrationWorkflow), "registration preflight summary must include the submitted commit");
assert(/SAFE_GITHUB_REF_NAME="\$\(sanitize_summary_value "\$\{GITHUB_REF_NAME\}"\)"/.test(registrationWorkflow), "registration preflight summary must sanitize the submitted ref name");
assert(/Branch\/ref: \\`\$\{SAFE_GITHUB_REF_NAME\}\\`/.test(registrationWorkflow), "registration preflight summary must render the sanitized ref name");
assert(/GITHUB_RUN_ID/.test(registrationWorkflow), "registration preflight summary must include the workflow run URL");
assert(/Live public-data smoke: required by registration preflight/.test(registrationWorkflow), "registration preflight summary must state live public-data evidence is required");
assert(/Demo smoke region/.test(registrationWorkflow), "registration preflight summary must include the demo smoke region");
assert(/Demo smoke LAWD_CD/.test(registrationWorkflow), "registration preflight summary must include the demo smoke LAWD_CD");
assert(/Demo smoke deal month/.test(registrationWorkflow), "registration preflight summary must include the demo smoke deal month");
assert(/Demo smoke deposit/.test(registrationWorkflow), "registration preflight summary must include the demo smoke deposit");
assert(/Docker runtime smoke: included in registration preflight/.test(registrationWorkflow), "registration preflight summary must state Docker runtime evidence is included");
assertIncludesInOrder(registrationWorkflow, [
  "Verify live public-data secret",
  "Checkout",
  "Setup Node.js",
  "Install dependencies",
  "Run registration preflight",
  "Publish registration evidence summary"
], "registration workflow must fail fast before expensive setup and publish evidence last");
assert(/package-ecosystem:\s*npm/.test(dependabot), "Dependabot must monitor npm dependencies");
assert(/package-ecosystem:\s*github-actions/.test(dependabot), "Dependabot must monitor GitHub Actions");
assert(/package-ecosystem:\s*docker/.test(dependabot), "Dependabot must monitor Docker base images");
assert((dependabot.match(/version-update:semver-major/g) ?? []).length === 3, "Dependabot must ignore semver-major version update noise before registration");

const submission = readFileSync("docs/submission.md", "utf8");
const operations = readFileSync("docs/operations.md", "utf8");
const readme = readFileSync("README.md", "utf8");
const security = readFileSync("SECURITY.md", "utf8");
assert(/Dependabot monitors npm packages, GitHub Actions, and Docker base images weekly/.test(operations), "operations runbook must describe all Dependabot ecosystems");
assert(/Dependabot ignores semver-major version updates before registration/.test(operations), "operations runbook must document major dependency update policy");
assert(!/submission branch/i.test(readme), "README must not tell operators to register a vague submission branch");
assert(!/npm install/.test(readme), "README must use npm ci for lockfile-reproducible local setup");
assert(/npm ci[\s\S]*npm run build[\s\S]*MCP_ALLOWED_HOSTS=127\.0\.0\.1,localhost npm start/.test(readme), "README local setup must use npm ci before build and start");
assert(!/this repository URL/.test(readme), "README PlayMCP build instructions must not use a vague repository URL placeholder");
assert(/Git URL:\s*`https:\/\/github\.com\/hjongc\/lease-safe-mcp\.git`/.test(readme), "README PlayMCP build instructions must include the exact Git URL");
assert(/Branch\/ref:\s*`main`/.test(readme), "README PlayMCP build instructions must point Branch/ref at main");
assert(/Git URL:\s*`https:\/\/github\.com\/hjongc\/lease-safe-mcp\.git`/.test(submission), "submission pack must include the exact Git URL");
for (const required of [
  "Lease Safe(전월세안전내비)",
  "lease-safe",
  "Streamable HTTP",
  "/mcp",
  "/healthz",
  "minimal liveness metadata",
  "assess_lease_safety",
  "overall risk level",
  "DATA_GO_KR_SERVICE_KEY",
  "MCP_ALLOWED_HOSTS",
  "underscores",
  "MCP_MAX_BODY_BYTES",
  "MCP_RATE_LIMIT_PER_MINUTE",
  "PUBLIC_DATA_TIMEOUT_MS",
  "fails at startup",
  "unsupported `/mcp` methods",
  "non-JSON MCP POST bodies",
  "WWW-Authenticate",
  "X-Content-Type-Options",
  "every supported housing type",
  "Registration Preflight",
  "workflow run URL",
  "npm run preflight:registration",
  "npm run preflight"
]) {
  assert(submission.includes(required), `submission pack missing: ${required}`);
}

for (const required of [
  "unsupported-method rejection",
  "invalid-JSON rejection",
  "unsupported-content-type rejection",
  "compressed-request rejection",
  "unknown-route rejection",
  "encoded-path rejection",
  "WWW-Authenticate",
  "X-Request-Id",
  "Cache-Control",
  "X-Frame-Options",
  "Content-Security-Policy",
  "minimal liveness metadata",
  "underscores",
  "every supported housing type",
  "Registration Preflight",
  "job summary",
  "official source registry access",
  "Docker runtime smoke"
]) {
  assert(operations.includes(required), `operations runbook missing: ${required}`);
}
assert(/sanitized and length-limited/.test(operations), "operations runbook must document sanitized registration summary inputs");
assert(/sanitized, length-limited demo smoke input values/.test(submission), "submission pack must document sanitized registration evidence inputs");

const server = readFileSync("src/server.ts", "utf8");
const domain = readFileSync("src/domain.ts", "utf8");
const healthzRoute = server.match(/app\.get\("\/healthz"[\s\S]*?\n  \}\);/)?.[0] ?? "";
assert(/MCP_ALLOWED_HOSTS/.test(server), "server must support MCP_ALLOWED_HOSTS");
assert(/plain hostnames, not URLs, ports/.test(server), "server must reject unsafe MCP_ALLOWED_HOSTS entries");
assert(/userinfo, query strings, fragments/.test(server), "server must reject URL userinfo/query/fragment host allowlist entries");
assert(/isValidAllowedHost/.test(server), "server must validate MCP_ALLOWED_HOSTS hostname label syntax");
assert(/isValidIpv4Host/.test(server), "server must allow validated IPv4 host allowlist entries");
assert(/isValidDnsHost/.test(server), "server must allow validated DNS host allowlist entries");
assert(/DATA_GO_KR_SERVICE_KEY is required in production/.test(server), "server must fail fast without DATA_GO_KR_SERVICE_KEY in production");
assert(/timingSafeEqual/.test(server), "server must compare bearer tokens with timingSafeEqual");
assert(/MCP_AUTH_TOKEN must be at least/.test(server), "server must reject weak MCP_AUTH_TOKEN values");
assert(/MAX_MCP_AUTH_TOKEN_LENGTH/.test(server), "server must bound MCP_AUTH_TOKEN length");
assert(/suppliedToken\.length > MAX_MCP_AUTH_TOKEN_LENGTH/.test(server), "server must reject oversized supplied bearer tokens before timing-safe comparison");
assert(/MCP_AUTH_TOKEN_PLACEHOLDERS/.test(server), "server must reject placeholder MCP_AUTH_TOKEN values");
assert(/MCP_AUTH_TOKEN must be a real bearer token, not a placeholder/.test(server), "server must fail clearly on placeholder MCP_AUTH_TOKEN values");
assert(/WWW-Authenticate/.test(server), "server must advertise bearer authentication on unauthorized MCP requests");
assert(/Bearer realm="lease-safe"/.test(server), "server must use a stable bearer realm for unauthorized MCP requests");
assert(/requireMcpBearerToken/.test(server), "server must authenticate MCP POST requests before parsing request bodies");
assert(/parsePlainInteger/.test(server), "server must parse runtime numeric settings as plain integers");
assert(/MCP_MAX_BODY_BYTES/.test(server), "server must support a bounded MCP request body size");
assert(/express\.json\(\{ limit: `\$\{maxBodyBytes\}b` \}\)/.test(server), "server JSON parser limit must match MCP_MAX_BODY_BYTES");
assert(/MCP_RATE_LIMIT_PER_MINUTE/.test(server), "server must support MCP request rate limiting");
assert(/requireMcpJsonContentType/.test(server), "server must reject non-JSON MCP POST requests before transport handling");
assert(/MCP POST requests must use application\/json/.test(server), "server must return a clear non-JSON MCP POST error");
assert(/rejectCompressedMcpRequest/.test(server), "server must reject compressed MCP request bodies before JSON parsing");
assert(/MCP POST requests must not use compressed request bodies/.test(server), "server must return a clear compressed MCP request error");
assert(/MCP_TEXT_LIMITS/.test(server), "server must define explicit MCP text input limits");
assert(/regionSchema[\s\S]*\.max\(MCP_TEXT_LIMITS\.region\)/.test(server), "server must bound MCP region text inputs");
assert(/situationSchema[\s\S]*\.max\(MCP_TEXT_LIMITS\.situation\)/.test(server), "server must bound MCP situation text inputs");
assert(/moveInDateSchema[\s\S]*\.max\(MCP_TEXT_LIMITS\.dateText\)/.test(server), "server must bound MCP move-in date text inputs");
assert(/contractDateSchema[\s\S]*\.max\(MCP_TEXT_LIMITS\.dateText\)/.test(server), "server must bound MCP contract date text inputs");
assert(/concernsSchema[\s\S]*\.max\(MCP_TEXT_LIMITS\.concerns\)/.test(server), "server must bound MCP concerns text inputs");
assert(/region:\s*z\.string\(\)\.min\(2\)\.max\(MCP_TEXT_LIMITS\.region\)/.test(server), "resolve_legal_dong_code must bound region text input");
assert(/MONEY_INPUT_LIMITS/.test(domain), "domain must define explicit money input limits");
assert(/assertRequiredPositiveManwon/.test(domain), "flagship assessment must require a positive deposit");
assert(/context = "for lease safety assessment"/.test(domain), "flagship assessment must fail clearly on zero deposit");
assert(/assertRequiredPositiveManwon\("depositManwon",\s*input\.depositManwon,\s*"for deposit-to-sale comparison"\)/.test(domain), "deposit-to-sale comparison must fail clearly on zero deposit");
assert(/sampleReliability/.test(domain), "market outputs must disclose sample reliability");
assert(/전후월, 인접동, 같은 면적대 실거래/.test(domain), "low-sample market outputs must tell users how to strengthen evidence");
assert(/계약금·가계약금 송금을 보류/.test(domain), "flagship assessment must prioritize rushed deposit-payment pressure");
assert(/위임장 원본 범위/.test(domain), "flagship assessment must prioritize proxy-contract verification");
assert(/말소 조건, 잔금 전 등기부 재발급/.test(domain), "flagship assessment must prioritize senior-rights verification");
assert(/근저당\|압류\|가압류\|경매\|채권\|신탁/.test(domain), "red-flag scoring must treat trust registry language as a senior-right signal");
assert(/체납\|미납\|국세\|지방세\|세금\|납세/.test(domain), "red-flag scoring must treat landlord tax-arrears language as a contract risk signal");
assert(/tax_arrears/.test(server), "official help schema must expose tax_arrears routing");
assert(/세금 체납 여부 확정/.test(domain), "official notice must not imply tax-arrears determination");
assert(/납세증명 진위 판단/.test(domain), "official notice must not imply tax-certificate validation");
assert(/inferOfficialHelpIssueType/.test(domain), "official help router must infer routes from natural-language situations");
assert(domain.includes("보증\\s*보험"), "official help router must infer HUG routes from natural-language guarantee questions");
assert(/등기부\|등기/.test(domain), "official help router must infer registry routes from natural-language registry questions");
assert(/publicDataTextFromOptionalTag/.test(domain), "domain must normalize official public-data text fields before rendering");
assert(/decodeXmlTextContent/.test(domain), "domain must decode XML entities in official public-data text fields before rendering");
assert(/compactPublicDataFieldValue/.test(domain), "domain must bound and redact invalid official public-data field excerpts");
assert(/request failed before receiving a response: \$\{redactDataGoKrServiceKeys\(message\)\}/.test(domain), "domain must redact public-data network error messages");
assert(!/request failed before receiving a response:[\s\S]*\{\s*cause:\s*error\s*\}/.test(domain), "domain must not attach raw public-data network error causes");
assert(/동호수 생략/.test(domain), "domain must redact household unit details from user-rendered text");
assert(/household unit details for legal-dong lookup/.test(domain), "legal-dong lookup must reject household unit details before API calls");
assert(/계좌번호 생략/.test(domain), "domain must redact account-number-like payment details from user-rendered text");
assert(/\.replace\(\/!\\\[/.test(domain) && /\.replace\(\/<\\\/\?\[A-Za-z\]/.test(domain), "domain must strip user-provided markdown media and HTML tags before rendering");
assert(/parsePublicDataInteger/.test(domain), "domain must reject non-integer official public-data money fields");
assert(/parsePublicDataDecimal/.test(domain), "domain must reject exponent-style official public-data decimal fields");
assert(/parsedYear = parsePublicDataInteger/.test(domain), "domain must reject non-integer official public-data date fields");
assert(/missing required date field/.test(domain), "domain must fail fast when official public-data date fields are missing");
assert(/assertPublicDataItemsContainer/.test(domain), "domain must fail fast when official market XML omits the items container");
assert(/invalid all-zero rent money fields/.test(domain), "domain must reject all-zero official rent money fields");
assert(/invalid zero sale amount field/.test(domain), "domain must reject zero official sale amount fields");
assert(/depositSchema[\s\S]*\.max\(MONEY_INPUT_LIMITS\.depositManwon\)/.test(server), "server must bound optional MCP deposit inputs");
assert(/assessmentDepositSchema[\s\S]*\.positive\(\)[\s\S]*\.max\(MONEY_INPUT_LIMITS\.depositManwon\)/.test(server), "flagship MCP schema must require a positive deposit");
assert(/saleComparisonDepositSchema[\s\S]*\.positive\(\)[\s\S]*\.max\(MONEY_INPUT_LIMITS\.depositManwon\)/.test(server), "deposit-to-sale MCP schema must require a positive deposit");
assert(/monthlyRentSchema[\s\S]*\.max\(MONEY_INPUT_LIMITS\.monthlyRentManwon\)/.test(server), "server must bound optional MCP monthly-rent inputs");
assert(/depositManwon:\s*(assessmentDepositSchema|saleComparisonDepositSchema)/.test(server), "server must bound required MCP deposit inputs");
assert(/isAllZeroLawdCd/.test(domain), "domain must reject all-zero public-data LAWD_CD values");
assert(/isAllZeroLawdCd\(lawdCd\)/.test(domain), "legal-dong parser must reject all-zero official row LAWD_CD values");
assert(/lawdCdSchema[\s\S]*\.refine\(value => !isAllZeroLawdCd\(value\)/.test(server), "server must reject all-zero MCP LAWD_CD values");
assert(/isFutureDealYmd/.test(domain), "domain must reject future public-data deal months");
assert(/dealYmdSchema[\s\S]*\.refine\(value => !isFutureDealYmd\(value\)/.test(server), "server must reject future MCP deal months");
assert(/PUBLIC_DATA_TIMEOUT_MS/.test(domain), "domain must support a bounded public-data timeout");
assert(/parsePlainInteger/.test(domain), "domain must parse public-data timeout as a plain integer");
assert(/MAX_PUBLIC_DATA_RESPONSE_BYTES/.test(domain), "domain must bound official public-data response sizes");
assert(/publicDataTimeoutMs/.test(server), "server must validate the public-data timeout at startup");
assert(/ok:\s*true[\s\S]*service:\s*"lease-safe"[\s\S]*version:\s*VERSION/.test(healthzRoute), "healthz must expose only minimal liveness metadata");
assert(!/maxBodyBytes/.test(healthzRoute), "healthz must not expose MCP body-size tuning");
assert(!/rateLimitPerMinute/.test(healthzRoute), "healthz must not expose rate-limit tuning");
assert(!/publicDataTimeoutMs/.test(healthzRoute), "healthz must not expose public-data timeout tuning");
assert(/SIGTERM/.test(server), "server must handle SIGTERM for container shutdown");
assert(/x-powered-by/.test(server), "server must disable x-powered-by");
assert(/X-Request-Id/.test(server), "server must set X-Request-Id");
assert(/app\.use\(setRequestId\)[\s\S]*app\.use\(hostHeaderValidation\(allowedHosts\)\)/.test(server), "server must assign request IDs before host validation");
assert(/REQUEST_ID_PATTERN/.test(server), "server must validate incoming request IDs before echoing them");
assert(/compactLogError/.test(server), "server must log compact internal error summaries");
assert(/LOG_SECRET_ENV_NAMES/.test(server), "server log compaction must know runtime secret env names");
assert(/redactLogSecrets/.test(server), "server log compaction must redact configured runtime secrets");
assert(/DATA_GO_KR_SERVICE_KEY/.test(server) && /MCP_AUTH_TOKEN/.test(server), "server log redaction must cover public-data and bearer secrets");
assert(/X-Content-Type-Options/.test(server), "server must set X-Content-Type-Options");
assert(/X-Frame-Options/.test(server), "server must set X-Frame-Options");
assert(/Content-Security-Policy/.test(server), "server must set Content-Security-Policy");
assert(/frame-ancestors 'none'/.test(server), "server CSP must prevent framing");
assert(/Referrer-Policy/.test(server), "server must set Referrer-Policy");
assert(/Cache-Control/.test(server), "server must set Cache-Control");
assert(/name:\s*"lease-safe"/.test(server), "MCP server name must be lease-safe");
assert(!/name:\s*"[^"]*kakao[^"]*"/i.test(server), "MCP server name must not include kakao");
assert(/StreamableHTTPServerTransport/.test(server), "server must use Streamable HTTP");
assert(/sessionIdGenerator:\s*undefined/.test(server), "server must be stateless");
assert(/methodNotAllowedForMcp/.test(server), "server must centralize MCP method rejection responses");
assert(/setHeader\("Allow",\s*"POST"\)/.test(server), "server must advertise Allow: POST for unsupported MCP methods");
assert(/function notFound/.test(server), "server must explicitly handle unknown routes");
assert(/app\.use\(notFound\)/.test(server), "server must install explicit unknown-route handling");
assert(/handleUnexpectedExpressError/.test(server), "server must install explicit JSON error handling for non-MCP routes");
assert(/expressErrorStatus/.test(server), "server must map unexpected Express errors to bounded HTTP statuses");
assert(/Bad request/.test(server), "server must return a bounded bad-request JSON body for unexpected Express 400 errors");
assert(/app\.head\("\/mcp"/.test(server), "server must explicitly reject HEAD /mcp with method-not-allowed headers");
assert(/app\.all\("\/mcp"/.test(server), "server must reject all unsupported MCP methods consistently");
assert(/app\.post\([\s\S]*requireMcpBearerToken\(authToken\)[\s\S]*requireMcpJsonContentType[\s\S]*express\.json/.test(server), "server must authenticate MCP POST requests before content-type validation and JSON parsing");

const registeredTools = [...server.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map(match => match[1]);
assert(registeredTools.length >= 3 && registeredTools.length <= 10, `tool count must be 3-10, got ${registeredTools.length}`);
assert(registeredTools.includes("assess_lease_safety"), "flagship assess_lease_safety tool is required");
for (const tool of registeredTools) {
  assert(/^[A-Za-z0-9_-]{1,128}$/.test(tool), `invalid tool name: ${tool}`);
  assert(!/kakao/i.test(tool), `tool name must not include kakao: ${tool}`);
}

for (const expected of [
  "mois-legal-dong-code",
  "molit-apartment-rent",
  "molit-rowhouse-rent",
  "molit-single-rent",
  "molit-officetel-rent",
  "molit-apartment-sale",
  "molit-rowhouse-sale",
  "molit-single-sale",
  "molit-officetel-sale",
  "gov24",
  "rtms-lease-report",
  "iros-fixed-date",
  "easylaw-lease",
  "law-lease",
  "adr-lease-dispute",
  "hug-deposit-guarantee",
  "nts-tax",
  "wetax-local-tax"
]) {
  assert(SOURCES.some(source => source.id === expected), `source missing: ${expected}`);
}

const sourceIds = new Set<string>();
for (const source of SOURCES) {
  assert(!sourceIds.has(source.id), `duplicate source id: ${source.id}`);
  sourceIds.add(source.id);
  assert(/^https:\/\//.test(source.url), `source must use HTTPS: ${source.id}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(source.reviewedAt), `source reviewedAt must use YYYY-MM-DD: ${source.id}`);
}

function molitSourceId(housingType: string, transactionType: "rent" | "sale"): string {
  return `molit-${housingType === "single_multi" ? "single" : housingType}-${transactionType}`;
}

assert(LEGAL_DONG_API.endpoint.startsWith("https://apis.data.go.kr/1741000/"), "legal-dong endpoint must use the official HTTPS data.go.kr gateway");
assert(LEGAL_DONG_API.portalUrl.includes("data.go.kr"), "legal-dong portal must use data.go.kr");
assert(SOURCES.some(source => source.id === "mois-legal-dong-code" && source.url === LEGAL_DONG_API.portalUrl), "legal-dong source registry URL must match the API portal URL");

for (const spec of Object.values(RENT_API_SPECS)) {
  assert(spec.endpoint.includes("apis.data.go.kr/1613000/"), `rent endpoint must use official data.go.kr gateway: ${spec.housingType}`);
  assert(spec.portalUrl.includes("data.go.kr"), `rent portal must use data.go.kr: ${spec.housingType}`);
  assert(SOURCES.some(source => source.id === molitSourceId(spec.housingType, "rent") && source.url === spec.portalUrl), `rent source registry URL must match the API portal URL: ${spec.housingType}`);
}

for (const spec of Object.values(SALE_API_SPECS)) {
  assert(spec.endpoint.includes("apis.data.go.kr/1613000/"), `sale endpoint must use official data.go.kr gateway: ${spec.housingType}`);
  assert(spec.portalUrl.includes("data.go.kr"), `sale portal must use data.go.kr: ${spec.housingType}`);
  assert(SOURCES.some(source => source.id === molitSourceId(spec.housingType, "sale") && source.url === spec.portalUrl), `sale source registry URL must match the API portal URL: ${spec.housingType}`);
}

const smoke = readFileSync("scripts/smoke.ts", "utf8");
assert(/supportedPlayMcpProtocolVersions/.test(smoke), "smoke must verify protocol version");
assert(/getServerVersion/.test(smoke), "smoke must verify server identity");
assert(/3-10 tools/.test(smoke), "smoke must verify tool count");
assert(/MCP_AUTH_TOKEN/.test(smoke), "smoke must support bearer-token MCP endpoints");
assert(/offlineToolSmokeCases/.test(smoke), "smoke must cover offline MCP tool output quality");
assert(/assertToolOutputQuality/.test(smoke), "smoke must verify MCP tool output quality");
assert(/tool_output_chars/.test(smoke), "smoke must report validated tool output size");
for (const offlineTool of [
  "check_lease_red_flags",
  "build_move_in_protection_plan",
  "prepare_contract_questions",
  "route_official_help",
  "explain_dispute_prevention",
  "explain_data_availability"
]) {
  assert(smoke.includes(`name: "${offlineTool}"`), `smoke must call offline tool ${offlineTool}`);
}
assert(/readResource/.test(smoke), "smoke must read the official source registry resource");
assert(/official_sources/.test(smoke), "smoke must report validated official source count");
assert(/nts-tax/.test(smoke), "smoke must require the national tax source registry entry");
assert(/wetax-local-tax/.test(smoke), "smoke must require the local tax source registry entry");
assert(/국세청/.test(smoke) && /위택스/.test(smoke), "smoke output quality must require tax official sources");

const httpSmoke = readFileSync("scripts/http-smoke.ts", "utf8");
assert(/healthz/.test(httpSmoke), "HTTP smoke must verify healthz");
assert(/assertSecurityHeaders/.test(httpSmoke), "HTTP smoke must verify security headers");
assert(/request_id=ok/.test(httpSmoke), "HTTP smoke must verify request ID propagation");
assert(/safe X-Request-Id/.test(httpSmoke), "HTTP smoke must verify safe request IDs on boundary responses");
assert(/unknown_route=ok/.test(httpSmoke), "HTTP smoke must verify unknown-route rejection");
assert(/default HTML response/.test(httpSmoke), "HTTP smoke must reject default HTML not-found responses");
assert(/encoded_odd_path=ok/.test(httpSmoke), "HTTP smoke must verify encoded-path rejection");
assert(/not-found JSON body/.test(httpSmoke), "HTTP smoke must reject default HTML error responses");
assert(/smokePortFromEnv/.test(httpSmoke), "HTTP smoke must fail fast on invalid port env values");
assert(/listen\(0,\s*"0\.0\.0\.0"/.test(httpSmoke), "HTTP smoke free-port probe must match the server bind address");
assert(/host_rejection/.test(httpSmoke), "HTTP smoke must verify DNS rebinding Host rejection");
assert(/Invalid Host: evil\.example/.test(httpSmoke), "HTTP smoke must verify the host validation error shape");
assert(/auth_rejection/.test(httpSmoke), "HTTP smoke must verify bearer auth rejection");
assert(/oversized_bearer_rejection/.test(httpSmoke), "HTTP smoke must verify oversized bearer token rejection");
assert(/WWW-Authenticate:\s*Bearer/.test(httpSmoke), "HTTP smoke must verify bearer auth challenge headers");
assert(/method_rejection/.test(httpSmoke), "HTTP smoke must verify unsupported MCP method rejection");
assert(/verifyHeadMethodNotAllowed/.test(httpSmoke), "HTTP smoke must verify HEAD /mcp method rejection");
assert(/"OPTIONS"/.test(httpSmoke), "HTTP smoke must verify OPTIONS /mcp method rejection");
assert(/"PUT"/.test(httpSmoke), "HTTP smoke must verify a catch-all unsupported MCP method");
assert(/Allow:\s*POST/.test(httpSmoke), "HTTP smoke must verify unsupported MCP methods advertise Allow: POST");
assert(/invalid_json_rejection/.test(httpSmoke), "HTTP smoke must verify invalid JSON rejection");
assert(/-32700/.test(httpSmoke), "HTTP smoke must verify invalid JSON returns the JSON-RPC parse error code");
assert(/auth_before_parse/.test(httpSmoke), "HTTP smoke must verify unauthorized malformed JSON fails authentication before parsing");
assert(/content_type_rejection/.test(httpSmoke), "HTTP smoke must verify unsupported content-type rejection");
assert(/415/.test(httpSmoke), "HTTP smoke must verify unsupported content-type returns 415");
assert(/compressed_request_rejection=ok/.test(httpSmoke), "HTTP smoke must verify compressed request rejection");
assert(/content-encoding/.test(httpSmoke), "HTTP smoke must send Content-Encoding for compressed request rejection");
assert(/publicDataTimeoutMs\?: unknown/.test(httpSmoke), "HTTP smoke must verify healthz omits internal tuning metadata");
assert(/mcpMaxBodyBytesFromEnv/.test(httpSmoke), "HTTP smoke must verify oversized requests without reading limits from healthz");
assert(/oversized_request/.test(httpSmoke), "HTTP smoke must verify oversized MCP request rejection");
assert(/dist\/scripts\/smoke\.js/.test(httpSmoke), "HTTP smoke must run the MCP client smoke");

const dockerSmoke = readFileSync("scripts/docker-smoke.ts", "utf8");
assert(/docker/.test(dockerSmoke), "Docker smoke must run a container");
assert(/healthz/.test(dockerSmoke), "Docker smoke must verify healthz");
assert(/assertSecurityHeaders/.test(dockerSmoke), "Docker smoke must verify security headers");
assert(/docker_request_id=ok/.test(dockerSmoke), "Docker smoke must verify request ID propagation");
assert(/safe X-Request-Id/.test(dockerSmoke), "Docker smoke must verify safe request IDs on boundary responses");
assert(/docker_unknown_route=ok/.test(dockerSmoke), "Docker smoke must verify unknown-route rejection");
assert(/default HTML response/.test(dockerSmoke), "Docker smoke must reject default HTML not-found responses");
assert(/docker_encoded_odd_path=ok/.test(dockerSmoke), "Docker smoke must verify encoded-path rejection");
assert(/not-found JSON body/.test(dockerSmoke), "Docker smoke must reject default HTML error responses");
assert(/smokePortFromEnv/.test(dockerSmoke), "Docker smoke must fail fast on invalid port env values");
assert(/docker_host_rejection/.test(dockerSmoke), "Docker smoke must verify DNS rebinding Host rejection");
assert(/Invalid Host: evil\.example/.test(dockerSmoke), "Docker smoke must verify the host validation error shape");
assert(/docker_auth_rejection/.test(dockerSmoke), "Docker smoke must verify bearer auth rejection");
assert(/docker_oversized_bearer_rejection/.test(dockerSmoke), "Docker smoke must verify oversized bearer token rejection");
assert(/WWW-Authenticate:\s*Bearer/.test(dockerSmoke), "Docker smoke must verify bearer auth challenge headers");
assert(/docker_method_rejection/.test(dockerSmoke), "Docker smoke must verify unsupported MCP method rejection");
assert(/verifyHeadMethodNotAllowed/.test(dockerSmoke), "Docker smoke must verify HEAD /mcp method rejection");
assert(/"OPTIONS"/.test(dockerSmoke), "Docker smoke must verify OPTIONS /mcp method rejection");
assert(/"PUT"/.test(dockerSmoke), "Docker smoke must verify a catch-all unsupported MCP method");
assert(/Allow:\s*POST/.test(dockerSmoke), "Docker smoke must verify unsupported MCP methods advertise Allow: POST");
assert(/docker_invalid_json_rejection/.test(dockerSmoke), "Docker smoke must verify invalid JSON rejection");
assert(/-32700/.test(dockerSmoke), "Docker smoke must verify invalid JSON returns the JSON-RPC parse error code");
assert(/docker_auth_before_parse/.test(dockerSmoke), "Docker smoke must verify unauthorized malformed JSON fails authentication before parsing");
assert(/docker_content_type_rejection/.test(dockerSmoke), "Docker smoke must verify unsupported content-type rejection");
assert(/415/.test(dockerSmoke), "Docker smoke must verify unsupported content-type returns 415");
assert(/docker_compressed_request_rejection=ok/.test(dockerSmoke), "Docker smoke must verify compressed request rejection");
assert(/content-encoding/.test(dockerSmoke), "Docker smoke must send Content-Encoding for compressed request rejection");
assert(/publicDataTimeoutMs\?: unknown/.test(dockerSmoke), "Docker smoke must verify healthz omits internal tuning metadata");
assert(/docker_oversized_request/.test(dockerSmoke), "Docker smoke must verify oversized MCP request rejection");
assert(/dist\/scripts\/smoke\.js/.test(dockerSmoke), "Docker smoke must run the MCP client smoke");

const rateLimitSmoke = readFileSync("scripts/rate-limit-smoke.ts", "utf8");
assert(/MCP_RATE_LIMIT_PER_MINUTE/.test(rateLimitSmoke), "rate-limit smoke must force a low rate limit");
assert(/smokePortFromEnv/.test(rateLimitSmoke), "rate-limit smoke must fail fast on invalid port env values");
assert(/listen\(0,\s*"0\.0\.0\.0"/.test(rateLimitSmoke), "rate-limit smoke free-port probe must match the server bind address");
assert(/Retry-After/.test(rateLimitSmoke), "rate-limit smoke must verify Retry-After");
assert(/429/.test(rateLimitSmoke), "rate-limit smoke must verify 429 rejection");

const secretScan = readFileSync("scripts/secret-scan.ts", "utf8");
for (const required of ["DATA_GO_KR_SERVICE_KEY", "MCP_AUTH_TOKEN", "decoded data.go.kr", "Secret scan failed"]) {
  assert(secretScan.includes(required), `secret scan missing ${required}`);
}

const publicDataSmoke = readFileSync("scripts/public-data-smoke.ts", "utf8");
for (const housingType of ["apartment", "rowhouse", "single_multi", "officetel"]) {
  assert(publicDataSmoke.includes(`"${housingType}"`), `public-data smoke must cover ${housingType}`);
}
assert(/assessLeaseSafety/.test(publicDataSmoke), "public-data smoke must verify the flagship assessment tool");
assert(/MONEY_INPUT_LIMITS\.depositManwon/.test(publicDataSmoke), "public-data smoke must reuse the bounded deposit input limit");
assert(/plain positive integer/.test(publicDataSmoke), "public-data smoke must require a plain integer deposit value");
assert(/control characters, line breaks, tabs, or Markdown backticks/.test(publicDataSmoke), "public-data smoke must reject summary-breaking region characters");
assert(/payment account details/.test(publicDataSmoke), "public-data smoke must reject account-number-like region inputs");
assert(/household unit details/.test(publicDataSmoke), "public-data smoke must reject household-unit region inputs");
assert(/isAllZeroLawdCd/.test(publicDataSmoke), "public-data smoke must reject all-zero LAWD_CD values before API calls");
assert(/isFutureDealYmd/.test(publicDataSmoke), "public-data smoke must reject future deal months before API calls");
assert(/REQUIRE_LIVE_PUBLIC_DATA/.test(publicDataSmoke), "public-data smoke must know when registration preflight requires live evidence");
assert(/must include all supported housing types in registration preflight/.test(publicDataSmoke), "registration preflight must reject narrowed public-data housing smoke");
assert(/publicDataSmokeConfigLine/.test(publicDataSmoke), "public-data smoke must log non-secret demo configuration");
assert(/public_data_smoke_config/.test(publicDataSmoke), "public-data smoke config log must be easy to grep in CI logs");
assert(/registration_mode/.test(publicDataSmoke), "public-data smoke config log must distinguish registration coverage from narrowed debugging runs");

const releasePreflight = readFileSync("scripts/release-preflight.ts", "utf8");
const registrationPreflight = readFileSync("scripts/registration-preflight.ts", "utf8");
const dockerImageReference = readFileSync("scripts/docker-image-reference.ts", "utf8");
assert(/DOCKER_IMAGE_REFERENCE_PATTERN/.test(dockerImageReference), "preflight scripts must define a Docker image reference allowlist");
assert(/plain Docker image reference/.test(dockerImageReference), "preflight scripts must fail clearly on unsafe Docker image references");
assert(/dockerImageReferenceFromEnv/.test(releasePreflight), "release preflight must validate PREFLIGHT_DOCKER_TAG before Docker build");
assert(/dockerImageReferenceFromEnv/.test(dockerSmoke), "Docker smoke must validate DOCKER_SMOKE_IMAGE before Docker run");
assert(/command:\s*"npm"[\s\S]*args:\s*\["run",\s*"scan:secrets"\]/.test(releasePreflight), "release preflight must include npm run scan:secrets");
assert(/command:\s*"npm"[\s\S]*args:\s*\["test"\]/.test(releasePreflight), "release preflight must include npm test");
assert(/command:\s*"npm"[\s\S]*args:\s*\["run",\s*"validate:playmcp"\]/.test(releasePreflight), "release preflight must include npm run validate:playmcp");
assert(/command:\s*"npm"[\s\S]*args:\s*\["run",\s*"smoke:http"\]/.test(releasePreflight), "release preflight must include npm run smoke:http");
assert(/command:\s*"npm"[\s\S]*args:\s*\["run",\s*"smoke:rate-limit"\]/.test(releasePreflight), "release preflight must include npm run smoke:rate-limit");
assert(/command:\s*"npm"[\s\S]*args:\s*\["audit",\s*"--omit=dev"\]/.test(releasePreflight), "release preflight must include npm audit --omit=dev");
assert(/command:\s*"docker"[\s\S]*args:\s*\["build"/.test(releasePreflight), "release preflight must include docker build");
assert(/attempts:\s*3/.test(releasePreflight), "release preflight must retry transient Docker build failures");
assert(releasePreflight.includes("attempt ${attempt}/${attempts}"), "release preflight must make Docker build retry attempts visible");
assert(/command:\s*"node"[\s\S]*args:\s*\["dist\/scripts\/docker-smoke\.js"\]/.test(releasePreflight), "release preflight must include Docker runtime smoke");
assert(/command:\s*"npm"[\s\S]*args:\s*\["run",\s*"smoke:public-data"\]/.test(releasePreflight), "release preflight must include npm run smoke:public-data");
assert(/DATA_GO_KR_SERVICE_KEY/.test(releasePreflight), "release preflight must gate live public-data smoke on DATA_GO_KR_SERVICE_KEY");
assert(/REQUIRE_LIVE_PUBLIC_DATA/.test(releasePreflight), "release preflight must support requiring live public-data smoke");
assert(/REQUIRE_LIVE_PUBLIC_DATA/.test(registrationPreflight), "registration preflight must require live public-data smoke");

for (const required of [
  "Secret Setup",
  "Pre-Registration Evidence",
  "npm run preflight:registration",
  "Live public-data smoke",
  "Incident Response",
  "Key Rotation",
  "Do not store secrets"
]) {
  assert(operations.includes(required), `operations runbook missing: ${required}`);
}

for (const required of [
  "Reporting A Vulnerability",
  "Secret Handling",
  "Security Gates",
  "Dependency Updates",
  "npm run preflight:registration"
]) {
  assert(security.includes(required), `security policy missing: ${required}`);
}

console.log("Lease Safe PlayMCP validation passed");
