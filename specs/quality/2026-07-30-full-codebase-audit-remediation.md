# Full Codebase Audit Remediation Spec

Date: 2026-07-30

## Scope

This campaign closes `BUG-FCA-01` through `BUG-FCA-14` from
`docs/quality/full-codebase-audit-2026-07-29.md` against the verified current
baseline. Changes are delivered in dependency-ordered batches; a checked item
requires implementation, regression coverage, and validation evidence.

## Acceptance

### Runtime and configuration defects

- [x] FCA-01: the Dynamic Island consumes the application i18n instance, honors
      the persisted JunQi language, and has English, Simplified Chinese, and
      Traditional Chinese messages without `navigator.language` branching.
- [x] FCA-02: Native OpenClaw configuration filename construction has one
      authoritative constant; Docker protocol paths and collaboration backup
      filenames remain separate contracts.
- [x] FCA-10: all production Gateway default endpoints consume
      `runtimeDefaults`.
- [x] FCA-11: the Memory API runtime default has one validated source and
      display placeholders do not become a second runtime default.
- [x] FCA-12: media catalog generation is reproducible from the pinned OpenClaw
      package, non-empty for the pinned release, and guarded by tests/build
      validation without depending on a developer-global installation.
- [x] FCA-13: README reports the release version owned by the three package
      manifests.

### Product UI convergence

- [x] FCA-03/FCA-09: the production showcase route and showcase-only visual
      components/dependencies are removed; retained Radix behavior primitives
      consume Aegis tokens and no second shadcn token source remains.
- [x] FCA-04: status presentation has one semantic domain (`statusTone.ts`) and
      one token color source; exactly one `StatusDot` implementation remains.
- [x] FCA-05/FCA-07: switch and empty-state behavior use shared Aegis
      primitives, with form-factor exceptions (ThemePicker's full-card toggle,
      CollaborationDetails' inline notice) explicitly classified rather than
      mechanically replaced. `ToolCallHistoryPopover`'s waiting/empty state
      migrates with FCA-06.
- [x] FCA-06: loading states use `LoadingIndicator` or `Button loading`, retain
      refresh-icon semantics, expose status semantics, and respect reduced
      motion. A repository regression rejects production `Loader2` renderers.
- [x] FCA-08: product chrome colors consume theme tokens; intentional content,
      terminal/ANSI, terminal-search, diff, QR/canvas, theme-preview and mascot
      colors are explicitly classified and guarded rather than mechanically
      replaced.

### Rust modularity

- [ ] FCA-14: collaboration bootstrap is split by documented subdomain behind
      unchanged Tauri commands and wire contracts; no secret or runtime
      ownership behavior changes.

## Validation boundary

Each batch runs focused regressions, TypeScript/module boundaries or Rust checks
as applicable, and `git diff --check`. Final completion additionally requires
full frontend/script tests, Rust library tests, collaboration tests/validation,
OpenClaw documentation verification, and production build. Four-theme visual
acceptance and target-platform native behavior remain explicitly reported as
manual validation.
