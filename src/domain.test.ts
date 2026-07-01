import test from "node:test";
import assert from "node:assert/strict";
import {
  assessLeaseSafety,
  buildMoveInProtectionPlan,
  checkLeaseRedFlags,
  compareDepositToSaleMarket,
  compareRentMarket,
  explainDataAvailability,
  prepareContractQuestions,
  publicDataTimeoutMs,
  resolveLegalDongCode,
  routeOfficialHelp
} from "./domain.js";
import { createApp, mcpMaxBodyBytes, mcpRateLimitPerMinute } from "./server.js";
import { positiveSampleCount, publicDataSmokeDepositManwon } from "../scripts/public-data-smoke.js";
import { scanLine } from "../scripts/secret-scan.js";

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
});

test("public-data smoke requires positive live sample counts", () => {
  assert.equal(positiveSampleCount("신고 표본 수: 1,234", "rent", /신고 표본 수:\s*([\d,]+)/), 1234);
  assert.throws(
    () => positiveSampleCount("매매 표본 수: 0", "sale", /매매 표본 수:\s*([\d,]+)/),
    /returned 0 samples/
  );
  assert.throws(
    () => positiveSampleCount("매매가 대비 보증금 비율: 계산 불가", "sale", /매매 표본 수:\s*([\d,]+)/),
    /parseable sample count/
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
    assert.throws(() => publicDataSmokeDepositManwon(), /positive number/);

    process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = "-1";
    assert.throws(() => publicDataSmokeDepositManwon(), /positive number/);
  } finally {
    if (previousDeposit === undefined) {
      delete process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON;
    } else {
      process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = previousDeposit;
    }
  }
});

test("legal dong helper calls official API and exposes LAWD code", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test%2Fkey%3D%3D";
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("locatadd_nm"), "관악구");
      assert.equal(url.searchParams.get("type"), "json");
      assert.equal(url.searchParams.get("ServiceKey"), "test/key==");
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("legal dong helper fails clearly without public-data key", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  try {
    delete process.env.DATA_GO_KR_SERVICE_KEY;

    await assert.rejects(
      resolveLegalDongCode({ region: "관악구" }),
      /DATA_GO_KR_SERVICE_KEY is required/
    );
  } finally {
    if (previousKey !== undefined) process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
  }
});

