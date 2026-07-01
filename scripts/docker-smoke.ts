import { spawn, type ChildProcess } from "node:child_process";
import { request, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import { dockerImageReferenceFromEnv } from "./docker-image-reference.js";

const imageTag = dockerImageReferenceFromEnv("DOCKER_SMOKE_IMAGE", "PREFLIGHT_DOCKER_TAG", "lease-safe-mcp-preflight");
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

async function verifyContainerRunsAsNonRoot(containerId: string): Promise<void> {
  const uid = await collectOutput("docker", ["exec", containerId, "id", "-u"]);
  if (uid === "0") {
    throw new Error("Docker runtime must not run the MCP server as root.");
  }
  if (!/^\d+$/.test(uid)) {
    throw new Error(`Docker runtime returned an invalid numeric uid: ${uid}`);
  }
}

async function imageHealthcheckCommand(): Promise<string[]> {
  const rawHealthcheck = await collectOutput("docker", ["inspect", "-f", "{{json .Config.Healthcheck.Test}}", imageTag]);
  const parsed = JSON.parse(rawHealthcheck) as unknown;
  if (!Array.isArray(parsed) || parsed[0] !== "CMD" || !parsed.slice(1).every(value => typeof value === "string")) {
    throw new Error("Docker image must define an exec-form HEALTHCHECK command.");
  }
  return parsed.slice(1) as string[];
}

async function verifyHealthcheckWithExternalAllowedHost(): Promise<void> {
  const healthcheckContainerName = `${containerName}-health`;
  const healthcheckArgs = await imageHealthcheckCommand();
  const healthcheckContainerId = await collectOutput("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    healthcheckContainerName,
    "-e",
    "MCP_ALLOWED_HOSTS=lease-safe.example.com",
    "-e",
    `${publicDataKeyEnvName}=${publicDataSmokeKey}`,
    imageTag
  ]);
  const startedAt = Date.now();
  let lastError: unknown;

  try {
    while (Date.now() - startedAt < 12000) {
      if (!(await containerIsRunning(healthcheckContainerId))) {
        throw new Error(`Healthcheck-only container exited before Docker healthcheck passed.\n${await containerLogs(healthcheckContainerId)}`);
      }

      try {
        await collectOutput("docker", ["exec", healthcheckContainerId, ...healthcheckArgs]);
        return;
      } catch (error) {
        lastError = error;
      }
      await delay(300);
    }
    throw new Error(`Docker HEALTHCHECK did not pass with an external-only MCP_ALLOWED_HOSTS value: ${(lastError as Error | undefined)?.message ?? "no response"}`);
  } finally {
    await stopContainer(healthcheckContainerId);
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
  if (response.headers.has("x-powered-by")) {
    throw new Error(`${label} response must not expose X-Powered-By.`);
  }
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function assertRawSecurityHeaders(headers: IncomingHttpHeaders, label: string): void {
  const requestId = headerValue(headers, "x-request-id");
  if (!requestId || !/^[A-Za-z0-9._-]{1,64}$/.test(requestId)) {
    throw new Error(`${label} response must set a safe X-Request-Id.`);
  }
  if (headerValue(headers, "x-content-type-options") !== "nosniff") {
    throw new Error(`${label} response must set X-Content-Type-Options: nosniff.`);
  }
  if (headerValue(headers, "x-frame-options") !== "DENY") {
    throw new Error(`${label} response must set X-Frame-Options: DENY.`);
  }
  if (headerValue(headers, "content-security-policy") !== "default-src 'none'; base-uri 'none'; frame-ancestors 'none'") {
    throw new Error(`${label} response must set a restrictive Content-Security-Policy.`);
  }
  if (headerValue(headers, "referrer-policy") !== "no-referrer") {
    throw new Error(`${label} response must set Referrer-Policy: no-referrer.`);
  }
  if (headerValue(headers, "cache-control") !== "no-store") {
    throw new Error(`${label} response must set Cache-Control: no-store.`);
  }
  if (headerValue(headers, "x-powered-by") !== undefined) {
    throw new Error(`${label} response must not expose X-Powered-By.`);
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

  const unsafeRequestId = "unsafe docker request id with spaces";
  const unsafeResponse = await fetch(endpoint.replace(/\/mcp$/, "/healthz"), {
    headers: {
      "x-request-id": unsafeRequestId
    }
  });
  assertSecurityHeaders(unsafeResponse, "docker invalid request-id regeneration");
  if (unsafeResponse.headers.get("x-request-id") === unsafeRequestId) {
    throw new Error("Docker health response must not echo an unsafe X-Request-Id value.");
  }
}

async function verifyMcpRequestIdPropagation(endpoint: string, authToken: string): Promise<void> {
  const safeRequestId = "lease-safe-docker-smoke-mcp-request-1";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
      "x-request-id": safeRequestId
    },
    body: "{"
  });

  assertSecurityHeaders(response, "docker MCP request-id propagation");
  if (response.status !== 400) {
    const text = await response.text();
    throw new Error(`Expected invalid JSON Docker MCP request-id probe to return 400, got ${response.status}: ${text}`);
  }
  if (response.headers.get("x-request-id") !== safeRequestId) {
    throw new Error("Docker MCP response did not preserve the supplied safe X-Request-Id.");
  }

  const unsafeRequestId = "unsafe docker mcp request id with spaces";
  const unsafeResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
      "x-request-id": unsafeRequestId
    },
    body: "{"
  });
  assertSecurityHeaders(unsafeResponse, "docker invalid MCP request-id regeneration");
  if (unsafeResponse.status !== 400) {
    const text = await unsafeResponse.text();
    throw new Error(`Expected unsafe Docker MCP request-id probe to return 400, got ${unsafeResponse.status}: ${text}`);
  }
  if (unsafeResponse.headers.get("x-request-id") === unsafeRequestId) {
    throw new Error("Docker MCP response must not echo an unsafe X-Request-Id value.");
  }
}

