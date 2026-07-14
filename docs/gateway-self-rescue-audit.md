# Gateway Self-Rescue Audit

## Critical

### BUG-SR01 - Repair completion ignores setup cancellation

The setup repair promise always starts Gateway after success. Returning to mode selection only invalidates the prior install run; it does not invalidate the repair continuation.

### BUG-SR02 - Repair and restart use different concurrency gates

The shared rescue panel leaves its restart action enabled during Doctor repair, while repair and Gateway lifecycle commands acquire unrelated locks.

### BUG-SR03 - Repair behavior is fragmented

Setup runs `openclaw update repair`, general rescue runs `doctor --fix`, and maintenance owns a third implementation. Plugin convergence failures are therefore not repaired consistently.

## Medium

### BUG-SR04 - Repair output is raw and unbounded

Repair stdout/stderr is emitted without credential redaction or per-line limits and retained in unbounded vectors until process exit.

### BUG-SR05 - Direct Gateway retry reruns installation

The Gateway error action calls the complete native setup pipeline, clearing the diagnostic log and rechecking every installer stage.

### BUG-SR06 - Windows timeout can leave descendants

The general Doctor path kills only its direct child instead of using the Windows process-tree termination used by setup installation.

### BUG-SR07 - Diagnostic routing is dead code

`diagnose_startup_failure` is only used by tests, so transient failures and repairable plugin/config failures receive the same heavy repair action.
