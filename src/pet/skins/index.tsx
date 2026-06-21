/**
 * Character skins — pseudo-3D SVG with radial gradients + highlight overlays.
 *
 * Every skin follows the same pattern:
 *   1. <defs> with a body radialGradient (light center → dark edge)
 *   2. <filter> with feDropShadow for depth
 *   3. Main silhouette shapes using url(#gradient)
 *   4. A white highlight overlay for specular reflection
 *   5. Animated appendages (tail/ears/tentacles) via framer-motion
 *
 * PetCharacter layers shared eyes/mouth/effects on top, so skins only
 * need to render the body silhouette + decorations.
 *
 * Design tools: Figma → Copy as SVG → extract paths + gradients.
 */
import { motion } from 'framer-motion';
import type { FC } from 'react';
import { themeAlpha } from '@/utils/theme-colors';

const EASE = [0.22, 1, 0.36, 1] as const;
const BOTTOM = { transformBox: 'fill-box' as const, transformOrigin: 'bottom' };
const SHADOW = themeAlpha('primary', 0.38);

export type PetSkin = 'robot' | 'lobster' | 'cat' | 'jellyfish' | 'ghost';
export interface SkinProps { color: string; }

// ─── shared gradient helpers ────────────────────────────────────────────

/** Returns radialGradient defs keyed by a unique prefix so each skin's
 *  IDs don't collide when multiple skins render in the same document. */
function bodyGradient(prefix: string, color: string, cy?: string) {
  return (
    <radialGradient id={`${prefix}-body`} cx="40%" cy={cy || '35%'} r="60%">
      <stop offset="0%" stopColor={color} stopOpacity={1} />
      <stop offset="60%" stopColor={color} stopOpacity={0.82} />
      <stop offset="100%" stopColor={color} stopOpacity={0.55} />
    </radialGradient>
  );
}

function shadowFilter(prefix: string, color: string) {
  return (
    <filter id={`${prefix}-shadow`} x="-20%" y="-10%" width="140%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={color} floodOpacity="0.3" />
    </filter>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Robot — boxy body, antenna, screen face, rivets
// ═══════════════════════════════════════════════════════════════════════

export function RobotSkin({ color }: SkinProps) {
  const id = 'bot';
  return (
    <>
      <defs>
        {bodyGradient(id, color, '30%')}
        {shadowFilter(id, color)}
      </defs>

      {/* Antenna — angled line + glowing tip */}
      <motion.line x1={60} y1={28} x2={48} y2={8} stroke={color} strokeWidth={2.5} strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 2.6, repeat: Infinity, ease: EASE }} />
      <circle cx={48} cy={7} r={4.5} fill={color} opacity={0.85} />
      <circle cx={48} cy={7} r={2.2} fill="#fff" opacity={0.4} />

      {/* Body — rounded rectangle with 3D gradient + shadow */}
      <rect x={26} y={28} width={68} height={90} rx={20} ry={20}
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />

      {/* Screen face */}
      <rect x={46} y={42} width={28} height={24} rx={6}
        fill={color} opacity={0.3} stroke={color} strokeWidth={0.8} strokeOpacity={0.4} />
      {/* Eye dots on screen */}
      <circle cx={55} cy={51} r={3} fill="#fff" opacity={0.7} />
      <circle cx={65} cy={51} r={3} fill="#fff" opacity={0.7} />
      {/* Mouth line on screen */}
      <line x1={54} y1={58} x2={66} y2={58} stroke="#fff" strokeWidth={1} opacity={0.35} strokeLinecap="round" />

      {/* Ear bolts */}
      <circle cx={28} cy={48} r={4} fill={color} opacity={0.5} stroke={SHADOW} strokeWidth={0.8} />
      <circle cx={92} cy={48} r={4} fill={color} opacity={0.5} stroke={SHADOW} strokeWidth={0.8} />

      {/* Rivets — bottom corners */}
      <circle cx={36} cy={108} r={2.5} fill="#fff" opacity={0.18} />
      <circle cx={84} cy={108} r={2.5} fill="#fff" opacity={0.18} />

      {/* Body highlight — top edge reflection */}
      <rect x={34} y={32} width={52} height={6} rx={3} fill="#fff" opacity={0.1} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Cat — round head, triangle ears, curved tail, whiskers
// ═══════════════════════════════════════════════════════════════════════

export function CatSkin({ color }: SkinProps) {
  const id = 'cat';
  return (
    <>
      <defs>
        {bodyGradient(id, color, '30%')}
        {shadowFilter(id, color)}
      </defs>

      {/* Tail — curved, sways from bottom */}
      <motion.path d="M90,100 Q108,98 104,76 Q100,58 90,54" stroke={color} strokeWidth={7}
        fill="none" strokeLinecap="round" opacity={0.9}
        style={BOTTOM} animate={{ rotate: [-4, 4, -4] }} transition={{ duration: 2.4, repeat: Infinity, ease: EASE }} />

      {/* Body — round head shape */}
      <ellipse cx={60} cy={68} rx={34} ry={38}
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />

      {/* Left ear */}
      <path d="M34,50 L28,18 L50,34 Z" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} />
      {/* Left ear inner */}
      <path d="M36,48 L32,26 L46,36 Z" fill={color} opacity={0.3} />
      {/* Right ear */}
      <path d="M86,50 L92,18 L70,34 Z" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} />
      <path d="M84,48 L88,26 L74,36 Z" fill={color} opacity={0.3} />

      {/* Whiskers — left */}
      <line x1={22} y1={56} x2={42} y2={62} stroke={SHADOW} strokeWidth={1} opacity={0.5} />
      <line x1={20} y1={66} x2={40} y2={68} stroke={SHADOW} strokeWidth={1} opacity={0.5} />
      {/* Whiskers — right */}
      <line x1={78} y1={62} x2={98} y2={56} stroke={SHADOW} strokeWidth={1} opacity={0.5} />
      <line x1={80} y1={68} x2={100} y2={66} stroke={SHADOW} strokeWidth={1} opacity={0.5} />

      {/* Nose */}
      <path d="M56,70 L60,74 L64,70" stroke={SHADOW} strokeWidth={1.2} fill="none" strokeLinecap="round" opacity={0.6} />

      {/* Head highlight */}
      <ellipse cx={56} cy={52} rx={16} ry={12} fill="#fff" opacity={0.12} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Jellyfish — domed bell + 5 wavy tentacles, translucent
// ═══════════════════════════════════════════════════════════════════════

export function JellyfishSkin({ color }: SkinProps) {
  const id = 'jelly';
  return (
    <>
      <defs>
        <radialGradient id={`${id}-body`} cx="50%" cy="25%" r="55%">
          <stop offset="0%" stopColor={color} stopOpacity={0.92} />
          <stop offset="50%" stopColor={color} stopOpacity={0.72} />
          <stop offset="100%" stopColor={color} stopOpacity={0.45} />
        </radialGradient>
        {shadowFilter(id, color)}
      </defs>

      {/* Bell (dome) */}
      <path d="M22,74 Q22,24 60,22 Q98,24 98,74 Z"
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />

      {/* Tentacles — 5 independent swaying strands */}
      <motion.path d="M36,74 Q34,90 38,106 Q42,116 36,128"
        stroke={color} strokeWidth={2.8} fill="none" strokeLinecap="round" opacity={0.8}
        style={BOTTOM} animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 2.8, repeat: Infinity, ease: EASE }} />
      <motion.path d="M48,74 Q50,94 46,110 Q44,122 50,134"
        stroke={color} strokeWidth={2.8} fill="none" strokeLinecap="round" opacity={0.8}
        style={BOTTOM} animate={{ rotate: [2, -2, 2] }} transition={{ duration: 3.0, repeat: Infinity, ease: EASE }} />
      <motion.path d="M60,74 Q56,96 60,114 Q64,126 60,138"
        stroke={color} strokeWidth={2.8} fill="none" strokeLinecap="round" opacity={0.8}
        style={BOTTOM} animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 3.2, repeat: Infinity, ease: EASE }} />
      <motion.path d="M72,74 Q70,94 74,110 Q70,122 72,134"
        stroke={color} strokeWidth={2.8} fill="none" strokeLinecap="round" opacity={0.8}
        style={BOTTOM} animate={{ rotate: [3, -3, 3] }} transition={{ duration: 2.9, repeat: Infinity, ease: EASE }} />
      <motion.path d="M84,74 Q86,90 82,106 Q84,116 80,128"
        stroke={color} strokeWidth={2.8} fill="none" strokeLinecap="round" opacity={0.8}
        style={BOTTOM} animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 3.1, repeat: Infinity, ease: EASE }} />

      {/* Bell highlight curves */}
      <path d="M38,72 Q38,36 60,34" stroke="#fff" strokeWidth={1.2} fill="none" opacity={0.22} />
      <path d="M82,72 Q82,36 60,34" stroke="#fff" strokeWidth={1.2} fill="none" opacity={0.22} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Ghost — rounded top, wavy bottom, translucent floating feel
