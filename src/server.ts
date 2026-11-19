// BB provider registration for Devin.
//
// Devin speaks the Agent Client Protocol through `devin acp`, so the host
// entry runs the SDK's generic ACP bridge. This file only owns the provider
// metadata and the launch spec.
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  DEVIN_COMMAND,
  DEVIN_EXECUTABLE_ENV,
  DEVIN_LOGIN_COMMAND,
  PROVIDER_ID,
} from "./constants.ts";

/** Devin's reasoning levels, with Devin's own labels. */
const REASONING_LEVELS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" },
  { id: "max", label: "Max" },
] as const;

export default async function plugin(bb: BbPluginApi) {
  bb.providers.register({
    id: PROVIDER_ID,
    displayName: "Devin",
    icon: "./icons/devin.svg",
    strings: {
      signInHint: `Run \`${DEVIN_LOGIN_COMMAND}\` on this machine to sign in to Devin.`,
      expiredHint: `Your Devin session expired. Run \`${DEVIN_LOGIN_COMMAND}\`, then reload.`,
      installUrl: "https://devin.ai",
      brandPrefix: "Devin ",
      iconTint: { light: "#18181B", dark: "#FAFAFA" },
    },
    experimental_bridgeOptions: {
      // The host replaces `command` with the CLI it finds: BB_DEVIN_EXECUTABLE,
      // `devin` on PATH, or the copy bundled in Devin.app.
      acpLaunchSpec: {
        displayName: "Devin",
        command: DEVIN_COMMAND,
        args: ["acp"],
        env: {},
      },
      // Registered by the host entry (host/devin-dialect.ts).
      acpDialect: "devin",
    },
    // Only list Devin on hosts where the CLI was found.
    experimental_visibility: "installed",
    maintenance: { health: true, usage: false, installation: false },
    models: { scope: "workspace" },
    env: { passthrough: [DEVIN_EXECUTABLE_ENV] },
    // Devin's own skill directories (`devin skills paths`). BB already scans
    // `.agents/skills`.
    experimental_nativeSkillRoots: {
      user: [".config/devin/skills", ".config/cognition/skills"],
      project: [".devin/skills", ".cognition/skills"],
    },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      // `/compact` is sent to Devin as its own slash command.
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      // Through the proxy in host/acp-proxy.ts.
      supportsThreadRename: true,
      // Devin advertises session/load but not session/fork.
      fork: "none",
      // Devin's Session Mode (Code, Smart, Ask, Plan, Bypass) decides what it
      // asks before doing. In accept-edits the bridge sends those asks to
      // BB's approval prompt; `full` would approve them all and override the
      // mode, so it is not offered.
      permissionModes: ["accept-edits"],
      // Every level a Devin model reports (each model lists its own subset in
      // model/list). A level missing here is rejected when the thread starts,
      // even though the picker offered it.
      reasoningLevels: REASONING_LEVELS.map((level) => level.id),
    },
    reasoningLevels: REASONING_LEVELS,
    composerActions: [],
  });

  bb.log.info("registered Devin provider");
}
