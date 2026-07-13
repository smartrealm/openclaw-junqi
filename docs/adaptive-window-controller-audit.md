# Adaptive Window Controller Audit

## Findings

### BUG-WIN-01 - Critical - Window size is corrected without recovering its position

The current adapter can shrink a restored window but never clamps or recenters its outer position. After an external Windows display is disconnected, the main window can remain outside every active work area.

### BUG-WIN-02 - Critical - Failed first-run adaptation is marked complete

Native monitor and window calls discard errors, while the initialization marker is written unconditionally. A transient startup failure therefore permanently skips first-run adaptation.

### BUG-WIN-03 - Medium - Every move event performs synchronous native work

Windows emits many `Moved` events while a window is dragged. The current listener performs monitor, DPI, constraint and size calls for every event, which can cause visible drag latency.

### BUG-WIN-04 - Medium - Cross-DPI calculations mix monitor and window scale factors

`Moved` and `ScaleFactorChanged` ordering is platform-dependent. Mixing the destination monitor scale with the window's previous scale can produce a transient incorrect resize while crossing 100%, 125% or 150% Windows displays.

### BUG-WIN-05 - Medium - Native failures are silent

Constraint, size, centering and marker-write results are ignored. Production diagnostics cannot distinguish a policy decision from an operating-system failure.

### BUG-WIN-06 - Medium - Tests cover ratios but not window topology

Existing tests do not cover negative monitor origins, decoration extents, off-screen recovery, DPI invariance or position preservation.

## Target architecture

- Pure physical-pixel planner for deterministic Windows DPI behavior.
- One snapshot containing monitor work area, inner/outer size and outer position.
- One plan containing minimum size, optional target size and optional target position.
- One debounced event worker per main window with a bounded channel.
- Explicit native `Result` propagation and first-run marker written only after success.
