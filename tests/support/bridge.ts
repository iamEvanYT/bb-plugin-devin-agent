import type { ProviderBridgeDefinition } from "@get-bb/plugin-sdk/provider-bridge";

/** A stdout stand-in that records complete lines. */
export function fakeStdout() {
  const lines: string[] = [];
  return {
    lines,
    messages: () => lines.map((line) => JSON.parse(line)),
    write(chunk: string) {
      lines.push(...chunk.split("\n").filter(Boolean));
      return true;
    },
  };
}

/** A fake ACP bridge: records the lines it gets and replies through `reply`. */
export function fakeAcp(
  stdout: { write: (chunk: string) => boolean },
  reply: (message: any) => unknown[] = () => [],
) {
  const received: any[] = [];
  const acp: ProviderBridgeDefinition = {
    handleLine(line) {
      const message = JSON.parse(line);
      received.push(message);
      for (const out of reply(message))
        stdout.write(`${JSON.stringify(out)}\n`);
    },
  };
  return { acp, received };
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));

export const startContext = {
  pluginId: "devin-agent",
  dataDir: "/tmp/devin-test-data",
  tempDir: "/tmp/devin-test-tmp",
};
