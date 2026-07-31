# Windows Cargo Offline Prefetch Plan

## Scope

Repair the shared dependency preparation step used by CI and desktop release
workflows. Do not remove offline verification from downstream build commands.

## Steps

1. Keep the locked target fetch as the lightweight first phase.
2. Add a locked all-target check in the online warm-up phase so Cargo resolves
   Windows host build dependencies as well as target dependencies.
3. Strip inherited offline and frozen flags only inside the warm-up environment.
4. Cover the command sequence, retry behavior, and workflow offline boundary
   with script tests.
5. Validate the changed scripts locally, then validate the Windows matrix after
   the change is pushed.
