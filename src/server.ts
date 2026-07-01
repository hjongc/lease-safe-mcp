import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import * as z from "zod/v4";
import {
  assessLeaseSafety,
  buildMoveInProtectionPlan,
  compareDepositToSaleMarket,
  checkLeaseRedFlags,
  compareRentMarket,
  dataGoKrServiceKey,
  explainDataAvailability,
  explainDisputePrevention,
  isAllZeroLawdCd,
  isFutureDealYmd,
  MONEY_INPUT_LIMITS,
  prepareContractQuestions,
  publicDataTimeoutMs,
  resolveLegalDongCode,
  routeOfficialHelp,
  sourceRegistry
} from "./domain.js";

const SERVICE_NAME = "Lease Safe(전월세안전내비)";
const VERSION = "0.1.0";
const DEFAULT_MCP_MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_MCP_RATE_LIMIT_PER_MINUTE = 120;
const MIN_MCP_AUTH_TOKEN_LENGTH = 16;
const MCP_AUTH_TOKEN_PLACEHOLDERS = new Set([
  "replace-with-runtime-secret",
  "your-mcp-auth-token",
  "mcp-auth-token",
  "..."
]);

export const MCP_TEXT_LIMITS = {
  region: 80,
  situation: 1000,
  dateText: 40,
  concerns: 300
} as const;

type ToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint: boolean;
};

const regionSchema = z.string().max(MCP_TEXT_LIMITS.region).optional().describe(`시·군·구 또는 법정동처럼 계약 주택이 있는 지역을 ${MCP_TEXT_LIMITS.region}자 이내로 적어주세요. 정확한 주소나 호수는 넣지 않습니다.`);
const situationSchema = z.string().max(MCP_TEXT_LIMITS.situation).optional().describe(`전월세 계약, 이사, 보증금, 임대인, 중개사, 등기부 관련 걱정을 ${MCP_TEXT_LIMITS.situation}자 이내 자연어로 적어주세요. 민감정보는 넣지 않습니다.`);
const housingTypeSchema = z
  .enum(["apartment", "rowhouse", "single_multi", "officetel", "unknown"])
  .optional()
  .describe("주택 유형입니다. apartment=아파트, rowhouse=연립다세대, single_multi=단독/다가구, officetel=오피스텔, unknown=미확인.");
const contractTypeSchema = z.enum(["jeonse", "monthly_rent", "unknown"]).optional().describe("계약 유형입니다. jeonse=전세, monthly_rent=월세, unknown=미확인.");
const depositSchema = z.number().int().nonnegative().max(MONEY_INPUT_LIMITS.depositManwon).optional().describe(`보증금을 만원 단위 정수로 적어주세요. 예: 30000은 3억원입니다. 최대 ${MONEY_INPUT_LIMITS.depositManwon.toLocaleString("ko-KR")}만원까지 입력할 수 있습니다.`);
const monthlyRentSchema = z.number().int().nonnegative().max(MONEY_INPUT_LIMITS.monthlyRentManwon).optional().describe(`월세를 만원 단위 정수로 적어주세요. 예: 80은 월세 80만원입니다. 최대 ${MONEY_INPUT_LIMITS.monthlyRentManwon.toLocaleString("ko-KR")}만원까지 입력할 수 있습니다.`);
const moveInDateSchema = z.string().max(MCP_TEXT_LIMITS.dateText).optional().describe(`이사 예정일 또는 입주일을 YYYY-MM-DD 형식이나 ${MCP_TEXT_LIMITS.dateText}자 이내 자연어로 적어주세요.`);
const contractDateSchema = z.string().max(MCP_TEXT_LIMITS.dateText).optional().describe(`계약일을 YYYY-MM-DD 형식이나 ${MCP_TEXT_LIMITS.dateText}자 이내 자연어로 적어주세요.`);
const concernsSchema = z.string().max(MCP_TEXT_LIMITS.concerns).optional().describe(`가장 걱정되는 점을 ${MCP_TEXT_LIMITS.concerns}자 이내로 짧게 적어주세요. 예: 근저당, 대리계약, 보증보험, 전입신고, 확정일자.`);
const lawdCdSchema = z
  .string()
  .regex(/^\d{5}$/)
  .refine(value => !isAllZeroLawdCd(value), { message: "LAWD_CD must not be 00000." })
  .describe("법정동 코드 10자리 중 앞 5자리인 시군구 코드입니다. 00000은 넣지 않습니다. 예: 서울 관악구 11620.");
