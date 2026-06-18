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
const EDGE = themeAlpha('primary', 1);

export type PetSkin = 'sprite' | 'robot' | 'lobster' | 'cat' | 'jellyfish' | 'ghost';
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
        fill={color} stroke={EDGE} strokeWidth={1} />
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
      <rect x={24} y={24} width={72} height={100} rx={22} ry={22} fill={color} stroke={EDGE} strokeWidth={1} />
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

/** JunQi lobster — nods to OpenClaw ("claw"). Flat style: single fill + stroke,
 * no radial 3D gradient (the old one looked dated). Takes the theme color so it
 * matches the accent like the other skins. */
export function LobsterSkin({ color }: SkinProps) {
  return (
    <>
      <motion.path d="M50,24 Q42,12 38,6" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [-4, 4, -4] }} transition={{ duration: 2.4, repeat: Infinity, ease: EASE }} />
      <motion.path d="M70,24 Q78,12 82,6" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [4, -4, 4] }} transition={{ duration: 2.4, repeat: Infinity, ease: EASE }} />
      <path d="M44,118 L60,130 L76,118 L70,110 L50,110 Z" fill={color} stroke={EDGE} strokeWidth={1} />
      <ellipse cx={60} cy={74} rx={30} ry={40} fill={color} stroke={EDGE} strokeWidth={1} />
      <path d="M34,66 Q60,72 86,66" stroke={EDGE} strokeWidth={1} fill="none" opacity={0.4} />
      <path d="M34,82 Q60,88 86,82" stroke={EDGE} strokeWidth={1} fill="none" opacity={0.4} />
      <ellipse cx={24} cy={88} rx={11} ry={13} fill={color} stroke={EDGE} strokeWidth={1} />
      <path d="M16,82 L11,78 M16,94 L11,98" stroke={EDGE} strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={96} cy={88} rx={11} ry={13} fill={color} stroke={EDGE} strokeWidth={1} />
      <path d="M104,82 L109,78 M104,94 L109,98" stroke={EDGE} strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={50} cy={56} rx={11} ry={15} fill="#fff" opacity={0.16} />
    </>
  );
}

/** Cat — round head, triangular ears, swishing tail. */
export function CatSkin({ color }: SkinProps) {
  return (
    <>
      <motion.path d="M96,100 Q110,94 106,78" stroke={color} strokeWidth={6} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [-4, 4, -4] }} transition={{ duration: 2.4, repeat: Infinity, ease: EASE }} />
      <path d="M40,32 L32,10 L54,26 Z" fill={color} stroke={EDGE} strokeWidth={1} />
      <path d="M80,32 L88,10 L66,26 Z" fill={color} stroke={EDGE} strokeWidth={1} />
      <ellipse cx={60} cy={68} rx={32} ry={36} fill={color} stroke={EDGE} strokeWidth={1} />
      <path d="M44,60 Q60,68 76,60" stroke={EDGE} strokeWidth={1} fill="none" opacity={0.3} />
      <ellipse cx={50} cy={52} rx={10} ry={14} fill="#fff" opacity={0.16} />
    </>
  );
}

/** Jellyfish — domed bell + dangling wavy tentacles, semi-transparent. */
export function JellyfishSkin({ color }: SkinProps) {
  return (
    <>
      <motion.path d="M40,80 Q44,102 40,120" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.75}
        style={BOTTOM} animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 3, repeat: Infinity, ease: EASE }} />
      <motion.path d="M60,82 Q64,106 60,124" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.75}
        style={BOTTOM} animate={{ rotate: [2, -2, 2] }} transition={{ duration: 3, repeat: Infinity, ease: EASE }} />
      <motion.path d="M80,80 Q76,102 80,120" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" opacity={0.75}
        style={BOTTOM} animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 3.2, repeat: Infinity, ease: EASE }} />
      <path d="M24,76 Q24,26 60,26 Q96,26 96,76 Z" fill={color} stroke={EDGE} strokeWidth={1} opacity={0.88} />
      <path d="M36,76 Q36,38 60,38" stroke="#fff" strokeWidth={1} fill="none" opacity={0.25} />
      <path d="M84,76 Q84,38 60,38" stroke="#fff" strokeWidth={1} fill="none" opacity={0.25} />
      <ellipse cx={48} cy={48} rx={10} ry={12} fill="#fff" opacity={0.18} />
    </>
  );
}

/** Ghost — rounded top + wavy bottom hem, slightly translucent. */
export function GhostSkin({ color }: SkinProps) {
  return (
    <>
      <path d="M28,70 Q28,22 60,22 Q92,22 92,70 L92,118 L82,108 L72,118 L62,108 L52,118 L42,108 L28,118 Z"
        fill={color} stroke={EDGE} strokeWidth={1} opacity={0.92} />
      <ellipse cx={48} cy={46} rx={10} ry={12} fill="#fff" opacity={0.16} />
    </>
  );
}

/** Registry: skin key → component. Add a skin here to make it selectable. */
export const SKIN_REGISTRY: Record<PetSkin, FC<SkinProps>> = {
  sprite: SpriteSkin,
  robot: RobotSkin,
  lobster: LobsterSkin,
  cat: CatSkin,
  jellyfish: JellyfishSkin,
  ghost: GhostSkin,
};
