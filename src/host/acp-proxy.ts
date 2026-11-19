// A stdio proxy between the ACP bridge and `devin acp`, so the plugin can
// send Devin requests the SDK's bridge does not (rename).
//
// Devin only renames a session on the connection that has it open, and the
// SDK's ACP bridge keeps that connection to itself. So for session requests
// the bridge launches this file (the built host entry) in proxy mode instead
// of Devin. The proxy relays every ACP line unchanged, notes which sessions
// pass through, and connects back to the bridge on a loopback port guarded by
// a token. When the bridge asks, it writes its own request to Devin and keeps
// Devin's reply from reaching the SDK's bridge.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, connect, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";

export const DEVIN_PROXY_ARG = "--bb-devin-acp-proxy";
export const CONTROL_PORT_ENV = "BB_DEVIN_CONTROL_PORT";
export const CONTROL_TOKEN_ENV = "BB_DEVIN_CONTROL_TOKEN";
/** Set when the bridge added ELECTRON_RUN_AS_NODE only to run the proxy. */
export const PROXY_ELECTRON_ENV = "BB_DEVIN_PROXY_ELECTRON";
export const RENAME_METHOD = "_cognition.ai/session/rename";
const INJECTED_ID_PREFIX = "bb-devin-";
const LOOPBACK = "127.0.0.1";
const RENAME_TIMEOUT_MS = 10_000;
const MAX_CONTROL_LINE = 64 * 1024;

type Message = Record<string, unknown>;

function isRecord(value: unknown): value is Message {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(line: string): Message | undefined {
  try {
    const value = JSON.parse(line);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function errorText(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string")
    return error.message;
  return error instanceof Error ? error.message : String(error);
}

function lines(socket: Socket, onLine: (line: string) => void) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > MAX_CONTROL_LINE && !buffer.includes("\n")) {
      socket.destroy();
      return;
    }
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.length > 0) onLine(line);
    }
  });
}

/* ------------------------------------------------------------------------ */
/* Proxy process                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Tracks the sessions a connection opens and the requests the proxy itself
 * injects. Pure, so the relay logic is testable without processes.
 */
export class ProxyState {
  readonly sessions = new Set<string>();
  private readonly pendingSessionIds = new Set<string | number>();
  private readonly injected = new Map<
    string,
    (error: string | undefined) => void
  >();
  private nextId = 0;

  /** A line from the bridge to Devin. */
  noteClientLine(line: string): string | undefined {
    if (!line.includes('"session/')) return undefined;
    const message = parse(line);
    if (message === undefined || typeof message.method !== "string")
      return undefined;
    const params = isRecord(message.params) ? message.params : {};
    if (
      (message.method === "session/load" ||
        message.method === "session/resume") &&
      typeof params.sessionId === "string"
    ) {
      this.sessions.add(params.sessionId);
      return params.sessionId;
    }
    if (
      (message.method === "session/new" || message.method === "session/fork") &&
      (typeof message.id === "string" || typeof message.id === "number")
    ) {
      this.pendingSessionIds.add(message.id);
    }
    return undefined;
  }

  /**
   * A line from Devin. Returns whether to relay it, and any session it
   * opened.
   */
  noteAgentLine(line: string): { relay: boolean; session?: string } {
    if (line.includes(`"${INJECTED_ID_PREFIX}`)) {
      const message = parse(line);
      const id = message?.id;
      if (
        message !== undefined &&
        typeof id === "string" &&
        this.injected.has(id) &&
        message.method === undefined
      ) {
        const done = this.injected.get(id)!;
        this.injected.delete(id);
        done(
          message.error === undefined ? undefined : errorText(message.error),
        );
        return { relay: false };
      }
    }
    if (this.pendingSessionIds.size > 0 && line.includes('"sessionId"')) {
      const message = parse(line);
      const id = message?.id;
      if (
        (typeof id === "string" || typeof id === "number") &&
        this.pendingSessionIds.has(id)
      ) {
        this.pendingSessionIds.delete(id);
        const result = isRecord(message?.result) ? message.result : {};
        if (typeof result.sessionId === "string") {
          this.sessions.add(result.sessionId);
          return { relay: true, session: result.sessionId };
        }
      }
    }
    return { relay: true };
  }

  /** A request line to inject; `done` gets Devin's error, if any. */
  inject(
    method: string,
    params: Message,
    done: (error: string | undefined) => void,
  ): string {
    const id = `${INJECTED_ID_PREFIX}${++this.nextId}`;
    this.injected.set(id, done);
    return JSON.stringify({ jsonrpc: "2.0", id, method, params });
  }

  /** Fails every injected request still waiting, e.g. when Devin exits. */
  failPending(reason: string) {
    for (const done of this.injected.values()) done(reason);
    this.injected.clear();
  }
}

