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

for (const file of ["Dockerfile", "README.md", "docs/data-design.md", "package-lock.json", "src/server.ts", "src/domain.ts", "src/sources.ts"]) {
  readFileSync(file, "utf8");
}

assert(!/kakao/i.test(packageJson.name), "package name must not include kakao");
assert(packageJson.dependencies?.["@modelcontextprotocol/sdk"] === "1.29.0", "MCP SDK version must be pinned");
assert(packageJson.scripts?.build, "build script is required");
assert(packageJson.scripts?.test, "test script is required");
assert(packageJson.scripts?.smoke, "smoke script is required");

const dockerfile = readFileSync("Dockerfile", "utf8");
assert(/COPY package\*\.json \.\//.test(dockerfile), "Dockerfile must copy package-lock.json for reproducible builds");
assert(/RUN npm ci/.test(dockerfile), "Dockerfile must use npm ci");
assert(/EXPOSE 3000/.test(dockerfile), "Dockerfile must expose port 3000");
assert(/CMD \["node", "dist\/src\/server\.js"\]/.test(dockerfile), "Dockerfile CMD must start built server");

const server = readFileSync("src/server.ts", "utf8");
assert(/MCP_ALLOWED_HOSTS/.test(server), "server must support MCP_ALLOWED_HOSTS");
assert(/name:\s*"lease-safe"/.test(server), "MCP server name must be lease-safe");
assert(!/name:\s*"[^"]*kakao[^"]*"/i.test(server), "MCP server name must not include kakao");
assert(/StreamableHTTPServerTransport/.test(server), "server must use Streamable HTTP");
assert(/sessionIdGenerator:\s*undefined/.test(server), "server must be stateless");

const registeredTools = [...server.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map(match => match[1]);
assert(registeredTools.length >= 3 && registeredTools.length <= 10, `tool count must be 3-10, got ${registeredTools.length}`);
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

console.log("Lease Safe PlayMCP validation passed");
