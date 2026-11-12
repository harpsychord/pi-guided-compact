/**
 * pi-guided-compact — context-driven compaction summarizer for pi.
 *
 * On `session_before_compact` it replaces the default summary with one
 * that is plain-language and decision-explicit, grounded in the session's
 * own durable status/decision record when one is present among the files
 * this session read or wrote — and no file configuration is involved.
 * Any failure falls back to the default compaction (return nothing).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "@earendil-works/pi-ai";
import { existsSync } from "node:fs";
import { loadConfig, saveGlobalConfig, configPath } from "./core/config.ts";
import { discoverRecords } from "./core/discover.ts";
import { buildSummaryPrompt } from "./core/prompt.ts";

interface LastRun {
  at: string;
  reason: string;
  candidates: string[];
  droppedForBudget: string[];
  anchored: boolean | null;
  note?: string;
}

let lastRun: LastRun | undefined;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("compact-config", {
    description: "Show or change pi-guided-compact settings (enabled, totalCharCap, perFileCharCap, outputMaxTokens)",
    handler: async (args, ctx) => {
      const cfg = loadConfig(ctx.cwd);
      const arg = args.trim();
      if (arg === "on" || arg === "enable") {
        const next = saveGlobalConfig(ctx.cwd, { enabled: true });
        ctx.ui.notify(`pi-guided-compact enabled (${JSON.stringify(next)})`, "info");
        return;
      }
      if (arg === "off" || arg === "disable") {
        const next = saveGlobalConfig(ctx.cwd, { enabled: false });
        ctx.ui.notify(`pi-guided-compact disabled (${JSON.stringify(next)})`, "info");
        return;
      }
      const m = arg.match(/^enabled\s+(on|off|true|false)$/);
      if (m) {
        const on = m[1] === "on" || m[1] === "true";
        const next = saveGlobalConfig(ctx.cwd, { enabled: on });
        ctx.ui.notify(`pi-guided-compact enabled = ${on} (${JSON.stringify(next)})`, "info");
        return;
      }
      const v = arg.match(/^(totalCharCap|perFileCharCap|outputMaxTokens|total|per|max)\s+(-?\d+)$/);
      if (v) {
        const key =
          v[1] === "total" ? "totalCharCap"
          : v[1] === "per" ? "perFileCharCap"
          : v[1] === "max" ? "outputMaxTokens"
          : v[1];
        const n = Number(v[2]);
        if (n <= 0) {
          ctx.ui.notify(`pi-guided-compact ${key}: value must be a positive integer (got ${v[2]})`, "warning");
          return;
        }
        const next = saveGlobalConfig(ctx.cwd, { [key]: n });
        ctx.ui.notify(`pi-guided-compact ${key} = ${v[2]} (${JSON.stringify(next)})`, "info");
        return;
      }
      // Anything non-empty that reached this point is unrecognized or
      // malformed (e.g. "total abc", "foo 123", "TOTAL 5000"): warn,
      // no write, no display — no silent fall-throughs (owner ruling,
      // 2026-11-12).
      if (arg !== "") {
        ctx.ui.notify(
          `pi-guided-compact: unrecognized or malformed command: ${arg}\nusage: enabled on|off | totalCharCap <n> | perFileCharCap <n> | outputMaxTokens <n> (short: on|off, total|per|max <n>)`,
          "warning",
        );
        return;
      }
      // Show last compaction first, then settings + usage as one group.
      const globalPath = configPath(ctx.cwd, "global");
      const projectPath = configPath(ctx.cwd, "project");
      const noConfig = !existsSync(globalPath) && !existsSync(projectPath);
      const lines = [
        lastRun
          ? `last compaction: ${lastRun.at} (${lastRun.reason})` +
            ` — candidates: ${lastRun.candidates.length ? lastRun.candidates.join(", ") : "none"}` +
            (lastRun.droppedForBudget.length ? `; dropped for budget: ${lastRun.droppedForBudget.join(", ")}` : "") +
            (lastRun.note ? `; ${lastRun.note}` : "")
          : "last compaction: (none yet this session)",
        `settings @ ${globalPath}${noConfig ? " (no config file — defaults in effect)" : ""}`,
        existsSync(projectPath) ? `  + project override: ${projectPath}` : undefined,
        `  enabled: ${cfg.enabled}`,
        `  totalCharCap: ${cfg.totalCharCap}`,
        `  perFileCharCap: ${cfg.perFileCharCap}`,
        `  outputMaxTokens: ${cfg.outputMaxTokens}`,
        "usage:",
        "  /compact-config enabled on|off | totalCharCap <n> | perFileCharCap <n> | outputMaxTokens <n>",
        "  short forms: on|off, total|per|max <n>",
      ].filter((l): l is string => l !== undefined);
      ctx.ui.notify(lines.join("\n"), "info");

    },
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const cfg = loadConfig(ctx.cwd);
    if (!cfg.enabled) return;

    const { preparation, branchEntries, reason, signal } = event;
    try {
      if (ctx.ui) ctx.ui.notify("pi-guided-compact: generating context-anchored summary…", "info");

      // 1. Discover this session's record candidates (no config, no picking).
      const { candidates, droppedForBudget } = discoverRecords({
        entries: branchEntries as Parameters<typeof discoverRecords>[0]["entries"],
        cwd: ctx.cwd,
        config: cfg,
      });

      // 2. Serialize the span being summarized (same helper Pi uses).
      const allMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
      const conversationText = serializeConversation(convertToLlm(allMessages));

      // 3. Ask the session's own model, with the context-driven prompt.
      const first = await runSummarizer(ctx, buildSummaryPrompt({
        conversationText,
        previousSummary: preparation.previousSummary,
        candidates,
        droppedForBudget,
      }), signal, cfg.outputMaxTokens);
      let summary = first.text;
      let usage = first.usage;

      if (!summary.trim()) {
        ctx.ui.notify("pi-guided-compact: empty summary; falling back to default compaction", "warning");
        return;
      }

      lastRun = {
        at: new Date().toISOString(),
        reason,
        candidates: candidates.map((c) => c.displayPath),
        droppedForBudget,
        anchored: candidates.length > 0,
      };
      ctx.ui.notify(
        `pi-guided-compact: summary generated (${candidates.length} candidate file${candidates.length === 1 ? "" : "s"})`,
        "info",
      );

      return {
        compaction: {
          summary,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          usage: usage as never,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!signal.aborted) {
        lastRun = {
          at: new Date().toISOString(),
          reason,
          candidates: [],
          droppedForBudget: [],
          anchored: null,
          note: `error: ${message}; default compaction used`,
        };
        ctx.ui.notify(`pi-guided-compact: failed (${message}); falling back to default compaction`, "warning");
      }
      return;
    }
  });
}

async function runSummarizer(
  ctx: { model: any; modelRegistry: any },
  prompt: string,
  signal: AbortSignal,
  maxTokens: number,
): Promise<{ text: string; usage?: unknown }> {
  const response = await ctx.modelRegistry.complete(
    ctx.model,
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
          timestamp: Date.now(),
        },
      ],
    },
    { maxTokens: maxTokens, signal, cacheRetention: "none", sessionId: uuidv7() },
  );
  const text = response.content
    .filter((c: any): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return { text, usage: response.usage };
}
