import { assessLeaseSafety, compareDepositToSaleMarket, compareRentMarket, resolveLegalDongCode } from "../src/domain.js";
import type { HousingType } from "../src/sources.js";

const HOUSING_TYPES = ["apartment", "rowhouse", "single_multi", "officetel"] as const satisfies readonly HousingType[];

function publicDataSmokeHousingTypes(): HousingType[] {
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

function depositManwon(): number {
  const value = Number(process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON ?? 30000);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("PUBLIC_DATA_SMOKE_DEPOSIT_MANWON must be a non-negative number.");
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
  const deposit = depositManwon();

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
    if (!rentMarket.includes("표본 수:")) {
      throw new Error(`Rent-market smoke did not return a sample count: ${housingType}`);
    }
    console.log(`rent_market[${housingType}]=ok`);

    const saleMarket = await compareDepositToSaleMarket({
      housingType,
      lawdCd,
      dealYmd,
      depositManwon: deposit
    });
    if (!saleMarket.includes("매매가 대비 보증금 비율:")) {
      throw new Error(`Sale-market smoke did not return a deposit-to-sale ratio: ${housingType}`);
    }
    console.log(`sale_market[${housingType}]=ok`);
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
  console.log("lease_assessment=ok");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
