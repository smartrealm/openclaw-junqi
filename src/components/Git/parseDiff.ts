// ── Git diff parser ───────────────────────────────────────────────────────────
// Parses unified git diff output into structured DiffFile[] for rendering.
import type { DiffFile, DiffHunk, DiffHunkLine } from "./types";

function pathBasename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function isBinaryDiff(diff: string, oldPath: string, newPath: string): boolean {
  // Binary diffs contain a "Binary files ... differ" or "GIT binary patch" line
  return /^Binary files/i.test(diff) || /^GIT binary patch/i.test(diff);
}

function countFileLines(file: DiffFile, diff: string): { additions: number; deletions: number } {
  let add = 0;
  let del = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") add++;
      if (line.kind === "delete") del++;
    }
  }
  return { additions: add, deletions: del };
}

export function parseDiff(
  diffText: string,
  projectPath: string,
): DiffFile[] {
  if (!diffText || diffText.trim().length === 0) return [];
  const files: DiffFile[] = [];

  // Split the diff into per-file blocks: lines starting with "diff --git"
  const fileBlocks: string[] = [];
  let currentBlock: string[] = [];
  const lines = diffText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip the a/ b/ prefix in diff headers for path matching
    if (line.startsWith("diff --git ") && currentBlock.length > 0) {
      fileBlocks.push(currentBlock.join("\n"));
      currentBlock = [];
    }
    currentBlock.push(line);
  }
  if (currentBlock.length > 0) {
    fileBlocks.push(currentBlock.join("\n"));
  }

  for (const block of fileBlocks) {
    const blockLines = block.split("\n");
    let oldPath = "";
    let newPath = "";
    let status = "M"; // default modified
    let binary = false;

    // Extract file paths: --- a/path and +++ b/path
    for (const bl of blockLines) {
      if (bl.startsWith("--- ")) {
        oldPath = bl.slice(4).trim().replace(/^a\//, "");
      }
      if (bl.startsWith("+++ ")) {
        newPath = bl.slice(4).trim().replace(/^b\//, "");
      }
    }

    const displayPath = newPath || oldPath;
    if (!displayPath) continue;

    // Detect binary
    const blockText = blockLines.join("\n");
    if (isBinaryDiff(blockText, oldPath, newPath)) {
      binary = true;
    }

    // Detect status from header lines (deleted/new/renamed file mode)
    for (const bl of blockLines) {
      if (bl.startsWith("deleted file mode")) status = "D";
      else if (bl.startsWith("new file mode")) status = "A";
      else if (bl.startsWith("rename from ")) status = "R";
      else if (bl.startsWith("copy from ")) status = "C";
    }

    // Parse hunks
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLineNo = 0;
    let newLineNo = 0;

    for (const bl of blockLines) {
      // Hunk header: @@ -a,b +c,d @@
      const hunkMatch = bl.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = { header: bl, lines: [] };
        oldLineNo = parseInt(hunkMatch[1], 10) || 0;
        newLineNo = parseInt(hunkMatch[3], 10) || 0;
        continue;
      }

      if (!currentHunk) continue;

      if (bl.startsWith(" ")) {
        currentHunk.lines.push({
          kind: "context",
          text: bl.slice(1),
          oldLineNo: oldLineNo++,
          newLineNo: newLineNo++,
        });
      } else if (bl.startsWith("+")) {
        currentHunk.lines.push({
          kind: "add",
          text: bl.slice(1),
          newLineNo: newLineNo++,
        });
      } else if (bl.startsWith("-")) {
        currentHunk.lines.push({
          kind: "delete",
          text: bl.slice(1),
          oldLineNo: oldLineNo++,
        });
      } else if (bl === "\\ No newline at end of file") {
        if (currentHunk.lines.length > 0) {
          currentHunk.lines[currentHunk.lines.length - 1].highlighted = true;
        }
      }
      // All other lines (like "index ...") are ignored
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    files.push({
      displayPath,
      oldPath,
      newPath,
      status,
      hunks,
      additions: 0,
      deletions: 0,
      binary,
    });
  }

  // Compute per-file add/delete counts
  for (const file of files) {
    const counts = countFileLines(file, "");
    file.additions = counts.additions;
    file.deletions = counts.deletions;
  }

  return files;
}
