import { readFileSync } from "node:fs";
import { RENT_API_SPECS, SALE_API_SPECS, SOURCES } from "../src/sources.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  name: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};

for (const file of ["Dockerfile", ".github/workflows/ci.yml", "README.md", "docs/data-design.md", "docs/submission.md", "package-lock.json", "src/server.ts", "src/domain.ts", "src/sources.ts"]) {
  readFileSync(file, "utf8");
}

assert(!/kakao/i.test(packageJson.name), "package name must not include kakao");
assert(packageJson.dependencies?.["@modelcontextprotocol/sdk"] === "1.29.0", "MCP SDK version must be pinned");
assert(packageJson.scripts?.build, "build script is required");
assert(packageJson.scripts?.test, "test script is required");
assert(packageJson.scripts?.smoke, "smoke script is required");
assert(packageJson.scripts?.["smoke:http"], "HTTP smoke script is required");
assert(packageJson.scripts?.preflight, "preflight script is required");

const dockerfile = readFileSync("Dockerfile", "utf8");
assert(/COPY package\*\.json \.\//.test(dockerfile), "Dockerfile must copy package-lock.json for reproducible builds");
assert(/RUN npm ci/.test(dockerfile), "Dockerfile must use npm ci");
assert(/EXPOSE 3000/.test(dockerfile), "Dockerfile must expose port 3000");
assert(/CMD \["node", "dist\/src\/server\.js"\]/.test(dockerfile), "Dockerfile CMD must start built server");

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
assert(/actions\/checkout@v5/.test(ci), "CI must use actions/checkout@v5");
assert(/actions\/setup-node@v5/.test(ci), "CI must use actions/setup-node@v5");
for (const command of ["npm ci", "npm test", "npm run validate:playmcp", "npm run smoke:http", "npm audit --omit=dev", "docker build"]) {
  assert(ci.includes(command), `CI must run ${command}`);
}
assert(/DATA_GO_KR_SERVICE_KEY/.test(ci), "CI must support optional live public-data smoke through DATA_GO_KR_SERVICE_KEY");

const submission = readFileSync("docs/submission.md", "utf8");
for (const required of [
  "Lease Safe(전월세안전내비)",
  "lease-safe",
  "Streamable HTTP",
  "/mcp",
  "/healthz",
  "assess_lease_safety",
  "overall risk level",
  "DATA_GO_KR_SERVICE_KEY",
  "MCP_ALLOWED_HOSTS",
  "fails at startup",
  "npm run preflight"
]) {
  assert(submission.includes(required), `submission pack missing: ${required}`);
}

const server = readFileSync("src/server.ts", "utf8");
assert(/MCP_ALLOWED_HOSTS/.test(server), "server must support MCP_ALLOWED_HOSTS");
assert(/DATA_GO_KR_SERVICE_KEY is required in production/.test(server), "server must fail fast without DATA_GO_KR_SERVICE_KEY in production");
assert(/name:\s*"lease-safe"/.test(server), "MCP server name must be lease-safe");
assert(!/name:\s*"[^"]*kakao[^"]*"/i.test(server), "MCP server name must not include kakao");
assert(/StreamableHTTPServerTransport/.test(server), "server must use Streamable HTTP");
assert(/sessionIdGenerator:\s*undefined/.test(server), "server must be stateless");

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
  "hug-deposit-guarantee"
]) {
  assert(SOURCES.some(source => source.id === expected), `source missing: ${expected}`);
}

for (const spec of Object.values(RENT_API_SPECS)) {
  assert(spec.endpoint.includes("apis.data.go.kr/1613000/"), `rent endpoint must use official data.go.kr gateway: ${spec.housingType}`);
  assert(spec.portalUrl.includes("data.go.kr"), `rent portal must use data.go.kr: ${spec.housingType}`);
}

for (const spec of Object.values(SALE_API_SPECS)) {
  assert(spec.endpoint.includes("apis.data.go.kr/1613000/"), `sale endpoint must use official data.go.kr gateway: ${spec.housingType}`);
  assert(spec.portalUrl.includes("data.go.kr"), `sale portal must use data.go.kr: ${spec.housingType}`);
}

const smoke = readFileSync("scripts/smoke.ts", "utf8");
assert(/supportedPlayMcpProtocolVersions/.test(smoke), "smoke must verify protocol version");
assert(/getServerVersion/.test(smoke), "smoke must verify server identity");
assert(/3-10 tools/.test(smoke), "smoke must verify tool count");

const httpSmoke = readFileSync("scripts/http-smoke.ts", "utf8");
assert(/healthz/.test(httpSmoke), "HTTP smoke must verify healthz");
assert(/dist\/scripts\/smoke\.js/.test(httpSmoke), "HTTP smoke must run the MCP client smoke");

const publicDataSmoke = readFileSync("scripts/public-data-smoke.ts", "utf8");
for (const housingType of ["apartment", "rowhouse", "single_multi", "officetel"]) {
  assert(publicDataSmoke.includes(`"${housingType}"`), `public-data smoke must cover ${housingType}`);
}
assert(/assessLeaseSafety/.test(publicDataSmoke), "public-data smoke must verify the flagship assessment tool");

const releasePreflight = readFileSync("scripts/release-preflight.ts", "utf8");
assert(/command:\s*"npm"[\s\S]*args:\s*\["test"\]/.test(releasePreflight), "release preflight must include npm test");
assert(/command:\s*"npm"[\s\S]*args:\s*\["run",\s*"validate:playmcp"\]/.test(releasePreflight), "release preflight must include npm run validate:playmcp");
assert(/command:\s*"npm"[\s\S]*args:\s*\["run",\s*"smoke:http"\]/.test(releasePreflight), "release preflight must include npm run smoke:http");
assert(/command:\s*"npm"[\s\S]*args:\s*\["audit",\s*"--omit=dev"\]/.test(releasePreflight), "release preflight must include npm audit --omit=dev");
assert(/command:\s*"docker"[\s\S]*args:\s*\["build"/.test(releasePreflight), "release preflight must include docker build");
assert(/command:\s*"npm"[\s\S]*args:\s*\["run",\s*"smoke:public-data"\]/.test(releasePreflight), "release preflight must include npm run smoke:public-data");
assert(/DATA_GO_KR_SERVICE_KEY/.test(releasePreflight), "release preflight must gate live public-data smoke on DATA_GO_KR_SERVICE_KEY");

console.log("Lease Safe PlayMCP validation passed");
