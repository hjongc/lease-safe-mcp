const requiredEnvName = "DATA_GO_KR_SERVICE_KEY";
const placeholders = new Set([
  "...",
  "your-data-go-kr-service-key",
  "replace-with-data-go-kr-service-key",
  "data-go-kr-service-key"
]);
const minKeyLength = 40;

function fail(message) {
  console.error(message);
  console.error("Set a real data.go.kr service key as a GitHub repository secret and as a PlayMCP runtime environment variable before registration.");
  process.exit(1);
}

const rawServiceKey = process.env[requiredEnvName]?.trim();

if (!rawServiceKey) {
  console.error(`${requiredEnvName} is required before running registration preflight.`);
  console.error("Set it as a GitHub repository secret and as a PlayMCP runtime environment variable before registration.");
  process.exit(1);
}

if (placeholders.has(rawServiceKey.toLowerCase())) {
  fail(`${requiredEnvName} must be a real data.go.kr service key, not a placeholder.`);
}

let serviceKey;
try {
  serviceKey = rawServiceKey.includes("%") ? decodeURIComponent(rawServiceKey) : rawServiceKey;
} catch {
  fail(`${requiredEnvName} must be a valid percent-encoded or decoded data.go.kr service key.`);
}

if (placeholders.has(serviceKey.toLowerCase())) {
  fail(`${requiredEnvName} must be a real data.go.kr service key, not a placeholder.`);
}

if (serviceKey.length < minKeyLength || !/^[A-Za-z0-9+/]+={0,2}$/.test(serviceKey)) {
  fail(`${requiredEnvName} must look like a real data.go.kr service key.`);
}
