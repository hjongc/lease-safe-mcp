import { LEGAL_DONG_API, RENT_API_SPECS, SALE_API_SPECS, renderSources, SOURCES, type HousingType } from "./sources.js";

const DEFAULT_PUBLIC_DATA_TIMEOUT_MS = 8000;
const MAX_PUBLIC_DATA_TIMEOUT_MS = 60000;
const DATA_GO_KR_SERVICE_KEY_PLACEHOLDERS = new Set([
  "...",
  "your-data-go-kr-service-key",
  "replace-with-data-go-kr-service-key",
  "data-go-kr-service-key"
]);
const MIN_DATA_GO_KR_SERVICE_KEY_LENGTH = 40;
const MAX_LEGAL_DONG_REGION_LENGTH = 80;

export const MONEY_INPUT_LIMITS = {
  depositManwon: 10_000_000,
  monthlyRentManwon: 100_000
} as const;

export interface LeaseProfileInput {
  situation?: string;
  region?: string;
  housingType?: HousingType | "unknown";
  contractType?: "jeonse" | "monthly_rent" | "unknown";
  depositManwon?: number;
  monthlyRentManwon?: number;
  moveInDate?: string;
  contractDate?: string;
  concerns?: string;
}

export interface RentRecord {
  name?: string;
  legalDong?: string;
  area?: number;
  depositManwon: number;
  monthlyRentManwon: number;
  contractDate: string;
  floor?: string;
  contractType?: string;
}

export interface SaleRecord {
  name?: string;
  legalDong?: string;
  area?: number;
  dealAmountManwon: number;
  contractDate: string;
  floor?: string;
}

interface RentMarketSnapshot {
  label: string;
  lawdCd: string;
  dealYmd: string;
  sampleCount: number;
  depositSampleCount: number;
  median?: number;
  max?: number;
  userDeposit?: number;
  userMonthlyRent?: number;
  position: string;
  records: RentRecord[];
  sourceId: string;
}

interface SaleMarketSnapshot {
  label: string;
  lawdCd: string;
  dealYmd: string;
  sampleCount: number;
  median?: number;
  max?: number;
  userDeposit: number;
  ratio?: number;
  signal: string;
  records: SaleRecord[];
  sourceId: string;
}

interface AssessmentRiskSummary {
  level: "매우 높음" | "높음" | "주의" | "보통";
  score: number;
  reasons: string[];
}

interface LegalDongRecord {
  regionName: string;
  regionCode: string;
  lawdCd: string;
}

function lineItems(items: string[]): string {
  return items.map(item => `- ${item}`).join("\n");
}

function cleanText(value: string | undefined, fallback = "미확인"): string {
  const trimmed = value?.trim();
  if (!trimmed || ["unknown", "undefined", "null", "미상", "미정", "모름"].includes(trimmed.toLowerCase())) return fallback;
  return trimmed
    .replace(/\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g, "[이메일 생략]")
    .replace(/\b\d{6}[\s.-]?[1-4]\d{6}\b/g, "[민감번호 생략]")
    .replace(/\b01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}\b/g, "[연락처 생략]")
    .replace(/\b0(?:2|[3-6][1-5]|70|80)[\s.-]?\d{3,4}[\s.-]?\d{4}\b/g, "[연락처 생략]")
    .replace(/\s+/g, " ");
}

function money(value: number | undefined): string {
  if (!Number.isFinite(value)) return "미입력";
  return `${Math.round(value as number).toLocaleString("ko-KR")}만원`;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function sourceIdFor(kind: "rent" | "sale", housingType: HousingType): string {
  return `molit-${housingType === "single_multi" ? "single" : housingType}-${kind}`;
}

function officialNotice(): string {
  return [
    "## 확인 필요",
    "전월세안전내비는 계약 전 점검과 공식 확인 경로를 정리하는 도구입니다. 법률 자문, 등기부 권리분석 확정, 보증보험 가입 가능 여부, 특정 매물 안전성 판단은 제공하지 않습니다."
  ].join("\n");
}

function inferRiskSignals(input: LeaseProfileInput): string[] {
  const text = `${input.situation ?? ""} ${input.concerns ?? ""}`.toLowerCase();
  const signals: string[] = [];

  if (/대리|위임|명의|소유자|집주인/.test(text)) {
    signals.push("계약 상대방과 등기부 소유자가 일치하는지, 대리계약이면 위임장·인감증명·본인 통화 확인이 필요합니다.");
  }
  if (/근저당|압류|가압류|경매|채권/.test(text)) {
    signals.push("근저당·압류·가압류·경매 관련 표현이 있으면 잔금 전 등기부 재확인과 전문가 상담 우선입니다.");
  }
  if (/전입|확정|신고/.test(text) || input.moveInDate) {
    signals.push("전입신고, 확정일자, 임대차신고는 보증금 보호의 기본 확인 항목입니다.");
  }
  if ((input.depositManwon ?? 0) >= 10000) {
    signals.push("보증금이 큰 계약이므로 주변 실거래, 등기부 선순위 권리, 보증보험 가능 여부를 같은 날 확인하세요.");
  }
  if (/신축|다가구|원룸|빌라/.test(text)) {
    signals.push("신축·다가구·빌라·원룸은 호수별 권리관계와 선순위 보증금 파악이 어려울 수 있어 중개사에게 확인자료를 요구하세요.");
  }
  if (/빨리|오늘|가계약|계약금|선입금/.test(text)) {
    signals.push("계약금·가계약금을 서두르라는 압박이 있으면 등기부, 소유자, 특약, 반환 조건을 확인하기 전 송금하지 마세요.");
  }

  return signals.length > 0 ? signals : ["현재 입력만으로 확정 위험을 말할 수는 없지만, 등기부·전입신고·확정일자·임대차신고·보증보험 가능 여부는 반드시 확인해야 합니다."];
}

export function explainDataAvailability(): string {
  return [
    "## 실제 데이터 조달 가능성",
    "자동 연동 가능",
    lineItems([
      `법정동코드: ${LEGAL_DONG_API.endpoint} / 지역명 검색 후 10자리 법정동 코드와 실거래 조회용 앞 5자리 코드 사용`,
      "국토교통부 전월세 실거래가: 아파트, 연립다세대, 단독/다가구, 오피스텔별 OpenAPI / LAWD_CD, DEAL_YMD, serviceKey 필요",
      "국토교통부 매매 실거래가: 아파트, 연립다세대, 단독/다가구, 오피스텔별 OpenAPI / 보증금-매매가 비율 참고"
    ]),
    "",
    "수동 검토 레지스트리 권장",
    lineItems([
      "정부24 전입신고, RTMS 임대차신고, 인터넷등기소 확정일자·등기부 확인은 공식 링크와 절차 규칙으로 관리",
      "주택임대차보호법, 생활법령, 임대차분쟁조정위원회 자료는 검토일이 있는 규칙 데이터로 관리",
      "HUG 보증보험은 공식 확인 경로와 질문 체크리스트로 안내하고 가입 가능 여부는 확정하지 않음"
    ]),
    "",
    "## 공식 출처",
    renderSources()
  ].join("\n");
}

export function dataGoKrServiceKey(): string {
  const rawServiceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!rawServiceKey) {
    throw new Error("DATA_GO_KR_SERVICE_KEY is required for live public-data lookup. 샘플 데이터로 대체하지 않습니다.");
  }

  if (DATA_GO_KR_SERVICE_KEY_PLACEHOLDERS.has(rawServiceKey.toLowerCase())) {
    throw new Error("DATA_GO_KR_SERVICE_KEY must be a real data.go.kr service key, not a placeholder.");
  }

  let serviceKey: string;
  try {
    serviceKey = rawServiceKey.includes("%") ? decodeURIComponent(rawServiceKey) : rawServiceKey;
  } catch {
    throw new Error("DATA_GO_KR_SERVICE_KEY must be a valid percent-encoded or decoded data.go.kr service key.");
  }

  if (DATA_GO_KR_SERVICE_KEY_PLACEHOLDERS.has(serviceKey.toLowerCase())) {
    throw new Error("DATA_GO_KR_SERVICE_KEY must be a real data.go.kr service key, not a placeholder.");
  }
  if (serviceKey.length < MIN_DATA_GO_KR_SERVICE_KEY_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(serviceKey)) {
    throw new Error("DATA_GO_KR_SERVICE_KEY must look like a real data.go.kr service key.");
  }
  return serviceKey;
}

