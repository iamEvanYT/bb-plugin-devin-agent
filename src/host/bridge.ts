// The Devin provider bridge: the SDK's generic ACP bridge, wrapped.
//
// Inbound, each runtime request has its launch spec pointed at the Devin CLI
// this host found. Outbound, the bridge's replies pass through a filter that
// fills in what the generic bridge cannot know about Devin: account state in
// health, and the nesting of subagent rows the `devin` dialect tracks.
//
// Session requests launch Devin behind the stdio proxy in acp-proxy.ts, which
// is how `thread/name/set` reaches Devin; the generic bridge has no rename.
import {
  experimental_defineProviderBridge,
  THREAD_DELTA_NOTIFICATION_METHOD,
  type ProviderBridgeDefinition,
  type ProviderBridgeEntry,
  type ProviderHealth,
} from "@get-bb/plugin-sdk/provider-bridge";
import { DEVIN_COMMAND } from "../constants.ts";
import {
  loginCommand,
  readDevinAccount,
  withAccount,
  type DevinAccount,
} from "./account.ts";
import {
  resolveDevinExecutable,
  rewriteLaunchSpecs,
} from "./devin-executable.ts";
import {
  DEVIN_PROXY_ARG,
  PROXY_ELECTRON_ENV,
  ProxyControl,
  renameOffline,
} from "./acp-proxy.ts";
import type { SubagentNesting } from "./devin-dialect.ts";
import { installOutboundFilter, type WritableLike } from "./outbound.ts";

type JsonRpcId = string | number;
type Message = Record<string, unknown>;

export interface DevinBridgeOptions {
  acp: ProviderBridgeDefinition;
  stdout?: WritableLike;
  resolveExecutable?: () => string | null;
  readAccount?: (executable: string) => Promise<DevinAccount | null>;
  nesting?: SubagentNesting;
  /**
   * The built host entry, run in proxy mode in front of Devin. Without it
   * Devin is launched directly and rename is not offered.
   */
  proxyEntry?: string;
  /** Node (or Electron as Node) used to run the proxy. */
  nodePath?: string;
  control?: ProxyControl;
  renameOffline?: typeof renameOffline;
  log?: (message: string) => void;
}

const SESSION_METHODS = new Set([
  "thread/start",
  "thread/resume",
  "thread/fork",
]);
const RENAME_FAILED = -32603;

