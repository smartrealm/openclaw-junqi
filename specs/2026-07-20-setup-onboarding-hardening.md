# JunQi Setup Onboarding Hardening

## SETUP-01 - Gateway handoff is a completion gate

**Current**

The official wizard can complete while the subsequent platform-service handoff
fails. The frontend logs that failure as a warning and still enters the Ready
screen, even when backend rollback also failed and no selected Gateway remains.

**Target**

Wizard completion enters Ready only after the handoff operation finishes and the
selected config token is accepted by the post-handoff Gateway. A failed handoff
or failed post-handoff probe stays in the setup recovery flow.

**Acceptance**

- [ ] Handoff errors cannot reach the Ready screen.
- [ ] A successful handoff is followed by an authenticated selected-Gateway probe.
- [ ] A restored desktop-managed Gateway may complete setup after the same probe.
- [ ] The failure remains visible and retryable without replaying wizard answers.

## SETUP-02 - Existing Gateway policy is preserved

**Current**

Every managed start replaces `gateway.bind`, `gateway.port`, and the complete
`gateway.controlUi` object. Existing remote-mode and non-token configurations
are discovered only after setup has already entered the local start path.

**Target**

Fresh configs receive JunQi's local defaults. Existing configs retain their
mode, bind, port, Control UI policy, and authentication mode. JunQi adds only
missing local bootstrap fields and fails with an actionable message when the
existing mode or auth contract is incompatible with a managed local start.

**Acceptance**

- [ ] Existing Control UI and bind values remain byte-for-byte equivalent after normalization.
- [ ] Existing remote mode is rejected before mutation.
- [ ] Existing non-token authentication is rejected before mutation.
- [ ] Fresh local configs still receive a secure generated token and loopback binding.

## SETUP-03 - Renderer cache does not retain Gateway credentials

**Current**

Setup copies the selected Gateway token into the renderer's `localStorage`.

**Target**

Setup caches only the selected URL. Connection credentials continue to resolve
from the native OpenClaw configuration boundary.

**Acceptance**

- [ ] Setup no longer writes `gatewayToken` to `localStorage`.
- [ ] Stale setup-cached tokens are removed during target refresh.
- [ ] Gateway reconnection still resolves the token from native configuration.

## SETUP-04 - Remove the unused preparation bridge

**Current**

`prepare_gateway` is registered and exported but has no caller; real setup uses
the Gateway lifecycle manager and `start_gateway`.

**Target**

The dead command and frontend wrapper are removed so there is one preparation
and startup path.

**Acceptance**

- [ ] No `prepare_gateway` command or `prepareGateway` wrapper remains.
- [ ] Native setup continues through `GatewayConnectionManager.startForSetup()`.
