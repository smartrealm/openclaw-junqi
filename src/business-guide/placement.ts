export type CoachmarkSide = 'top' | 'right' | 'bottom' | 'left' | 'center';

export interface CoachmarkPlacement {
  left: number;
  top: number;
  side: CoachmarkSide;
}

interface Size {
  width: number;
  height: number;
}

interface Rect extends Size {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const EDGE = 12;
const GAP = 14;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function getCoachmarkPlacement(
  target: Rect | null,
  viewport: Size,
  panel: Size,
): CoachmarkPlacement {
  const maximumLeft = Math.max(EDGE, viewport.width - panel.width - EDGE);
  const maximumTop = Math.max(EDGE, viewport.height - panel.height - EDGE);
  if (!target) {
    return {
      left: clamp((viewport.width - panel.width) / 2, EDGE, maximumLeft),
      top: clamp((viewport.height - panel.height) / 2, EDGE, maximumTop),
      side: 'center',
    };
  }

  const spaces = {
    bottom: viewport.height - target.bottom,
    top: target.top,
    right: viewport.width - target.right,
    left: target.left,
  };
  const fitting = (['bottom', 'top', 'right', 'left'] as const).find((side) => (
    side === 'bottom' || side === 'top'
      ? spaces[side] >= panel.height + GAP + EDGE
      : spaces[side] >= panel.width + GAP + EDGE
  ));
  const side = fitting ?? (Object.entries(spaces).sort((a, b) => b[1] - a[1])[0][0] as Exclude<CoachmarkSide, 'center'>);

  if (side === 'bottom' || side === 'top') {
    return {
      left: clamp(target.left + (target.width - panel.width) / 2, EDGE, maximumLeft),
      top: clamp(
        side === 'bottom' ? target.bottom + GAP : target.top - panel.height - GAP,
        EDGE,
        maximumTop,
      ),
      side,
    };
  }
  return {
    left: clamp(
      side === 'right' ? target.right + GAP : target.left - panel.width - GAP,
      EDGE,
      maximumLeft,
    ),
    top: clamp(target.top + (target.height - panel.height) / 2, EDGE, maximumTop),
    side,
  };
}
