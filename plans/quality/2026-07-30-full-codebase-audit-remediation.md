# Full Codebase Audit Remediation Plan

Date: 2026-07-30

## Execution order

1. [x] **Batch A — independent correctness**: FCA-01, FCA-10, FCA-11, FCA-13.
   Add failing contract/behavior tests first; update the audit after validation.
2. [x] **Batch B — production demo and generated catalog**: FCA-09 and FCA-12.
   Remove the unguarded showcase surface, then make the pinned media catalog a
   deterministic generated artifact with drift coverage.
3. [x] **Batch C — path authority**: FCA-02. Separate Native filename,
   container path, user-facing diagnostics, and collaboration backup names;
   run full Rust validation.
4. [x] **Batch D — visual-system foundation**: FCA-03. Retheme retained Radix
   behavior primitives to Aegis and remove showcase-only wrappers, dependencies,
   and `shadcn-tokens.css`.
5. [x] **Batch E — shared UI primitives**: FCA-04, FCA-05, FCA-07. One status
   semantic domain (`shared/status/statusTone.ts`) now owns the canonical tones,
   the alias table for every legacy/cross-layer vocabulary, and the only token
   color map; dot/icon/badge remain as presentation shapes over it. `EmptyState`
   gained `iconStyle`/`density` variants so secondary surfaces can reuse it.
   Form-factor exceptions are documented in the audit rather than forced.
6. [x] **Batch F — loading and color convergence**: FCA-06 and FCA-08. Loading
   states now use `LoadingIndicator` while refresh-action icon rotation remains
   intentional. Product chrome uses semantic tokens; a reviewed allowlist owns
   content palettes (terminal/ANSI, diff, QR/canvas, theme previews and mascot
   art) and repository tests reject unclassified hex colors.
7. [ ] **Batch G — collaboration Rust decomposition**: FCA-14. The dependency
   map and dedicated spec/plan are complete; the wire-contract module is the
   first validated extraction. Target, agent-policy, package/storage,
   journal/plugin and recovery slices remain.
8. [ ] Run complete repository validation, update the audit status and document
   all manual/target-platform boundaries.

## Guardrails

- Do not silently change Native/Docker selection, Gateway ownership, provider
  defaults, session routing, or official Wizard/plugin output.
- Do not generate catalogs from a global OpenClaw installation in committed
  build logic; use the workspace-pinned package input.
- Do not treat mascot/SVG, QR/canvas, terminal search, or diff semantic colors
  as ordinary product chrome without an explicit design decision.
- Keep Tauri command names, argument casing, serde field names, and registration
  unchanged during FCA-14 decomposition.
