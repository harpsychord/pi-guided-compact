import type { RecordCandidate } from "./types.ts";

export interface PromptInput {
  conversationText: string;
  previousSummary?: string;
  candidates: RecordCandidate[];
  droppedForBudget: string[];
  /** Present on a retry after the vocabulary gate rejected a draft. */
  violationNote?: string;
}

function candidateBlock(candidates: RecordCandidate[], droppedForBudget: string[]): string {
  const files = candidates
    .map((c) => {
      const header = `<!-- file: ${c.displayPath} (session ${c.mode} this file)${c.truncated ? " [truncated for length]" : ""} -->`;
      return `${header}\n${c.content}`;
    })
    .join("\n\n");
  const dropped =
    droppedForBudget.length > 0
      ? `\n\nFiles this session also touched, left out for length (do not guess at their content):\n${droppedForBudget
          .map((p) => `- ${p}`)
          .join("\n")}`
    : "";
  return `<record-candidates>\n${files}${dropped}\n</record-candidates>`;
}

/**
 * Build the summarization prompt. Plain language throughout; the output
 * structure is a generic status-checkpoint shape (current state / decided
 * / open-with-closing-condition / next / evidence / superseded), not any
 * company-specific record format.
 */
export function buildSummaryPrompt(input: PromptInput): string {
  const parts: string[] = [];

  parts.push(
    "You are summarizing the older part of a coding session. The summary replaces those messages as the only memory of what came before, and the session will continue from it. Output ONLY the summary.",
  );

  if (input.candidates.length > 0) {
    parts.push(
      [
        "Files this session read or wrote are included in <record-candidates> below. First decide, from their content and from the conversation, whether any of them functions as the durable status/decision record for this work — a document that states what is currently true, what is decided, what is still open (and what would settle each open point), and what happens next.",
        "- If one or more do: the current content of that file (or files) is the most recent statement of the project's state, newer and more reliable than both the conversation and any previous summary. Ground the Decided, Still open, and Next steps sections in it. Distill it; do not paste it wholesale.",
        "- If none does: derive everything from the conversation.",
      ].join("\n"),
    );
    parts.push(candidateBlock(input.candidates, input.droppedForBudget));
  }

  if (input.previousSummary) {
    parts.push(
      [
        `<previous-summary>\n${input.previousSummary}\n</previous-summary>`,
        "Treat the previous summary as claims to check, not as truth to preserve: keep what the conversation or the record files confirm; move anything contradicted, or no longer applicable, into the Superseded section; do not copy it verbatim just because it is there.",
      ].join("\n"),
    );
  }

  parts.push(`<conversation>\n${input.conversationText}\n</conversation>`);

  parts.push(
    [
      "Write the summary in plain language, with exactly these sections in this order:",
      "## Current state — what is happening right now.",
      "## Decided — positions settled by the user or by completed work, stated as settled.",
      "## Still open — each item states what would settle it.",
      "## Next steps — what happens next.",
      "## Evidence & files — the files, data, or checks the positions rest on; exact paths.",
      "## Superseded — positions from the conversation or previous summary that no longer hold, and why. Write \"none\" if there are none.",
      "",
      "Rules:",
      "- Preserve exact file paths, function names, and error messages.",
      "- Keep each section concise.",
      "- If a record file was truncated or files were left out for length, do not guess at the missing content; say only that it exists.",
      "- Plain language. If a record file uses its own status labels or terminology, you may repeat them when quoting that file's position — the document should be able to state its own status.",
    ].join("\n"),
  );

  if (input.violationNote) {
    parts.push(input.violationNote);
  }

  // Reasoning is configured by the caller through the provider-neutral
  // SimpleStreamOptions.reasoning field, not embedded in this prompt.

  return parts.join("\n\n");
}
