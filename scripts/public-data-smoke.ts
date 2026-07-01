import { MONEY_INPUT_LIMITS, assessLeaseSafety, compareDepositToSaleMarket, compareRentMarket, isAllZeroLawdCd, isFutureDealYmd, resolveLegalDongCode } from "../src/domain.js";
import type { HousingType } from "../src/sources.js";

export const PUBLIC_DATA_SMOKE_HOUSING_TYPES = ["apartment", "rowhouse", "single_multi", "officetel"] as const satisfies readonly HousingType[];
const MAX_PUBLIC_DATA_SMOKE_REGION_LENGTH = 80;

export function positiveSampleCount(text: string, label: string, pattern: RegExp): number {
  const match = text.match(pattern);
  if (!match?.[1]) {
    throw new Error(`${label} smoke did not return a parseable sample count.`);
  }

  const count = Number(match[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`${label} smoke returned ${count} samples. Configure a region/month with live samples before registration.`);
  }

  return count;
}

export function publicDataSmokeHousingTypes(): HousingType[] {
  const raw = process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES?.trim();
  if (!raw) return [...PUBLIC_DATA_SMOKE_HOUSING_TYPES];

  const requested = raw.split(",").map(type => type.trim()).filter(Boolean);
  if (requested.length === 0) {
    throw new Error("PUBLIC_DATA_SMOKE_HOUSING_TYPES must include at least one supported housing type.");
  }

  const duplicates = requested.filter((type, index) => requested.indexOf(type) !== index);
  if (duplicates.length > 0) {
    throw new Error(`PUBLIC_DATA_SMOKE_HOUSING_TYPES contains duplicate values: ${[...new Set(duplicates)].join(",")}`);
  }

  for (const type of requested) {
    if (!PUBLIC_DATA_SMOKE_HOUSING_TYPES.includes(type as HousingType)) {
      throw new Error(`Unsupported PUBLIC_DATA_SMOKE_HOUSING_TYPES value: ${type}`);
    }
  }

  if (process.env.REQUIRE_LIVE_PUBLIC_DATA === "1") {
    const missingTypes = PUBLIC_DATA_SMOKE_HOUSING_TYPES.filter(type => !requested.includes(type));
    if (missingTypes.length > 0) {
      throw new Error(`PUBLIC_DATA_SMOKE_HOUSING_TYPES must include all supported housing types in registration preflight. Missing: ${missingTypes.join(",")}`);
    }
  }
  return requested as HousingType[];
}

export function publicDataSmokeDepositManwon(): number {
  const raw = process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON?.trim() ?? "30000";
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    throw new Error("PUBLIC_DATA_SMOKE_DEPOSIT_MANWON must be a plain positive integer in manwon.");
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MONEY_INPUT_LIMITS.depositManwon) {
    throw new Error(`PUBLIC_DATA_SMOKE_DEPOSIT_MANWON must be a positive integer no greater than ${MONEY_INPUT_LIMITS.depositManwon} manwon for registration-ready deposit-to-sale evidence.`);
  }
  return value;
}

