export type TerminalToolCallPillVariant = 'full' | 'identifier' | 'icon';

export interface TerminalToolCallPillMeasurements {
  availableWidth: number | null;
  fullWidth: number | null;
  identifierWidth: number | null;
}

/**
 * Mirrors Kooky's ViewThatFits order with measurements from the rendered
 * variants. A long tool name or identifier therefore changes the threshold
 * naturally instead of relying on a pane-wide magic number.
 */
export function selectTerminalToolCallPillVariant(
  measurements: TerminalToolCallPillMeasurements,
): TerminalToolCallPillVariant {
  const { availableWidth, fullWidth, identifierWidth } = measurements;
  if (
    availableWidth === null
    || fullWidth === null
    || identifierWidth === null
    || !Number.isFinite(availableWidth)
    || !Number.isFinite(fullWidth)
    || !Number.isFinite(identifierWidth)
  ) {
    return 'full';
  }
  if (availableWidth >= fullWidth) return 'full';
  if (availableWidth >= identifierWidth) return 'identifier';
  return 'icon';
}
