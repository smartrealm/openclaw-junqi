//! Privacy-preserving desktop backdrop sampling for the companion window.
//!
//! Platform implementations receive only a small region that is guaranteed to
//! sit outside the pet window. They derive brightness statistics in memory and
//! return those statistics only; source pixels never cross IPC, are logged, or
//! written to disk.

use serde::Serialize;
use tauri::{AppHandle, Manager};

const SAMPLE_MARGIN_PX: i64 = 12;
const SAMPLE_WIDTH_PX: i64 = 16;
const SAMPLE_MAX_HEIGHT_PX: i64 = 52;
const SAMPLE_TOP_INSET_PX: i64 = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetBackdropReading {
    pub available: bool,
    pub luminance: Option<f64>,
    pub contrast: Option<f64>,
    pub reason: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DesktopRect {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

impl DesktopRect {
    fn right(self) -> i64 {
        self.x + self.width
    }

    fn bottom(self) -> i64 {
        self.y + self.height
    }

    fn contains(self, candidate: Self) -> bool {
        candidate.x >= self.x
            && candidate.y >= self.y
            && candidate.right() <= self.right()
            && candidate.bottom() <= self.bottom()
    }
}

#[derive(Debug, Clone, Copy)]
struct PetWindowGeometry {
    window: DesktopRect,
    monitor: DesktopRect,
}

impl PetWindowGeometry {
    fn capture_region(self) -> Option<DesktopRect> {
        let height = self.window.height.min(SAMPLE_MAX_HEIGHT_PX);
        if height <= 0 || self.window.width <= 0 || !self.monitor.contains(self.window) {
            return None;
        }
        let y = (self.window.y + SAMPLE_TOP_INSET_PX)
            .clamp(self.monitor.y, self.monitor.bottom() - height);
        let left = DesktopRect {
            x: self.window.x - SAMPLE_MARGIN_PX - SAMPLE_WIDTH_PX,
            y,
            width: SAMPLE_WIDTH_PX,
            height,
        };
        let right = DesktopRect {
            x: self.window.right() + SAMPLE_MARGIN_PX,
            y,
            width: SAMPLE_WIDTH_PX,
            height,
        };

        // Prefer the left side to keep the caption lighting stable as users
        // drag vertically. At a monitor edge, choose the available opposite
        // side rather than ever sampling the pet's own transparent surface.
        [left, right]
            .into_iter()
            .find(|candidate| self.monitor.contains(*candidate))
    }
}

fn unavailable(reason: &'static str) -> PetBackdropReading {
    PetBackdropReading {
        available: false,
        luminance: None,
        contrast: None,
        reason,
    }
}

fn relative_luminance(red: u8, green: u8, blue: u8) -> f64 {
    fn linear(channel: u8) -> f64 {
        let value = channel as f64 / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    }
    0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

fn reading_from_luminance(luminance: impl Iterator<Item = f64>) -> Option<(f64, f64)> {
    let (count, sum, sum_of_squares) = luminance.fold((0_u64, 0.0, 0.0), |state, value| {
        (state.0 + 1, state.1 + value, state.2 + value * value)
    });
    if count == 0 {
        return None;
    }
    let mean = sum / count as f64;
    let variance = (sum_of_squares / count as f64 - mean * mean).max(0.0);
    Some((mean, variance.sqrt()))
}

#[cfg(any(windows, test))]
fn reading_from_bgra(bytes: &[u8]) -> Option<(f64, f64)> {
    reading_from_luminance(
        bytes
            .chunks_exact(4)
            .map(|pixel| relative_luminance(pixel[2], pixel[1], pixel[0])),
    )
}

fn reading_from_bgra_rows(
    bytes: &[u8],
    width: usize,
    height: usize,
    row_bytes: usize,
) -> Option<(f64, f64)> {
    if width == 0 || height == 0 || row_bytes < width.saturating_mul(4) {
        return None;
    }
    reading_from_luminance((0..height).flat_map(|row| {
        let start = row.saturating_mul(row_bytes);
        let end = start.saturating_add(width.saturating_mul(4));
        bytes
            .get(start..end)
            .unwrap_or_default()
            .chunks_exact(4)
            .map(|pixel| relative_luminance(pixel[2], pixel[1], pixel[0]))
    }))
}

fn reading_from_geometry(geometry: PetWindowGeometry) -> Result<DesktopRect, PetBackdropReading> {
    geometry
        .capture_region()
        .ok_or_else(|| unavailable("unavailable"))
}

fn pet_window_geometry(app: &AppHandle) -> Result<PetWindowGeometry, PetBackdropReading> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| unavailable("unavailable"))?;
    let position = window
        .outer_position()
        .map_err(|_| unavailable("unavailable"))?;
    let size = window
        .outer_size()
        .map_err(|_| unavailable("unavailable"))?;
    let monitor = window
        .current_monitor()
        .map_err(|_| unavailable("unavailable"))?
        .ok_or_else(|| unavailable("unavailable"))?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    Ok(PetWindowGeometry {
        window: DesktopRect {
            x: i64::from(position.x),
            y: i64::from(position.y),
            width: i64::from(size.width),
            height: i64::from(size.height),
        },
        monitor: DesktopRect {
            x: i64::from(monitor_position.x),
            y: i64::from(monitor_position.y),
            width: i64::from(monitor_size.width),
            height: i64::from(monitor_size.height),
        },
    })
}

#[cfg(target_os = "macos")]
fn macos_reading(region: DesktopRect) -> PetBackdropReading {
    use core_graphics::{
        geometry::{CGPoint, CGRect, CGSize},
        window::{
            create_image, kCGNullWindowID, kCGWindowImageBestResolution,
            kCGWindowListOptionOnScreenOnly,
        },
    };

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }

    // Avoid an implicit prompt from a background refresh. Permission is a
    // normal capability state; the user can grant it through macOS settings.
    if unsafe { !CGPreflightScreenCaptureAccess() } {
        return unavailable("permission-denied");
    }
    let bounds = CGRect::new(
        &CGPoint::new(region.x as f64, region.y as f64),
        &CGSize::new(region.width as f64, region.height as f64),
    );
    let Some(image) = create_image(
        bounds,
        kCGWindowListOptionOnScreenOnly,
        kCGNullWindowID,
        kCGWindowImageBestResolution,
    ) else {
        return unavailable("unavailable");
    };
    if image.bits_per_pixel() != 32 || image.bits_per_component() != 8 {
        return unavailable("unavailable");
    }
    let image_data = image.data();
    match reading_from_bgra_rows(
        image_data.bytes(),
        image.width(),
        image.height(),
        image.bytes_per_row(),
    ) {
        Some((luminance, contrast)) => PetBackdropReading {
            available: true,
            luminance: Some(luminance),
            contrast: Some(contrast),
            reason: "available",
        },
        None => unavailable("unavailable"),
    }
}

