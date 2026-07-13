# Setup Installer Visualization Plan

## Execution order

| Phase | Bug | Files | Fix |
| --- | --- | --- | --- |
| A | BUG-V01 | `docker.rs`, shared progress module | Stream Docker pull output through structured events. |
| B | BUG-V02 | setup flow/model, setup panels | Preserve and render local per-step progress. |
| C | BUG-V03 | event normalizer, app store, setup page/panels | Keep log metadata and build a timestamped live console. |
| D | BUG-V04 | setup page | Do not offer false Back/cancel behavior during active installation. |
| E | BUG-V05 | setup flow | Synchronize the step ref with every state commit. |
| F | all | Rust and TypeScript tests | Add regression contracts and run layered validation. |
