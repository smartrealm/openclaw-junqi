//! Privacy-preserving backdrop contrast for the desktop companion.
//!
//! The command returns only derived brightness statistics. Source pixels are
//! held in memory just long enough to calculate the reading and are never
//! emitted, logged, or persisted.

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetBackdropReading {
    pub available: bool,
    pub luminance: Option<f64>,
    pub contrast: Option<f64>,
    pub reason: &'static str,
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

fn reading_from_rgba(bytes: &[u8]) -> Option<(f64, f64)> {
    let samples: Vec<f64> = bytes
        .chunks_exact(4)
        .filter(|pixel| pixel[3] > 0)
        .map(|pixel| relative_luminance(pixel[0], pixel[1], pixel[2]))
        .collect();
    if samples.is_empty() {
        return None;
    }
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    let variance = samples
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / samples.len() as f64;
    Some((mean, variance.sqrt()))
}

fn reading_from_bgra(bytes: &[u8]) -> Option<(f64, f64)> {
    let mut rgba = Vec::with_capacity(bytes.len());
    for pixel in bytes.chunks_exact(4) {
        rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
    }
    reading_from_rgba(&rgba)
}

#[cfg(target_os = "macos")]
fn macos_reading(app: &AppHandle) -> PetBackdropReading {
    use std::process::Command;
    let Some(window) = app.get_webview_window("pet") else {
        return unavailable("unavailable");
    };
    let Ok(position) = window.outer_position() else {
        return unavailable("unavailable");
    };
    let Ok(size) = window.outer_size() else {
        return unavailable("unavailable");
    };
    // Capture a narrow strip beside the caption rather than the pet itself.
    let x = position.x.saturating_sub(18);
    let y = position.y.saturating_add(8);
    let rect = format!("{x},{y},16,{}", size.height.min(52));
    let path =
        std::env::temp_dir().join(format!("junqi-pet-backdrop-{}.png", uuid::Uuid::new_v4()));
    let output = match Command::new("screencapture")
        .args(["-x", "-t", "png", "-R", &rect])
        .arg(&path)
        .output()
    {
        Ok(output) => output,
        Err(_) => return unavailable("unavailable"),
    };
    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
    if stderr.contains("not authorized") || stderr.contains("not permitted") {
        return unavailable("permission-denied");
    }
    let bytes = std::fs::read(&path).ok();
    let _ = std::fs::remove_file(&path);
    let Some(bytes) = bytes else {
        return unavailable("unavailable");
    };
    let Ok(image) = image::load_from_memory(&bytes) else {
        return unavailable("unavailable");
    };
    let rgba = image.to_rgba8();
    match reading_from_rgba(rgba.as_raw()) {
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
fn windows_reading(app: &AppHandle) -> PetBackdropReading {
    use std::ffi::c_void;
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, SRCCOPY,
    };

    let Some(window) = app.get_webview_window("pet") else {
        return unavailable("unavailable");
    };
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return unavailable("unavailable");
    };
    let width = 16_i32;
    let height = i32::try_from(size.height.min(52)).unwrap_or(0);
    if height <= 0 {
        return unavailable("unavailable");
    }
    let x = position.x.saturating_sub(18);
    let y = position.y.saturating_add(8);

    // The desktop DC yields BGRA pixels. Keep the capture local: it is reduced
    // to luminance/contrast before this command returns.
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
            // A negative height requests top-down rows, avoiding any row reversal.
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

fn platform_reading(app: &AppHandle) -> PetBackdropReading {
    #[cfg(target_os = "macos")]
    {
        return macos_reading(app);
    }
    #[cfg(windows)]
    {
        return windows_reading(app);
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        unavailable("unsupported")
    }
}

#[tauri::command]
pub async fn get_pet_backdrop_reading(app: AppHandle) -> PetBackdropReading {
    tokio::task::spawn_blocking(move || platform_reading(&app))
        .await
        .unwrap_or_else(|_| unavailable("unavailable"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn luminance_is_ordered_and_contrast_is_non_negative() {
        let dark = relative_luminance(0, 0, 0);
        let light = relative_luminance(255, 255, 255);
        assert!(dark < light);
        let reading = reading_from_rgba(&[0, 0, 0, 255, 255, 255, 255, 255]).unwrap();
        assert!(reading.1 >= 0.0);
    }

    #[test]
    fn bgra_reading_uses_the_expected_channel_order() {
        let blue = reading_from_bgra(&[255, 0, 0, 0]).unwrap().0;
        let red = reading_from_bgra(&[0, 0, 255, 0]).unwrap().0;
        assert!(red > blue);
    }
}
