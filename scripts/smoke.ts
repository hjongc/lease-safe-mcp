import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_ENDPOINT;
const supportedPlayMcpProtocolVersions = new Set(["2025-03-26", "2025-06-18", "2025-11-25"]);

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

async function main() {
  if (!endpoint) {
    throw new Error("MCP_ENDPOINT is required. Example: MCP_ENDPOINT=http://127.0.0.1:3000/mcp npm run smoke");
  }

  const client = new Client({
    name: "lease-safe-smoke-client",
    version: "0.1.0"
  });

  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
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
  console.log(JSON.stringify(result, null, 2));

  const resources = await client.listResources();
  if (!resources.resources.some(resource => resource.uri === "lease-safe://sources/official")) {
    throw new Error("official source registry resource is missing");
  }

  await client.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
