import assert from "node:assert/strict";
import { test } from "node:test";
import { installOutboundFilter } from "../src/host/outbound.ts";
import { fakeStdout, tick } from "./support/bridge.ts";

test("passes unchanged lines through byte for byte", () => {
  const out = fakeStdout();
  installOutboundFilter(out, (message) => message);
  out.write('{"a": 1}\n');
  assert.deepEqual(out.lines, ['{"a": 1}']);
});

test("reassembles split lines and replaces, drops, or awaits messages", async () => {
  const out = fakeStdout();
  installOutboundFilter(out, (message: any) => {
    if (message.drop) return null;
    if (message.later) return Promise.resolve({ ...message, done: true });
    return { ...message, seen: true };
  });
  out.write('{"id":1');
  out.write('}\n{"drop":true}\n{"later":1}\nnot json\n');
  await tick();
  assert.deepEqual(out.lines, [
    '{"id":1,"seen":true}',
    "not json",
    '{"later":1,"done":true}',
  ]);
});

test("writes the original line when a transform throws", () => {
  const out = fakeStdout();
  const errors: unknown[] = [];
  installOutboundFilter(
    out,
    () => {
      throw new Error("boom");
    },
    (error) => errors.push(error),
  );
  out.write('{"x":1}\n');
  assert.deepEqual(out.lines, ['{"x":1}']);
  assert.equal(errors.length, 1);
});
