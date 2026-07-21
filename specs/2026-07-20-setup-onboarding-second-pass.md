# JunQi Setup Onboarding Second-Pass Specification

## CREDENTIAL-01 - Endpoint-scoped credentials

**Acceptance**

- [x] A selected config or runtime change cannot reuse another endpoint's token.
- [x] Native config resolution outranks stale volatile renderer state.
- [x] Paired device tokens are stored in the OS credential vault by canonical
      WebSocket endpoint.
- [x] Legacy `gatewayToken` values are migrated once and removed from all
      renderer localStorage keys.
- [x] Saving a credential cannot discard a custom Gateway URL or port.

## LIFECYCLE-01 - Fail-closed official handoff

**Acceptance**

- [x] Service inspection failures cannot return Ready.
- [x] Foreign or unverifiable installed services are never mutated or accepted.
- [x] Existing bind and port values are either compatible with the requested
      managed runtime or rejected before mutation.
- [x] Required Tauri origins are merged into existing Control UI policy.
- [x] Fresh configs do not disable device authentication or enable insecure auth.
- [x] Raw tokens, environment substitutions, and official SecretRefs are handled
      without converting a reference into stored plaintext.

## ONBOARDING-01 - Observable completion

**Acceptance**

- [x] `wizard.lastRunAt` alone never proves onboarding completion.
- [x] A configured primary model is verified through a bounded official CLI probe
      before setup enters Ready.
- [x] Probe failure routes back to guided configuration without losing the
      running selected Gateway.
- [x] A missing terminal Wizard session reconciles configuration and model
      readiness before starting a replacement session.

## WIZARD-UI-01 - Official authentication actions

**Acceptance**

- [x] `externalUrl` opens in the system browser.
- [x] A structured device code is visible and copyable.
- [x] Expiry and status information remain visible without changing Gateway text.
- [x] Existing note and action steps remain unchanged when optional fields are
      absent.

## CLEANUP-01 - One preparation owner

**Acceptance**

- [x] No private or exported `prepare_gateway` implementation remains.
- [x] Setup startup continues exclusively through the Gateway lifecycle manager.