export function publicDataSmokeRegion(): string {
  const rawRegion = process.env.PUBLIC_DATA_SMOKE_REGION;
  if (rawRegion === undefined) return "서울 관악구";

  const region = rawRegion.trim();
  if (region.length < 2) {
    throw new Error("PUBLIC_DATA_SMOKE_REGION must include at least 2 meaningful characters.");
  }
  if (/[\u0000-\u001F\u007F`]/.test(region)) {
    throw new Error("PUBLIC_DATA_SMOKE_REGION must not include control characters, line breaks, tabs, or Markdown backticks.");
  }
  if (/\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/.test(region) || /\b\d{6}[\s.-]?[1-4]\d{6}\b/.test(region) || /\b01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}\b/.test(region) || /\b0(?:2|[3-6][1-5]|70|80)[\s.-]?\d{3,4}[\s.-]?\d{4}\b/.test(region) || /(?:계좌(?:번호)?|입금\s*계좌|송금\s*계좌)\s*(?:은|는|:)?\s*\d{2,6}[\s-]\d{2,6}[\s-]\d{2,8}/.test(region) || /\b\d{1,4}\s*동\s*\d{1,4}\s*호/.test(region) || /\b\d{1,3}\s*층\s*\d{1,4}\s*호/.test(region) || /\b\d{2,4}\s*호/.test(region)) {
    throw new Error("PUBLIC_DATA_SMOKE_REGION must not include personal identifiers, email addresses, phone numbers, payment account details, or household unit details.");
  }
  if (region.length > MAX_PUBLIC_DATA_SMOKE_REGION_LENGTH) {
    throw new Error(`PUBLIC_DATA_SMOKE_REGION must be ${MAX_PUBLIC_DATA_SMOKE_REGION_LENGTH} characters or fewer.`);
  }
  return region;
}

export function publicDataSmokeLawdCd(): string {
  const lawdCd = process.env.PUBLIC_DATA_SMOKE_LAWD_CD?.trim() || "11620";
  if (!/^\d{5}$/.test(lawdCd)) {
    throw new Error("PUBLIC_DATA_SMOKE_LAWD_CD must be exactly 5 digits.");
  }
  if (isAllZeroLawdCd(lawdCd)) {
    throw new Error("PUBLIC_DATA_SMOKE_LAWD_CD must not be 00000.");
  }
  return lawdCd;
}

export function publicDataSmokeDealYmd(): string {
  const dealYmd = process.env.PUBLIC_DATA_SMOKE_DEAL_YMD?.trim() || "202605";
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(dealYmd)) {
    throw new Error("PUBLIC_DATA_SMOKE_DEAL_YMD must use YYYYMM format with a month from 01 to 12.");
  }
  if (isFutureDealYmd(dealYmd)) {
    throw new Error("PUBLIC_DATA_SMOKE_DEAL_YMD must not be in the future.");
  }
  return dealYmd;
}

export function assertLegalDongSmokeMatchesLawdCd(text: string, lawdCd: string): void {
  if (!/^\d{5}$/.test(lawdCd)) {
    throw new Error("PUBLIC_DATA_SMOKE_LAWD_CD must be exactly 5 digits.");
  }
  if (isAllZeroLawdCd(lawdCd)) {
    throw new Error("PUBLIC_DATA_SMOKE_LAWD_CD must not be 00000.");
  }
  if (!text.includes(`LAWD_CD ${lawdCd}`)) {
    throw new Error(`Legal-dong smoke did not return the configured LAWD_CD ${lawdCd}.`);
  }
}

export function publicDataSmokeConfigLine(region: string, lawdCd: string, dealYmd: string, housingTypes: HousingType[], depositManwon: number, registrationMode: boolean): string {
  return `public_data_smoke_config registration_mode=${registrationMode ? "true" : "false"} region=${JSON.stringify(region)} lawd_cd=${lawdCd} deal_ymd=${dealYmd} housing_types=${housingTypes.join(",")} deposit_manwon=${depositManwon}`;
}

async function main() {
  if (!process.env.DATA_GO_KR_SERVICE_KEY?.trim()) {
    throw new Error("DATA_GO_KR_SERVICE_KEY is required for live public-data smoke.");
  }

  const region = publicDataSmokeRegion();
  const lawdCd = publicDataSmokeLawdCd();
  const dealYmd = publicDataSmokeDealYmd();
  const housingTypes = publicDataSmokeHousingTypes();
  const deposit = publicDataSmokeDepositManwon();

  console.log(publicDataSmokeConfigLine(region, lawdCd, dealYmd, housingTypes, deposit, process.env.REQUIRE_LIVE_PUBLIC_DATA === "1"));

  const legalDong = await resolveLegalDongCode({ region });
  assertLegalDongSmokeMatchesLawdCd(legalDong, lawdCd);
  console.log("legal_dong=ok");

  for (const housingType of housingTypes) {
    const rentMarket = await compareRentMarket({
      housingType,
      lawdCd,
      dealYmd
    });
    const rentSampleCount = positiveSampleCount(rentMarket, `Rent-market[${housingType}]`, /신고 표본 수:\s*([\d,]+)/);
    console.log(`rent_market[${housingType}]=ok samples=${rentSampleCount}`);

    const saleMarket = await compareDepositToSaleMarket({
      housingType,
      lawdCd,
      dealYmd,
      depositManwon: deposit
    });
    const saleSampleCount = positiveSampleCount(saleMarket, `Sale-market[${housingType}]`, /매매 표본 수:\s*([\d,]+)/);
    if (!saleMarket.includes("매매가 대비 보증금 비율:")) {
      throw new Error(`Sale-market smoke did not return a deposit-to-sale ratio: ${housingType}`);
    }
    console.log(`sale_market[${housingType}]=ok samples=${saleSampleCount}`);

    const assessment = await assessLeaseSafety({
      housingType,
      lawdCd,
      dealYmd,
      region,
      depositManwon: deposit,
      concerns: "공공데이터 실 API 스모크"
    });
    if (!assessment.includes("전월세 안전 종합 진단") || !assessment.includes("매매가 대비 보증금 비율")) {
      throw new Error(`One-shot assessment smoke did not return the expected summary: ${housingType}`);
    }
    const assessmentRentCount = positiveSampleCount(assessment, `Lease-assessment[${housingType}] rent`, /전월세 신고 표본\s*([\d,]+)건/);
    const assessmentSaleCount = positiveSampleCount(assessment, `Lease-assessment[${housingType}] sale`, /매매 신고 표본\s*([\d,]+)건/);
    console.log(`lease_assessment[${housingType}]=ok rent_samples=${assessmentRentCount} sale_samples=${assessmentSaleCount}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
