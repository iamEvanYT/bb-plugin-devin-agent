## What you get

Devin appears in BB's provider picker next to your other providers. Start a
thread and BB drives the Devin CLI through its Agent Client Protocol server
(`devin acp`), using BB's usual timeline, approvals, and composer.

- **Works with Devin.app.** The plugin finds `devin` on `PATH`, or the CLI
  bundled inside Devin.app when it is not linked.
- **Devin's Session Mode controls permissions.** Pick Code, Smart, Ask, Plan,
  or Bypass in the model switcher; anything Devin asks about shows up as a BB
  approval prompt.
- **Devin's skills show up** in BB's `/` menu.

## Requirements

- The Devin CLI, on `PATH` or installed with Devin.app.
- A signed-in Devin account (`devin auth login`).

## Good to know

- Renaming a thread renames its Devin session, and `/compact` runs Devin's
  own compaction.
- Not supported yet: fork, archive, and the usage dashboard.
