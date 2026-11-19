// Devin sign-in state for provider health.
//
// The SDK's generic ACP health only checks that the CLI runs, so a signed-out
// Devin reported "ready" and its threads failed. `devin auth status` is local
// and fast (about 0.3s), so health asks it directly.
import { execFile } from "node:child_process";
import type { ProviderHealth } from "@get-bb/plugin-sdk/provider-bridge";

export interface DevinAccount {
  signedIn: boolean;
  expired: boolean;
  email: string | null;
  plan: string | null;
}

const AUTH_STATUS_TIMEOUT_MS = 10_000;

/** Parses `devin auth status`; null when the output is not recognized. */
export function parseAuthStatus(output: string): DevinAccount | null {
  const first = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (first === undefined) return null;
  const field = (name: string) =>
    new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, "m").exec(output)?.[1] ?? null;
  if (/^not logged in\b/i.test(first) || /\bexpired\b/i.test(first)) {
    return {
      signedIn: false,
      expired: /\bexpired\b/i.test(first),
      email: null,
      plan: null,
    };
  }
  if (/^logged in\b/i.test(first)) {
    return {
      signedIn: true,
      expired: false,
      email: field("Email"),
      plan: field("Plan"),
    };
  }
  return null;
}

/** Runs `devin auth status`; null when it cannot run or says nothing usable. */
export function readDevinAccount(
  executable: string,
): Promise<DevinAccount | null> {
  return new Promise((resolve) => {
    execFile(
      executable,
      ["auth", "status"],
      { timeout: AUTH_STATUS_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (_error, stdout, stderr) => {
        // A signed-out CLI may exit non-zero; its output still says why.
        resolve(parseAuthStatus(`${stdout ?? ""}\n${stderr ?? ""}`.trim()));
      },
    );
  });
}

/** The command BB shows (or runs) to sign in, using the CLI it found. */
export function loginCommand(executable: string): string {
  const quoted = /^[\w./-]+$/.test(executable)
    ? executable
    : `'${executable.replaceAll("'", "'\\''")}'`;
  return `${quoted} auth login`;
}

/** Applies the account to a health result the ACP bridge called ready. */
export function withAccount(
  health: ProviderHealth,
  account: DevinAccount | null,
  login: string,
): ProviderHealth {
  if (health.status !== "ready" || account === null) return health;
  if (!account.signedIn) {
    return {
      ...health,
      status: account.expired ? "expired" : "unauthenticated",
      statusMessage: account.expired
        ? "Your Devin sign-in expired."
        : "Not signed in to Devin.",
      accountEmail: null,
      planLabel: null,
      loginCommand: login,
    };
  }
  return {
    ...health,
    accountEmail: account.email,
    planLabel: account.plan,
    loginCommand: login,
  };
}
