# pi-guided-compact

A pi extension that replaces the default session compaction summary with a
plain-language, decision-explicit summary — anchored on the session's own
durable status/decision record when one is present in the session's context.

## What it does

When a pi session approaches its context limit, pi compacts the older part
of the conversation into a summary. By default that summary is a generic
condensation. With pi-guided-compact loaded, the summary instead:

- states the current state of the work, what is decided, what is still open
  (and what would settle each open point), and what happens next;
- lists the evidence the claims rest on, with exact file paths;
- records which earlier positions were superseded, and why;
- when a file this session read or wrote functions as the durable
  status/decision record for the work, grounds the summary in that file's
  *current* content — newer and more reliable than the conversation or any
  previous summary.

The summary is written by the session's own model (no separate summarizer
model to configure) using a context-driven prompt: which files count as
records is judged from the session's own context, so there is no file
configuration, globs, or store to maintain.

If anything fails (model error, empty output, abort, disabled), the
extension falls back to pi's default compaction — compaction always happens.

## Output format

The summary has six sections:

1. `## Current state` — what is happening right now.
2. `## Decided` — positions settled by the user or by completed work.
3. `## Still open` — each unresolved point with what would settle it.
4. `## Next steps` — what happens next.
5. `## Evidence & files` — the files, data, and checks the positions rest on.
6. `## Superseded` — positions from the conversation or previous summary
   that no longer hold, and why.

Treat compaction summaries as claims to be verified, not settled truth: when
you continue from one, check its record-grounded claims against the files.

## Install

From npm (once published):

```bash
pi install npm:pi-guided-compact            # latest version
pi install npm:pi-guided-compact@1.0.0      # pinned version
pi -e npm:pi-guided-compact                 # try it for one invocation
```

From git (this repository):

```bash
pi install git:github.com/harpsychord/pi-guided-compact   # default branch
pi install git:github.com/harpsychord/pi-guided-compact@v1.0.0  # pinned tag
```

From a local directory:

```bash
pi install ./pi-guided-compact          # local directory
pi -e ./pi-guided-compact               # try it for one invocation
```

Or manually: add the package's `index.ts` to the `extensions` list in your
pi agent settings (`~/.pi/agent/settings.json`):

```json
{ "extensions": ["/path/to/pi-guided-compact/index.ts"] }
```

Extensions load at session start, so start a new session (or `/reload`)
after installing. `pi list` shows installed packages; `pi remove <source>`
removes one. Versioned npm specifications and git tags/commits are pinned;
`pi update --extensions` reconciles package installations.

## Configuration

Optional global config: `~/.pi/agent/pi-guided-compact.json`
Optional project override (wins field by field): `<project>/.pi/pi-guided-compact.json`

```json
{
  "enabled": true,
  "totalCharCap": 24000,
  "perFileCharCap": 8000,
  "outputMaxTokens": 32768
}
```

| Field | Meaning | Default |
|---|---|---|
| `enabled` | master switch | `true` |
| `totalCharCap` | total character budget across all record candidates | 24000 |
| `perFileCharCap` | per-file character cap (larger files are truncated) | 8000 |
| `outputMaxTokens` | max output tokens requested for the summary | 32768 |

No file lists, globs, or store locations are accepted — by design.

In any session, `/compact-config` shows the effective settings and the last
compaction's behavior. Setting forms: `enabled on|off`,
`totalCharCap <n>`, `perFileCharCap <n>`, `outputMaxTokens <n>`
(short forms: `on|off`, `total|per|max <n>`). Unrecognized or malformed
input produces a warning with usage; it never writes silently.

## How record discovery works

At compaction time the extension collects the text files this session's
branch read or wrote (tool calls, and file paths appearing in shell
commands), deduplicates them, and ranks writes above reads. Each file's
current on-disk content is included up to `perFileCharCap`, with the whole
set capped at `totalCharCap` (files dropped for budget are named in the
prompt). The summarizer then decides, from the content and the conversation,
whether any candidate *functions as* the durable status/decision record —
detection is shape/content-based, not vocabulary-based.

Known limitation: file paths in shell commands are only detected when they
are absolute or clearly relative (`/`, `~`, `./`, `../`); bare relative
names in shell commands are not discovered. Paths in `read`/`write`/`edit`
tool calls are always discovered.

## Requirements

- the pi coding agent (extension API)
- a model whose context window fits the session span being summarized plus
  the output budget; if the request exceeds the window, the summarizer call
  fails and the default compaction is used

## License

[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.txt) (see `LICENSE`). The code is free for all; anyone distributing modified code must release it under the same license.
