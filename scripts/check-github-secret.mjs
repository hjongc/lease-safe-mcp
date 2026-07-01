import { spawnSync } from "node:child_process";

const requiredSecretName = "DATA_GO_KR_SERVICE_KEY";
const repo = process.env.GITHUB_REPOSITORY?.trim() || "hjongc/lease-safe-mcp";

function isValidRepositorySlug(value) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/.test(value);
}

function fail(message) {
  console.error(message);
  if (isValidRepositorySlug(repo)) {
    console.error(`Run: gh secret set ${requiredSecretName} --repo ${repo}`);
  } else {
    console.error("Set GITHUB_REPOSITORY to an owner/repo GitHub repository slug before checking repository secrets.");
  }
  process.exit(1);
}

if (!isValidRepositorySlug(repo)) {
  fail("GITHUB_REPOSITORY must be an owner/repo GitHub repository slug using GitHub-safe characters.");
}

const result = spawnSync("gh", ["secret", "list", "--repo", repo], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});

if (result.error) {
  fail(`Unable to run gh secret list for ${repo}: ${result.error.message}`);
}

if (result.status !== 0) {
  const stderr = result.stderr.trim();
  fail(`Unable to list GitHub repository secrets for ${repo}.${stderr ? ` gh said: ${stderr}` : ""}`);
}

const secretNames = result.stdout
  .split(/\r?\n/)
  .map(line => line.trim().split(/\s+/)[0])
  .filter(Boolean);

if (!secretNames.includes(requiredSecretName)) {
  fail(`${requiredSecretName} is not configured as a GitHub repository secret for ${repo}. A green CI run can still skip live public-data smoke without it.`);
}

console.log(`github_secret=${requiredSecretName} status=present repo=${repo}`);
