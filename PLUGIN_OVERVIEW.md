## What you get

Devin appears in BB's provider picker next to your other providers. Start a
thread and BB drives the Devin CLI through its Agent Client Protocol server
(`devin acp`), using BB's usual timeline, approvals, and composer.

- **Works with Devin.app.** The plugin finds `devin` on `PATH`, or the CLI
  bundled inside Devin.app when it is not linked.
- **Devin's Session Mode controls permissions.** Pick Code, Smart, Ask, Plan,
  or Bypass in the model switcher; anything Devin asks about shows up as a BB
  approval prompt.
- **Rich timeline rows.** Commands show their output and exit codes, file
  reads, searches, edits, web fetches, and plans get their own rows, and
  Devin's subagents appear as delegation rows with their work nested inside.
- **Reasoning levels** map to Devin's thought level for models that have one.
- **Rename and `/compact`.** Renaming a thread renames its Devin session, and
  `/compact` runs Devin's own compaction.
- **Sign-in aware.** BB shows when Devin is signed out, with the command to
  sign in.
- **Devin's skills show up** in BB's `/` menu.

## Requirements

- The Devin CLI, on `PATH` or installed with Devin.app.
- A signed-in Devin account (`devin auth login`).

## Good to know

- BB's own permission modes are replaced by Devin's Session Mode.
- Not supported yet: fork, archive, and the usage dashboard.
- An independent community plugin, not affiliated with Cognition.
