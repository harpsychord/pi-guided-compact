import { readFileSync, existsSync, statSync } from "node:fs";
import { isAbsolute, resolve, extname } from "node:path";
import type { Discovered, PiGuidedCompactConfig, RecordCandidate } from "./types.ts";

/**
 * Discover the session's record candidates: the text/markdown files this
 * session itself read or wrote, across the whole branch (not just the span
 * being summarized). No configuration, no picking — the branch's file
 * footprint is the candidate set, and the model decides which (if any) of
 * them is the durable status/decision record.
 *
 * Kept pi-free: takes a plain array of session entries.
 */

const TEXT_EXTS = new Set([".md", ".markdown", ".txt", ".text", ".rst"]);

/** A minimal view of the session entry shape we care about. */
export interface MsgEntry {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

interface ToolCall {
  type: "toolCall";
  name?: string;
  arguments?: Record<string, unknown>;
}

function toolCallsOf(entry: MsgEntry): ToolCall[] {
  const msg = entry?.message;
  if (!msg || msg.role !== "assistant") return [];
  const content = msg.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is ToolCall => !!b && (b as ToolCall).type === "toolCall");
}

function stringArg(args: Record<string, unknown> | undefined, key: string): string | null {
  if (!args) return null;
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Extract path-like tokens from a bash command string. */
function pathsInCommand(cmd: string): string[] {
  const out: string[] = [];
  const re = /(?<![\w.])(?:[~$]\w*\/|\/|\.{1,2}\/)[^\s"'`|&;<>]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    out.push(m[0]);
  }
  return out;
}

function toAbs(p: string, cwd: string): string {
  let s = p;
  if (s.startsWith("~")) s = s.slice(1);
  if (s.startsWith("$HOME")) s = s.slice(5);
  if (isAbsolute(s) || s.startsWith("/")) return resolve(s);
  return resolve(cwd, s);
}

function isTextCandidate(absPath: string): boolean {
  return TEXT_EXTS.has(extname(absPath).toLowerCase());
}

export interface DiscoveredInput {
  entries: MsgEntry[];
  cwd: string;
  config: PiGuidedCompactConfig;
}

export function discoverRecords({ entries, cwd, config }: DiscoveredInput): Discovered {
  const map = new Map<string, { displayPath: string; absPath: string; mode: "written" | "read"; lastIdx: number }>();

  const touch = (displayPath: string, mode: "written" | "read", idx: number) => {
    let absPath: string;
    try {
      absPath = toAbs(displayPath, cwd);
    } catch {
      return;
    }
    const prev = map.get(absPath);
    if (!prev) {
      map.set(absPath, { displayPath, absPath, mode, lastIdx: idx });
    } else {
      if (mode === "written") prev.mode = "written";
      prev.lastIdx = idx;
    }
  };

  entries.forEach((entry, idx) => {
    for (const tc of toolCallsOf(entry)) {
      const args = tc.arguments as Record<string, unknown> | undefined;
      const name = tc.name;
      if (name === "read") {
        const p = stringArg(args, "path");
        if (p) touch(p, "read", idx);
      } else if (name === "write" || name === "edit") {
        const p = stringArg(args, "path");
        if (p) touch(p, "written", idx);
      } else if (name === "bash") {
        const cmd = stringArg(args, "command");
        if (cmd) for (const p of pathsInCommand(cmd)) touch(p, "read", idx);
      }
    }
  });

  const ranked = Array.from(map.values()).sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === "written" ? -1 : 1;
    return b.lastIdx - a.lastIdx;
  });

  const candidates: RecordCandidate[] = [];
  const droppedForBudget: string[] = [];
  const skipped: string[] = [];
  let used = 0;

  for (const item of ranked) {
    if (!isTextCandidate(item.absPath)) {
      skipped.push(item.absPath);
      continue;
    }
    if (!existsSync(item.absPath)) {
      skipped.push(item.absPath);
      continue;
    }
    let size = 0;
    try {
      size = statSync(item.absPath).size;
    } catch {
      skipped.push(item.absPath);
      continue;
    }
    let content: string;
    let truncated = false;
    try {
      content = readFileSync(item.absPath, "utf8");
    } catch {
      skipped.push(item.absPath);
      continue;
    }
    if (content.length > config.perFileCharCap) {
      content = content.slice(0, config.perFileCharCap);
      truncated = true;
    }
    if (used + content.length > config.totalCharCap && candidates.length > 0) {
      droppedForBudget.push(item.absPath);
      continue;
    }
    used += content.length;
    candidates.push({ displayPath: item.displayPath, absPath: item.absPath, mode: item.mode, content, truncated });
  }

  return { candidates, droppedForBudget, skipped };
}