const dealYmdSchema = z
  .string()
  .regex(/^\d{4}(0[1-9]|1[0-2])$/)
  .refine(value => !isFutureDealYmd(value), { message: "DEAL_YMD must not be in the future." })
  .describe("조회할 계약년월 6자리입니다. YYYYMM 형식이며 월은 01부터 12까지이고 미래 월은 넣지 않습니다. 예: 202605.");

function readOnlyAnnotations(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true
  };
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text: text.replace(/\n{3,}/g, "\n\n").trim() }]
  };
}

function allowedHostsFromEnv(): string[] | undefined {
  const hosts = process.env.MCP_ALLOWED_HOSTS?.split(",").map(host => host.trim()).filter(Boolean).map(host => {
    if (
      host === "*" ||
      host.includes("://") ||
      host.includes("/") ||
      host.includes("\\") ||
      host.includes("@") ||
      host.includes("?") ||
      host.includes("#") ||
      /\s/.test(host) ||
      host.length > 253
    ) {
      throw new Error("MCP_ALLOWED_HOSTS entries must be plain hostnames or host:port values, not URLs, paths, wildcards, userinfo, query strings, fragments, or whitespace.");
    }

    try {
      const hostname = new URL(`http://${host}`).hostname;
      if (!hostname) throw new Error("missing hostname");
      return hostname;
    } catch {
      throw new Error("MCP_ALLOWED_HOSTS entries must be plain hostnames or host:port values, not URLs, paths, wildcards, userinfo, query strings, fragments, or whitespace.");
    }
  });
  return hosts && hosts.length > 0 ? hosts : undefined;
}

function requiredAllowedHosts(): string[] {
  const allowedHosts = allowedHostsFromEnv();
  if (allowedHosts) return allowedHosts;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MCP_ALLOWED_HOSTS is required in production to enable DNS rebinding protection.");
  }
  return ["127.0.0.1", "localhost"];
}

function requireProductionDataKey(): void {
  if (process.env.NODE_ENV !== "production") return;
  try {
    dataGoKrServiceKey();
  } catch (error) {
    if (/DATA_GO_KR_SERVICE_KEY is required/.test((error as Error).message)) {
      throw new Error("DATA_GO_KR_SERVICE_KEY is required in production for official public-data tools.");
    }
    throw error;
  }
}

function mcpAuthToken(): string | undefined {
  const token = process.env.MCP_AUTH_TOKEN?.trim();
  if (!token) return undefined;
  if (MCP_AUTH_TOKEN_PLACEHOLDERS.has(token.toLowerCase())) {
    throw new Error("MCP_AUTH_TOKEN must be a real bearer token, not a placeholder.");
  }
  if (token.length < MIN_MCP_AUTH_TOKEN_LENGTH) {
    throw new Error(`MCP_AUTH_TOKEN must be at least ${MIN_MCP_AUTH_TOKEN_LENGTH} characters when set.`);
  }
  return token;
}

export function mcpMaxBodyBytes(): number {
  const rawLimit = process.env.MCP_MAX_BODY_BYTES?.trim();
  if (!rawLimit) return DEFAULT_MCP_MAX_BODY_BYTES;

  const parsed = parsePlainInteger(rawLimit);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("MCP_MAX_BODY_BYTES must be a positive integer.");
  }
  return parsed;
}

