import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_ENDPOINT;
const supportedPlayMcpProtocolVersions = new Set(["2025-03-26", "2025-06-18", "2025-11-25"]);
const officialSourceRegistryUri = "lease-safe://sources/official";
const requiredOfficialSourceIds = [
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
] as const;

function hasKorean(text: unknown): boolean {
  return typeof text === "string" && /[가-힣]/.test(text);
}

function assertInputSchemaDescriptions(toolName: string, schema: unknown) {
  const properties = (schema as { properties?: Record<string, { description?: unknown }> })?.properties ?? {};
  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    if (!hasKorean(propertySchema.description)) {
      throw new Error(`Tool ${toolName} input ${propertyName} must have a Korean description`);
    }
  }
}

function textFromToolResult(toolName: string, result: unknown): string {
  const content = (result as { content?: Array<{ type?: unknown; text?: unknown }> })?.content ?? [];
  const textBlocks = content.filter(item => item.type === "text" && typeof item.text === "string");
  if (textBlocks.length === 0) {
    throw new Error(`Tool ${toolName} must return at least one text content block`);
  }
  return textBlocks.map(item => item.text as string).join("\n");
}

function assertToolOutputQuality(toolName: string, text: string) {
  if (!hasKorean(text)) throw new Error(`Tool ${toolName} output must contain Korean text`);
  if (text.length < 500) throw new Error(`Tool ${toolName} output is unexpectedly short`);
  if (text.length > 12000) throw new Error(`Tool ${toolName} output is unexpectedly long`);
  for (const required of ["## 계약 위험 신호 점검", "## 공식 출처", "## 확인 필요", "전월세안전내비"]) {
    if (!text.includes(required)) throw new Error(`Tool ${toolName} output missing required phrase: ${required}`);
  }
  for (const requiredSource of ["인터넷등기소", "법제처", "국가법령정보센터", "HUG"]) {
    if (!text.includes(requiredSource)) throw new Error(`Tool ${toolName} output missing official source: ${requiredSource}`);
  }
  if (/kakao/i.test(text)) throw new Error(`Tool ${toolName} output contains forbidden kakao string`);
}

function textFromResourceResult(result: unknown): string {
  const contents = (result as { contents?: Array<{ mimeType?: unknown; text?: unknown }> })?.contents ?? [];
  const content = contents.find(item => typeof item.text === "string");
  if (!content || typeof content.text !== "string") {
    throw new Error("official source registry resource must return text content");
  }
  if (content.mimeType !== "application/json") {
    throw new Error(`official source registry resource must use application/json, got ${String(content.mimeType)}`);
  }
  return content.text;
}

function assertOfficialSourceRegistry(text: string): number {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("official source registry must be a JSON array");
  }
  const sources = parsed as Array<Record<string, unknown>>;
  const ids = new Set<string>();

  for (const source of sources) {
    const id = source.id;
    const sourceName = source.sourceName;
    const url = source.url;
    const reviewedAt = source.reviewedAt;
    const confidence = source.confidence;
    const useFor = source.useFor;

    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) throw new Error(`invalid source id: ${String(id)}`);
    if (ids.has(id)) throw new Error(`duplicate source id: ${id}`);
    ids.add(id);
    if (!hasKorean(sourceName)) throw new Error(`source ${id} must have a Korean sourceName`);
    if (typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error(`source ${id} must use an https URL`);
    if (typeof reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)) throw new Error(`source ${id} must have YYYY-MM-DD reviewedAt`);
    if (confidence !== "official_national" && confidence !== "public_agency") throw new Error(`source ${id} has invalid confidence`);
    if (!hasKorean(useFor)) throw new Error(`source ${id} must describe useFor in Korean`);
    if (Object.values(source).some(value => typeof value === "string" && /kakao/i.test(value))) {
      throw new Error(`source ${id} contains forbidden kakao string`);
    }
  }

  for (const requiredId of requiredOfficialSourceIds) {
    if (!ids.has(requiredId)) throw new Error(`official source registry missing ${requiredId}`);
  }

  return sources.length;
}

