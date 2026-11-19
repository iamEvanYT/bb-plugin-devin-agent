// The `devin` ACP dialect: reads what Devin reports beside the protocol.
//
// Devin names every tool in `_meta["cognition.ai/inferenceToolName"]`, reports
// shell exit codes in `_meta.terminal_exit`, and runs subagents (`run_subagent`) whose tool calls
// carry `_meta["cognition.ai/subagent_context"].parentAgentId`. The SDK merges
// a tool call's updates without their `_meta`, so the dialect remembers what
// it needs per call as updates go by.
//
// Nesting a subagent's rows under its delegation row needs the item keys the
// bridge emits, so `nesting` is read by the outbound filter in bridge.ts.
import type {
  AcpClassifiedToolCall,
  AcpDialect,
  AcpToolCallUpdateEvent,
} from "@get-bb/plugin-sdk/provider-bridge/acp";
import {
  experimental_presentationTitle,
  experimental_searchPresentation,
  experimental_withTitle,
} from "@get-bb/plugin-sdk/provider-bridge";

export const DEVIN_DIALECT_ID = "devin";

const META_TOOL_NAME = "cognition.ai/inferenceToolName";
const META_SUBAGENT_CONTEXT = "cognition.ai/subagent_context";
const META_SUBAGENT_STARTED = "cognition.ai/subagent_started";
const META_SUBAGENT_COMPLETED = "cognition.ai/subagent_completed";
const META_TERMINAL_EXIT = "terminal_exit";
const ROOT_AGENT = "root";
const RUN_SUBAGENT = "run_subagent";
const FIND_FILE_BY_NAME = "find_file_by_name";
/** Per-call memory is bounded; the oldest entries go first. */
const MAX_TRACKED = 2_000;

type Record_ = Record<string, unknown>;

function isRecord(value: unknown): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function meta(event: AcpToolCallUpdateEvent): Record_ {
  const value = (event as Record_)._meta;
  return isRecord(value) ? value : {};
}

class BoundedMap<K, V> extends Map<K, V> {
  override set(key: K, value: V) {
    if (!this.has(key) && this.size >= MAX_TRACKED) {
      const oldest = this.keys().next();
      if (!oldest.done) this.delete(oldest.value);
    }
    return super.set(key, value);
  }
}

