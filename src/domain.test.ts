import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  assessLeaseSafety,
  buildMoveInProtectionPlan,
  checkLeaseRedFlags,
  compareDepositToSaleMarket,
  compareRentMarket,
  dataGoKrServiceKey,
  explainDataAvailability,
  isAllZeroLawdCd,
  isFutureDealYmd,
  prepareContractQuestions,
  MONEY_INPUT_LIMITS,
  publicDataTimeoutMs,
  resolveLegalDongCode,
  routeOfficialHelp
} from "./domain.js";
import { MCP_TEXT_LIMITS, compactLogError, createApp, createServer, handleHttpServerListenError, httpHost, httpPort, mcpMaxBodyBytes, mcpRateLimitPerMinute, pruneExpiredRateLimitWindows } from "./server.js";
import { MAX_SOURCE_REVIEW_AGE_DAYS, assertFreshSourceReviews, assertValidSourceRegistry, renderSources, sourceReviewAgeDays, type SourceRecord } from "./sources.js";
import { assessmentRiskEvidenceLevel, assertLegalDongSmokeMatchesLawdCd, positiveOfficialTotalCount, positiveSampleCount, publicDataSmokeConfigLine, publicDataSmokeDealYmd, publicDataSmokeDepositManwon, publicDataSmokeHousingTypes, publicDataSmokeLawdCd, publicDataSmokeRegion } from "../scripts/public-data-smoke.js";
import { compactScriptErrorMessage } from "../scripts/safe-error.js";
import { scanLine, shouldScanFileName } from "../scripts/secret-scan.js";
import { extractLivePublicDataEvidenceLines } from "../scripts/live-evidence.js";
import { dockerImageReferenceFromEnv } from "../scripts/docker-image-reference.js";

const PUBLIC_DATA_KEY_ENV_NAME = ["DATA_GO_KR", "SERVICE_KEY"].join("_");
const MCP_AUTH_TOKEN_ENV_NAME = ["MCP_AUTH", "TOKEN"].join("_");
const VALID_TEST_SERVICE_KEY = [
  "LeaseSafePublicDataSmokeKey",
  "OnlyForTests1234567890+/",
  "=="
].join("");
const VALID_TEST_SERVICE_KEY_ENCODED = encodeURIComponent(VALID_TEST_SERVICE_KEY);
const VALID_TEST_AUTH_TOKEN = "strong-test-token";
const FUTURE_DEAL_YMD = "999912";
const REQUIRED_CI_QUALITY_GATE_STEP_NAMES = [
  "Check whitespace diffs",
  "Scan for committed secrets",
  "Test",
  "Validate PlayMCP readiness",
  "Check official source freshness",
  "Smoke local MCP HTTP server",
  "Smoke MCP rate limit",
  "Audit production dependencies",
  "Build Docker image",
  "Smoke Docker runtime",
  "Live public-data smoke",
  "Publish live public-data status"
];
const REQUIRED_REGISTRATION_EVIDENCE_STEP_NAMES = [
  "Run registration preflight",
  "Publish registration evidence summary"
];
const REQUIRED_PUBLISH_IMAGE_STEP_NAMES = [
  "Validate PlayMCP readiness",
  "Scan for committed secrets",
  "Build Docker image",
  "Smoke Docker runtime",
  "Push GHCR image",
  "Publish image summary"
];

type ToolInputSchema = {
  safeParse(input: unknown): { success: boolean };
};

function successfulWorkflowStep(name: string): { name: string; conclusion: "success" } {
  return { name, conclusion: "success" };
}

function workflowJobsJson(jobs: Array<{
  name: string;
  conclusion: "success";
  steps: Array<{ name: string; conclusion: "success" }>;
}>): string {
  return JSON.stringify({ jobs });
}

function reviewedSource(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: "official-test-source",
    title: "공식 테스트 출처",
    sourceName: "공식 테스트 기관",
    url: "https://example.go.kr/source",
    reviewedAt: "2026-06-30",
    confidence: "official_national",
    useFor: "공식 출처 레지스트리 검증 테스트",
    ...overrides
  };
}

function registeredToolSchema(toolName: string): ToolInputSchema {
  const server = createServer() as unknown as {
    _registeredTools: Record<string, { inputSchema: ToolInputSchema }>;
  };
  const tool = server._registeredTools[toolName];
  assert.ok(tool, `registered tool missing: ${toolName}`);
  return tool.inputSchema;
}

function runRegistrationEnvCheck(value?: string, envPatch: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  const env = { ...process.env };
  delete env[PUBLIC_DATA_KEY_ENV_NAME];
  delete env[MCP_AUTH_TOKEN_ENV_NAME];
  for (const name of ["PUBLIC_DATA_SMOKE_REGION", "PUBLIC_DATA_SMOKE_LAWD_CD", "PUBLIC_DATA_SMOKE_DEAL_YMD", "PUBLIC_DATA_SMOKE_DEPOSIT_MANWON", "PUBLIC_DATA_SMOKE_HOUSING_TYPES"]) {
    delete env[name];
  }
  Object.assign(env, envPatch);
  if (value !== undefined) env[PUBLIC_DATA_KEY_ENV_NAME] = value;
  if (value !== undefined && !Object.hasOwn(envPatch, MCP_AUTH_TOKEN_ENV_NAME)) env[MCP_AUTH_TOKEN_ENV_NAME] = VALID_TEST_AUTH_TOKEN;

  return spawnSync(process.execPath, ["scripts/require-registration-env.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8"
  });
}

function runGitHubSecretCheck(envPatch: Record<string, string>): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["scripts/check-github-secret.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, ...envPatch },
    encoding: "utf8"
  });
}

function runRegistrationReadinessCheck(envPatch: Record<string, string>): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["scripts/check-registration-readiness.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, ...envPatch },
    encoding: "utf8"
  });
}

function processStderr(result: ReturnType<typeof spawnSync>): string {
  return typeof result.stderr === "string" ? result.stderr : result.stderr.toString("utf8");
}

function processStdout(result: ReturnType<typeof spawnSync>): string {
  return typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8");
}

function runBuiltScript(scriptPath: string, envPatch: Record<string, string>): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: { ...process.env, ...envPatch },
    encoding: "utf8"
  });
}

function writeExecutableScript(path: string, lines: string[]): void {
  writeFileSync(path, `${lines.join("\n")}\n`);
  chmodSync(path, 0o755);
}

function rentItemXml(index: number, depositManwon: number): string {
  return `
    <item>
      <aptNm>관악전세${index}</aptNm>
      <umdNm>봉천동</umdNm>
      <deposit>${depositManwon.toLocaleString("ko-KR")}</deposit>
      <monthlyRent>0</monthlyRent>
      <dealYear>2026</dealYear>
      <dealMonth>5</dealMonth>
      <dealDay>${String((index % 28) + 1)}</dealDay>
    </item>
  `;
}

function saleItemXml(index: number, dealAmountManwon: number): string {
  return `
    <item>
      <aptNm>관악매매${index}</aptNm>
      <umdNm>봉천동</umdNm>
      <dealAmount>${dealAmountManwon.toLocaleString("ko-KR")}</dealAmount>
      <dealYear>2026</dealYear>
      <dealMonth>5</dealMonth>
      <dealDay>${String((index % 28) + 1)}</dealDay>
    </item>
  `;
}

test("data availability names automatic APIs and no fake fallback", () => {
  const text = explainDataAvailability();
  assert.match(text, /법정동코드/);
  assert.match(text, /전월세 실거래가/);
  assert.match(text, /HUG/);
});

test("secret scan allows exact placeholders but rejects hidden values beside them", () => {
  const dataKeyName = "DATA_GO_KR" + "_SERVICE_KEY";
  const authTokenName = "MCP_AUTH" + "_TOKEN";
  const publicDataPlaceholder = dataKeyName + "=your-data-go-kr-service-key";
  const authPlaceholder = authTokenName + "=replace-with-runtime-secret";

  assert.deepEqual(scanLine("README.md", authPlaceholder, 1), []);
  assert.deepEqual(scanLine("scripts/secret-scan.ts", `  "${publicDataPlaceholder}",`, 1), []);

  assert.equal(
    scanLine("README.md", authPlaceholder + " also-real-token-value-1234567890", 1).length,
    1
  );
  assert.equal(
    scanLine("README.md", dataKeyName + "=... " + "AAAABBBBCCCCDDDDEEEEFFFF" + "%2F" + "GGGGHHHHIIIIJJJJKKKKLLLL" + "%3D%3D", 1).length,
    1
  );

  const decodedPublicDataKey = [
    "AAAABBBBCCCCDDDDEEEEFFFF",
    "/",
    "GGGGHHHHIIIIJJJJKKKKLLLL",
    "=="
  ].join("");
  assert.equal(scanLine("README.md", decodedPublicDataKey, 1).length, 1);
  assert.deepEqual(scanLine("src/domain.test.ts", VALID_TEST_SERVICE_KEY, 1), []);
  assert.equal(scanLine("src/domain.test.ts", `${VALID_TEST_SERVICE_KEY} ${decodedPublicDataKey}`, 1).length, 1);
});

test("secret scan covers production configuration file names", () => {
  assert.equal(shouldScanFileName(".env"), true);
  assert.equal(shouldScanFileName(".env.production"), true);
  assert.equal(shouldScanFileName("Dockerfile"), true);
  assert.equal(shouldScanFileName(".npmrc"), true);
  assert.equal(shouldScanFileName("README.md"), true);
  assert.equal(shouldScanFileName("notes.txt"), false);
});

test("official source rendering fails fast on unknown source ids", () => {
  assert.match(renderSources(["gov24"]), /정부24/);
  assert.throws(() => renderSources(["gov24", "gov24"]), /Duplicate official source id: gov24/);
  assert.throws(() => renderSources(["gov24", "missing-source"]), /Unknown official source id: missing-source/);
});

test("official source reviews must stay fresh for registration evidence", () => {
  const today = new Date(Date.UTC(2026, 6, 2));
  assert.equal(sourceReviewAgeDays("2026-06-30", today), 2);
  assert.doesNotThrow(() => assertFreshSourceReviews([
    {
      id: "fresh-source",
      title: "Fresh",
      sourceName: "공식 출처",
      url: "https://example.go.kr/",
      reviewedAt: "2026-06-30",
      confidence: "official_national",
      useFor: "공식 검토일 freshness 테스트"
    }
  ], today));
  assert.throws(
    () => assertFreshSourceReviews([
      {
        id: "stale-source",
        title: "Stale",
        sourceName: "오래된 공식 출처",
        url: "https://example.go.kr/",
        reviewedAt: "2026-05-01",
        confidence: "official_national",
        useFor: "오래된 검토일 테스트"
      }
    ], today),
    new RegExp(`stale-source.*maxDays=${MAX_SOURCE_REVIEW_AGE_DAYS}`)
  );
  assert.throws(
    () => assertFreshSourceReviews([
      {
        id: "future-source",
        title: "Future",
        sourceName: "미래 공식 출처",
        url: "https://example.go.kr/",
        reviewedAt: "2026-07-03",
        confidence: "official_national",
        useFor: "미래 검토일 테스트"
      }
    ], today),
    /future-source/
  );
});

test("official source registry validation rejects broken source metadata", () => {
  const today = new Date(Date.UTC(2026, 6, 2));
  assert.doesNotThrow(() => assertValidSourceRegistry([reviewedSource()], today));
  assert.throws(
    () => assertValidSourceRegistry([reviewedSource(), reviewedSource()], today),
    /Duplicate official source id in registry: official-test-source/
  );
  assert.throws(
    () => assertValidSourceRegistry([reviewedSource({ url: "http://example.go.kr/source" })], today),
    /must use an HTTPS URL/
  );
  assert.throws(
    () => assertValidSourceRegistry([reviewedSource({ sourceName: "   " })], today),
    /non-empty sourceName/
  );
  assert.throws(
    () => assertValidSourceRegistry([reviewedSource({ id: "Bad_Source" })], today),
    /stable lowercase slug/
  );
  assert.throws(
    () => assertValidSourceRegistry([reviewedSource({ confidence: "blog" as SourceRecord["confidence"] })], today),
    /supported confidence value/
  );
});

test("registration preflight env check rejects bad public-data keys before build", () => {
  const registrationEnvCheckSource = readFileSync("scripts/require-registration-env.mjs", "utf8");
  assert.match(registrationEnvCheckSource, /Asia\/Seoul/);
  assert.match(registrationEnvCheckSource, /formatToParts\(now\)/);

  const missing = runRegistrationEnvCheck();
  assert.notEqual(missing.status, 0);
  assert.match(processStderr(missing), /DATA_GO_KR_SERVICE_KEY is required/);

  const placeholder = runRegistrationEnvCheck("your-data-go-kr-service-key");
  assert.notEqual(placeholder.status, 0);
  assert.match(processStderr(placeholder), /not a placeholder/);

  const encodedPlaceholder = runRegistrationEnvCheck(encodeURIComponent("your-data-go-kr-service-key"));
  assert.notEqual(encodedPlaceholder.status, 0);
  assert.match(processStderr(encodedPlaceholder), /not a placeholder/);

  const malformed = runRegistrationEnvCheck("short-key");
  assert.notEqual(malformed.status, 0);
  assert.match(processStderr(malformed), /must look like a real data\.go\.kr service key/);

  const invalidEncoding = runRegistrationEnvCheck("%E0%A4%A");
  assert.notEqual(invalidEncoding.status, 0);
  assert.match(processStderr(invalidEncoding), /valid percent-encoded or decoded/);

  const whitespace = runRegistrationEnvCheck(` ${VALID_TEST_SERVICE_KEY}`);
  assert.notEqual(whitespace.status, 0);
  assert.match(processStderr(whitespace), /DATA_GO_KR_SERVICE_KEY must not contain whitespace/);

  const encodedWhitespace = runRegistrationEnvCheck(encodeURIComponent(`${VALID_TEST_SERVICE_KEY} `));
  assert.notEqual(encodedWhitespace.status, 0);
  assert.match(processStderr(encodedWhitespace), /DATA_GO_KR_SERVICE_KEY must not contain whitespace/);

  const encoded = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY_ENCODED);
  assert.equal(encoded.status, 0);
  assert.equal(processStderr(encoded), "");

  const missingAuthToken = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { [MCP_AUTH_TOKEN_ENV_NAME]: "" });
  assert.notEqual(missingAuthToken.status, 0);
  assert.match(processStderr(missingAuthToken), /MCP_AUTH_TOKEN is required/);

  const placeholderAuthToken = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { [MCP_AUTH_TOKEN_ENV_NAME]: ["replace", "with", "runtime", "secret"].join("-") });
  assert.notEqual(placeholderAuthToken.status, 0);
  assert.match(processStderr(placeholderAuthToken), /MCP_AUTH_TOKEN must be a real bearer token/);

  const weakAuthToken = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { [MCP_AUTH_TOKEN_ENV_NAME]: "short" });
  assert.notEqual(weakAuthToken.status, 0);
  assert.match(processStderr(weakAuthToken), /MCP_AUTH_TOKEN must be at least 16 characters/);
});

test("GitHub secret check rejects unsafe repository slugs before gh calls", () => {
  const invalidRepo = runGitHubSecretCheck({ GITHUB_REPOSITORY: "hjongc/lease-safe-mcp\nspoof" });
  assert.notEqual(invalidRepo.status, 0);
  assert.match(processStderr(invalidRepo), /GITHUB_REPOSITORY must be an owner\/repo GitHub repository slug/);
  assert.match(processStderr(invalidRepo), /Set GITHUB_REPOSITORY to an owner\/repo GitHub repository slug/);
  assert.doesNotMatch(processStderr(invalidRepo), /gh secret set DATA_GO_KR_SERVICE_KEY --repo/);
});

