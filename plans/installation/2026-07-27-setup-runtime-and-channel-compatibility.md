# Setup Runtime and Channel Compatibility Plan

1. BUG-ONB-40: refresh Gateway target/credentials after official finalization
   and reconcile a process-local Wizard session loss.
2. BUG-ONB-41: preserve protocol output, add vendor-neutral QR URL/polling
   handling, and redraw locally captured terminal QR output.
3. BUG-ONB-39: separate Docker installation from daemon readiness and make
   re-detection visibly single-flight.
4. Add focused regression coverage, run complete validation, package the latest
   macOS build, and launch it for an application-level smoke check.
5. BUG-ONB-42: recognize the immediate URL-authorization confirmation after a
   user-started QR flow, submit its affirmative value once, and verify that the
   plugin's waiting and success notes remain authoritative.
6. BUG-ONB-43: document that Wizard Back is restart-and-replay; defer changing
   its product semantics until Exit versus replay behavior is chosen explicitly.
7. BUG-ONB-44: suppress the shared setup log action when its log collection is
   empty, while retaining real accumulated diagnostics and the install console.
8. BUG-ONB-45: recover an observably complete terminal Wizard note after the
   final Gateway restart, and label channel probe failures as non-blocking
   without changing or hiding plugin output.
9. BUG-ONB-46: follow the official `executor: "gateway"` progress contract,
   poll without an answer, and preserve local terminal QR presentation while
   provider authorization remains in progress.
10. BUG-ONB-47: expose installer cancellation through the shared Back policy,
    cancel the scoped backend operation, and compensate staged runtime state.
11. BUG-ONB-48: distinguish missing prerequisites from retryable failures and
    route Git/Node verification failures to their dedicated recovery screens.
12. BUG-ONB-49: use official `wizard.status` recovery, bound Wizard and queued
    privileged requests, preserve healthy Gateway connections, and expose
    connection phases before producing and launching a new candidate build.
13. BUG-CRA-07: align channel readiness and binding selectors with the selected
    Runtime's implicit/default-agent routing after the official Wizard, while
    preserving explicit root bindings as optional overrides.
