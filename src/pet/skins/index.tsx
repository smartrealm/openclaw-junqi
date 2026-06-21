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

/** JunQi lobster 🦞 — recognizable silhouette: big claws, segmented curved
 * tail, antennae, and tiny walking legs. Feels like a lobster, not a blob. */
export function LobsterSkin({ color }: SkinProps) {
  return (
    <>
      {/* Antennae — long sweeping curves */}
      <motion.path d="M54,34 Q38,16 22,8" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 2.8, repeat: Infinity, ease: EASE }} />
      <motion.path d="M66,34 Q82,16 98,8" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [3, -3, 3] }} transition={{ duration: 2.8, repeat: Infinity, ease: EASE }} />

      {/* Left claw — big oval pincer */}
      <motion.g style={BOTTOM} animate={{ rotate: [-5, 5, -5] }} transition={{ duration: 2.2, repeat: Infinity, ease: EASE }}>
        {/* Left arm */}
        <path d="M44,50 Q28,54 18,42 Q12,34 16,28" fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" />
        {/* Left pincer upper */}
        <path d="M16,28 Q8,20 14,14 Q20,12 22,20" fill={color} stroke={EDGE} strokeWidth={1} />
        {/* Left pincer lower */}
        <path d="M16,28 Q22,32 26,26" fill={color} stroke={EDGE} strokeWidth={1} />
      </motion.g>

      {/* Right claw — mirror */}
      <motion.g style={BOTTOM} animate={{ rotate: [5, -5, 5] }} transition={{ duration: 2.2, repeat: Infinity, ease: EASE }}>
        <path d="M76,50 Q92,54 102,42 Q108,34 104,28" fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" />
        <path d="M104,28 Q112,20 106,14 Q100,12 98,20" fill={color} stroke={EDGE} strokeWidth={1} />
        <path d="M104,28 Q98,32 94,26" fill={color} stroke={EDGE} strokeWidth={1} />
      </motion.g>

      {/* Body — segmented curved tail */}
      <path d="M44,56 Q40,80 46,100 Q52,114 58,118 L62,118 Q68,114 74,100 Q80,80 76,56 Z"
        fill={color} stroke={EDGE} strokeWidth={1} />
      {/* Tail segments */}
      <path d="M46,78 Q60,82 74,78" stroke={EDGE} strokeWidth={1} fill="none" opacity={0.35} />
      <path d="M46,90 Q60,94 74,90" stroke={EDGE} strokeWidth={1} fill="none" opacity={0.35} />
      <path d="M48,102 Q60,106 72,102" stroke={EDGE} strokeWidth={1} fill="none" opacity={0.35} />

      {/* Tail fan */}
      <path d="M50,114 L58,130 L64,126 L60,118 Z" fill={color} stroke={EDGE} strokeWidth={1} />
      <path d="M58,118 L64,126 L70,118 Z" fill={color} stroke={EDGE} strokeWidth={1} />
      <path d="M60,118 L66,130 L72,114 Z" fill={color} stroke={EDGE} strokeWidth={1} />

      {/* Walking legs — 3 pairs, tiny */}
      <path d="M48,66 L38,64 M48,74 L36,74 M50,82 L38,84" stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" opacity={0.7} />
      <path d="M72,66 L82,64 M72,74 L84,74 M70,82 L82,84" stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" opacity={0.7} />

      {/* Eyes */}
      <ellipse cx={52} cy={50} rx={8} ry={11} fill="#fff" opacity={0.22} />
      <ellipse cx={68} cy={50} rx={8} ry={11} fill="#fff" opacity={0.22} />
      <circle cx={54} cy={49} r={3} fill={color} opacity={0.8} />
      <circle cx={66} cy={49} r={3} fill={color} opacity={0.8} />
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
