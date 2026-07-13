# Adaptive Window Controller Specification

## BUG-WIN-01 - Recover size and position

**Current**: only the inner size is adjusted.

**Target**: calculate the expected decorated outer rectangle and recover it into the selected monitor work area when resized, off-screen, or using the primary-monitor fallback.

**Acceptance**:

- [x] A window restored outside all monitors is centered on the primary work area.
- [x] A window moved from a large display to a smaller one fits completely.
- [x] A deliberately positioned window that remains meaningfully visible is preserved.

## BUG-WIN-02 - Transactional first-run marker

**Current**: the marker is written even when native adaptation fails.

**Target**: write the marker only after monitor selection, native constraints and the adaptation plan succeed.

**Acceptance**:

- [x] Failure leaves the marker absent so the next launch retries.
- [x] Marker-write failure is observable without preventing application startup.

## BUG-WIN-03 - Bounded event processing

**Current**: each `Moved` event executes native work synchronously.

**Target**: enqueue display-context changes into a bounded channel and apply once after a quiet debounce period.

**Acceptance**:

- [x] Event callbacks never execute monitor or sizing operations.
- [x] A move burst results in one final adaptation pass.

## BUG-WIN-04 - Physical DPI model

**Current**: monitor and window logical scales are mixed.

**Target**: plan entirely in physical pixels and use monitor scale only to convert comfort limits.

**Acceptance**:

- [x] Equivalent logical monitors at 100% and 150% produce equivalent logical plans.
- [x] Negative Windows monitor coordinates remain valid.

## BUG-WIN-05 - Error observability

**Current**: native results are discarded.

**Target**: adaptation returns a typed outcome or actionable error and background failures are logged with context.

**Acceptance**:

- [x] No native sizing, positioning or marker result is silently discarded.

## BUG-WIN-06 - Regression coverage

**Acceptance**:

- [x] Tests cover normal laptop, 4K, mixed DPI, off-screen fallback, negative origins, decoration extents and already-visible preservation.

## BUG-WIN-07 - Larger JunQi main window

**Current**: the preferred width is 76% of the monitor work area, the large-display cap is 1600x1000, and restored small windows are preserved indefinitely.

**Target**: new installations open around 86% x 88% of the monitor work area with an 1800x1120 cap. Existing installations receive a one-time growth-only migration; user windows already above either preferred dimension are never reduced in that dimension.

**Acceptance**:

- [x] The static Tauri fallback is 1440x900.
- [x] A 1920x1040 work area plans a substantially larger main window than the old policy.
- [x] Upgrade mode grows an undersized restored window to the preferred size.
- [x] Upgrade mode preserves dimensions already larger than the preference.
- [x] Preserve mode remains unchanged after the versioned migration.
- [x] A maximized launch does not consume the migration marker.

## Validation

- Rust formatting: `cargo fmt --check`
- Rust tests: 213 passed, 2 ignored
- Release build: `npx tauri build --bundles dmg`
- Disk image verification: `hdiutil verify`
