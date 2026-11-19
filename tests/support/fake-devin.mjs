// A stand-in for `devin acp` that replays a recorded session (tests/fixtures).
// Usage: node fake-devin.mjs <fixture.json>
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const sessionId = fixture.sessionNew.sessionId;
let promptIndex = 0;
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === undefined || message.id === undefined) return;
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply(fixture.initialize);
    case "session/new":
      return reply(fixture.sessionNew);
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
