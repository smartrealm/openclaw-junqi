/**
 * xterm.js 6 private API type contract (semi-public).
 *
 * Makes `_core` / `_charSizeService` / `_measureStrategy` access in
 * `terminalShared.ts`'s `applyDomCharSizeOverride()` explicitly visible —
 * more grep-able and reviewable than `as any`. Same practice: OpenSumi
 * `packages/terminal-next/src/common/xterm-private.d.ts`.
 *
 * When upgrading xterm, check (source: node_modules/@xterm/xterm/src/browser/services/CharSizeService.ts):
 *   - Does `Terminal._core._charSizeService._measureStrategy.measure()` still exist?
 *   - Are `IMeasureResult` fields still `{ width, height }`?
 *
 * Field names are not mangled in minified bundles (DI service token + class field),
 * but the xterm team does not commit to stability.
 */

import type { Terminal } from "@xterm/xterm";

export interface XTermMeasureResult {
  width: number;
  height: number;
}

export interface XTermMeasureStrategy {
  measure(): Readonly<XTermMeasureResult>;
}

export interface XTermCharSizeService {
  width: number;
  height: number;
  readonly hasValidSize: boolean;
  measure(): void;
  _measureStrategy: XTermMeasureStrategy;
}

export interface XTermCore {
  _charSizeService?: XTermCharSizeService;
}

/** Terminal with `_core` private entry — named "Private" for easy grep. */
export interface XTermWithPrivates extends Terminal {
  readonly _core: XTermCore;
}