export function mcpRateLimitPerMinute(): number {
  const rawLimit = process.env.MCP_RATE_LIMIT_PER_MINUTE?.trim();
  if (!rawLimit) return DEFAULT_MCP_RATE_LIMIT_PER_MINUTE;

  const parsed = parsePlainInteger(rawLimit);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("MCP_RATE_LIMIT_PER_MINUTE must be a non-negative integer.");
  }
  return parsed;
}

export function httpPort(): number {
  const rawPort = process.env.PORT?.trim();
  if (!rawPort) return 3000;

  const parsed = parsePlainInteger(rawPort);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return parsed;
}

function parsePlainInteger(value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
}

function jsonRpcError(res: Response, httpStatus: number, code: number, message: string): void {
  res.status(httpStatus).json({
    jsonrpc: "2.0",
    error: {
      code,
      message
    },
    id: null
  });
}

function methodNotAllowedForMcp(res: Response, message: string): void {
  res.setHeader("Allow", "POST");
  jsonRpcError(res, 405, -32000, message);
}

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

type RateLimitWindow = { count: number; resetAt: number };

export function pruneExpiredRateLimitWindows(windows: Map<string, RateLimitWindow>, now: number): void {
  for (const [entryKey, entryWindow] of windows) {
    if (entryWindow.resetAt <= now) windows.delete(entryKey);
  }
}

function rateLimitMcpRequests(limitPerMinute: number) {
  const windows = new Map<string, RateLimitWindow>();
  const windowMs = 60_000;
  let nextPruneAt = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST" || limitPerMinute === 0) {
      next();
      return;
    }

    const now = Date.now();
    if (now >= nextPruneAt) {
      pruneExpiredRateLimitWindows(windows, now);
      nextPruneAt = now + windowMs;
    }

    const key = clientKey(req);
    const current = windows.get(key);
    const window = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
    window.count += 1;
    windows.set(key, window);

    if (window.count > limitPerMinute) {
      const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      jsonRpcError(res, 429, -32002, "Too many MCP requests. Try again later.");
      return;
    }

    next();
  };
}

function rejectOversizedMcpRequest(maxBodyBytes: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") {
      next();
      return;
    }

    const contentLength = req.header("content-length");
    if (!contentLength) {
      next();
      return;
    }

    if (!/^\d+$/.test(contentLength)) {
      jsonRpcError(res, 400, -32600, "Invalid Content-Length header.");
      return;
    }

    if (Number(contentLength) > maxBodyBytes) {
      jsonRpcError(res, 413, -32600, `MCP request body exceeds ${maxBodyBytes} bytes.`);
      return;
    }

    next();
  };
}

function requireMcpJsonContentType(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "POST") {
    next();
    return;
  }

  if (req.is(["application/json", "application/*+json"])) {
    next();
    return;
  }

  jsonRpcError(res, 415, -32600, "MCP POST requests must use application/json.");
}

function handleMcpExpressError(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  const expressError = error as { status?: number; type?: string; message?: string };
  if (res.headersSent) {
    next(error);
    return;
  }

  if (expressError.status === 413 || expressError.type === "entity.too.large") {
    jsonRpcError(res, 413, -32600, "MCP request body is too large.");
    return;
  }

  if (expressError instanceof SyntaxError || expressError.type === "entity.parse.failed") {
    jsonRpcError(res, 400, -32700, "Invalid JSON request body.");
    return;
  }

  next(error);
}

function bearerTokenMatches(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const suppliedToken = authorization.slice("Bearer ".length);
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function requireBearerToken(req: Request, res: Response, expectedToken: string | undefined): boolean {
  if (!expectedToken) return true;

  const authorization = req.header("authorization");
  if (!bearerTokenMatches(authorization, expectedToken)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="lease-safe"');
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized"
      },
      id: null
    });
    return false;
  }
  return true;
}

