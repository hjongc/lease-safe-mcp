import { readFileSync } from "node:fs";
import { PUBLIC_DATA_SMOKE_HOUSING_TYPES } from "./public-data-smoke.js";

type EvidenceCategory = {
  readonly name: string;
  readonly pattern: RegExp;
};

type HousingEvidenceLine = {
  readonly category: "rent_market" | "sale_market" | "lease_assessment";
  readonly housingType: string;
  readonly line: string;
};

const EVIDENCE_LINE_PATTERN = /^(public_data_smoke_config|legal_dong=ok|rent_market\[|sale_market\[|lease_assessment\[)/;
const CONFIG_EVIDENCE_LINE_PATTERN = /^public_data_smoke_config registration_mode=true region="(?:\\.|[^"\\\r\n])*" lawd_cd=(\d{5}) deal_ymd=\d{4}(0[1-9]|1[0-2]) housing_types=([A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*) deposit_manwon=([1-9]\d*)$/;

const REQUIRED_EVIDENCE_CATEGORIES: EvidenceCategory[] = [
  { name: "public_data_smoke_config", pattern: /^public_data_smoke_config / },
  { name: "legal_dong=ok", pattern: /^legal_dong=ok$/ },
  { name: "rent_market", pattern: /^rent_market\[/ },
  { name: "sale_market", pattern: /^sale_market\[/ },
  { name: "lease_assessment", pattern: /^lease_assessment\[/ }
];

const SUPPORTED_EVIDENCE_HOUSING_TYPES = PUBLIC_DATA_SMOKE_HOUSING_TYPES;

function expectedHousingTypesFromConfig(configLine: string): string[] {
  const match = CONFIG_EVIDENCE_LINE_PATTERN.exec(configLine);
  if (!match) {
    throw new Error("Live public-data smoke config evidence must exactly match registration_mode=true, region, lawd_cd, deal_ymd, housing_types, and deposit_manwon fields.");
  }

  const lawdCd = match[1];
  if (lawdCd === "00000") {
    throw new Error("Live public-data smoke config evidence lawd_cd must not be 00000.");
  }

  const housingTypes = match[3].split(",").filter(Boolean);
  if (housingTypes.length === 0) {
    throw new Error("Live public-data smoke config evidence has no housing types.");
  }

  const duplicateHousingTypes = housingTypes.filter((type, index) => housingTypes.indexOf(type) !== index);
  if (duplicateHousingTypes.length > 0) {
    throw new Error(`Duplicate live public-data evidence housing types: ${[...new Set(duplicateHousingTypes)].join(", ")}`);
  }

  const unsupportedHousingTypes = housingTypes.filter(type => !SUPPORTED_EVIDENCE_HOUSING_TYPES.includes(type as (typeof SUPPORTED_EVIDENCE_HOUSING_TYPES)[number]));
  if (unsupportedHousingTypes.length > 0) {
    throw new Error(`Unsupported live public-data evidence housing types: ${unsupportedHousingTypes.join(", ")}`);
  }

  const missingSupportedHousingTypes = SUPPORTED_EVIDENCE_HOUSING_TYPES.filter(type => !housingTypes.includes(type));
  if (missingSupportedHousingTypes.length > 0) {
    throw new Error(`Missing supported live public-data evidence housing types: ${missingSupportedHousingTypes.join(", ")}`);
  }

  return housingTypes;
}

function positiveEvidenceCount(line: string, label: string, pattern: RegExp): number {
  const match = pattern.exec(line);
  if (!match?.[1]) {
    throw new Error(`Malformed live public-data evidence count for ${label}: ${line}`);
  }

  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`Live public-data evidence count for ${label} must be positive: ${line}`);
  }
  return count;
}

function assertOfficialTotalCoversSamples(line: string, label: string, samplePattern: RegExp, officialTotalPattern: RegExp): void {
  const samples = positiveEvidenceCount(line, label, samplePattern);
  const officialTotal = positiveEvidenceCount(line, `${label} official_total`, officialTotalPattern);
  if (officialTotal < samples) {
    throw new Error(`Live public-data official_total for ${label} must be greater than or equal to samples: ${line}`);
  }
}

function assertPositiveEvidenceCounts(lines: string[]): void {
  for (const line of lines) {
    if (/^rent_market\[/.test(line)) {
      assertOfficialTotalCoversSamples(line, "rent_market", /\bsamples=(\d+)\b/, /\bofficial_total=(\d+)\b/);
    }
    if (/^sale_market\[/.test(line)) {
      assertOfficialTotalCoversSamples(line, "sale_market", /\bsamples=(\d+)\b/, /\bofficial_total=(\d+)\b/);
    }
    if (/^lease_assessment\[/.test(line)) {
      assertOfficialTotalCoversSamples(line, "lease_assessment rent", /\brent_samples=(\d+)\b/, /\brent_official_total=(\d+)\b/);
      assertOfficialTotalCoversSamples(line, "lease_assessment sale", /\bsale_samples=(\d+)\b/, /\bsale_official_total=(\d+)\b/);
    }
  }
}

function assertSingleEvidenceLine(lines: string[], label: string, pattern: RegExp): void {
  const matches = lines.filter(line => pattern.test(line));
  if (matches.length !== 1) {
    throw new Error(`Live public-data evidence must include exactly one ${label} line.`);
  }
}

function assertStrictSingletonEvidenceLineFormats(lines: string[]): void {
  for (const line of lines) {
    if (/^public_data_smoke_config/.test(line) && !CONFIG_EVIDENCE_LINE_PATTERN.test(line)) {
      throw new Error(`Malformed live public-data smoke config evidence line. Expected registration_mode=true with exact non-secret fields: ${line}`);
    }
    if (/^legal_dong=ok/.test(line) && !/^legal_dong=ok$/.test(line)) {
      throw new Error(`Malformed live public-data legal-dong evidence line: ${line}`);
    }
  }
}

function parseHousingEvidenceLine(line: string): HousingEvidenceLine | undefined {
  const marketMatch = /^(rent_market|sale_market)\[([A-Za-z0-9_-]+)\]=ok samples=\d+ official_total=\d+$/.exec(line);
  if (marketMatch) {
    return {
      category: marketMatch[1] as HousingEvidenceLine["category"],
      housingType: marketMatch[2],
      line
    };
  }

  const assessmentMatch = /^lease_assessment\[([A-Za-z0-9_-]+)\]=ok rent_samples=\d+ rent_official_total=\d+ sale_samples=\d+ sale_official_total=\d+$/.exec(line);
  if (!assessmentMatch) return undefined;
  return {
    category: "lease_assessment",
    housingType: assessmentMatch[1],
    line
  };
}

function assertStrictHousingEvidenceLineFormats(lines: string[]): void {
  for (const line of lines) {
    if (/^(rent_market|sale_market|lease_assessment)\[/.test(line) && !parseHousingEvidenceLine(line)) {
      throw new Error(`Malformed live public-data housing evidence line: ${line}`);
    }
  }
}

function assertExpectedHousingEvidenceLines(lines: string[], expectedHousingTypes: string[]): void {
  const expectedTypes = new Set(expectedHousingTypes);
  const seen = new Set<string>();

  for (const evidenceLine of lines.map(parseHousingEvidenceLine).filter((line): line is HousingEvidenceLine => Boolean(line))) {
    if (!expectedTypes.has(evidenceLine.housingType)) {
      throw new Error(`Unexpected live public-data evidence housing type: ${evidenceLine.category}[${evidenceLine.housingType}]`);
    }

    const key = `${evidenceLine.category}[${evidenceLine.housingType}]`;
    if (seen.has(key)) {
      throw new Error(`Duplicate live public-data evidence line: ${key}`);
    }
    seen.add(key);
  }
}

export function extractLivePublicDataEvidenceLines(logText: string): string[] {
  const lines = logText.split(/\r?\n/).filter(line => EVIDENCE_LINE_PATTERN.test(line));
  if (lines.length === 0) {
    throw new Error("No live public-data evidence lines were found in captured smoke output.");
  }

  const missing = REQUIRED_EVIDENCE_CATEGORIES
    .filter(category => !lines.some(line => category.pattern.test(line)))
    .map(category => category.name);

  if (missing.length > 0) {
    throw new Error(`Missing required live public-data evidence categories: ${missing.join(", ")}`);
  }

  assertStrictSingletonEvidenceLineFormats(lines);
  assertSingleEvidenceLine(lines, "public_data_smoke_config", /^public_data_smoke_config /);
  assertSingleEvidenceLine(lines, "legal_dong=ok", /^legal_dong=ok$/);
  assertStrictHousingEvidenceLineFormats(lines);

  const configLine = lines.find(line => /^public_data_smoke_config /.test(line));
  if (!configLine) {
    throw new Error("Live public-data smoke config evidence line was not found.");
  }

  const expectedHousingTypes = expectedHousingTypesFromConfig(configLine);
  assertExpectedHousingEvidenceLines(lines, expectedHousingTypes);

  const missingByHousingType = expectedHousingTypes.flatMap(housingType => {
    const requiredLines: EvidenceCategory[] = [
      { name: `rent_market[${housingType}]`, pattern: new RegExp(`^rent_market\\[${housingType}\\]=ok\\b`) },
      { name: `sale_market[${housingType}]`, pattern: new RegExp(`^sale_market\\[${housingType}\\]=ok\\b`) },
      { name: `lease_assessment[${housingType}]`, pattern: new RegExp(`^lease_assessment\\[${housingType}\\]=ok\\b`) }
    ];
    return requiredLines.filter(requiredLine => !lines.some(line => requiredLine.pattern.test(line))).map(requiredLine => requiredLine.name);
  });

  if (missingByHousingType.length > 0) {
    throw new Error(`Missing live public-data evidence lines by housing type: ${missingByHousingType.join(", ")}`);
  }

  assertPositiveEvidenceCounts(lines);

  return lines;
}

function main(): void {
  const logPath = process.argv[2];
  if (!logPath) {
    throw new Error("Usage: node dist/scripts/live-evidence.js <captured-smoke-log>");
  }

  const evidenceLines = extractLivePublicDataEvidenceLines(readFileSync(logPath, "utf8"));
  process.stdout.write(`${evidenceLines.join("\n")}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