function isRecord(value: unknown): value is Message {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

export function createDevinBridge(
  options: DevinBridgeOptions,
): ProviderBridgeEntry {
  const {
    acp,
    stdout = process.stdout,
    resolveExecutable = resolveDevinExecutable,
    readAccount = readDevinAccount,
    nesting,
    proxyEntry,
    nodePath = process.execPath,
    control = proxyEntry === undefined ? undefined : new ProxyControl(),
    renameOffline: renameOfflineSession = renameOffline,
    log = (message) => process.stderr.write(`[devin] ${message}\n`),
  } = options;

  /** provider/health requests awaiting their reply, with the CLI they used. */
  const pendingHealth = new Map<JsonRpcId, string>();
  /** initialize requests, whose reply learns whether rename is offered. */
  const pendingInitialize = new Set<JsonRpcId>();
  /** thread/start and thread/fork requests, until their reply names the session. */
  const pendingSessions = new Map<JsonRpcId, Session>();
  /** What an offline rename needs, by Devin session id. */
  const sessions = new Map<string, Session>();
  let uninstall: (() => void) | undefined;
  /** Lines held until the proxy control port is listening. */
  let held: string[] | undefined;
  let renameOffered = false;

  interface Session {
    cwd: string;
    devin: string;
  }

  function write(message: unknown) {
    stdout.write(`${JSON.stringify(message)}\n`);
  }

  async function amendHealth(message: Message, executable: string) {
    const result = message.result;
    if (!isRecord(result) || !isRecord(result.health)) return message;
    const health = result.health as ProviderHealth;
    if (health.status !== "ready") return message;
    const account = await readAccount(executable);
    return {
      ...message,
      result: {
        ...result,
        health: withAccount(health, account, loginCommand(executable)),
      },
    };
  }

  /**
   * Puts a subagent's rows under its delegation row (`parentRef` is the
   * delegation's `childRef`) and drops Devin's subagent lifecycle updates,
   * which the bridge would otherwise show as empty tool rows.
   */
  function nestDeltas(message: Message) {
    const params = message.params;
    if (
      nesting === undefined ||
      !isRecord(params) ||
      !Array.isArray(params.deltas)
    )
      return message;
    let changed = false;
    const deltas: unknown[] = [];
    for (const delta of params.deltas) {
      const key =
        isRecord(delta) && isRecord(delta.key) ? delta.key : undefined;
      const id =
        typeof key?.providerItemId === "string"
          ? key.providerItemId
          : undefined;
      if (id === undefined) {
        deltas.push(delta);
        continue;
      }
      if (nesting.isLifecycle(id)) {
        changed = true;
        continue;
      }
      const parentRef = nesting.parentOf(id);
      if (parentRef !== undefined && key?.parentRef === undefined) {
        changed = true;
        deltas.push({ ...(delta as Message), key: { ...key, parentRef } });
        continue;
      }
      deltas.push(delta);
    }
    if (!changed) return message;
    if (deltas.length === 0) return null;
    return { ...message, params: { ...params, deltas } };
  }

  function outbound(message: unknown) {
    if (!isRecord(message)) return message;
    if (message.method === THREAD_DELTA_NOTIFICATION_METHOD) {
      return nestDeltas(message);
    }
    if (!isId(message.id) || "method" in message) return message;
    if (pendingInitialize.delete(message.id)) return amendInitialize(message);
    const session = pendingSessions.get(message.id);
    if (session !== undefined) {
      pendingSessions.delete(message.id);
      const result = isRecord(message.result) ? message.result : {};
      if (typeof result.providerThreadId === "string")
        sessions.set(result.providerThreadId, session);
      return message;
    }
    const executable = pendingHealth.get(message.id);
    if (executable === undefined) return message;
    pendingHealth.delete(message.id);
    return amendHealth(message, executable);
  }

  function amendInitialize(message: Message) {
    const result = message.result;
    if (!isRecord(result) || !isRecord(result.capabilities)) return message;
    return {
      ...message,
      result: {
        ...result,
        capabilities: { ...result.capabilities, threadRename: renameOffered },
      },
    };
  }

  /** Puts the proxy in front of Devin in a session request's launch specs. */
  function launchBehindProxy(message: Message, devin: string) {
    const env = control?.env();
    if (proxyEntry === undefined || env === undefined) return;
    const params = isRecord(message.params) ? message.params : {};
    const options = isRecord(params.options) ? params.options : {};
    const providerOptions = isRecord(options.providerOptions)
      ? options.providerOptions
      : {};
    const spec = providerOptions.acpLaunchSpec;
    if (!isRecord(spec) || spec.command !== devin) return;
    const electron = process.versions.electron !== undefined;
    spec.command = nodePath;
    spec.args = [
      proxyEntry,
      DEVIN_PROXY_ARG,
      devin,
      ...(Array.isArray(spec.args) ? spec.args : []),
    ];
    spec.env = {
      ...(isRecord(spec.env) ? spec.env : {}),
      ...env,
      // The bridge may run on Electron acting as Node (BB's desktop app). The
      // ACP bridge strips ELECTRON_RUN_AS_NODE from what the agent inherits,
      // so it must be set here, or the proxy would start the app itself. The
      // proxy removes it again before starting Devin.
      ...(electron
        ? { ELECTRON_RUN_AS_NODE: "1", [PROXY_ELECTRON_ENV]: "1" }
        : {}),
    };
  }

  function noteSession(message: Message, devin: string) {
    const params = isRecord(message.params) ? message.params : {};
    if (typeof params.cwd !== "string") return;
    const session = { cwd: params.cwd, devin };
    if (typeof params.providerThreadId === "string") {
      sessions.set(params.providerThreadId, session);
    } else if (isId(message.id)) {
      pendingSessions.set(message.id, session);
    }
  }

  async function rename(message: Message) {
    const params = isRecord(message.params) ? message.params : {};
    const sessionId = params.providerThreadId;
    const title = params.title;
    if (typeof sessionId !== "string" || typeof title !== "string") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32602,
          message: "thread/name/set needs providerThreadId and title",
        },
      });
      return;
    }
    try {
      if (control?.has(sessionId)) {
        await control.rename(sessionId, title);
      } else {
        const session = sessions.get(sessionId);
        if (session === undefined)
          throw new Error("Devin's session is not known to this bridge");
        await renameOfflineSession(
          session.devin,
          sessionId,
          session.cwd,
          title,
        );
      }
      write({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
    } catch (error) {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: RENAME_FAILED,
          message: `Could not rename the Devin session: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    }
  }

  /** Handles a runtime line; returns the line for the ACP bridge, or null. */
  function inbound(line: string): string | null {
    const interesting =
      line.includes('"acpLaunchSpec"') ||
      line.includes('"initialize"') ||
      line.includes('"thread/name/set"');
    if (!interesting) return line;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return line;
    }
    if (!isRecord(message)) return line;
    if (message.method === "initialize" && isId(message.id)) {
      pendingInitialize.add(message.id);
      return line;
    }
    if (message.method === "thread/name/set" && isId(message.id)) {
      if (!renameOffered) return line;
      void rename(message);
      return null;
    }
    const executable = rewriteLaunchSpecs(message, resolveExecutable);
    if (executable === null) return line;
    if (executable === DEVIN_COMMAND) return line;
    if (message.method === "provider/health" && isId(message.id)) {
      pendingHealth.set(message.id, executable);
    }
    if (
      typeof message.method === "string" &&
      SESSION_METHODS.has(message.method)
    ) {
      noteSession(message, executable);
    }
    // Every request that carries a launch spec gets the same one: the ACP
    // bridge restarts the agent when a turn's spec differs from the session's.
    launchBehindProxy(message, executable);
    return JSON.stringify(message);
  }

  function handle(line: string) {
    const forwarded = inbound(line);
    if (forwarded !== null) acp.handleLine(forwarded);
  }

  return experimental_defineProviderBridge({
    handleLine(line) {
      if (held !== undefined) held.push(line);
      else handle(line);
    },
    start(context) {
      uninstall ??= installOutboundFilter(stdout, outbound, (error) =>
        log(
          `outbound filter failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      acp.start?.(context);
      if (control === undefined) return;
      // Hold runtime lines until the control port is up, so initialize can
      // say whether rename works and sessions launch behind the proxy.
      held = [];
      control
        .listen()
        .then(
          () => {
            renameOffered = true;
          },
          (error) =>
            log(
              `rename is unavailable: ${error instanceof Error ? error.message : String(error)}`,
            ),
        )
        .finally(() => {
          const lines = held ?? [];
          held = undefined;
          for (const line of lines) handle(line);
        });
    },
    onClose() {
      control?.close();
      acp.onClose?.();
    },
    onSigterm() {
      acp.onSigterm?.();
    },
    onSigint() {
      acp.onSigint?.();
    },
  });
}
