const requiredEnvName = "DATA_GO_KR_SERVICE_KEY";

if (!process.env[requiredEnvName]?.trim()) {
  console.error(`${requiredEnvName} is required before running registration preflight.`);
  console.error("Set it as a GitHub repository secret and as a PlayMCP runtime environment variable before registration.");
  process.exit(1);
}
