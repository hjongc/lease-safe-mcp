import test from "node:test";
import assert from "node:assert/strict";
import {
  assessLeaseSafety,
  buildMoveInProtectionPlan,
  checkLeaseRedFlags,
  compareDepositToSaleMarket,
  compareRentMarket,
  dataGoKrServiceKey,
  explainDataAvailability,
  prepareContractQuestions,
  publicDataTimeoutMs,
  resolveLegalDongCode,
  routeOfficialHelp
} from "./domain.js";
import { createApp, httpPort, mcpMaxBodyBytes, mcpRateLimitPerMinute, pruneExpiredRateLimitWindows } from "./server.js";
import { assertLegalDongSmokeMatchesLawdCd, positiveSampleCount, publicDataSmokeDealYmd, publicDataSmokeDepositManwon, publicDataSmokeHousingTypes, publicDataSmokeLawdCd, publicDataSmokeRegion } from "../scripts/public-data-smoke.js";
import { scanLine } from "../scripts/secret-scan.js";

const PUBLIC_DATA_KEY_ENV_NAME = ["DATA_GO_KR", "SERVICE_KEY"].join("_");
const VALID_TEST_SERVICE_KEY = [
  "LeaseSafePublicDataSmokeKey",
  "OnlyForTests1234567890+/",
  "=="
].join("");
const VALID_TEST_SERVICE_KEY_ENCODED = encodeURIComponent(VALID_TEST_SERVICE_KEY);

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
    assert.throws(() => publicDataSmokeDepositManwon(), /positive integer/);

    process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = "-1";
    assert.throws(() => publicDataSmokeDepositManwon(), /positive integer/);

    process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON = "30000.5";
    assert.throws(() => publicDataSmokeDepositManwon(), /positive integer/);
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

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구 010 1234 5678";
    assert.throws(() => publicDataSmokeRegion(), /must not include personal identifiers, email addresses, or phone numbers/);

    process.env.PUBLIC_DATA_SMOKE_REGION = "서울 관악구 user@example.com";
    assert.throws(() => publicDataSmokeRegion(), /must not include personal identifiers, email addresses, or phone numbers/);
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

    process.env.PUBLIC_DATA_SMOKE_LAWD_CD = "11110";
    process.env.PUBLIC_DATA_SMOKE_DEAL_YMD = "202613";
    assert.throws(() => publicDataSmokeDealYmd(), /PUBLIC_DATA_SMOKE_DEAL_YMD must use YYYYMM format/);
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
  try {
    delete process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES;
    assert.deepEqual(publicDataSmokeHousingTypes(), ["apartment", "rowhouse", "single_multi", "officetel"]);

    process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = "apartment,rowhouse";
    assert.deepEqual(publicDataSmokeHousingTypes(), ["apartment", "rowhouse"]);

    process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES = ",";
    assert.throws(() => publicDataSmokeHousingTypes(), /at least one supported housing type/);

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
  }
});

test("public-data smoke requires legal-dong proof for configured LAWD code", () => {
  const legalDongText = [
    "## 법정동 코드 확인",
    "- 서울특별시 관악구 봉천동: 법정동코드 1162010100 / LAWD_CD 11620"
  ].join("\n");

  assert.doesNotThrow(() => assertLegalDongSmokeMatchesLawdCd(legalDongText, "11620"));
  assert.throws(
    () => assertLegalDongSmokeMatchesLawdCd(legalDongText, "11110"),
    /did not return the configured LAWD_CD 11110/
  );
  assert.throws(
    () => assertLegalDongSmokeMatchesLawdCd(legalDongText, "1162"),
    /PUBLIC_DATA_SMOKE_LAWD_CD must be exactly 5 digits/
  );
});

