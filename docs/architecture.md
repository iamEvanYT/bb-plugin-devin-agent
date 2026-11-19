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

The wrapper also filters what the bridge writes back. The SDK's ACP bridge
writes each message as one JSON line to `process.stdout` in its own process,
so `host/outbound.ts` wraps that stream and `host/bridge.ts` amends the
replies it tracked by request id. Health is the first: the generic bridge
only checks that the CLI runs, so a `ready` result is checked against
`devin auth status` and becomes `unauthenticated` (or `expired`) when Devin
is signed out, with the account email, plan, and a login command that uses
the resolved CLI path.

## Code layout

```text
src/
  server.ts                 Provider declaration and ACP launch spec
  host.ts                   Host entry: exports the provider bridge
  constants.ts              Ids, command name, and paths shared by both
  host/bridge.ts            The wrapped ACP bridge: inbound and outbound filters
  host/outbound.ts          Line filter over the bridge's stdout
  host/acp-proxy.ts         The stdio proxy in front of Devin, and its control port
  host/account.ts           `devin auth status` parsing for health
  host/devin-dialect.ts     The `devin` ACP dialect and subagent nesting
  host/devin-executable.ts  CLI lookup and launch-spec rewrite
tests/                      Node tests; fixtures/ are recorded Devin sessions
                            replayed through the built bridge
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
- **A `devin` dialect reads Devin's `_meta`.** `host/devin-dialect.ts` is
  registered with `experimental_registerAcpDialect` at module load. It names
  tools from `cognition.ai/inferenceToolName`, takes exit codes from
  `terminal_exit`, marks `find_file_by_name` as a path search, and classifies
  `run_subagent` as a delegation with the subagent's summary. The SDK merges a
  call's updates without their `_meta`, so the dialect remembers exit codes,
  output, and subagent links per call (bounded).
- **Subagent rows are nested by the outbound filter.** The SDK's ACP
  translator never sets `parentRef`. The dialect links each subagent id
  (`cognition.ai/subagent_started`) to its `run_subagent` call, and tool calls
  carrying `cognition.ai/subagent_context` to that call; the outbound filter
  then adds `parentRef` (the delegation's `childRef`) to those rows' delta
  keys, and drops the lifecycle updates Devin sends under the subagent id.

- **Rename goes through a stdio proxy.** Devin only renames a session
  (`_cognition.ai/session/rename`) on the connection that has it open, and
  the SDK's ACP bridge keeps that connection private. So every request that
  carries a launch spec, turns included, launches the built host entry in
  proxy mode (`host/acp-proxy.ts`) in front of Devin. The ACP bridge restarts
  the agent when a turn's spec differs from the session's, so the rewrite must
  be identical every time. The proxy relays ACP lines unchanged, reports
  session ids to the bridge over a loopback port guarded by a random token,
  and on request writes the rename to Devin and keeps Devin's reply from the
  SDK's bridge. Devin's `session_info_update` then becomes bb's title update
  as usual. The control port, token, and an `ELECTRON_RUN_AS_NODE` added only
  for the proxy are removed from Devin's environment. When no proxy has the
  session (Devin exited), a one-off `devin acp` loads it and renames it.
- **`initialize` advertises `threadRename`** once the control port listens;
  runtime lines are held until then.
- **`/compact` is Devin's own command.** The ACP bridge sends `/compact` as a
  prompt and treats `end_turn` as completed; Devin runs it as its built-in
  compaction.

## Known gaps

- bb does not forward renames while a thread's runtime is stopped.
- Devin sends no usage update after `/compact`, so the context meter is stale
  until the next turn.

- No settings page, model allowlist, or install action yet.