// ═══════════════════════════════════════════════════════════════════════

export function GhostSkin({ color }: SkinProps) {
  const id = 'ghost';
  return (
    <>
      <defs>
        <radialGradient id={`${id}-body`} cx="45%" cy="25%" r="58%">
          <stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <stop offset="55%" stopColor={color} stopOpacity={0.78} />
          <stop offset="100%" stopColor={color} stopOpacity={0.5} />
        </radialGradient>
        {shadowFilter(id, color)}
      </defs>

      {/* Body — classic ghost silhouette with wavy bottom */}
      <path d="M28,70 Q28,20 60,18 Q92,20 92,70 L92,118 L82,106 L72,118 L62,106 L52,118 L42,106 L28,118 Z"
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />

      {/* Drapery lines on the wavy hem */}
      <path d="M62,106 L62,96 M52,118 L52,100 M42,106 L42,96" stroke={SHADOW} strokeWidth={1} fill="none" opacity={0.3} />

      {/* Highlight — rounded reflection on top */}
      <ellipse cx={56} cy={44} rx={14} ry={10} fill="#fff" opacity={0.13} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Lobster — big claws, segmented tail, antennae, walking legs (3D)
// ═══════════════════════════════════════════════════════════════════════

export function LobsterSkin({ color }: SkinProps) {
  const id = 'lob';
  return (
    <>
      <defs>
        {bodyGradient(id, color)}
        <radialGradient id={`${id}-claw`} cx="30%" cy="30%" r="65%">
          <stop offset="0%" stopColor={color} stopOpacity={1} />
          <stop offset="60%" stopColor={color} stopOpacity={0.78} />
          <stop offset="100%" stopColor={color} stopOpacity={0.5} />
        </radialGradient>
        {shadowFilter(id, color)}
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

      {/* Body */}
      <path d="M44,56 Q40,80 46,100 Q52,114 58,118 L62,118 Q68,114 74,100 Q80,80 76,56 Z"
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />
      {/* Highlight */}
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

// ═══════════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════════

export const SKIN_REGISTRY: Record<PetSkin, FC<SkinProps>> = {
  robot: RobotSkin,
  lobster: LobsterSkin,
  cat: CatSkin,
  jellyfish: JellyfishSkin,
  ghost: GhostSkin,
};
