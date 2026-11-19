# Devin for BB

A [BB](https://getbb.app) plugin that runs BB threads through the Devin CLI's
Agent Client Protocol server (`devin acp`). Devin owns the model connection,
credentials, and its own tools; the plugin uses the Plugin SDK's generic ACP
bridge and only adds Devin's launch details.

Verified against Devin CLI 3000.14.30825 and Plugin SDK 0.6.157.

## Requirements

- BB with Plugin SDK 0.6.99 or newer
- The Devin CLI, found in this order:
  1. `BB_DEVIN_EXECUTABLE` (an absolute path) in the host daemon's environment
  2. `devin` on the host's `PATH`
  3. `/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin`
- A signed-in Devin account: `devin auth login`

## Install

```sh
bb plugin install git:https://github.com/iamEvanYT/bb-plugin-devin-agent.git
```

BB lists Devin in the provider picker on hosts where the CLI is found.

## Supported BB features

| BB feature      | Details                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider picker | Visible on hosts where the Devin CLI is found.                                                                                               |
| Health          | Reports not installed, signed out, or expired (from `devin auth status`), or ready with the CLI version, account email, and plan.            |
| Models          | Discovered from Devin's ACP `model` config option for the workspace.                                                                         |
| Permissions     | Devin's Session Mode (Code, Smart, Ask, Plan, Bypass) is the only control; what Devin asks about becomes a BB approval prompt.               |
| Skills          | BB lists Devin's skill directories (`~/.config/devin/skills`, `.devin/skills`, and the `cognition` equivalents).                             |
| Timeline rows   | Reads, searches (content and file name), commands with output and exit codes, edits, web fetches, and plans. Devin's own tools show by name. |
| Subagents       | Devin's `run_subagent` is a delegation row with the subagent's summary, and the subagent's work is nested inside it.                         |

Not supported yet: fork (Devin has no `session/fork`), rename, archive,
manual compaction, native questions, BB's `auto` and `full` permission modes, plan mode,
reasoning levels, and the usage dashboard.

## Development

```sh
npm install
npm run check   # format, typecheck, build, tests
```

See [docs/architecture.md](docs/architecture.md).

## License

MIT