test("GitHub secret check requires production auth secret evidence", () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), "lease-safe-secret-"));
  try {
    const ghPath = join(fakeBinDir, "gh");
    writeExecutableScript(ghPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"secret\" ] && [ \"$2\" = \"list\" ]; then",
      "  echo 'DATA_GO_KR_SERVICE_KEY 2026-07-02T00:00:00Z'",
      "  exit 0",
      "fi",
      "echo \"unexpected gh call: $*\" >&2",
      "exit 3"
    ]);

    const missingAuthSecret = runGitHubSecretCheck({
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "hjongc/lease-safe-mcp"
    });

    assert.notEqual(missingAuthSecret.status, 0);
    assert.match(processStderr(missingAuthSecret), /MCP_AUTH_TOKEN is not configured/);
    assert.match(processStderr(missingAuthSecret), /gh secret set MCP_AUTH_TOKEN --repo hjongc\/lease-safe-mcp/);
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("registration readiness check rejects unsafe GitHub inputs before gh calls", () => {
  const invalidRepo = runRegistrationReadinessCheck({ GITHUB_REPOSITORY: "hjongc/lease-safe-mcp\nspoof" });
  assert.notEqual(invalidRepo.status, 0);
  assert.match(processStderr(invalidRepo), /GITHUB_REPOSITORY must be an owner\/repo GitHub repository slug/);
  assert.match(processStderr(invalidRepo), /Set GITHUB_REPOSITORY and REGISTRATION_READY_BRANCH/);
  assert.doesNotMatch(processStderr(invalidRepo), /gh workflow run CI --repo/);

  const invalidBranch = runRegistrationReadinessCheck({ REGISTRATION_READY_BRANCH: "main\nspoof" });
  assert.notEqual(invalidBranch.status, 0);
  assert.match(processStderr(invalidBranch), /REGISTRATION_READY_BRANCH must be a plain GitHub branch name/);
  assert.doesNotMatch(processStderr(invalidBranch), /gh workflow run CI --repo/);
});

test("registration readiness check rejects unpushed local head before GitHub evidence", () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), "lease-safe-readiness-"));
  try {
    const gitPath = join(fakeBinDir, "git");
    writeExecutableScript(gitPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"status\" ] && [ \"$2\" = \"--porcelain\" ]; then",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"HEAD\" ]; then",
      "  echo new-local-head",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"ls-remote\" ] && [ \"$2\" = \"--heads\" ]; then",
      "  echo 'old-remote-head\trefs/heads/main'",
      "  exit 0",
      "fi",
      "echo \"unexpected git call: $*\" >&2",
      "exit 2"
    ]);

    const ghPath = join(fakeBinDir, "gh");
    writeExecutableScript(ghPath, [
      "#!/bin/sh",
      "echo 'gh should not be called before remote HEAD matches' >&2",
      "exit 3"
    ]);

    const result = runRegistrationReadinessCheck({
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "hjongc/lease-safe-mcp",
      REGISTRATION_READY_BRANCH: "main"
    });

    assert.notEqual(result.status, 0);
    assert.match(processStderr(result), /Local HEAD new-local-head is not the remote main HEAD old-remote-head/);
    assert.doesNotMatch(processStderr(result), /gh should not be called/);
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("registration readiness check gives secret setup commands for missing secrets", () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), "lease-safe-readiness-"));
  try {
    const gitPath = join(fakeBinDir, "git");
    writeExecutableScript(gitPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"status\" ] && [ \"$2\" = \"--porcelain\" ]; then",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"HEAD\" ]; then",
      "  echo submitted-head",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"ls-remote\" ] && [ \"$2\" = \"--heads\" ]; then",
      "  echo 'submitted-head\trefs/heads/main'",
      "  exit 0",
      "fi",
      "echo \"unexpected git call: $*\" >&2",
      "exit 2"
    ]);

    const ghPath = join(fakeBinDir, "gh");
    writeExecutableScript(ghPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"secret\" ] && [ \"$2\" = \"list\" ]; then",
      "  echo 'DATA_GO_KR_SERVICE_KEY 2026-07-02T00:00:00Z'",
      "  exit 0",
      "fi",
      "echo 'gh workflow evidence should not be queried while secrets are missing' >&2",
      "exit 3"
    ]);

    const result = runRegistrationReadinessCheck({
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "hjongc/lease-safe-mcp",
      REGISTRATION_READY_BRANCH: "main"
    });

    assert.notEqual(result.status, 0);
    assert.match(processStderr(result), /MCP_AUTH_TOKEN is not configured as GitHub repository secrets/);
    assert.match(processStderr(result), /gh secret set MCP_AUTH_TOKEN --repo hjongc\/lease-safe-mcp/);
    assert.doesNotMatch(processStderr(result), /gh workflow evidence should not be queried/);
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("registration readiness check trusts the latest workflow run for a commit", () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), "lease-safe-readiness-"));
  try {
    const gitPath = join(fakeBinDir, "git");
    writeExecutableScript(gitPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"status\" ] && [ \"$2\" = \"--porcelain\" ]; then",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"HEAD\" ]; then",
      "  echo submitted-head",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"ls-remote\" ] && [ \"$2\" = \"--heads\" ]; then",
      "  echo 'submitted-head\trefs/heads/main'",
      "  exit 0",
      "fi",
      "echo \"unexpected git call: $*\" >&2",
      "exit 2"
    ]);

    const ghPath = join(fakeBinDir, "gh");
    writeExecutableScript(ghPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"secret\" ] && [ \"$2\" = \"list\" ]; then",
      "  printf '%s\\n' 'DATA_GO_KR_SERVICE_KEY 2026-07-02T00:00:00Z' 'MCP_AUTH_TOKEN 2026-07-02T00:00:00Z'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"list\" ]; then",
      "  printf '%s\\n' '[{\"databaseId\":100,\"conclusion\":\"success\",\"status\":\"completed\",\"headSha\":\"submitted-head\",\"url\":\"https://example.test/old\"},{\"databaseId\":101,\"conclusion\":\"\",\"status\":\"in_progress\",\"headSha\":\"submitted-head\",\"url\":\"https://example.test/new\"}]'",
      "  exit 0",
      "fi",
      "echo 'gh run view should not be called while latest workflow run is incomplete' >&2",
      "exit 3"
    ]);

    const result = runRegistrationReadinessCheck({
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "hjongc/lease-safe-mcp",
      REGISTRATION_READY_BRANCH: "main"
    });

    assert.notEqual(result.status, 0);
    assert.match(processStderr(result), /CI workflow run for current commit submitted-head is in_progress, not completed: https:\/\/example\.test\/new/);
    assert.doesNotMatch(processStderr(result), /gh run view should not be called/);
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("registration readiness check requires CI live public-data summary evidence", () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), "lease-safe-readiness-"));
  try {
    const gitPath = join(fakeBinDir, "git");
    writeExecutableScript(gitPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"status\" ] && [ \"$2\" = \"--porcelain\" ]; then",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"HEAD\" ]; then",
      "  echo submitted-head",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"ls-remote\" ] && [ \"$2\" = \"--heads\" ]; then",
      "  echo 'submitted-head\trefs/heads/main'",
      "  exit 0",
      "fi",
      "echo \"unexpected git call: $*\" >&2",
      "exit 2"
    ]);

    const ghPath = join(fakeBinDir, "gh");
    writeExecutableScript(ghPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"secret\" ] && [ \"$2\" = \"list\" ]; then",
      "  printf '%s\\n' 'DATA_GO_KR_SERVICE_KEY 2026-07-02T00:00:00Z' 'MCP_AUTH_TOKEN 2026-07-02T00:00:00Z'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"list\" ]; then",
      "  printf '%s\\n' '[{\"databaseId\":201,\"conclusion\":\"success\",\"status\":\"completed\",\"headSha\":\"submitted-head\",\"url\":\"https://example.test/ci\"}]'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"view\" ]; then",
      `  printf '%s\\n' '${workflowJobsJson([
        {
          name: "Quality Gate",
          conclusion: "success",
          steps: REQUIRED_CI_QUALITY_GATE_STEP_NAMES
            .filter(stepName => stepName !== "Publish live public-data status")
            .map(successfulWorkflowStep)
        }
      ])}'`,
      "  exit 0",
      "fi",
      "echo \"unexpected gh call: $*\" >&2",
      "exit 3"
    ]);

    const result = runRegistrationReadinessCheck({
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "hjongc/lease-safe-mcp",
      REGISTRATION_READY_BRANCH: "main"
    });

    assert.notEqual(result.status, 0);
    assert.match(processStderr(result), /CI workflow required job "Quality Gate" did not include required step: Publish live public-data status/);
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("registration readiness check binds required steps to the required workflow jobs", () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), "lease-safe-readiness-"));
  try {
    const gitPath = join(fakeBinDir, "git");
    writeExecutableScript(gitPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"status\" ] && [ \"$2\" = \"--porcelain\" ]; then",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"HEAD\" ]; then",
      "  echo submitted-head",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"ls-remote\" ] && [ \"$2\" = \"--heads\" ]; then",
      "  echo 'submitted-head\trefs/heads/main'",
      "  exit 0",
      "fi",
      "echo \"unexpected git call: $*\" >&2",
      "exit 2"
    ]);

    const ghPath = join(fakeBinDir, "gh");
    writeExecutableScript(ghPath, [
      "#!/bin/sh",
      "workflow=''",
      "previous=''",
      "for arg in \"$@\"; do",
      "  if [ \"$previous\" = \"--workflow\" ]; then",
      "    workflow=\"$arg\"",
      "  fi",
      "  previous=\"$arg\"",
      "done",
      "if [ \"$1\" = \"secret\" ] && [ \"$2\" = \"list\" ]; then",
      "  printf '%s\\n' 'DATA_GO_KR_SERVICE_KEY 2026-07-02T00:00:00Z' 'MCP_AUTH_TOKEN 2026-07-02T00:00:00Z'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"list\" ] && [ \"$workflow\" = \"CI\" ]; then",
      "  printf '%s\\n' '[{\"databaseId\":501,\"conclusion\":\"success\",\"status\":\"completed\",\"headSha\":\"submitted-head\",\"url\":\"https://example.test/ci\"}]'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"list\" ] && [ \"$workflow\" = \"Registration Preflight\" ]; then",
      "  printf '%s\\n' '[{\"databaseId\":601,\"conclusion\":\"success\",\"status\":\"completed\",\"headSha\":\"submitted-head\",\"url\":\"https://example.test/registration\"}]'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"list\" ] && [ \"$workflow\" = \"Publish Image\" ]; then",
      "  printf '%s\\n' '[{\"databaseId\":701,\"conclusion\":\"success\",\"status\":\"completed\",\"headSha\":\"submitted-head\",\"url\":\"https://example.test/publish\"}]'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"view\" ] && [ \"$3\" = \"501\" ]; then",
      `  printf '%s\\n' '${workflowJobsJson([
        {
          name: "Quality Gate",
          conclusion: "success",
          steps: REQUIRED_CI_QUALITY_GATE_STEP_NAMES
            .filter(stepName => stepName !== "Publish live public-data status")
            .map(successfulWorkflowStep)
        },
        {
          name: "Loose Evidence Job",
          conclusion: "success",
          steps: [successfulWorkflowStep("Publish live public-data status")]
        }
      ])}'`,
      "  exit 0",
      "fi",
      "echo \"unexpected gh call: $*\" >&2",
      "exit 3"
    ]);

    const result = runRegistrationReadinessCheck({
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "hjongc/lease-safe-mcp",
      REGISTRATION_READY_BRANCH: "main"
    });

    assert.notEqual(result.status, 0);
    assert.match(processStderr(result), /CI workflow required job "Quality Gate" did not include required step: Publish live public-data status/);
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("registration readiness check passes with complete CI and registration evidence", () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), "lease-safe-readiness-"));
  try {
    const gitPath = join(fakeBinDir, "git");
    writeExecutableScript(gitPath, [
      "#!/bin/sh",
      "if [ \"$1\" = \"status\" ] && [ \"$2\" = \"--porcelain\" ]; then",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"HEAD\" ]; then",
      "  echo submitted-head",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"ls-remote\" ] && [ \"$2\" = \"--heads\" ]; then",
      "  echo 'submitted-head\trefs/heads/main'",
      "  exit 0",
      "fi",
      "echo \"unexpected git call: $*\" >&2",
      "exit 2"
    ]);

    const ghPath = join(fakeBinDir, "gh");
    writeExecutableScript(ghPath, [
      "#!/bin/sh",
      "workflow=''",
      "previous=''",
      "for arg in \"$@\"; do",
      "  if [ \"$previous\" = \"--workflow\" ]; then",
      "    workflow=\"$arg\"",
      "  fi",
      "  previous=\"$arg\"",
      "done",
      "if [ \"$1\" = \"secret\" ] && [ \"$2\" = \"list\" ]; then",
      "  printf '%s\\n' 'DATA_GO_KR_SERVICE_KEY 2026-07-02T00:00:00Z' 'MCP_AUTH_TOKEN 2026-07-02T00:00:00Z'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"list\" ] && [ \"$workflow\" = \"CI\" ]; then",
      "  printf '%s\\n' '[{\"databaseId\":301,\"conclusion\":\"success\",\"status\":\"completed\",\"headSha\":\"submitted-head\",\"url\":\"https://example.test/ci\"}]'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"list\" ] && [ \"$workflow\" = \"Registration Preflight\" ]; then",
      "  printf '%s\\n' '[{\"databaseId\":401,\"conclusion\":\"success\",\"status\":\"completed\",\"headSha\":\"submitted-head\",\"url\":\"https://example.test/registration\"}]'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"list\" ] && [ \"$workflow\" = \"Publish Image\" ]; then",
      "  printf '%s\\n' '[{\"databaseId\":501,\"conclusion\":\"success\",\"status\":\"completed\",\"headSha\":\"submitted-head\",\"url\":\"https://example.test/publish\"}]'",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"view\" ] && [ \"$3\" = \"301\" ]; then",
      `  printf '%s\\n' '${workflowJobsJson([
        {
          name: "Quality Gate",
          conclusion: "success",
          steps: REQUIRED_CI_QUALITY_GATE_STEP_NAMES.map(successfulWorkflowStep)
        }
      ])}'`,
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"view\" ] && [ \"$3\" = \"401\" ]; then",
      `  printf '%s\\n' '${workflowJobsJson([
        {
          name: "Registration Evidence",
          conclusion: "success",
          steps: REQUIRED_REGISTRATION_EVIDENCE_STEP_NAMES.map(successfulWorkflowStep)
        }
      ])}'`,
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"run\" ] && [ \"$2\" = \"view\" ] && [ \"$3\" = \"501\" ]; then",
      `  printf '%s\\n' '${workflowJobsJson([
        {
          name: "Publish GHCR Image",
          conclusion: "success",
          steps: REQUIRED_PUBLISH_IMAGE_STEP_NAMES.map(successfulWorkflowStep)
        }
      ])}'`,
      "  exit 0",
      "fi",
      "echo \"unexpected gh call: $*\" >&2",
      "exit 3"
    ]);

    const result = runRegistrationReadinessCheck({
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "hjongc/lease-safe-mcp",
      REGISTRATION_READY_BRANCH: "main"
    });

    assert.equal(result.status, 0);
    assert.equal(processStderr(result), "");
    assert.match(processStdout(result), /registration_readiness=ok repo=hjongc\/lease-safe-mcp branch=main head_sha=submitted-head/);
    assert.match(processStdout(result), /github_secrets=DATA_GO_KR_SERVICE_KEY,MCP_AUTH_TOKEN status=present repo=hjongc\/lease-safe-mcp/);
    assert.match(processStdout(result), /ci_run=https:\/\/example\.test\/ci/);
    assert.match(processStdout(result), /registration_preflight_run=https:\/\/example\.test\/registration/);
    assert.match(processStdout(result), /publish_image_run=https:\/\/example\.test\/publish/);
  } finally {
    rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test("registration preflight env check rejects bad demo inputs before install", () => {
  const badLawd = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_LAWD_CD: "1111" });
  assert.notEqual(badLawd.status, 0);
  assert.match(processStderr(badLawd), /PUBLIC_DATA_SMOKE_LAWD_CD must be exactly 5 digits/);

  const zeroLawd = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_LAWD_CD: "00000" });
  assert.notEqual(zeroLawd.status, 0);
  assert.match(processStderr(zeroLawd), /PUBLIC_DATA_SMOKE_LAWD_CD must not be 00000/);

  const badDealMonth = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_DEAL_YMD: "202613" });
  assert.notEqual(badDealMonth.status, 0);
  assert.match(processStderr(badDealMonth), /PUBLIC_DATA_SMOKE_DEAL_YMD must use YYYYMM format/);

  const futureDealMonth = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_DEAL_YMD: FUTURE_DEAL_YMD });
  assert.notEqual(futureDealMonth.status, 0);
  assert.match(processStderr(futureDealMonth), /PUBLIC_DATA_SMOKE_DEAL_YMD must not be in the future/);

  const badDeposit = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_DEPOSIT_MANWON: "3e4" });
  assert.notEqual(badDeposit.status, 0);
  assert.match(processStderr(badDeposit), /PUBLIC_DATA_SMOKE_DEPOSIT_MANWON must be a plain positive integer/);

  const narrowedHousingTypes = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_HOUSING_TYPES: "apartment,rowhouse" });
  assert.notEqual(narrowedHousingTypes.status, 0);
  assert.match(processStderr(narrowedHousingTypes), /PUBLIC_DATA_SMOKE_HOUSING_TYPES must include all supported housing types/);

  const blankHousingTypes = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_HOUSING_TYPES: " " });
  assert.notEqual(blankHousingTypes.status, 0);
  assert.match(processStderr(blankHousingTypes), /PUBLIC_DATA_SMOKE_HOUSING_TYPES must include at least one supported housing type/);

  const emptyHousingTypeSegment = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_HOUSING_TYPES: "apartment,rowhouse,single_multi,officetel," });
  assert.notEqual(emptyHousingTypeSegment.status, 0);
  assert.match(processStderr(emptyHousingTypeSegment), /PUBLIC_DATA_SMOKE_HOUSING_TYPES must not include empty comma-separated entries/);

  const invalidRegion = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_REGION: "서울 관악구\n강남구" });
  assert.notEqual(invalidRegion.status, 0);
  assert.match(processStderr(invalidRegion), /PUBLIC_DATA_SMOKE_REGION must not include control characters/);

  for (const region of [
    "[서울 관악구](https://evil.example/track)",
    "![서울 관악구](https://evil.example/track.png)",
    "<b>서울 관악구</b>"
  ]) {
    const markupRegion = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_REGION: region });
    assert.notEqual(markupRegion.status, 0);
    assert.match(processStderr(markupRegion), /PUBLIC_DATA_SMOKE_REGION must not include Markdown links, images, HTML tags, or angle brackets/);
  }

  for (const region of [
    "서울 관악구 010 1234 5678",
    "서울 관악구 user@example.com",
    "서울 관악구 https://evil.example/track",
    "서울 관악구 900101-5123456",
    "서울 관악구 송금 계좌 110-123-456789",
    "서울 관악구 101동 202호"
  ]) {
    const personalRegion = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, { PUBLIC_DATA_SMOKE_REGION: region });
    assert.notEqual(personalRegion.status, 0);
    assert.match(processStderr(personalRegion), /PUBLIC_DATA_SMOKE_REGION must not include personal identifiers/);
  }

  const validInputs = runRegistrationEnvCheck(VALID_TEST_SERVICE_KEY, {
    PUBLIC_DATA_SMOKE_REGION: "서울 관악구",
    PUBLIC_DATA_SMOKE_LAWD_CD: "11620",
    PUBLIC_DATA_SMOKE_DEAL_YMD: "202605",
    PUBLIC_DATA_SMOKE_DEPOSIT_MANWON: "30000",
    PUBLIC_DATA_SMOKE_HOUSING_TYPES: "apartment,rowhouse,single_multi,officetel"
  });
  assert.equal(validInputs.status, 0);
  assert.equal(processStderr(validInputs), "");
});

