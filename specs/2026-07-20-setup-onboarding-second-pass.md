# JunQi Setup Onboarding Second-Pass Specification

## CREDENTIAL-01 - Endpoint-scoped credentials

**Acceptance**

- [ ] A selected config or runtime change cannot reuse another endpoint's token.
- [ ] Native config resolution outranks stale volatile renderer state.
- [ ] Paired device tokens are stored in the OS credential vault by canonical
      WebSocket endpoint.
- [ ] Legacy `gatewayToken` values are migrated once and removed from all
      renderer localStorage keys.
- [ ] Saving a credential cannot discard a custom Gateway URL or port.

## LIFECYCLE-01 - Fail-closed official handoff

**Acceptance**

- [ ] Service inspection failures cannot return Ready.
- [ ] Foreign or unverifiable installed services are never mutated or accepted.
- [ ] Existing bind and port values are either compatible with the requested
      managed runtime or rejected before mutation.
- [ ] Required Tauri origins are merged into existing Control UI policy.
- [ ] Fresh configs do not disable device authentication or enable insecure auth.
- [ ] Raw tokens, environment substitutions, and official SecretRefs are handled
      without converting a reference into stored plaintext.

## ONBOARDING-01 - Observable completion

**Acceptance**

- [ ] `wizard.lastRunAt` alone never proves onboarding completion.
- [ ] A configured primary model is verified through a bounded official CLI probe
      before setup enters Ready.
- [ ] Probe failure routes back to guided configuration without losing the
      running selected Gateway.
- [ ] A missing terminal Wizard session reconciles configuration and model
      readiness before starting a replacement session.

## WIZARD-UI-01 - Official authentication actions

**Acceptance**

- [ ] `externalUrl` opens in the system browser.
- [ ] A structured device code is visible and copyable.
- [ ] Expiry and status information remain visible without changing Gateway text.
- [ ] Existing note and action steps remain unchanged when optional fields are
      absent.

## CLEANUP-01 - One preparation owner

**Acceptance**

- [ ] No private or exported `prepare_gateway` implementation remains.
- [ ] Setup startup continues exclusively through the Gateway lifecycle manager.

