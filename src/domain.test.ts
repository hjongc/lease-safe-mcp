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
  resolveLegalDongCode,
  routeOfficialHelp
} from "./domain.js";
import { createApp } from "./server.js";

test("data availability names automatic APIs and no fake fallback", () => {
  const text = explainDataAvailability();
  assert.match(text, /법정동코드/);
  assert.match(text, /전월세 실거래가/);
  assert.match(text, /HUG/);
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

    assert.match(text, /표본 수: 1/);
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

test("production app starts when required runtime configuration is present", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env.DATA_GO_KR_SERVICE_KEY;
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env.DATA_GO_KR_SERVICE_KEY = "test-key";

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
