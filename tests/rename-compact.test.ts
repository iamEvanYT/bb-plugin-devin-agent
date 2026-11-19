import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ProxyState,
  RENAME_METHOD,
  renameOffline,
} from "../src/host/acp-proxy.ts";
import { FAKE_DEVIN, executionOptions, replayTurn } from "./support/replay.ts";

const FIXTURE = fileURLToPath(
  new URL("./fixtures/devin-subagent.json", import.meta.url),
);
const SESSION_ID = JSON.parse(readFileSync(FIXTURE, "utf8")).sessionNew
  .sessionId as string;
const CWD = "/private/tmp/devin-rec/ws";

function fakeLog() {
  const path = join(mkdtempSync(join(tmpdir(), "devin-fake-")), "log.ndjson");
  return {
    path,
    entries: () =>
      existsSync(path)
        ? readFileSync(path, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [],
  };
}

test("initialize offers rename", async () => {
  const { replay } = await replayTurn(FIXTURE, CWD);
  try {
    assert.equal(replay.initialize.result.capabilities.threadRename, true);
  } finally {
    replay.close();
  }
});

test("rename reaches the running Devin session and updates the title", async () => {
  const log = fakeLog();
  const { replay, providerThreadId, threadId } = await replayTurn(
    FIXTURE,
    CWD,
    {
      FAKE_DEVIN_LOG: log.path,
    },
  );
  try {
    const reply = await replay.request("thread/name/set", {
      threadId,
      providerThreadId,
      title: "Renamed from bb",
    });
    assert.deepEqual(reply.result, { ok: true });
    await replay.waitFor(
      (events) =>
        events.some(
          (event) =>
            event.type === "thread/name/updated" &&
            JSON.stringify(event).includes("Renamed from bb"),
        ),
      "the new title",
    );
    const renames = log
      .entries()
      .filter((entry) => entry.message.method === RENAME_METHOD);
    assert.equal(renames.length, 1);
    assert.deepEqual(renames[0].message.params, {
      sessionId: providerThreadId,
      title: "Renamed from bb",
    });
    // The proxy's control channel stays out of Devin's environment.
    for (const entry of log.entries()) {
      assert.deepEqual(entry.env, { controlToken: false, controlPort: false });
    }
  } finally {
    replay.close();
  }
});

test("rename of an unknown session fails with a message", async () => {
  const { replay, threadId } = await replayTurn(FIXTURE, CWD);
  try {
    const reply = await replay.request("thread/name/set", {
      threadId,
      providerThreadId: "no-such-session",
      title: "x",
    });
    assert.match(reply.error.message, /Could not rename the Devin session/);
  } finally {
    replay.close();
  }
});

test("an offline rename loads the session in a one-off Devin", async () => {
  const log = fakeLog();
  process.env.FAKE_DEVIN_FIXTURE = FIXTURE;
  process.env.FAKE_DEVIN_LOG = log.path;
  try {
    await renameOffline(FAKE_DEVIN, SESSION_ID, CWD, "Offline title");
    assert.deepEqual(
      log.entries().map((entry) => entry.message.method),
      ["initialize", "session/load", RENAME_METHOD],
    );
    await assert.rejects(
      renameOffline(FAKE_DEVIN, "missing", CWD, "x"),
      /Session not found/,
    );
  } finally {
    delete process.env.FAKE_DEVIN_FIXTURE;
    delete process.env.FAKE_DEVIN_LOG;
  }
});

test("the proxy learns sessions and keeps its own replies to itself", () => {
  const state = new ProxyState();
  state.noteClientLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "session/new",
      params: {},
    }),
  );
  assert.deepEqual(
    state.noteAgentLine(
      JSON.stringify({ jsonrpc: "2.0", id: 4, result: { sessionId: "s1" } }),
    ),
    { relay: true, session: "s1" },
  );
  assert.equal(
    state.noteClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "session/load",
        params: { sessionId: "s2" },
      }),
    ),
    "s2",
  );
  assert.deepEqual([...state.sessions], ["s1", "s2"]);

  const outcomes: (string | undefined)[] = [];
  const line = state.inject(
    RENAME_METHOD,
    { sessionId: "s1", title: "t" },
    (error) => outcomes.push(error),
  );
  const { id } = JSON.parse(line);
  assert.deepEqual(
    state.noteAgentLine(JSON.stringify({ jsonrpc: "2.0", id, result: {} })),
    {
      relay: false,
    },
  );
  const failing = JSON.parse(
    state.inject(RENAME_METHOD, {}, (error) => outcomes.push(error)),
  );
  state.noteAgentLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: failing.id,
      error: { code: 1, message: "nope" },
    }),
  );
  assert.deepEqual(outcomes, [undefined, "nope"]);
  // Devin's own messages pass through untouched.
  assert.deepEqual(
    state.noteAgentLine(
      JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} }),
    ),
    { relay: true },
  );
});

test("/compact runs as a compaction turn", async () => {
  const log = fakeLog();
  const { replay, providerThreadId, threadId } = await replayTurn(
    FIXTURE,
    CWD,
    {
      FAKE_DEVIN_LOG: log.path,
    },
  );
  try {
    const turn = await replay.request("turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: "creq_cmpactturn",
      // How bb sends its built-in /compact command.
      input: [
        {
          type: "text",
          text: "/compact",
          mentions: [
            {
              start: 0,
              end: 8,
              resource: {
                kind: "command",
                trigger: "/",
                name: "compact",
                source: "command",
                origin: "builtin",
                label: "compact",
                argumentHint: null,
              },
            },
          ],
        },
      ],
      options: executionOptions(),
    });
    assert.equal(turn.error, undefined);
    await replay.waitFor(
      (events) => events.some((event) => event.type === "thread/compacted"),
      "the compaction to finish",
    );
    assert.ok(
      replay.events.some(
        (event) =>
          event.type === "item/started" &&
          event.item.type === "contextCompaction",
      ),
      "compaction row",
    );
    const prompts = log
      .entries()
      .filter((entry) => entry.message.method === "session/prompt")
      .map((entry) => entry.message.params.prompt[0].text);
    assert.deepEqual(prompts.at(-1), "/compact");
  } finally {
    replay.close();
  }
});

test("a turn keeps the Devin process the session started", async () => {
  // The ACP bridge restarts the agent when a turn's launch spec differs from
  // the session's, so turns must be put behind the proxy the same way.
  const log = fakeLog();
  const { replay } = await replayTurn(FIXTURE, CWD, {
    FAKE_DEVIN_LOG: log.path,
  });
  try {
    const methods = log.entries().map((entry) => entry.message.method);
    assert.equal(methods.filter((method) => method === "initialize").length, 1);
    assert.ok(methods.includes("session/prompt"));
  } finally {
    replay.close();
  }
});
