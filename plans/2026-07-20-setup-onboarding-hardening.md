# Setup Onboarding Hardening Plan

1. SETUP-01: make handoff plus authenticated post-handoff readiness a required transition to Ready.
2. SETUP-02: split fresh-config defaults from existing-config compatibility checks and additive updates.
3. SETUP-03: stop persisting Gateway credentials in renderer localStorage.
4. SETUP-04: remove the unused `prepare_gateway` command surface.
5. Add one regression contract per finding, then run TypeScript, Rust, boundary, and documentation checks.
