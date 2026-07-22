# Tauri Listener Lifecycle Bugfix

## BUG-01

Current: cleanup invokes Tauri `unlisten` as though it were synchronous.

Target: cleanup is once-only and absorbs a rejected native unlisten operation.

Acceptance:

- A disposed listener that resolves later is released exactly once.
- `listeners[eventId].handlerId` during cleanup does not produce an unhandled
  rejection.

## BUG-02

Current: selected window, terminal, and adapter listeners bypass shared
lifecycle ownership.

Target: all application event subscriptions use the common Tauri listener
boundary.

Acceptance:

- No application module imports `@tauri-apps/api/event` directly.
- Window event registrations use `subscribeTauriListener`.

## BUG-03

Current: selected background UI promises have no terminal failure handling.

Target: benign UI effects safely ignore failure; Gateway/session work maps
failure to its existing state machine/UI state.

Acceptance:

- Gateway start rejections reach `START_FAILED`.
- Startup session-load rejection marks the config stage failed.

## BUG-04

Current: a Tauri callback can return a rejected Promise that the bridge does
not await.

Target: the shared event boundary reports synchronous and asynchronous callback
failures without allowing a global unhandled rejection.

Acceptance:

- No Tauri event handler in application code is declared `async`.
- The shared boundary handles a thenable callback result.