test("preflight scripts reject unsafe Docker image references before running Docker", () => {
  const previousPreflightTag = process.env.PREFLIGHT_DOCKER_TAG;
  const previousDockerSmokeImage = process.env.DOCKER_SMOKE_IMAGE;
  try {
    delete process.env.PREFLIGHT_DOCKER_TAG;
    delete process.env.DOCKER_SMOKE_IMAGE;
    assert.equal(dockerImageReferenceFromEnv("PREFLIGHT_DOCKER_TAG", undefined, "lease-safe-mcp-preflight"), "lease-safe-mcp-preflight");

    process.env.PREFLIGHT_DOCKER_TAG = "lease-safe-mcp-preflight:local";
    assert.equal(dockerImageReferenceFromEnv("PREFLIGHT_DOCKER_TAG", undefined, "lease-safe-mcp-preflight"), "lease-safe-mcp-preflight:local");

    process.env.PREFLIGHT_DOCKER_TAG = " ";
    assert.throws(
      () => dockerImageReferenceFromEnv("PREFLIGHT_DOCKER_TAG", undefined, "lease-safe-mcp-preflight"),
      /PREFLIGHT_DOCKER_TAG must be a plain Docker image reference/
    );

    delete process.env.PREFLIGHT_DOCKER_TAG;
    process.env.DOCKER_SMOKE_IMAGE = " ";
    assert.throws(
      () => dockerImageReferenceFromEnv("DOCKER_SMOKE_IMAGE", "PREFLIGHT_DOCKER_TAG", "lease-safe-mcp-preflight"),
      /DOCKER_SMOKE_IMAGE must be a plain Docker image reference/
    );
  } finally {
    if (previousPreflightTag === undefined) {
      delete process.env.PREFLIGHT_DOCKER_TAG;
    } else {
      process.env.PREFLIGHT_DOCKER_TAG = previousPreflightTag;
    }
    if (previousDockerSmokeImage === undefined) {
      delete process.env.DOCKER_SMOKE_IMAGE;
    } else {
      process.env.DOCKER_SMOKE_IMAGE = previousDockerSmokeImage;
    }
  }

  const releasePreflight = runBuiltScript("dist/scripts/release-preflight.js", {
    PREFLIGHT_DOCKER_TAG: "lease-safe\nspoof"
  });
  assert.notEqual(releasePreflight.status, 0);
  assert.match(processStderr(releasePreflight), /PREFLIGHT_DOCKER_TAG must be a plain Docker image reference/);

  const dockerSmoke = runBuiltScript("dist/scripts/docker-smoke.js", {
    DOCKER_SMOKE_IMAGE: "lease-safe;rm"
  });
  assert.notEqual(dockerSmoke.status, 0);
  assert.match(processStderr(dockerSmoke), /DOCKER_SMOKE_IMAGE must be a plain Docker image reference/);
});

test("remote PlayMCP smoke rejects unsafe endpoint config before network calls", () => {
  const missingEndpoint = runBuiltScript("dist/scripts/remote-smoke.js", {
    MCP_ENDPOINT: "",
    MCP_AUTH_TOKEN: "fixture-token-ok"
  });
  assert.notEqual(missingEndpoint.status, 0);
  assert.match(processStderr(missingEndpoint), /MCP_ENDPOINT is required for remote PlayMCP smoke/);

  const insecureEndpoint = runBuiltScript("dist/scripts/remote-smoke.js", {
    MCP_ENDPOINT: "http://example.test/mcp",
    MCP_AUTH_TOKEN: "fixture-token-ok"
  });
  assert.notEqual(insecureEndpoint.status, 0);
  assert.match(processStderr(insecureEndpoint), /MCP_ENDPOINT must be an HTTPS PlayMCP endpoint/);

  const endpointWithQuery = runBuiltScript("dist/scripts/remote-smoke.js", {
    MCP_ENDPOINT: "https://example.test/mcp?token=leak",
    MCP_AUTH_TOKEN: "fixture-token-ok"
  });
  assert.notEqual(endpointWithQuery.status, 0);
  assert.match(processStderr(endpointWithQuery), /must not include userinfo, query strings, or fragments/);

  const wrongPath = runBuiltScript("dist/scripts/remote-smoke.js", {
    MCP_ENDPOINT: "https://example.test/api",
    MCP_AUTH_TOKEN: "fixture-token-ok"
  });
  assert.notEqual(wrongPath.status, 0);
  assert.match(processStderr(wrongPath), /must point to the Streamable HTTP \/mcp path/);

  const weakToken = runBuiltScript("dist/scripts/remote-smoke.js", {
    MCP_ENDPOINT: "https://example.test/mcp",
    MCP_AUTH_TOKEN: "too-short"
  });
  assert.notEqual(weakToken.status, 0);
  assert.match(processStderr(weakToken), /MCP_AUTH_TOKEN must be a production bearer token without whitespace/);
});

test("public-data smoke requires positive live sample counts", () => {
  assert.equal(positiveSampleCount("신고 표본 수: 1,234", "rent", /신고 표본 수:\s*([\d,]+)/), 1234);
  assert.equal(positiveOfficialTotalCount("공식 전체 신고 건수: 2,345", "rent", /공식 전체 신고 건수:\s*([\d,]+)/), 2345);
  assert.equal(assessmentRiskEvidenceLevel("종합 위험도: 매우 높음 (90/100)", "assessment"), "very_high");
  assert.equal(assessmentRiskEvidenceLevel("종합 위험도: 높음 (60/100)", "assessment"), "high");
  assert.equal(assessmentRiskEvidenceLevel("종합 위험도: 주의 (30/100)", "assessment"), "caution");
  assert.equal(assessmentRiskEvidenceLevel("종합 위험도: 보통 (10/100)", "assessment"), "moderate");
  assert.throws(
    () => positiveSampleCount("매매 표본 수: 0", "sale", /매매 표본 수:\s*([\d,]+)/),
    /returned 0 samples/
  );
  assert.throws(
    () => positiveOfficialTotalCount("공식 전체 신고 건수: 0", "rent", /공식 전체 신고 건수:\s*([\d,]+)/),
    /official total count 0/
  );
  assert.throws(
    () => positiveSampleCount("매매가 대비 보증금 비율: 계산 불가", "sale", /매매 표본 수:\s*([\d,]+)/),
    /parseable sample count/
  );
  assert.throws(
    () => positiveOfficialTotalCount("신고 표본 수: 12", "rent", /공식 전체 신고 건수:\s*([\d,]+)/),
    /parseable official total count/
  );
  assert.throws(
    () => assessmentRiskEvidenceLevel("종합 위험도: 계산 불가", "assessment"),
    /parseable assessment risk level/
  );
});

test("public-data smoke requires a positive demo deposit", () => {
  const previousDeposit = process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON;
  try {
    delete process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON;
    assert.equal(publicDataSmokeDepositManwon(), 30000);

    process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = "42000";
    assert.equal(publicDataSmokeDepositManwon(), 42000);

    process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = "0";
    assert.throws(() => publicDataSmokeDepositManwon(), /positive integer/);

    process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = "-1";
    assert.throws(() => publicDataSmokeDepositManwon(), /positive integer/);

    process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = "30000.5";
    assert.throws(() => publicDataSmokeDepositManwon(), /positive integer/);

    process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = "3e4";
    assert.throws(() => publicDataSmokeDepositManwon(), /plain positive integer/);

    process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = `${MONEY_INPUT_LIMITS.depositManwon + 1}`;
    assert.throws(() => publicDataSmokeDepositManwon(), /no greater than/);
  } finally {
    if (previousDeposit === undefined) {
      delete process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON;
    } else {
      process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = previousDeposit;
    }
  }
});

