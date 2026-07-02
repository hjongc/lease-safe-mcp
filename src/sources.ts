export type SourceConfidence = "official_national" | "public_agency";
const SOURCE_CONFIDENCE_VALUES = new Set<SourceConfidence>(["official_national", "public_agency"]);

export interface SourceRecord {
  id: string;
  title: string;
  sourceName: string;
  url: string;
  reviewedAt: string;
  confidence: SourceConfidence;
  useFor: string;
}

export interface RentApiSpec {
  housingType: HousingType;
  label: string;
  portalUrl: string;
  endpoint: string;
  operationId: string;
  nameField?: string;
}

export interface SaleApiSpec {
  housingType: HousingType;
  label: string;
  portalUrl: string;
  endpoint: string;
  operationId: string;
  nameField?: string;
}

export type HousingType = "apartment" | "rowhouse" | "single_multi" | "officetel";

export const REVIEWED_AT = "2026-06-30";
export const MAX_SOURCE_REVIEW_AGE_DAYS = 45;

export const SOURCES: SourceRecord[] = [
  {
    id: "mois-legal-dong-code",
    title: "행정표준코드 법정동코드 OpenAPI",
    sourceName: "행정안전부_행정표준코드_법정동코드",
    url: "https://www.data.go.kr/data/15077871/openapi.do",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "주소·지역명을 법정동 코드와 실거래 조회용 시군구 코드 후보로 변환"
  },
  {
    id: "molit-apartment-rent",
    title: "아파트 전월세 실거래가 OpenAPI",
    sourceName: "국토교통부_아파트 전월세 실거래가 자료",
    url: "https://www.data.go.kr/data/15126474/openapi.do",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "지역과 계약월 기준 아파트 전월세 신고 자료 조회"
  },
  {
    id: "molit-rowhouse-rent",
    title: "연립다세대 전월세 실거래가 OpenAPI",
    sourceName: "국토교통부_연립다세대 전월세 실거래가 자료",
    url: "https://www.data.go.kr/data/15126473/openapi.do",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "지역과 계약월 기준 연립다세대 전월세 신고 자료 조회"
  },
  {
    id: "molit-single-rent",
    title: "단독/다가구 전월세 실거래가 OpenAPI",
    sourceName: "국토교통부_단독/다가구 전월세 실거래가 자료",
    url: "https://www.data.go.kr/data/15126472/openapi.do",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "지역과 계약월 기준 단독/다가구 전월세 신고 자료 조회"
  },
  {
    id: "molit-officetel-rent",
    title: "오피스텔 전월세 실거래가 OpenAPI",
    sourceName: "국토교통부_오피스텔 전월세 실거래가 자료",
    url: "https://www.data.go.kr/data/15126475/openapi.do",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "지역과 계약월 기준 오피스텔 전월세 신고 자료 조회"
  },
  {
    id: "molit-apartment-sale",
    title: "아파트 매매 실거래가 OpenAPI",
    sourceName: "국토교통부_아파트 매매 실거래가 자료",
    url: "https://www.data.go.kr/data/15126469/openapi.do",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "지역과 계약월 기준 아파트 매매 신고 자료 조회 및 보증금-매매가 비율 참고"
  },
  {
    id: "molit-rowhouse-sale",
    title: "연립다세대 매매 실거래가 OpenAPI",
    sourceName: "국토교통부_연립다세대 매매 실거래가 자료",
    url: "https://www.data.go.kr/data/15126467/openapi.do",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "지역과 계약월 기준 연립다세대 매매 신고 자료 조회 및 보증금-매매가 비율 참고"
  },
  {
    id: "molit-single-sale",
    title: "단독/다가구 매매 실거래가 OpenAPI",
    sourceName: "국토교통부_단독/다가구 매매 실거래가 자료",
    url: "https://www.data.go.kr/data/15126465/openapi.do",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "지역과 계약월 기준 단독/다가구 매매 신고 자료 조회 및 보증금-매매가 비율 참고"
  },
  {
    id: "molit-officetel-sale",
    title: "오피스텔 매매 실거래가 OpenAPI",
    sourceName: "국토교통부_오피스텔 매매 실거래가 자료",
    url: "https://www.data.go.kr/data/15126464/openapi.do",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "지역과 계약월 기준 오피스텔 매매 신고 자료 조회 및 보증금-매매가 비율 참고"
  },
  {
    id: "gov24",
    title: "전입신고 및 생활 민원 공식 포털",
    sourceName: "정부24",
    url: "https://www.gov.kr/",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "전입신고, 민원 신청, 정부 서비스 확인 경로 안내"
  },
  {
    id: "rtms-lease-report",
    title: "주택 임대차 계약 신고 공식 시스템",
    sourceName: "국토교통부 부동산거래관리시스템",
    url: "https://rtms.molit.go.kr/",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "주택 임대차 계약 신고와 실거래가 공개 시스템 경로 안내"
  },
  {
    id: "iros-fixed-date",
    title: "확정일자 및 등기 확인 공식 경로",
    sourceName: "인터넷등기소",
    url: "https://www.iros.go.kr/",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "확정일자 신청과 등기부 확인 경로 안내"
  },
  {
    id: "easylaw-lease",
    title: "주택임대차 생활법령 안내",
    sourceName: "법제처 찾기쉬운 생활법령정보",
    url: "https://www.easylaw.go.kr/CSP/CsmMain.laf?csmSeq=629",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "대항력, 우선변제권, 전입신고, 계약, 보증금 보호 개념 설명"
  },
  {
    id: "law-lease",
    title: "주택임대차보호법",
    sourceName: "국가법령정보센터",
    url: "https://www.law.go.kr/법령/주택임대차보호법",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "주택임대차보호법 원문 확인 경로 안내"
  },
  {
    id: "adr-lease-dispute",
    title: "임대차분쟁조정과 표준계약서",
    sourceName: "한국부동산원·LH 임대차분쟁조정위원회",
    url: "https://adrhome.reb.or.kr/",
    reviewedAt: REVIEWED_AT,
    confidence: "public_agency",
    useFor: "분쟁조정 신청, 표준계약서, 조정사례, 전월세전환 계산 경로 안내"
  },
  {
    id: "hug-deposit-guarantee",
    title: "전세보증금반환보증 공식 확인 경로",
    sourceName: "HUG 주택도시보증공사",
    url: "https://www.khug.or.kr/",
    reviewedAt: REVIEWED_AT,
    confidence: "public_agency",
    useFor: "전세보증금반환보증 가입 가능 여부와 서류를 공식 경로에서 확인하도록 안내"
  },
  {
    id: "nts-tax",
    title: "임대인 국세·납세증명 확인 공식 경로",
    sourceName: "국세청",
    url: "https://www.nts.go.kr/",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "임대인 국세, 납세증명, 세무서 확인이 필요한 계약 전 질문 경로 안내"
  },
  {
    id: "wetax-local-tax",
    title: "지방세 납부·증명 공식 경로",
    sourceName: "위택스",
    url: "https://www.wetax.go.kr/",
    reviewedAt: REVIEWED_AT,
    confidence: "official_national",
    useFor: "임대인 지방세, 납부·증명 확인이 필요한 계약 전 질문 경로 안내"
  }
];

