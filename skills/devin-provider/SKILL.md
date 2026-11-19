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

Run `devin auth login` on the host. Health checks `devin auth status`: signed
out it reports `unauthenticated` (or `expired`) with a login command that uses
the CLI path the plugin found; signed in it shows the account email and plan.

## Behavior to expect

- Permissions follow Devin's Session Mode (`mode` option: `accept-edits`
  "Code", `smart`, `ask`, `plan`, `bypass`), chosen in BB's model switcher or
  with `bb thread spawn --option mode=<value>`. Whatever Devin asks about
  appears as a BB approval prompt. BB's only permission mode is
  `accept-edits`; `full` and `auto` are not offered.
- Skills from `~/.config/devin/skills`, `~/.config/cognition/skills`,
  `.devin/skills`, and `.cognition/skills` appear in BB's `/` menu.
- Not supported: fork, rename, archive, manual compaction, native questions,
  plan mode, reasoning levels, and the usage dashboard.

## Troubleshooting

- `devin doctor` diagnoses the local Devin configuration.
- Plugin logs: `~/.bb/plugins/devin-agent/logs/plugin.log`.
