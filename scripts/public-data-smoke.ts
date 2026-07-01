import { assessLeaseSafety, compareDepositToSaleMarket, compareRentMarket, resolveLegalDongCode } from "../src/domain.js";
import type { HousingType } from "../src/sources.js";

const HOUSING_TYPES = ["apartment", "rowhouse", "single_multi", "officetel"] as const satisfies readonly HousingType[];

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
  if (!raw) return [...HOUSING_TYPES];

  const requested = raw.split(",").map(type => type.trim()).filter(Boolean);
  for (const type of requested) {
    if (!HOUSING_TYPES.includes(type as HousingType)) {
      throw new Error(`Unsupported PUBLIC_DATA_SMOKE_HOUSING_TYPES value: ${type}`);
    }
  }
  return requested as HousingType[];
}

export function publicDataSmokeDepositManwon(): number {
  const value = Number(process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON ?? 30000);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("PUBLIC_DATA_SMOKE_DEPOSIT_MANWON must be a positive number for registration-ready deposit-to-sale evidence.");
  }
  return value;
}

async function main() {
  if (!process.env.DATA_GO_KR_SERVICE_KEY?.trim()) {
    throw new Error("DATA_GO_KR_SERVICE_KEY is required for live public-data smoke.");
  }

  const region = process.env.PUBLIC_DATA_SMOKE_REGION ?? "서울 관악구";
  const lawdCd = process.env.PUBLIC_DATA_SMOKE_LAWD_CD ?? "11620";
  const dealYmd = process.env.PUBLIC_DATA_SMOKE_DEAL_YMD ?? "202605";
  const housingTypes = publicDataSmokeHousingTypes();
  const deposit = publicDataSmokeDepositManwon();

  const legalDong = await resolveLegalDongCode({ region });
  if (!legalDong.includes("LAWD_CD")) {
    throw new Error("Legal-dong smoke did not return a LAWD_CD candidate.");
  }
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
  }

  const assessment = await assessLeaseSafety({
    housingType: housingTypes[0],
    lawdCd,
    dealYmd,
    region,
    depositManwon: deposit,
    concerns: "공공데이터 실 API 스모크"
  });
  if (!assessment.includes("전월세 안전 종합 진단") || !assessment.includes("매매가 대비 보증금 비율")) {
    throw new Error("One-shot assessment smoke did not return the expected summary.");
  }
  const assessmentRentCount = positiveSampleCount(assessment, "Lease-assessment rent", /전월세 신고 표본\s*([\d,]+)건/);
  const assessmentSaleCount = positiveSampleCount(assessment, "Lease-assessment sale", /매매 신고 표본\s*([\d,]+)건/);
  console.log(`lease_assessment=ok rent_samples=${assessmentRentCount} sale_samples=${assessmentSaleCount}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