function requireMcpBearerToken(expectedToken: string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!requireBearerToken(req, res, expectedToken)) return;
    next();
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "lease-safe",
      version: VERSION
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );

  server.registerTool(
    "assess_lease_safety",
    {
      title: "전월세 안전 종합 진단",
      description:
        "전월세안전내비의 대표 진단 도구입니다. 국토교통부 전월세·매매 실거래가를 함께 조회해 보증금의 주변 시세 위치, 매매가 대비 비율, 계약 위험 신호, 입주 보호 행동을 한 번에 정리합니다. DATA_GO_KR_SERVICE_KEY가 필요합니다.",
      inputSchema: {
        housingType: z.enum(["apartment", "rowhouse", "single_multi", "officetel"]).describe("진단할 주택 유형입니다."),
        lawdCd: lawdCdSchema,
        dealYmd: dealYmdSchema,
        depositManwon: z.number().int().nonnegative().max(MONEY_INPUT_LIMITS.depositManwon).describe(`보증금을 만원 단위 정수로 적어주세요. 예: 30000은 3억원입니다. 최대 ${MONEY_INPUT_LIMITS.depositManwon.toLocaleString("ko-KR")}만원까지 입력할 수 있습니다.`),
        monthlyRentManwon: monthlyRentSchema,
        situation: situationSchema,
        region: regionSchema,
        contractType: contractTypeSchema,
        moveInDate: moveInDateSchema,
        contractDate: contractDateSchema,
        concerns: concernsSchema
      },
      annotations: readOnlyAnnotations("전월세 안전 종합 진단")
    },
    async input => textResult(await assessLeaseSafety(input))
  );

  server.registerTool(
    "explain_data_availability",
    {
      title: "데이터 조달 가능성 설명",
      description:
        "전월세안전내비가 법정동코드, 전월세 실거래가, 전입신고, 확정일자, 임대차신고, 분쟁조정 데이터를 실제로 어디서 가져오는지 공식 출처 기준으로 설명합니다.",
      inputSchema: {},
      annotations: readOnlyAnnotations("데이터 조달 가능성 설명")
    },
    async () => textResult(explainDataAvailability())
  );

  server.registerTool(
    "resolve_legal_dong_code",
    {
      title: "법정동 코드 확인",
      description:
        "전월세안전내비가 지역명을 실거래가 조회용 법정동 코드 확인 절차로 연결하고, 내장 검토 목록에 있는 주요 지역은 LAWD_CD 후보를 보여줍니다.",
      inputSchema: {
        region: z.string().min(2).max(MCP_TEXT_LIMITS.region).describe(`확인할 지역명입니다. ${MCP_TEXT_LIMITS.region}자 이내로 적어주세요. 예: 서울 관악구, 성남시 분당구, 부산 해운대구.`)
      },
      annotations: readOnlyAnnotations("법정동 코드 확인")
    },
    async input => textResult(await resolveLegalDongCode(input))
  );

  server.registerTool(
    "compare_rent_market",
    {
      title: "전월세 실거래 비교",
      description:
        "전월세안전내비가 국토교통부 전월세 실거래가 OpenAPI를 호출해 지역·계약월·주택유형 기준 보증금 표본과 사용자의 계약조건을 비교합니다. DATA_GO_KR_SERVICE_KEY가 필요합니다.",
      inputSchema: {
        housingType: z.enum(["apartment", "rowhouse", "single_multi", "officetel"]).describe("실거래가를 조회할 주택 유형입니다."),
        lawdCd: lawdCdSchema,
        dealYmd: dealYmdSchema,
        depositManwon: depositSchema,
        monthlyRentManwon: monthlyRentSchema
      },
      annotations: readOnlyAnnotations("전월세 실거래 비교")
    },
    async input => textResult(await compareRentMarket(input))
  );

  server.registerTool(
    "compare_deposit_to_sale_market",
    {
      title: "매매가 대비 보증금 점검",
      description:
        "전월세안전내비가 국토교통부 매매 실거래가 OpenAPI를 호출해 입력 보증금이 주변 매매가 중앙값 대비 어느 정도인지 전세가율 관점으로 점검합니다. DATA_GO_KR_SERVICE_KEY가 필요합니다.",
      inputSchema: {
        housingType: z.enum(["apartment", "rowhouse", "single_multi", "officetel"]).describe("매매 실거래가를 조회할 주택 유형입니다."),
        lawdCd: lawdCdSchema,
        dealYmd: dealYmdSchema,
        depositManwon: z.number().int().nonnegative().max(MONEY_INPUT_LIMITS.depositManwon).describe(`비교할 보증금을 만원 단위 정수로 적어주세요. 예: 30000은 3억원입니다. 최대 ${MONEY_INPUT_LIMITS.depositManwon.toLocaleString("ko-KR")}만원까지 입력할 수 있습니다.`)
      },
      annotations: readOnlyAnnotations("매매가 대비 보증금 점검")
    },
    async input => textResult(await compareDepositToSaleMarket(input))
  );

  server.registerTool(
    "check_lease_red_flags",
    {
      title: "계약 위험 신호 점검",
      description:
        "전월세안전내비가 대리계약, 근저당, 선순위 권리, 보증금 규모, 가계약 압박 같은 전월세 계약 위험 신호와 공식 확인 순서를 정리합니다.",
      inputSchema: {
        situation: situationSchema,
        region: regionSchema,
        housingType: housingTypeSchema,
        contractType: contractTypeSchema,
        depositManwon: depositSchema,
        monthlyRentManwon: monthlyRentSchema,
        concerns: concernsSchema
      },
      annotations: readOnlyAnnotations("계약 위험 신호 점검")
    },
    async input => textResult(checkLeaseRedFlags(input))
  );

  server.registerTool(
    "build_move_in_protection_plan",
    {
      title: "이사 보호 절차 계획",
      description:
        "전월세안전내비가 계약 전, 잔금·입주 당일, 입주 후에 확인할 전입신고, 확정일자, 임대차신고, 등기부 재확인 절차를 체크리스트로 정리합니다.",
      inputSchema: {
        situation: situationSchema,
        region: regionSchema,
        contractType: contractTypeSchema,
        depositManwon: depositSchema,
        monthlyRentManwon: monthlyRentSchema,
        moveInDate: moveInDateSchema,
        contractDate: contractDateSchema,
        concerns: concernsSchema
      },
      annotations: readOnlyAnnotations("이사 보호 절차 계획")
    },
    async input => textResult(buildMoveInProtectionPlan(input))
  );

  server.registerTool(
    "prepare_contract_questions",
    {
      title: "계약 전 질문 준비",
      description:
        "전월세안전내비가 공인중개사나 임대인에게 물어볼 등기부, 대리권, 임대차신고, 확정일자, 보증보험, 특약 질문을 준비합니다.",
      inputSchema: {
        situation: situationSchema,
        region: regionSchema,
        housingType: housingTypeSchema,
        contractType: contractTypeSchema,
        depositManwon: depositSchema,
        monthlyRentManwon: monthlyRentSchema,
        concerns: concernsSchema
      },
      annotations: readOnlyAnnotations("계약 전 질문 준비")
    },
    async input => textResult(prepareContractQuestions(input))
  );

  server.registerTool(
    "route_official_help",
    {
      title: "공식 문의처 연결",
      description:
        "전월세안전내비가 전입신고, 확정일자, 임대차신고, 보증보험, 등기부, 분쟁 상황을 정부24, RTMS, 인터넷등기소, HUG, 임대차분쟁조정위로 라우팅합니다.",
      inputSchema: {
        situation: situationSchema,
        issueType: z
          .enum(["move_in", "fixed_date", "lease_report", "deposit_guarantee", "dispute", "registry", "unknown"])
          .optional()
          .describe("문의 유형입니다. move_in=전입신고, fixed_date=확정일자, lease_report=임대차신고, deposit_guarantee=보증보험, dispute=분쟁, registry=등기부, unknown=미확인."),
        region: regionSchema,
        concerns: concernsSchema
      },
      annotations: readOnlyAnnotations("공식 문의처 연결")
    },
    async input => textResult(routeOfficialHelp(input))
  );

  server.registerTool(
    "explain_dispute_prevention",
    {
      title: "분쟁 예방 설명",
      description:
        "전월세안전내비가 보증금 반환, 수선, 원상복구, 계약갱신, 차임 증액 같은 임대차 분쟁을 예방하기 위해 남길 증거와 공식 조정 경로를 설명합니다.",
      inputSchema: {
        situation: situationSchema,
        disputeType: z
          .enum(["deposit_return", "repair", "restoration", "renewal", "rent_increase", "unknown"])
          .optional()
          .describe("분쟁 유형입니다. deposit_return=보증금 반환, repair=수선, restoration=원상복구, renewal=계약갱신, rent_increase=차임·보증금 증액, unknown=미확인."),
        region: regionSchema,
        concerns: concernsSchema
      },
      annotations: readOnlyAnnotations("분쟁 예방 설명")
    },
    async input => textResult(explainDisputePrevention(input))
  );

  server.registerResource(
    "official-source-registry",
    "lease-safe://sources/official",
    {
      title: "전월세안전내비 공식 출처 목록",
      description: "전월세안전내비가 사용하는 공식 API와 공공기관 안내 출처 목록입니다.",
      mimeType: "application/json"
    },
    async uri => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: sourceRegistry()
        }
      ]
    })
  );

  return server;
}

