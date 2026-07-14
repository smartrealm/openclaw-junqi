//! OpenClaw Control UI ("Console") window.
//!
//! The gateway's Control UI sends `X-Frame-Options: DENY` + CSP
//! `frame-ancestors 'none'`, so it cannot be embedded in an <iframe>. We open it
//! in a dedicated webview window instead and inject a floating "return to JunQi"
//! button via an initialization script (the JS `WebviewWindow` API can't inject
//! scripts, so the window is built here in Rust).

use crate::{paths, window_adaptation};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const CONTROL_UI_LABEL: &str = "control-ui";

/// Read the gateway token straight from the local OpenClaw config
/// (`~/.openclaw/openclaw.json` → gateway.auth.token).
fn read_gateway_token() -> Option<String> {
    let raw = std::fs::read_to_string(paths::config_path()).ok()?;
    let cfg: serde_json::Value = serde_json::from_str(&raw).ok()?;
    cfg.get("gateway")?
        .get("auth")?
        .get("token")?
        .as_str()
        .filter(|token| !token.trim().is_empty())
        .map(|s| s.to_string())
}

fn control_ui_url(port: u16, token: Option<String>) -> Result<url::Url, String> {
    let mut url = url::Url::parse(&format!(
        "http://{}:{}",
        crate::commands::config::default_gateway_host(),
        port
    ))
    .map_err(|e| format!("Invalid Control UI URL: {}", e))?;

    if let Some(token) = token.filter(|value| !value.is_empty()) {
        // The Control UI reads the hash with URLSearchParams. Serialize the
        // token instead of concatenating it so custom user tokens cannot
        // accidentally alter the fragment shape.
        let fragment = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("token", &token)
            .finish();
        url.set_fragment(Some(&fragment));
    }

    Ok(url)
}

/// Injected into the (remote) Control UI page: a small draggable orb that
/// snaps to the nearest viewport edge when released. Tapping / clicking it
/// returns to the JunQi Desktop main window.
const RETURN_BUTTON_SCRIPT: &str = r#"
(function () {
  if (window.__junqiReturnInjected) return;
  window.__junqiReturnInjected = true;

  var SIZE = 38;                // orb diameter (px)
  var EDGE_MARGIN = -8;        // how far it peeks *past* the edge (negative = hidden part)
  var INITIAL_X = -1;          // auto-computed from right edge
  var INITIAL_Y = -1;          // auto-computed from vertical centre
  var SNAP_DURATION = 280;     // ms for the snap-back transition

  var orb = null;
  var dragging = false;
  var startX = 0, startY = 0;
  var startLeft = 0, startTop = 0;

  // ── helpers ─────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function snapX(left) {
    var cx = left + SIZE / 2;
    return cx < window.innerWidth / 2 ? EDGE_MARGIN : window.innerWidth - SIZE - EDGE_MARGIN;
  }

  // ── mount the orb ───────────────────────────────────────
  function mount() {
    if (orb && orb.parentNode) return;
    if (!document.body) return;

    orb = document.createElement('div');
    orb.id = 'junqi-return-btn';

    // Figure out where the orb should land before any styles compute.
    var targetLeft = INITIAL_X >= 0 ? INITIAL_X : window.innerWidth - SIZE - EDGE_MARGIN;
    var targetTop  = INITIAL_Y >= 0 ? INITIAL_Y : (window.innerHeight - SIZE) / 2;

    orb.style.cssText = [
      'position:fixed', 'z-index:2147483647',
      'width:' + SIZE + 'px', 'height:' + SIZE + 'px',
      'left:' + targetLeft + 'px', 'top:' + targetTop + 'px',
      'border-radius:50%',
      'background:rgba(22,28,36,0.85)',
      'border:1px solid rgba(120,200,255,0.28)',
      '-webkit-backdrop-filter:blur(10px)',
      'backdrop-filter:blur(10px)',
      'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
      'cursor:grab',
      'display:flex', 'align-items:center', 'justify-content:center',
      'transition:left ' + SNAP_DURATION + 'ms cubic-bezier(0.22,1,0.36,1), top ' + SNAP_DURATION + 'ms cubic-bezier(0.22,1,0.36,1)',
      'user-select:none', '-webkit-user-select:none',
    ].join(';');

    orb.setAttribute('title', '返回 JunQi');

    // Inner arrow icon
    var arrow = document.createElement('span');
    arrow.style.cssText = [
      'display:block', 'color:#8bd3ff', 'font-size:18px', 'line-height:1',
      'font-family:-apple-system,system-ui,sans-serif',
      'font-weight:600', 'pointer-events:none',
    ].join(';');
    arrow.textContent = '←';
    orb.appendChild(arrow);

    // ── Hover label (slides out on mouse enter, flips side) ─
    var label = document.createElement('span');
    label.textContent = '返回 JunQi';
    label.id = 'junqi-return-label';
    label.style.cssText = [
      'position:absolute', 'top:50%',
      'transform:translateY(-50%)',
      'font:600 11px/1 -apple-system,system-ui,sans-serif',
      'color:#eaf2f8', 'background:rgba(22,28,36,0.88)',
      'border:1px solid rgba(120,200,255,0.22)', 'border-radius:999px',
      'padding:6px 10px', 'white-space:nowrap', 'pointer-events:none',
      '-webkit-backdrop-filter:blur(8px)', 'backdrop-filter:blur(8px)',
      'opacity:0', 'transition:opacity 0.12s',
    ].join(';');
    orb.appendChild(label);

    function fixLabel() {
      if (!orb || !label) return;
      var onRight = orb.offsetLeft > window.innerWidth / 2;
      label.style.left = '';
      label.style.right = '';
      if (onRight) {
        label.style.right = (SIZE + 4) + 'px';
      } else {
        label.style.left = (SIZE + 4) + 'px';
      }
    }

    orb.addEventListener('mouseenter', function () { fixLabel(); label.style.opacity = '1'; });
    orb.addEventListener('mouseleave', function () { label.style.opacity = '0'; });

    // ── Dragging ───────────────────────────────────────────
    orb.addEventListener('mousedown', onStart);
    orb.addEventListener('touchstart', onStart, { passive: false });

    orb.addEventListener('click', function (e) {
      // Ignore click if we actually dragged
      if (dragging) return;
      try { window.__TAURI_INTERNALS__.invoke('return_to_desktop'); } catch (_) {}
    });

    document.body.appendChild(orb);
    fixLabel();
  }

  function onStart(e) {
    if (e.type === 'touchstart') {
      var t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    } else {
      startX = e.clientX; startY = e.clientY;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
    }
    startLeft = orb.offsetLeft;
    startTop  = orb.offsetTop;
    dragging = false;
    orb.style.cursor = 'grabbing';
    orb.style.transition = 'none';
    e.preventDefault();
  }

  function onMove(e) {
    var cx, cy;
    if (e.type === 'touchmove') {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY;
    } else {
      cx = e.clientX; cy = e.clientY;
    }
    var dx = cx - startX;
    var dy = cy - startY;
    var nl = clamp(startLeft + dx, 0, window.innerWidth - SIZE);
    var nt = clamp(startTop + dy, 0, window.innerHeight - SIZE);
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging = true;
    orb.style.left = nl + 'px';
    orb.style.top  = nt + 'px';
  }

  function onEnd() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);

    orb.style.transition = [
      'left ' + SNAP_DURATION + 'ms cubic-bezier(0.22,1,0.36,1)',
      'top ' + SNAP_DURATION + 'ms cubic-bezier(0.22,1,0.36,1)',
    ].join(',');
    orb.style.cursor = 'grab';
    orb.style.left = snapX(orb.offsetLeft) + 'px';
    fixLabel();
    // Clear the drag flag after a tick so the next click is recognised
    setTimeout(function () { dragging = false; }, 0);
  }

  // ── bootstrap ───────────────────────────────────────────
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
  // The Control UI is a SPA that may rebuild the DOM after hydration;
  // keep the orb alive for the first ~20s.
  var tries = 0;
  var iv = setInterval(function () { mount(); if (++tries > 40) clearInterval(iv); }, 500);

  // Re-snap on window resize
  window.addEventListener('resize', function () {
    if (!orb || dragging) return;
    orb.style.transition = 'none';
    orb.style.left = snapX(orb.offsetLeft) + 'px';
    orb.style.top  = clamp(orb.offsetTop, 0, window.innerHeight - SIZE) + 'px';
    fixLabel();
  });
})();
"#;

