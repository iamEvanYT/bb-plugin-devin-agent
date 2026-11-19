#!/usr/bin/env node
// A stand-in for `devin acp` that replays a recorded session (tests/fixtures).
// The fixture comes from FAKE_DEVIN_FIXTURE, so the plugin can launch this
// file as its Devin CLI (BB_DEVIN_EXECUTABLE) with the usual `acp` argument.
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const fixture = JSON.parse(
  readFileSync(process.env.FAKE_DEVIN_FIXTURE, "utf8"),
);
const sessionId = fixture.sessionNew.sessionId;
const log = process.env.FAKE_DEVIN_LOG;
let promptIndex = 0;
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (log) {
    const env = {
      controlToken: process.env.BB_DEVIN_CONTROL_TOKEN !== undefined,
      controlPort: process.env.BB_DEVIN_CONTROL_PORT !== undefined,
    };
    const entry = { argv: process.argv.slice(2), env, message };
    appendFileSync(log, `${JSON.stringify(entry)}\n`);
  }
  if (message.method === undefined || message.id === undefined) return;
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  const fail = (code, text) =>
    send({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });
  switch (message.method) {
    case "initialize":
      return reply(fixture.initialize);
    case "session/new":
      return reply(fixture.sessionNew);
    case "session/load":
      if (message.params.sessionId !== sessionId)
        return fail(-32002, "Session not found");
      return reply({});
    case "_cognition.ai/session/rename":
      if (message.params.sessionId !== sessionId)
        return fail(-32602, "Session not found");
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "session_info_update",
            title: message.params.title,
          },
        },
      });
      return reply({});
    case "session/prompt": {
      const prompt = fixture.prompts[promptIndex++];
      if (prompt === undefined) return reply({ stopReason: "end_turn" });
      for (const params of prompt.updates) {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: { ...params, sessionId },
        });
      }
      return reply(prompt.result);
    }
    default:
      return reply({});
  }
});