export const LEGAL_DONG_API = {
  portalUrl: "https://www.data.go.kr/data/15077871/openapi.do",
  endpoint: "http://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList",
  required: ["ServiceKey", "pageNo", "numOfRows", "type"],
  optional: ["locatadd_nm"],
  responseFields: ["region_cd", "sido_cd", "sgg_cd", "umd_cd", "ri_cd", "locatadd_nm", "locathigh_cd"]
} as const;

export const RENT_API_SPECS: Record<HousingType, RentApiSpec> = {
  apartment: {
    housingType: "apartment",
    label: "아파트",
    portalUrl: "https://www.data.go.kr/data/15126474/openapi.do",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
    operationId: "getRTMSDataSvcAptRent",
    nameField: "aptNm"
  },
  rowhouse: {
    housingType: "rowhouse",
    label: "연립다세대",
    portalUrl: "https://www.data.go.kr/data/15126473/openapi.do",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent",
    operationId: "getRTMSDataSvcRHRent",
    nameField: "mhouseNm"
  },
  single_multi: {
    housingType: "single_multi",
    label: "단독/다가구",
    portalUrl: "https://www.data.go.kr/data/15126472/openapi.do",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcSHRent/getRTMSDataSvcSHRent",
    operationId: "getRTMSDataSvcSHRent"
  },
  officetel: {
    housingType: "officetel",
    label: "오피스텔",
    portalUrl: "https://www.data.go.kr/data/15126475/openapi.do",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
    operationId: "getRTMSDataSvcOffiRent",
    nameField: "offiNm"
  }
};