test("public-data smoke validates demo region before API calls", () => {
  const previousRegion = process.env.PUBLIC_DATA_SMOKE_REGION;
  try {
    delete process.env.PUBLIC_DATA_SMOKE_REGION;
    assert.equal(publicDataSmokeRegion(), "서울 관악구");

    process.env.PUBLIC_DATA_SMOKE_REGION = " 서울 종로구 ";
    assert.equal(publicDataSmokeRegion(), "서울 종로구");

    process.env.PUBLIC_DATA_SMOKE_REGION = " ";
    assert.throws(() => publicDataSmokeRegion(), /PUBLIC_DATA_SMOKE_REGION must include at least 2 meaningful characters/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구\n강남구";
    assert.throws(() => publicDataSmokeRegion(), /must not include control characters, line breaks, tabs, or Markdown backticks/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 `관악구`";
    assert.throws(() => publicDataSmokeRegion(), /must not include control characters, line breaks, tabs, or Markdown backticks/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "[서울 관악구](https://evil.example/track)";
    assert.throws(() => publicDataSmokeRegion(), /must not include Markdown links, images, HTML tags, or angle brackets/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "<b>서울 관악구<\/b>";
    assert.throws(() => publicDataSmokeRegion(), /must not include Markdown links, images, HTML tags, or angle brackets/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구 010 1234 5678";
    assert.throws(() => publicDataSmokeRegion(), /must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구 user@example.com";
    assert.throws(() => publicDataSmokeRegion(), /must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구 https://evil.example/track";
    assert.throws(() => publicDataSmokeRegion(), /must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구 900101-5123456";
    assert.throws(() => publicDataSmokeRegion(), /must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구 송금 계좌 110-123-456789";
    assert.throws(() => publicDataSmokeRegion(), /must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구 101동 202호";
    assert.throws(() => publicDataSmokeRegion(), /must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구 ".repeat(12);
    assert.throws(() => publicDataSmokeRegion(), /PUBLIC_DATA_SMOKE_REGION must be 80 characters or fewer/);
  } finally {
    if (previousRegion === undefined) {
      delete process.env.PUBLIC_DATA_SMOKE_REGION;
    } else {
      process.env.PUBLIC_DATA_SMOKE_REGION = previousRegion;
    }
  }
});

test("public-data smoke validates configured region query parameters before API calls", () => {
  const previousLawdCd = process.env.PUBLIC_DATA_SMOKE_LAWD_CD;
  const previousDealYmd = process.env.PUBLIC_DATA_SMOKE_DEAL_YMD;
  try {
    delete process.env.PUBLIC_DATA_SMOKE_LAWD_CD;
    delete process.env.PUBLIC_DATA_SMOKE_DEAL_YMD;
    assert.equal(publicDataSmokeLawdCd(), "11620");
    assert.equal(publicDataSmokeDealYmd(), "202605");

    process.env.PUBLIC_DATA_SMOKE_LAWD_CD = "11110";
    process.env.PUBLIC_DATA_SMOKE_DEAL_YMD = "202601";
    assert.equal(publicDataSmokeLawdCd(), "11110");
    assert.equal(publicDataSmokeDealYmd(), "202601");

    process.env.PUBLIC_DATA_SMOKE_LAWD_CD = "1111";
    assert.throws(() => publicDataSmokeLawdCd(), /PUBLIC_DATA_SMOKE_LAWD_CD must be exactly 5 digits/);

    process.env.PUBLIC_DATA_SMOKE_LAWD_CD = "00000";
    assert.throws(() => publicDataSmokeLawdCd(), /must not be 00000/);

    process.env.PUBLIC_DATA_SMOKE_LAWD_CD = "11110";
    process.env.PUBLIC_DATA_SMOKE_DEAL_YMD = "202613";
    assert.throws(() => publicDataSmokeDealYmd(), /PUBLIC_DATA_SMOKE_DEAL_YMD must use YYYYMM format/);

    process.env.PUBLIC_DATA_SMOKE_DEAL_YMD = FUTURE_DEAL_YMD;
    assert.throws(() => publicDataSmokeDealYmd(), /must not be in the future/);
  } finally {
    if (previousLawdCd === undefined) {
      delete process.env.PUBLIC_DATA_SMOKE_LAWD_CD;
    } else {
      process.env.PUBLIC_DATA_SMOKE_LAWD_CD = previousLawdCd;
    }
    if (previousDealYmd === undefined) {
      delete process.env.PUBLIC_DATA_SMOKE_DEAL_YMD;
    } else {
      process.env.PUBLIC_DATA_SMOKE_DEAL_YMD = previousDealYmd;
    }
  }
});

test("public-data smoke validates requested housing types", () => {
  const previousHousingTypes = process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES;
  const previousRequireLivePublicData = process.env.REQUIRE_LIVE_PUBLIC_DATA;
  try {
    delete process.env.REQUIRE_LIVE_PUBLIC_DATA;
    delete process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES;
    assert.deepEqual(publicDataSmokeHousingTypes(), ["apartment", "rowhouse", "single_multi", "officetel"]);

    process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = "apartment,rowhouse";
    assert.deepEqual(publicDataSmokeHousingTypes(), ["apartment", "rowhouse"]);

    process.env.REQUIRE_LIVE_PUBLIC_DATA = "1";
    assert.throws(() => publicDataSmokeHousingTypes(), /must include all supported housing types in registration preflight/);

    process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = "apartment,rowhouse,single_multi,officetel";
    assert.deepEqual(publicDataSmokeHousingTypes(), ["apartment", "rowhouse", "single_multi", "officetel"]);
    delete process.env.REQUIRE_LIVE_PUBLIC_DATA;

    process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = " ";
    assert.throws(() => publicDataSmokeHousingTypes(), /at least one supported housing type/);

    process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = ",";
    assert.throws(() => publicDataSmokeHousingTypes(), /empty comma-separated entries/);

    process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = "apartment,rowhouse,";
    assert.throws(() => publicDataSmokeHousingTypes(), /empty comma-separated entries/);

    process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = "apartment,apartment";
    assert.throws(() => publicDataSmokeHousingTypes(), /duplicate values/);

    process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = "apartment,condo";
    assert.throws(() => publicDataSmokeHousingTypes(), /Unsupported PUBLIC_DATA_SMOKE_HOUSING_TYPES value: condo/);
  } finally {
    if (previousHousingTypes === undefined) {
      delete process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES;
    } else {
      process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = previousHousingTypes;
    }
    if (previousRequireLivePublicData === undefined) {
      delete process.env.REQUIRE_LIVE_PUBLIC_DATA;
    } else {
      process.env.REQUIRE_LIVE_PUBLIC_DATA = previousRequireLivePublicData;
    }
  }
});

test("deal month helper identifies future official-data lookups", () => {
  assert.equal(isFutureDealYmd("202605", new Date("2026-07-01T00:00:00Z")), false);
  assert.equal(isFutureDealYmd("202608", new Date("2026-07-01T00:00:00Z")), true);
  assert.equal(isFutureDealYmd("202613", new Date("2026-07-01T00:00:00Z")), false);
  assert.equal(isFutureDealYmd("202607", new Date("2026-06-30T15:05:00Z")), false);
  assert.equal(isFutureDealYmd("202608", new Date("2026-06-30T15:05:00Z")), true);
});

test("LAWD_CD helper identifies all-zero official-data lookup codes", () => {
  assert.equal(isAllZeroLawdCd("00000"), true);
  assert.equal(isAllZeroLawdCd("11620"), false);
});

test("public-data smoke requires legal-dong proof for configured LAWD code", () => {
  const legalDongText = [
    "## 법정동 코드 확인",
    "- 서울특별시 관악구 봉천동: 법정동코드 1162010100 / LAWD_CD 11620"
  ].join("\n");

  assert.equal(assertLegalDongSmokeMatchesLawdCd(legalDongText, "11620"), "11620");
  assert.throws(
    () => assertLegalDongSmokeMatchesLawdCd(legalDongText, "11110"),
    /did not return the configured LAWD_CD 11110/
  );
  assert.throws(
    () => assertLegalDongSmokeMatchesLawdCd(legalDongText, "1162"),
    /PUBLIC_DATA_SMOKE_LAWD_CD must be exactly 5 digits/
  );
  assert.throws(
    () => assertLegalDongSmokeMatchesLawdCd(legalDongText, "00000"),
    /PUBLIC_DATA_SMOKE_LAWD_CD must not be 00000/
  );
});

test("public-data smoke config line exposes non-secret evidence inputs", () => {
  const line = publicDataSmokeConfigLine("서울 관악구", "11620", "202605", ["apartment", "rowhouse"], 30000, true);
  assert.equal(line, 'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,rowhouse deposit_manwon=30000');
  assert.doesNotMatch(line, /DATA_GO_KR_SERVICE_KEY|serviceKey|secret/i);
  assert.match(publicDataSmokeConfigLine('서울 "관악구"', "11620", "202605", ["apartment"], 30000, false), /registration_mode=false region="서울 \\"관악구\\""/);
});

test("live evidence extractor requires every public-data proof category", () => {
  const evidence = extractLivePublicDataEvidenceLines([
    "noise before evidence",
    'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,rowhouse,single_multi,officetel deposit_manwon=30000',
    "legal_dong=ok lawd_cd=11620",
    "rent_market[apartment]=ok samples=12 official_total=12",
    "rent_market[rowhouse]=ok samples=11 official_total=11",
    "rent_market[single_multi]=ok samples=10 official_total=10",
    "rent_market[officetel]=ok samples=8 official_total=8",
    "sale_market[apartment]=ok samples=9 official_total=9",
    "sale_market[rowhouse]=ok samples=7 official_total=7",
    "sale_market[single_multi]=ok samples=6 official_total=6",
    "sale_market[officetel]=ok samples=5 official_total=5",
    "lease_assessment[apartment]=ok rent_samples=12 rent_official_total=12 sale_samples=9 sale_official_total=9 risk_level=high",
    "lease_assessment[rowhouse]=ok rent_samples=11 rent_official_total=11 sale_samples=7 sale_official_total=7 risk_level=high",
    "lease_assessment[single_multi]=ok rent_samples=10 rent_official_total=10 sale_samples=6 sale_official_total=6 risk_level=high",
    "lease_assessment[officetel]=ok rent_samples=8 rent_official_total=8 sale_samples=5 sale_official_total=5 risk_level=high",
    "noise after evidence"
  ].join("\n"));

  assert.deepEqual(evidence, [
    'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,rowhouse,single_multi,officetel deposit_manwon=30000',
    "legal_dong=ok lawd_cd=11620",
    "rent_market[apartment]=ok samples=12 official_total=12",
    "rent_market[rowhouse]=ok samples=11 official_total=11",
    "rent_market[single_multi]=ok samples=10 official_total=10",
    "rent_market[officetel]=ok samples=8 official_total=8",
    "sale_market[apartment]=ok samples=9 official_total=9",
    "sale_market[rowhouse]=ok samples=7 official_total=7",
    "sale_market[single_multi]=ok samples=6 official_total=6",
    "sale_market[officetel]=ok samples=5 official_total=5",
    "lease_assessment[apartment]=ok rent_samples=12 rent_official_total=12 sale_samples=9 sale_official_total=9 risk_level=high",
    "lease_assessment[rowhouse]=ok rent_samples=11 rent_official_total=11 sale_samples=7 sale_official_total=7 risk_level=high",
    "lease_assessment[single_multi]=ok rent_samples=10 rent_official_total=10 sale_samples=6 sale_official_total=6 risk_level=high",
    "lease_assessment[officetel]=ok rent_samples=8 rent_official_total=8 sale_samples=5 sale_official_total=5 risk_level=high"
  ]);
});

test("live evidence extractor rejects empty or partial evidence", () => {
  assert.throws(
    () => extractLivePublicDataEvidenceLines("http_smoke=ok\n"),
    /No live public-data evidence lines/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,rowhouse,single_multi,officetel deposit_manwon=30000',
      "legal_dong=ok lawd_cd=11620",
      "rent_market[apartment]=ok samples=12 official_total=12"
    ].join("\n")),
    /Missing required live public-data evidence categories: sale_market, lease_assessment/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      'public_data_smoke_config registration_mode=false region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment deposit_manwon=30000',
      "legal_dong=ok lawd_cd=11620",
      "rent_market[apartment]=ok samples=12 official_total=12",
      "sale_market[apartment]=ok samples=9 official_total=9",
      "lease_assessment[apartment]=ok rent_samples=12 rent_official_total=12 sale_samples=9 sale_official_total=9 risk_level=high"
    ].join("\n")),
    /registration_mode=true/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,rowhouse,single_multi,officetel deposit_manwon=30000',
      "legal_dong=ok lawd_cd=11620",
      "rent_market[apartment]=ok samples=12 official_total=12",
      "rent_market[rowhouse]=ok samples=11 official_total=11",
      "rent_market[single_multi]=ok samples=10 official_total=10",
      "rent_market[officetel]=ok samples=8 official_total=8",
      "sale_market[apartment]=ok samples=9 official_total=9",
      "sale_market[single_multi]=ok samples=6 official_total=6",
      "sale_market[officetel]=ok samples=5 official_total=5",
      "lease_assessment[apartment]=ok rent_samples=12 rent_official_total=12 sale_samples=9 sale_official_total=9 risk_level=high",
      "lease_assessment[rowhouse]=ok rent_samples=11 rent_official_total=11 sale_samples=7 sale_official_total=7 risk_level=high",
      "lease_assessment[single_multi]=ok rent_samples=10 rent_official_total=10 sale_samples=6 sale_official_total=6 risk_level=high",
      "lease_assessment[officetel]=ok rent_samples=8 rent_official_total=8 sale_samples=5 sale_official_total=5 risk_level=high"
    ].join("\n")),
    /Missing live public-data evidence lines by housing type: sale_market\[rowhouse\]/
  );
});

test("live evidence extractor rejects malformed housing type coverage", () => {
  const validProofLines = [
    "legal_dong=ok lawd_cd=11620",
    "rent_market[apartment]=ok samples=12 official_total=12",
    "rent_market[rowhouse]=ok samples=11 official_total=11",
    "rent_market[single_multi]=ok samples=10 official_total=10",
    "rent_market[officetel]=ok samples=8 official_total=8",
    "sale_market[apartment]=ok samples=9 official_total=9",
    "sale_market[rowhouse]=ok samples=7 official_total=7",
    "sale_market[single_multi]=ok samples=6 official_total=6",
    "sale_market[officetel]=ok samples=5 official_total=5",
    "lease_assessment[apartment]=ok rent_samples=12 rent_official_total=12 sale_samples=9 sale_official_total=9 risk_level=high",
    "lease_assessment[rowhouse]=ok rent_samples=11 rent_official_total=11 sale_samples=7 sale_official_total=7 risk_level=high",
    "lease_assessment[single_multi]=ok rent_samples=10 rent_official_total=10 sale_samples=6 sale_official_total=6 risk_level=high",
    "lease_assessment[officetel]=ok rent_samples=8 rent_official_total=8 sale_samples=5 sale_official_total=5 risk_level=high"
  ];

  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,apartment,rowhouse,single_multi,officetel deposit_manwon=30000',
      ...validProofLines
    ].join("\n")),
    /Duplicate live public-data evidence housing types: apartment/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,rowhouse,single_multi,officetel,villa deposit_manwon=30000',
      ...validProofLines
    ].join("\n")),
    /Unsupported live public-data evidence housing types: villa/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,rowhouse,single_multi deposit_manwon=30000',
      ...validProofLines
    ].join("\n")),
    /Missing supported live public-data evidence housing types: officetel/
  );
});

test("live evidence extractor rejects non-positive evidence sample counts", () => {
  const configLine = 'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,rowhouse,single_multi,officetel deposit_manwon=30000';
  const validProofLines = [
    "legal_dong=ok lawd_cd=11620",
    "rent_market[apartment]=ok samples=12 official_total=12",
    "rent_market[rowhouse]=ok samples=11 official_total=11",
    "rent_market[single_multi]=ok samples=10 official_total=10",
    "rent_market[officetel]=ok samples=8 official_total=8",
    "sale_market[apartment]=ok samples=9 official_total=9",
    "sale_market[rowhouse]=ok samples=7 official_total=7",
    "sale_market[single_multi]=ok samples=6 official_total=6",
    "sale_market[officetel]=ok samples=5 official_total=5",
    "lease_assessment[apartment]=ok rent_samples=12 rent_official_total=12 sale_samples=9 sale_official_total=9 risk_level=high",
    "lease_assessment[rowhouse]=ok rent_samples=11 rent_official_total=11 sale_samples=7 sale_official_total=7 risk_level=high",
    "lease_assessment[single_multi]=ok rent_samples=10 rent_official_total=10 sale_samples=6 sale_official_total=6 risk_level=high",
    "lease_assessment[officetel]=ok rent_samples=8 rent_official_total=8 sale_samples=5 sale_official_total=5 risk_level=high"
  ];

  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines.map(line => line === "rent_market[apartment]=ok samples=12 official_total=12" ? "rent_market[apartment]=ok samples=0 official_total=12" : line)
    ].join("\n")),
    /evidence count for rent_market must be positive/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines.map(line => line === "lease_assessment[rowhouse]=ok rent_samples=11 rent_official_total=11 sale_samples=7 sale_official_total=7 risk_level=high" ? "lease_assessment[rowhouse]=ok rent_samples=11 rent_official_total=11 sale_samples=0 sale_official_total=7 risk_level=high" : line)
    ].join("\n")),
    /evidence count for lease_assessment sale must be positive/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines.map(line => line === "rent_market[rowhouse]=ok samples=11 official_total=11" ? "rent_market[rowhouse]=ok samples=11 official_total=0" : line)
    ].join("\n")),
    /evidence count for rent_market official_total must be positive/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines.map(line => line === "sale_market[apartment]=ok samples=9 official_total=9" ? "sale_market[apartment]=ok samples=9" : line)
    ].join("\n")),
    /Malformed live public-data housing evidence line/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines.map(line => line === "lease_assessment[officetel]=ok rent_samples=8 rent_official_total=8 sale_samples=5 sale_official_total=5 risk_level=high" ? "lease_assessment[officetel]=ok rent_samples=8 rent_official_total=7 sale_samples=5 sale_official_total=5 risk_level=high" : line)
    ].join("\n")),
    /official_total for lease_assessment rent must be greater than or equal to samples/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines.map(line => line === "lease_assessment[apartment]=ok rent_samples=12 rent_official_total=12 sale_samples=9 sale_official_total=9 risk_level=high" ? "lease_assessment[apartment]=ok rent_samples=12 rent_official_total=12 sale_samples=9 sale_official_total=9 risk_level=moderate" : line)
    ].join("\n")),
    /Malformed live public-data housing evidence line/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines.map(line => line === "sale_market[officetel]=ok samples=5 official_total=5" ? "sale_market[officetel]=ok" : line)
    ].join("\n")),
    /Malformed live public-data housing evidence line/
  );
});

test("live evidence extractor rejects unexpected or duplicate evidence lines", () => {
  const configLine = 'public_data_smoke_config registration_mode=true region="서울 관악구" lawd_cd=11620 deal_ymd=202605 housing_types=apartment,rowhouse,single_multi,officetel deposit_manwon=30000';
  const validProofLines = [
    "legal_dong=ok lawd_cd=11620",
    "rent_market[apartment]=ok samples=12 official_total=12",
    "rent_market[rowhouse]=ok samples=11 official_total=11",
    "rent_market[single_multi]=ok samples=10 official_total=10",
    "rent_market[officetel]=ok samples=8 official_total=8",
    "sale_market[apartment]=ok samples=9 official_total=9",
    "sale_market[rowhouse]=ok samples=7 official_total=7",
    "sale_market[single_multi]=ok samples=6 official_total=6",
    "sale_market[officetel]=ok samples=5 official_total=5",
    "lease_assessment[apartment]=ok rent_samples=12 rent_official_total=12 sale_samples=9 sale_official_total=9 risk_level=high",
    "lease_assessment[rowhouse]=ok rent_samples=11 rent_official_total=11 sale_samples=7 sale_official_total=7 risk_level=high",
    "lease_assessment[single_multi]=ok rent_samples=10 rent_official_total=10 sale_samples=6 sale_official_total=6 risk_level=high",
    "lease_assessment[officetel]=ok rent_samples=8 rent_official_total=8 sale_samples=5 sale_official_total=5 risk_level=high"
  ];

  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines,
      "rent_market[villa]=ok samples=3 official_total=3"
    ].join("\n")),
    /Unexpected live public-data evidence housing type: rent_market\[villa\]/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines,
      "rent_market[apartment]=ok samples=13 official_total=13"
    ].join("\n")),
    /Duplicate live public-data evidence line: rent_market\[apartment\]/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      configLine,
      ...validProofLines
    ].join("\n")),
    /exactly one public_data_smoke_config/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines,
      "legal_dong=ok lawd_cd=11620"
    ].join("\n")),
    /exactly one legal_dong=ok/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      "public_data_smoke_configbad registration_mode=true region=\"서울 관악구\"",
      configLine,
      ...validProofLines
    ].join("\n")),
    /Malformed live public-data smoke config evidence line/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      `${configLine} extra`,
      ...validProofLines
    ].join("\n")),
    /Malformed live public-data smoke config evidence line/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine.replace("lawd_cd=11620", "lawd_cd=00000"),
      ...validProofLines
    ].join("\n")),
    /lawd_cd must not be 00000/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines.map(line => line === "legal_dong=ok lawd_cd=11620" ? "legal_dong=ok lawd_cd=00000" : line)
    ].join("\n")),
    /legal-dong evidence lawd_cd must not be 00000/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines.map(line => line === "legal_dong=ok lawd_cd=11620" ? "legal_dong=ok lawd_cd=11110" : line)
    ].join("\n")),
    /legal-dong evidence lawd_cd 11110 must match smoke config lawd_cd 11620/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine.replace("housing_types=apartment,rowhouse,single_multi,officetel", "housing_types=apartment,,rowhouse,single_multi,officetel"),
      ...validProofLines
    ].join("\n")),
    /Malformed live public-data smoke config evidence line/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines,
      "legal_dong=ok extra"
    ].join("\n")),
    /Malformed live public-data legal-dong evidence line/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines,
      "rent_market[apartment] samples=13"
    ].join("\n")),
    /Malformed live public-data housing evidence line/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines,
      "sale_market[rowhouse]=ok samples=7 official_total=7 extra"
    ].join("\n")),
    /Malformed live public-data housing evidence line/
  );
  assert.throws(
    () => extractLivePublicDataEvidenceLines([
      configLine,
      ...validProofLines,
      "lease_assessment[rowhouse]=ok rent_samples=11 rent_official_total=11 sale_samples=7 sale_official_total=7 extra"
    ].join("\n")),
    /Malformed live public-data housing evidence line/
  );
});

