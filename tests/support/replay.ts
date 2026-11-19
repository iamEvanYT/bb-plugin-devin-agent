// Runs the built bridge (dist/host.js) as the runtime does, against the fake
// Devin replaying a fixture, and returns the assembled bb thread events.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { PROVIDER_BRIDGE_PROTOCOL_VERSION } from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_assembleCapturedThreadEvents,
  experimental_resolveProviderBridgeLaunch,
} from "@get-bb/plugin-sdk/provider-bridge/testing";

const root = fileURLToPath(new URL("../..", import.meta.url));
const FAKE_DEVIN = fileURLToPath(new URL("./fake-devin.mjs", import.meta.url));

export interface Replay {
  events: any[];
  messages: any[];
  request(method: string, params: Record<string, unknown>): Promise<any>;
  close(): void;
}

export async function startReplay(cwd: string): Promise<Replay> {
  const launch = experimental_resolveProviderBridgeLaunch({
    modulePath: `${root}dist/host.js`,
    pluginId: "devin-agent",
    cwd,
  });
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
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
        20_000,
      );
      waiting.set(n, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin!.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`,
      );
    });

  await request("initialize", {
    protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
    client: { name: "replay-test", version: "0" },
  });

  return {
    messages,
    get events() {
      return experimental_assembleCapturedThreadEvents(messages, "devin");
    },
    request,
    close: () => child.kill(),
  };
}

/** Execution options as the runtime sends them, pointed at the fake Devin. */
export function executionOptions(
  fixture: string,
  extra: Record<string, unknown> = {},
) {
  return {
    model: "swe-2-flash-medium",
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: "ask",
    providerOptions: {
      acpLaunchSpec: {
        displayName: "Devin",
        command: process.execPath,
        args: [FAKE_DEVIN, fixture],
        env: {},
      },
      acpDialect: "devin",
      ...extra,
    },
  };
}

/** Starts a thread and runs one turn of the fixture; resolves when it settles. */
export async function replayTurn(fixture: string, cwd: string) {
  const replay = await startReplay(cwd);
  const threadId = "thr_replay";
  const options = executionOptions(fixture);
  const started = await replay.request("thread/start", {
    threadId,
    cwd,
    options,
    instructionMode: "append",
  });
  if (started.error) throw new Error(JSON.stringify(started.error));
  const providerThreadId = started.result.providerThreadId;
  const turn = await replay.request("turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_testturn23",
    input: [{ type: "text", text: "replay" }],
    options,
  });
  if (turn.error) throw new Error(JSON.stringify(turn.error));
  const deadline = Date.now() + 20_000;
  while (!replay.events.some((event) => event.type === "turn/completed")) {
    if (Date.now() > deadline) throw new Error("turn did not complete");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { replay, providerThreadId, threadId, options };
}
