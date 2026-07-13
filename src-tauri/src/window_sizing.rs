const COMFORTABLE_MIN_WIDTH: f64 = 960.0;
const COMFORTABLE_MIN_HEIGHT: f64 = 640.0;
const INITIAL_WIDTH_RATIO: f64 = 0.76;
const INITIAL_HEIGHT_RATIO: f64 = 0.82;
const SCREEN_MARGIN_RATIO: f64 = 0.94;
const INITIAL_MAX_WIDTH: f64 = 1600.0;
const INITIAL_MAX_HEIGHT: f64 = 1000.0;
const MIN_DRAGGABLE_WIDTH: i64 = 120;
const TITLE_BAR_HEIGHT: i64 = 48;
const MIN_TITLE_BAR_VISIBLE_HEIGHT: i64 = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PhysicalSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PhysicalPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PhysicalRect {
    pub position: PhysicalPosition,
    pub size: PhysicalSize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct WindowSnapshot {
    pub work_area: PhysicalRect,
    pub inner_size: PhysicalSize,
    pub outer_size: PhysicalSize,
    pub outer_position: PhysicalPosition,
    pub monitor_scale_factor: f64,
    pub monitor_is_fallback: bool,
    pub maximized: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SizingMode {
    Initial,
    Preserve,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WindowAdjustment {
    pub minimum_inner_size: PhysicalSize,
    pub target_inner_size: Option<PhysicalSize>,
    pub target_outer_position: Option<PhysicalPosition>,
}

pub(crate) fn plan_window_adjustment(
    snapshot: WindowSnapshot,
    mode: SizingMode,
) -> Result<WindowAdjustment, &'static str> {
    if !snapshot.monitor_scale_factor.is_finite() || snapshot.monitor_scale_factor <= 0.0 {
        return Err("monitor scale factor must be finite and positive");
    }
    if snapshot.work_area.size.width == 0 || snapshot.work_area.size.height == 0 {
        return Err("monitor work area must be non-empty");
    }

    let frame = PhysicalSize {
        width: snapshot
            .outer_size
            .width
            .saturating_sub(snapshot.inner_size.width),
        height: snapshot
            .outer_size
            .height
            .saturating_sub(snapshot.inner_size.height),
    };
    let maximum_outer = PhysicalSize {
        width: ratio(snapshot.work_area.size.width, SCREEN_MARGIN_RATIO),
        height: ratio(snapshot.work_area.size.height, SCREEN_MARGIN_RATIO),
    };
    let maximum_inner = PhysicalSize {
        width: maximum_outer.width.saturating_sub(frame.width).max(1),
        height: maximum_outer.height.saturating_sub(frame.height).max(1),
    };
    let minimum_inner_size = PhysicalSize {
        width: logical_to_physical(COMFORTABLE_MIN_WIDTH, snapshot.monitor_scale_factor)
            .min(maximum_inner.width),
        height: logical_to_physical(COMFORTABLE_MIN_HEIGHT, snapshot.monitor_scale_factor)
            .min(maximum_inner.height),
    };

    if snapshot.maximized {
        return Ok(WindowAdjustment {
            minimum_inner_size,
            target_inner_size: None,
            target_outer_position: None,
        });
    }

    let desired_inner = match mode {
        SizingMode::Initial => PhysicalSize {
            width: initial_dimension(
                snapshot.work_area.size.width,
                frame.width,
                minimum_inner_size.width,
                maximum_inner.width,
                INITIAL_WIDTH_RATIO,
                logical_to_physical(INITIAL_MAX_WIDTH, snapshot.monitor_scale_factor),
            ),
            height: initial_dimension(
                snapshot.work_area.size.height,
                frame.height,
                minimum_inner_size.height,
                maximum_inner.height,
                INITIAL_HEIGHT_RATIO,
                logical_to_physical(INITIAL_MAX_HEIGHT, snapshot.monitor_scale_factor),
            ),
        },
        SizingMode::Preserve => PhysicalSize {
            width: snapshot
                .inner_size
                .width
                .clamp(minimum_inner_size.width, maximum_inner.width),
            height: snapshot
                .inner_size
                .height
                .clamp(minimum_inner_size.height, maximum_inner.height),
        },
    };
    let resized = desired_inner != snapshot.inner_size;
    let desired_outer = PhysicalSize {
        width: desired_inner.width.saturating_add(frame.width),
        height: desired_inner.height.saturating_add(frame.height),
    };

    let desired_position = if mode == SizingMode::Initial || snapshot.monitor_is_fallback {
        center_in_work_area(snapshot.work_area, desired_outer)
    } else if resized || !title_bar_is_reachable(snapshot) {
        clamp_to_work_area(snapshot.outer_position, desired_outer, snapshot.work_area)
    } else {
        snapshot.outer_position
    };

    Ok(WindowAdjustment {
        minimum_inner_size,
        target_inner_size: resized.then_some(desired_inner),
        target_outer_position: (desired_position != snapshot.outer_position)
            .then_some(desired_position),
    })
}

fn logical_to_physical(logical: f64, scale_factor: f64) -> u32 {
    (logical * scale_factor).round().clamp(1.0, u32::MAX as f64) as u32
}

fn ratio(value: u32, factor: f64) -> u32 {
    ((value as f64) * factor)
        .floor()
        .clamp(1.0, u32::MAX as f64) as u32
}

fn initial_dimension(
    work_area: u32,
    frame: u32,
    minimum: u32,
    maximum: u32,
    ratio_value: f64,
    cap: u32,
) -> u32 {
    ratio(work_area, ratio_value)
        .saturating_sub(frame)
        .clamp(minimum, maximum.min(cap).max(minimum))
}

fn center_in_work_area(work_area: PhysicalRect, outer_size: PhysicalSize) -> PhysicalPosition {
    PhysicalPosition {
        x: saturating_i32(
            work_area.position.x as i64
                + (work_area.size.width as i64 - outer_size.width as i64) / 2,
        ),
        y: saturating_i32(
            work_area.position.y as i64
                + (work_area.size.height as i64 - outer_size.height as i64) / 2,
        ),
    }
}

fn clamp_to_work_area(
    position: PhysicalPosition,
    outer_size: PhysicalSize,
    work_area: PhysicalRect,
) -> PhysicalPosition {
    let min_x = work_area.position.x as i64;
    let min_y = work_area.position.y as i64;
    let max_x = min_x + work_area.size.width as i64 - outer_size.width as i64;
    let max_y = min_y + work_area.size.height as i64 - outer_size.height as i64;
    PhysicalPosition {
        x: saturating_i32((position.x as i64).clamp(min_x, max_x.max(min_x))),
        y: saturating_i32((position.y as i64).clamp(min_y, max_y.max(min_y))),
    }
}

fn title_bar_is_reachable(snapshot: WindowSnapshot) -> bool {
    let window_left = snapshot.outer_position.x as i64;
    let window_top = snapshot.outer_position.y as i64;
    let window_right = window_left + snapshot.outer_size.width as i64;
    let title_bottom = window_top + TITLE_BAR_HEIGHT.min(snapshot.outer_size.height as i64);
    let work_left = snapshot.work_area.position.x as i64;
    let work_top = snapshot.work_area.position.y as i64;
    let work_right = work_left + snapshot.work_area.size.width as i64;
    let work_bottom = work_top + snapshot.work_area.size.height as i64;
    let visible_width = window_right.min(work_right) - window_left.max(work_left);
    let visible_height = title_bottom.min(work_bottom) - window_top.max(work_top);

    visible_width >= MIN_DRAGGABLE_WIDTH && visible_height >= MIN_TITLE_BAR_VISIBLE_HEIGHT
}

fn saturating_i32(value: i64) -> i32 {
    value.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> WindowSnapshot {
        WindowSnapshot {
            work_area: PhysicalRect {
                position: PhysicalPosition { x: 0, y: 0 },
                size: PhysicalSize {
                    width: 1920,
                    height: 1040,
                },
            },
            inner_size: PhysicalSize {
                width: 1180,
                height: 760,
            },
            outer_size: PhysicalSize {
                width: 1196,
                height: 799,
            },
            outer_position: PhysicalPosition { x: 200, y: 120 },
            monitor_scale_factor: 1.0,
            monitor_is_fallback: false,
            maximized: false,
        }
    }

    #[test]
    fn normal_laptop_preserves_a_visible_user_size() {
        let plan = plan_window_adjustment(snapshot(), SizingMode::Preserve).unwrap();

        assert_eq!(
            plan.minimum_inner_size,
            PhysicalSize {
                width: 960,
                height: 640
            }
        );
        assert_eq!(plan.target_inner_size, None);
        assert_eq!(plan.target_outer_position, None);
    }

    #[test]
    fn first_launch_is_centered_and_bounded_on_4k() {
        let mut input = snapshot();
        input.work_area.size = PhysicalSize {
            width: 3840,
            height: 2080,
        };
        input.outer_position = PhysicalPosition { x: 0, y: 0 };
        input.inner_size = PhysicalSize {
            width: 1280,
            height: 800,
        };
        input.outer_size = PhysicalSize {
            width: 1296,
            height: 839,
        };

        let plan = plan_window_adjustment(input, SizingMode::Initial).unwrap();

        assert_eq!(
            plan.target_inner_size,
            Some(PhysicalSize {
                width: 1600,
                height: 1000
            })
        );
        assert_eq!(
            plan.target_outer_position,
            Some(PhysicalPosition { x: 1112, y: 520 })
        );
    }

    #[test]
    fn large_window_shrinks_and_moves_inside_a_smaller_display() {
        let mut input = snapshot();
        input.work_area.size = PhysicalSize {
            width: 1280,
            height: 680,
        };
        input.inner_size = PhysicalSize {
            width: 1600,
            height: 1000,
        };
        input.outer_size = PhysicalSize {
            width: 1616,
            height: 1039,
        };
        input.outer_position = PhysicalPosition { x: 900, y: 300 };

        let plan = plan_window_adjustment(input, SizingMode::Preserve).unwrap();

        assert_eq!(
            plan.target_inner_size,
            Some(PhysicalSize {
                width: 1187,
                height: 600
            })
        );
        assert_eq!(
            plan.target_outer_position,
            Some(PhysicalPosition { x: 77, y: 41 })
        );
    }

    #[test]
    fn offscreen_fallback_centers_on_primary_work_area() {
        let mut input = snapshot();
        input.work_area.position = PhysicalPosition { x: 0, y: 40 };
        input.outer_position = PhysicalPosition { x: 5000, y: -2000 };
        input.monitor_is_fallback = true;

        let plan = plan_window_adjustment(input, SizingMode::Preserve).unwrap();

        assert_eq!(plan.target_inner_size, None);
        assert_eq!(
            plan.target_outer_position,
            Some(PhysicalPosition { x: 362, y: 160 })
        );
    }

    #[test]
    fn negative_origin_monitor_coordinates_are_preserved() {
        let mut input = snapshot();
        input.work_area.position = PhysicalPosition { x: -1920, y: 0 };
        input.outer_position = PhysicalPosition { x: -1700, y: 100 };

        let plan = plan_window_adjustment(input, SizingMode::Preserve).unwrap();

        assert_eq!(plan.target_outer_position, None);
    }

    #[test]
    fn unreachable_title_bar_is_recovered_even_when_size_fits() {
        let mut input = snapshot();
        input.outer_position = PhysicalPosition { x: 200, y: -100 };

        let plan = plan_window_adjustment(input, SizingMode::Preserve).unwrap();

        assert_eq!(
            plan.target_outer_position,
            Some(PhysicalPosition { x: 200, y: 0 })
        );
    }

    #[test]
    fn equivalent_100_and_150_percent_displays_have_equal_logical_plans() {
        let base = snapshot();
        let base_plan = plan_window_adjustment(base, SizingMode::Initial).unwrap();
        let scaled = WindowSnapshot {
            work_area: PhysicalRect {
                position: PhysicalPosition { x: 0, y: 0 },
                size: PhysicalSize {
                    width: 2880,
                    height: 1560,
                },
            },
            inner_size: PhysicalSize {
                width: 1770,
                height: 1140,
            },
            outer_size: PhysicalSize {
                width: 1794,
                height: 1199,
            },
            outer_position: PhysicalPosition { x: 300, y: 180 },
            monitor_scale_factor: 1.5,
            monitor_is_fallback: false,
            maximized: false,
        };
        let scaled_plan = plan_window_adjustment(scaled, SizingMode::Initial).unwrap();

        let base_size = base_plan.target_inner_size.unwrap();
        let scaled_size = scaled_plan.target_inner_size.unwrap();
        assert!((scaled_size.width as f64 / 1.5 - base_size.width as f64).abs() <= 1.0);
        assert!((scaled_size.height as f64 / 1.5 - base_size.height as f64).abs() <= 1.0);
    }

    #[test]
    fn maximized_window_only_updates_minimum_constraints() {
        let mut input = snapshot();
        input.maximized = true;

        let plan = plan_window_adjustment(input, SizingMode::Preserve).unwrap();

        assert_eq!(plan.target_inner_size, None);
        assert_eq!(plan.target_outer_position, None);
    }

    #[test]
    fn invalid_monitor_metrics_are_rejected() {
        let mut input = snapshot();
        input.monitor_scale_factor = f64::NAN;
        assert!(plan_window_adjustment(input, SizingMode::Preserve).is_err());

        input.monitor_scale_factor = 1.0;
        input.work_area.size.width = 0;
        assert!(plan_window_adjustment(input, SizingMode::Preserve).is_err());
    }
}
