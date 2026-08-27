use std::fmt;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow, WindowEvent};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MainWindowToggleAction {
    Hide,
    Restore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MainWindowLifecycleError {
    Missing,
    Operation {
        operation: &'static str,
        message: String,
    },
}

impl MainWindowLifecycleError {
    fn operation(operation: &'static str, error: impl fmt::Display) -> Self {
        Self::Operation {
            operation,
            message: error.to_string(),
        }
    }
}

impl fmt::Display for MainWindowLifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing => formatter.write_str("主窗口不存在，无法完成窗口操作"),
            Self::Operation { operation, message } => {
                write!(formatter, "主窗口{operation}失败: {message}")
            }
        }
    }
}

impl std::error::Error for MainWindowLifecycleError {}

fn toggle_action(visible: bool, minimized: bool) -> MainWindowToggleAction {
    if visible && !minimized {
        MainWindowToggleAction::Hide
    } else {
        MainWindowToggleAction::Restore
    }
}

fn exit_application_on_main_close(prevent_close: impl FnOnce(), exit: impl FnOnce()) {
    prevent_close();
    exit();
}

fn require_main_window<T>(window: Option<T>) -> Result<T, MainWindowLifecycleError> {
    window.ok_or(MainWindowLifecycleError::Missing)
}

pub(crate) fn install_close_to_exit<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let app = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            // 主窗口红色关闭表示退出整个桌面应用，避免仅保留宠物或托盘窗口。
            exit_application_on_main_close(|| api.prevent_close(), || app.exit(0));
        }
    });
}

pub(crate) fn restore_main_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), MainWindowLifecycleError> {
    let window = require_main_window(app.get_webview_window(MAIN_WINDOW_LABEL))?;

    #[cfg(target_os = "macos")]
    app.show()
        .map_err(|error| MainWindowLifecycleError::operation("显示应用", error))?;

    window
        .unminimize()
        .map_err(|error| MainWindowLifecycleError::operation("取消最小化", error))?;
    window
        .show()
        .map_err(|error| MainWindowLifecycleError::operation("显示", error))?;
    window
        .set_focus()
        .map_err(|error| MainWindowLifecycleError::operation("聚焦", error))
}

pub(crate) fn toggle_main_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), MainWindowLifecycleError> {
    let window = require_main_window(app.get_webview_window(MAIN_WINDOW_LABEL))?;
    let visible = window
        .is_visible()
        .map_err(|error| MainWindowLifecycleError::operation("读取可见状态", error))?;
    let minimized = window
        .is_minimized()
        .map_err(|error| MainWindowLifecycleError::operation("读取最小化状态", error))?;

    match toggle_action(visible, minimized) {
        MainWindowToggleAction::Hide => window
            .hide()
            .map_err(|error| MainWindowLifecycleError::operation("隐藏", error)),
        MainWindowToggleAction::Restore => restore_main_window(app),
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    #[test]
    fn close_request_prevents_window_destroy_then_exits_application() {
        let events = RefCell::new(Vec::new());

        exit_application_on_main_close(
            || events.borrow_mut().push("prevent_close"),
            || events.borrow_mut().push("exit"),
        );

        assert_eq!(events.into_inner(), vec!["prevent_close", "exit"]);
    }

    #[test]
    fn minimized_or_hidden_window_always_uses_restore_path() {
        assert_eq!(toggle_action(true, false), MainWindowToggleAction::Hide);
        assert_eq!(toggle_action(true, true), MainWindowToggleAction::Restore);
        assert_eq!(toggle_action(false, false), MainWindowToggleAction::Restore);
    }

    #[test]
    fn restore_reports_missing_main_window() {
        assert_eq!(
            require_main_window::<()>(None),
            Err(MainWindowLifecycleError::Missing)
        );
    }
}
