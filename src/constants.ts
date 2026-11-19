/** Shared between the server declaration and the host bridge. */

export const PROVIDER_ID = "devin";
/** The command name the server declares; the host replaces it with a path. */
export const DEVIN_COMMAND = "devin";
/** Operator override for the Devin CLI path, forwarded by the daemon. */
export const DEVIN_EXECUTABLE_ENV = "BB_DEVIN_EXECUTABLE";
/** Where Devin.app bundles the CLI on macOS. */
export const DEVIN_APP_EXECUTABLE =
  "/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin";
export const DEVIN_LOGIN_COMMAND = "devin auth login";
