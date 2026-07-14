# First-run onboarding audit

## Critical

### BUG-ONB-01 - Stale environment detection overrides Back navigation

`useSetupFlow` starts asynchronous detection without invalidating it when the
user leaves the detecting step. A late result can move the user to storage.

### BUG-ONB-02 - Storage work commits navigation after the step is left

Storage status and configuration promises call `onReady` after unmount, and
Back remains enabled while a storage transaction is applying.

## Medium

### BUG-ONB-03 - Ready Back action loses the runtime branch

The ready page always returns to `install-complete`. Docker and existing-runtime
flows can then invoke the native Gateway start path.

### BUG-ONB-04 - Update completion can bypass required onboarding

The stopped-Gateway update callback navigates directly to ready whenever the
Gateway is reachable, without consulting `needsOnboarding`.

### BUG-ONB-05 - Docker selection is not keyboard operable

The Docker mode action is attached to a `div`, so keyboard users cannot focus
or activate it.
