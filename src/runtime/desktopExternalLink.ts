export type DesktopExternalLinkKind = 'web' | 'contact' | 'dingtalk';

export interface DesktopExternalLink {
  href: string;
  kind: DesktopExternalLinkKind;
}

export type DesktopExternalLinkFailureCode =
  | 'unsupported'
  | 'desktop-required'
  | 'open-failed';

export class DesktopExternalLinkError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: DesktopExternalLinkFailureCode,
    cause?: unknown,
  ) {
    super(code);
    this.name = 'DesktopExternalLinkError';
    this.cause = cause;
  }
}

interface DesktopExternalLinkDependencies {
  isDesktopRuntime?: () => boolean;
  openDesktop?: (href: string) => Promise<void>;
  openBrowser?: (href: string) => void;
}

const DINGTALK_HOST = 'dingtalkclient';
const DINGTALK_PATHS = new Set(['/action/openapp', '/page/link']);
const EXPLICIT_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ENCODED_LINE_BREAK_PATTERN = /%(?:0a|0d)/i;

function hasUnsafeCharacters(value: string): boolean {
  return CONTROL_CHARACTER_PATTERN.test(value) || ENCODED_LINE_BREAK_PATTERN.test(value);
}

function isSafeDingTalkUrl(url: URL): boolean {
  if (
    url.protocol !== 'dingtalk:'
    || url.hostname !== DINGTALK_HOST
    || !DINGTALK_PATHS.has(url.pathname)
    || url.username
    || url.password
    || url.search.length <= 1
  ) {
    return false;
  }

  if (url.pathname !== '/page/link') return true;
  const nestedUrl = url.searchParams.get('url');
  if (!nestedUrl) return false;
  try {
    return new URL(nestedUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

export function hasExplicitExternalScheme(value: string): boolean {
  return EXPLICIT_SCHEME_PATTERN.test(value.trim());
}

export function resolveDesktopExternalLink(value: string): DesktopExternalLink | null {
  const href = value.trim();
  if (!href || hasUnsafeCharacters(href)) return null;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.username || url.password) return null;
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { href, kind: 'web' };
  }
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') {
    return { href, kind: 'contact' };
  }
  if (isSafeDingTalkUrl(url)) {
    return { href, kind: 'dingtalk' };
  }
  return null;
}

function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const internals = (window as Window & {
    __TAURI_INTERNALS__?: { transformCallback?: unknown; invoke?: unknown };
  }).__TAURI_INTERNALS__;
  return typeof internals?.transformCallback === 'function'
    && typeof internals?.invoke === 'function';
}

async function openWithDesktop(href: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(href);
}

function openWithBrowser(href: string): void {
  window.open(href, '_blank', 'noopener,noreferrer');
}

export async function openDesktopExternalLink(
  value: string,
  dependencies: DesktopExternalLinkDependencies = {},
): Promise<void> {
  const target = resolveDesktopExternalLink(value);
  if (!target) throw new DesktopExternalLinkError('unsupported');

  const desktop = dependencies.isDesktopRuntime?.() ?? isDesktopRuntime();
  if (desktop) {
    try {
      await (dependencies.openDesktop ?? openWithDesktop)(target.href);
      return;
    } catch (cause) {
      throw new DesktopExternalLinkError('open-failed', cause);
    }
  }

  if (target.kind === 'dingtalk') {
    throw new DesktopExternalLinkError('desktop-required');
  }
  try {
    (dependencies.openBrowser ?? openWithBrowser)(target.href);
  } catch (cause) {
    throw new DesktopExternalLinkError('open-failed', cause);
  }
}
