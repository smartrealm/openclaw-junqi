# Setup Onboarding Second-Pass Plan

1. CREDENTIAL-01: key volatile and persisted Gateway credentials by canonical
   endpoint, move device tokens to the native credential vault, and migrate
   legacy renderer values.
2. LIFECYCLE-01: make official-service inspection fail closed and validate the
   selected bind, port, token reference, and Control UI origin before Ready.
3. ONBOARDING-01: split structural configuration checks from a bounded official
   model probe and reconcile lost terminal Wizard responses.
4. WIZARD-UI-01: render official external URL and device-code fields as native
   setup actions.
5. CLEANUP-01: remove the dead `prepare_gateway` implementation.
6. Add focused TypeScript and Rust regressions, then run lint, frontend tests,
   Rust tests, boundary checks, and official-document link verification.

