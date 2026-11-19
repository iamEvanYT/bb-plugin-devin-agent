// Filters the JSON-RPC lines the ACP bridge writes to stdout.
//
// The SDK's ACP bridge writes every message as one JSON line straight to
// process.stdout, and the bridge runs in its own process, so wrapping that
// stream is the only way to amend its replies. A transform returns the message
// unchanged (the original line is written as-is), a replacement, null to drop
// it, or a promise of either.

export type OutboundTransform = (
  message: unknown,
) => unknown | null | Promise<unknown | null>;

export interface WritableLike {
  write: (chunk: any, ...rest: any[]) => boolean;
}

const KEEP = Symbol("keep");

export function installOutboundFilter(
  stream: WritableLike,
  transform: OutboundTransform,
  onError: (error: unknown) => void = () => {},
): () => void {
  const original = stream.write.bind(stream);
  let buffer = "";

  const emit = (line: string, value: unknown) => {
    if (value === null) return;
    original(value === KEEP ? `${line}\n` : `${JSON.stringify(value)}\n`);
  };

  const handleLine = (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      original(`${line}\n`);
      return;
    }
    let result: unknown;
    try {
      result = transform(message);
    } catch (error) {
      onError(error);
      original(`${line}\n`);
      return;
    }
    if (result instanceof Promise) {
      result.then(
        (value) => emit(line, value === message ? KEEP : value),
        (error) => {
          onError(error);
          original(`${line}\n`);
        },
      );
      return;
    }
    emit(line, result === message ? KEEP : result);
  };

  stream.write = (chunk: unknown, ...rest: unknown[]) => {
    const text =
      typeof chunk === "string"
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString("utf8")
          : String(chunk);
    buffer += text;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.length > 0) handleLine(line);
    }
    const callback = rest.find((value) => typeof value === "function") as
      (() => void) | undefined;
    callback?.();
    return true;
  };

  return () => {
    stream.write = original;
  };
}
