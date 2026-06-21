/**
 * Character skins — each is an independent component rendering only the body
 * silhouette + decorations (no eyes/mouth/effects; those are layered on top by
 * PetCharacter so they're shared across skins). Adding a skin = add a component
 * + one line in SKIN_REGISTRY (open–closed).
 *
 * Pseudo-3D shading: skins can use SVG <radialGradient> defined inline via
 * <defs>. The gradient shifts from a lighter center to the solid edge color,
 * giving a subtle rounded volume. A highlight overlay (small white shape) on
 * the body top adds a specular reflection. Together this reads as "soft 3D"
 * without any rendering engine.
 *
 * Design tools for new skins:
 *   Figma (free)        — draw shapes, apply radial gradients visually,
 *                          Copy as SVG → extract <radialGradient> defs.
 *                          Best workflow for non-coders.
 *   https://svggradients.com  — visual gradient builder, paste CSS/SVG out.
 *   CodePen             — quick SVG + animation prototyping.
 */
import { motion } from 'framer-motion';
import type { FC } from 'react';
import { themeAlpha } from '@/utils/theme-colors';

const EASE = [0.22, 1, 0.36, 1] as const;
const BOTTOM = { transformBox: 'fill-box' as const, transformOrigin: 'bottom' };
const EDGE = themeAlpha('primary', 1);
const SHADOW = themeAlpha('primary', 0.38);

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

/** JunQi lobster 🦞 — pseudo-3D via radial gradients + highlight overlays.
 * Each major shape (body, claws) uses a <radialGradient> that shifts from a
 * lighter center to the solid edge color, giving soft rounded volume. A white
 * highlight ellipse on the body top adds a specular reflection. Together this
 * reads as "3D-ish" without any rendering engine overhead. */
export function LobsterSkin({ color }: SkinProps) {
  const id = 'lob';
  return (
    <>
      <defs>
        <radialGradient id={`${id}-body`} cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor={color} stopOpacity={1} />
          <stop offset="65%" stopColor={color} stopOpacity={0.82} />
          <stop offset="100%" stopColor={color} stopOpacity={0.55} />
        </radialGradient>
        <radialGradient id={`${id}-claw`} cx="30%" cy="30%" r="65%">
          <stop offset="0%" stopColor={color} stopOpacity={1} />
          <stop offset="60%" stopColor={color} stopOpacity={0.78} />
          <stop offset="100%" stopColor={color} stopOpacity={0.5} />
        </radialGradient>
        {/* Drop-shadow filter for depth behind the body */}
        <filter id={`${id}-shadow`} x="-20%" y="-10%" width="140%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={color} floodOpacity="0.3" />
        </filter>
      </defs>

      {/* Antennae */}
      <motion.path d="M54,34 Q38,16 22,8" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 2.8, repeat: Infinity, ease: EASE }} />
      <motion.path d="M66,34 Q82,16 98,8" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [3, -3, 3] }} transition={{ duration: 2.8, repeat: Infinity, ease: EASE }} />

      {/* Left claw */}
      <motion.g style={BOTTOM} animate={{ rotate: [-5, 5, -5] }} transition={{ duration: 2.2, repeat: Infinity, ease: EASE }}>
        <path d="M44,50 Q28,54 18,42 Q12,34 16,28" fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" />
        <path d="M16,28 Q8,20 14,14 Q20,12 22,20" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
        <path d="M16,28 Q22,32 26,26" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
      </motion.g>

      {/* Right claw */}
      <motion.g style={BOTTOM} animate={{ rotate: [5, -5, 5] }} transition={{ duration: 2.2, repeat: Infinity, ease: EASE }}>
        <path d="M76,50 Q92,54 102,42 Q108,34 104,28" fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" />
        <path d="M104,28 Q112,20 106,14 Q100,12 98,20" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
        <path d="M104,28 Q98,32 94,26" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
      </motion.g>

      {/* Body — with 3D gradient + drop shadow */}
      <path d="M44,56 Q40,80 46,100 Q52,114 58,118 L62,118 Q68,114 74,100 Q80,80 76,56 Z"
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />
      {/* Highlight — curved white shape simulating light hitting the top of the body */}
      <path d="M50,64 Q60,58 70,64 Q62,68 50,64 Z" fill="#fff" opacity={0.14} />
      {/* Tail segments */}
      <path d="M46,78 Q60,82 74,78" stroke={SHADOW} strokeWidth={1} fill="none" opacity={0.45} />
      <path d="M46,90 Q60,94 74,90" stroke={SHADOW} strokeWidth={1} fill="none" opacity={0.45} />
      <path d="M48,102 Q60,106 72,102" stroke={SHADOW} strokeWidth={1} fill="none" opacity={0.45} />

      {/* Tail fan */}
      <path d="M50,114 L58,130 L64,126 L60,118 Z" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
      <path d="M58,118 L64,126 L70,118 Z" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
      <path d="M60,118 L66,130 L72,114 Z" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />

      {/* Walking legs */}
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
