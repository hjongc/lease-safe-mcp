import { spawn } from "node:child_process";

interface Step {
  name: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  skip?: boolean;
  skipReason?: string;
  attempts?: number;
}

const dockerTag = process.env.PREFLIGHT_DOCKER_TAG ?? "lease-safe-mcp-preflight";
const hasPublicDataKey = Boolean(process.env.DATA_GO_KR_SERVICE_KEY?.trim());
const requireLivePublicData = process.env.REQUIRE_LIVE_PUBLIC_DATA === "1";

const steps: Step[] = [
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
    args: ["build", "-t", dockerTag, "."],
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
    skip: !hasPublicDataKey && !requireLivePublicData,
    skipReason: "DATA_GO_KR_SERVICE_KEY is not set"
  }
];

function elapsedSeconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runStepAttempt(step: Step): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      env: { ...process.env, ...step.env },
      shell: process.platform === "win32",
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
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
      await runStepAttempt(step);
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
  console.error(error);
  process.exit(1);
});
