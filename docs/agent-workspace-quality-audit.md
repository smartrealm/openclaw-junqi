# Agent workspace quality audit

## Critical

- **BUG-01**: Agent polling can clear an open dirty file because workspace resolution depends on the complete agents array.
- **BUG-02**: Closing the workspace bypasses the dirty-file confirmation path.
- **BUG-03**: Concurrent file reads can resolve out of order and show the wrong file.
- **BUG-04**: The create-agent wizard displays selected skills but does not send the OpenClaw agent skill allowlist.

## Medium

- **BUG-05**: The AI workspace root view has no route-level back action.
- **BUG-06**: Agent skill load failures are rendered as a valid empty state.

## Execution order

1. Protect editor state and serialize file-read results (BUG-01, BUG-02, BUG-03).
2. Persist and parse the native OpenClaw per-agent skill filter (BUG-04, BUG-06).
3. Restore route-level AI workspace navigation (BUG-05).
4. Add behavioral regressions and run type, frontend, build, and Rust validation.

## Validation

- TypeScript interface check: passed.
- Cleanup search and `git diff --check`: passed.
- Focused BUG-01 through BUG-06 regressions: passed.
- Full frontend suite: 642 passed.
- Boundary suite: 15 passed.
- Production build: passed.
- Hooks Rust suite: 12 passed, 1 ignored end-to-end environment test.
