const COMFORTABLE_MIN_WIDTH: f64 = 960.0;
const COMFORTABLE_MIN_HEIGHT: f64 = 640.0;
const ABSOLUTE_MIN_WIDTH: f64 = 560.0;
const ABSOLUTE_MIN_HEIGHT: f64 = 420.0;
const INITIAL_WIDTH_RATIO: f64 = 0.76;
const INITIAL_HEIGHT_RATIO: f64 = 0.82;
const SCREEN_MARGIN_RATIO: f64 = 0.94;
const INITIAL_MAX_WIDTH: f64 = 1600.0;
const INITIAL_MAX_HEIGHT: f64 = 1000.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct WindowSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct AdaptiveWindowSizing {
    pub minimum: WindowSize,
    pub initial: WindowSize,
    pub maximum_visible: WindowSize,
}

pub(crate) fn sizing_for_work_area(width: f64, height: f64) -> AdaptiveWindowSizing {
    let width = width.max(1.0);
    let height = height.max(1.0);
    let maximum_visible = WindowSize {
        width: width * SCREEN_MARGIN_RATIO,
        height: height * SCREEN_MARGIN_RATIO,
    };
    let minimum = WindowSize {
        width: COMFORTABLE_MIN_WIDTH
            .min(maximum_visible.width)
            .max(ABSOLUTE_MIN_WIDTH.min(maximum_visible.width)),
        height: COMFORTABLE_MIN_HEIGHT
            .min(maximum_visible.height)
            .max(ABSOLUTE_MIN_HEIGHT.min(maximum_visible.height)),
    };
    let initial = WindowSize {
        width: (width * INITIAL_WIDTH_RATIO)
            .clamp(minimum.width, INITIAL_MAX_WIDTH.min(maximum_visible.width)),
        height: (height * INITIAL_HEIGHT_RATIO).clamp(
            minimum.height,
            INITIAL_MAX_HEIGHT.min(maximum_visible.height),
        ),
    };

    AdaptiveWindowSizing {
        minimum,
        initial,
        maximum_visible,
    }
}

pub(crate) fn fit_restored_size(restored: WindowSize, sizing: AdaptiveWindowSizing) -> WindowSize {
    WindowSize {
        width: restored
            .width
            .clamp(sizing.minimum.width, sizing.maximum_visible.width),
        height: restored
            .height
            .clamp(sizing.minimum.height, sizing.maximum_visible.height),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_laptop_uses_available_height_without_exceeding_it() {
        let sizing = sizing_for_work_area(1366.0, 728.0);

        assert_eq!(sizing.minimum.width, 960.0);
        assert_eq!(sizing.minimum.height, 640.0);
        assert!(sizing.initial.width <= sizing.maximum_visible.width);
        assert!(sizing.initial.height <= sizing.maximum_visible.height);
    }

    #[test]
    fn first_launch_is_bounded_on_large_displays() {
        let sizing = sizing_for_work_area(3840.0, 2120.0);

        assert_eq!(sizing.initial.width, INITIAL_MAX_WIDTH);
        assert_eq!(sizing.initial.height, INITIAL_MAX_HEIGHT);
        assert_eq!(sizing.minimum.width, COMFORTABLE_MIN_WIDTH);
        assert_eq!(sizing.minimum.height, COMFORTABLE_MIN_HEIGHT);
    }

    #[test]
    fn restored_window_shrinks_when_moved_to_a_smaller_display() {
        let sizing = sizing_for_work_area(1280.0, 680.0);
        let fitted = fit_restored_size(
            WindowSize {
                width: 1600.0,
                height: 1000.0,
            },
            sizing,
        );

        assert_eq!(fitted, sizing.maximum_visible);
    }

    #[test]
    fn restored_user_size_is_preserved_when_it_already_fits() {
        let sizing = sizing_for_work_area(1920.0, 1040.0);
        let restored = WindowSize {
            width: 1180.0,
            height: 760.0,
        };

        assert_eq!(fit_restored_size(restored, sizing), restored);
    }
}
