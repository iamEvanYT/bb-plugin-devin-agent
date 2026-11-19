// The Devin provider bridge: the SDK's generic ACP bridge, wrapped.
//
// Inbound, each runtime request has its launch spec pointed at the Devin CLI
// this host found. Outbound, the bridge's replies pass through a filter that
// fills in what the generic bridge cannot know about Devin.
import {
  experimental_defineProviderBridge,
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
import { installOutboundFilter, type WritableLike } from "./outbound.ts";

type JsonRpcId = string | number;
type Message = Record<string, unknown>;

export interface DevinBridgeOptions {
  acp: ProviderBridgeDefinition;
  stdout?: WritableLike;
  resolveExecutable?: () => string | null;
  readAccount?: (executable: string) => Promise<DevinAccount | null>;
  log?: (message: string) => void;
}

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
    log = (message) => process.stderr.write(`[devin] ${message}\n`),
  } = options;

  /** provider/health requests awaiting their reply, with the CLI they used. */
  const pendingHealth = new Map<JsonRpcId, string>();
  let uninstall: (() => void) | undefined;

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

  function outbound(message: unknown) {
    if (!isRecord(message) || !isId(message.id) || "method" in message) {
      return message;
    }
    const executable = pendingHealth.get(message.id);
    if (executable === undefined) return message;
    pendingHealth.delete(message.id);
    return amendHealth(message, executable);
  }

  function inbound(line: string): string {
    if (!line.includes('"acpLaunchSpec"')) return line;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return line;
    }
    const executable = rewriteLaunchSpecs(message, resolveExecutable);
    if (executable === null || !isRecord(message)) return line;
    if (
      message.method === "provider/health" &&
      isId(message.id) &&
      executable !== DEVIN_COMMAND
    ) {
      pendingHealth.set(message.id, executable);
    }
    return executable === DEVIN_COMMAND ? line : JSON.stringify(message);
  }

  return experimental_defineProviderBridge({
    handleLine(line) {
      acp.handleLine(inbound(line));
    },
    start(context) {
      uninstall ??= installOutboundFilter(stdout, outbound, (error) =>
        log(
          `outbound filter failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      acp.start?.(context);
    },
    onClose() {
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
