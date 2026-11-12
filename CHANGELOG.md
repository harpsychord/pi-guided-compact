# Changelog

## [1.0.0]

- Initial release.
- Replaces the default compaction summary with a six-section,
  decision-explicit summary: current state, decided, still open (with
  settling conditions), next steps, evidence & files, and superseded.
- Context-driven record discovery: files the session itself read or
  wrote are candidates; if one functions as the durable status/decision
  record, the summary is grounded in its current on-disk content. No
  file configuration, globs, or stores.
- Uses the session's own model; no separate summarizer model to
  configure.
- Budget caps (totalCharCap / perFileCharCap) and an output token
  budget (outputMaxTokens), all configurable globally or per project.
- `/compact-config` command: shows effective settings and last
  compaction behavior; setting changes validated with explicit warnings
  (no silent no-ops).
- Falls back to pi's default compaction on any failure, so compaction
  always happens.