/** Runs the proxy: `node host.js --bb-devin-acp-proxy <devin> ...args`. */
export function runAcpProxy(argv: readonly string[]): void {
  const flag = argv.indexOf(DEVIN_PROXY_ARG);
  const [command, ...args] = argv.slice(flag + 1);
  if (command === undefined) {
    process.stderr.write("[devin proxy] missing Devin command\n");
    process.exit(2);
  }
  const port = Number(process.env[CONTROL_PORT_ENV]);
  const token = process.env[CONTROL_TOKEN_ENV];
  // Devin and every shell it runs inherit this environment: keep the control
  // token, and an ELECTRON_RUN_AS_NODE only the proxy needed, out of it.
  const env = { ...process.env };
  delete env[CONTROL_PORT_ENV];
  delete env[CONTROL_TOKEN_ENV];
  if (env[PROXY_ELECTRON_ENV] === "1") delete env.ELECTRON_RUN_AS_NODE;
  delete env[PROXY_ELECTRON_ENV];

  const state = new ProxyState();
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"],
    env,
    windowsHide: true,
  });
  let control: Socket | undefined;
  let connected = false;
  const report = (message: Message) => {
    if (connected && control !== undefined && !control.destroyed)
      control.write(`${JSON.stringify(message)}\n`);
  };

  const writeAgent = (line: string) => child.stdin?.write(`${line}\n`);
  createInterface({ input: process.stdin }).on("line", (line) => {
    const session = state.noteClientLine(line);
    writeAgent(line);
    if (session !== undefined) report({ type: "session", sessionId: session });
  });
  process.stdin.on("end", () => child.stdin?.end());

  createInterface({ input: child.stdout! }).on("line", (line) => {
    const { relay, session } = state.noteAgentLine(line);
    if (relay) process.stdout.write(`${line}\n`);
    if (session !== undefined) report({ type: "session", sessionId: session });
  });

  if (Number.isInteger(port) && port > 0 && token) {
    control = connect(port, LOOPBACK, () => {
      control!.write(`${JSON.stringify({ type: "hello", token })}\n`);
      connected = true;
      for (const sessionId of state.sessions)
        report({ type: "session", sessionId });
    });
    control.on("error", () => {});
    lines(control, (line) => {
      const message = parse(line);
      if (message?.type !== "rename") return;
      const { requestId, sessionId, title } = message;
      writeAgent(
        state.inject(RENAME_METHOD, { sessionId, title }, (error) =>
          report({ type: "renamed", requestId, ...(error ? { error } : {}) }),
        ),
      );
    });
  }

  const forward = (signal: NodeJS.Signals) => () => {
    child.kill(signal);
  };
  process.on("SIGTERM", forward("SIGTERM"));
  process.on("SIGINT", forward("SIGINT"));
  child.on("exit", (code, signal) => {
    state.failPending("Devin exited");
    control?.destroy();
    process.exitCode = code ?? (signal ? 1 : 0);
    process.stdout.end(() => process.exit());
  });
  child.on("error", (error) => {
    process.stderr.write(`[devin proxy] ${error.message}\n`);
    process.exit(1);
  });
}

/* ------------------------------------------------------------------------ */
/* Bridge side                                                              */
/* ------------------------------------------------------------------------ */

/** The bridge's end: proxies connect here and are reached by session id. */
export class ProxyControl {
  readonly token = randomBytes(24).toString("hex");
  private server: Server | undefined;
  private port: number | undefined;
  private readonly bySession = new Map<string, Socket>();
  private readonly pending = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private nextRequest = 0;

  /** Starts listening on a loopback port; resolves to the port. */
  async listen(): Promise<number> {
    if (this.port !== undefined) return this.port;
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, LOOPBACK, () => resolve());
    });
    server.unref();
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Devin proxy control server has no port");
    this.port = address.port;
    return this.port;
  }

  /** Environment a proxy needs to connect back; undefined before listen(). */
  env(): Record<string, string> | undefined {
    if (this.port === undefined) return undefined;
    return {
      [CONTROL_PORT_ENV]: String(this.port),
      [CONTROL_TOKEN_ENV]: this.token,
    };
  }

  has(sessionId: string): boolean {
    const socket = this.bySession.get(sessionId);
    return socket !== undefined && !socket.destroyed;
  }

  /** Renames a session through the proxy that has it open. */
  rename(sessionId: string, title: string): Promise<void> {
    const socket = this.bySession.get(sessionId);
    if (socket === undefined || socket.destroyed) {
      return Promise.reject(new Error("Devin is not running this session"));
    }
    const requestId = ++this.nextRequest;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Devin did not answer the rename"));
      }, RENAME_TIMEOUT_MS);
      timer.unref();
      this.pending.set(requestId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.write(
        `${JSON.stringify({ type: "rename", requestId, sessionId, title })}\n`,
      );
    });
  }

  close() {
    for (const socket of this.bySession.values()) socket.destroy();
    this.bySession.clear();
    this.server?.close();
  }

  private accept(socket: Socket) {
    let authorized = false;
    socket.on("error", () => {});
    socket.on("close", () => {
      for (const [sessionId, owner] of this.bySession) {
        if (owner === socket) this.bySession.delete(sessionId);
      }
    });
    lines(socket, (line) => {
      const message = parse(line);
      if (message === undefined) return;
      if (!authorized) {
        if (message.type === "hello" && message.token === this.token) {
          authorized = true;
        } else {
          socket.destroy();
        }
        return;
      }
      if (message.type === "session" && typeof message.sessionId === "string") {
        this.bySession.set(message.sessionId, socket);
      } else if (
        message.type === "renamed" &&
        typeof message.requestId === "number"
      ) {
        const waiter = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        if (typeof message.error === "string")
          waiter?.reject(new Error(message.error));
        else waiter?.resolve();
      }
    });
  }
}

/**
 * Renames a session no proxy has open: a one-off `devin acp` loads it and
 * renames it. Devin refuses while another process has the session open.
 */
export function renameOffline(
  devin: string,
  sessionId: string,
  cwd: string,
  title: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(devin, ["acp"], {
        cwd,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("Devin did not answer the rename")),
      RENAME_TIMEOUT_MS * 3,
    );
    const send = (id: number, method: string, params: Message) =>
      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    child.on("error", (error) => finish(error));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      const message = parse(line);
      if (message === undefined || message.method !== undefined) return;
      if (message.error !== undefined) {
        finish(new Error(errorText(message.error)));
        return;
      }
      if (message.id === 1) {
        send(2, "session/load", { sessionId, cwd, mcpServers: [] });
      } else if (message.id === 2) {
        send(3, RENAME_METHOD, { sessionId, title });
      } else if (message.id === 3) {
        finish();
      }
    });
    send(1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
  });
}
