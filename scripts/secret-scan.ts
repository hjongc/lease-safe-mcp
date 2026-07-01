import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const includeExtensions = new Set([".ts", ".js", ".json", ".md", ".yml", ".yaml", ".dockerignore", ".gitignore"]);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const allowedPlaceholders = [
  "DATA_GO_KR_SERVICE_KEY=...",
  "DATA_GO_KR_SERVICE_KEY=your-data-go-kr-service-key",
  "replace-with-runtime-secret"
];

interface Finding {
  file: string;
  reason: string;
  line: number;
}

function extensionOf(file: string): string {
  if (file.endsWith(".dockerignore")) return ".dockerignore";
  if (file.endsWith(".gitignore")) return ".gitignore";
  const index = file.lastIndexOf(".");
  return index >= 0 ? file.slice(index) : "";
}

function listFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listFiles(fullPath));
      continue;
    }
    if (includeExtensions.has(extensionOf(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}

function isAllowedPlaceholder(line: string): boolean {
  return allowedPlaceholders.some(value => line.includes(value));
}

function scanLine(file: string, line: string, lineNumber: number): Finding[] {
  const findings: Finding[] = [];
  const relativeFile = relative(root, file);
  if (isAllowedPlaceholder(line)) return findings;

  const patterns: Array<[RegExp, string]> = [
    [/DATA_GO_KR_SERVICE_KEY\s*=\s*["']?[^"'\s.][^"'\s]{20,}/, "possible committed data.go.kr service key"],
    [/MCP_AUTH_TOKEN\s*=\s*["']?[^"'\s.][^"'\s]{16,}/, "possible committed MCP bearer token"],
    [/(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_%/+.-]{24,}["']/i, "possible committed secret literal"],
    [/[A-Za-z0-9]{20,}%2F[A-Za-z0-9_%.-]{20,}%3D%3D/i, "possible URL-encoded public-data key"]
  ];

  for (const [pattern, reason] of patterns) {
    if (pattern.test(line)) {
      findings.push({ file: relativeFile, reason, line: lineNumber });
    }
  }
  return findings;
}

function main() {
  const findings = listFiles(root).flatMap(file => {
    const content = readFileSync(file, "utf8");
    return content.split(/\r?\n/).flatMap((line, index) => scanLine(file, line, index + 1));
  });

  if (findings.length > 0) {
    console.error("Secret scan failed:");
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} ${finding.reason}`);
    }
    process.exit(1);
  }

  console.log("Secret scan passed");
}

main();
