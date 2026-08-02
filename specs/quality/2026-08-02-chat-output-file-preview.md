# Chat Output File Preview Specification

## Goal

Users can click a previewable chat output file and inspect it inline without relying on an ambiguous process-relative path.

## Acceptance Criteria

- Relative output paths resolve only under the active session agent workspace.
- The session agent workspace is the only authorization root; Gateway-supplied workspace roots do not authorize a file path.
- Traversal, absolute paths outside the session workspace, and symlink escapes are rejected.
- Markdown, HTML, text, media, PDF, `xlsx`, `pptx`, and `docx` have a real read-only preview route.
- Preview, default-open, folder-reveal, and copy-path are independent right-side icon actions with accessible labels; file actions are not hidden behind an overflow menu.
- Office previews do not execute macros, scripts, or embedded content.
- Office package size, extracted-entry size, slide count, and returned text are bounded before rendering.
- Legacy binary Office formats remain external-open only.
