# Gateway Setup and AI Rescue Fix Plan

## Phase A - Data correctness

| Bug | File | Fix |
| --- | --- | --- |
| GR-01 | `src/services/gatewayRescue.ts` | Remove fabricated fallback and enumerate explicit provider models |
| GR-02 | `src/components/GatewayRescueChat.tsx` | Keep manual settings closed and classify authentication failures |

## Phase B - Workflow visibility

| Bug | File | Fix |
| --- | --- | --- |
| GR-03 | `src/components/setup/SetupFlowPanels.tsx` | Follow the current timeline row inside the fixed viewport |

## Phase C - Compact interaction

| Bug | File | Fix |
| --- | --- | --- |
| GR-04 | `src/components/GatewayRescueChat.tsx` | Add explicit dropdown affordance and stable target identity |
| GR-05 | `src/components/GatewaySelfRescuePanel.tsx` | Replace the expanded dashboard body with a compact AI mode |
| GR-06 | `src/hooks/useSetupFlow.ts` | Preserve preparation warnings and retry during explicit start |

## Phase D - Regression and validation

1. Add target resolution, auth-error, timeline-follow, and compact-mode tests.
2. Run focused tests, frontend lint, full frontend tests, and production build.
3. Commit on `main`, merge into `daxia`, and rerun Daxia brand regressions.
