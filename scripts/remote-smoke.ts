import { spawn } from "node:child_process";
import { compactScriptErrorMessage } from "./safe-error.js";

const EXPECTED_ROOT_TEXT = "Lease Safe(전월세안전내비) MCP server is running. Use POST /mcp for Streamable HTTP.";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for remote PlayMCP smoke.`);
  }
  return value;
}

function remoteMcpEndpointFromEnv(): URL {
  const endpoint = new URL(requiredEnv("MCP_ENDPOINT"));
  if (endpoint.protocol !== "https:") {
    throw new Error("MCP_ENDPOINT must be an HTTPS PlayMCP endpoint for remote smoke.");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("MCP_ENDPOINT must not include userinfo, query strings, or fragments.");
  }
  if (!endpoint.pathname.endsWith("/mcp")) {
    throw new Error("MCP_ENDPOINT must point to the Streamable HTTP /mcp path.");
  }
  return endpoint;
}

function remoteAuthTokenFromEnv(): string {
  const authToken = requiredEnv("MCP_AUTH_TOKEN");
  if (/\s/.test(authToken) || authToken.length < 16) {
    throw new Error("MCP_AUTH_TOKEN must be a production bearer token without whitespace.");
  }
  return authToken;
}

function urlForPath(endpoint: URL, path: string): URL {
  const url = new URL(endpoint);
  url.pathname = endpoint.pathname.replace(/\/mcp$/, path);
  return url;
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
  if (response.headers.get("permissions-policy") !== "camera=(), microphone=(), geolocation=(), payment=(), usb=()") {
    throw new Error(`${label} response must set a restrictive Permissions-Policy.`);
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

async function verifyRemoteHealth(endpoint: URL): Promise<void> {
  const response = await fetch(urlForPath(endpoint, "/healthz"), {
    headers: {
      "x-request-id": "lease-safe-remote-health-1"
    }
  });
  assertSecurityHeaders(response, "remote healthz");
  if (!response.ok) {
    throw new Error(`Remote /healthz returned ${response.status}: ${await response.text()}`);
  }

  const body = await response.json() as {
    ok?: unknown;
    service?: unknown;
    version?: unknown;
    maxBodyBytes?: unknown;
    rateLimitPerMinute?: unknown;
    publicDataTimeoutMs?: unknown;
  };
  if (
    body.ok !== true ||
    body.service !== "lease-safe" ||
    typeof body.version !== "string" ||
    body.maxBodyBytes !== undefined ||
    body.rateLimitPerMinute !== undefined ||
    body.publicDataTimeoutMs !== undefined
  ) {
    throw new Error("Remote /healthz did not return the minimal expected liveness body.");
  }
  console.log("remote_healthz=ok");
}

async function verifyRemoteRoot(endpoint: URL): Promise<void> {
  const response = await fetch(urlForPath(endpoint, "/"));
  assertSecurityHeaders(response, "remote root");
  if (response.status !== 200) {
    throw new Error(`Remote root returned ${response.status}: ${await response.text()}`);
  }
  if (!response.headers.get("content-type")?.startsWith("text/plain")) {
    throw new Error("Remote root must return text/plain.");
  }
  const text = await response.text();
  if (text !== EXPECTED_ROOT_TEXT) {
    throw new Error("Remote root did not return the minimal MCP usage hint.");
  }
  if (/DATA_GO_KR_SERVICE_KEY|MCP_AUTH_TOKEN|MCP_ALLOWED_HOSTS|PUBLIC_DATA_TIMEOUT_MS/.test(text)) {
    throw new Error("Remote root must not expose runtime configuration names.");
  }
  console.log("remote_root_route=ok");
}

async function verifyRemoteAuthBoundary(endpoint: URL): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "lease-safe-remote-auth-1"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  assertSecurityHeaders(response, "remote auth rejection");
  if (response.status !== 401) {
    throw new Error(`Unauthenticated remote MCP request returned ${response.status}, not 401: ${await response.text()}`);
  }
  if (response.headers.get("www-authenticate") !== "Bearer") {
    throw new Error("Unauthenticated remote MCP request must advertise WWW-Authenticate: Bearer.");
  }
  const text = await response.text();
  if (!text.includes("-32001") || !text.includes("MCP authentication required.")) {
    throw new Error("Unauthenticated remote MCP request did not return the expected JSON-RPC auth error.");
  }
  console.log("remote_auth_rejection=ok");
}

function runMcpClientSmoke(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/scripts/smoke.js"], {
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Remote MCP client smoke failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function main(): Promise<void> {
  const endpoint = remoteMcpEndpointFromEnv();
  remoteAuthTokenFromEnv();
  await verifyRemoteHealth(endpoint);
  await verifyRemoteRoot(endpoint);
  await verifyRemoteAuthBoundary(endpoint);
  await runMcpClientSmoke();
  console.log("remote_smoke=ok");
}

main().catch(error => {
  console.error(compactScriptErrorMessage(error));
  process.exit(1);
});
