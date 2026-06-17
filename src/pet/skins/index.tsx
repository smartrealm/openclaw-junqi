/**
 * Character skins — each is an independent component rendering only the body
 * silhouette + decorations (no eyes/mouth/effects; those are layered on top by
 * PetCharacter so they're shared across skins). Adding a skin = add a component
 * + one line in SKIN_REGISTRY (open–closed).
 */
import { motion } from 'framer-motion';
import type { FC } from 'react';
import { themeAlpha } from '@/utils/theme-colors';

const EASE = [0.22, 1, 0.36, 1] as const;
const BOTTOM = { transformBox: 'fill-box' as const, transformOrigin: 'bottom' };

export type PetSkin = 'sprite' | 'robot' | 'lobster';
export interface SkinProps {
  color: string;
}

export function SpriteSkin({ color }: SkinProps) {
  return (
    <>
      <motion.line x1={60} y1={20} x2={60} y2={8} stroke={color} strokeWidth={2.5} strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [-4, 4, -4] }} transition={{ duration: 2.6, repeat: Infinity, ease: EASE }} />
      <circle cx={60} cy={7} r={4} fill={color} />
      <path d="M60,18 C88,18 100,42 100,74 C100,106 82,126 60,126 C38,126 20,106 20,74 C20,42 32,18 60,18 Z"
        fill={color} stroke={themeAlpha('primary', 1)} strokeWidth={1} />
      <ellipse cx={46} cy={48} rx={16} ry={20} fill="#fff" opacity={0.16} />
    </>
  );
}

export function RobotSkin({ color }: SkinProps) {
  return (
    <>
      <motion.line x1={60} y1={24} x2={60} y2={8} stroke={color} strokeWidth={2.5} strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 2.6, repeat: Infinity, ease: EASE }} />
      <circle cx={60} cy={7} r={4} fill={color} />
      <rect x={24} y={24} width={72} height={100} rx={22} ry={22} fill={color} stroke={themeAlpha('primary', 1)} strokeWidth={1} />
      <rect x={44} y={40} width={32} height={14} rx={4} fill="#fff" opacity={0.12} />
      <line x1={50} y1={47} x2={70} y2={47} stroke="#fff" strokeWidth={1} opacity={0.3} />
      <circle cx={34} cy={34} r={2} fill="#fff" opacity={0.3} />
      <circle cx={86} cy={34} r={2} fill="#fff" opacity={0.3} />
      <circle cx={34} cy={114} r={2} fill="#fff" opacity={0.3} />
      <circle cx={86} cy={114} r={2} fill="#fff" opacity={0.3} />
      <rect x={32} y={58} width={16} height={20} rx={7} fill="#fff" opacity={0.16} />
    </>
  );
}

/** JunQi lobster — nods to OpenClaw ("claw"). 3D look via a radial shell
 * gradient (specular → brand red → dark edge). Fixed brand-red regardless of
 * theme accent (users upload their own if they want a different look). */
export function LobsterSkin({ color }: SkinProps) {
  void color;
  const shell = 'url(#lobsterShell)';
  const edge = '#7E2410';
  return (
    <>
      <defs>
        <radialGradient id="lobsterShell" cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#FF8A66" />
          <stop offset="50%" stopColor="#E2563B" />
          <stop offset="100%" stopColor="#A82C16" />
        </radialGradient>
      </defs>
      <motion.path d="M50,24 Q42,12 38,6" stroke="#E2563B" strokeWidth={2.5} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [-4, 4, -4] }} transition={{ duration: 2.4, repeat: Infinity, ease: EASE }} />
      <motion.path d="M70,24 Q78,12 82,6" stroke="#E2563B" strokeWidth={2.5} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [4, -4, 4] }} transition={{ duration: 2.4, repeat: Infinity, ease: EASE }} />
      <path d="M44,118 L60,130 L76,118 L70,110 L50,110 Z" fill={shell} stroke={edge} strokeWidth={1} />
      <ellipse cx={60} cy={74} rx={30} ry={40} fill={shell} stroke={edge} strokeWidth={1} />
      <path d="M34,66 Q60,72 86,66" stroke={edge} strokeWidth={1} fill="none" opacity={0.35} />
      <path d="M34,82 Q60,88 86,82" stroke={edge} strokeWidth={1} fill="none" opacity={0.35} />
      <ellipse cx={24} cy={88} rx={11} ry={13} fill={shell} stroke={edge} strokeWidth={1} />
      <path d="M16,82 L11,78 M16,94 L11,98" stroke={edge} strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={96} cy={88} rx={11} ry={13} fill={shell} stroke={edge} strokeWidth={1} />
      <path d="M104,82 L109,78 M104,94 L109,98" stroke={edge} strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={50} cy={56} rx={11} ry={15} fill="#fff" opacity={0.25} />
      <ellipse cx={46} cy={50} rx={4} ry={6} fill="#fff" opacity={0.55} />
    </>
  );
}

/** Registry: skin key → component. Add a skin here to make it selectable. */
export const SKIN_REGISTRY: Record<PetSkin, FC<SkinProps>> = {
  sprite: SpriteSkin,
  robot: RobotSkin,
  lobster: LobsterSkin,
};