export function publicDataTimeoutMs(): number {
  const rawTimeout = process.env.PUBLIC_DATA_TIMEOUT_MS?.trim();
  if (!rawTimeout) return DEFAULT_PUBLIC_DATA_TIMEOUT_MS;

  const parsed = parsePlainInteger(rawTimeout);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_PUBLIC_DATA_TIMEOUT_MS) {
    throw new Error(`PUBLIC_DATA_TIMEOUT_MS must be a positive integer no greater than ${MAX_PUBLIC_DATA_TIMEOUT_MS}.`);
  }
  return parsed;
}

function parsePlainInteger(value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
}

export function isFutureDealYmd(dealYmd: string, now = new Date()): boolean {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(dealYmd)) return false;
  const dealYear = Number(dealYmd.slice(0, 4));
  const dealMonth = Number(dealYmd.slice(4, 6));
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  return dealYear > currentYear || (dealYear === currentYear && dealMonth > currentMonth);
}

export function isAllZeroLawdCd(lawdCd: string): boolean {
  return lawdCd === "00000";
}

function validateMarketQuery(lawdCd: string, dealYmd: string): void {
  if (!/^\d{5}$/.test(lawdCd)) {
    throw new Error("LAWD_CD must be exactly 5 digits.");
  }
  if (isAllZeroLawdCd(lawdCd)) {
    throw new Error("LAWD_CD must not be 00000.");
  }
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(dealYmd)) {
    throw new Error("DEAL_YMD must use YYYYMM format with a month from 01 to 12.");
  }
  if (isFutureDealYmd(dealYmd)) {
    throw new Error("DEAL_YMD must not be in the future.");
  }
}

function moneyInputLimit(label: keyof typeof MONEY_INPUT_LIMITS): number {
  return MONEY_INPUT_LIMITS[label];
}

function assertOptionalNonNegativeManwon(label: keyof typeof MONEY_INPUT_LIMITS, value: unknown): asserts value is number | undefined {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative integer number of manwon.`);
  }
  const limit = moneyInputLimit(label);
  if (value > limit) {
    throw new Error(`${label} must be no greater than ${limit} manwon.`);
  }
}

function assertRequiredNonNegativeManwon(label: keyof typeof MONEY_INPUT_LIMITS, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative integer number of manwon.`);
  }
  const limit = moneyInputLimit(label);
  if (value > limit) {
    throw new Error(`${label} must be no greater than ${limit} manwon.`);
  }
}

function assertSupportedHousingType(housingType: string): asserts housingType is HousingType {
  if (!["apartment", "rowhouse", "single_multi", "officetel"].includes(housingType)) {
    throw new Error("housingType must be one of apartment, rowhouse, single_multi, or officetel.");
  }
}

function isAbortLikeError(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return name === "AbortError" || name === "TimeoutError";
}

function dataGoKrServiceKeyRedactionValues(): string[] {
  const rawServiceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!rawServiceKey) return [];

  const values = [rawServiceKey];
  try {
    const decoded = decodeURIComponent(rawServiceKey);
    if (decoded !== rawServiceKey) values.push(decoded);
  } catch {
    // Redaction must never hide the original public-data failure.
  }
  return values.sort((a, b) => b.length - a.length);
}

function redactDataGoKrServiceKeys(value: string): string {
  let redacted = value;
  for (const serviceKey of dataGoKrServiceKeyRedactionValues()) {
    redacted = redacted.split(serviceKey).join("[DATA_GO_KR_SERVICE_KEY 생략]");
  }
  return redacted;
}

function compactPublicDataResponseExcerpt(body: string): string {
  return redactDataGoKrServiceKeys(body.replace(/\s+/g, " ").trim().slice(0, 200));
}

