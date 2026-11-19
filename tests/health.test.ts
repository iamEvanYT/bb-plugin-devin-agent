import assert from "node:assert/strict";
import { test } from "node:test";
import { createDevinBridge } from "../src/host/bridge.ts";
import { loginCommand, parseAuthStatus } from "../src/host/account.ts";
import { fakeAcp, fakeStdout, startContext, tick } from "./support.ts";

const SIGNED_IN = `Logged in (via Devin).

Credentials:
  File:              /home/me/.local/share/devin/credentials.toml

User:
  Name:              Me
  Email:             me@example.com

Account:
  Tier:              Devin Max
  Plan:              Max
`;
const SIGNED_OUT = `Not logged in.
  Credentials path: /home/me/.local/share/devin/credentials.toml
Run \`devin auth login\` to authenticate.`;

test("parses devin auth status", () => {
  assert.deepEqual(parseAuthStatus(SIGNED_IN), {
    signedIn: true,
    expired: false,
    email: "me@example.com",
    plan: "Max",
  });
  assert.deepEqual(parseAuthStatus(SIGNED_OUT), {
    signedIn: false,
    expired: false,
    email: null,
    plan: null,
  });
  assert.equal(parseAuthStatus(""), null);
  assert.equal(parseAuthStatus("something else"), null);
});

test("quotes the login command only when needed", () => {
  assert.equal(loginCommand("/usr/bin/devin"), "/usr/bin/devin auth login");
  assert.equal(loginCommand("/My Apps/devin"), "'/My Apps/devin' auth login");
});

const spec = { displayName: "Devin", command: "devin", args: ["acp"], env: {} };
const ready = {
  status: "ready",
  statusMessage: null,
  accountEmail: null,
  planLabel: null,
  installedVersion: "3000.14.30825",
  minimumSupportedVersion: null,
  canInstall: false,
  canUpdate: false,
  loginCommand: null,
};

async function health(authOutput: string | null, status = "ready") {
  const out = fakeStdout();
  const { acp } = fakeAcp(out, (message) =>
    message.method === "provider/health"
      ? [
          {
            jsonrpc: "2.0",
            id: message.id,
            result: { supported: true, health: { ...ready, status } },
          },
        ]
      : [],
  );
  const asked: string[] = [];
  const bridge = createDevinBridge({
    acp,
    stdout: out,
    resolveExecutable: () => "/opt/devin/bin/devin",
    readAccount: async (executable) => {
      asked.push(executable);
      return authOutput === null ? null : parseAuthStatus(authOutput);
    },
  });
  bridge.start?.(startContext);
  bridge.handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "provider/health",
      params: { providerId: "devin", providerOptions: { acpLaunchSpec: spec } },
    }),
  );
  await tick();
  return { health: out.messages()[0].result.health, asked };
}

test("a signed-out CLI is unauthenticated, with a login command that works", async () => {
  const { health: result, asked } = await health(SIGNED_OUT);
  assert.deepEqual(asked, ["/opt/devin/bin/devin"]);
  assert.equal(result.status, "unauthenticated");
  assert.equal(result.statusMessage, "Not signed in to Devin.");
  assert.equal(result.loginCommand, "/opt/devin/bin/devin auth login");
  assert.equal(result.installedVersion, "3000.14.30825");
});

test("a signed-in CLI stays ready and reports the account", async () => {
  const { health: result } = await health(SIGNED_IN);
  assert.equal(result.status, "ready");
  assert.equal(result.accountEmail, "me@example.com");
  assert.equal(result.planLabel, "Max");
});

test("health is unchanged when the account cannot be read or the CLI is missing", async () => {
  assert.equal((await health(null)).health.status, "ready");
  const missing = await health(SIGNED_OUT, "not_installed");
  assert.equal(missing.health.status, "not_installed");
  assert.deepEqual(missing.asked, []);
});