test("legal dong helper calls official API and exposes LAWD code", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY_ENCODED;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.protocol, "http:");
      assert.equal(url.searchParams.get("locatadd_nm"), "관악구");
      assert.equal(url.searchParams.get("type"), "json");
      assert.equal(url.searchParams.get("ServiceKey"), VALID_TEST_SERVICE_KEY);
      return new Response(JSON.stringify({
        StanReginCd: [
          {
            head: [
              { totalCount: 1 },
              { RESULT: { resultCode: "INFO-000", resultMsg: "NORMAL SERVICE" } }
            ]
          },
          {
            row: [
              {
                region_cd: "1162010100",
                locatadd_nm: "서울특별시 관악구 봉천동"
              }
            ]
          }
        ]
      }));
    };

    const text = await resolveLegalDongCode({ region: "관악구" });
    assert.match(text, /11620/);
    assert.match(text, /1162010100/);
    assert.match(text, /getStanReginCdList/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("legal dong helper normalizes official region text fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(JSON.stringify({
      StanReginCd: [
        {
          head: [
            { totalCount: 1 },
            { RESULT: { resultCode: "INFO-000", resultMsg: "NORMAL SERVICE" } }
          ]
        },
        {
          row: [
            {
              region_cd: "1162010100",
              locatadd_nm: "서울특별시 관악구\n- 잘못된 항목"
            }
          ]
        }
      ]
    }));

    const text = await resolveLegalDongCode({ region: "관악구" });
    assert.match(text, /서울특별시 관악구 - 잘못된 항목/);
    assert.doesNotMatch(text, /\n- 잘못된 항목/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("legal dong helper fails clearly without public-data key", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  try {
    delete process.env[PUBLIC_DATA_KEY_ENV_NAME];

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      /DATA_GO_KR_SERVICE_KEY is required/
    );
  } finally {
    if (previousKey !== undefined) process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
  }
});

