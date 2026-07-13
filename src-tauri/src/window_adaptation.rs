use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::window_sizing::{
    self, PhysicalPosition, PhysicalRect, PhysicalSize, SizingMode, WindowSnapshot,
};

const EVENT_DEBOUNCE: Duration = Duration::from_millis(180);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AdaptationOutcome {
    Applied,
    Unchanged,
}

pub(crate) fn initialize(window: tauri::WebviewWindow, first_run_marker: PathBuf) {
    let is_first_run = !first_run_marker.exists();
    let mode = if is_first_run {
        SizingMode::Initial
    } else {
        SizingMode::Preserve
    };
    match adapt(&window, mode) {
        Ok(_) if is_first_run => {
            if let Err(error) = persist_first_run_marker(&first_run_marker) {
                eprintln!(
                    "[window-adaptation] cannot persist first-run marker at {}: {}",
                    first_run_marker.display(),
                    error
                );
            }
        }
        Ok(_) => {}
        Err(error) => eprintln!("[window-adaptation] initial adaptation failed: {error}"),
    }
    start_event_controller(window);
}

fn persist_first_run_marker(marker: &Path) -> Result<(), String> {
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "cannot create marker directory {}: {error}",
                parent.display()
            )
        })?;
    }
    std::fs::write(marker, "1")
        .map_err(|error| format!("cannot write marker {}: {error}", marker.display()))
}

fn adapt(window: &tauri::WebviewWindow, mode: SizingMode) -> Result<AdaptationOutcome, String> {
    let current_monitor = window
        .current_monitor()
        .map_err(|error| format!("cannot query current monitor: {error}"))?;
    let monitor_is_fallback = current_monitor.is_none();
    let monitor = match current_monitor {
        Some(monitor) => monitor,
        None => window
            .primary_monitor()
            .map_err(|error| format!("cannot query primary monitor: {error}"))?
            .ok_or_else(|| "no active monitor is available".to_string())?,
    };
    let work_area = monitor.work_area();
    let inner_size = window
        .inner_size()
        .map_err(|error| format!("cannot query inner window size: {error}"))?;
    let outer_size = window
        .outer_size()
        .map_err(|error| format!("cannot query outer window size: {error}"))?;
    let outer_position = window
        .outer_position()
        .map_err(|error| format!("cannot query outer window position: {error}"))?;
    let maximized = window
        .is_maximized()
        .map_err(|error| format!("cannot query maximized state: {error}"))?;
    let plan = window_sizing::plan_window_adjustment(
        WindowSnapshot {
            work_area: PhysicalRect {
                position: PhysicalPosition {
                    x: work_area.position.x,
                    y: work_area.position.y,
                },
                size: PhysicalSize {
                    width: work_area.size.width,
                    height: work_area.size.height,
                },
            },
            inner_size: PhysicalSize {
                width: inner_size.width,
                height: inner_size.height,
            },
            outer_size: PhysicalSize {
                width: outer_size.width,
                height: outer_size.height,
            },
            outer_position: PhysicalPosition {
                x: outer_position.x,
                y: outer_position.y,
            },
            monitor_scale_factor: monitor.scale_factor(),
            monitor_is_fallback,
            maximized,
        },
        mode,
    )
    .map_err(|error| format!("cannot plan window adaptation: {error}"))?;

    window
        .set_min_size(Some(tauri::PhysicalSize::new(
            plan.minimum_inner_size.width,
            plan.minimum_inner_size.height,
        )))
        .map_err(|error| format!("cannot set minimum window size: {error}"))?;
    if let Some(size) = plan.target_inner_size {
        window
            .set_size(tauri::PhysicalSize::new(size.width, size.height))
            .map_err(|error| format!("cannot resize main window: {error}"))?;
    }
    if let Some(position) = plan.target_outer_position {
        window
            .set_position(tauri::PhysicalPosition::new(position.x, position.y))
            .map_err(|error| format!("cannot reposition main window: {error}"))?;
    }

    if plan.target_inner_size.is_some() || plan.target_outer_position.is_some() {
        Ok(AdaptationOutcome::Applied)
    } else {
        Ok(AdaptationOutcome::Unchanged)
    }
}

fn start_event_controller(window: tauri::WebviewWindow) {
    let (event_tx, event_rx) = tokio::sync::mpsc::channel::<()>(1);
    let worker_window = window.clone();
    tauri::async_runtime::spawn(run_debounced(event_rx, EVENT_DEBOUNCE, move || {
        if let Err(error) = adapt(&worker_window, SizingMode::Preserve) {
            eprintln!("[window-adaptation] {error}");
        }
    }));

    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
                | tauri::WindowEvent::Focused(true)
        ) {
            match event_tx.try_send(()) {
                Ok(()) | Err(tokio::sync::mpsc::error::TrySendError::Full(())) => {}
                Err(tokio::sync::mpsc::error::TrySendError::Closed(())) => {
                    eprintln!("[window-adaptation] event worker is no longer available");
                }
            }
        }
    });
}

async fn run_debounced<F>(
    mut events: tokio::sync::mpsc::Receiver<()>,
    quiet_period: Duration,
    mut action: F,
) where
    F: FnMut(),
{
    while events.recv().await.is_some() {
        loop {
            match tokio::time::timeout(quiet_period, events.recv()).await {
                Ok(Some(())) => continue,
                Ok(None) => return,
                Err(_) => break,
            }
        }
        action();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::*;

    #[tokio::test]
    async fn move_event_burst_runs_one_adaptation_after_quiet_period() {
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        let calls = Arc::new(AtomicUsize::new(0));
        let worker_calls = Arc::clone(&calls);
        let worker = tokio::spawn(run_debounced(rx, Duration::from_millis(20), move || {
            worker_calls.fetch_add(1, Ordering::SeqCst);
        }));

        tx.send(()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(5)).await;
        tx.send(()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(5)).await;
        tx.send(()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(35)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        tx.send(()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(35)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        drop(tx);
        worker.await.unwrap();
    }

    #[test]
    fn marker_persistence_creates_parent_and_writes_only_requested_path() {
        let root = std::env::temp_dir().join(format!(
            "junqi-window-marker-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let marker = root.join("nested").join("initialized");

        persist_first_run_marker(&marker).unwrap();

        assert_eq!(std::fs::read_to_string(&marker).unwrap(), "1");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn marker_persistence_failure_leaves_marker_absent() {
        let root = std::env::temp_dir().join(format!(
            "junqi-window-marker-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let blocking_file = root.join("not-a-directory");
        std::fs::write(&blocking_file, "x").unwrap();
        let marker = blocking_file.join("initialized");

        assert!(persist_first_run_marker(&marker).is_err());
        assert!(!marker.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
