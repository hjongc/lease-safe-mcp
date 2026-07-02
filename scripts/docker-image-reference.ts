const DOCKER_REPOSITORY_COMPONENT = "[a-z0-9]+(?:[._-][a-z0-9]+)*";
const DOCKER_IMAGE_REFERENCE_PATTERN = new RegExp(
  `^${DOCKER_REPOSITORY_COMPONENT}(?:/${DOCKER_REPOSITORY_COMPONENT})*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$`
);

export function dockerImageReferenceFromEnv(primaryEnvName: string, fallbackEnvName: string | undefined, defaultValue: string): string {
  const primaryValue = dockerImageReferenceEnvValue(primaryEnvName);
  const fallbackValue = primaryValue === undefined && fallbackEnvName ? dockerImageReferenceEnvValue(fallbackEnvName) : undefined;
  const rawValue = primaryValue ?? fallbackValue ?? defaultValue;
  if (!DOCKER_IMAGE_REFERENCE_PATTERN.test(rawValue)) {
    const source = primaryValue !== undefined ? primaryEnvName : fallbackValue !== undefined ? fallbackEnvName : "default";
    throw new Error(`${source} must be a plain Docker image reference such as lease-safe-mcp-preflight or lease-safe-mcp-preflight:local.`);
  }
  return rawValue;
}

function dockerImageReferenceEnvValue(envName: string): string | undefined {
  const rawValue = process.env[envName];
  if (rawValue === undefined) return undefined;

  const value = rawValue.trim();
  if (value.length === 0) {
    throw new Error(`${envName} must be a plain Docker image reference such as lease-safe-mcp-preflight or lease-safe-mcp-preflight:local.`);
  }
  return value;
}