export function createApp() {
  const allowedHosts = requiredAllowedHosts();
  requireProductionDataKey();
  const maxBodyBytes = mcpMaxBodyBytes();
  const rateLimitPerMinute = mcpRateLimitPerMinute();
  const publicDataTimeout = publicDataTimeoutMs();
  const authToken = mcpAuthToken();
  const app = express();

  app.disable("x-powered-by");
  app.use(hostHeaderValidation(allowedHosts));

  app.get("/", (_req: Request, res: Response) => {
    res.type("text/plain").send(`${SERVICE_NAME} MCP server is running. Use POST /mcp for Streamable HTTP.`);
  });

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "lease-safe",
      version: VERSION,
      transport: "streamable-http",
      stateless: true,
      maxBodyBytes,
      rateLimitPerMinute,
      publicDataTimeoutMs: publicDataTimeout
    });
  });

  app.post(
    "/mcp",
    rateLimitMcpRequests(rateLimitPerMinute),
    rejectOversizedMcpRequest(maxBodyBytes),
    requireMcpBearerToken(authToken),
    requireMcpJsonContentType,
    express.json({ limit: `${maxBodyBytes}b` }),
    async (req: Request, res: Response) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error("Error handling MCP request", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error"
            },
            id: null
          });
        }
      }
    }
  );

  app.head("/mcp", (_req: Request, res: Response) => {
    methodNotAllowedForMcp(res, "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    methodNotAllowedForMcp(res, "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    methodNotAllowedForMcp(res, "Method not allowed for stateless server.");
  });

  app.all("/mcp", (_req: Request, res: Response) => {
    methodNotAllowedForMcp(res, "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
  });

  app.use("/mcp", handleMcpExpressError);

  return app;
}

export function startHttpServer(port = httpPort()): Server {
  const app = createApp();
  const httpServer = app.listen(port, "0.0.0.0", error => {
    if (error) {
      console.error("Failed to start server", error);
      process.exit(1);
    }
    console.log(`${SERVICE_NAME} listening on port ${port}`);
  });

  function shutdown(signal: NodeJS.Signals) {
    console.log(`Received ${signal}; shutting down ${SERVICE_NAME}`);
    const forceExit = setTimeout(() => {
      console.error("Graceful shutdown timed out.");
      process.exit(1);
    }, 5000);
    forceExit.unref();

    httpServer.close(error => {
      clearTimeout(forceExit);
      if (error) {
        console.error("Failed to close server", error);
        process.exit(1);
      }
      process.exit(0);
    });
  }

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return httpServer;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHttpServer();
}
