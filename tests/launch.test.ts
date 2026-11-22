import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readDevinAccount } from "../src/host/account.ts";
import { DEVIN_PROXY_ARG, renameOffline } from "../src/host/acp-proxy.ts";

test("launches a CLI script for ACP, account health, and offline rename", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "devin launch & "));
  const fixture = fileURLToPath(
    new URL("./fixtures/devin-subagent.json", import.meta.url),
  );
  const recorded = JSON.parse(readFileSync(fixture, "utf8"));
  const script = join(dir, "fake.mjs");
  const windows = process.platform === "win32";
  const command = join(dir, windows ? "devin.cmd" : "devin");
  const previousFixture = process.env.FAKE_DEVIN_FIXTURE;
  t.after(() => {
    if (previousFixture === undefined) delete process.env.FAKE_DEVIN_FIXTURE;
    else process.env.FAKE_DEVIN_FIXTURE = previousFixture;
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.FAKE_DEVIN_FIXTURE = fixture;
  writeFileSync(
    script,
    `if (process.argv[2] === "auth") {
      console.log("Logged in.\\nEmail: windows@example.com\\nPlan: Max");
    } else {
      await import(${JSON.stringify(new URL("./support/fake-devin.mjs", import.meta.url).href)});
    }`,
  );
  writeFileSync(
    command,
    windows
      ? `@"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
    { mode: 0o755 },
  );

  // Exercise the built proxy, including its inherited stdio and exit status.
  const proxy = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../dist/host.js", import.meta.url)),
      DEVIN_PROXY_ARG,
      command,
      "acp",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  t.after(() => proxy.kill());
  let stdout = "";
  let stderr = "";
  proxy.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  proxy.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const closed = once(proxy, "close");
  proxy.stdin.end(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`,
  );
  const [code] = await closed;
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout).result, recorded.initialize);

  assert.deepEqual(await readDevinAccount(command), {
    signedIn: true,
    expired: false,
    email: "windows@example.com",
    plan: "Max",
  });
  await renameOffline(command, recorded.sessionNew.sessionId, dir, "New title");
});
