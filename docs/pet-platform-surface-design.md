# Pet Platform Surface Design

## Goal

Keep the desktop companion readable over arbitrary wallpapers on macOS and
modern Windows, while retaining a frameless transparent companion on Windows
7 without relying on WebView transparency.

## Surface Contract

The pet domain publishes one platform-neutral state stream:

```
PetState -> PetSurface.render(state)
PetPosition -> PetBackdropSampler.read(position) -> PetBackdropReading
```

`PetBackdropReading` contains only derived values (`luminance`, `contrast`,
and availability). Raw screen pixels and screenshots never cross IPC or reach
the webview.

The frontend resolves the reading to a caption palette with an accessible
foreground, outline, and minimal background. It samples after a move settles
and at a bounded idle interval, never per animation frame.

## Platform Backends

| Platform | Pet surface | Backdrop source | Fallback |
| --- | --- | --- | --- |
| macOS | Existing transparent WebView | CoreGraphics in-memory capture / Screen Recording permission | Fixed high-contrast palette when denied |
| Windows 10+ | Existing transparent WebView | Desktop DC region sampling | Fixed high-contrast palette when unavailable |
| Windows 7 | Unsupported host OS | N/A | Require Windows 10+; a native pet window cannot make the WebView2 host supported |
| Linux | Existing WebView | No capture in first release | Fixed high-contrast palette |

## Windows 7 Support Boundary

JunQi uses Tauri/WebView2 as its application host. Microsoft ended supported
WebView2/Edge servicing for Windows 7 with Edge 109 in February 2023. A native
layered pet window would not make the rest of the WebView2 application secure
or supported, so Windows 7 is not a supported JunQi target.

Supporting a legacy Win7 build would require a separately maintained,
security-exception release policy with a frozen WebView2 runtime and a full
application compatibility test matrix. It must not be introduced as an
implicit fallback for the current release channel.

## Privacy And Permission

macOS sampling is opt-in and requests Screen Recording permission through the
normal system flow. Sampling uses a small ring around the caption rather than
the pet window, discards pixels immediately, and persists no captures. A
denied or unavailable source is a normal state, not an error.

## Acceptance

- Windows 7 is identified as outside the supported runtime policy before a
  user is promised a compatible desktop experience.
- macOS and Windows 10+ captions switch palette from derived contrast data.
- Denied macOS permission remains usable with a fixed accessible palette.
- No raw desktop image is emitted, persisted, logged, or exposed over IPC.
- WebView and native surfaces consume the same pet state transitions.
