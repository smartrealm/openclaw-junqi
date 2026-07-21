# Workflow Template and Run Boundary

Workflow Templates are versioned definitions that outlive their source Runs, while Workflow Runs remain immutable OpenClaw-backed execution and audit records. We deliberately instantiate a new Run with a fresh capability snapshot and approval instead of copying Attempts, Evidence, approvals, or deliveries, because copying those facts would make the audit trail and external-effect guarantees ambiguous.
