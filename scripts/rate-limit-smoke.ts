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

function smokePortFromEnv(name: string): number | undefined {
  const rawPort = process.env[name]?.trim();
  if (!rawPort) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(rawPort)) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

async function waitForHealth(port: number, server: ChildProcess): Promise<void> {
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
        const body = await response.json() as { ok?: unknown; service?: unknown; rateLimitPerMinute?: unknown };
        if (body.ok === true && body.service === "lease-safe" && body.rateLimitPerMinute === 1) return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${healthUrl}: ${(lastError as Error | undefined)?.message ?? "no response"}`);
}

async function postProbe(endpoint: string): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    })
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
  const port = smokePortFromEnv("MCP_RATE_LIMIT_SMOKE_PORT") ?? await getFreePort();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const env = {
    ...process.env,
    MCP_ALLOWED_HOSTS: process.env.MCP_ALLOWED_HOSTS ?? "127.0.0.1,localhost",
    MCP_RATE_LIMIT_PER_MINUTE: "1",
    PORT: String(port)
  };

  console.log(`Starting rate-limit smoke server on ${endpoint}`);
  const server = spawn(process.execPath, ["dist/src/server.js"], {
    env,
    stdio: "inherit"
  });

  try {
    await waitForHealth(port, server);
    console.log("rate_limit_healthz=ok");

    const first = await postProbe(endpoint);
    await first.text();
    if (first.status === 429) {
      throw new Error("First MCP POST was unexpectedly rate limited.");
    }

    const second = await postProbe(endpoint);
    const retryAfter = second.headers.get("retry-after");
    const body = await second.text();
    if (second.status !== 429 || !retryAfter) {
      throw new Error(`Expected second MCP POST to return 429 with Retry-After, got ${second.status}: ${body}`);
    }

    console.log("rate_limit_rejection=ok");
  } finally {
    await stopServer(server);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
