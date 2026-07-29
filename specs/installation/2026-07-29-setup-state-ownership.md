# Setup State Ownership Spec

Date: 2026-07-29

## Acceptance

- [x] A second setup run cannot throw while the owned transaction is stopping.
- [x] Failed transaction admission performs no setup presentation mutation and
      returns a controlled failure to runtime-selection compensation.
- [x] Every non-complete setup state removes the durable completion marker.
- [x] The setup marker key and version have one owner in the app store.
- [x] Runtime refresh re-evaluates the selected config's onboarding requirement
      before choosing Ready or official Wizard.
- [x] Refresh callers use the returned requirement rather than stale hook state.
- [x] Installer execution is split from the root setup coordinator with typed
      ports and no duplicated Gateway restart/retry path.
- [x] Focused behavior tests and the full validation suite pass.
