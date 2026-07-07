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

const EASE = [0.22, 1, 0.36, 1] as const;
const BOTTOM = { transformBox: 'fill-box' as const, transformOrigin: 'bottom' };
const SHADOW = 'rgb(var(--aegis-primary) / 0.38)';

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
// Cat — sitting kitten: round head, big pointed ears, curved body, thick tail
// ═══════════════════════════════════════════════════════════════════════

export function CatSkin({ color }: SkinProps) {
  const id = 'cat';
  return (
    <>
      <defs>
        {bodyGradient(id, color, '28%')}
        {shadowFilter(id, color)}
      </defs>

      {/* Thick swishing tail — curves down then up */}
      <motion.path d="M86,106 Q110,100 106,78 Q102,58 90,50" stroke={color} strokeWidth={10}
        fill="none" strokeLinecap="round" opacity={0.92}
        style={BOTTOM} animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 2.2, repeat: Infinity, ease: EASE }} />

      {/* Sitting body — rounded pear shape */}
      <path d="M38,76 Q22,100 30,120 Q38,132 60,132 Q82,132 90,120 Q98,100 82,76 Z"
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />

      {/* Front paws */}
      <ellipse cx={44} cy={128} rx={10} ry={6} fill={color} opacity={0.7} stroke={SHADOW} strokeWidth={0.8} />
      <ellipse cx={76} cy={128} rx={10} ry={6} fill={color} opacity={0.7} stroke={SHADOW} strokeWidth={0.8} />

      {/* Head — large round */}
      <ellipse cx={60} cy={58} rx={34} ry={32}
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} />

      {/* Big pointed ears */}
      <path d="M35,44 L28,12 L52,34 Z" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} />
      <path d="M37,42 L33,20 L48,35 Z" fill={color} opacity={0.35} />
      <path d="M85,44 L92,12 L68,34 Z" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} />
      <path d="M83,42 L87,20 L72,35 Z" fill={color} opacity={0.35} />

      {/* Whiskers */}
      <motion.g style={BOTTOM} animate={{ rotate: [-1, 1, -1] }} transition={{ duration: 3, repeat: Infinity, ease: EASE }}>
        <line x1={22} y1={52} x2={42} y2={60} stroke={SHADOW} strokeWidth={1.2} opacity={0.55} />
        <line x1={20} y1={62} x2={40} y2={64} stroke={SHADOW} strokeWidth={1.2} opacity={0.55} />
        <line x1={78} y1={60} x2={98} y2={52} stroke={SHADOW} strokeWidth={1.2} opacity={0.55} />
        <line x1={80} y1={64} x2={100} y2={62} stroke={SHADOW} strokeWidth={1.2} opacity={0.55} />
      </motion.g>

      {/* Head highlight */}
      <ellipse cx={54} cy={42} rx={14} ry={9} fill="#fff" opacity={0.13} />
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
// Ghost — cute floating spirit with raised nub arms and big round eyes
// ═══════════════════════════════════════════════════════════════════════

export function GhostSkin({ color }: SkinProps) {
  const id = 'ghost';
  return (
    <>
      <defs>
        <radialGradient id={`${id}-body`} cx="45%" cy="22%" r="60%">
          <stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <stop offset="50%" stopColor={color} stopOpacity={0.76} />
          <stop offset="100%" stopColor={color} stopOpacity={0.44} />
        </radialGradient>
        {shadowFilter(id, color)}
      </defs>

      {/* Little arms — raised in a cute "boo" pose */}
      <motion.g style={BOTTOM} animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 2.6, repeat: Infinity, ease: EASE }}>
        {/* Left arm */}
        <path d="M34,84 Q24,72 30,62 Q32,58 34,60" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1.2} />
        {/* Right arm */}
        <path d="M86,84 Q96,72 90,62 Q88,58 86,60" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1.2} />
      </motion.g>

      {/* Body — tall rounded ghost with wavy bottom */}
      <path d="M26,72 Q24,18 60,14 Q96,18 94,72 L94,122 L84,108 L74,122 L64,108 L54,122 L44,108 L34,122 L26,108 Z"
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1.2} filter={`url(#${id}-shadow)`} />

      {/* Top highlight */}
      <ellipse cx={56} cy={34} rx={16} ry={8} fill="#fff" opacity={0.12} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Lobster 🦞 — chibi/cartoon: oversized claws, simple curved body, cute eyes
// ═══════════════════════════════════════════════════════════════════════

export function LobsterSkin({ color }: SkinProps) {
  const id = 'lob';
  return (
    <>
      <defs>
        {bodyGradient(id, color, '30%')}
        <radialGradient id={`${id}-claw`} cx="35%" cy="30%" r="60%">
          <stop offset="0%" stopColor={color} stopOpacity={1} />
          <stop offset="55%" stopColor={color} stopOpacity={0.8} />
          <stop offset="100%" stopColor={color} stopOpacity={0.5} />
        </radialGradient>
        {shadowFilter(id, color)}
      </defs>

      {/* Antennae — cute curly */}
      <motion.path d="M50,36 Q32,18 24,10 Q20,6 22,10" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 2.6, repeat: Infinity, ease: EASE }} />
      <motion.path d="M70,36 Q88,18 96,10 Q100,6 98,10" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round"
        style={BOTTOM} animate={{ rotate: [3, -3, 3] }} transition={{ duration: 2.6, repeat: Infinity, ease: EASE }} />

      {/* BIG left claw — cartoon proportions */}
      <motion.g style={BOTTOM} animate={{ rotate: [-6, 6, -6] }} transition={{ duration: 2, repeat: Infinity, ease: EASE }}>
        <path d="M42,52 Q20,58 12,42 Q6,30 14,24" fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" />
        {/* Pincer top half */}
        <path d="M14,24 Q4,14 10,6 Q18,2 22,14" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
        {/* Pincer bottom half */}
        <path d="M14,24 Q20,32 28,22" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
      </motion.g>

      {/* BIG right claw */}
      <motion.g style={BOTTOM} animate={{ rotate: [6, -6, 6] }} transition={{ duration: 2, repeat: Infinity, ease: EASE }}>
        <path d="M78,52 Q100,58 108,42 Q114,30 106,24" fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" />
        <path d="M106,24 Q116,14 110,6 Q102,2 98,14" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
        <path d="M106,24 Q100,32 92,22" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
      </motion.g>

      {/* Body — simple curved oval */}
      <path d="M42,60 Q38,90 46,108 Q54,122 60,124 Q66,122 74,108 Q82,90 78,60 Z"
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />

      {/* Tail segments — simplified */}
      <path d="M44,84 Q58,90 76,84" stroke={SHADOW} strokeWidth={1.2} fill="none" opacity={0.4} />
      <path d="M44,96 Q60,104 76,96" stroke={SHADOW} strokeWidth={1.2} fill="none" opacity={0.4} />

      {/* Tail fan — three rounded lobes */}
      <path d="M48,114 Q54,132 60,126 Q62,118 60,114" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
      <path d="M58,116 Q60,134 64,126 Q64,118 62,114" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
      <path d="M66,114 Q70,128 74,120 Q72,114 68,112" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />

      {/* Tiny walking legs — simpler */}
      <path d="M46,68 L36,66 M46,76 L36,78" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.6} />
      <path d="M74,68 L84,66 M74,76 L84,78" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.6} />

      {/* Body highlight */}
      <path d="M50,68 Q60,62 70,68 Q62,72 50,68 Z" fill="#fff" opacity={0.13} />
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
