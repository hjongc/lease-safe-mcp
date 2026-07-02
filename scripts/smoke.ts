import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { compactScriptErrorMessage } from "./safe-error.js";

const endpoint = process.env.MCP_ENDPOINT;
const supportedPlayMcpProtocolVersions = new Set(["2025-03-26", "2025-06-18", "2025-11-25"]);
const officialSourceRegistryUri = "lease-safe://sources/official";
const maxSourceReviewAgeDays = 45;
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
  "hug-deposit-guarantee",
  "nts-tax",
  "wetax-local-tax"
] as const;
const apiBackedToolNames = new Set(["assess_lease_safety", "resolve_legal_dong_code", "compare_rent_market", "compare_deposit_to_sale_market"]);

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

interface OfflineToolSmokeCase {
  name: string;
  arguments: Record<string, unknown>;
  requiredPhrases: string[];
  requiredSources: string[];
}

const offlineToolSmokeCases: OfflineToolSmokeCase[] = [
  {
    name: "check_lease_red_flags",
    arguments: {
      situation: "서울 관악구 전세 계약인데 대리인이 오늘 가계약금을 보내라고 하고 근저당도 있다고 합니다.",
      region: "서울 관악구",
      contractType: "jeonse",
      depositManwon: 30000,
      concerns: "대리계약, 근저당, 가계약금"
    },
    requiredPhrases: ["## 계약 위험 신호 점검", "## 계약 전 확인 순서", "## 문서 증거 패키지", "## 공식 출처", "## 확인 필요", "전월세안전내비"],
    requiredSources: ["인터넷등기소", "법제처", "국가법령정보센터", "HUG", "국세청", "위택스"]
  },
  {
    name: "build_move_in_protection_plan",
    arguments: {
      region: "서울 관악구",
      contractType: "jeonse",
      depositManwon: 30000,
      moveInDate: "2026-08-15",
      contractDate: "2026-07-10",
      concerns: "전입신고와 확정일자를 놓치고 싶지 않습니다."
    },
    requiredPhrases: ["## 이사·보증금 보호 체크리스트", "## 계약 전", "## 잔금·입주 당일", "## 입주 후", "## 문서 증거 패키지", "## 확인 필요"],
    requiredSources: ["정부24", "부동산거래관리시스템", "인터넷등기소", "HUG", "국세청", "위택스"]
  },
  {
    name: "prepare_contract_questions",
    arguments: {
      region: "서울 관악구",
      contractType: "jeonse",
      depositManwon: 30000,
      concerns: "근저당과 임대인 체납이 걱정됩니다."
    },
    requiredPhrases: ["## 중개사·임대인에게 물어볼 질문", "## 통화 첫 문장", "## 문서 증거 패키지", "## 공식 출처", "## 확인 필요"],
    requiredSources: ["부동산거래관리시스템", "인터넷등기소", "HUG", "국세청", "위택스"]
  },
  {
    name: "route_official_help",
    arguments: {
      situation: "임대인 국세와 지방세 체납이 걱정됩니다.",
      issueType: "tax_arrears",
      region: "서울 관악구"
    },
    requiredPhrases: ["## 공식 문의 경로", "먼저 볼 곳:", "## 상황별 빠른 분기", "## 공식 출처", "## 확인 필요"],
    requiredSources: ["정부24", "부동산거래관리시스템", "인터넷등기소", "HUG", "국세청", "위택스"]
  },
  {
    name: "explain_dispute_prevention",
    arguments: {
      disputeType: "deposit_return",
      region: "서울 관악구",
      concerns: "만기 후 보증금 반환이 지연될까 봐 걱정됩니다."
    },
    requiredPhrases: ["## 분쟁 예방 메모", "## 증거로 남길 것", "## 공식 출처", "## 확인 필요"],
    requiredSources: ["임대차분쟁조정위원회", "법제처", "국가법령정보센터"]
  },
  {
    name: "explain_data_availability",
    arguments: {},
    requiredPhrases: ["## 실제 데이터 조달 가능성", "자동 연동 가능", "수동 검토 레지스트리 권장", "## 공식 출처"],
    requiredSources: ["행정안전부", "국토교통부", "정부24", "부동산거래관리시스템", "인터넷등기소", "HUG", "국세청", "위택스"]
  }
];

const missingPublicDataKeySmokeCases: OfflineToolSmokeCase[] = [
  {
    name: "assess_lease_safety",
    arguments: {
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 30000,
      region: "서울 관악구"
    },
    requiredPhrases: [],
    requiredSources: []
  },
  {
    name: "resolve_legal_dong_code",
    arguments: {
      region: "서울 관악구"
    },
    requiredPhrases: [],
    requiredSources: []
  },
  {
    name: "compare_rent_market",
    arguments: {
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605"
    },
    requiredPhrases: [],
    requiredSources: []
  },
  {
    name: "compare_deposit_to_sale_market",
    arguments: {
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 30000
    },
    requiredPhrases: [],
    requiredSources: []
  }
];

