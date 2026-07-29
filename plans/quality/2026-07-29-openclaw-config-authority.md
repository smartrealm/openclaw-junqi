# OpenClaw config authority implementation plan

## Phase A — Stop invalid writes

1. Replace Agent static enum and bounds with values resolved from the current Runtime schema.
2. Fail closed when a constrained field's schema is unavailable; preserve existing values through the raw editor.
3. Add behavioral tests against a future/changed schema fixture and the installed-version contract.

## Phase B — Remove copied dynamic catalogs

1. Audit Tools provider/plugin/env mappings against official Runtime schema and plugin capability APIs.
2. Keep existing opaque values visible but remove claims that JunQi's list is complete.
3. Route unsupported additions to official Wizard/CLI rather than guessing config paths.

## Phase C — Make schema access generic

1. Add a `$ref`-aware schema path resolver in `src/services/openclawConfigSchema.ts`.
2. Use one selected-Runtime schema snapshot for Agent, Gateway, Tools, Commands and provider editors.
3. Replace schema parsing `any` with checked unknown-record traversal.

## Phase D — Narrow local ownership

1. Mark `ConfigManager/types.ts` as a UI projection and widen unknown future fields without inventing defaults.
2. Keep Rust preflight checks for root shape, safe port and atomic persistence, while official CLI validation remains the acceptance gate.
3. Convert whole-config normalization into explicit, tested and versioned migrations or user-field patches.

## Phase E — Centralize path contracts and add gates

1. Reuse selected layout for Native paths and `commands::docker` constants for container paths.
2. Add source/boundary tests rejecting static option catalogs and default config path joins outside approved modules.
3. Run targeted schema/config tests, `pnpm lint`, `pnpm test`, `pnpm build`, Rust checks and `git diff --check`.

## Safety constraints

- Do not rewrite an existing user config merely to normalize it.
- Do not remove unknown fields.
- Do not expose or persist secrets while inspecting schema/config.
- Do not silently switch Native/Docker runtime.
- Do not collapse collaboration bootstrap or OpenClaw update into ordinary config writes.
