// Host entry: the provider bridge BB runs for Devin threads.
//
// The SDK's generic ACP bridge does the protocol work. This wrapper only
// resolves where the Devin CLI lives on this host before each request reaches
// it (see host/devin-executable.ts).
import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { experimental_defineProviderBridge } from "@get-bb/plugin-sdk/provider-bridge";
import { rewriteLaunchCommand } from "./host/devin-executable.ts";

export {
  resolveDevinExecutable,
  rewriteLaunchCommand,
} from "./host/devin-executable.ts";

const acp = experimental_acpProviderBridge;

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine: (line) => acp.handleLine(rewriteLaunchCommand(line)),
  start: acp.start ? (context) => acp.start?.(context) : undefined,
  onClose: acp.onClose ? () => acp.onClose?.() : undefined,
  onSigterm: acp.onSigterm ? () => acp.onSigterm?.() : undefined,
  onSigint: acp.onSigint ? () => acp.onSigint?.() : undefined,
});
