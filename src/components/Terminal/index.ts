export { ShellTerminalPanel } from "./ShellTerminalPanel";
export type { ShellTerminalPanelHandle } from "./ShellTerminalPanel";
export { TerminalView } from "./TerminalView";
export {
  initTerminal,
  applyTerminalThemeOnPanel,
  loadWebglAddon,
  safeFit,
  createSmartWriter,
  attachMacWebKitTerminalGuard,
  attachTerminalScrollbarAutoHide,
  applyTerminalFontSize,
  applyTerminalFontFamily,
  applyDomCharSizeOverride,
  refreshTerminalDisplay,
  themeFor,
  minimumContrastRatioFor,
  DARK_THEME,
  LIGHT_THEME,
  MIDNIGHT_THEME,
  EYECARE_THEME,
} from "./terminalShared";
export type {
  SmartWriter,
  InitTerminalResult,
  WebglAddonHandle,
  FontFamilyApplyResult,
} from "./terminalShared";
export { attachSmartCopy, smartCopy } from "./terminalCopyHelper";
export type { TerminalKeyOptions } from "./terminalCopyHelper";
export {
  attachMacWebKitShiftInputFix,
  attachLinuxIMEFix,
} from "./terminalInputFix";
export type { AppPlatform } from "./platform";
export {
  APP_PLATFORM,
  IS_MAC_WEBKIT,
  IS_OTHER_WEBKIT,
  detectAppPlatform,
  isAppleWebKit,
} from "./platform";
export type {
  XTermMeasureResult,
  XTermMeasureStrategy,
  XTermCharSizeService,
  XTermCore,
  XTermWithPrivates,
} from "./types";
