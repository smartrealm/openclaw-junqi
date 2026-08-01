# OpenClaw Gateway Service Ownership Validation

Date: 2026-07-24

## Result

All locally executable acceptance checks passed. The fix covers package/service
installation boundaries, service ownership discovery, normal lifecycle actions,
Wizard/autostart handoff, update and storage restore, Native/Docker switching,
application exit, and uninstall cleanup.

## Login Autostart Contract

The Desktop autostart preference is a Native-runtime-only wrapper around the
currently installed OpenClaw CLI's official `gateway install`, `status`, and
`uninstall` commands. It is not a JunQi application-login preference.

- macOS uses an OpenClaw LaunchAgent and starts after the current user signs
  in. It does not mean the Gateway runs before any user has logged in.
- Windows uses an OpenClaw Scheduled Task with a LogonTrigger and starts after
  the configured user signs in. If Task Scheduler is unavailable, the upstream
  CLI may use its documented Startup-folder fallback.
- JunQi returns `enabled` only after it re-attests that the installed service
  belongs to the selected state directory, configuration path, runtime, and
  locale. It separately returns `running`, so the UI never represents a
  registered-but-stopped service as already working.
- Docker does not expose this preference. JunQi never silently converts a
  Docker selection into a Native login service.

The macOS status probe was verified on 2026-08-01 against OpenClaw 2026.7.1-2:
the selected LaunchAgent was loaded and its runtime status was running. Windows
has compile and command-contract coverage, but a Windows user-login cold-start
test remains required before claiming target-machine validation.

## Evidence

| Layer | Command | Result |
| --- | --- | --- |
| Rust formatting | `cargo fmt -- --check` | Passed |
| Rust interfaces | `cargo check --lib` | Passed |
| Rust full suite | `cargo test --lib -q` | 598 passed, 3 ignored, 0 failed |
| TypeScript interfaces | `pnpm exec tsc --noEmit` | Passed |
| Gateway/setup regression | targeted Node test command | 83 passed, 0 failed |
| Frontend full suite | first stage of `pnpm test` | 1545 passed, 0 failed |
| Script full suite | second stage of `pnpm test` | 216 passed, 0 failed |
| Module boundaries | `pnpm run check:boundaries` | 544 files clean |
| Patch hygiene | `git diff --check` | Passed |
| Obsolete-symbol scan | `rg` over Rust/frontend sources | No live matches |

The full frontend suite emits existing Radix server-rendering
`useLayoutEffect` warnings; it exits successfully and the warnings are outside
this Gateway ownership change.

## Windows Boundary

The current validation host is macOS and does not provide `rustup`, so a local
Windows-target build and a real Scheduled Task cold start were not run here.
The Windows acceptance run should verify these observable outcomes:

1. With the selected OpenClaw Scheduled Task installed but stopped, launch
   JunQi. It should log that the installed selected service is being used; it
   must not log `Launching the OpenClaw Gateway process`.
2. Allow up to 210 seconds for a first cold start. The reported 85-second start
   is inside this contract and must not trigger a managed-child fallback.
3. `openclaw gateway status` should show the selected service listening on
   `127.0.0.1:18789`; JunQi should record SystemService ownership and no child
   PID.
4. Simulate a service inspection/start error. JunQi should surface the error
   and must not launch a competing foreground Gateway.
5. Disable autostart. The selected service should be uninstalled before exactly
   one desktop-managed Gateway is started.
