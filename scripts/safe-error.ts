const SCRIPT_SECRET_ENV_NAMES = ["DATA_GO_KR_SERVICE_KEY", "MCP_AUTH_TOKEN"] as const;

function secretRedactionValues(): Array<{ envName: string; values: string[] }> {
  return SCRIPT_SECRET_ENV_NAMES.map(envName => {
    const rawValue = process.env[envName]?.trim();
    if (!rawValue || rawValue.length < 8) return { envName, values: [] };

    const values = new Set([rawValue]);
    try {
      const decodedValue = decodeURIComponent(rawValue);
      values.add(decodedValue);
      values.add(encodeURIComponent(decodedValue));
    } catch {
      // Malformed env values should still have their original form redacted.
    }
    values.add(encodeURIComponent(rawValue));
    return { envName, values: [...values].filter(value => value.length >= 8).sort((a, b) => b.length - a.length) };
  }).filter(entry => entry.values.length > 0);
}

function redactSecrets(value: string): string {
  let redacted = value;
  for (const { envName, values } of secretRedactionValues()) {
    for (const secretValue of values) {
      redacted = redacted.split(secretValue).join(`[${envName} redacted]`);
    }
  }
  return redacted;
}

export function compactScriptErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message).replace(/\s+/g, " ").slice(0, 500);
}
