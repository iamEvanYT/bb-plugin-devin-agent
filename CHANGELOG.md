# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-19

### Fixed

- Picking a reasoning level other than Medium no longer fails thread
  creation: the provider declares every level Devin models report.

### Added

- Devin provider backed by `devin acp` through the Plugin SDK's ACP bridge.
- Devin's Session Mode is the permission control; BB offers only its
  accept-edits mode, which forwards Devin's approval requests.
- Host-side CLI lookup: `BB_DEVIN_EXECUTABLE`, then `PATH`, then Devin.app.
- Richer rows from Devin's own metadata: command exit codes, file-name
  searches, Devin's tool names, and subagents as delegation rows with their
  work nested inside.
- Renaming a thread renames its Devin session, through a stdio proxy in front
  of `devin acp`.
- `/compact` runs Devin's own compaction.
- Health reports a signed-out or expired Devin account instead of ready, and
  shows the account email and plan when signed in.
