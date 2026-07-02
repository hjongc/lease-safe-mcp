const requiredEnvName = "DATA_GO_KR_SERVICE_KEY";
const requiredAuthEnvName = "MCP_AUTH_TOKEN";
const placeholders = new Set([
  "...",
  "your-data-go-kr-service-key",
  "replace-with-data-go-kr-service-key",
  "data-go-kr-service-key"
]);
const authPlaceholders = new Set([
  "...",
  "replace-with-runtime-secret",
  "your-mcp-auth-token",
  "mcp-auth-token"
]);
const minKeyLength = 40;
const minAuthTokenLength = 16;
const maxAuthTokenLength = 4096;
const authTokenPattern = /^[\x21-\x7E]+$/;
const maxRegionLength = 80;
const maxDepositManwon = 10_000_000;
const supportedHousingTypes = ["apartment", "rowhouse", "single_multi", "officetel"];
const officialDataTimeZone = "Asia/Seoul";
const officialDataYearMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: officialDataTimeZone,
  year: "numeric",
  month: "2-digit"
});

function fail(message, hint = "Set a real data.go.kr service key as a GitHub repository secret and as a PlayMCP runtime environment variable before registration.") {
  console.error(message);
  console.error(hint);
  process.exit(1);
}

function failDemoInput(message) {
  fail(message, "Fix the PUBLIC_DATA_SMOKE_* demo input before running registration preflight.");
}

function isFutureDealYmd(dealYmd, now = new Date()) {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(dealYmd)) return false;
  const dealYear = Number(dealYmd.slice(0, 4));
  const dealMonth = Number(dealYmd.slice(4, 6));
  const { year: currentYear, month: currentMonth } = officialDataYearMonth(now);
  return dealYear > currentYear || (dealYear === currentYear && dealMonth > currentMonth);
}

function officialDataYearMonth(now) {
  const parts = officialDataYearMonthFormatter.formatToParts(now);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || month < 1 || month > 12) {
    failDemoInput(`Unable to resolve official public-data year-month in ${officialDataTimeZone}.`);
  }
  return { year, month };
}

