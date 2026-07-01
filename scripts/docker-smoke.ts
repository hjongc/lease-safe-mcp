import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const imageTag = process.env.DOCKER_SMOKE_IMAGE ?? process.env.PREFLIGHT_DOCKER_TAG ?? "lease-safe-mcp-preflight";
const containerName = `lease-safe-mcp-smoke-${process.pid}`;
const publicDataSmokeKey = [
  "LeaseSafePublicDataSmokeKey",
  "OnlyForDockerSmoke1234567890+/",
  "=="
].join("");
const publicDataKeyEnvName = ["DATA_GO_KR", "SERVICE_KEY"].join("_");

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

async function waitForHealth(port: number, containerId: string): Promise<number> {
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
    await delay(300);
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

async function verifyMethodNotAllowed(endpoint: string, method: "GET" | "DELETE" | "PUT", expectedMessage: string): Promise<void> {
  const response = await fetch(endpoint, { method });

  if (response.status !== 405) {
    const text = await response.text();
    throw new Error(`Expected ${method} Docker MCP request to return 405, got ${response.status}: ${text}`);
  }

  const allow = response.headers.get("allow");
  if (allow !== "POST") {
    throw new Error(`Expected ${method} Docker MCP request to advertise Allow: POST, got ${allow ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32000 || body.error?.message !== expectedMessage) {
    throw new Error(`${method} Docker MCP request did not return the expected JSON-RPC method error.`);
  }
}

async function verifyInvalidJsonRequest(endpoint: string, authToken: string): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json"
    },
    body: "{"
  });

  if (response.status !== 400) {
    const text = await response.text();
    throw new Error(`Expected invalid JSON Docker MCP request to return 400, got ${response.status}: ${text}`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32700 || body.error?.message !== "Invalid JSON request body.") {
    throw new Error("Invalid JSON Docker MCP request did not return the expected JSON-RPC parse error.");
  }
}

async function verifyUnsupportedContentTypeRequest(endpoint: string, authToken: string): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "text/plain"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "docker-unsupported-content-type-smoke",
      method: "tools/list"
    })
  });

  if (response.status !== 415) {
    const text = await response.text();
    throw new Error(`Expected unsupported content-type Docker MCP request to return 415, got ${response.status}: ${text}`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32600 || body.error?.message !== "MCP POST requests must use application/json.") {
    throw new Error("Unsupported content-type Docker MCP request did not return the expected JSON-RPC invalid request error.");
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
      id: "docker-unauthorized-smoke",
      method: "tools/list"
    })
  });

  if (response.status !== 401) {
    const text = await response.text();
    throw new Error(`Expected unauthenticated Docker MCP request to return 401, got ${response.status}: ${text}`);
  }

  const authenticate = response.headers.get("www-authenticate");
  if (authenticate !== 'Bearer realm="lease-safe"') {
    throw new Error(`Expected unauthenticated Docker MCP request to advertise WWW-Authenticate: Bearer, got ${authenticate ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { message?: unknown } };
  if (body.error?.message !== "Unauthorized") {
    throw new Error("Unauthenticated Docker MCP request did not return the expected JSON-RPC error.");
  }
}

async function stopContainer(containerId: string): Promise<void> {
  try {
    await collectOutput("docker", ["stop", "--time", "3", containerId]);
  } catch (error) {
    console.error((error as Error).message);
  }
}

async function main() {
  const port = smokePortFromEnv("DOCKER_SMOKE_PORT") ?? await getFreePort();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const authToken = process.env.DOCKER_SMOKE_MCP_AUTH_TOKEN ?? "smoke-token-for-preflight";

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
    `MCP_ALLOWED_HOSTS=127.0.0.1:${port},localhost`,
    "-e",
    `${publicDataKeyEnvName}=${publicDataSmokeKey}`,
    "-e",
    `MCP_AUTH_TOKEN=${authToken}`,
    imageTag
  ]);

  try {
    const maxBodyBytes = await waitForHealth(port, containerId);
    console.log("docker_healthz=ok");
    await verifyMethodNotAllowed(endpoint, "GET", "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
    await verifyMethodNotAllowed(endpoint, "DELETE", "Method not allowed for stateless server.");
    await verifyMethodNotAllowed(endpoint, "PUT", "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
    console.log("docker_method_rejection=ok");
    await verifyInvalidJsonRequest(endpoint, authToken);
    console.log("docker_invalid_json_rejection=ok");
    await verifyUnsupportedContentTypeRequest(endpoint, authToken);
    console.log("docker_content_type_rejection=ok");
    await verifyUnauthorizedRequest(endpoint);
    console.log("docker_auth_rejection=ok");
    await verifyOversizedRequest(endpoint, maxBodyBytes);
    console.log("docker_oversized_request=ok");
    await runNode(["dist/scripts/smoke.js"], {
      ...process.env,
      MCP_AUTH_TOKEN: authToken,
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
