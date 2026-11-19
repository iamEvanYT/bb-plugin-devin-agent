# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-19

### Added

- Devin provider backed by `devin acp` through the Plugin SDK's ACP bridge.
- Devin's Session Mode is the permission control; BB offers only its
  accept-edits mode, which forwards Devin's approval requests.
- Host-side CLI lookup: `BB_DEVIN_EXECUTABLE`, then `PATH`, then Devin.app.
- Health reports a signed-out or expired Devin account instead of ready, and
  shows the account email and plan when signed in.
