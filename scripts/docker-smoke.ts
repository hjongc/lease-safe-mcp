import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";

const imageTag = process.env.DOCKER_SMOKE_IMAGE ?? process.env.PREFLIGHT_DOCKER_TAG ?? "lease-safe-mcp-preflight";
const containerName = `lease-safe-mcp-smoke-${process.pid}`;
const DEFAULT_MCP_MAX_BODY_BYTES = 256 * 1024;
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
        assertSecurityHeaders(response, "docker healthz");
        const body = await response.json() as { ok?: unknown; service?: unknown; version?: unknown; maxBodyBytes?: unknown; rateLimitPerMinute?: unknown; publicDataTimeoutMs?: unknown };
        if (
          body.ok === true &&
          body.service === "lease-safe" &&
          typeof body.version === "string" &&
          body.maxBodyBytes === undefined &&
          body.rateLimitPerMinute === undefined &&
          body.publicDataTimeoutMs === undefined
        ) {
          return;
        }
      }
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }

  throw new Error(`Timed out waiting for ${healthUrl}: ${(lastError as Error | undefined)?.message ?? "no response"}`);
}

function assertSecurityHeaders(response: Response, label: string): void {
  const requestId = response.headers.get("x-request-id");
  if (!requestId || !/^[A-Za-z0-9._-]{1,64}$/.test(requestId)) {
    throw new Error(`${label} response must set a safe X-Request-Id.`);
  }
  if (response.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error(`${label} response must set X-Content-Type-Options: nosniff.`);
  }
  if (response.headers.get("x-frame-options") !== "DENY") {
    throw new Error(`${label} response must set X-Frame-Options: DENY.`);
  }
  if (response.headers.get("content-security-policy") !== "default-src 'none'; base-uri 'none'; frame-ancestors 'none'") {
    throw new Error(`${label} response must set a restrictive Content-Security-Policy.`);
  }
  if (response.headers.get("referrer-policy") !== "no-referrer") {
    throw new Error(`${label} response must set Referrer-Policy: no-referrer.`);
  }
  if (response.headers.get("cache-control") !== "no-store") {
    throw new Error(`${label} response must set Cache-Control: no-store.`);
  }
}

async function verifyRequestIdPropagation(endpoint: string): Promise<void> {
  const response = await fetch(endpoint.replace(/\/mcp$/, "/healthz"), {
    headers: {
      "x-request-id": "lease-safe-docker-smoke-request-1"
    }
  });

  assertSecurityHeaders(response, "docker request-id propagation");
  if (response.headers.get("x-request-id") !== "lease-safe-docker-smoke-request-1") {
    throw new Error("Docker health response did not preserve the supplied safe X-Request-Id.");
  }
}