/// Open (or focus) the Control UI window, authenticating via the token hash.
#[tauri::command]
pub async fn open_control_ui(app: AppHandle) -> Result<(), String> {
    let port = crate::commands::gateway::configured_gateway_port();
    if !crate::commands::gateway::is_gateway_serving(port).await {
        return Err(format!(
            "OpenClaw Gateway is not ready on {}:{}. Start or reconnect it before opening Control UI.",
            crate::commands::config::default_gateway_host(),
            port,
        ));
    }

    let target = control_ui_url(port, read_gateway_token())?;

    if let Some(win) = app.get_webview_window(CONTROL_UI_LABEL) {
        // Re-target only when the configured port changed. Keeping an existing
        // window on the same endpoint preserves the user's current Control UI
        // route and avoids discarding in-progress work on a simple focus click.
        let needs_navigation = win
            .url()
            .map(|current| {
                current.host_str() != Some(crate::commands::config::default_gateway_host())
                    || current.port_or_known_default() != Some(port)
            })
            .unwrap_or(true);
        if needs_navigation {
            win.navigate(target.clone())
                .map_err(|e| format!("Failed to refresh Control UI: {}", e))?;
        }
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, CONTROL_UI_LABEL, WebviewUrl::External(target))
        .title("OpenClaw Console")
        .inner_size(1280.0, 860.0)
        .min_inner_size(800.0, 600.0)
        .initialization_script(RETURN_BUTTON_SCRIPT)
        .build()
        .map_err(|e| format!("Failed to open Control UI: {}", e))?;

    // Control UI is an independent native window. Size it against its current
    // monitor's usable work area and keep it reachable across monitor/DPI changes.
    window_adaptation::initialize_transient(window);

    Ok(())
}

/// Called by the injected button: surface the main window and close the console.
#[tauri::command]
pub async fn return_to_desktop(app: AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    if let Some(console) = app.get_webview_window(CONTROL_UI_LABEL) {
        let _ = console.close();
    }
    Ok(())
}

/// Write a debug line to the temp directory (used to trace model sync).
#[tauri::command]
pub async fn write_models_log(msg: String) -> Result<(), String> {
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let line = format!("[{}] {}\n", ms, msg);
    let path = std::env::temp_dir().join("junqi-models.log");
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("open: {}", e))?
        .write_all(line.as_bytes())
        .map_err(|e| format!("write: {}", e))
}

#[cfg(test)]
mod tests {
    use super::control_ui_url;

    #[test]
    fn control_ui_url_uses_the_configured_port_and_encodes_the_token() {
        let url = control_ui_url(28123, Some("token with & separators".into())).unwrap();
        assert_eq!(url.port_or_known_default(), Some(28123));
        assert_eq!(url.fragment(), Some("token=token+with+%26+separators"));
    }
}