function assertToolOutputQuality(toolName: string, text: string, requiredPhrases: string[], requiredSources: string[]) {
  if (!hasKorean(text)) throw new Error(`Tool ${toolName} output must contain Korean text`);
  if (text.length < 350) throw new Error(`Tool ${toolName} output is unexpectedly short`);
  if (text.length > 12000) throw new Error(`Tool ${toolName} output is unexpectedly long`);
  for (const required of requiredPhrases) {
    if (!text.includes(required)) throw new Error(`Tool ${toolName} output missing required phrase: ${required}`);
  }
  for (const requiredSource of requiredSources) {
    if (!text.includes(requiredSource)) throw new Error(`Tool ${toolName} output missing official source: ${requiredSource}`);
  }
  if (/kakao/i.test(text)) throw new Error(`Tool ${toolName} output contains forbidden kakao string`);
}

function compactErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function assertMissingPublicDataKeyFailure(toolName: string, text: string): void {
  if (!/DATA_GO_KR_SERVICE_KEY is required/.test(text)) {
    throw new Error(`API-backed tool ${toolName} must fail clearly when DATA_GO_KR_SERVICE_KEY is missing. Got: ${text.slice(0, 300)}`);
  }
}

async function assertApiBackedToolsFailWithoutPublicDataKey(client: Client): Promise<void> {
  for (const smokeCase of missingPublicDataKeySmokeCases) {
    try {
      const result = await client.callTool({
        name: smokeCase.name,
        arguments: smokeCase.arguments
      });
      const resultText = textFromToolResult(smokeCase.name, result);
      if ((result as { isError?: unknown }).isError === true) {
        assertMissingPublicDataKeyFailure(smokeCase.name, resultText);
        console.log(`api_missing_key_failure[${smokeCase.name}]=ok`);
        continue;
      }
      throw new Error(`API-backed tool ${smokeCase.name} unexpectedly succeeded without DATA_GO_KR_SERVICE_KEY.`);
    } catch (error) {
      const message = compactErrorText(error);
      assertMissingPublicDataKeyFailure(smokeCase.name, message);
      console.log(`api_missing_key_failure[${smokeCase.name}]=ok`);
    }
  }
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

function sourceReviewAgeDays(reviewedAt: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reviewedAt);
  if (!match) throw new Error(`source reviewedAt must use YYYY-MM-DD: ${reviewedAt}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const reviewedAtMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(reviewedAtMs);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`source reviewedAt must be a real calendar date: ${reviewedAt}`);
  }
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((todayMs - reviewedAtMs) / 86_400_000);
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
    const ageDays = sourceReviewAgeDays(reviewedAt);
    if (ageDays < 0) throw new Error(`source ${id} reviewedAt must not be in the future`);
    if (ageDays > maxSourceReviewAgeDays) throw new Error(`source ${id} reviewedAt is stale for registration: ageDays=${ageDays}`);
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
    if (/DATA_GO_KR_SERVICE_KEY|MCP_AUTH_TOKEN|MCP_ALLOWED_HOSTS|PUBLIC_DATA_TIMEOUT_MS/.test(tool.description)) {
      throw new Error(`Tool ${tool.name} description must not expose runtime configuration names`);
    }
    if (apiBackedToolNames.has(tool.name) && !tool.description.includes("공식 공공데이터 API 키가 런타임에 필요합니다.")) {
      throw new Error(`Tool ${tool.name} description must explain the runtime public-data key requirement`);
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
    if (annotations.title !== tool.title) {
      throw new Error(`Tool ${tool.name} annotation title must match the public tool title`);
    }
    const expectedOpenWorldHint = apiBackedToolNames.has(tool.name);
    if (!annotations.readOnlyHint || annotations.destructiveHint || annotations.openWorldHint !== expectedOpenWorldHint || !annotations.idempotentHint) {
      throw new Error(`Tool ${tool.name} annotations must declare a read-only, non-destructive, ${expectedOpenWorldHint ? "open-world" : "closed-world"}, idempotent contract`);
    }
    assertInputSchemaDescriptions(tool.name, tool.inputSchema);
  }

  for (const smokeCase of offlineToolSmokeCases) {
    const startedAt = performance.now();
    const result = await client.callTool({
      name: smokeCase.name,
      arguments: smokeCase.arguments
    });
    const latencyMs = performance.now() - startedAt;
    console.log(`tool_latency_ms[${smokeCase.name}]=${latencyMs.toFixed(1)}`);
    if (latencyMs > 3000) throw new Error(`Smoke latency exceeded 3000ms for ${smokeCase.name}: ${latencyMs.toFixed(1)}ms`);
    const resultText = textFromToolResult(smokeCase.name, result);
    assertToolOutputQuality(smokeCase.name, resultText, smokeCase.requiredPhrases, smokeCase.requiredSources);
    console.log(`tool_output_chars[${smokeCase.name}]=${resultText.length}`);
  }

  if (process.env.EXPECT_MISSING_PUBLIC_DATA_KEY_FAILURE === "1") {
    await assertApiBackedToolsFailWithoutPublicDataKey(client);
  }

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
  console.error(compactScriptErrorMessage(error));
  process.exit(1);
});
