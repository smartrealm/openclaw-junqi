# First-run onboarding bugfix specification

## BUG-ONB-01 - Detection cancellation

**Current:** Detection commits transitions after the user leaves the step.

**Target:** Effect cleanup invalidates every late detection result.

**Acceptance:** Back navigation cannot be overwritten by a stale detection.

## BUG-ONB-02 - Storage lifecycle

**Current:** Storage callbacks can advance an unmounted step, and Back remains
available during configuration.

**Target:** Only a mounted storage step may update UI or invoke `onReady`; Back
is disabled while applying.

**Acceptance:** Leaving storage never causes a later automatic transition.

## BUG-ONB-03 - Ready navigation

**Current:** Ready always returns to the native install-complete step.

**Target:** Ready exposes only the final Enter workspace command.

**Acceptance:** Docker and existing-runtime flows cannot enter native startup
from the completion page.

## BUG-ONB-04 - Update onboarding gate

**Current:** A reachable Gateway after update always enters ready.

**Target:** Required onboarding enters `configure-openclaw`; configured users
enter ready.

**Acceptance:** Updating cannot skip required model/provider configuration.

## BUG-ONB-05 - Docker keyboard interaction

**Current:** Docker selection uses a clickable `div`.

**Target:** Selection uses a focusable native button without nested buttons.

**Acceptance:** Keyboard users can focus and activate Docker when available.