test("legal dong helper rejects unrecognized public-data JSON payloads", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(JSON.stringify({ message: "temporarily unavailable" }));

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      /행정표준코드 법정동코드 API returned unrecognized JSON payload/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("legal dong helper rejects JSON without official result code", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(JSON.stringify({
      StanReginCd: [
        {
          row: []
        }
      ]
    }));

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      /행정표준코드 법정동코드 API returned JSON without RESULT\.resultCode/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("legal dong helper redacts service keys from official error messages", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY_ENCODED;
    globalThis.fetch = async () => new Response(JSON.stringify({
      StanReginCd: [
        {
          head: [
            { totalCount: 0 },
            {
              RESULT: {
                resultCode: "ERROR-500",
                resultMsg: `approval failed for ${VALID_TEST_SERVICE_KEY_ENCODED} and ${VALID_TEST_SERVICE_KEY}`
              }
            }
          ]
        },
        {
          row: []
        }
      ]
    }));

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /ERROR-500/);
        assert.match(error.message, /\[DATA_GO_KR_SERVICE_KEY 생략\]/);
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("legal dong helper rejects malformed official row fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(JSON.stringify({
      StanReginCd: [
        {
          head: [
            { totalCount: 1 },
            { RESULT: { resultCode: "INFO-000", resultMsg: "NORMAL SERVICE" } }
          ]
        },
        {
          row: [
            {
              region_cd: "11620",
              locatadd_nm: "서울특별시 관악구 봉천동"
            }
          ]
        }
      ]
    }));

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      /행정표준코드 법정동코드 API returned malformed row fields/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("legal dong helper rejects all-zero official row LAWD codes", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(JSON.stringify({
      StanReginCd: [
        {
          head: [
            { totalCount: 1 },
            { RESULT: { resultCode: "INFO-000", resultMsg: "NORMAL SERVICE" } }
          ]
        },
        {
          row: [
            {
              region_cd: "0000000000",
              locatadd_nm: "잘못된 법정동"
            }
          ]
        }
      ]
    }));

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      /행정표준코드 법정동코드 API returned malformed row fields/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("legal dong helper preserves recognized empty-result payloads", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(JSON.stringify({
      StanReginCd: [
        {
          head: [
            { totalCount: 0 },
            { RESULT: { resultCode: "INFO-000", resultMsg: "NORMAL SERVICE" } }
          ]
        },
        {
          row: []
        }
      ]
    }));

    const text = await resolveLegalDongCode({ region: "관악구" });
    assert.match(text, /후보를 찾지 못했습니다/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data key validation rejects placeholders and malformed encoding before fetch", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  const placeholderKey = ["your", "data", "go", "kr", "service", "key"].join("-");
  try {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called for invalid public-data keys");
    };

    process.env[PUBLIC_DATA_KEY_ENV_NAME] = placeholderKey;
    assert.throws(() => dataGoKrServiceKey(), /not a placeholder/);
    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      /not a placeholder/
    );

    process.env[PUBLIC_DATA_KEY_ENV_NAME] = "short-key";
    assert.throws(() => dataGoKrServiceKey(), /must look like a real data\.go\.kr service key/);
    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /must look like a real data\.go\.kr service key/
    );

    process.env[PUBLIC_DATA_KEY_ENV_NAME] = "bad%ZZkey";
    assert.throws(() => dataGoKrServiceKey(), /valid percent-encoded or decoded/);
    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /valid percent-encoded or decoded/
    );

    process.env[PUBLIC_DATA_KEY_ENV_NAME] = ` ${VALID_TEST_SERVICE_KEY}`;
    assert.throws(() => dataGoKrServiceKey(), /DATA_GO_KR_SERVICE_KEY must not contain whitespace/);

    process.env[PUBLIC_DATA_KEY_ENV_NAME] = encodeURIComponent(`${VALID_TEST_SERVICE_KEY} `);
    assert.throws(() => dataGoKrServiceKey(), /DATA_GO_KR_SERVICE_KEY must not contain whitespace/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("legal dong helper fails fast on empty or placeholder regions", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called for invalid region values");
    };

    await assert.rejects(
      resolveLegalDongCode({ region: "" }),
      /region must include at least 2 meaningful characters/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "unknown" }),
      /region must include at least 2 meaningful characters/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 관악구\n강남구" }),
      /region must not include control characters, line breaks, tabs, or Markdown backticks/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 `관악구`" }),
      /region must not include control characters, line breaks, tabs, or Markdown backticks/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "[서울 관악구](https://evil.example/track)" }),
      /region must not include Markdown links, images, HTML tags, or angle brackets/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "<b>서울 관악구<\/b>" }),
      /region must not include Markdown links, images, HTML tags, or angle brackets/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 관악구 010-1234-5678" }),
      /region must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 관악구 user@example.com" }),
      /region must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 관악구 https://evil.example/track" }),
      /region must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 관악구 900101-5123456" }),
      /region must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 관악구 계약금 계좌는 110-123-456789" }),
      /region must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 관악구 101동 202호" }),
      /region must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 관악구 ".repeat(12) }),
      /region must be 80 characters or fewer/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("market API helpers fail fast on invalid public-data query parameters", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called for invalid query parameters");
    };

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "1162", dealYmd: "202605" }),
      /LAWD_CD must be exactly 5 digits/
    );

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "00000", dealYmd: "202605" }),
      /LAWD_CD must not be 00000/
    );

    await assert.rejects(
      compareDepositToSaleMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202613", depositManwon: 30000 }),
      /DEAL_YMD must use YYYYMM format/
    );

    await assert.rejects(
      compareDepositToSaleMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: FUTURE_DEAL_YMD, depositManwon: 30000 }),
      /DEAL_YMD must not be in the future/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("market API helpers fail fast on unsupported housing types", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called for unsupported housing types");
    };

    await assert.rejects(
      compareRentMarket({ housingType: "unknown" as never, lawdCd: "11620", dealYmd: "202605" }),
      /housingType must be one of/
    );

    await assert.rejects(
      compareDepositToSaleMarket({ housingType: "condo" as never, lawdCd: "11620", dealYmd: "202605", depositManwon: 30000 }),
      /housingType must be one of/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("market API helpers fail fast on invalid money inputs", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called for invalid money inputs");
    };

    await assert.rejects(
      compareRentMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: Number.NaN
      }),
      /depositManwon must be a finite non-negative integer number/
    );

    await assert.rejects(
      compareRentMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        monthlyRentManwon: -1
      }),
      /monthlyRentManwon must be a finite non-negative integer number/
    );

    await assert.rejects(
      compareRentMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000.5
      }),
      /depositManwon must be a finite non-negative integer number/
    );

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: Number.POSITIVE_INFINITY
      }),
      /depositManwon must be a finite non-negative integer number/
    );

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000.25
      }),
      /depositManwon must be a finite non-negative integer number/
    );

    await assert.rejects(
      assessLeaseSafety({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: -1
      }),
      /depositManwon must be a finite non-negative integer number/
    );

    await assert.rejects(
      assessLeaseSafety({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000,
        monthlyRentManwon: 80.5
      }),
      /monthlyRentManwon must be a finite non-negative integer number/
    );

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: MONEY_INPUT_LIMITS.depositManwon + 1
      }),
      /depositManwon must be no greater than/
    );

    await assert.rejects(
      assessLeaseSafety({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000,
        monthlyRentManwon: MONEY_INPUT_LIMITS.monthlyRentManwon + 1
      }),
      /monthlyRentManwon must be no greater than/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("rent market comparison parses live XML records", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("LAWD_CD"), "11620");
      assert.equal(url.searchParams.get("DEAL_YMD"), "202605");
      return new Response(`
        <response>
          <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
          <body><totalCount>1</totalCount><items>
            <item>
              <aptNm>관악테스트</aptNm>
              <umdNm>봉천동</umdNm>
              <deposit>30,000</deposit>
              <monthlyRent>80</monthlyRent>
              <dealYear>2026</dealYear>
              <dealMonth>5</dealMonth>
              <dealDay>10</dealDay>
              <excluUseAr>59.9</excluUseAr>
              <floor>7</floor>
            </item>
          </items></body>
        </response>
      `);
    };

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 32000,
      monthlyRentManwon: 80
    });

    assert.match(text, /공식 전체 신고 건수: 1/);
    assert.match(text, /신고 표본 수: 1/);
    assert.match(text, /보증금 표본 수: 1/);
    assert.match(text, /관악테스트/);
    assert.match(text, /30,000만원/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison renders evidence records by newest contract date", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>3</totalCount><items>
          <item>
            <aptNm>관악오래된전세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>20,000</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>3</dealDay>
            <excluUseAr>40</excluUseAr>
          </item>
          <item>
            <aptNm>관악최신전세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>28</dealDay>
            <excluUseAr>84.8</excluUseAr>
          </item>
          <item>
            <aptNm>관악중간전세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>25,000</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>14</dealDay>
            <excluUseAr>59.9</excluUseAr>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 32000
    });

    const newestIndex = text.indexOf("관악최신전세");
    const middleIndex = text.indexOf("관악중간전세");
    const oldestIndex = text.indexOf("관악오래된전세");
    assert.ok(newestIndex >= 0);
    assert.ok(middleIndex >= 0);
    assert.ok(oldestIndex >= 0);
    assert.ok(newestIndex < middleIndex);
    assert.ok(middleIndex < oldestIndex);
    assert.match(text, /전월세 면적대 한계: 40㎡~84\.8㎡ 표본이 섞인 시군구 단위 중앙값/);
    assert.match(text, /관악최신전세 면적 84\.8㎡ 보증금/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison fetches additional official result pages", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  const pageNos: string[] = [];
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      pageNos.push(url.searchParams.get("pageNo") ?? "");
      assert.equal(url.searchParams.get("numOfRows"), "30");
      const pageNo = url.searchParams.get("pageNo");
      const items = pageNo === "1"
        ? Array.from({ length: 30 }, (_value, index) => rentItemXml(index + 1, 20000 + index)).join("")
        : rentItemXml(31, 40000);
      return new Response(`
        <response>
          <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
          <body><totalCount>31</totalCount><items>${items}</items></body>
        </response>
      `);
    };

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 32000
    });

    assert.deepEqual(pageNos, ["1", "2"]);
    assert.match(text, /공식 전체 신고 건수: 31/);
    assert.match(text, /신고 표본 수: 31/);
    assert.match(text, /보증금 표본 수: 31/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects short pages before official totalCount is reached", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      const pageNo = url.searchParams.get("pageNo");
      const items = pageNo === "1"
        ? Array.from({ length: 30 }, (_value, index) => rentItemXml(index + 1, 20000 + index)).join("")
        : Array.from({ length: 10 }, (_value, index) => rentItemXml(index + 31, 30000 + index)).join("");
      return new Response(`
        <response>
          <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
          <body><totalCount>45</totalCount><items>${items}</items></body>
        </response>
      `);
    };

    await assert.rejects(
      compareRentMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 32000
      }),
      /국토교통부 전월세 실거래 API returned fewer items than totalCount: totalCount=45, items=40/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison discloses bounded calculation sample when official total exceeds cap", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  const pageNos: string[] = [];
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      const pageNo = Number(url.searchParams.get("pageNo"));
      pageNos.push(String(pageNo));
      const startIndex = (pageNo - 1) * 30 + 1;
      const items = Array.from({ length: 30 }, (_value, index) => rentItemXml(startIndex + index, 20000 + startIndex + index)).join("");
      return new Response(`
        <response>
          <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
          <body><totalCount>151</totalCount><items>${items}</items></body>
        </response>
      `);
    };

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 32000
    });

    assert.deepEqual(pageNos, ["1", "2", "3", "4", "5"]);
    assert.match(text, /공식 전체 신고 건수: 151/);
    assert.match(text, /신고 표본 수: 150/);
    assert.match(text, /계산 표본 범위: 공식 전체 151건 중 최대 150건 조회 상한으로 150건을 계산에 사용했습니다/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison parses XML tags with attributes", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode source="molit">00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item seq="1">
            <aptNm lang="ko">관악속성전세</aptNm>
            <umdNm code="11620">봉천동</umdNm>
            <deposit unit="만원">30,000</deposit>
            <monthlyRent unit="만원">80</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 32000,
      monthlyRentManwon: 80
    });

    assert.match(text, /신고 표본 수: 1/);
    assert.match(text, /관악속성전세/);
    assert.match(text, /30,000만원/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison normalizes official text fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악&amp;전세 &#40;테스트&#41;
- 잘못된 항목</aptNm>
            <umdNm>봉천동 &lt;중앙&gt;
## 잘못된 제목</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>80</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605"
    });

    assert.match(text, /관악&전세 \(테스트\) - 잘못된 항목/);
    assert.match(text, /봉천동 중앙 ## 잘못된 제목/);
    assert.doesNotMatch(text, /&amp;|&#40;|&lt;/);
    assert.doesNotMatch(text, /\n- 잘못된 항목/);
    assert.doesNotMatch(text, /\n## 잘못된 제목/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison parses Korean public-data XML fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <아파트>관악한글전세</아파트>
            <법정동>봉천동</법정동>
            <보증금액>31,000</보증금액>
            <월세금액>0</월세금액>
            <년>2026</년>
            <월>5</월>
            <일>11</일>
            <전용면적>59.9</전용면적>
            <층>8</층>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 32000
    });

    assert.match(text, /신고 표본 수: 1/);
    assert.match(text, /보증금 표본 수: 1/);
    assert.match(text, /관악한글전세/);
    assert.match(text, /31,000만원/);
    assert.match(text, /2026-05-11/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison separates reported records from deposit median samples", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악월세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>0</deposit>
            <monthlyRent>85</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>13</dealDay>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      monthlyRentManwon: 85
    });

    assert.match(text, /신고 표본 수: 1/);
    assert.match(text, /보증금 중앙값을 계산할 수 있는 보증금 표본이 없습니다/);
    assert.match(text, /관악월세/);
    assert.match(text, /월세 85만원/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects all-zero official rent money fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악영전월세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>0</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>13</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605"
      }),
      /국토교통부 전월세 실거래 API returned invalid all-zero rent money fields/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects missing official date fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악날짜누락</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>0</monthlyRent>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605"
      }),
      /국토교통부 전월세 실거래 API missing required date field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects impossible calendar dates", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악날짜오류</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>2</dealMonth>
            <dealDay>31</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202602"
      }),
      /국토교통부 전월세 실거래 API returned invalid date field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects malformed date fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악지수날짜</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2e3</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605"
      }),
      /국토교통부 전월세 실거래 API returned invalid date field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison bounds and redacts invalid date field excerpts", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  const oversizedInvalidYear = `${VALID_TEST_SERVICE_KEY} ${"9".repeat(200)}`;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악긴날짜오류</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>${oversizedInvalidYear}</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" });
    assert.fail("Expected invalid date field to throw.");
  } catch (error) {
    const message = (error as Error).message;
    assert.match(message, /국토교통부 전월세 실거래 API returned invalid date field/);
    assert.match(message, /\[DATA_GO_KR_SERVICE_KEY 생략\]/);
    assert.doesNotMatch(message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(message, /9{120}/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison surfaces public-data error payloads", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <OpenAPI_ServiceResponse>
        <cmmMsgHeader>
          <returnReasonCode>30</returnReasonCode>
          <returnAuthMsg>SERVICE KEY IS NOT REGISTERED ERROR.</returnAuthMsg>
        </cmmMsgHeader>
      </OpenAPI_ServiceResponse>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /returned error: 30 SERVICE KEY IS NOT REGISTERED ERROR/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("market API helpers redact service keys from XML error payloads", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY_ENCODED;
    globalThis.fetch = async () => new Response(`
      <OpenAPI_ServiceResponse>
        <cmmMsgHeader>
          <returnReasonCode>30</returnReasonCode>
          <returnAuthMsg>SERVICE KEY ${VALID_TEST_SERVICE_KEY_ENCODED} / ${VALID_TEST_SERVICE_KEY} IS NOT REGISTERED.</returnAuthMsg>
        </cmmMsgHeader>
      </OpenAPI_ServiceResponse>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /returned error: 30/);
        assert.match(error.message, /\[DATA_GO_KR_SERVICE_KEY 생략\]/);
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects unrecognized public-data payloads", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response("temporarily unavailable");

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned unrecognized XML payload/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison requires official result code", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <body><totalCount>0</totalCount><items></items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned XML without resultCode/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison requires official items container", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>0</totalCount></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned XML without items container/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison requires official totalCount metadata", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><items>
          <item>
            <aptNm>관악총건수누락</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned XML without totalCount/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects inconsistent official totalCount metadata", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>0</totalCount><items>
          <item>
            <aptNm>관악모순전세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned inconsistent totalCount field: totalCount=0, items=1/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects malformed money fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악오류전세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>금액오류</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison bounds and redacts invalid numeric field excerpts", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  const oversizedInvalidValue = `${VALID_TEST_SERVICE_KEY} ${"x".repeat(200)}`;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악긴오류전세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>${oversizedInvalidValue}</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" });
    assert.fail("Expected invalid numeric field to throw.");
  } catch (error) {
    const message = (error as Error).message;
    assert.match(message, /국토교통부 전월세 실거래 API returned invalid numeric field/);
    assert.match(message, /\[DATA_GO_KR_SERVICE_KEY 생략\]/);
    assert.doesNotMatch(message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(message, /x{120}/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects empty required money fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악빈전세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit></deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects fractional required money fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악소수전세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30000.5</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects exponent required money fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악지수전세</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>3e4</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison rejects exponent optional area fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악지수면적</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>0</monthlyRent>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
            <excluUseAr>1e2</excluUseAr>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data timeout is explicit and fails fast on invalid configuration", () => {
  const previousTimeout = process.env.PUBLIC_DATA_TIMEOUT_MS;
  try {
    delete process.env.PUBLIC_DATA_TIMEOUT_MS;
    assert.equal(publicDataTimeoutMs(), 8000);

    process.env.PUBLIC_DATA_TIMEOUT_MS = "2500";
    assert.equal(publicDataTimeoutMs(), 2500);

    process.env.PUBLIC_DATA_TIMEOUT_MS = " ";
    assert.throws(() => publicDataTimeoutMs(), /PUBLIC_DATA_TIMEOUT_MS/);

    process.env.PUBLIC_DATA_TIMEOUT_MS = "0";
    assert.throws(() => publicDataTimeoutMs(), /PUBLIC_DATA_TIMEOUT_MS/);

    process.env.PUBLIC_DATA_TIMEOUT_MS = "60001";
    assert.throws(() => publicDataTimeoutMs(), /PUBLIC_DATA_TIMEOUT_MS/);

    process.env.PUBLIC_DATA_TIMEOUT_MS = "slow";
    assert.throws(() => publicDataTimeoutMs(), /PUBLIC_DATA_TIMEOUT_MS/);

    process.env.PUBLIC_DATA_TIMEOUT_MS = "1e3";
    assert.throws(() => publicDataTimeoutMs(), /PUBLIC_DATA_TIMEOUT_MS/);
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.PUBLIC_DATA_TIMEOUT_MS;
    } else {
      process.env.PUBLIC_DATA_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("public-data timeout errors identify the official source boundary", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousTimeout = process.env.PUBLIC_DATA_TIMEOUT_MS;
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    process.env.PUBLIC_DATA_TIMEOUT_MS = "25";
    globalThis.fetch = async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    };

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API request timed out after 25ms/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
    if (previousTimeout === undefined) {
      delete process.env.PUBLIC_DATA_TIMEOUT_MS;
    } else {
      process.env.PUBLIC_DATA_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("public-data network errors identify the official source boundary", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      /행정표준코드 법정동코드 API request failed before receiving a response: fetch failed/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data requests use explicit GET no-store fetch options", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      return new Response(JSON.stringify({
        StanReginCd: [
          { head: [{ list_total_count: 1 }, { RESULT: { resultCode: "INFO-000", resultMsg: "정상" } }] },
          { row: [{ region_cd: "1162010100", locatadd_nm: "서울특별시 관악구 봉천동" }] }
        ]
      }));
    };

    await resolveLegalDongCode({ region: "관악구" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data network errors redact service keys without attaching raw causes", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY_ENCODED;
    globalThis.fetch = async () => {
      throw new TypeError(`fetch failed for ${VALID_TEST_SERVICE_KEY_ENCODED} and ${VALID_TEST_SERVICE_KEY}`);
    };

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /행정표준코드 법정동코드 API request failed before receiving a response/);
        assert.match(error.message, /\[DATA_GO_KR_SERVICE_KEY 생략\]/);
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.equal((error as Error & { cause?: unknown }).cause, undefined);
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data errors redact encoded key variants when env stores a decoded key", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => {
      throw new TypeError(`fetch failed for encoded query key ${VALID_TEST_SERVICE_KEY_ENCODED}`);
    };

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /\[DATA_GO_KR_SERVICE_KEY 생략\]/);
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data HTTP errors include a bounded response excerpt", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(
      "\n  temporarily unavailable\n  retry after approval sync\n  ",
      { status: 503, statusText: "Service Unavailable" }
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      /행정표준코드 법정동코드 API request failed: 503 Service Unavailable - temporarily unavailable retry after approval sync/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data HTTP error excerpts redact configured service keys", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY_ENCODED;
    globalThis.fetch = async () => new Response(
      `approval sync failed for ${VALID_TEST_SERVICE_KEY_ENCODED} and ${VALID_TEST_SERVICE_KEY}`,
      { status: 403, statusText: "Forbidden" }
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /403 Forbidden/);
        assert.match(error.message, /\[DATA_GO_KR_SERVICE_KEY 생략\]/);
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data HTTP error excerpts redact before truncating", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY_ENCODED;
    globalThis.fetch = async () => new Response(
      `${"x".repeat(190)}${VALID_TEST_SERVICE_KEY_ENCODED} ${VALID_TEST_SERVICE_KEY}`,
      { status: 503, statusText: "Service Unavailable" }
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      error => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY.slice(0, 16).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.slice(0, 16).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data HTTP error status text is bounded and redacted", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY_ENCODED;
    globalThis.fetch = async () => new Response("blocked", {
      status: 502,
      statusText: `Bad ${VALID_TEST_SERVICE_KEY_ENCODED} ${VALID_TEST_SERVICE_KEY} ${"x".repeat(120)}`
    });

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /502 Bad \[DATA_GO_KR_SERVICE_KEY 생략\]/);
        assert.match(error.message, / - blocked/);
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.doesNotMatch(error.message, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.doesNotMatch(error.message, /x{90}/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data successful HTML responses fail before parsing", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(
      "<html><body>approval gateway</body></html>",
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API response returned browser HTML Content-Type text\/html; charset=utf-8 instead of official API data - <html><body>approval gateway<\/body><\/html>\./
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data response content length is bounded before parsing", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response("<response></response>", {
      headers: {
        "content-length": "1000001"
      }
    });

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API response must be 1000000 bytes or fewer/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data response rejects malformed content length before parsing", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    for (const contentLength of ["", "   ", "1e6"]) {
      globalThis.fetch = async () => new Response("<response></response>", {
        headers: {
          "content-length": contentLength
        }
      });

      await assert.rejects(
        compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
        /국토교통부 전월세 실거래 API response returned malformed Content-Length header/
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data response body is bounded when content length is absent", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response("x".repeat(1_000_001));

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API response must be 1000000 bytes or fewer/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data response stream stops once byte bound is exceeded", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  let canceled = false;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_000_001));
      },
      cancel() {
        canceled = true;
      }
    }));

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API response must be 1000000 bytes or fewer/
    );
    assert.equal(canceled, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("public-data response rejects invalid UTF-8 before parsing", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(new Uint8Array([0xff, 0xfe]));

    await assert.rejects(
      compareRentMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202605" }),
      /국토교통부 전월세 실거래 API response returned invalid UTF-8 text/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison parses sale XML and flags high ratio", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.match(url.href, /RTMSDataSvcAptTrade/);
      assert.equal(url.searchParams.get("LAWD_CD"), "11620");
      assert.equal(url.searchParams.get("DEAL_YMD"), "202605");
      return new Response(`
        <response>
          <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
          <body><totalCount>2</totalCount><items>
            <item>
              <aptNm>관악매매1</aptNm>
              <umdNm>봉천동</umdNm>
              <dealAmount>40,000</dealAmount>
              <dealYear>2026</dealYear>
              <dealMonth>5</dealMonth>
              <dealDay>10</dealDay>
              <excluUseAr>59.9</excluUseAr>
              <floor>7</floor>
            </item>
            <item>
              <aptNm>관악매매2</aptNm>
              <umdNm>봉천동</umdNm>
              <dealAmount>50,000</dealAmount>
              <dealYear>2026</dealYear>
              <dealMonth>5</dealMonth>
              <dealDay>20</dealDay>
              <excluUseAr>59.9</excluUseAr>
              <floor>9</floor>
            </item>
          </items></body>
        </response>
      `);
    };

    const text = await compareDepositToSaleMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 42000
    });

    assert.match(text, /공식 전체 신고 건수: 2/);
    assert.match(text, /매매 표본 수: 2/);
    assert.match(text, /매매가 대비 보증금 비율: 93.3%/);
    assert.match(text, /90% 이상/);
    assert.match(text, /특정 매물의 안전성/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison renders evidence records by newest contract date", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>3</totalCount><items>
          <item>
            <aptNm>관악오래된매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>40,000</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>2</dealDay>
            <excluUseAr>40</excluUseAr>
          </item>
          <item>
            <aptNm>관악최신매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>50,000</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>27</dealDay>
            <excluUseAr>84.8</excluUseAr>
          </item>
          <item>
            <aptNm>관악중간매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>45,000</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>15</dealDay>
            <excluUseAr>59.9</excluUseAr>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareDepositToSaleMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 42000
    });

    const newestIndex = text.indexOf("관악최신매매");
    const middleIndex = text.indexOf("관악중간매매");
    const oldestIndex = text.indexOf("관악오래된매매");
    assert.ok(newestIndex >= 0);
    assert.ok(middleIndex >= 0);
    assert.ok(oldestIndex >= 0);
    assert.ok(newestIndex < middleIndex);
    assert.ok(middleIndex < oldestIndex);
    assert.match(text, /매매 면적대 한계: 40㎡~84\.8㎡ 표본이 섞인 시군구 단위 중앙값/);
    assert.match(text, /관악최신매매 면적 84\.8㎡ 매매가/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison fetches additional official result pages", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  const pageNos: string[] = [];
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      pageNos.push(url.searchParams.get("pageNo") ?? "");
      assert.equal(url.searchParams.get("numOfRows"), "30");
      const pageNo = url.searchParams.get("pageNo");
      const items = pageNo === "1"
        ? Array.from({ length: 30 }, (_value, index) => saleItemXml(index + 1, 40000 + index)).join("")
        : saleItemXml(31, 60000);
      return new Response(`
        <response>
          <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
          <body><totalCount>31</totalCount><items>${items}</items></body>
        </response>
      `);
    };

    const text = await compareDepositToSaleMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 42000
    });

    assert.deepEqual(pageNos, ["1", "2"]);
    assert.match(text, /공식 전체 신고 건수: 31/);
    assert.match(text, /매매 표본 수: 31/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects short pages before official totalCount is reached", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      const pageNo = url.searchParams.get("pageNo");
      const items = pageNo === "1"
        ? Array.from({ length: 30 }, (_value, index) => saleItemXml(index + 1, 40000 + index)).join("")
        : Array.from({ length: 10 }, (_value, index) => saleItemXml(index + 31, 50000 + index)).join("");
      return new Response(`
        <response>
          <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
          <body><totalCount>45</totalCount><items>${items}</items></body>
        </response>
      `);
    };

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 42000
      }),
      /국토교통부 매매 실거래 API returned fewer items than totalCount: totalCount=45, items=40/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison discloses bounded calculation sample when official total exceeds cap", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  const pageNos: string[] = [];
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      const pageNo = Number(url.searchParams.get("pageNo"));
      pageNos.push(String(pageNo));
      const startIndex = (pageNo - 1) * 30 + 1;
      const items = Array.from({ length: 30 }, (_value, index) => saleItemXml(startIndex + index, 40000 + startIndex + index)).join("");
      return new Response(`
        <response>
          <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
          <body><totalCount>151</totalCount><items>${items}</items></body>
        </response>
      `);
    };

    const text = await compareDepositToSaleMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 42000
    });

    assert.deepEqual(pageNos, ["1", "2", "3", "4", "5"]);
    assert.match(text, /공식 전체 신고 건수: 151/);
    assert.match(text, /매매 표본 수: 150/);
    assert.match(text, /계산 표본 범위: 공식 전체 151건 중 최대 150건 조회 상한으로 150건을 계산에 사용했습니다/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison parses XML tags with attributes", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode source="molit">000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item seq="1">
            <aptNm lang="ko">관악속성매매</aptNm>
            <umdNm code="11620">봉천동</umdNm>
            <dealAmount unit="만원">40,000</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareDepositToSaleMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 32000
    });

    assert.match(text, /매매 표본 수: 1/);
    assert.match(text, /관악속성매매/);
    assert.match(text, /매매가 대비 보증금 비율: 80%/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison normalizes official text fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악&amp;매매 &#40;테스트&#41;
- 잘못된 항목</aptNm>
            <umdNm>봉천동 &lt;중앙&gt;
## 잘못된 제목</umdNm>
            <dealAmount>40,000</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareDepositToSaleMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 30000
    });

    assert.match(text, /관악&매매 \(테스트\) - 잘못된 항목/);
    assert.match(text, /봉천동 중앙 ## 잘못된 제목/);
    assert.doesNotMatch(text, /&amp;|&#40;|&lt;/);
    assert.doesNotMatch(text, /\n- 잘못된 항목/);
    assert.doesNotMatch(text, /\n## 잘못된 제목/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison parses Korean public-data XML fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <아파트>관악한글매매</아파트>
            <법정동>봉천동</법정동>
            <거래금액>40,000</거래금액>
            <년>2026</년>
            <월>5</월>
            <일>12</일>
            <전용면적>59.9</전용면적>
            <층>9</층>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareDepositToSaleMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      depositManwon: 32000
    });

    assert.match(text, /매매 표본 수: 1/);
    assert.match(text, /관악한글매매/);
    assert.match(text, /매매가 대비 보증금 비율: 80%/);
    assert.match(text, /2026-05-12/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison requires a positive deposit before official API calls", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called for zero-deposit sale comparison");
    };

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 0
      }),
      /depositManwon must be a positive integer number of manwon for deposit-to-sale comparison/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("one-shot lease assessment requires a positive deposit before official API calls", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called for zero-deposit lease assessment");
    };

    await assert.rejects(
      assessLeaseSafety({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 0
      }),
      /depositManwon must be a positive integer number of manwon for lease safety assessment/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("deposit-to-sale comparison rejects missing official date fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악날짜누락매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>40,000</dealAmount>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API missing required date field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects malformed date fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악지수날짜매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>40,000</dealAmount>
            <dealYear>2e3</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned invalid date field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects unrecognized public-data payloads", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response("temporarily unavailable");

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned unrecognized XML payload/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison requires official result code", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <body><totalCount>0</totalCount><items></items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned XML without resultCode/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison requires official items container", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>0</totalCount></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned XML without items container/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison requires official totalCount metadata", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><items>
          <item>
            <aptNm>관악매매총건수누락</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>40,000</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned XML without totalCount/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects inconsistent official totalCount metadata", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>2</totalCount><items></items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned inconsistent totalCount field: totalCount=2, items=0/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects zero official sale amount fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악영매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>0</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned invalid zero sale amount field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects malformed sale amount fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악오류매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>금액오류</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects empty required sale amount fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악빈매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount></dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects fractional required sale amount fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악소수매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>40000.5</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects exponent required sale amount fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악지수매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>4e4</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison rejects exponent optional area fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><totalCount>1</totalCount><items>
          <item>
            <aptNm>관악지수면적매매</aptNm>
            <umdNm>봉천동</umdNm>
            <dealAmount>40,000</dealAmount>
            <dealYear>2026</dealYear>
            <dealMonth>5</dealMonth>
            <dealDay>10</dealDay>
            <excluUseAr>1e2</excluUseAr>
          </item>
        </items></body>
      </response>
    `);

    await assert.rejects(
      compareDepositToSaleMarket({
        housingType: "apartment",
        lawdCd: "11620",
        dealYmd: "202605",
        depositManwon: 30000
      }),
      /국토교통부 매매 실거래 API returned invalid numeric field/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("one-shot lease assessment combines rent, sale, red flags, and actions", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("LAWD_CD"), "11620");
      assert.equal(url.searchParams.get("DEAL_YMD"), "202605");
      if (url.href.includes("AptRent")) {
        return new Response(`
          <response>
            <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
            <body><totalCount>1</totalCount><items>
              <item>
                <aptNm>관악전세1</aptNm>
                <umdNm>봉천동</umdNm>
                <deposit>30,000</deposit>
                <monthlyRent>0</monthlyRent>
                <excluUseAr>59.9</excluUseAr>
                <dealYear>2026</dealYear>
                <dealMonth>5</dealMonth>
                <dealDay>10</dealDay>
              </item>
            </items></body>
          </response>
        `);
      }
      if (url.href.includes("AptTrade")) {
        return new Response(`
          <response>
            <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
            <body><totalCount>1</totalCount><items>
              <item>
                <aptNm>관악매매1</aptNm>
                <umdNm>봉천동</umdNm>
                <dealAmount>40,000</dealAmount>
                <excluUseAr>84.8</excluUseAr>
                <dealYear>2026</dealYear>
                <dealMonth>5</dealMonth>
                <dealDay>10</dealDay>
              </item>
            </items></body>
          </response>
        `);
      }
      throw new Error(`unexpected endpoint ${url.href}`);
    };

    const text = await assessLeaseSafety({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      region: "서울 관악구",
      contractType: "jeonse",
      depositManwon: 38000,
      concerns: "대리계약이고 근저당도 있는데 계약금을 빨리 보내라고 합니다"
    });

    assert.match(text, /전월세 안전 종합 진단/);
    assert.match(text, /조회 기준: LAWD_CD 11620, 계약월 202605/);
    assert.match(text, /입력 지역 메모: 서울 관악구/);
    assert.match(text, /종합 위험도: 매우 높음/);
    assert.match(text, /## 한 줄 결론/);
    assert.match(text, /매우 높음 위험입니다\. 계약금·서명은 보류/);
    assert.match(text, /위험도 근거:/);
    assert.match(text, /지역명 메모는 표시용이며, 공식 실거래 조회와 시세 계산은 LAWD_CD와 계약월 기준/);
    assert.match(text, /전월세 신고 표본 1건/);
    assert.match(text, /전월세 공식 전체 신고 1건 중 현재 조회 표본 1건을 계산에 사용/);
    assert.match(text, /보증금 산출 표본 1건/);
    assert.match(text, /전월세 표본 신뢰도: 낮음 - 계산 표본 1건뿐/);
    assert.match(text, /전월세 면적대 참고: 면적 정보 1건이 모두 59\.9㎡/);
    assert.match(text, /매매 신고 표본 1건/);
    assert.match(text, /매매 공식 전체 신고 1건 중 현재 조회 표본 1건을 계산에 사용/);
    assert.match(text, /매매 표본 신뢰도: 낮음 - 계산 표본 1건뿐/);
    assert.match(text, /매매 면적대 참고: 면적 정보 1건이 모두 84\.8㎡/);
    assert.match(text, /매매가 대비 보증금 비율 95%/);
    assert.match(text, /## 계약 판단 기준/);
    assert.match(text, /보류 기준: 계약금·가계약금 송금과 서명은/);
    assert.match(text, /전세가율 기준: 매매가 대비 보증금 비율이 95%/);
    assert.match(text, /증거 보강 기준: 표본이 적으므로 전후월, 인접동, 같은 면적대 실거래/);
    assert.match(text, /진행 조건: 잔금 전 등기부 재발급/);
    assert.match(text, /중단 신호: 소유자 직접 확인 거부/);
    assert.match(text, /대리계약/);
    assert.match(text, /등기부·소유자·특약 확인 전에는 계약금·가계약금 송금을 보류/);
    assert.match(text, /위임장 원본 범위/);
    assert.match(text, /말소 조건, 잔금 전 등기부 재발급, 보증보험 가능 여부를 특약에 명시/);
    assert.match(text, /계약금 송금을 보류/);
    assert.match(text, /관악전세1 면적 59\.9㎡ 보증금/);
    assert.match(text, /관악매매1 면적 84\.8㎡ 매매가/);
    assert.match(text, /공식 출처/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("one-shot lease assessment discloses bounded market samples", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      const pageNo = Number(url.searchParams.get("pageNo"));
      const startIndex = (pageNo - 1) * 30 + 1;
      if (url.href.includes("AptRent")) {
        const items = Array.from({ length: 30 }, (_value, index) => rentItemXml(startIndex + index, 25000 + index)).join("");
        return new Response(`
          <response>
            <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
            <body><totalCount>151</totalCount><items>${items}</items></body>
          </response>
        `);
      }
      if (url.href.includes("AptTrade")) {
        const items = Array.from({ length: 30 }, (_value, index) => saleItemXml(startIndex + index, 40000 + index)).join("");
        return new Response(`
          <response>
            <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
            <body><totalCount>151</totalCount><items>${items}</items></body>
          </response>
        `);
      }
      throw new Error(`unexpected endpoint ${url.href}`);
    };

    const text = await assessLeaseSafety({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605",
      region: "서울 관악구",
      contractType: "jeonse",
      depositManwon: 38000
    });

    assert.match(text, /전월세 공식 전체 신고 151건 중 최대 150건 조회 상한으로 현재 조회 표본 150건을 계산에 사용/);
    assert.match(text, /매매 공식 전체 신고 151건 중 최대 150건 조회 상한으로 현재 조회 표본 150건을 계산에 사용/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("production app requires host allowlist", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  try {
    process.env.NODE_ENV = "production";
    delete process.env.MCP_ALLOWED_HOSTS;
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;

    assert.throws(() => createApp(), /MCP_ALLOWED_HOSTS is required in production/);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("production app rejects unsafe host allowlist entries", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const authEnvName = "MCP_AUTH" + "_TOKEN";
  const previousAuthToken = process.env[authEnvName];
  try {
    process.env.NODE_ENV = "production";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;

    for (const value of ["*", "https://example.com", "example.com/path", "bad host.example", "bad_host.example", "bad..example", "-bad.example", "bad-.example", ".example.com", `${"a".repeat(64)}.example.com`, "example.com:443", "example.com:not-a-port", "user@example.com", "example.com?debug=true", "example.com#fragment", "example.com\\path"]) {
      process.env.MCP_ALLOWED_HOSTS = value;
      assert.throws(() => createApp(), /plain hostnames/);
    }

    process.env.MCP_ALLOWED_HOSTS = "lease-safe.example.com,LEASE-SAFE.example.com";
    assert.throws(() => createApp(), /unique hostnames/);

    for (const value of ["lease-safe.example.com,", ",lease-safe.example.com", "lease-safe.example.com,,localhost"]) {
      process.env.MCP_ALLOWED_HOSTS = value;
      assert.throws(() => createApp(), /must not be empty/);
    }

    process.env.MCP_ALLOWED_HOSTS = "lease-safe.example.com,127.0.0.1,LOCALHOST";
    process.env[authEnvName] = VALID_TEST_AUTH_TOKEN;
    assert.doesNotThrow(() => createApp());
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
    if (previousAuthToken === undefined) {
      delete process.env[authEnvName];
    } else {
      process.env[authEnvName] = previousAuthToken;
    }
  }
});

test("production app requires public-data key", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    delete process.env[PUBLIC_DATA_KEY_ENV_NAME];

    assert.throws(() => createApp(), /DATA_GO_KR_SERVICE_KEY is required in production/);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("production app rejects stale official source reviews at startup", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;

    assert.throws(
      () => createApp(new Date(Date.UTC(2026, 7, 16))),
      /Official source review is stale/
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("production app rejects invalid official source registry at startup", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;

    assert.throws(
      () => createApp(new Date(Date.UTC(2026, 6, 2)), [reviewedSource(), reviewedSource()]),
      /Duplicate official source id in registry/
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("production app rejects placeholder public-data keys", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const placeholderKey = ["your", "data", "go", "kr", "service", "key"].join("-");
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = placeholderKey;

    assert.throws(() => createApp(), /not a placeholder/);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("production app rejects malformed public-data keys", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = "short-key";

    assert.throws(() => createApp(), /must look like a real data\.go\.kr service key/);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("MCP auth token fails fast when configured too weakly", () => {
  const authEnvName = "MCP_AUTH" + "_TOKEN";
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousAuthToken = process.env[authEnvName];
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;

    delete process.env[authEnvName];
    assert.throws(() => createApp(), /MCP_AUTH_TOKEN is required in production/);

    process.env[authEnvName] = "";
    assert.throws(() => createApp(), /MCP_AUTH_TOKEN is required in production/);

    process.env[authEnvName] = "short";
    assert.throws(() => createApp(), /MCP_AUTH_TOKEN must be at least 16 characters/);

    process.env[authEnvName] = "token with spaces 123";
    assert.throws(() => createApp(), /MCP_AUTH_TOKEN must not contain whitespace/);

    process.env[authEnvName] = " token-with-leading-space-123";
    assert.throws(() => createApp(), /MCP_AUTH_TOKEN must not contain whitespace/);

    process.env[authEnvName] = "token-with-snowman-123-☃";
    assert.throws(() => createApp(), /MCP_AUTH_TOKEN must contain only visible ASCII characters/);

    process.env[authEnvName] = "replace-with-runtime-secret";
    assert.throws(() => createApp(), /MCP_AUTH_TOKEN must be a real bearer token, not a placeholder/);

    process.env[authEnvName] = "x".repeat(4097);
    assert.throws(() => createApp(), /MCP_AUTH_TOKEN must be 4096 characters or fewer/);

    process.env[authEnvName] = VALID_TEST_AUTH_TOKEN;
    assert.doesNotThrow(() => createApp());
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
    if (previousAuthToken === undefined) {
      delete process.env[authEnvName];
    } else {
      process.env[authEnvName] = previousAuthToken;
    }
  }
});

test("compact log error redacts configured runtime secrets", () => {
  const authEnvName = "MCP_AUTH" + "_TOKEN";
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousAuthToken = process.env[authEnvName];
  const authToken = ["runtime", "auth", "token", "for", "log", "redaction"].join("-");
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY_ENCODED;
    process.env[authEnvName] = authToken;

    const error = new Error(`upstream leaked ${VALID_TEST_SERVICE_KEY} and ${VALID_TEST_SERVICE_KEY_ENCODED} with ${authToken}`);
    error.name = `SecretError ${authToken}`;

    const compact = compactLogError(error);
    assert.match(compact.name, /\[MCP_AUTH_TOKEN redacted\]/);
    assert.match(compact.message, /\[DATA_GO_KR_SERVICE_KEY redacted\]/);
    assert.match(compact.message, /\[MCP_AUTH_TOKEN redacted\]/);
    assert.doesNotMatch(compact.name, new RegExp(authToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(compact.message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(compact.message, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(compact.message, new RegExp(authToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
    if (previousAuthToken === undefined) {
      delete process.env[authEnvName];
    } else {
      process.env[authEnvName] = previousAuthToken;
    }
  }
});

test("compact log error redacts encoded secret variants when env stores decoded values", () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;

    const compact = compactLogError(new Error(`upstream leaked encoded query key ${VALID_TEST_SERVICE_KEY_ENCODED}`));
    assert.match(compact.message, /\[DATA_GO_KR_SERVICE_KEY redacted\]/);
    assert.doesNotMatch(compact.message, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(compact.message, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("script error compaction redacts runtime secrets without stack output", () => {
  const authEnvName = "MCP_AUTH" + "_TOKEN";
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousAuthToken = process.env[authEnvName];
  const authToken = ["runtime", "script", "auth", "token"].join("-");
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    process.env[authEnvName] = authToken;

    const compact = compactScriptErrorMessage(new Error(`script failed for ${VALID_TEST_SERVICE_KEY_ENCODED} and ${authToken}\n    at stack frame`));
    assert.match(compact, /\[DATA_GO_KR_SERVICE_KEY redacted\]/);
    assert.match(compact, /\[MCP_AUTH_TOKEN redacted\]/);
    assert.doesNotMatch(compact, new RegExp(VALID_TEST_SERVICE_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(compact, new RegExp(VALID_TEST_SERVICE_KEY_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(compact, new RegExp(authToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(compact.includes("\n"), false);
  } finally {
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
    if (previousAuthToken === undefined) {
      delete process.env[authEnvName];
    } else {
      process.env[authEnvName] = previousAuthToken;
    }
  }
});

test("production app starts when required runtime configuration is present", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousTimeout = process.env.PUBLIC_DATA_TIMEOUT_MS;
  const authEnvName = "MCP_AUTH" + "_TOKEN";
  const previousAuthToken = process.env[authEnvName];
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    process.env[authEnvName] = VALID_TEST_AUTH_TOKEN;
    process.env.PUBLIC_DATA_TIMEOUT_MS = "7000";

    const app = createApp();
    assert.equal(app.enabled("x-powered-by"), false);
    assert.doesNotThrow(() => createApp());
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
    if (previousTimeout === undefined) {
      delete process.env.PUBLIC_DATA_TIMEOUT_MS;
    } else {
      process.env.PUBLIC_DATA_TIMEOUT_MS = previousTimeout;
    }
    if (previousAuthToken === undefined) {
      delete process.env[authEnvName];
    } else {
      process.env[authEnvName] = previousAuthToken;
    }
  }
});

test("HTTP server reports listen failures clearly", () => {
  const previousConsoleError = console.error;
  const previousProcessExit = process.exit;
  const logs: unknown[][] = [];
  try {
    console.error = ((...args: unknown[]) => {
      logs.push(args);
    }) as typeof console.error;
    process.exit = ((code?: string | number | null) => {
      throw new Error(`process.exit ${code}`);
    }) as typeof process.exit;

    const listenError = Object.assign(new Error("listen EADDRINUSE: address already in use 0.0.0.0:3000"), {
      code: "EADDRINUSE"
    });

    assert.throws(() => handleHttpServerListenError(listenError), /process\.exit 1/);
    assert.equal(logs[0]?.[0], "Failed to start server");
    assert.match(JSON.stringify(logs[0]?.[1]), /EADDRINUSE/);
  } finally {
    console.error = previousConsoleError;
    process.exit = previousProcessExit;
  }
});

test("production app fails fast on invalid public-data timeout configuration", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousTimeout = process.env.PUBLIC_DATA_TIMEOUT_MS;
  const authEnvName = "MCP_AUTH" + "_TOKEN";
  const previousAuthToken = process.env[authEnvName];
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    process.env[authEnvName] = VALID_TEST_AUTH_TOKEN;
    process.env.PUBLIC_DATA_TIMEOUT_MS = "60001";

    assert.throws(() => createApp(), /PUBLIC_DATA_TIMEOUT_MS/);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousAllowedHosts === undefined) {
      delete process.env.MCP_ALLOWED_HOSTS;
    } else {
      process.env.MCP_ALLOWED_HOSTS = previousAllowedHosts;
    }
    if (previousKey === undefined) {
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
    if (previousTimeout === undefined) {
      delete process.env.PUBLIC_DATA_TIMEOUT_MS;
    } else {
      process.env.PUBLIC_DATA_TIMEOUT_MS = previousTimeout;
    }
    if (previousAuthToken === undefined) {
      delete process.env[authEnvName];
    } else {
      process.env[authEnvName] = previousAuthToken;
    }
  }
});

test("MCP body limit is explicit and fails fast on invalid configuration", () => {
  const previousLimit = process.env.MCP_MAX_BODY_BYTES;
  try {
    delete process.env.MCP_MAX_BODY_BYTES;
    assert.equal(mcpMaxBodyBytes(), 262144);

    process.env.MCP_MAX_BODY_BYTES = "1024";
    assert.equal(mcpMaxBodyBytes(), 1024);

    process.env.MCP_MAX_BODY_BYTES = "1048576";
    assert.equal(mcpMaxBodyBytes(), 1048576);

    process.env.MCP_MAX_BODY_BYTES = " ";
    assert.throws(() => mcpMaxBodyBytes(), /positive integer no greater than 1048576/);

    process.env.MCP_MAX_BODY_BYTES = "1048577";
    assert.throws(() => mcpMaxBodyBytes(), /no greater than 1048576/);

    process.env.MCP_MAX_BODY_BYTES = "0";
    assert.throws(() => mcpMaxBodyBytes(), /positive integer no greater than 1048576/);

    process.env.MCP_MAX_BODY_BYTES = "not-a-number";
    assert.throws(() => mcpMaxBodyBytes(), /positive integer no greater than 1048576/);

    process.env.MCP_MAX_BODY_BYTES = "1e6";
    assert.throws(() => mcpMaxBodyBytes(), /positive integer no greater than 1048576/);
  } finally {
    if (previousLimit === undefined) {
      delete process.env.MCP_MAX_BODY_BYTES;
    } else {
      process.env.MCP_MAX_BODY_BYTES = previousLimit;
    }
  }
});

test("MCP rate limit is explicit and fails fast on invalid configuration", () => {
  const previousLimit = process.env.MCP_RATE_LIMIT_PER_MINUTE;
  try {
    delete process.env.MCP_RATE_LIMIT_PER_MINUTE;
    assert.equal(mcpRateLimitPerMinute(), 120);

    process.env.MCP_RATE_LIMIT_PER_MINUTE = "0";
    assert.equal(mcpRateLimitPerMinute(), 0);

    process.env.MCP_RATE_LIMIT_PER_MINUTE = "30";
    assert.equal(mcpRateLimitPerMinute(), 30);

    process.env.MCP_RATE_LIMIT_PER_MINUTE = "10000";
    assert.equal(mcpRateLimitPerMinute(), 10000);

    process.env.MCP_RATE_LIMIT_PER_MINUTE = " ";
    assert.throws(() => mcpRateLimitPerMinute(), /non-negative integer no greater than 10000/);

    process.env.MCP_RATE_LIMIT_PER_MINUTE = "10001";
    assert.throws(() => mcpRateLimitPerMinute(), /no greater than 10000/);

    process.env.MCP_RATE_LIMIT_PER_MINUTE = "-1";
    assert.throws(() => mcpRateLimitPerMinute(), /non-negative integer no greater than 10000/);

    process.env.MCP_RATE_LIMIT_PER_MINUTE = "fast";
    assert.throws(() => mcpRateLimitPerMinute(), /non-negative integer no greater than 10000/);

    process.env.MCP_RATE_LIMIT_PER_MINUTE = "1e2";
    assert.throws(() => mcpRateLimitPerMinute(), /non-negative integer no greater than 10000/);
  } finally {
    if (previousLimit === undefined) {
      delete process.env.MCP_RATE_LIMIT_PER_MINUTE;
    } else {
      process.env.MCP_RATE_LIMIT_PER_MINUTE = previousLimit;
    }
  }
});

test("MCP rate limiter prunes expired client windows", () => {
  const windows = new Map([
    ["expired", { count: 3, resetAt: 1000 }],
    ["active", { count: 1, resetAt: 2000 }]
  ]);

  pruneExpiredRateLimitWindows(windows, 1500);

  assert.equal(windows.has("expired"), false);
  assert.equal(windows.has("active"), true);
});

test("MCP tool input schemas bound free-text fields", () => {
  const validAssessmentInput = {
    housingType: "apartment",
    lawdCd: "11620",
    dealYmd: "202605",
    depositManwon: 30000,
    region: "서울 관악구",
    situation: "전세 계약 전 등기부와 보증보험을 확인하려고 합니다.",
    moveInDate: "2026-07-15",
    contractDate: "2026-07-01",
    concerns: "근저당과 선순위 보증금이 걱정됩니다."
  };
  const assessmentSchema = registeredToolSchema("assess_lease_safety");

  assert.equal(assessmentSchema.safeParse(validAssessmentInput).success, true);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, lawdCd: "00000" }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, region: "가".repeat(MCP_TEXT_LIMITS.region + 1) }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, situation: "가".repeat(MCP_TEXT_LIMITS.situation + 1) }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, moveInDate: "가".repeat(MCP_TEXT_LIMITS.dateText + 1) }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, contractDate: "가".repeat(MCP_TEXT_LIMITS.dateText + 1) }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, concerns: "가".repeat(MCP_TEXT_LIMITS.concerns + 1) }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, dealYmd: FUTURE_DEAL_YMD }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, depositManwon: 0 }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, depositManwon: MONEY_INPUT_LIMITS.depositManwon + 1 }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...validAssessmentInput, monthlyRentManwon: MONEY_INPUT_LIMITS.monthlyRentManwon + 1 }).success, false);

  const saleComparisonSchema = registeredToolSchema("compare_deposit_to_sale_market");
  assert.equal(saleComparisonSchema.safeParse({
    housingType: "apartment",
    lawdCd: "11620",
    dealYmd: "202605",
    depositManwon: 30000
  }).success, true);
  assert.equal(saleComparisonSchema.safeParse({
    housingType: "apartment",
    lawdCd: "11620",
    dealYmd: "202605",
    depositManwon: 0
  }).success, false);

  const legalDongSchema = registeredToolSchema("resolve_legal_dong_code");
  assert.equal(legalDongSchema.safeParse({ region: "서울 관악구" }).success, true);
  assert.equal(legalDongSchema.safeParse({ region: "가".repeat(MCP_TEXT_LIMITS.region + 1) }).success, false);

  const officialHelpSchema = registeredToolSchema("route_official_help");
  assert.equal(officialHelpSchema.safeParse({ issueType: "tax_arrears", situation: "임대인 국세 체납이 걱정됩니다" }).success, true);
});

test("HTTP port is explicit and fails fast on invalid configuration", () => {
  const previousPort = process.env.PORT;
  try {
    delete process.env.PORT;
    assert.equal(httpPort(), 3000);

    process.env.PORT = "8080";
    assert.equal(httpPort(), 8080);

    process.env.PORT = " ";
    assert.throws(() => httpPort(), /PORT must be an integer between 1 and 65535/);

    process.env.PORT = "0";
    assert.throws(() => httpPort(), /PORT must be an integer between 1 and 65535/);

    process.env.PORT = "65536";
    assert.throws(() => httpPort(), /PORT must be an integer between 1 and 65535/);

    process.env.PORT = "not-a-port";
    assert.throws(() => httpPort(), /PORT must be an integer between 1 and 65535/);

    process.env.PORT = "3e3";
    assert.throws(() => httpPort(), /PORT must be an integer between 1 and 65535/);
  } finally {
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});

test("HTTP host is explicit and fails fast on unsafe bind values", () => {
  const previousHost = process.env.HOST;
  try {
    delete process.env.HOST;
    assert.equal(httpHost(), "0.0.0.0");

    process.env.HOST = "127.0.0.1";
    assert.equal(httpHost(), "127.0.0.1");

    process.env.HOST = "localhost";
    assert.equal(httpHost(), "localhost");

    for (const value of [" ", "*", "https://127.0.0.1", "127.0.0.1:3000", "::1", "bad_host"]) {
      process.env.HOST = value;
      assert.throws(() => httpHost(), /HOST must be a plain hostname or IPv4 address/);
    }
  } finally {
    if (previousHost === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = previousHost;
    }
  }
});

test("red flag checker surfaces registry and rushed deposit pressure", () => {
  const text = checkLeaseRedFlags({
    situation: "집주인이 대리인이고 오늘 가계약금을 빨리 보내라고 합니다. 근저당도 있다고 들었습니다.",
    contractType: "jeonse",
    depositManwon: 30000
  });
  assert.match(text, /대리계약/);
  assert.match(text, /근저당/);
  assert.match(text, /송금/);
  assert.match(text, /문서 증거 패키지/);
  assert.match(text, /등기부등본: 발급일시/);
  assert.match(text, /공식 접수 증거/);
  assert.match(text, /법률 자문/);
});

test("red flag checker treats trust registry language as a senior-right signal", () => {
  const text = checkLeaseRedFlags({
    region: "서울 관악구",
    situation: "등기부에 신탁등기가 보입니다.",
    contractType: "jeonse",
    depositManwon: 30000
  });

  assert.match(text, /신탁/);
  assert.match(text, /잔금 전 등기부 재확인/);
  assert.doesNotMatch(text, /현재 입력만으로 확정 위험/);
});

test("red flag checker surfaces landlord tax arrears concerns", () => {
  const text = checkLeaseRedFlags({
    region: "서울 관악구",
    situation: "임대인 국세 체납과 지방세 미납이 걱정되고 납세증명을 확인하고 싶습니다.",
    contractType: "jeonse",
    depositManwon: 30000
  });

  assert.match(text, /체납/);
  assert.match(text, /국세/);
  assert.match(text, /지방세/);
  assert.match(text, /납세증명/);
  assert.match(text, /국세청/);
  assert.match(text, /위택스/);
  assert.match(text, /세금 체납 여부 확정/);
  assert.match(text, /납세증명 진위 판단/);
  assert.doesNotMatch(text, /현재 입력만으로 확정 위험/);
});

test("move-in plan includes official protection steps", () => {
  const text = buildMoveInProtectionPlan({ moveInDate: "2026-07-20", contractDate: "2026-07-01" });
  assert.match(text, /전입신고/);
  assert.match(text, /확정일자/);
  assert.match(text, /임대차 계약 신고/);
  assert.match(text, /납세증명/);
  assert.match(text, /문서 증거 패키지/);
  assert.match(text, /계약서·특약 초안/);
  assert.match(text, /시세 근거/);
});

test("contract questions include HUG and lease report", () => {
  const text = prepareContractQuestions({ concerns: "전세 보증금이 큽니다" });
  assert.match(text, /전세보증금반환보증/);
  assert.match(text, /임대차신고/);
  assert.match(text, /국세·지방세 체납/);
  assert.match(text, /임대인 납세·체납 관련 확인 가능 서류/);
  assert.match(text, /문서 증거 패키지/);
  assert.match(text, /상대방 확인 증거/);
});

test("contract questions redact contact details from user text", () => {
  const text = prepareContractQuestions({
    concerns: "서울 관악구 봉천동 101동 202호, 3층 301호, 1203호입니다. 연락은 user@example.com 또는 010 1234 5678로 주세요. 주민번호는 900101 1234567이고 외국인등록번호는 900101-5123456입니다. 계약금 계좌는 110-123-456789입니다."
  });

  assert.match(text, /\[이메일 생략\]/);
  assert.match(text, /\[연락처 생략\]/);
  assert.match(text, /\[민감번호 생략\]/);
  assert.match(text, /\[계좌번호 생략\]/);
  assert.match(text, /\[동호수 생략\]/);
  assert.match(text, /서울 관악구 봉천동/);
  assert.doesNotMatch(text, /user@example\.com/);
  assert.doesNotMatch(text, /010 1234 5678/);
  assert.doesNotMatch(text, /900101 1234567/);
  assert.doesNotMatch(text, /900101-5123456/);
  assert.doesNotMatch(text, /110-123-456789/);
  assert.doesNotMatch(text, /101동 202호/);
  assert.doesNotMatch(text, /3층 301호/);
  assert.doesNotMatch(text, /1203호/);
});

test("red flag checker redacts household unit details from rendered region", () => {
  const text = checkLeaseRedFlags({
    region: "서울 관악구 봉천동 1203호",
    contractType: "jeonse",
    depositManwon: 30000
  });

  assert.match(text, /\[동호수 생략\]/);
  assert.doesNotMatch(text, /1203호/);
});

test("red flag checker redacts contact and link details from rendered region", () => {
  const text = checkLeaseRedFlags({
    region: "서울 관악구 010-1234-5678 https://evil.example/track",
    contractType: "jeonse",
    depositManwon: 30000
  });

  assert.match(text, /\[연락처 생략\]/);
  assert.match(text, /\[링크 생략\]/);
  assert.doesNotMatch(text, /010-1234-5678/);
  assert.doesNotMatch(text, /https:\/\/evil\.example/);
});

test("contract questions normalize user text before rendering markdown", () => {
  const text = prepareContractQuestions({
    concerns: "전세 보증금이 큽니다\n\n## 임의 섹션\n- 그대로 보이면 안 됩니다 [악성링크](https://evil.example) ![추적](https://evil.example/pixel.png) https://evil.example/raw <script>alert(1)</script>"
  });

  assert.match(text, /핵심 고민: 전세 보증금이 큽니다 ## 임의 섹션 - 그대로 보이면 안 됩니다 악성링크 추적 \[링크 생략\] alert\(1\)/);
  assert.doesNotMatch(text, /\n## 임의 섹션/);
  assert.doesNotMatch(text, /\[악성링크\]\(https:\/\/evil\.example\)/);
  assert.doesNotMatch(text, /!\[추적\]\(https:\/\/evil\.example\/pixel\.png\)/);
  assert.doesNotMatch(text, /https:\/\/evil\.example\/raw/);
  assert.doesNotMatch(text, /<script>/);
});

test("rendered user text strips markdown backticks and control characters", () => {
  const questions = prepareContractQuestions({
    concerns: "전세 보증금이 큽니다 ```임의 코드블록\u0000```"
  });
  const moveInPlan = buildMoveInProtectionPlan({
    contractDate: "2026-07-01```",
    moveInDate: "2026-07-20\u0000"
  });

  assert.match(questions, /핵심 고민: 전세 보증금이 큽니다 임의 코드블록/);
  assert.doesNotMatch(questions, /```/);
  assert.doesNotMatch(questions, /\u0000/);
  assert.match(moveInPlan, /계약일: 2026-07-01/);
  assert.match(moveInPlan, /이사일: 2026-07-20/);
  assert.doesNotMatch(moveInPlan, /```/);
  assert.doesNotMatch(moveInPlan, /\u0000/);
});

test("official help router maps lease report to RTMS", () => {
  const text = routeOfficialHelp({ issueType: "lease_report" });
  assert.match(text, /RTMS/);
  assert.match(text, /주택 임대차 계약 신고/);
});

test("official help router infers routes from natural language", () => {
  const cases: Array<{ input: Parameters<typeof routeOfficialHelp>[0]; expected: RegExp }> = [
    { input: { situation: "전입신고 처리 결과를 어디서 확인하나요?" }, expected: /정부24/ },
    { input: { situation: "확정일자 신청을 하고 싶습니다" }, expected: /확정일자 신청/ },
    { input: { situation: "주택 임대차 계약 신고 RTMS가 궁금합니다" }, expected: /RTMS/ },
    { input: { situation: "전세보증금반환보증 가입 가능 여부를 확인하고 싶습니다" }, expected: /HUG/ },
    { input: { situation: "임대인 국세 체납과 지방세 미납은 어디서 확인하나요?" }, expected: /국세청·위택스/ },
    { input: { situation: "등기부에 근저당과 신탁이 보입니다" }, expected: /등기부등본 발급/ },
    { input: { situation: "보증금 반환 분쟁과 수선 문제를 상담하고 싶습니다" }, expected: /분쟁 상담/ }
  ];

  for (const { input, expected } of cases) {
    assert.match(routeOfficialHelp(input), expected);
  }
});
