export const CHAT_SIDE_PANEL_DEFAULT_WIDTH = 720;
export const CHAT_SIDE_PANEL_MIN_WIDTH = 340;
export const CHAT_SIDE_PANEL_MAX_WIDTH = 1100;
const CHAT_SIDE_PANEL_MAX_SHARE = 0.7;

export function maximumChatSidePanelWidth(containerWidth?: number): number {
  if (!containerWidth || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return CHAT_SIDE_PANEL_MAX_WIDTH;
  }
  return Math.max(
    CHAT_SIDE_PANEL_MIN_WIDTH,
    Math.min(CHAT_SIDE_PANEL_MAX_WIDTH, Math.floor(containerWidth * CHAT_SIDE_PANEL_MAX_SHARE)),
  );
}

export function clampChatSidePanelWidth(width: number, containerWidth?: number): number {
  const maximum = maximumChatSidePanelWidth(containerWidth);
  return Math.min(maximum, Math.max(CHAT_SIDE_PANEL_MIN_WIDTH, Math.round(width)));
}
