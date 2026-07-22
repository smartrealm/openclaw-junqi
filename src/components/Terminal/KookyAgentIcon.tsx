import type { CSSProperties, ReactNode } from 'react';
import { TerminalSquare } from 'lucide-react';

// Vite emits these as fingerprinted assets, while Node test workers retain a
// harmless file URL instead of trying to execute a PNG module.
const amp = new URL('../../assets/kooky/icons/amp.png', import.meta.url).href;
const antigravity = new URL('../../assets/kooky/icons/antigravity.png', import.meta.url).href;
const claude = new URL('../../assets/kooky/icons/claudecode.png', import.meta.url).href;
const codex = new URL('../../assets/kooky/icons/codex.png', import.meta.url).href;
const cursor = new URL('../../assets/kooky/icons/cursor.png', import.meta.url).href;
const droid = new URL('../../assets/kooky/icons/droid.png', import.meta.url).href;
const gemini = new URL('../../assets/kooky/icons/gemini.png', import.meta.url).href;
const copilot = new URL('../../assets/kooky/icons/githubcopilot.png', import.meta.url).href;
const grok = new URL('../../assets/kooky/icons/grok.png', import.meta.url).href;
const kimi = new URL('../../assets/kooky/icons/kimi.png', import.meta.url).href;
const kiro = new URL('../../assets/kooky/icons/kiro.png', import.meta.url).href;
const opencode = new URL('../../assets/kooky/icons/opencode.png', import.meta.url).href;
const pi = new URL('../../assets/kooky/icons/pi.png', import.meta.url).href;

const AGENT_ASSET: Readonly<Record<string, string>> = Object.freeze({
  claude,
  codex,
  gemini,
  opencode,
  amp,
  'cursor-agent': cursor,
  copilot,
  grok,
  agy: antigravity,
  kimi,
  pi,
  'kiro-cli': kiro,
  droid,
});

interface KookyAgentIconProps {
  agent?: string;
  size?: number;
  fallback?: ReactNode;
  style?: CSSProperties;
}

/** Exact Kooky agent artwork for the terminal workbench only. */
export function KookyAgentIcon({ agent, size = 16, fallback, style }: KookyAgentIconProps) {
  const source = agent ? AGENT_ASSET[agent] : undefined;
  if (!source) {
    return fallback ?? <TerminalSquare size={size} strokeWidth={1.7} style={style} />;
  }
  return (
    <img
      src={source}
      alt=""
      draggable={false}
      style={{ width: size, height: size, display: 'block', objectFit: 'contain', ...style }}
    />
  );
}

export function hasKookyAgentIcon(agent: string | undefined): boolean {
  return Boolean(agent && AGENT_ASSET[agent]);
}