async function fetchPublicDataText(label: string, url: URL): Promise<string> {
  const timeoutMs = publicDataTimeoutMs();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(`${label} request timed out after ${timeoutMs}ms.`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} request failed before receiving a response: ${message}`, { cause: error });
  }

  const body = await response.text();
  if (!response.ok) {
    const status = response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
    const excerpt = compactPublicDataResponseExcerpt(body);
    throw new Error(`${label} request failed: ${status}${excerpt ? ` - ${excerpt}` : ""}`);
  }
  return body;
}

function publicDataErrorMessage(body: string): string | undefined {
  const xmlErrorCode = extractTag(body, "returnReasonCode") ?? extractTag(body, "resultCode");
  const xmlErrorMessage = extractTag(body, "returnAuthMsg") ?? extractTag(body, "returnReasonMsg") ?? extractTag(body, "resultMsg");
  if (xmlErrorCode && !["00", "000", "INFO-000", "INFO-0"].includes(xmlErrorCode.trim())) {
    return redactDataGoKrServiceKeys(`${xmlErrorCode.trim()} ${xmlErrorMessage ?? "public-data API error"}`.trim());
  }
  if (/SERVICE_KEY|LIMITED_NUMBER_OF_SERVICE_REQUESTS|INVALID_REQUEST_PARAMETER|APPLICATION_ERROR/i.test(body)) {
    return redactDataGoKrServiceKeys(xmlErrorMessage ?? "public-data API returned an error payload");
  }
  return undefined;
}

function assertPublicDataXmlPayload(label: string, body: string): void {
  const recognizedXmlMarkers = [
    /<\s*response\b/i,
    /<\s*OpenAPI_ServiceResponse\b/i,
    /<\s*items\b/i,
    /<\s*item\b/i,
    /<\s*resultCode\b/i,
    /<\s*returnReasonCode\b/i
  ];
  if (!recognizedXmlMarkers.some(marker => marker.test(body))) {
    throw new Error(`${label} returned unrecognized XML payload.`);
  }
}

function assertPublicDataResultCode(label: string, body: string): void {
  const resultCode = extractTag(body, "resultCode")?.trim();
  if (!resultCode) {
    throw new Error(`${label} returned XML without resultCode.`);
  }
  if (!["00", "000", "INFO-000", "INFO-0"].includes(resultCode)) {
    const resultMsg = extractTag(body, "resultMsg") ?? "public-data API error";
    throw new Error(`${label} returned error: ${resultCode} ${redactDataGoKrServiceKeys(resultMsg)}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseLegalDongRows(payload: unknown): LegalDongRecord[] {
  const root = asRecord(payload);
  if (!Array.isArray(root?.StanReginCd)) {
    throw new Error("행정표준코드 법정동코드 API returned unrecognized JSON payload.");
  }
  const stanReginCd = root.StanReginCd;
  const resultHead = stanReginCd
    .map(item => asRecord(item)?.head)
    .find(head => Array.isArray(head)) as unknown[] | undefined;
  const result = resultHead?.map(item => asRecord(item)?.RESULT).find(Boolean);
  const resultRecord = asRecord(result);
  const resultCode = typeof resultRecord?.resultCode === "string" ? resultRecord.resultCode : undefined;
  if (!resultCode) {
    throw new Error("행정표준코드 법정동코드 API returned JSON without RESULT.resultCode.");
  }
  if (resultCode && !["INFO-000", "INFO-0", "00", "000"].includes(resultCode)) {
    const resultMsg = typeof resultRecord?.resultMsg === "string" ? resultRecord.resultMsg : "legal-dong API error";
    throw new Error(`행정표준코드 법정동코드 API returned error: ${resultCode} ${redactDataGoKrServiceKeys(resultMsg)}`);
  }

  const rowContainer = stanReginCd.map(item => asRecord(item)?.row).find(row => Array.isArray(row)) as unknown[] | undefined;
  const rows = rowContainer ?? [];
  const records: LegalDongRecord[] = [];

  for (const row of rows) {
    const record = asRecord(row);
    const regionCode = typeof record?.region_cd === "string" ? record.region_cd.trim() : "";
    const regionName = typeof record?.locatadd_nm === "string" ? record.locatadd_nm.trim() : "";
    if (!/^\d{10}$/.test(regionCode) || !regionName) {
      throw new Error("행정표준코드 법정동코드 API returned malformed row fields.");
    }
    records.push({
      regionName,
      regionCode,
      lawdCd: regionCode.slice(0, 5)
    });
  }
  return records;
}

function legalDongRegionQuery(region: string | undefined): string {
  const cleaned = cleanText(region);
  if (cleaned === "미확인" || cleaned.length < 2) {
    throw new Error("region must include at least 2 meaningful characters for legal-dong lookup.");
  }
  if (cleaned.includes("[민감번호 생략]") || cleaned.includes("[연락처 생략]") || cleaned.includes("[이메일 생략]")) {
    throw new Error("region must not include personal identifiers, email addresses, or phone numbers for legal-dong lookup.");
  }
  if (cleaned.length > MAX_LEGAL_DONG_REGION_LENGTH) {
    throw new Error(`region must be ${MAX_LEGAL_DONG_REGION_LENGTH} characters or fewer for legal-dong lookup.`);
  }
  return cleaned;
}

export async function resolveLegalDongCode(input: { region: string }): Promise<string> {
  const region = legalDongRegionQuery(input.region);
  const serviceKey = dataGoKrServiceKey();
  const url = new URL(LEGAL_DONG_API.endpoint);
  url.searchParams.set("ServiceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "20");
  url.searchParams.set("type", "json");
  url.searchParams.set("locatadd_nm", region);

  const body = await fetchPublicDataText("행정표준코드 법정동코드 API", url);
  const publicDataError = publicDataErrorMessage(body);
  if (publicDataError) {
    throw new Error(`행정표준코드 법정동코드 API returned error: ${publicDataError}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error(`행정표준코드 법정동코드 API returned invalid JSON: ${(error as Error).message}`);
  }
  const matches = parseLegalDongRows(payload);

  return [
    "## 법정동 코드 확인",
    matches.length > 0
      ? matches.map(item => `- ${item.regionName}: 법정동코드 ${item.regionCode} / LAWD_CD ${item.lawdCd}`).join("\n")
      : `- 공식 API에서 "${region}"의 법정동코드 후보를 찾지 못했습니다. 시·군·구 단위로 다시 입력하세요.`,
    "",
    "## 실제 조회 방법",
    lineItems([
      `공식 API: ${LEGAL_DONG_API.endpoint}`,
      "필수 파라미터: ServiceKey, pageNo, numOfRows, type=json",
      `검색 파라미터: locatadd_nm=${region}`,
      "응답의 region_cd 10자리 중 앞 5자리를 국토부 전월세 실거래 API의 LAWD_CD로 사용"
    ]),
    "",
    "## 공식 출처",
    renderSources(["mois-legal-dong-code"])
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTag(xml: string, tag: string): string | undefined {
  const escapedTag = escapeRegExp(tag);
  const match = xml.match(new RegExp(`<\\s*${escapedTag}(?:\\s[^>]*)?>(.*?)<\\/\\s*${escapedTag}\\s*>`, "s"));
  return match?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/s, "$1").trim();
}

function extractBlocks(xml: string, tag: string): string[] {
  const escapedTag = escapeRegExp(tag);
  return [...xml.matchAll(new RegExp(`<\\s*${escapedTag}(?:\\s[^>]*)?>(.*?)<\\/\\s*${escapedTag}\\s*>`, "gs"))].map(match => match[1]);
}

function extractFirstTag(xml: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const value = extractTag(xml, tag);
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function extractFirstPresentTag(xml: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const value = extractTag(xml, tag);
    if (value !== undefined) return value;
  }
  return undefined;
}

function publicDataNumberFromRequiredTag(xml: string, tags: string[], label: string): number {
  const rawValue = extractFirstPresentTag(xml, tags);
  if (rawValue === undefined) {
    throw new Error(`${label} missing required numeric field: ${tags.join(" or ")}`);
  }

  const normalized = rawValue.replace(/,/g, "").trim();
  const value = parsePublicDataInteger(normalized);
  if (normalized === "" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} returned invalid numeric field ${tags.join(" or ")}: ${rawValue}`);
  }
  return value;
}

function parsePublicDataInteger(value: string): number {
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

function publicDataNumberFromOptionalTag(xml: string, tags: string[], label: string): number | undefined {
  const rawValue = extractFirstTag(xml, tags);
  if (rawValue === undefined) return undefined;

  const normalized = rawValue.replace(/,/g, "").trim();
  const value = Number(normalized);
  if (normalized === "" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} returned invalid numeric field ${tags.join(" or ")}: ${rawValue}`);
  }
  return value;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function contractDateFromTags(xml: string): string {
  const year = extractFirstTag(xml, ["dealYear", "년"]);
  const month = extractFirstTag(xml, ["dealMonth", "월"]);
  const day = extractFirstTag(xml, ["dealDay", "일"]);
  if (!year || !month || !day) return "날짜 미확인";

  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);
  if (
    !Number.isSafeInteger(parsedYear) ||
    !Number.isSafeInteger(parsedMonth) ||
    !Number.isSafeInteger(parsedDay) ||
    parsedYear < 1900 ||
    parsedMonth < 1 ||
    parsedMonth > 12 ||
    parsedDay < 1 ||
    parsedDay > 31 ||
    !isRealCalendarDate(parsedYear, parsedMonth, parsedDay)
  ) {
    return "날짜 미확인";
  }

  return `${parsedYear}-${String(parsedMonth).padStart(2, "0")}-${String(parsedDay).padStart(2, "0")}`;
}

function extractItems(xml: string, specNameField?: string): RentRecord[] {
  const items = extractBlocks(xml, "item");
  return items
    .map(item => {
      const deposit = publicDataNumberFromRequiredTag(item, ["deposit", "보증금액", "보증금"], "국토교통부 전월세 실거래 API");
      const monthlyRent = publicDataNumberFromRequiredTag(item, ["monthlyRent", "월세금액", "월세"], "국토교통부 전월세 실거래 API");
      return {
        name: extractFirstTag(item, [specNameField, "aptNm", "아파트", "mhouseNm", "연립다세대", "offiNm", "단지"].filter((tag): tag is string => Boolean(tag))),
        legalDong: extractFirstTag(item, ["umdNm", "법정동"]),
        area: publicDataNumberFromOptionalTag(item, ["excluUseAr", "totalFloorAr", "전용면적", "계약면적"], "국토교통부 전월세 실거래 API"),
        depositManwon: deposit,
        monthlyRentManwon: monthlyRent,
        contractDate: contractDateFromTags(item),
        floor: extractFirstTag(item, ["floor", "층"]),
        contractType: extractFirstTag(item, ["contractType", "전월세구분"])
      };
    })
    .filter(item => item.depositManwon > 0 || item.monthlyRentManwon > 0);
}

function extractSaleItems(xml: string, specNameField?: string): SaleRecord[] {
  const items = extractBlocks(xml, "item");
  return items
    .map(item => {
      const dealAmount = publicDataNumberFromRequiredTag(item, ["dealAmount", "거래금액"], "국토교통부 매매 실거래 API");
      return {
        name: extractFirstTag(item, [specNameField, "aptNm", "아파트", "mhouseNm", "연립다세대", "offiNm", "단지"].filter((tag): tag is string => Boolean(tag))),
        legalDong: extractFirstTag(item, ["umdNm", "법정동"]),
        area: publicDataNumberFromOptionalTag(item, ["excluUseAr", "totalArea", "전용면적", "대지면적"], "국토교통부 매매 실거래 API"),
        dealAmountManwon: dealAmount,
        contractDate: contractDateFromTags(item),
        floor: extractFirstTag(item, ["floor", "층"])
      };
    })
    .filter(item => item.dealAmountManwon > 0);
}

async function fetchRentMarketSnapshot(input: {
  housingType: HousingType;
  lawdCd: string;
  dealYmd: string;
  depositManwon?: number;
  monthlyRentManwon?: number;
}): Promise<RentMarketSnapshot> {
  assertSupportedHousingType(input.housingType);
  validateMarketQuery(input.lawdCd, input.dealYmd);
  assertOptionalNonNegativeManwon("depositManwon", input.depositManwon);
  assertOptionalNonNegativeManwon("monthlyRentManwon", input.monthlyRentManwon);
  const serviceKey = dataGoKrServiceKey();

  const spec = RENT_API_SPECS[input.housingType];
  const url = new URL(spec.endpoint);
  url.searchParams.set("LAWD_CD", input.lawdCd);
  url.searchParams.set("DEAL_YMD", input.dealYmd);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "30");

  const xml = await fetchPublicDataText("국토교통부 전월세 실거래 API", url);
  const publicDataError = publicDataErrorMessage(xml);
  if (publicDataError) {
    throw new Error(`국토교통부 실거래 API returned error: ${publicDataError}`);
  }
  assertPublicDataXmlPayload("국토교통부 전월세 실거래 API", xml);
  assertPublicDataResultCode("국토교통부 전월세 실거래 API", xml);

  const records = extractItems(xml, spec.nameField);
  const deposits = records.map(record => record.depositManwon).filter(value => value > 0);
  const sampleCount = records.length;
  const depositSampleCount = deposits.length;
  const medianDeposit = median(deposits);
  const max = depositSampleCount > 0 ? Math.max(...deposits) : undefined;
  const userDeposit = input.depositManwon;
  const position =
    userDeposit && medianDeposit
      ? userDeposit > medianDeposit * 1.25
        ? "입력한 보증금이 조회 표본 중앙값보다 25% 이상 높습니다. 등기부 선순위 권리와 보증보험 가능 여부를 먼저 확인하세요."
        : userDeposit < medianDeposit * 0.75
          ? "입력한 보증금이 조회 표본 중앙값보다 낮습니다. 월세, 관리비, 특약, 하자 조건을 함께 확인하세요."
          : "입력한 보증금은 조회 표본 중앙값 주변입니다. 그래도 개별 등기부와 특약 확인은 별도입니다."
      : "입력 보증금이나 표본 중앙값이 부족해 상대 위치를 계산하지 않았습니다.";

  return {
    label: spec.label,
    lawdCd: input.lawdCd,
    dealYmd: input.dealYmd,
    sampleCount,
    depositSampleCount,
    median: medianDeposit,
    max,
    userDeposit,
    userMonthlyRent: input.monthlyRentManwon,
    position,
    records,
    sourceId: sourceIdFor("rent", input.housingType)
  };
}

function renderRentMarketSnapshot(snapshot: RentMarketSnapshot): string {
  return [
    "## 전월세 실거래 비교",
    `주택유형: ${snapshot.label}`,
    `조회 기준: LAWD_CD ${snapshot.lawdCd}, 계약월 ${snapshot.dealYmd}`,
    `신고 표본 수: ${snapshot.sampleCount}`,
    snapshot.depositSampleCount > 0
      ? `보증금 표본 수: ${snapshot.depositSampleCount} / 보증금 중앙값: ${money(snapshot.median)} / 최대값: ${money(snapshot.max)}`
      : snapshot.sampleCount > 0
        ? "조회된 신고 표본은 있지만 보증금 중앙값을 계산할 수 있는 보증금 표본이 없습니다."
        : "조회된 표본이 없습니다. 계약월이나 지역을 넓혀 다시 확인하세요.",
    `입력 보증금: ${money(snapshot.userDeposit)} / 입력 월세: ${money(snapshot.userMonthlyRent)}`,
    "",
    "## 해석",
    snapshot.position,
    "",
    snapshot.records.slice(0, 5).length > 0
      ? ["## 최근 표본 일부", ...snapshot.records.slice(0, 5).map(record => `- ${record.contractDate} ${record.legalDong ?? ""} ${record.name ?? ""} 보증금 ${money(record.depositManwon)} 월세 ${money(record.monthlyRentManwon)}`)].join("\n")
      : "",
    "",
    "## 공식 출처",
    renderSources([snapshot.sourceId])
  ].join("\n");
}

export async function compareRentMarket(input: {
  housingType: HousingType;
  lawdCd: string;
  dealYmd: string;
  depositManwon?: number;
  monthlyRentManwon?: number;
}): Promise<string> {
  return renderRentMarketSnapshot(await fetchRentMarketSnapshot(input));
}

function saleRatioSignal(ratio: number | undefined): string {
  if (!Number.isFinite(ratio)) {
    return "입력 보증금이나 매매 표본 중앙값이 부족해 매매가 대비 비율을 계산하지 않았습니다.";
  }
  if ((ratio as number) >= 90) {
    return "입력 보증금이 주변 매매가 중앙값의 90% 이상입니다. 깡통전세 위험 가능성이 매우 크므로 등기부 선순위 권리, 보증보험 가능 여부, 잔금 전 등기 변동을 최우선으로 확인하세요.";
  }
  if ((ratio as number) >= 80) {
    return "입력 보증금이 주변 매매가 중앙값의 80% 이상입니다. 매매가 하락이나 선순위 권리까지 고려하면 보증금 회수 위험이 커질 수 있습니다.";
  }
  if ((ratio as number) >= 70) {
    return "입력 보증금이 주변 매매가 중앙값의 70% 이상입니다. 보증보험, 선순위 권리, 동일 면적 표본을 추가로 확인하세요.";
  }
  return "입력 보증금은 주변 매매가 중앙값 대비 70% 미만입니다. 그래도 개별 등기부, 선순위 보증금, 특약 확인은 별도입니다.";
}

function formatRatio(ratio: number | undefined): string {
  return Number.isFinite(ratio) ? `${(ratio as number).toLocaleString("ko-KR")}%` : "계산 불가";
}

function assessmentRiskSummary(
  input: LeaseProfileInput & { depositManwon: number },
  rentMarket: RentMarketSnapshot,
  saleMarket: SaleMarketSnapshot,
  redFlags: string[]
): AssessmentRiskSummary {
  let score = 0;
  const reasons: string[] = [];

  if (!Number.isFinite(saleMarket.ratio)) {
    score += 25;
    reasons.push("매매 표본이 부족해 보증금-매매가 비율을 계산하지 못했습니다.");
  } else if ((saleMarket.ratio as number) >= 90) {
    score += 70;
    reasons.push("보증금이 주변 매매가 중앙값의 90% 이상입니다.");
  } else if ((saleMarket.ratio as number) >= 80) {
    score += 55;
    reasons.push("보증금이 주변 매매가 중앙값의 80% 이상입니다.");
  } else if ((saleMarket.ratio as number) >= 70) {
    score += 35;
    reasons.push("보증금이 주변 매매가 중앙값의 70% 이상입니다.");
  }

  if (!rentMarket.median || rentMarket.depositSampleCount === 0) {
    score += 15;
    reasons.push("전월세 표본이 부족해 주변 임대 시세 위치가 약합니다.");
  } else if (input.depositManwon > rentMarket.median * 1.25) {
    score += 20;
    reasons.push("입력 보증금이 전월세 신고 표본 중앙값보다 25% 이상 높습니다.");
  }

  const joinedFlags = redFlags.join(" ");
  if (/대리|위임|명의|소유자|집주인/.test(joinedFlags)) {
    score += 15;
    reasons.push("대리계약 또는 소유자 확인 신호가 있습니다.");
  }
  if (/근저당|압류|가압류|경매|채권/.test(joinedFlags)) {
    score += 20;
    reasons.push("근저당, 압류, 경매 등 선순위 권리 확인 신호가 있습니다.");
  }
  if (/송금|가계약|계약금|압박/.test(joinedFlags)) {
    score += 15;
    reasons.push("계약금 또는 가계약금 송금을 서두르는 신호가 있습니다.");
  }

  const level = score >= 85 ? "매우 높음" : score >= 60 ? "높음" : score >= 30 ? "주의" : "보통";
  return {
    level,
    score: Math.min(score, 100),
    reasons: reasons.length > 0 ? reasons : ["현재 공식 시세 신호와 입력 위험 신호만으로는 높은 위험도를 단정할 근거가 부족합니다."]
  };
}

async function fetchSaleMarketSnapshot(input: {
  housingType: HousingType;
  lawdCd: string;
  dealYmd: string;
  depositManwon: number;
}): Promise<SaleMarketSnapshot> {
  assertSupportedHousingType(input.housingType);
  validateMarketQuery(input.lawdCd, input.dealYmd);
  assertRequiredNonNegativeManwon("depositManwon", input.depositManwon);
  const serviceKey = dataGoKrServiceKey();
  const spec = SALE_API_SPECS[input.housingType];
  const url = new URL(spec.endpoint);
  url.searchParams.set("LAWD_CD", input.lawdCd);
  url.searchParams.set("DEAL_YMD", input.dealYmd);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "30");

  const xml = await fetchPublicDataText("국토교통부 매매 실거래 API", url);
  const publicDataError = publicDataErrorMessage(xml);
  if (publicDataError) {
    throw new Error(`국토교통부 매매 실거래 API returned error: ${publicDataError}`);
  }
  assertPublicDataXmlPayload("국토교통부 매매 실거래 API", xml);
  assertPublicDataResultCode("국토교통부 매매 실거래 API", xml);

  const records = extractSaleItems(xml, spec.nameField);
  const saleAmounts = records.map(record => record.dealAmountManwon).filter(value => value > 0);
  const sampleCount = saleAmounts.length;
  const medianSale = median(saleAmounts);
  const max = sampleCount > 0 ? Math.max(...saleAmounts) : undefined;
  const ratio = medianSale ? Math.round((input.depositManwon / medianSale) * 1000) / 10 : undefined;
  const signal = saleRatioSignal(ratio);

  return {
    label: spec.label,
    lawdCd: input.lawdCd,
    dealYmd: input.dealYmd,
    sampleCount,
    median: medianSale,
    max,
    userDeposit: input.depositManwon,
    ratio,
    signal,
    records,
    sourceId: sourceIdFor("sale", input.housingType)
  };
}

function renderSaleMarketSnapshot(snapshot: SaleMarketSnapshot): string {
  return [
    "## 매매가 대비 보증금 점검",
    `주택유형: ${snapshot.label}`,
    `조회 기준: LAWD_CD ${snapshot.lawdCd}, 계약월 ${snapshot.dealYmd}`,
    `매매 표본 수: ${snapshot.sampleCount}`,
    snapshot.sampleCount > 0 ? `매매가 중앙값: ${money(snapshot.median)} / 최대값: ${money(snapshot.max)}` : "조회된 매매 표본이 없습니다. 계약월이나 지역을 넓혀 다시 확인하세요.",
    `입력 보증금: ${money(snapshot.userDeposit)}`,
    `매매가 대비 보증금 비율: ${formatRatio(snapshot.ratio)}`,
    "",
    "## 해석",
    snapshot.signal,
    "",
    snapshot.records.slice(0, 5).length > 0
      ? ["## 매매 표본 일부", ...snapshot.records.slice(0, 5).map(record => `- ${record.contractDate} ${record.legalDong ?? ""} ${record.name ?? ""} 매매가 ${money(record.dealAmountManwon)}`)].join("\n")
      : "",
    "",
    "## 확인 필요",
    "이 비율은 주변 신고 표본을 이용한 참고 지표입니다. 특정 매물의 안전성, 선순위 권리, 보증보험 가입 가능 여부를 확정하지 않습니다.",
    "",
    "## 공식 출처",
    renderSources([snapshot.sourceId])
  ].join("\n");
}

export async function compareDepositToSaleMarket(input: {
  housingType: HousingType;
  lawdCd: string;
  dealYmd: string;
  depositManwon: number;
}): Promise<string> {
  return renderSaleMarketSnapshot(await fetchSaleMarketSnapshot(input));
}

export async function assessLeaseSafety(input: LeaseProfileInput & {
  housingType: HousingType;
  lawdCd: string;
  dealYmd: string;
  depositManwon: number;
}): Promise<string> {
  assertRequiredNonNegativeManwon("depositManwon", input.depositManwon);
  assertOptionalNonNegativeManwon("monthlyRentManwon", input.monthlyRentManwon);
  const [rentMarket, saleMarket] = await Promise.all([
    fetchRentMarketSnapshot(input),
    fetchSaleMarketSnapshot(input)
  ]);
  const redFlags = inferRiskSignals(input);
  const riskSummary = assessmentRiskSummary(input, rentMarket, saleMarket, redFlags);
  const ratioLine = formatRatio(saleMarket.ratio);
  const immediateActions = [
    "잔금 전 등기부등본을 다시 발급해 소유자, 근저당, 압류, 가압류, 신탁, 경매 표시를 확인",
    "계약 상대방이 등기부 소유자와 다르면 위임장, 인감증명, 본인 통화로 대리권 확인",
    "전입신고, 확정일자, 임대차신고, 보증보험 가능 여부를 같은 날 공식 경로로 확인",
    "특약에 잔금 전 추가 근저당 금지, 등기 변동 시 해제·반환 조건, 하자·수리 책임을 문서화"
  ];

  if (Number.isFinite(saleMarket.ratio) && (saleMarket.ratio as number) >= 80) {
    immediateActions.unshift("매매가 대비 보증금 비율이 높으므로 보증보험 가능 여부와 선순위 권리 확인 전 계약금 송금을 보류");
  }

  return [
    "## 전월세 안전 종합 진단",
    `지역: ${cleanText(input.region, `LAWD_CD ${input.lawdCd}`)}`,
    `주택유형: ${rentMarket.label}`,
    `계약월: ${input.dealYmd}`,
    `입력 조건: 보증금 ${money(input.depositManwon)} / 월세 ${money(input.monthlyRentManwon)}`,
    `종합 위험도: ${riskSummary.level} (${riskSummary.score}/100)`,
    "",
    "## 핵심 판단",
    lineItems([
      `위험도 근거: ${riskSummary.reasons.join(" / ")}`,
      `전월세 신고 표본 ${rentMarket.sampleCount}건, 보증금 산출 표본 ${rentMarket.depositSampleCount}건, 보증금 중앙값 ${money(rentMarket.median)}`,
      `매매 신고 표본 ${saleMarket.sampleCount}건, 매매가 중앙값 ${money(saleMarket.median)}`,
      `매매가 대비 보증금 비율 ${ratioLine}: ${saleMarket.signal}`,
      rentMarket.position
    ]),
    "",
    "## 입력에서 감지한 위험 신호",
    lineItems(redFlags),
    "",
    "## 바로 할 일",
    lineItems(immediateActions),
    "",
    "## 실거래 근거",
    rentMarket.records.slice(0, 3).length > 0
      ? ["전월세 표본", ...rentMarket.records.slice(0, 3).map(record => `- ${record.contractDate} ${record.legalDong ?? ""} ${record.name ?? ""} 보증금 ${money(record.depositManwon)} 월세 ${money(record.monthlyRentManwon)}`)].join("\n")
      : "전월세 표본: 조회된 표본이 없습니다. 계약월이나 지역을 넓혀 다시 확인하세요.",
    "",
    saleMarket.records.slice(0, 3).length > 0
      ? ["매매 표본", ...saleMarket.records.slice(0, 3).map(record => `- ${record.contractDate} ${record.legalDong ?? ""} ${record.name ?? ""} 매매가 ${money(record.dealAmountManwon)}`)].join("\n")
      : "매매 표본: 조회된 표본이 없습니다. 계약월이나 지역을 넓혀 다시 확인하세요.",
    "",
    "## 공식 출처",
    renderSources([
      rentMarket.sourceId,
      saleMarket.sourceId,
      "iros-fixed-date",
      "rtms-lease-report",
      "gov24",
      "hug-deposit-guarantee",
      "easylaw-lease"
    ]),
    "",
    officialNotice()
  ].join("\n");
}

export function checkLeaseRedFlags(input: LeaseProfileInput): string {
  const region = cleanText(input.region);
  const signals = inferRiskSignals(input);
  return [
    "## 계약 위험 신호 점검",
    `지역: ${region}`,
    `계약유형: ${input.contractType === "jeonse" ? "전세" : input.contractType === "monthly_rent" ? "월세" : "미확인"}`,
    `보증금: ${money(input.depositManwon)} / 월세: ${money(input.monthlyRentManwon)}`,
    "",
    "## 우선 확인할 신호",
    lineItems(signals),
    "",
    "## 계약 전 확인 순서",
    lineItems([
      "등기부등본에서 소유자, 근저당, 압류, 가압류, 신탁, 경매 관련 표시 확인",
      "계약 상대방이 등기부 소유자와 같은지 확인하고 대리계약이면 위임 범위 확인",
      "전입신고, 확정일자, 임대차신고, 보증보험 가능 여부를 같은 체크리스트로 확인",
      "특약에 전입·확정일자 전까지 추가 근저당 설정 금지, 하자·수리, 잔금 전 등기부 재확인을 넣을지 중개사에게 질문"
    ]),
    "",
    "## 공식 출처",
    renderSources(["iros-fixed-date", "easylaw-lease", "law-lease", "hug-deposit-guarantee"]),
    "",
    officialNotice()
  ].join("\n");
}

export function buildMoveInProtectionPlan(input: LeaseProfileInput): string {
  const moveInDate = cleanText(input.moveInDate, "이사일 미입력");
  const contractDate = cleanText(input.contractDate, "계약일 미입력");
  return [
    "## 이사·보증금 보호 체크리스트",
    `계약일: ${contractDate}`,
    `이사일: ${moveInDate}`,
    "",
    "## 계약 전",
    lineItems([
      "등기부등본을 직접 발급하거나 중개사 제공본의 발급 시각을 확인",
      "소유자와 계약 상대방 일치 여부 확인",
      "주택 유형, 보증금, 월세, 관리비, 특약을 계약서에 분리 기재",
      "전세보증금반환보증 가능 여부와 필요 서류를 HUG 등 공식 경로로 확인"
    ]),
    "",
    "## 잔금·입주 당일",
    lineItems([
      "잔금 전 등기부를 다시 확인",
      "입주 후 전입신고를 진행",
      "확정일자를 신청하고 접수 결과를 보관",
      "주택 임대차 계약 신고 대상이면 RTMS 또는 주민센터 경로로 신고 여부 확인"
    ]),
    "",
    "## 입주 후",
    lineItems([
      "임대차신고, 전입신고, 확정일자 처리 결과를 가족 또는 공동 세입자와 공유",
      "보증보험 신청을 진행한다면 접수번호, 보완서류, 심사 결과를 따로 기록",
      "수리·하자·관리비 분쟁 가능 항목은 사진과 날짜로 남김"
    ]),
    "",
    "## 공식 출처",
    renderSources(["gov24", "rtms-lease-report", "iros-fixed-date", "hug-deposit-guarantee", "easylaw-lease"]),
    "",
    officialNotice()
  ].join("\n");
}

export function prepareContractQuestions(input: LeaseProfileInput): string {
  const concern = cleanText(input.concerns ?? input.situation, "전월세 계약 전 확인");
  return [
    "## 중개사·임대인에게 물어볼 질문",
    `핵심 고민: ${concern}`,
    "",
    lineItems([
      "등기부상 소유자와 계약 당사자가 같은가요? 다르면 대리권을 어떤 문서로 확인하나요?",
      "근저당, 압류, 가압류, 신탁, 임차권등기명령, 경매 관련 권리가 있나요?",
      "잔금일 직전 등기부를 다시 확인하고 특약에 반영할 수 있나요?",
      "전입신고와 확정일자를 바로 진행해도 되는 주택인가요?",
      "주택 임대차 계약 신고는 누가, 언제, 어떤 방식으로 처리하나요?",
      "전세보증금반환보증 가입 가능 여부와 필요한 서류를 어디서 확인하면 되나요?",
      "하자 수리, 관리비, 원상복구, 중도해지, 보증금 반환일은 계약서에 어떻게 적나요?"
    ]),
    "",
    "## 통화 첫 문장",
    "계약 전 확인을 위해 등기부 권리관계, 전입·확정일자 가능 여부, 임대차신고, 보증보험 가능 여부를 문서 기준으로 확인하고 싶습니다.",
    "",
    "## 공식 출처",
    renderSources(["rtms-lease-report", "iros-fixed-date", "adr-lease-dispute", "hug-deposit-guarantee"]),
    "",
    officialNotice()
  ].join("\n");
}

export function routeOfficialHelp(input: LeaseProfileInput & { issueType?: "move_in" | "fixed_date" | "lease_report" | "deposit_guarantee" | "dispute" | "registry" | "unknown" }): string {
  const issueType = input.issueType ?? "unknown";
  const routes: Record<string, string[]> = {
    move_in: ["정부24", "전입신고 신청과 처리 결과 확인"],
    fixed_date: ["인터넷등기소", "확정일자 신청과 접수 확인"],
    lease_report: ["부동산거래관리시스템 RTMS", "주택 임대차 계약 신고"],
    deposit_guarantee: ["HUG 주택도시보증공사", "전세보증금반환보증 가입 가능 여부와 서류 확인"],
    dispute: ["한국부동산원·LH 임대차분쟁조정위원회", "보증금 반환, 수선, 원상복구, 계약갱신 분쟁 상담·조정"],
    registry: ["인터넷등기소", "등기부등본 발급과 소유자·권리관계 확인"],
    unknown: ["정부24 또는 임대차분쟁조정위원회", "상황에 맞는 공식 창구 확인"]
  };
  const [office, action] = routes[issueType];

  return [
    "## 공식 문의 경로",
    `먼저 볼 곳: ${office}`,
    `확인할 일: ${action}`,
    "",
    "## 상황별 빠른 분기",
    lineItems([
      "전입신고: 정부24",
      "확정일자·등기부 확인: 인터넷등기소",
      "주택 임대차 계약 신고: RTMS",
      "보증보험: HUG",
      "보증금 반환·원상복구·수선·계약갱신 분쟁: 임대차분쟁조정위원회"
    ]),
    "",
    "## 공식 출처",
    renderSources(["gov24", "rtms-lease-report", "iros-fixed-date", "hug-deposit-guarantee", "adr-lease-dispute"]),
    "",
    officialNotice()
  ].join("\n");
}

export function explainDisputePrevention(input: LeaseProfileInput & { disputeType?: "deposit_return" | "repair" | "restoration" | "renewal" | "rent_increase" | "unknown" }): string {
  const disputeType = input.disputeType ?? "unknown";
  const guidance: Record<string, string[]> = {
    deposit_return: ["만기일, 퇴거일, 보증금 반환 예정일을 문서로 남기기", "임차권등기명령 등 법적 절차는 전문가·공식 기관 확인 후 진행"],
    repair: ["하자 사진, 발견일, 통보일, 임대인 답변을 기록", "긴급 수리와 일반 수리를 나눠 중개사·임대인에게 문의"],
    restoration: ["입주 전 사진과 퇴거 전 사진을 비교 가능하게 보관", "원상복구 범위와 통상 사용 손모를 구분해 조정사례 확인"],
    renewal: ["계약갱신 의사표시 시점과 임대인 답변을 기록", "실거주, 갱신거절, 차임 증액 주장은 생활법령과 조정사례를 함께 확인"],
    rent_increase: ["증액 요구 금액, 적용 시점, 합의 여부를 문서화", "전월세전환 계산기와 조정사례로 협의 기준 확인"],
    unknown: ["분쟁 유형을 보증금 반환, 수선, 원상복구, 계약갱신, 증액 중 어디에 가까운지 먼저 나누기"]
  };

  return [
    "## 분쟁 예방 메모",
    lineItems(guidance[disputeType]),
    "",
    "## 증거로 남길 것",
    lineItems([
      "계약서와 특약",
      "등기부 발급일과 주요 권리관계",
      "전입신고, 확정일자, 임대차신고 접수 결과",
      "문자·통화 일시와 핵심 내용",
      "하자·수리·퇴거 상태 사진"
    ]),
    "",
    "## 공식 출처",
    renderSources(["adr-lease-dispute", "easylaw-lease", "law-lease"]),
    "",
    officialNotice()
  ].join("\n");
}

export function sourceRegistry(): string {
  return JSON.stringify(SOURCES, null, 2);
}