test("legal dong helper calls official API and exposes LAWD code", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY_ENCODED;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
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
      resolveLegalDongCode({ region: "서울 관악구 010-1234-5678" }),
      /region must not include personal identifiers, email addresses, or phone numbers/
    );

    await assert.rejects(
      resolveLegalDongCode({ region: "서울 관악구 user@example.com" }),
      /region must not include personal identifiers, email addresses, or phone numbers/
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
      compareDepositToSaleMarket({ housingType: "apartment", lawdCd: "11620", dealYmd: "202613", depositManwon: 30000 }),
      /DEAL_YMD must use YYYYMM format/
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
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison does not render fake dates when date tags are missing", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
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
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("rent market comparison does not render impossible calendar dates", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><items>
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

    const text = await compareRentMarket({
      housingType: "apartment",
      lawdCd: "11620",
      dealYmd: "202602"
    });

    assert.match(text, /날짜 미확인/);
    assert.doesNotMatch(text, /2026-02-31/);
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
        <body><items></items></body>
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

test("rent market comparison rejects malformed money fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><items>
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

test("rent market comparison rejects empty required money fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
        <body><items>
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
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
    }
  }
});

test("deposit-to-sale comparison renders zero percent as a calculated ratio", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
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
        <body><items></items></body>
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

test("deposit-to-sale comparison rejects malformed sale amount fields", async () => {
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousFetch = globalThis.fetch;
  try {
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
    globalThis.fetch = async () => new Response(`
      <response>
        <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
        <body><items>
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
        <body><items>
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
  try {
    process.env.NODE_ENV = "production";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;

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
      delete process.env[PUBLIC_DATA_KEY_ENV_NAME];
    } else {
      process.env[PUBLIC_DATA_KEY_ENV_NAME] = previousKey;
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
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
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
  }
});

test("production app fails fast on invalid public-data timeout configuration", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowedHosts = process.env.MCP_ALLOWED_HOSTS;
  const previousKey = process.env[PUBLIC_DATA_KEY_ENV_NAME];
  const previousTimeout = process.env.PUBLIC_DATA_TIMEOUT_MS;
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "127.0.0.1,localhost";
    process.env[PUBLIC_DATA_KEY_ENV_NAME] = VALID_TEST_SERVICE_KEY;
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

test("MCP rate limiter prunes expired client windows", () => {
  const windows = new Map([
    ["expired", { count: 3, resetAt: 1000 }],
    ["active", { count: 1, resetAt: 2000 }]
  ]);

  pruneExpiredRateLimitWindows(windows, 1500);

  assert.equal(windows.has("expired"), false);
  assert.equal(windows.has("active"), true);
});

test("HTTP port is explicit and fails fast on invalid configuration", () => {
  const previousPort = process.env.PORT;
  try {
    delete process.env.PORT;
    assert.equal(httpPort(), 3000);

    process.env.PORT = "8080";
    assert.equal(httpPort(), 8080);

    process.env.PORT = "0";
    assert.throws(() => httpPort(), /PORT must be an integer between 1 and 65535/);

    process.env.PORT = "65536";
    assert.throws(() => httpPort(), /PORT must be an integer between 1 and 65535/);

    process.env.PORT = "not-a-port";
    assert.throws(() => httpPort(), /PORT must be an integer between 1 and 65535/);
  } finally {
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
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

test("contract questions redact contact details from user text", () => {
  const text = prepareContractQuestions({
    concerns: "연락은 user@example.com 또는 010 1234 5678로 주세요. 주민번호는 900101 1234567입니다."
  });

  assert.match(text, /\[이메일 생략\]/);
  assert.match(text, /\[연락처 생략\]/);
  assert.match(text, /\[민감번호 생략\]/);
  assert.doesNotMatch(text, /user@example\.com/);
  assert.doesNotMatch(text, /010 1234 5678/);
  assert.doesNotMatch(text, /900101 1234567/);
});

test("official help router maps lease report to RTMS", () => {
  const text = routeOfficialHelp({ issueType: "lease_report" });
  assert.match(text, /RTMS/);
  assert.match(text, /주택 임대차 계약 신고/);
});
