# Changelog

## [1.0.1]

- Fix empty-summary fallback in workspaces where the session model
  rejects the provider-default reasoning level (e.g.
  `openai-codex/gpt-6-luna`, which accepts no off/none): the
  summarizer call now passes the session's thinking level through the
  provider-neutral `streamSimple()` reasoning option, so it behaves
  like the session's own turns.
- Provider error responses (`stopReason: "error"`, no text) are now
  reported as failures with the provider's error message instead of
  being misclassified as "empty summary"; the failed attempt is
  recorded in the `/compact-config` last-run display.
- A `length`-stopped (truncated) summary is no longer persisted as the
  compaction checkpoint; the extension falls back to default
  compaction instead.

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
