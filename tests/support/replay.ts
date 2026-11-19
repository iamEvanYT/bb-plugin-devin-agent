// Runs the built bridge (dist/host.js) as the runtime does, with the fake
// Devin replaying a fixture as its CLI, and returns the assembled bb events.
//
// The fake is found through BB_DEVIN_EXECUTABLE, so requests take the real
// path: CLI lookup, then the proxy in front of Devin, then Devin.
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { PROVIDER_BRIDGE_PROTOCOL_VERSION } from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_assembleCapturedThreadEvents,
  experimental_resolveProviderBridgeLaunch,
} from "@get-bb/plugin-sdk/provider-bridge/testing";

const root = fileURLToPath(new URL("../..", import.meta.url));
export const FAKE_DEVIN = fileURLToPath(
  new URL("./fake-devin.mjs", import.meta.url),
);
const TIMEOUT_MS = 20_000;

/** A fresh workspace for a replayed session (its real path, no symlinks). */
export function replayWorkspace(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "devin-replay-")));
}

export interface Replay {
  initialize: any;
  messages: any[];
  readonly events: any[];
  request(method: string, params: Record<string, unknown>): Promise<any>;
  waitFor(predicate: (events: any[]) => boolean, what: string): Promise<void>;
  close(): void;
}

export async function startReplay(
  fixture: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<Replay> {
  const launch = experimental_resolveProviderBridgeLaunch({
    modulePath: `${root}dist/host.js`,
    pluginId: "devin-agent",
    cwd,
  });
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...launch.env,
      BB_DEVIN_EXECUTABLE: FAKE_DEVIN,
      FAKE_DEVIN_FIXTURE: fixture,
      ...env,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const messages: any[] = [];
  const waiting = new Map<number, (message: any) => void>();
  createInterface({ input: child.stdout! }).on("line", (line) => {
    const message = JSON.parse(line);
    messages.push(message);
    if (message.id !== undefined && !message.method) {
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
  let id = 0;
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<any>((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out`)),
        TIMEOUT_MS,
      );
      waiting.set(n, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin!.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`,
      );
    });
  const events = () =>
    experimental_assembleCapturedThreadEvents(messages, "devin");

  try {
    const initialize = await request("initialize", {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      client: { name: "replay-test", version: "0" },
    });
    return {
      initialize,
      messages,
      get events() {
        return events();
      },
      request,
      async waitFor(predicate, what) {
        const deadline = Date.now() + TIMEOUT_MS;
        while (!predicate(events())) {
          if (Date.now() > deadline)
            throw new Error(`timed out waiting for ${what}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      },
      close: () => child.kill(),
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}

/** Execution options as the runtime sends them, with the server's launch spec. */
export function executionOptions() {
  return {
    model: "swe-2-flash-medium",
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: "ask",
    providerOptions: {
      acpLaunchSpec: {
        displayName: "Devin",
        command: "devin",
        args: ["acp"],
        env: {},
      },
      acpDialect: "devin",
    },
  };
}

/** Starts a thread and runs one turn of the fixture; resolves when it settles. */
export async function replayTurn(
  fixture: string,
  cwd: string,
  env: Record<string, string> = {},
) {
  const replay = await startReplay(fixture, cwd, env);
  try {
    const threadId = "thr_replay";
    const options = executionOptions();
    const started = await replay.request("thread/start", {
      threadId,
      cwd,
      options,
      instructionMode: "append",
    });
    if (started.error) throw new Error(JSON.stringify(started.error));
    const providerThreadId: string = started.result.providerThreadId;
    const turn = await replay.request("turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: "creq_testturn23",
      input: [{ type: "text", text: "replay" }],
      options,
    });
    if (turn.error) throw new Error(JSON.stringify(turn.error));
    await replay.waitFor(
      (events) => events.some((event) => event.type === "turn/completed"),
      "the turn to complete",
    );
    return { replay, providerThreadId, threadId };
  } catch (error) {
    replay.close();
    throw error;
  }
}
