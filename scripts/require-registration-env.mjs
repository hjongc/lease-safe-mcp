const requiredEnvName = "DATA_GO_KR_SERVICE_KEY";
const placeholders = new Set([
  "...",
  "your-data-go-kr-service-key",
  "replace-with-data-go-kr-service-key",
  "data-go-kr-service-key"
]);
const minKeyLength = 40;
const maxRegionLength = 80;
const maxDepositManwon = 10_000_000;
const supportedHousingTypes = ["apartment", "rowhouse", "single_multi", "officetel"];

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
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  return dealYear > currentYear || (dealYear === currentYear && dealMonth > currentMonth);
}

function validateDemoInputs() {
  const region = (process.env.PUBLIC_DATA_SMOKE_REGION ?? "서울 관악구").trim();
  if (region.length < 2) {
    failDemoInput("PUBLIC_DATA_SMOKE_REGION must include at least 2 meaningful characters.");
  }
  if (/[\u0000-\u001F\u007F`]/.test(region)) {
    failDemoInput("PUBLIC_DATA_SMOKE_REGION must not include control characters, line breaks, tabs, or Markdown backticks.");
  }
  if (/\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/.test(region) || /\b\d{6}[\s.-]?[0-9]\d{6}\b/.test(region) || /\b01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}\b/.test(region) || /\b0(?:2|[3-6][1-5]|70|80)[\s.-]?\d{3,4}[\s.-]?\d{4}\b/.test(region) || /(?:계좌(?:번호)?|입금\s*계좌|송금\s*계좌)\s*(?:은|는|:)?\s*\d{2,6}[\s-]\d{2,6}[\s-]\d{2,8}/.test(region) || /\b\d{1,4}\s*동\s*\d{1,4}\s*호/.test(region) || /\b\d{1,3}\s*층\s*\d{1,4}\s*호/.test(region) || /\b\d{2,4}\s*호/.test(region)) {
    failDemoInput("PUBLIC_DATA_SMOKE_REGION must not include personal identifiers, email addresses, phone numbers, payment account details, or household unit details.");
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

  const rawHousingTypes = process.env.PUBLIC_DATA_SMOKE_HOUSING_TYPES?.trim();
  if (rawHousingTypes) {
    const requested = rawHousingTypes.split(",").map(type => type.trim()).filter(Boolean);
    if (requested.length === 0) {
      failDemoInput("PUBLIC_DATA_SMOKE_HOUSING_TYPES must include at least one supported housing type.");
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

validateDemoInputs();
