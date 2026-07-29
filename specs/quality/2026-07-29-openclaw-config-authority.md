# OpenClaw config authority

## Current

JunQi already reads the selected Runtime's `openclaw config schema` for provider advanced fields and validates a candidate through the selected OpenClaw CLI before writing it. However, Agent, Tools, Gateway and command editors still contain copied enums, limits, provider/plugin maps and a broad handwritten config type. Some copied Agent enum values no longer match OpenClaw 2026.7.1.

## Target

- Current selected OpenClaw Runtime is the authority for config schema, enum, bounds, defaults and dynamic capabilities.
- JunQi owns only UI projections, explicit user patches, atomic persistence, selected-runtime identity and reviewed compatibility migrations.
- If authoritative schema/capability is unavailable, constrained editors fail closed and preserve existing values.
- Unknown config keys survive unrelated edits byte-semantically after parse/serialize.
- Bootstrap, Docker and legacy migration constants are documented protocol contracts, centralized rather than inferred.

## Acceptance

- [x] Agent enum and numeric controls consume the Runtime schema and cannot write values outside it.
- [x] Tools UI does not claim a static complete provider/plugin catalog.
- [x] Config write uses the selected Runtime's official validation before persistence.
- [x] Local TypeScript types are documented as non-authoritative projections.
- [x] Local Rust validation is limited to safe preflight invariants and does not claim complete OpenClaw validation.
- [ ] A future boundary test may reject newly introduced static config catalogs automatically; current production scans and behavior tests cover the removed catalogs.
- [x] Unknown future fields survive an unrelated UI mutation and save through `smartMerge`; targeted regression coverage remains desirable.
- [x] Collaboration bootstrap and OpenClaw update retain their dedicated transactional config ownership.
