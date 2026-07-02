import { spawn } from "node:child_process";
import { dockerImageReferenceFromEnv } from "./docker-image-reference.js";
import { extractLivePublicDataEvidenceLines } from "./live-evidence.js";
import { compactScriptErrorMessage } from "./safe-error.js";

interface Step {
  name: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  skip?: boolean;
  skipReason?: string;
  attempts?: number;
  captureOutput?: boolean;
  validateOutput?: (output: string) => void;
}

const dockerTag = dockerImageReferenceFromEnv("PREFLIGHT_DOCKER_TAG", undefined, "lease-safe-mcp-preflight");
const dockerPlatform = "linux/amd64";
const hasPublicDataKey = Boolean(process.env.DATA_GO_KR_SERVICE_KEY?.trim());
const requireLivePublicData = process.env.REQUIRE_LIVE_PUBLIC_DATA === "1";
const registrationPublicDataTimeoutMs = "30000";

const steps: Step[] = [
  {
    name: "Working tree whitespace diff check",
    command: "git",
    args: ["diff", "--check"]
  },
  {
    name: "Staged whitespace diff check",
    command: "git",
    args: ["diff", "--cached", "--check"]
  },
  {
    name: "Committed whitespace diff check",
    command: "git",
    args: ["diff-tree", "--check", "--root", "--no-commit-id", "-r", "HEAD"]
  },
  {
    name: "Secret scan",
    command: "npm",
    args: ["run", "scan:secrets"]
  },
  {
    name: "Unit and domain tests",
    command: "npm",
    args: ["test"]
  },
  {
    name: "PlayMCP readiness validation",
    command: "npm",
    args: ["run", "validate:playmcp"]
  },
  {
    name: "Official source freshness",
    command: "npm",
    args: ["run", "check:sources"]
  },
  {
    name: "Local MCP HTTP smoke",
    command: "npm",
    args: ["run", "smoke:http"]
  },
  {
    name: "MCP rate-limit smoke",
    command: "npm",
    args: ["run", "smoke:rate-limit"]
  },
  {
    name: "Production dependency audit",
    command: "npm",
    args: ["audit", "--omit=dev"]
  },
  {
    name: "Docker build",
    command: "docker",
    args: ["build", "--platform", dockerPlatform, "-t", dockerTag, "."],
    attempts: 3
  },
  {
    name: "Docker runtime smoke",
    command: "node",
    args: ["dist/scripts/docker-smoke.js"],
    env: {
      DOCKER_SMOKE_IMAGE: dockerTag
    }
  },
  {
    name: "Live public-data smoke",
    command: "npm",
    args: ["run", "smoke:public-data"],
    env: {
      PUBLIC_DATA_TIMEOUT_MS: process.env.PUBLIC_DATA_TIMEOUT_MS ?? registrationPublicDataTimeoutMs,
      REQUIRE_LIVE_PUBLIC_DATA: "1"
    },
    skip: !hasPublicDataKey && !requireLivePublicData,
    skipReason: "DATA_GO_KR_SERVICE_KEY is not set",
    captureOutput: true,
    validateOutput: output => {
      const evidenceLines = extractLivePublicDataEvidenceLines(output);
      console.log(`- Live public-data evidence extraction: ok (${evidenceLines.length} lines)`);
    }
  }
];

function elapsedSeconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runStepAttempt(step: Step): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(step.command, step.args, {
      env: { ...process.env, ...step.env },
      shell: process.platform === "win32",
      stdio: step.captureOutput ? ["inherit", "pipe", "pipe"] : "inherit"
    });

    if (step.captureOutput) {
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        process.stdout.write(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(chunk);
      });
    }

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`${step.name} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function runStep(step: Step): Promise<void> {
  if (step.skip) {
    console.log(`- ${step.name}: skipped (${step.skipReason})`);
    return;
  }

  const startedAt = Date.now();
  const attempts = step.attempts ?? 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const attemptLabel = attempts > 1 ? ` (attempt ${attempt}/${attempts})` : "";
    console.log(`- ${step.name}: running ${step.command} ${step.args.join(" ")}${attemptLabel}`);

    try {
      const output = await runStepAttempt(step);
      step.validateOutput?.(output);
      console.log(`- ${step.name}: ok (${elapsedSeconds(startedAt)})`);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const delayMs = attempt * 10000;
      console.log(`- ${step.name}: attempt ${attempt} failed; retrying in ${delayMs / 1000}s`);
      await delay(delayMs);
    }
  }
}

async function main() {
  console.log("Lease Safe release preflight");
  console.log(`Docker tag: ${dockerTag}`);
  console.log(`Docker platform: ${dockerPlatform}`);
  if (requireLivePublicData) {
    console.log("Registration mode: live public-data smoke is required.");
  }
  if (requireLivePublicData && !hasPublicDataKey) {
    throw new Error("DATA_GO_KR_SERVICE_KEY is required for registration preflight.");
  }
  if (!hasPublicDataKey) {
    console.log("Live public-data smoke will be skipped because DATA_GO_KR_SERVICE_KEY is not set.");
  }

  const startedAt = Date.now();
  for (const step of steps) {
    await runStep(step);
  }
  console.log(`Preflight passed in ${elapsedSeconds(startedAt)}`);
}

main().catch(error => {
  console.error(compactScriptErrorMessage(error));
  process.exit(1);
});
