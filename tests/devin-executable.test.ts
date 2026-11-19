import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveDevinExecutable,
  rewriteLaunchCommand,
} from "../src/host/devin-executable.ts";
import { DEVIN_APP_EXECUTABLE } from "../src/constants.ts";

const only =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

test("prefers BB_DEVIN_EXECUTABLE over PATH and the app bundle", () => {
  const resolved = resolveDevinExecutable({
    env: { BB_DEVIN_EXECUTABLE: "/opt/devin", PATH: "/usr/local/bin" },
    platform: "darwin",
    isExecutable: only(
      "/opt/devin",
      "/usr/local/bin/devin",
      DEVIN_APP_EXECUTABLE,
    ),
  });
  assert.equal(resolved, "/opt/devin");
});

test("ignores a relative or missing override", () => {
  for (const override of ["devin", "/missing/devin"]) {
    const resolved = resolveDevinExecutable({
      env: { BB_DEVIN_EXECUTABLE: override, PATH: "/usr/local/bin" },
      platform: "darwin",
      isExecutable: only("/usr/local/bin/devin"),
    });
    assert.equal(resolved, "/usr/local/bin/devin");
  }
});

test("falls back to Devin.app on macOS when PATH has no devin", () => {
  const resolved = resolveDevinExecutable({
    env: { PATH: "/usr/bin:/bin" },
    platform: "darwin",
    isExecutable: only(DEVIN_APP_EXECUTABLE),
  });
  assert.equal(resolved, DEVIN_APP_EXECUTABLE);
});

test("returns null when no CLI exists", () => {
  const resolved = resolveDevinExecutable({
    env: { PATH: "/usr/bin" },
    platform: "linux",
    isExecutable: () => false,
  });
  assert.equal(resolved, null);
});

const spec = { displayName: "Devin", command: "devin", args: ["acp"], env: {} };

test("rewrites the launch command in session requests", () => {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "thread/start",
    params: {
      cwd: "/w",
      options: { providerOptions: { acpLaunchSpec: spec } },
    },
  });
  const out = JSON.parse(rewriteLaunchCommand(line, () => "/bin/devin"));
  assert.equal(
    out.params.options.providerOptions.acpLaunchSpec.command,
    "/bin/devin",
  );
  assert.deepEqual(out.params.options.providerOptions.acpLaunchSpec.args, [
    "acp",
  ]);
});

test("rewrites the launch command in maintenance requests", () => {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "provider/health",
    params: { providerId: "devin", providerOptions: { acpLaunchSpec: spec } },
  });
  const out = JSON.parse(rewriteLaunchCommand(line, () => "/bin/devin"));
  assert.equal(out.params.providerOptions.acpLaunchSpec.command, "/bin/devin");
});

test("leaves lines unchanged when nothing applies", () => {
  const other = JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "initialize",
    params: {},
  });
  assert.equal(
    rewriteLaunchCommand(other, () => "/bin/devin"),
    other,
  );

  const notFound = JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "provider/health",
    params: { providerOptions: { acpLaunchSpec: spec } },
  });
  assert.equal(
    rewriteLaunchCommand(notFound, () => null),
    notFound,
  );

  const customCommand = JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "provider/health",
    params: {
      providerOptions: { acpLaunchSpec: { ...spec, command: "/x/devin" } },
    },
  });
  assert.equal(
    rewriteLaunchCommand(customCommand, () => "/bin/devin"),
    customCommand,
  );

  assert.equal(
    rewriteLaunchCommand('{"acpLaunchSpec": nope', () => "/bin/devin"),
    '{"acpLaunchSpec": nope',
  );
});
