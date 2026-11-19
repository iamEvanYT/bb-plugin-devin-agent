# Architecture

## How the bridge works

Devin speaks the Agent Client Protocol over stdio (`devin acp`), so the plugin
does not implement the provider bridge protocol itself. The host entry
re-exports the Plugin SDK's generic ACP bridge
(`@get-bb/plugin-sdk/provider-bridge/acp`) behind a thin wrapper.

The server declares one ACP launch spec for every host, with `command: "devin"`.
Hosts started from the GUI often lack the user's shell `PATH`, and Devin.app
does not link its CLI onto `PATH`, so before each runtime line reaches the ACP
bridge the wrapper replaces that command with the CLI it finds on this host:
`BB_DEVIN_EXECUTABLE`, then `devin` on `PATH`, then the copy in Devin.app. When
none exists the spec keeps `devin`, and health reports not installed.

## Code layout

```text
src/
  server.ts                 Provider declaration and ACP launch spec
  host.ts                   Host entry: the wrapped ACP provider bridge
  constants.ts              Ids, command name, and paths shared by both
  host/devin-executable.ts  CLI lookup and launch-spec rewrite
tests/                      Node tests
skills/                     Agent skill shipped with the plugin
docs/                       Developer documentation
```

## Design decisions

- **Devin's Session Mode is the permission control.** Devin decides what to
  ask about from its mode (Code, Smart, Ask, Plan, Bypass), and the ACP bridge
  answers those asks according to BB's permission mode. Only `accept-edits`
  is declared, which forwards them to BB's approval prompt; `full` would
  approve every ask and silently override Devin's mode.
- **No fork.** Devin advertises `loadSession` but not `session/fork`.
- **Generic dialect.** Devin's vendor `_cognition.ai/*` notifications and
  `_meta` fields are not read yet. A custom dialect registered with
  `experimental_registerAcpDialect` in `host.ts` is where that would go.

## Known gaps

- Health reports `ready` whenever the CLI exists, even when signed out; the
  generic dialect has no account check. Signed out, Devin lists no models.
- No settings page, model allowlist, or install action yet.
