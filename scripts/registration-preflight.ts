import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/scripts/release-preflight.js"], {
  env: {
    ...process.env,
    REQUIRE_LIVE_PUBLIC_DATA: "1"
  },
  stdio: "inherit"
});

child.on("error", error => {
  console.error(error);
  process.exit(1);
});

child.on("close", code => {
  process.exit(code ?? 1);
});
