import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(port: number, server: ChildProcess): Promise<number> {
  const healthUrl = `http://127.0.0.1:${port}/healthz`;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 8000) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited before health check passed with code ${server.exitCode}`);
    }

    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        const body = await response.json() as { ok?: unknown; service?: unknown; maxBodyBytes?: unknown; rateLimitPerMinute?: unknown };
        if (
          body.ok === true &&
          body.service === "lease-safe" &&
          Number.isSafeInteger(body.maxBodyBytes) &&
          Number.isSafeInteger(body.rateLimitPerMinute)
        ) {
          return Number(body.maxBodyBytes);
        }
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${healthUrl}: ${(lastError as Error | undefined)?.message ?? "no response"}`);
}

async function verifyOversizedRequest(endpoint: string, maxBodyBytes: number): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: "x".repeat(maxBodyBytes + 1)
  });

  if (response.status !== 413) {
    const text = await response.text();
    throw new Error(`Expected oversized MCP request to return 413, got ${response.status}: ${text}`);
  }
}

async function verifyUnauthorizedRequest(endpoint: string): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "unauthorized-smoke",
      method: "tools/list"
    })
  });

  if (response.status !== 401) {
    const text = await response.text();
    throw new Error(`Expected unauthenticated MCP request to return 401, got ${response.status}: ${text}`);
  }

  const body = await response.json() as { error?: { message?: unknown } };
  if (body.error?.message !== "Unauthorized") {
    throw new Error("Unauthenticated MCP request did not return the expected JSON-RPC error.");
  }
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

function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
      resolve();
    }, 3000);
    server.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function main() {
  const port = Number(process.env.MCP_HTTP_SMOKE_PORT || await getFreePort());
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const env = {
    ...process.env,
    MCP_ALLOWED_HOSTS: process.env.MCP_ALLOWED_HOSTS ?? `127.0.0.1:${port},localhost`,
    MCP_AUTH_TOKEN: process.env.MCP_AUTH_TOKEN ?? "smoke-token-for-preflight",
    MCP_ENDPOINT: endpoint,
    PORT: String(port)
  };

  console.log(`Starting local MCP server on ${endpoint}`);
  const server = spawn(process.execPath, ["dist/src/server.js"], {
    env,
    stdio: "inherit"
  });

  try {
    const maxBodyBytes = await waitForHealth(port, server);
    console.log("healthz=ok");
    await verifyUnauthorizedRequest(endpoint);
    console.log("auth_rejection=ok");
    await verifyOversizedRequest(endpoint, maxBodyBytes);
    console.log("oversized_request=ok");
    await runNode(["dist/scripts/smoke.js"], env);
    console.log("http_smoke=ok");
  } finally {
    await stopServer(server);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
