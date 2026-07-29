# Install Completion Model Gate Spec

Date: 2026-07-29

## Acceptance

- [x] Setup completion checks the selected Gateway again in the final action.
- [x] Setup completion re-reads the selected-runtime onboarding requirement.
- [x] Setup completion repeats the live active-model probe.
- [x] A failed check cannot write the setup-complete marker.
- [x] Gateway failure routes to Gateway recovery.
- [x] Config or model failure routes to official OpenClaw configuration.
- [x] The gate is a small injected service with behavior tests, not more inline
      branching in the setup hook.
- [x] Wizard start, next, and status results reject unknown top-level fields.
- [x] Wizard start requires a non-empty session id and next rejects a session id.
- [x] Wizard cancellation accepts only the installed synchronous `cancelled`
      result and preserves local state on protocol drift.
- [x] Wizard and live-model error diagnostics redact credentials before UI/log
      storage without rewriting official Wizard step content.
