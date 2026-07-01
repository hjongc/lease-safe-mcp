import { assessLeaseSafety, compareDepositToSaleMarket, compareRentMarket, resolveLegalDongCode } from "../src/domain.js";

async function main() {
  if (!process.env.DATA_GO_KR_SERVICE_KEY?.trim()) {
    throw new Error("DATA_GO_KR_SERVICE_KEY is required for live public-data smoke.");
  }

  const region = process.env.PUBLIC_DATA_SMOKE_REGION ?? "서울 관악구";
  const lawdCd = process.env.PUBLIC_DATA_SMOKE_LAWD_CD ?? "11620";
  const dealYmd = process.env.PUBLIC_DATA_SMOKE_DEAL_YMD ?? "202605";

  const legalDong = await resolveLegalDongCode({ region });
  if (!legalDong.includes("LAWD_CD")) {
    throw new Error("Legal-dong smoke did not return a LAWD_CD candidate.");
  }
  console.log("legal_dong=ok");

  const rentMarket = await compareRentMarket({
    housingType: "apartment",
    lawdCd,
    dealYmd
  });
  if (!rentMarket.includes("표본 수:")) {
    throw new Error("Rent-market smoke did not return a sample count.");
  }
  console.log("rent_market=ok");

  const saleMarket = await compareDepositToSaleMarket({
    housingType: "apartment",
    lawdCd,
    dealYmd,
    depositManwon: Number(process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON ?? 30000)
  });
  if (!saleMarket.includes("매매가 대비 보증금 비율:")) {
    throw new Error("Sale-market smoke did not return a deposit-to-sale ratio.");
  }
  console.log("sale_market=ok");

  const assessment = await assessLeaseSafety({
    housingType: "apartment",
    lawdCd,
    dealYmd,
    region,
    depositManwon: Number(process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON ?? 30000),
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
