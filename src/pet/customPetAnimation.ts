import type { PetEmotion } from './pet-states';

export const PET_ATLAS_COLUMNS = 8;
export const PET_ATLAS_ROWS = 11;
export const PET_CELL_WIDTH = 192;
export const PET_CELL_HEIGHT = 208;
export const PET_DISPLAY_CELL_WIDTH = 96;
export const PET_DISPLAY_CELL_HEIGHT = 104;

export interface PetAnimationTrack {
  row: number;
  durations: readonly number[];
  loop: boolean;
}

const TRACKS = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320], loop: true },
  right: { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220], loop: true },
  left: { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220], loop: true },
  waving: { row: 3, durations: [140, 140, 140, 280], loop: true },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280], loop: false },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240], loop: false },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260], loop: true },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220], loop: true },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280], loop: true },
} as const satisfies Record<string, PetAnimationTrack>;

export function animationTrackForPet(input: {
  emotion: PetEmotion;
  dragging: boolean;
  hovered: boolean;
  walkDir: number;
}): PetAnimationTrack {
  if (input.dragging) return input.walkDir < 0 ? TRACKS.left : TRACKS.right;
  if (input.hovered) return TRACKS.waving;

  switch (input.emotion) {
    case 'error': return TRACKS.failed;
    case 'celebrate':
    case 'swallow':
    case 'rapidSwallow': return TRACKS.jumping;
    case 'thinking': return TRACKS.waiting;
    case 'working':
    case 'typing':
    case 'tool':
    case 'memory': return TRACKS.running;
    case 'happy': return TRACKS.review;
    case 'drag':
    case 'overdrag': return input.walkDir < 0 ? TRACKS.left : TRACKS.right;
    default: return TRACKS.idle;
  }
}

export function lookCellForVector(dx: number, dy: number): { row: 9 | 10; column: number } | null {
  if (Math.hypot(dx, dy) < 8) return null;
  const clockwiseFromUp = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const index = Math.round(clockwiseFromUp / 22.5) % 16;
  return index < 8 ? { row: 9, column: index } : { row: 10, column: index - 8 };
}

export function frameAtElapsed(track: PetAnimationTrack, elapsedMs: number): number {
  const total = track.durations.reduce((sum, duration) => sum + duration, 0);
  const cursor = track.loop ? elapsedMs % total : Math.min(elapsedMs, total - 1);
  let consumed = 0;
  for (let index = 0; index < track.durations.length; index += 1) {
    consumed += track.durations[index];
    if (cursor < consumed) return index;
  }
  return track.durations.length - 1;
}

export function spriteBackgroundGeometry(row: number, column: number) {
  return {
    width: PET_DISPLAY_CELL_WIDTH,
    height: PET_DISPLAY_CELL_HEIGHT,
    backgroundSize: `${PET_ATLAS_COLUMNS * PET_DISPLAY_CELL_WIDTH}px ${PET_ATLAS_ROWS * PET_DISPLAY_CELL_HEIGHT}px`,
    backgroundPosition: `${-column * PET_DISPLAY_CELL_WIDTH}px ${-row * PET_DISPLAY_CELL_HEIGHT}px`,
  } as const;
}
