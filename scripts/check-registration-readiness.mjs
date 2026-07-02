import { spawnSync } from "node:child_process";

const requiredSecretName = "DATA_GO_KR_SERVICE_KEY";
const repo = process.env.GITHUB_REPOSITORY?.trim() || "hjongc/lease-safe-mcp";
const branch = process.env.REGISTRATION_READY_BRANCH?.trim() || "main";

function isValidRepositorySlug(value) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/.test(value);
}

function isValidBranchName(value) {
  return (
    /^[A-Za-z0-9._/-]{1,100}$/.test(value) &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("//") &&
    !value.includes("..") &&
    !value.includes("@{")
  );
}

function fail(message) {
  console.error(message);
  if (isValidRepositorySlug(repo) && isValidBranchName(branch)) {
    console.error(`Run: gh workflow run CI --repo ${repo} --ref ${branch}`);
    console.error(`Run: gh workflow run "Registration Preflight" --repo ${repo} --ref ${branch}`);
  } else {
    console.error("Set GITHUB_REPOSITORY and REGISTRATION_READY_BRANCH to safe GitHub values before checking registration readiness.");
  }
  process.exit(1);
}

if (!isValidRepositorySlug(repo)) {
  fail("GITHUB_REPOSITORY must be an owner/repo GitHub repository slug using GitHub-safe characters.");
}

if (!isValidBranchName(branch)) {
  fail("REGISTRATION_READY_BRANCH must be a plain GitHub branch name without whitespace, control characters, traversal, or ref expressions.");
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    fail(`Unable to run ${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    fail(`Unable to ${label}.${stderr ? ` Command said: ${stderr}` : ""}`);
  }
  return result.stdout.trim();
}

function ghJson(args, label) {
  const output = run("gh", args, label);
  try {
    return JSON.parse(output);
  } catch {
    fail(`Unable to parse JSON from ${label}.`);
  }
}

function requireCleanWorktree() {
  const status = run("git", ["status", "--porcelain"], "inspect git worktree status");
  if (status !== "") {
    fail("Worktree must be clean before registration readiness can be trusted.");
  }
}

function requireGitHubSecret() {
  const secretNames = run("gh", ["secret", "list", "--repo", repo], `list GitHub repository secrets for ${repo}`)
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/)[0])
    .filter(Boolean);

  if (!secretNames.includes(requiredSecretName)) {
    fail(`${requiredSecretName} is not configured as a GitHub repository secret for ${repo}. Registration readiness requires live public-data evidence, not skipped smoke.`);
  }
}

function requireSuccessfulWorkflowRun(workflowName, headSha) {
  const runs = ghJson([
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    workflowName,
    "--branch",
    branch,
    "--json",
    "databaseId,conclusion,status,headSha,url",
    "--limit",
    "20"
  ], `list ${workflowName} workflow runs for ${repo}@${branch}`);

  if (!Array.isArray(runs)) {
    fail(`GitHub returned an unexpected ${workflowName} run list shape.`);
  }

  const matchingRun = runs.find(run => run.headSha === headSha);
  if (!matchingRun) {
    fail(`No ${workflowName} workflow run was found for current commit ${headSha} on ${branch}.`);
  }
  if (matchingRun.status !== "completed") {
    fail(`${workflowName} workflow run for current commit ${headSha} is ${matchingRun.status}, not completed: ${matchingRun.url}`);
  }
  if (matchingRun.conclusion !== "success") {
    fail(`${workflowName} workflow run for current commit ${headSha} concluded ${matchingRun.conclusion}, not success: ${matchingRun.url}`);
  }
  return matchingRun;
}

function requireSuccessfulStep(run, workflowName, stepName) {
  const details = ghJson([
    "run",
    "view",
    String(run.databaseId),
    "--repo",
    repo,
    "--json",
    "jobs"
  ], `inspect ${workflowName} workflow job steps for ${repo}@${branch}`);

  if (!Array.isArray(details.jobs)) {
    fail(`GitHub returned an unexpected ${workflowName} job list shape.`);
  }

  const matchingStep = details.jobs
    .flatMap(job => Array.isArray(job.steps) ? job.steps : [])
    .find(step => step.name === stepName);

  if (!matchingStep) {
    fail(`${workflowName} workflow run ${run.url} did not include required step: ${stepName}.`);
  }
  if (matchingStep.conclusion !== "success") {
    fail(`${workflowName} workflow required step "${stepName}" concluded ${matchingStep.conclusion}, not success: ${run.url}`);
  }
}

requireCleanWorktree();
const headSha = run("git", ["rev-parse", "HEAD"], "read current git commit").trim();
requireGitHubSecret();
const ciRun = requireSuccessfulWorkflowRun("CI", headSha);
const registrationRun = requireSuccessfulWorkflowRun("Registration Preflight", headSha);
requireSuccessfulStep(ciRun, "CI", "Live public-data smoke");
requireSuccessfulStep(registrationRun, "Registration Preflight", "Run registration preflight");
requireSuccessfulStep(registrationRun, "Registration Preflight", "Publish registration evidence summary");

console.log(`registration_readiness=ok repo=${repo} branch=${branch} head_sha=${headSha}`);
console.log(`github_secret=${requiredSecretName} status=present repo=${repo}`);
console.log(`ci_run=${ciRun.url}`);
console.log(`registration_preflight_run=${registrationRun.url}`);