#[cfg(windows)]
fn windows_reading(region: DesktopRect) -> PetBackdropReading {
    use std::ffi::c_void;
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, SRCCOPY,
    };

    let (Ok(x), Ok(y), Ok(width), Ok(height)) = (
        i32::try_from(region.x),
        i32::try_from(region.y),
        i32::try_from(region.width),
        i32::try_from(region.height),
    ) else {
        return unavailable("unavailable");
    };
    unsafe {
        let screen_dc = GetDC(std::ptr::null_mut());
        if screen_dc.is_null() {
            return unavailable("unavailable");
        }
        let memory_dc = CreateCompatibleDC(screen_dc);
        if memory_dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return unavailable("unavailable");
        }
        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.is_null() {
            DeleteDC(memory_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return unavailable("unavailable");
        }
        let original_bitmap = SelectObject(memory_dc, bitmap);
        let copied = BitBlt(
            memory_dc,
            0,
            0,
            width,
            height,
            screen_dc,
            x,
            y,
            SRCCOPY | CAPTUREBLT,
        );
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..Default::default()
        };
        let mut pixels = vec![0_u8; width as usize * height as usize * 4];
        let read = if copied != 0 {
            GetDIBits(
                memory_dc,
                bitmap,
                0,
                height as u32,
                pixels.as_mut_ptr().cast::<c_void>(),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        SelectObject(memory_dc, original_bitmap);
        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);
        if read != height {
            return unavailable("unavailable");
        }
        match reading_from_bgra(&pixels) {
            Some((luminance, contrast)) => PetBackdropReading {
                available: true,
                luminance: Some(luminance),
                contrast: Some(contrast),
                reason: "available",
            },
            None => unavailable("unavailable"),
        }
    }
}

fn platform_reading(region: DesktopRect) -> PetBackdropReading {
    #[cfg(target_os = "macos")]
    {
        macos_reading(region)
    }
    #[cfg(windows)]
    {
        windows_reading(region)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = region;
        unavailable("unsupported")
    }
}

#[tauri::command]
pub async fn get_pet_backdrop_reading(app: AppHandle) -> PetBackdropReading {
    let region = match pet_window_geometry(&app).and_then(reading_from_geometry) {
        Ok(region) => region,
        Err(reading) => return reading,
    };
    tokio::task::spawn_blocking(move || platform_reading(region))
        .await
        .unwrap_or_else(|_| unavailable("unavailable"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry(window: DesktopRect) -> PetWindowGeometry {
        PetWindowGeometry {
            window,
            monitor: DesktopRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        }
    }

    #[test]
    fn capture_region_prefers_left_and_never_intersects_pet() {
        let source = geometry(DesktopRect {
            x: 600,
            y: 800,
            width: 108,
            height: 154,
        });
        let region = source.capture_region().unwrap();
        assert!(source.monitor.contains(region));
        assert!(region.right() <= source.window.x);
    }

    #[test]
    fn capture_region_uses_right_edge_when_pet_is_left_aligned() {
        let source = geometry(DesktopRect {
            x: 0,
            y: 800,
            width: 108,
            height: 154,
        });
        let region = source.capture_region().unwrap();
        assert!(region.x >= source.window.right());
        assert!(source.monitor.contains(region));
    }

    #[test]
    fn luminance_is_ordered_and_contrast_is_non_negative() {
        assert!(relative_luminance(0, 0, 0) < relative_luminance(255, 255, 255));
        let reading = reading_from_luminance([0.0, 1.0].into_iter()).unwrap();
        assert!(reading.1 >= 0.0);
    }

    #[test]
    fn bgra_reading_uses_the_expected_channel_order() {
        let blue = reading_from_bgra(&[255, 0, 0, 0]).unwrap().0;
        let red = reading_from_bgra(&[0, 0, 255, 0]).unwrap().0;
        assert!(red > blue);
    }

    #[test]
    fn strided_bgra_ignores_padding_bytes() {
        let reading = reading_from_bgra_rows(&[0, 0, 255, 0, 99, 99, 99, 99], 1, 1, 8).unwrap();
        assert_eq!(reading.0, relative_luminance(255, 0, 0));
    }
}
