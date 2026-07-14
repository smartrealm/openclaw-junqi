# First-run onboarding bugfix plan

## Execution order

| Phase | Bug | Fix |
| --- | --- | --- |
| A | BUG-ONB-01 | Invalidate detection effects before committing state transitions. |
| A | BUG-ONB-02 | Guard storage callbacks by mounted state and lock Back while applying. |
| B | BUG-ONB-03 | Remove the unsafe branch-agnostic Back action from Ready. |
| B | BUG-ONB-04 | Route successful updates through the onboarding requirement gate. |
| C | BUG-ONB-05 | Expose Docker selection as a native button with disabled semantics. |
| D | All | Add source-level regression tests, type-check, test, and build. |