async function verifyRootRoute(endpoint: string): Promise<void> {
  const response = await fetch(endpoint.replace(/\/mcp$/, "/"));
  assertSecurityHeaders(response, "docker root route");

  if (response.status !== 200) {
    const text = await response.text();
    throw new Error(`Expected Docker root route to return 200, got ${response.status}: ${text}`);
  }
  if (!response.headers.get("content-type")?.startsWith("text/plain")) {
    throw new Error("Docker root route must return text/plain.");
  }

  const text = await response.text();
  if (text !== "Lease Safe(전월세안전내비) MCP server is running. Use POST /mcp for Streamable HTTP.") {
    throw new Error("Docker root route did not return the expected minimal MCP usage hint.");
  }
  if (/DATA_GO_KR_SERVICE_KEY|MCP_AUTH_TOKEN|MCP_ALLOWED_HOSTS|PUBLIC_DATA_TIMEOUT_MS/.test(text)) {
    throw new Error("Docker root route must not expose runtime configuration names.");
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

async function verifyEncodedOddPathRejected(endpoint: string): Promise<void> {
  const target = new URL(endpoint);
  const response = await new Promise<{ statusCode: number; body: string; contentType: string | string[] | undefined; requestId: string | string[] | undefined; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({
      hostname: target.hostname,
      port: target.port,
      path: "/%",
      method: "GET"
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body,
          contentType: res.headers["content-type"],
          requestId: res.headers["x-request-id"],
          headers: res.headers
        });
      });
    });
    req.on("error", reject);
    req.end();
  });

  assertRawSecurityHeaders(response.headers, "encoded odd Docker path");
  if (response.statusCode !== 404) {
    throw new Error(`Expected encoded odd Docker path to return 404, got ${response.statusCode}: ${response.body}`);
  }
  if (typeof response.requestId !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(response.requestId)) {
    throw new Error("Encoded odd Docker path response must include a safe X-Request-Id.");
  }
  if (typeof response.contentType !== "string" || !response.contentType.includes("application/json")) {
    throw new Error("Encoded odd Docker path response must return application/json, not the default HTML error response.");
  }

  const body = JSON.parse(response.body) as { error?: unknown };
  if (body.error !== "Not found") {
    throw new Error("Encoded odd Docker path response did not return the expected not-found JSON body.");
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

  assertSecurityHeaders(response, "docker oversized request rejection");
  if (response.status !== 413) {
    const text = await response.text();
    throw new Error(`Expected oversized MCP request to return 413, got ${response.status}: ${text}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Oversized Docker MCP request rejection must return application/json.");
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32600 || body.error?.message !== `MCP request body exceeds ${maxBodyBytes} bytes.`) {
    throw new Error("Oversized Docker MCP request did not return the expected JSON-RPC invalid request error.");
  }
}

async function verifyRejectedHost(endpoint: string): Promise<void> {
  const target = new URL(endpoint.replace(/\/mcp$/, "/healthz"));
  const response = await new Promise<{ statusCode: number; body: string; requestId: string | string[] | undefined; headers: IncomingHttpHeaders }>((resolve, reject) => {
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
        resolve({ statusCode: res.statusCode ?? 0, body, requestId: res.headers["x-request-id"], headers: res.headers });
      });
    });
    req.on("error", reject);
    req.end();
  });

  assertRawSecurityHeaders(response.headers, "disallowed Docker Host header");
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

  assertSecurityHeaders(response, `${method} Docker method rejection`);
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

  assertSecurityHeaders(response, "HEAD Docker method rejection");
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

  assertSecurityHeaders(response, "docker invalid JSON rejection");
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

  assertSecurityHeaders(response, "docker unauthorized invalid JSON rejection");
  if (response.status !== 401) {
    const text = await response.text();
    throw new Error(`Expected unauthenticated invalid JSON Docker MCP request to return 401 before parsing, got ${response.status}: ${text}`);
  }

  const authenticate = response.headers.get("www-authenticate");
  if (authenticate !== 'Bearer realm="lease-safe"') {
    throw new Error(`Expected unauthenticated invalid JSON Docker MCP request to advertise WWW-Authenticate: Bearer, got ${authenticate ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32001 || body.error?.message !== "Unauthorized") {
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

  assertSecurityHeaders(response, "docker unsupported content-type rejection");
  if (response.status !== 415) {
    const text = await response.text();
    throw new Error(`Expected unsupported content-type Docker MCP request to return 415, got ${response.status}: ${text}`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32600 || body.error?.message !== "MCP POST requests must use application/json.") {
    throw new Error("Unsupported content-type Docker MCP request did not return the expected JSON-RPC invalid request error.");
  }
}

async function verifyCompressedRequestRejected(endpoint: string, authToken: string): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-encoding": "gzip",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "docker-compressed-request-smoke",
      method: "tools/list"
    })
  });

  assertSecurityHeaders(response, "docker compressed request rejection");
  if (response.status !== 415) {
    const text = await response.text();
    throw new Error(`Expected compressed Docker MCP request to return 415, got ${response.status}: ${text}`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32600 || body.error?.message !== "MCP POST requests must not use compressed request bodies.") {
    throw new Error("Compressed Docker MCP request did not return the expected JSON-RPC invalid request error.");
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

  assertSecurityHeaders(response, "docker auth rejection");
  if (response.status !== 401) {
    const text = await response.text();
    throw new Error(`Expected unauthenticated Docker MCP request to return 401, got ${response.status}: ${text}`);
  }

  const authenticate = response.headers.get("www-authenticate");
  if (authenticate !== 'Bearer realm="lease-safe"') {
    throw new Error(`Expected unauthenticated Docker MCP request to advertise WWW-Authenticate: Bearer, got ${authenticate ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32001 || body.error?.message !== "Unauthorized") {
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

  assertSecurityHeaders(response, "docker oversized bearer rejection");
  if (response.status !== 401) {
    const text = await response.text();
    throw new Error(`Expected oversized bearer Docker MCP request to return 401, got ${response.status}: ${text}`);
  }

  const authenticate = response.headers.get("www-authenticate");
  if (authenticate !== 'Bearer realm="lease-safe"') {
    throw new Error(`Expected oversized bearer Docker MCP request to advertise WWW-Authenticate: Bearer, got ${authenticate ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32001 || body.error?.message !== "Unauthorized") {
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
    await verifyContainerRunsAsNonRoot(containerId);
    console.log("docker_non_root_user=ok");
    await waitForHealth(port, containerId);
    console.log("docker_healthz=ok");
    await verifyRequestIdPropagation(endpoint);
    console.log("docker_request_id=ok");
    await verifyMcpRequestIdPropagation(endpoint, authToken);
    console.log("docker_mcp_request_id=ok");
    await verifyRootRoute(endpoint);
    console.log("docker_root_route=ok");
    await verifyUnknownRoute(endpoint);
    console.log("docker_unknown_route=ok");
    await verifyEncodedOddPathRejected(endpoint);
    console.log("docker_encoded_odd_path=ok");
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
    await verifyCompressedRequestRejected(endpoint, authToken);
    console.log("docker_compressed_request_rejection=ok");
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
  await verifyHealthcheckWithExternalAllowedHost();
  console.log("docker_healthcheck_external_host=ok");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
