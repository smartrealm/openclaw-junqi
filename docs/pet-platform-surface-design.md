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
| macOS | Existing transparent WebView | System screen-capture command / Screen Recording permission | Fixed high-contrast palette when denied |
| Windows 10+ | Existing transparent WebView | Desktop DC region sampling | Fixed high-contrast palette when unavailable |
| Windows 7 | Win32 per-pixel layered window | Desktop DC region sampling | Native high-contrast caption; never a transparent WebView |
| Linux | Existing WebView | No capture in first release | Fixed high-contrast palette |

## Windows 7 Renderer

The Win7 backend owns a `WS_EX_LAYERED | WS_EX_TOOLWINDOW` window and updates
it through `UpdateLayeredWindow` with premultiplied-alpha BGRA frames. It must
not create the Tauri pet WebView. The backend receives the same `PetState`,
position, visibility, drag and context-menu commands as the WebView backend.

The renderer caches decoded sprite frames and caption glyph bitmaps. It redraws
only on state, frame, position, caption, or backdrop-style changes. Hit testing
uses the alpha mask so clicks through transparent pixels reach the desktop.

## Privacy And Permission

macOS sampling is opt-in and requests Screen Recording permission through the
normal system flow. Sampling uses a small ring around the caption rather than
the pet window, discards pixels immediately, and persists no captures. A
denied or unavailable source is a normal state, not an error.

## Acceptance

- Win7 never creates a transparent WebView pet window.
- Win7 companion uses per-pixel alpha with no black rectangle.
- macOS and Windows 10+ captions switch palette from derived contrast data.
- Denied macOS permission remains usable with a fixed accessible palette.
- No raw desktop image is emitted, persisted, logged, or exposed over IPC.
- WebView and native surfaces consume the same pet state transitions.