function validateDemoInputs() {
  const region = (process.env.PUBLIC_DATA_SMOKE_REGION ?? "서울 관악구").trim();
  if (region.length < 2) {
    failDemoInput("PUBLIC_DATA_SMOKE_REGION must include at least 2 meaningful characters.");
  }
  if (/[\u0000-\u001F\u007F`]/.test(region)) {
    failDemoInput("PUBLIC_DATA_SMOKE_REGION must not include control characters, line breaks, tabs, or Markdown backticks.");
  }
  if (/!\[[^\]\r\n]{0,120}\]\([^) \r\n]{1,500}\)/.test(region) || /\[[^\]\r\n]{1,120}\]\([^) \r\n]{1,500}\)/.test(region) || /<\/?[A-Za-z][^>\r\n]{0,200}>|[<>]/.test(region)) {
    failDemoInput("PUBLIC_DATA_SMOKE_REGION must not include Markdown links, images, HTML tags, or angle brackets.");
  }
  if (/\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/.test(region) || /\bhttps?:\/\/[^\s)]+/i.test(region) || /\b\d{6}[\s.-]?[0-9]\d{6}\b/.test(region) || /\b01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}\b/.test(region) || /\b0(?:2|[3-6][1-5]|70|80)[\s.-]?\d{3,4}[\s.-]?\d{4}\b/.test(region) || /(?:계좌(?:번호)?|입금\s*계좌|송금\s*계좌)\s*(?:은|는|:)?\s*\d{2,6}[\s-]\d{2,6}[\s-]\d{2,8}/.test(region) || /\b\d{1,4}\s*동\s*\d{1,4}\s*호/.test(region) || /\b\d{1,3}\s*층\s*\d{1,4}\s*호/.test(region) || /\b\d{2,4}\s*호/.test(region)) {
    failDemoInput("PUBLIC_DATA_SMOKE_REGION must not include personal identifiers, email addresses, phone numbers, URLs, payment account details, or household unit details.");
  }
  if (region.length > maxRegionLength) {
    failDemoInput(`PUBLIC_DATA_SMOKE_REGION must be ${maxRegionLength} characters or fewer.`);
  }

  const lawdCd = process.env.PUBLIC_DATA_SMOKE_LAWD_CD?.trim() || "11620";
  if (!/^\d{5}$/.test(lawdCd)) {
    failDemoInput("PUBLIC_DATA_SMOKE_LAWD_CD must be exactly 5 digits.");
  }
  if (lawdCd === "00000") {
    failDemoInput("PUBLIC_DATA_SMOKE_LAWD_CD must not be 00000.");
  }

  const dealYmd = process.env.PUBLIC_DATA_SMOKE_DEAL_YMD?.trim() || "202605";
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(dealYmd)) {
    failDemoInput("PUBLIC_DATA_SMOKE_DEAL_YMD must use YYYYMM format with a month from 01 to 12.");
  }
  if (isFutureDealYmd(dealYmd)) {
    failDemoInput("PUBLIC_DATA_SMOKE_DEAL_YMD must not be in the future.");
  }

  const deposit = process.env.PUBLIC_DATA_SMOKE_DEPOSIT_MANWON?.trim() || "30000";
  if (!/^(0|[1-9]\d*)$/.test(deposit)) {
    failDemoInput("PUBLIC_DATA_SMOKE_DEPOSIT_MANWON must be a plain positive integer in manwon.");
  }
  const depositValue = Number(deposit);
  if (!Number.isSafeInteger(depositValue) || depositValue <= 0 || depositValue > maxDepositManwon) {
    failDemoInput(`PUBLIC_DATA_SMOKE_DEPOSIT_MANWON must be a positive integer no greater than ${maxDepositManwon} manwon for registration-ready deposit-to-sale evidence.`);
  }

  const rawHousingTypesValue = process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES;
  if (rawHousingTypesValue !== undefined) {
    const rawHousingTypes = rawHousingTypesValue.trim();
    if (rawHousingTypes.length === 0) {
      failDemoInput("PUBLIC_DATA_SMOKE_HOUSING_TYPES must include at least one supported housing type.");
    }
    const requested = rawHousingTypes.split(",").map(type => type.trim());
    if (requested.some(type => type.length === 0)) {
      failDemoInput("PUBLIC_DATA_SMOKE_HOUSING_TYPES must not include empty comma-separated entries.");
    }
    const duplicates = requested.filter((type, index) => requested.indexOf(type) !== index);
    if (duplicates.length > 0) {
      failDemoInput(`PUBLIC_DATA_SMOKE_HOUSING_TYPES contains duplicate values: ${[...new Set(duplicates)].join(",")}`);
    }
    const unsupported = requested.filter(type => !supportedHousingTypes.includes(type));
    if (unsupported.length > 0) {
      failDemoInput(`Unsupported PUBLIC_DATA_SMOKE_HOUSING_TYPES value: ${unsupported.join(",")}`);
    }
    const missing = supportedHousingTypes.filter(type => !requested.includes(type));
    if (missing.length > 0) {
      failDemoInput(`PUBLIC_DATA_SMOKE_HOUSING_TYPES must include all supported housing types in registration preflight. Missing: ${missing.join(",")}`);
    }
  }
}

const rawServiceKey = process.env[requiredEnvName];

if (rawServiceKey === undefined || rawServiceKey === "") {
  console.error(`${requiredEnvName} is required before running registration preflight.`);
  console.error("Set it as a GitHub repository secret and as a PlayMCP runtime environment variable before registration.");
  process.exit(1);
}

if (rawServiceKey !== rawServiceKey.trim() || /\s/.test(rawServiceKey)) {
  fail(`${requiredEnvName} must not contain whitespace.`);
}

if (placeholders.has(rawServiceKey.toLowerCase())) {
  fail(`${requiredEnvName} must be a real data.go.kr service key, not a placeholder.`);
}

let serviceKey;
try {
  serviceKey = rawServiceKey.includes("%") ? decodeURIComponent(rawServiceKey) : rawServiceKey;
} catch {
  fail(`${requiredEnvName} must be a valid percent-encoded or decoded data.go.kr service key.`);
}

if (placeholders.has(serviceKey.toLowerCase())) {
  fail(`${requiredEnvName} must be a real data.go.kr service key, not a placeholder.`);
}

if (serviceKey !== serviceKey.trim() || /\s/.test(serviceKey)) {
  fail(`${requiredEnvName} must not contain whitespace.`);
}

if (serviceKey.length < minKeyLength || !/^[A-Za-z0-9+/]+={0,2}$/.test(serviceKey)) {
  fail(`${requiredEnvName} must look like a real data.go.kr service key.`);
}

const rawAuthToken = process.env[requiredAuthEnvName];

if (rawAuthToken === undefined || rawAuthToken === "") {
  console.error(`${requiredAuthEnvName} is required before running registration preflight.`);
  console.error("Set it as a GitHub repository secret and as a PlayMCP runtime environment variable before registration.");
  process.exit(1);
}

if (rawAuthToken !== rawAuthToken.trim() || /\s/.test(rawAuthToken)) {
  fail(`${requiredAuthEnvName} must not contain whitespace.`);
}

if (authPlaceholders.has(rawAuthToken.toLowerCase())) {
  fail(`${requiredAuthEnvName} must be a real bearer token, not a placeholder.`);
}

if (rawAuthToken.length < minAuthTokenLength) {
  fail(`${requiredAuthEnvName} must be at least ${minAuthTokenLength} characters.`);
}

if (rawAuthToken.length > maxAuthTokenLength) {
  fail(`${requiredAuthEnvName} must be ${maxAuthTokenLength} characters or fewer.`);
}

if (!authTokenPattern.test(rawAuthToken)) {
  fail(`${requiredAuthEnvName} must contain only visible ASCII characters.`);
}

validateDemoInputs();
