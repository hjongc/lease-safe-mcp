import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const imageTag = process.env.DOCKER_SMOKE_IMAGE ?? process.env.PREFLIGHT_DOCKER_TAG ?? "lease-safe-mcp-preflight";
const containerName = `lease-safe-mcp-smoke-${process.pid}`;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate a local TCP port."));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function collectOutput(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr?.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}\n${stderr.trim()}`));
    });
  });
}

function runNode(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${process.execPath} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function containerIsRunning(containerId: string): Promise<boolean> {
  const state = await collectOutput("docker", ["inspect", "-f", "{{.State.Running}}", containerId]);
  return state === "true";
}

async function containerLogs(containerId: string): Promise<string> {
  try {
    return await collectOutput("docker", ["logs", containerId]);
  } catch (error) {
    return (error as Error).message;
  }
}

async function waitForHealth(port: number, containerId: string): Promise<void> {
  const healthUrl = `http://127.0.0.1:${port}/healthz`;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 12000) {
    if (!(await containerIsRunning(containerId))) {
      throw new Error(`Container exited before health check passed.\n${await containerLogs(containerId)}`);
    }

    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        const body = await response.json() as { ok?: unknown; service?: unknown };
        if (body.ok === true && body.service === "lease-safe") return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }

  throw new Error(`Timed out waiting for ${healthUrl}: ${(lastError as Error | undefined)?.message ?? "no response"}`);
}

async function stopContainer(containerId: string): Promise<void> {
  try {
    await collectOutput("docker", ["stop", "--time", "3", containerId]);
  } catch (error) {
    console.error((error as Error).message);
  }
}

async function main() {
  const port = Number(process.env.DOCKER_SMOKE_PORT || await getFreePort());
  const endpoint = `http://127.0.0.1:${port}/mcp`;

  console.log(`Starting Docker smoke container ${containerName} from ${imageTag}`);
  const containerId = await collectOutput("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-p",
    `127.0.0.1:${port}:3000`,
    "-e",
    "MCP_ALLOWED_HOSTS=127.0.0.1,localhost",
    "-e",
    "DATA_GO_KR_SERVICE_KEY=dummy-preflight-key",
    imageTag
  ]);

  try {
    await waitForHealth(port, containerId);
    console.log("docker_healthz=ok");
    await runNode(["dist/scripts/smoke.js"], {
      ...process.env,
      MCP_ENDPOINT: endpoint
    });
    console.log("docker_smoke=ok");
  } finally {
    await stopContainer(containerId);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
