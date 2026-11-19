# Devin for BB

A [BB](https://getbb.app) plugin that runs BB threads through the Devin CLI's
Agent Client Protocol server (`devin acp`). Devin owns the model connection,
credentials, and its own tools. The plugin builds on the Plugin SDK's generic
ACP bridge and adds what is specific to Devin: finding the CLI, sign-in state,
Devin's tool metadata and subagents, and session rename.

Verified against Devin CLI 3000.14.30825, BB 0.50.1, and Plugin SDK 0.6.157.

This is an independent community plugin. It is not affiliated with or endorsed
by Cognition; Devin and its logo are Cognition's trademarks.

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
| Rename          | Renaming a thread renames its Devin session (through the proxy described in [docs/architecture.md](docs/architecture.md)).                   |
| Reasoning       | Each model offers the levels Devin reports for it (Low to Max); the level is set as Devin's `thought_level` option.                          |
| `/compact`      | Runs Devin's own `/compact` and shows a compaction row.                                                                                      |
| Subagents       | Devin's `run_subagent` is a delegation row with the subagent's summary, and the subagent's work is nested inside it.                         |

Not supported yet: fork (Devin has no `session/fork`), archive, native
questions, BB's `auto` and `full` permission modes, plan mode, and the usage
dashboard.

## Development

```sh
npm install
npm run check   # format, typecheck, build, tests
```

See [docs/architecture.md](docs/architecture.md).

## License

MIT
