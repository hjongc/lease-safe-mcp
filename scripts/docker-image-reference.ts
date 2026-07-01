const DOCKER_REPOSITORY_COMPONENT = "[a-z0-9]+(?:[._-][a-z0-9]+)*";
const DOCKER_IMAGE_REFERENCE_PATTERN = new RegExp(
  `^${DOCKER_REPOSITORY_COMPONENT}(?:/${DOCKER_REPOSITORY_COMPONENT})*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$`
);

export function dockerImageReferenceFromEnv(primaryEnvName: string, fallbackEnvName: string | undefined, defaultValue: string): string {
  const rawValue = process.env[primaryEnvName]?.trim() || (fallbackEnvName ? process.env[fallbackEnvName]?.trim() : undefined) || defaultValue;
  if (!DOCKER_IMAGE_REFERENCE_PATTERN.test(rawValue)) {
    const source = process.env[primaryEnvName]?.trim() ? primaryEnvName : fallbackEnvName && process.env[fallbackEnvName]?.trim() ? fallbackEnvName : "default";
    throw new Error(`${source} must be a plain Docker image reference such as lease-safe-mcp-preflight or lease-safe-mcp-preflight:local.`);
  }
  return rawValue;
}
