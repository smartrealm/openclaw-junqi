/**
 * Pure geometry helpers for the pet's magnetic edge-snap. Kept side-effect-free
 * (no window/store/invoke access) so they are trivially unit-testable; the
 * PetWindow component owns the IO (reading position/bounds, animating).
 */

/** Logical bounds of a monitor: top-left corner + size, in logical pixels. */
export interface PetBounds {
  monX: number;
  monY: number;
  monW: number;
  monH: number;
}

/** A pet's logical position + size. */
export interface PetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** easeOutCubic: fast start, gentle settle — reads as a natural glide. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Nearest-edge snap target for `pos` within `bounds`, or `null` when the pet's
 * center is farther than `threshold` from every edge (i.e. mid-screen — leave
 * it alone). Only the axis of the nearest edge changes; the other is preserved.
 */
export function computeSnapTarget(
  pos: PetRect,
  bounds: PetBounds,
  threshold: number,
  margin: number,
): { x: number; y: number } | null {
  const cx = pos.x + pos.w / 2;
  const cy = pos.y + pos.h / 2;
  const dLeft = cx - bounds.monX;
  const dRight = bounds.monX + bounds.monW - cx;
  const dTop = cy - bounds.monY;
  const dBottom = bounds.monY + bounds.monH - cy;
  const nearest = Math.min(dLeft, dRight, dTop, dBottom);
  if (nearest > threshold) return null;

  let { x, y } = pos;
  if (nearest === dLeft) x = bounds.monX + margin;
  else if (nearest === dRight) x = bounds.monX + bounds.monW - pos.w - margin;
  else if (nearest === dTop) y = bounds.monY + margin;
  else y = bounds.monY + bounds.monH - pos.h - margin;
  return { x, y };
}
