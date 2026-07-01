import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "0.0.0.0", () => {
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
        assertSecurityHeaders(response, "healthz");
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

function assertSecurityHeaders(response: Response, label: string): void {
  if (response.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error(`${label} response must set X-Content-Type-Options: nosniff.`);
  }
  if (response.headers.get("referrer-policy") !== "no-referrer") {
    throw new Error(`${label} response must set Referrer-Policy: no-referrer.`);
  }
  if (response.headers.get("cache-control") !== "no-store") {
    throw new Error(`${label} response must set Cache-Control: no-store.`);
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
  const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
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
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
    });
    req.on("error", reject);
    req.end();
  });

  if (response.statusCode !== 403) {
    throw new Error(`Expected disallowed Host header to return 403, got ${response.statusCode}: ${response.body}`);
  }

  const body = JSON.parse(response.body) as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32000 || body.error?.message !== "Invalid Host: evil.example") {
    throw new Error("Disallowed Host header did not return the expected JSON-RPC host validation error.");
  }
}

async function verifyMethodNotAllowed(endpoint: string, method: "GET" | "DELETE" | "OPTIONS" | "PUT", expectedMessage: string): Promise<void> {
  const response = await fetch(endpoint, { method });

  if (response.status !== 405) {
    const text = await response.text();
    throw new Error(`Expected ${method} MCP request to return 405, got ${response.status}: ${text}`);
  }

  const allow = response.headers.get("allow");
  if (allow !== "POST") {
    throw new Error(`Expected ${method} MCP request to advertise Allow: POST, got ${allow ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32000 || body.error?.message !== expectedMessage) {
    throw new Error(`${method} MCP request did not return the expected JSON-RPC method error.`);
  }
}

async function verifyHeadMethodNotAllowed(endpoint: string): Promise<void> {
  const response = await fetch(endpoint, { method: "HEAD" });

  if (response.status !== 405) {
    throw new Error(`Expected HEAD MCP request to return 405, got ${response.status}.`);
  }

  const allow = response.headers.get("allow");
  if (allow !== "POST") {
    throw new Error(`Expected HEAD MCP request to advertise Allow: POST, got ${allow ?? "missing"}.`);
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
    throw new Error(`Expected invalid JSON MCP request to return 400, got ${response.status}: ${text}`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32700 || body.error?.message !== "Invalid JSON request body.") {
    throw new Error("Invalid JSON MCP request did not return the expected JSON-RPC parse error.");
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
    throw new Error(`Expected unauthenticated invalid JSON MCP request to return 401 before parsing, got ${response.status}: ${text}`);
  }

  const authenticate = response.headers.get("www-authenticate");
  if (authenticate !== 'Bearer realm="lease-safe"') {
    throw new Error(`Expected unauthenticated invalid JSON MCP request to advertise WWW-Authenticate: Bearer, got ${authenticate ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { message?: unknown } };
  if (body.error?.message !== "Unauthorized") {
    throw new Error("Unauthenticated invalid JSON MCP request did not return the expected JSON-RPC auth error.");
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
      id: "unsupported-content-type-smoke",
      method: "tools/list"
    })
  });

  if (response.status !== 415) {
    const text = await response.text();
    throw new Error(`Expected unsupported content-type MCP request to return 415, got ${response.status}: ${text}`);
  }

  const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
  if (body.error?.code !== -32600 || body.error?.message !== "MCP POST requests must use application/json.") {
    throw new Error("Unsupported content-type MCP request did not return the expected JSON-RPC invalid request error.");
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

  const authenticate = response.headers.get("www-authenticate");
  if (authenticate !== 'Bearer realm="lease-safe"') {
    throw new Error(`Expected unauthenticated MCP request to advertise WWW-Authenticate: Bearer, got ${authenticate ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { message?: unknown } };
  if (body.error?.message !== "Unauthorized") {
    throw new Error("Unauthenticated MCP request did not return the expected JSON-RPC error.");
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
      id: "oversized-bearer-smoke",
      method: "tools/list"
    })
  });

  if (response.status !== 401) {
    const text = await response.text();
    throw new Error(`Expected oversized bearer MCP request to return 401, got ${response.status}: ${text}`);
  }

  const authenticate = response.headers.get("www-authenticate");
  if (authenticate !== 'Bearer realm="lease-safe"') {
    throw new Error(`Expected oversized bearer MCP request to advertise WWW-Authenticate: Bearer, got ${authenticate ?? "missing"}.`);
  }

  const body = await response.json() as { error?: { message?: unknown } };
  if (body.error?.message !== "Unauthorized") {
    throw new Error("Oversized bearer MCP request did not return the expected JSON-RPC auth error.");
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
  const port = smokePortFromEnv("MCP_HTTP_SMOKE_PORT") ?? await getFreePort();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const authToken = process.env.MCP_AUTH_TOKEN ?? "smoke-token-for-preflight";
  const env = {
    ...process.env,
    MCP_ALLOWED_HOSTS: process.env.MCP_ALLOWED_HOSTS ?? "127.0.0.1,localhost",
    MCP_AUTH_TOKEN: authToken,
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
    await verifyRejectedHost(endpoint);
    console.log("host_rejection=ok");
    await verifyHeadMethodNotAllowed(endpoint);
    await verifyMethodNotAllowed(endpoint, "GET", "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
    await verifyMethodNotAllowed(endpoint, "DELETE", "Method not allowed for stateless server.");
    await verifyMethodNotAllowed(endpoint, "OPTIONS", "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
    await verifyMethodNotAllowed(endpoint, "PUT", "Method not allowed. Use POST /mcp for Streamable HTTP requests.");
    console.log("method_rejection=ok");
    await verifyInvalidJsonRequest(endpoint, authToken);
    console.log("invalid_json_rejection=ok");
    await verifyUnauthorizedInvalidJsonRequest(endpoint);
    console.log("auth_before_parse=ok");
    await verifyUnsupportedContentTypeRequest(endpoint, authToken);
    console.log("content_type_rejection=ok");
    await verifyUnauthorizedRequest(endpoint);
    console.log("auth_rejection=ok");
    await verifyOversizedBearerTokenRejected(endpoint);
    console.log("oversized_bearer_rejection=ok");
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
