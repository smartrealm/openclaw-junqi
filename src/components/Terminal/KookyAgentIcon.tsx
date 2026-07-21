import type { CSSProperties, ReactNode } from 'react';
import { TerminalSquare } from 'lucide-react';
import amp from '@/assets/kooky/icons/amp.png';
import antigravity from '@/assets/kooky/icons/antigravity.png';
import claude from '@/assets/kooky/icons/claudecode.png';
import codex from '@/assets/kooky/icons/codex.png';
import cursor from '@/assets/kooky/icons/cursor.png';
import droid from '@/assets/kooky/icons/droid.png';
import gemini from '@/assets/kooky/icons/gemini.png';
import copilot from '@/assets/kooky/icons/githubcopilot.png';
import grok from '@/assets/kooky/icons/grok.png';
import kimi from '@/assets/kooky/icons/kimi.png';
import kiro from '@/assets/kooky/icons/kiro.png';
import opencode from '@/assets/kooky/icons/opencode.png';
import pi from '@/assets/kooky/icons/pi.png';

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
