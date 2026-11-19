// Finds the Devin CLI on the host and points the ACP launch spec at it.
//
// The server declares the launch spec once for every host, so it can only
// name `devin`. Hosts started from the GUI often lack the user's shell PATH,
// and Devin.app ships the CLI inside its bundle without linking it onto PATH,
// so the host resolves the real path before the ACP bridge sees the request.
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import {
  DEVIN_APP_EXECUTABLE,
  DEVIN_COMMAND,
  DEVIN_EXECUTABLE_ENV,
} from "../constants.ts";

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Fallback locations tried after PATH, in order. */
  fallbacks?: readonly string[];
  isExecutable?: (path: string) => boolean;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const extensions =
    platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  return dirs.flatMap((dir) =>
    extensions.map((ext) => join(dir, `${DEVIN_COMMAND}${ext}`)),
  );
}

/**
 * The Devin CLI to launch: `BB_DEVIN_EXECUTABLE`, then `devin` on PATH, then
 * the copy inside Devin.app. Returns null when none exists.
 */
export function resolveDevinExecutable(
  options: ResolveOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const fallbacks =
    options.fallbacks ?? (platform === "darwin" ? [DEVIN_APP_EXECUTABLE] : []);
  const isExecutable = options.isExecutable ?? isExecutableFile;

  const override = env[DEVIN_EXECUTABLE_ENV]?.trim();
  if (override && isAbsolute(override) && isExecutable(override)) {
    return override;
  }
  for (const candidate of [...pathCandidates(env, platform), ...fallbacks]) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Session requests nest provider options under `options`; maintenance requests do not. */
function launchSpecs(params: unknown): Record<string, unknown>[] {
  if (!isRecord(params)) return [];
  const holders = [
    params.providerOptions,
    isRecord(params.options) ? params.options.providerOptions : undefined,
  ];
  return holders.flatMap((holder) =>
    isRecord(holder) && isRecord(holder.acpLaunchSpec)
      ? [holder.acpLaunchSpec]
      : [],
  );
}

/**
 * Rewrites a runtime JSON-RPC line so its ACP launch spec runs the resolved
 * Devin CLI. Lines without a `devin` launch spec, or that are not JSON, pass
 * through unchanged; when no CLI is found the spec keeps `devin`, so health
 * reports it as not installed.
 */
export function rewriteLaunchCommand(
  line: string,
  resolve: () => string | null = resolveDevinExecutable,
): string {
  if (!line.includes('"acpLaunchSpec"')) return line;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return line;
  }
  if (!isRecord(message)) return line;
  const specs = launchSpecs(message.params).filter(
    (spec) => spec.command === DEVIN_COMMAND,
  );
  if (specs.length === 0) return line;
  const executable = resolve();
  if (executable === null || executable === DEVIN_COMMAND) return line;
  for (const spec of specs) spec.command = executable;
  return JSON.stringify(message);
}
