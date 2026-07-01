import { spawn } from "node:child_process";

interface Step {
  name: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  skip?: boolean;
  skipReason?: string;
}

const dockerTag = process.env.PREFLIGHT_DOCKER_TAG ?? "lease-safe-mcp-preflight";
const hasPublicDataKey = Boolean(process.env.DATA_GO_KR_SERVICE_KEY?.trim());

const steps: Step[] = [
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
    name: "Production dependency audit",
    command: "npm",
    args: ["audit", "--omit=dev"]
  },
  {
    name: "Docker build",
    command: "docker",
    args: ["build", "-t", dockerTag, "."]
  },
  {
    name: "Live public-data smoke",
    command: "npm",
    args: ["run", "smoke:public-data"],
    skip: !hasPublicDataKey,
    skipReason: "DATA_GO_KR_SERVICE_KEY is not set"
  }
];

function elapsedSeconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function runStep(step: Step): Promise<void> {
  if (step.skip) {
    console.log(`- ${step.name}: skipped (${step.skipReason})`);
    return Promise.resolve();
  }

  const startedAt = Date.now();
  console.log(`- ${step.name}: running ${step.command} ${step.args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      env: { ...process.env, ...step.env },
      shell: process.platform === "win32",
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        console.log(`- ${step.name}: ok (${elapsedSeconds(startedAt)})`);
        resolve();
        return;
      }
      reject(new Error(`${step.name} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  console.log("Lease Safe release preflight");
  console.log(`Docker tag: ${dockerTag}`);
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
