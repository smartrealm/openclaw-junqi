use base64::{engine::general_purpose::STANDARD, Engine as _};
use qrcode::{types::Color, QrCode};

const MAX_PROVIDER_QR_CONTENT_LENGTH: usize = 16 * 1024;

/// Render an opaque QR payload returned by the selected OpenClaw Runtime.
/// The content is never fetched or executed; it is only encoded as SVG locally.
#[tauri::command]
pub fn render_local_qr_data_url(content: String) -> Result<String, String> {
    let content = content.trim();
    if content.is_empty()
        || content.len() > MAX_PROVIDER_QR_CONTENT_LENGTH
        || content.chars().any(char::is_control)
    {
        return Err("QR content is not a valid provider payload.".into());
    }
    qr_svg_data_url(content).map_err(|_| {
        "Could not render the channel QR code. Please refresh the login session.".into()
    })
}

fn qr_svg_data_url(content: &str) -> Result<String, String> {
    let code = QrCode::new(content.as_bytes()).map_err(|error| error.to_string())?;
    let quiet_zone = 4usize;
    let width = code.width();
    let canvas = width + quiet_zone * 2;
    let mut path = String::with_capacity(width * width * 12);
    for y in 0..width {
        for x in 0..width {
            if code[(x, y)] == Color::Dark {
                let x = x + quiet_zone;
                let y = y + quiet_zone;
                path.push_str(&format!("M{x} {y}h1v1H{x}z"));
            }
        }
    }
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas} {canvas}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h{canvas}v{canvas}H0z"/><path d="{path}"/></svg>"##
    );
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        STANDARD.encode(svg)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_accepts_bounded_opaque_runtime_payloads() {
        assert!(render_local_qr_data_url("https://example.com/link".into()).is_ok());
        assert!(render_local_qr_data_url("provider://link?uuid=test".into()).is_ok());
        assert!(render_local_qr_data_url("opaque\nprovider-payload".into()).is_err());
        assert!(render_local_qr_data_url("x".repeat(MAX_PROVIDER_QR_CONTENT_LENGTH + 1)).is_err());
    }
}