async function verifyUnknownRoute(endpoint: string): Promise<void> {
  const response = await fetch(endpoint.replace(/\/mcp$/, "/unknown-route"));
  assertSecurityHeaders(response, "docker unknown route");

  if (response.status !== 404) {
    const text = await response.text();
    throw new Error(`Expected unknown Docker route to return 404, got ${response.status}: ${text}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Unknown Docker route must return application/json, not the default HTML response.");
  }

  const body = await response.json() as { error?: unknown };
  if (body.error !== "Not found") {
    throw new Error("Unknown Docker route did not return the expected not-found JSON body.");
  }
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

async function verifyRejectedHost(endpoint: string): Promise<void> {
  const target = new URL(endpoint.replace(/\/mcp$/, "/healthz"));
  const response = await new Promise<{ statusCode: number; body: string; requestId: string | string[] | undefined }>((resolve, reject) => {
    const req = request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "GET",
      headers: {
        Host: "evil.example"
      }
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode ?? 0, body, requestId: res.headers["x-request-id"] });
      });
    });
    req.on("error", reject);
    req.end();
  });

  if (response.statusCode !== 403) {
    throw new Error(`Expected disallowed Docker Host header to return 403, got ${response.statusCode}: ${response.body}`);
  }
  if (typeof response.requestId !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(response.requestId)) {
    throw new Error("Disallowed Docker Host header response must include a safe X-Request-Id.");
  }

  const body = JSON.parse(response.body) as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32000 || body.error?.message !== "Invalid Host: evil.example") {
    throw new Error("Disallowed Docker Host header did not return the expected JSON-RPC host validation error.");
  }
}

async function verifyMethodNotAllowed(endpoint: string, method: "GET" | "DELETE" | "OPTIONS" | "PUT", expectedMessage: string): Promise<void> {
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

async function verifyHeadMethodNotAllowed(endpoint: string): Promise<void> {
  const response = await fetch(endpoint, { method: "HEAD" });

  if (response.status !== 405) {
    throw new Error(`Expected HEAD Docker MCP request to return 405, got ${response.status}.`);
  }

  const allow = response.headers.get("allow");
  if (allow !== "POST") {
    throw new Error(`Expected HEAD Docker MCP request to advertise Allow: POST, got ${allow ?? "missing"}.`);
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

async function verifyUnauthorizedInvalidJsonRequest(endpoint: string): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: "{"
  });

  if (response.status !== 401) {
    const text = await response.text();
    throw new Error(`Expected unauthenticated invalid JSON Docker MCP request to return 401 before parsing, got ${response.status}: ${text}`);
  }

  const authenticate = response.headers.get("www-authenticate");
  if (authenticate !== 'Bearer realm="lease-safe"') {
    throw new Error(`Expected unauthenticated invalid JSON Docker MCP request to advertise WWW-Authenticate: Bearer, got ${authenticate ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { message?: unknown } };
  if (body.error?.message !== "Unauthorized") {
    throw new Error("Unauthenticated invalid JSON Docker MCP request did not return the expected JSON-RPC auth error.");
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

async function verifyOversizedBearerTokenRejected(endpoint: string): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${"x".repeat(4097)}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "docker-oversized-bearer-smoke",
      method: "tools/list"
    })
  });

  if (response.status !== 401) {
    const text = await response.text();
    throw new Error(`Expected oversized bearer Docker MCP request to return 401, got ${response.status}: ${text}`);
  }

  const authenticate = response.headers.get("www-authenticate");
  if (authenticate !== 'Bearer realm="lease-safe"') {
    throw new Error(`Expected oversized bearer Docker MCP request to advertise WWW-Authenticate: Bearer, got ${authenticate ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { message?: unknown } };
  if (body.error?.message !== "Unauthorized") {
    throw new Error("Oversized bearer Docker MCP request did not return the expected JSON-RPC auth error.");
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
    "MCP_ALLOWED_HOSTS=127.0.0.1,localhost",
    "-e",
    `${publicDataKeyEnvName}=${publicDataSmokeKey}`,
    "-e",
    `MCP_AUTH_TOKEN=${authToken}`,
    imageTag
  ]);

  try {
    await waitForHealth(port, containerId);
    console.log("docker_healthz=ok");
    await verifyRequestIdPropagation(endpoint);
    console.log("docker_request_id=ok");
    await verifyUnknownRoute(endpoint);
    console.log("docker_unknown_route=ok");
    await verifyRejectedHost(endpoint);
    console.log("docker_host_rejection=ok");
    await verifyHeadMethodNotAllowed(endpoint);
    await verifyMethodNotAllowed(endpoint, "GET", "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
    await verifyMethodNotAllowed(endpoint, "DELETE", "Method not allowed for stateless server.");
    await verifyMethodNotAllowed(endpoint, "OPTIONS", "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
    await verifyMethodNotAllowed(endpoint, "PUT", "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
    console.log("docker_method_rejection=ok");
    await verifyInvalidJsonRequest(endpoint, authToken);
    console.log("docker_invalid_json_rejection=ok");
    await verifyUnauthorizedInvalidJsonRequest(endpoint);
    console.log("docker_auth_before_parse=ok");
    await verifyUnsupportedContentTypeRequest(endpoint, authToken);
    console.log("docker_content_type_rejection=ok");
    await verifyUnauthorizedRequest(endpoint);
    console.log("docker_auth_rejection=ok");
    await verifyOversizedBearerTokenRejected(endpoint);
    console.log("docker_oversized_bearer_rejection=ok");
    await verifyOversizedRequest(endpoint, DEFAULT_MCP_MAX_BODY_BYTES);
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
