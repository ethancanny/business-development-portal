/**
 * Line-based text diff (contract version comparison, Oct 24, 2026).
 *
 * LCS over lines with a size guard: contract texts are short (a few
 * hundred lines). Above the guard we fall back to a set-based diff
 * (lines only in A / only in B) so a pathological document can never
 * blow up memory. Output hunks are capped for the wire; counts are
 * always exact for the algorithm used.
 */

export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

export interface TextDiff {
  lines: DiffLine[];
  truncated: boolean;
  added: number;
  removed: number;
  /** Changed lines only (del then add), capped — the AI change
   * summary's input. Never the full document. */
  changedLines: string[];
}

const LCS_CELL_LIMIT = 4_000_000; // ~2000 x 2000 lines
const MAX_OUTPUT_LINES = 1200;
const MAX_CHANGED_FOR_AI = 220;

function splitLines(text: string): string[] {
  return (text ?? "").replace(/\r\n/g, "\n").split("\n");
}

export function diffTexts(oldText: string, newText: string): TextDiff {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let lines: DiffLine[] = [];

  if (a.length * Math.max(1, b.length) <= LCS_CELL_LIMIT) {
    // Classic LCS DP over lines.
    const m = a.length;
    const n = b.length;
    const dp: Uint32Array = new Uint32Array((m + 1) * (n + 1));
    const W = n + 1;
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i * W + j] =
          a[i] === b[j]
            ? dp[(i + 1) * W + (j + 1)] + 1
            : Math.max(dp[(i + 1) * W + j], dp[i * W + (j + 1)]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) {
        lines.push({ type: "same", text: a[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * W + j] >= dp[i * W + (j + 1)]) {
        lines.push({ type: "del", text: a[i] });
        i++;
      } else {
        lines.push({ type: "add", text: b[j] });
        j++;
      }
    }
    while (i < m) lines.push({ type: "del", text: a[i++] });
    while (j < n) lines.push({ type: "add", text: b[j++] });
  } else {
    // Set-based fallback for oversized inputs.
    const inB = new Map<string, number>();
    for (const l of b) inB.set(l, (inB.get(l) ?? 0) + 1);
    const removedLines: DiffLine[] = [];
    for (const l of a) {
      const c = inB.get(l) ?? 0;
      if (c > 0) inB.set(l, c - 1);
      else removedLines.push({ type: "del", text: l });
    }
    const inA = new Map<string, number>();
    for (const l of a) inA.set(l, (inA.get(l) ?? 0) + 1);
    const addedLines: DiffLine[] = [];
    for (const l of b) {
      const c = inA.get(l) ?? 0;
      if (c > 0) inA.set(l, c - 1);
      else addedLines.push({ type: "add", text: l });
    }
    lines = [...removedLines, ...addedLines];
  }

  let added = 0;
  let removed = 0;
  const changedLines: string[] = [];
  for (const l of lines) {
    if (l.type === "add") {
      added++;
      if (changedLines.length < MAX_CHANGED_FOR_AI)
        changedLines.push(`+ ${l.text}`);
    } else if (l.type === "del") {
      removed++;
      if (changedLines.length < MAX_CHANGED_FOR_AI)
        changedLines.push(`- ${l.text}`);
    }
  }

  // Trim long runs of unchanged lines for display (keep 2 of context
  // around changes) so the comparison view stays readable.
  const display: DiffLine[] = [];
  let run: DiffLine[] = [];
  const flushRun = (keepEdges: boolean) => {
    if (!run.length) return;
    if (!keepEdges || run.length <= 5) {
      display.push(...run);
    } else {
      display.push(...run.slice(0, 2));
      display.push({
        type: "same",
        text: `… ${run.length - 4} unchanged lines …`,
      });
      display.push(...run.slice(-2));
    }
    run = [];
  };
  let sawChange = false;
  for (const l of lines) {
    if (l.type === "same") {
      run.push(l);
    } else {
      sawChange = true;
      flushRun(true);
      display.push(l);
    }
  }
  flushRun(sawChange);

  const truncated = display.length > MAX_OUTPUT_LINES;
  return {
    lines: truncated ? display.slice(0, MAX_OUTPUT_LINES) : display,
    truncated,
    added,
    removed,
    changedLines,
  };
}
