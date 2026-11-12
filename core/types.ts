// Minimal structural types for the session data the extension consumes.
// Kept pi-free so the core can be tested standalone against a raw JSONL
// fixture without importing the harness package.

export interface PiGuidedCompactConfig {
  /** Master switch. When false, the extension returns and default compaction runs. */
  enabled: boolean;
  /** Total character budget for all record-candidate contents combined. */
  totalCharCap: number;
  /** Per-file character cap. A file larger than this is truncated to the front. */
  perFileCharCap: number;
  /** Max output tokens for the summarization LLM call.
   *  2026-11-12: raised 16384 -> 32768 (owner): with a low thinking
   *  level, reasoning tokens still consume part of the budget; 32K
   *  completed all 5 baseline spans without truncation. */
  outputMaxTokens: number;
}

export const DEFAULT_CONFIG: PiGuidedCompactConfig = {
  enabled: true,
  totalCharCap: 24000,
  perFileCharCap: 8000,
  outputMaxTokens: 32768,
};

/** A file this session read or wrote, ranked as a record candidate. */
export interface RecordCandidate {
  /** Path exactly as it appeared in the session (for the summary). */
  displayPath: string;
  /** Absolute path used to read the file. */
  absPath: string;
  /** "written" if the session wrote/edited it, "read" if it only read it. */
  mode: "written" | "read";
  /** File content, truncated to perFileCharCap. */
  content: string;
  /** True when the file content was truncated to fit the per-file cap. */
  truncated: boolean;
}

export interface Discovered {
  /** Candidates within the total budget, ranked (written first, then recency). */
  candidates: RecordCandidate[];
  /** Absolute paths dropped to stay within totalCharCap (reported, never silent). */
  droppedForBudget: string[];
  /** Absolute paths that were touched but not text/markdown or unreadable. */
  skipped: string[];
}
