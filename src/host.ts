// Host entry: the provider bridge BB runs for Devin threads.
//
// The SDK's generic ACP bridge does the protocol work; host/bridge.ts wraps it
// with what is specific to Devin.
import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { createDevinBridge } from "./host/bridge.ts";

export { createDevinBridge } from "./host/bridge.ts";
export { loginCommand, parseAuthStatus, withAccount } from "./host/account.ts";
export {
  resolveDevinExecutable,
  rewriteLaunchCommand,
  rewriteLaunchSpecs,
} from "./host/devin-executable.ts";
export { installOutboundFilter } from "./host/outbound.ts";

export const experimental_providerBridge = createDevinBridge({
  acp: experimental_acpProviderBridge,
});
