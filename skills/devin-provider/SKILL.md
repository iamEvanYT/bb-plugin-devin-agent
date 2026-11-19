---
name: devin-provider
description: "Inspect or troubleshoot the BB Devin provider: where the Devin CLI is found, signing in, permission modes, and unsupported features."
---

# Devin provider

The `devin` provider runs BB threads through `devin acp`, the Devin CLI's
Agent Client Protocol server. Devin owns model credentials; BB never stores
them.

## Finding the CLI

On each host the bridge launches the first of:

1. `BB_DEVIN_EXECUTABLE` (absolute path) in the host daemon's environment
2. `devin` on the host's `PATH`
3. `/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin`

The provider is listed only on hosts where one of these exists.

## Signing in

Run `devin auth login` on the host. Signed out, Devin offers no models, but
health still reports ready because the generic ACP bridge does not check the
account.

## Behavior to expect

- Permission modes: `accept-edits` runs `devin --permission-mode accept-edits`,
  `full` runs `--permission-mode dangerous`. `auto` is not offered.
- Skills from `~/.config/devin/skills`, `~/.config/cognition/skills`,
  `.devin/skills`, and `.cognition/skills` appear in BB's `/` menu.
- Not supported: fork, rename, archive, manual compaction, native questions,
  plan mode, reasoning levels, and the usage dashboard.

## Troubleshooting

- `devin doctor` diagnoses the local Devin configuration.
- Plugin logs: `~/.bb/plugins/devin-agent/logs/plugin.log`.
