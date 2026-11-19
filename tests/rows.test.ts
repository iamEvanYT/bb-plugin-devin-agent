// Replays recorded Devin sessions through the built bridge (npm test builds
// first) and checks the rows bb assembles from them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { replayTurn } from "./support/replay.ts";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
const CWD = "/private/tmp/devin-rec/ws";

async function rows(name: string) {
  const { replay } = await replayTurn(fixture(name), CWD);
  try {
    return replay.events
      .filter((event) => event.type === "item/completed")
      .map((event) => event.item)
      .filter((item) => item.type !== "reasoning");
  } finally {
    replay.close();
  }
}

test("commands carry Devin's exit codes and output", async () => {
  const items = await rows("devin-subagent");
  const commands = items.filter((item) => item.type === "commandExecution");
  assert.deepEqual(
    commands.map((item) => [
      item.command,
      item.exitCode,
      item.aggregatedOutput,
    ]),
    [
      ["printf 'x\\ny\\n' > c.txt && cat c.txt", 0, "x\ny"],
      ["ls missing-dir", 1, "ls: missing-dir: No such file or directory"],
    ],
  );
});

test("a file-name search is a path search", async () => {
  const items = await rows("devin-subagent");
  const search = items.find((item) => item.type === "search");
  assert.equal(search?.mode, "path");
  assert.equal(search?.query, "*.ts");
});

test("a subagent is a delegation row with its work nested inside", async () => {
  const items = await rows("devin-subagent");
  const delegation = items.find((item) => item.type === "delegation");
  assert.ok(delegation, "delegation row");
  assert.equal(delegation.label, "Count lines of a.txt");
  assert.match(delegation.summary, /contains \*\*3 lines\*\*/);
  const read = items.find((item) => item.type === "fileRead");
  assert.equal(read?.parentToolCallId, delegation.id);
  // Devin's subagent lifecycle updates do not become rows of their own.
  assert.equal(
    items.filter(
      (item) => item.type === "toolCall" && item.tool !== "request_scope",
    ).length,
    0,
  );
});

test("Devin's own tools are named", async () => {
  const items = await rows("devin-subagent");
  const scope = items.find((item) => item.type === "toolCall");
  assert.equal(scope?.tool, "request_scope");
});

test("standard tools keep the generic mapping", async () => {
  const items = await rows("devin-tools");
  assert.deepEqual(
    items.map((item) => item.type),
    [
      "commandExecution",
      "search",
      "fileRead",
      "planSteps",
      "fileChange",
      "commandExecution",
      "webFetch",
      "planSteps",
      "agentMessage",
    ],
  );
  const wc = items.find((item) => item.command === "wc -l a.txt");
  assert.equal(wc?.exitCode, 0);
});