async function main() {
  if (!endpoint) {
    throw new Error("MCP_ENDPOINT is required. Example: MCP_ENDPOINT=http://127.0.0.1:3000/mcp npm run smoke");
  }

  const client = new Client({
    name: "lease-safe-smoke-client",
    version: "0.1.0"
  });

  const authToken = process.env.MCP_AUTH_TOKEN?.trim();
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), authToken
    ? {
        requestInit: {
          headers: {
            authorization: `Bearer ${authToken}`
          }
        }
      }
    : undefined);
  await client.connect(transport);

  const protocolVersion = transport.protocolVersion;
  console.log(`protocol=${protocolVersion}`);
  if (!protocolVersion || !supportedPlayMcpProtocolVersions.has(protocolVersion)) {
    throw new Error(`Negotiated protocol version is outside the PlayMCP-supported range: ${protocolVersion ?? "unknown"}`);
  }

  const serverVersion = client.getServerVersion();
  if (!serverVersion?.name || /kakao/i.test(serverVersion.name)) {
    throw new Error(`Server name is missing or contains forbidden kakao string: ${serverVersion?.name ?? "unknown"}`);
  }

  const tools = await client.listTools();
  const names = tools.tools.map(tool => tool.name).sort();
  console.log(`tools=${names.join(",")}`);

  if (names.length < 3 || names.length > 10) throw new Error(`Expected 3-10 tools, got ${names.length}`);
  if (names.some(name => /kakao/i.test(name))) throw new Error("Tool name contains forbidden kakao string");
  if (names.some(name => !/^[A-Za-z0-9_-]{1,128}$/.test(name))) throw new Error("Tool name contains characters outside the PlayMCP allowed set");

  for (const tool of tools.tools) {
    if (!hasKorean(tool.title)) throw new Error(`Tool ${tool.name} title must be Korean`);
    if (!tool.description || tool.description.length > 1024) throw new Error(`Tool ${tool.name} has missing or too long description`);
    if (!/[가-힣]/.test(tool.description) || !tool.description.includes("전월세안전내비")) {
      throw new Error(`Tool ${tool.name} description must be natural Korean and include 전월세안전내비`);
    }
    const annotations = tool.annotations;
    if (
      !annotations ||
      typeof annotations.title !== "string" ||
      typeof annotations.readOnlyHint !== "boolean" ||
      typeof annotations.destructiveHint !== "boolean" ||
      typeof annotations.openWorldHint !== "boolean" ||
      typeof annotations.idempotentHint !== "boolean"
    ) {
      throw new Error(`Tool ${tool.name} is missing required PlayMCP annotations`);
    }
    assertInputSchemaDescriptions(tool.name, tool.inputSchema);
  }

  const startedAt = performance.now();
  const result = await client.callTool({
    name: "check_lease_red_flags",
    arguments: {
      situation: "서울 관악구 전세 계약인데 대리인이 오늘 가계약금을 보내라고 하고 근저당도 있다고 합니다.",
      region: "서울 관악구",
      contractType: "jeonse",
      depositManwon: 30000,
      concerns: "대리계약, 근저당, 가계약금"
    }
  });
  const latencyMs = performance.now() - startedAt;
  console.log(`latency_ms=${latencyMs.toFixed(1)}`);
  if (latencyMs > 3000) throw new Error(`Smoke latency exceeded 3000ms: ${latencyMs.toFixed(1)}ms`);
  const resultText = textFromToolResult("check_lease_red_flags", result);
  assertToolOutputQuality("check_lease_red_flags", resultText);
  console.log(`tool_output_chars=${resultText.length}`);
  console.log(JSON.stringify(result, null, 2));

  const resources = await client.listResources();
  if (!resources.resources.some(resource => resource.uri === officialSourceRegistryUri)) {
    throw new Error("official source registry resource is missing");
  }
  const sourceRegistry = await client.readResource({ uri: officialSourceRegistryUri });
  const sourceCount = assertOfficialSourceRegistry(textFromResourceResult(sourceRegistry));
  console.log(`official_sources=${sourceCount}`);

  await client.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