/** Text content of a tool call, ignoring Devin's shell-command preview. */
function textContent(event: AcpToolCallUpdateEvent): string | undefined {
  const parts: string[] = [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "content" || !isRecord(entry.content)) continue;
    if (entry.content.type === "text" && typeof entry.content.text === "string")
      parts.push(entry.content.text);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

export interface SubagentNesting {
  /** The delegation row a subagent's tool call belongs under. */
  parentOf(toolCallId: string): string | undefined;
  /** Devin's subagent lifecycle updates, which are not tool calls. */
  isLifecycle(toolCallId: string): boolean;
}

export function createDevinDialect(): {
  dialect: AcpDialect;
  nesting: SubagentNesting;
} {
  const toolNames = new BoundedMap<string, string>();
  const exitCodes = new BoundedMap<string, number>();
  const outputs = new BoundedMap<string, string>();
  /** run_subagent calls by toolCallId, with the title Devin gave the task. */
  const runCalls = new BoundedMap<string, string | undefined>();
  /** Subagent id to the run_subagent call that started it. */
  const agentCalls = new BoundedMap<string, string>();
  /** Tool call to the run_subagent call it ran under. */
  const parents = new BoundedMap<string, string>();

  function noteSubagentStarted(agentId: string, started: Record_) {
    if (agentCalls.has(agentId)) return;
    const title = str(started.title);
    const linked = new Set(agentCalls.values());
    const open = [...runCalls.entries()].filter(([id]) => !linked.has(id));
    const match =
      open.findLast(
        ([, runTitle]) => title !== undefined && runTitle === title,
      ) ?? open.at(-1);
    if (match !== undefined) agentCalls.set(agentId, match[0]);
  }

  function observe(event: AcpToolCallUpdateEvent) {
    const id = event.toolCallId;
    const m = meta(event);
    const name = str(m[META_TOOL_NAME]);
    if (name !== undefined) toolNames.set(id, name);

    const started = m[META_SUBAGENT_STARTED];
    if (isRecord(started))
      noteSubagentStarted(str(started.agentId) ?? id, started);
    const completed = m[META_SUBAGENT_COMPLETED];
    if (isRecord(completed) && !agentCalls.has(id)) {
      // A completion without a start still marks the id as lifecycle noise.
      agentCalls.set(id, "");
    }

    if (name === RUN_SUBAGENT && !runCalls.has(id)) {
      const input = isRecord(event.rawInput) ? event.rawInput : {};
      runCalls.set(id, str(input.title));
    }
    const context = m[META_SUBAGENT_CONTEXT];
    if (isRecord(context) && !parents.has(id)) {
      const agent = str(context.parentAgentId);
      const parent = agent === undefined ? undefined : agentCalls.get(agent);
      if (agent !== ROOT_AGENT && parent) parents.set(id, parent);
    }

    const exit = m[META_TERMINAL_EXIT];
    if (isRecord(exit) && typeof exit.exit_code === "number") {
      exitCodes.set(id, exit.exit_code);
    }
    if (toolNames.get(id) === "exec") {
      const text = textContent(event);
      if (text !== undefined) outputs.set(id, text);
    }
  }

  function classifySubagent(
    event: AcpToolCallUpdateEvent,
  ): AcpClassifiedToolCall {
    const input = isRecord(event.rawInput) ? event.rawInput : {};
    const label = str(input.title) ?? str(event.title) ?? "Subagent";
    const profile = str(input.profile)?.replace(/^subagent_/, "");
    const summary =
      event.status === "completed" || event.status === "failed"
        ? textContent(event)
        : undefined;
    const presentation = experimental_withTitle(
      {
        label: { pending: "Running subagent", completed: "Subagent finished" },
        icon: { glyph: "UserRound" },
      },
      experimental_presentationTitle(label),
    );
    return {
      item: {
        type: "delegation",
        childRef: event.toolCallId,
        label,
        background: input.is_background === true,
        ...(summary === undefined ? {} : { summary }),
      },
      presentation:
        profile === undefined
          ? presentation
          : { ...presentation, detail: profile },
    };
  }

  function classifyFileSearch(
    event: AcpToolCallUpdateEvent,
  ): AcpClassifiedToolCall | undefined {
    const input = isRecord(event.rawInput) ? event.rawInput : {};
    const query = str(input.query) ?? str(input.pattern);
    if (query === undefined) return undefined;
    const path = str(input.path);
    return {
      item: {
        type: "search",
        mode: "path",
        query,
        ...(path === undefined ? {} : { path }),
      },
      presentation: experimental_searchPresentation({ mode: "path", query }),
    };
  }

  const dialect: AcpDialect = {
    id: DEVIN_DIALECT_ID,
    toolIdentity(event) {
      observe(event);
      const name = toolNames.get(event.toolCallId);
      return name === undefined ? undefined : { name };
    },
    classifyToolCall(event) {
      switch (toolNames.get(event.toolCallId)) {
        case RUN_SUBAGENT:
          return classifySubagent(event);
        case FIND_FILE_BY_NAME:
          return classifyFileSearch(event);
        default:
          return undefined;
      }
    },
    commandResult(event) {
      const id = event.toolCallId;
      const exitCode = exitCodes.get(id);
      const output = outputs.get(id) ?? textContent(event);
      exitCodes.delete(id);
      outputs.delete(id);
      return {
        ...(exitCode === undefined ? {} : { exitCode }),
        ...(output === undefined ? {} : { output }),
      };
    },
  };

  const nesting: SubagentNesting = {
    parentOf: (toolCallId) => parents.get(toolCallId),
    isLifecycle: (toolCallId) => agentCalls.has(toolCallId),
  };

  return { dialect, nesting };
}
