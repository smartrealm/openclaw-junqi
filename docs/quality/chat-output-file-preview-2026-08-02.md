# Chat Output File Preview

## Evidence

Chat output lines such as `文件位置：都市骑手-短篇.md` are parsed as relative file references. The prior card sent that bare name to native open and read commands, which resolve relative to the application process rather than the agent workspace.

## Current Behavior

The chat file card resolves both relative and explicit local paths against the workspace configured for the session's agent. It rejects traversal, absolute paths outside that workspace, and Gateway-provided workspace roots as authorization input. Clicking a previewable card toggles its inline preview; the action menu remains available for external open, reveal, and copy.

Markdown, HTML, text, image, audio, video, and PDF keep their existing preview modes. OOXML `xlsx`, `pptx`, and `docx` files now receive a read-only content preview. The native command canonicalizes the file and selected workspace, rejects symlink escapes, and runs ZIP/XML extraction outside Tauri's async executor. It does not execute macros or embedded scripts, limits packages to 32 MB, each extracted XML entry to 768 KB, presentations to 100 slides, and returned preview content to 512 KB. Legacy binary `xls` and `ppt` remain external-open only.

## Validation

- Focused chat path and preview tests cover session-workspace authorization and Office bridge parameters.
- Rust Office parser tests cover spreadsheet shared strings/cells, ordered presentation text, workspace escape rejection, and an oversized uncompressed ZIP entry.
- `pnpm test`, `pnpm lint`, `pnpm build`, `cargo fmt -- --check`, `cargo check --lib`, `cargo test --lib`, and `git diff --check` passed.
- Rust validation retains one pre-existing unused-variable warning in `commands/system.rs`.

## Remaining Boundary

The OOXML preview is content-oriented, not a pixel-faithful Office renderer. Formulas are displayed as stored values when present; slide design, transitions, charts, and embedded media are not rendered inline.

The local browser connection was unavailable in this environment, so desktop-window visual acceptance remains unverified.
