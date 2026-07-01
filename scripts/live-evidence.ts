import { readFileSync } from "node:fs";
import { PUBLIC_DATA_SMOKE_HOUSING_TYPES } from "./public-data-smoke.js";

type EvidenceCategory = {
  readonly name: string;
  readonly pattern: RegExp;
};

const EVIDENCE_LINE_PATTERN = /^(public_data_smoke_config|legal_dong=ok|rent_market\[|sale_market\[|lease_assessment\[)/;

const REQUIRED_EVIDENCE_CATEGORIES: EvidenceCategory[] = [
  { name: "public_data_smoke_config", pattern: /^public_data_smoke_config / },
  { name: "legal_dong=ok", pattern: /^legal_dong=ok$/ },
  { name: "rent_market", pattern: /^rent_market\[/ },
  { name: "sale_market", pattern: /^sale_market\[/ },
  { name: "lease_assessment", pattern: /^lease_assessment\[/ }
];

const SUPPORTED_EVIDENCE_HOUSING_TYPES = PUBLIC_DATA_SMOKE_HOUSING_TYPES;

function expectedHousingTypesFromConfig(configLine: string): string[] {
  if (!/\bregistration_mode=true\b/.test(configLine)) {
    throw new Error("Live public-data smoke config evidence must be in registration_mode=true.");
  }

  const match = /\bhousing_types=([A-Za-z0-9_,_-]+)/.exec(configLine);
  if (!match) {
    throw new Error("Live public-data smoke config evidence is missing housing_types.");
  }

  const housingTypes = match[1].split(",").filter(Boolean);
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

  const configLine = lines.find(line => /^public_data_smoke_config /.test(line));
  if (!configLine) {
    throw new Error("Live public-data smoke config evidence line was not found.");
  }

  const missingByHousingType = expectedHousingTypesFromConfig(configLine).flatMap(housingType => {
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