test("rent market comparison parses live XML records", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("LAWD_CD"), "11620");
      assert.equal(url.searchParams.get("DEAL_YMD"), "202605");
      return new Response(`
        <response>
          <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
          <body><items>
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

    assert.match(text, /신고 표본 수: 1/);
    assert.match(text, /보증금 표본 수: 1/);
    assert.match(text, /관악테스트/);
    assert.match(text, /30,000만원/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("rent market comparison parses Korean public-data XML fields", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><items>
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("rent market comparison separates reported records from deposit median samples", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><items>
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("rent market comparison does not render fake dates when date tags are missing", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><items>
          <item>
            <aptNm>관악날짜누락</aptNm>
            <umdNm>봉천동</umdNm>
            <deposit>30,000</deposit>
            <monthlyRent>0</monthlyRent>
          </item>
        </items></body>
      </response>
    `);

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202605"
    });

    assert.match(text, /날짜 미확인/);
    assert.doesNotMatch(text, /--/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("rent market comparison surfaces public-data error payloads", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "bad-key";
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
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

    process.env.PUBLIC_DATA_TIMEOUT_MS = "0";
    assert.throws(() => publicDataTimeoutMs(), /PUBLIC_DATA_TIMEOUT_MS/);

    process.env.PUBLIC_DATA_TIMEOUT_MS = "60001";
    assert.throws(() => publicDataTimeoutMs(), /PUBLIC_DATA_TIMEOUT_MS/);

    process.env.PUBLIC_DATA_TIMEOUT_MS = "slow";
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
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousTimeout = process.env.PUBLIC_DATA_TIMEOUT_MS;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
    if (previousTimeout === undefined) {
      delete process.env.PUBLIC_DATA_TIMEOUT_MS;
    } else {
      process.env.PUBLIC_DATA_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("deposit-to-sale comparison parses sale XML and flags high ratio", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.match(url.href, /RTMSDataSvcAptTrade/);
      assert.equal(url.searchParams.get("LAWD_CD"), "11620");
      assert.equal(url.searchParams.get("DEAL_YMD"), "202605");
      return new Response(`
        <response>
          <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
          <body><items>
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

    assert.match(text, /매매 표본 수: 2/);
    assert.match(text, /매매가 대비 보증금 비율: 93.3%/);
    assert.match(text, /90% 이상/);
    assert.match(text, /특정 매물의 안전성/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("deposit-to-sale comparison parses Korean public-data XML fields", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><items>
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("deposit-to-sale comparison renders zero percent as a calculated ratio", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><items>
          <item>
            <aptNm>관악매매</aptNm>
            <umdNm>봉천동</umdNm>
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
      depositManwon: 0
    });

    assert.match(text, /매매가 대비 보증금 비율: 0%/);
    assert.doesNotMatch(text, /매매가 대비 보증금 비율: 계산 불가/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("one-shot lease assessment combines rent, sale, red flags, and actions", async () => {
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("LAWD_CD"), "11620");
      assert.equal(url.searchParams.get("DEAL_YMD"), "202605");
      if (url.href.includes("AptRent")) {
        return new Response(`
          <response>
            <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
            <body><items>
              <item>
                <aptNm>관악전세1</aptNm>
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
      }
      if (url.href.includes("AptTrade")) {
        return new Response(`
          <response>
            <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
            <body><items>
              <item>
                <aptNm>관악매매1</aptNm>
                <umdNm>봉천동</umdNm>
                <dealAmount>40,000</dealAmount>
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
      concerns: "대리계약이고 계약금을 빨리 보내라고 합니다"
    });

    assert.match(text, /전월세 안전 종합 진단/);
    assert.match(text, /종합 위험도: 매우 높음/);
    assert.match(text, /위험도 근거:/);
    assert.match(text, /전월세 신고 표본 1건/);
    assert.match(text, /보증금 산출 표본 1건/);
    assert.match(text, /매매 신고 표본 1건/);
    assert.match(text, /매매가 대비 보증금 비율 95%/);
    assert.match(text, /대리계약/);
    assert.match(text, /계약금 송금을 보류/);
    assert.match(text, /공식 출처/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) {
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("production app requires host allowlist", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.MCP_ALLOWED_HOSTS;
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";

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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("production app rejects unsafe host allowlist entries", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  try {
    process.env.NODE_ENV = "production";
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";

    for (const value of ["*", "https://example.com", "example.com/path", "bad host.example", "example.com:not-a-port"]) {
      process.env.MCP_ALLOWED_HOSTS = value;
      assert.throws(() => createApp(), /plain hostnames or host:port values/);
    }

    process.env.MCP_ALLOWED_HOSTS = "lease-safe.example.com,127.0.0.1:3000";
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("production app requires public-data key", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    delete process.env.DATA_GO_KR_SERVICE_KEY;

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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
  }
});

test("MCP auth token fails fast when configured too weakly", () => {
  const authEnvName = "MCP_AUTH" + "_TOKEN";
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousAuthToken = process.env[authEnvName];
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";

    process.env[authEnvName] = "short";
    assert.throws(() => createApp(), /MCP_AUTH_TOKEN must be at least 16 characters/);

    process.env[authEnvName] = "strong-test-token";
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
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
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousTimeout = process.env.PUBLIC_DATA_TIMEOUT_MS;
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
    if (previousTimeout === undefined) {
      delete process.env.PUBLIC_DATA_TIMEOUT_MS;
    } else {
      process.env.PUBLIC_DATA_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("production app fails fast on invalid public-data timeout configuration", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const previousTimeout = process.env.PUBLIC_DATA_TIMEOUT_MS;
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";
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
      delete process.env.DATA_GO_KR_SERVICE_KEY;
    } else {
      process.env.DATA_GO_KR_SERVICE_KEY = previousKey;
    }
    if (previousTimeout === undefined) {
      delete process.env.PUBLIC_DATA_TIMEOUT_MS;
    } else {
      process.env.PUBLIC_DATA_TIMEOUT_MS = previousTimeout;
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

    process.env.MCP_MAX_BODY_BYTES = "0";
    assert.throws(() => mcpMaxBodyBytes(), /positive integer/);

    process.env.MCP_MAX_BODY_BYTES = "not-a-number";
    assert.throws(() => mcpMaxBodyBytes(), /positive integer/);
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

    process.env.MCP_RATE_LIMIT_PER_MINUTE = "-1";
    assert.throws(() => mcpRateLimitPerMinute(), /non-negative integer/);

    process.env.MCP_RATE_LIMIT_PER_MINUTE = "fast";
    assert.throws(() => mcpRateLimitPerMinute(), /non-negative integer/);
  } finally {
    if (previousLimit === undefined) {
      delete process.env.MCP_RATE_LIMIT_PER_MINUTE;
    } else {
      process.env.MCP_RATE_LIMIT_PER_MINUTE = previousLimit;
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
  assert.match(text, /법률 자문/);
});

test("move-in plan includes official protection steps", () => {
  const text = buildMoveInProtectionPlan({ moveInDate: "2026-07-20", contractDate: "2026-07-01" });
  assert.match(text, /전입신고/);
  assert.match(text, /확정일자/);
  assert.match(text, /임대차 계약 신고/);
});

test("contract questions include HUG and lease report", () => {
  const text = prepareContractQuestions({ concerns: "전세 보증금이 큽니다" });
  assert.match(text, /전세보증금반환보증/);
  assert.match(text, /임대차신고/);
});

test("official help router maps lease report to RTMS", () => {
  const text = routeOfficialHelp({ issueType: "lease_report" });
  assert.match(text, /RTMS/);
  assert.match(text, /주택 임대차 계약 신고/);
});
