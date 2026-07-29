# Setup State Ownership Plan

Date: 2026-07-29

1. [x] Replace throwing transaction admission with an explicit boolean result
   and add coordinator behavior coverage.
2. [x] Move setup completion marker persistence entirely into the app store and
   cover `true`, `false`, and `null` transitions.
3. [x] Return refreshed onboarding state from runtime refresh and route from
   that result.
4. [x] Extract native/Docker installer execution from the root setup hook while
   preserving the shared operation and Gateway coordinators.
5. [x] Replace remaining setup-boundary `any` values with exact or narrowed
   types touched by the extraction.
6. [x] Update the first-run preview and document index.
7. [x] Run focused, complete frontend/Rust, docs, boundary, diff, and production
   build validation.