export const SALE_API_SPECS: Record<HousingType, SaleApiSpec> = {
  apartment: {
    housingType: "apartment",
    label: "아파트",
    portalUrl: "https://www.data.go.kr/data/15126469/openapi.do",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
    operationId: "getRTMSDataSvcAptTrade",
    nameField: "aptNm"
  },
  rowhouse: {
    housingType: "rowhouse",
    label: "연립다세대",
    portalUrl: "https://www.data.go.kr/data/15126467/openapi.do",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade",
    operationId: "getRTMSDataSvcRHTrade",
    nameField: "mhouseNm"
  },
  single_multi: {
    housingType: "single_multi",
    label: "단독/다가구",
    portalUrl: "https://www.data.go.kr/data/15126465/openapi.do",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade",
    operationId: "getRTMSDataSvcSHTrade"
  },
  officetel: {
    housingType: "officetel",
    label: "오피스텔",
    portalUrl: "https://www.data.go.kr/data/15126464/openapi.do",
    endpoint: "https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
    operationId: "getRTMSDataSvcOffiTrade",
    nameField: "offiNm"
  }
};

export const KNOWN_LAWD_CODES = [
  { region: "서울특별시 종로구", lawdCd: "11110" },
  { region: "서울특별시 강남구", lawdCd: "11680" },
  { region: "서울특별시 관악구", lawdCd: "11620" },
  { region: "경기도 성남시 분당구", lawdCd: "41135" },
  { region: "경기도 수원시 팔달구", lawdCd: "41115" },
  { region: "부산광역시 해운대구", lawdCd: "26350" },
  { region: "인천광역시 연수구", lawdCd: "28185" }
];

function reviewedAtEpochMs(reviewedAt: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reviewedAt);
  if (!match) {
    throw new Error(`Source reviewedAt must use YYYY-MM-DD: ${reviewedAt}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epochMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(epochMs);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`Source reviewedAt must be a real calendar date: ${reviewedAt}`);
  }
  return epochMs;
}

export function sourceReviewAgeDays(reviewedAt: string, now = new Date()): number {
  const reviewedAtMs = reviewedAtEpochMs(reviewedAt);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((todayMs - reviewedAtMs) / 86_400_000);
}

export function assertFreshSourceReviews(sources: SourceRecord[] = SOURCES, now = new Date()): void {
  for (const source of sources) {
    const ageDays = sourceReviewAgeDays(source.reviewedAt, now);
    if (ageDays < 0) {
      throw new Error(`Official source review date must not be in the future: ${source.id} reviewedAt=${source.reviewedAt}`);
    }
    if (ageDays > MAX_SOURCE_REVIEW_AGE_DAYS) {
      throw new Error(`Official source review is stale: ${source.id} reviewedAt=${source.reviewedAt} ageDays=${ageDays} maxDays=${MAX_SOURCE_REVIEW_AGE_DAYS}`);
    }
  }
}

export function assertValidSourceRegistry(sources: SourceRecord[] = SOURCES, now = new Date()): void {
  if (sources.length === 0) {
    throw new Error("Official source registry must include at least one source.");
  }

  const seenIds = new Set<string>();
  for (const source of sources) {
    if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(source.id)) {
      throw new Error(`Official source id must be a stable lowercase slug: ${source.id}`);
    }
    if (seenIds.has(source.id)) {
      throw new Error(`Duplicate official source id in registry: ${source.id}`);
    }
    seenIds.add(source.id);

    for (const [fieldName, fieldValue] of Object.entries({
      title: source.title,
      sourceName: source.sourceName,
      useFor: source.useFor
    })) {
      if (fieldValue.trim().length === 0) {
        throw new Error(`Official source ${source.id} must include a non-empty ${fieldName}.`);
      }
    }

    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      throw new Error(`Official source ${source.id} must use a valid HTTPS URL.`);
    }
    if (url.protocol !== "https:") {
      throw new Error(`Official source ${source.id} must use an HTTPS URL.`);
    }
    if (!SOURCE_CONFIDENCE_VALUES.has(source.confidence)) {
      throw new Error(`Official source ${source.id} must use a supported confidence value.`);
    }
  }

  assertFreshSourceReviews(sources, now);
}

export function renderSources(ids?: string[]): string {
  const selected = ids ? SOURCES.filter(source => ids.includes(source.id)) : SOURCES;
  if (ids) {
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
      throw new Error(`Duplicate official source id: ${[...new Set(duplicateIds)].join(", ")}`);
    }
    const knownIds = new Set(SOURCES.map(source => source.id));
    const missingIds = ids.filter(id => !knownIds.has(id));
    if (missingIds.length > 0) {
      throw new Error(`Unknown official source id: ${missingIds.join(", ")}`);
    }
  }
  return selected
    .map(source => `- [${source.confidence}] ${source.sourceName}: ${source.url} (검토일: ${source.reviewedAt})`)
    .join("\n");
}
