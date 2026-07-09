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
export interface SkinProps {
  color: string;
  highlight?: string;
  /** Cursor is over the pet — skins may play a "notice you" reaction
   *  (the lobster waves its claws). */
  hovered?: boolean;
  /** The pet is being hand-dragged — skins may animate a walk cycle. */
  walking?: boolean;
  /** Horizontal drag direction while walking: -1 left, +1 right, 0 idle.
   *  The lobster's legs stride toward it. */
  walkDir?: number;
}

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

export function RobotSkin({ color, highlight = '#fff', hovered = false, walking = false, walkDir = 0 }: SkinProps) {
  const id = 'bot';
  const dir = Math.max(-1, Math.min(1, walkDir));
  return (
    <>
      <defs>
        {bodyGradient(id, color, '30%')}
        {shadowFilter(id, color)}
      </defs>

      {/* Antenna — angled line + glowing tip. Whips faster & wider on hover. */}
      <motion.line x1={60} y1={28} x2={48} y2={8} stroke={color} strokeWidth={2.5} strokeLinecap="round"
        style={BOTTOM}
        animate={hovered ? { rotate: [-14, 14, -14] } : { rotate: [-3, 3, -3] }}
        transition={{ duration: hovered ? 0.5 : 2.6, repeat: Infinity, ease: EASE }} />
      <motion.circle cx={48} cy={7} r={4.5} fill={color}
        animate={{ opacity: hovered ? [0.85, 0.4, 0.85] : 0.85 }}
        transition={{ duration: 0.5, repeat: hovered ? Infinity : 0, ease: EASE }} />
      <circle cx={48} cy={7} r={2.2} fill={highlight} opacity={0.4} />

      {/* Stubby feet — shuffle back and forth while being carried. */}
      <motion.rect x={38} y={114} width={16} height={9} rx={4} fill={color} opacity={0.72} stroke={SHADOW} strokeWidth={0.8}
        animate={walking ? { x: [-3 + dir * 2, 3 + dir * 2] } : { x: 0 }}
        transition={{ duration: 0.32, repeat: walking ? Infinity : 0, repeatType: 'reverse', ease: 'easeInOut' }} />
      <motion.rect x={66} y={114} width={16} height={9} rx={4} fill={color} opacity={0.72} stroke={SHADOW} strokeWidth={0.8}
        animate={walking ? { x: [3 + dir * 2, -3 + dir * 2] } : { x: 0 }}
        transition={{ duration: 0.32, repeat: walking ? Infinity : 0, repeatType: 'reverse', ease: 'easeInOut' }} />

      {/* Body — rounded rectangle with 3D gradient + shadow */}
      <rect x={26} y={28} width={68} height={90} rx={20} ry={20}
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />

      {/* Screen face */}
      <rect x={46} y={42} width={28} height={24} rx={6}
        fill={color} opacity={0.3} stroke={color} strokeWidth={0.8} strokeOpacity={0.4} />
      {/* Eye dots on screen */}
      <circle cx={55} cy={51} r={3} fill={highlight} opacity={0.7} />
      <circle cx={65} cy={51} r={3} fill={highlight} opacity={0.7} />
      {/* Mouth line on screen */}
      <line x1={54} y1={58} x2={66} y2={58} stroke={highlight} strokeWidth={1} opacity={0.35} strokeLinecap="round" />

      {/* Ear bolts */}
      <circle cx={28} cy={48} r={4} fill={color} opacity={0.5} stroke={SHADOW} strokeWidth={0.8} />
      <circle cx={92} cy={48} r={4} fill={color} opacity={0.5} stroke={SHADOW} strokeWidth={0.8} />

      {/* Rivets — bottom corners */}
      <circle cx={36} cy={108} r={2.5} fill={highlight} opacity={0.18} />
      <circle cx={84} cy={108} r={2.5} fill={highlight} opacity={0.18} />

      {/* Body highlight — top edge reflection */}
      <rect x={34} y={32} width={52} height={6} rx={3} fill={highlight} opacity={0.1} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Cat — sitting kitten: round head, big pointed ears, curved body, thick tail
// ═══════════════════════════════════════════════════════════════════════

export function CatSkin({ color, highlight = '#fff', hovered = false, walking = false, walkDir = 0 }: SkinProps) {
  const id = 'cat';
  const dir = Math.max(-1, Math.min(1, walkDir));
  return (
    <>
      <defs>
        {bodyGradient(id, color, '28%')}
        {shadowFilter(id, color)}
      </defs>

      {/* Thick swishing tail — flicks faster & wider when noticed. */}
      <motion.path d="M86,106 Q110,100 106,78 Q102,58 90,50" stroke={color} strokeWidth={10}
        fill="none" strokeLinecap="round" opacity={0.92}
        style={BOTTOM}
        animate={hovered ? { rotate: [-9, 9, -9] } : { rotate: [-3, 3, -3] }}
        transition={{ duration: hovered ? 0.7 : 2.2, repeat: Infinity, ease: EASE }} />

      {/* Sitting body — rounded pear shape */}
      <path d="M38,76 Q22,100 30,120 Q38,132 60,132 Q82,132 90,120 Q98,100 82,76 Z"
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />

      {/* Front paws — pad forward in alternation while being carried. */}
      <motion.ellipse cx={44} cy={128} rx={10} ry={6} fill={color} opacity={0.7} stroke={SHADOW} strokeWidth={0.8}
        animate={walking ? { y: [0, -5, 0], x: dir * 2 } : { y: 0, x: 0 }}
        transition={{ duration: 0.34, repeat: walking ? Infinity : 0, ease: 'easeInOut' }} />
      <motion.ellipse cx={76} cy={128} rx={10} ry={6} fill={color} opacity={0.7} stroke={SHADOW} strokeWidth={0.8}
        animate={walking ? { y: [0, -5, 0], x: dir * 2 } : { y: 0, x: 0 }}
        transition={{ duration: 0.34, repeat: walking ? Infinity : 0, ease: 'easeInOut', delay: 0.17 }} />

      {/* Head — large round */}
      <ellipse cx={60} cy={58} rx={34} ry={32}
        fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} />

      {/* Big pointed ears — twitch on hover (each ear pivots at its base). */}
      <motion.g style={{ transformBox: 'fill-box', transformOrigin: 'bottom right' }}
        animate={hovered ? { rotate: [0, -10, 2, -6, 0] } : { rotate: 0 }}
        transition={{ duration: 0.6, repeat: hovered ? Infinity : 0, ease: EASE }}>
        <path d="M35,44 L28,12 L52,34 Z" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} />
        <path d="M37,42 L33,20 L48,35 Z" fill={color} opacity={0.35} />
      </motion.g>
      <motion.g style={{ transformBox: 'fill-box', transformOrigin: 'bottom left' }}
        animate={hovered ? { rotate: [0, 10, -2, 6, 0] } : { rotate: 0 }}
        transition={{ duration: 0.6, repeat: hovered ? Infinity : 0, ease: EASE, delay: 0.08 }}>
        <path d="M85,44 L92,12 L68,34 Z" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} />
        <path d="M83,42 L87,20 L72,35 Z" fill={color} opacity={0.35} />
      </motion.g>

      {/* Whiskers */}
      <motion.g style={BOTTOM} animate={{ rotate: [-1, 1, -1] }} transition={{ duration: 3, repeat: Infinity, ease: EASE }}>
        <line x1={22} y1={52} x2={42} y2={60} stroke={SHADOW} strokeWidth={1.2} opacity={0.55} />
        <line x1={20} y1={62} x2={40} y2={64} stroke={SHADOW} strokeWidth={1.2} opacity={0.55} />
        <line x1={78} y1={60} x2={98} y2={52} stroke={SHADOW} strokeWidth={1.2} opacity={0.55} />
        <line x1={80} y1={64} x2={100} y2={62} stroke={SHADOW} strokeWidth={1.2} opacity={0.55} />
      </motion.g>

      {/* Head highlight */}
      <ellipse cx={54} cy={42} rx={14} ry={9} fill={highlight} opacity={0.13} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Jellyfish — domed bell + 5 wavy tentacles, translucent
// ═══════════════════════════════════════════════════════════════════════

export function JellyfishSkin({ color, highlight = '#fff', hovered = false, walking = false, walkDir = 0 }: SkinProps) {
  const id = 'jelly';
  const dir = Math.max(-1, Math.min(1, walkDir));
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

      {/* Bell (dome) — squishes like a jet pulse when noticed. Tentacles sweep
          opposite the drag direction so it reads as swimming that way. */}
      <motion.g style={{ transformBox: 'fill-box', transformOrigin: 'center bottom' }}
        animate={hovered ? { scaleX: [1, 1.12, 0.94, 1], scaleY: [1, 0.9, 1.08, 1] } : { scaleX: 1, scaleY: 1 }}
        transition={{ duration: 0.7, repeat: hovered ? Infinity : 0, ease: EASE }}>
        <path d="M22,74 Q22,24 60,22 Q98,24 98,74 Z"
          fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1} filter={`url(#${id}-shadow)`} />
      </motion.g>

      {/* Tentacles — 5 independent swaying strands, wrapped so they trail
          behind the swim direction while being carried. */}
      <motion.g style={{ transformBox: 'fill-box', transformOrigin: 'center top' }}
        animate={{ rotate: walking ? -dir * 10 : 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 16 }}>
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
      </motion.g>

      {/* Bell highlight curves */}
      <path d="M38,72 Q38,36 60,34" stroke={highlight} strokeWidth={1.2} fill="none" opacity={0.22} />
      <path d="M82,72 Q82,36 60,34" stroke={highlight} strokeWidth={1.2} fill="none" opacity={0.22} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Ghost — cute floating spirit with raised nub arms and big round eyes
// ═══════════════════════════════════════════════════════════════════════

export function GhostSkin({ color, highlight = '#fff', hovered = false, walking = false, walkDir = 0 }: SkinProps) {
  const id = 'ghost';
  const dir = Math.max(-1, Math.min(1, walkDir));
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

      {/* Little arms — flap up in a big "boo!" wave when noticed. */}
      <motion.g style={BOTTOM}
        animate={hovered ? { rotate: [-2, 16, -2, 12, -2], y: [0, -4, 0, -3, 0] } : { rotate: [-2, 2, -2] }}
        transition={{ duration: hovered ? 0.6 : 2.6, repeat: Infinity, ease: EASE }}>
        {/* Left arm */}
        <path d="M34,84 Q24,72 30,62 Q32,58 34,60" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1.2} />
        {/* Right arm */}
        <path d="M86,84 Q96,72 90,62 Q88,58 86,60" fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1.2} />
      </motion.g>

      {/* Body — the wavy hem swishes side to side (biased toward travel) while
          being carried, standing in for feet on a floating spirit. */}
      <motion.g style={{ transformBox: 'fill-box', transformOrigin: 'center top' }}
        animate={walking ? { skewX: [-4 + dir * 3, 4 + dir * 3] } : { skewX: 0 }}
        transition={{ duration: 0.4, repeat: walking ? Infinity : 0, repeatType: 'reverse', ease: 'easeInOut' }}>
        <path d="M26,72 Q24,18 60,14 Q96,18 94,72 L94,122 L84,108 L74,122 L64,108 L54,122 L44,108 L34,122 L26,108 Z"
          fill={`url(#${id}-body)`} stroke={SHADOW} strokeWidth={1.2} filter={`url(#${id}-shadow)`} />
        {/* Top highlight */}
        <ellipse cx={56} cy={34} rx={16} ry={8} fill={highlight} opacity={0.12} />
      </motion.g>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Lobster 🦞 — chibi/cartoon: oversized claws, simple curved body, cute eyes
// ═══════════════════════════════════════════════════════════════════════

/** Three little legs per side. At rest they're static twigs; while `walking`
 *  each leg swings about its body-side anchor in a staggered gait and the
 *  whole cluster shifts + tilts toward `walkDir`, reading as "scurrying that
 *  way". Left legs pivot on their right (body) end, right legs on their left. */
function LobsterLegs({ color, walking, walkDir }: { color: string; walking: boolean; walkDir: number }) {
  const dir = Math.max(-1, Math.min(1, walkDir));
  if (!walking) {
    return (
      <>
        <path d="M46,66 L36,64 M46,72 L35,72 M46,78 L36,80" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.6} />
        <path d="M74,66 L84,64 M74,72 L85,72 M74,78 L84,80" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.6} />
      </>
    );
  }
  const DUR = 0.34;
  // [pivotSide, x1, y1, x2, y2] — inner end (x1) sits on the body, outer end
  // (x2) is the foot that swings.
  const legs: Array<['L' | 'R', number, number, number, number]> = [
    ['L', 46, 66, 35, 63],
    ['L', 46, 72, 34, 72],
    ['L', 46, 78, 35, 81],
    ['R', 74, 66, 85, 63],
    ['R', 74, 72, 86, 72],
    ['R', 74, 78, 85, 81],
  ];
  return (
    <motion.g
      animate={{ x: dir * 2.5, rotate: dir * 2 }}
      transition={{ type: 'spring', stiffness: 200, damping: 18 }}
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
    >
      {legs.map(([side, x1, y1, x2, y2], i) => (
        <motion.line
          key={i}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color} strokeWidth={2.2} strokeLinecap="round" opacity={0.72}
          style={{ transformBox: 'fill-box', transformOrigin: side === 'L' ? 'right center' : 'left center' }}
          animate={{ rotate: [-16, 16, -16] }}
          transition={{
            duration: DUR,
            repeat: Infinity,
            ease: 'easeInOut',
            // Opposite side steps on the offbeat; legs within a side stagger
            // slightly so the gait looks like scurrying, not a rigid scissor.
            delay: (side === 'R' ? DUR / 2 : 0) + (i % 3) * 0.05,
          }}
        />
      ))}
    </motion.g>
  );
}

export function LobsterSkin({ color, highlight = '#fff', hovered = false, walking = false, walkDir = 0 }: SkinProps) {
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

      {/* BIG left claw — cartoon proportions. On hover it waves "hi": a
          bigger, faster raise-and-swing instead of the idle sway. */}
      <motion.g style={BOTTOM}
        animate={hovered ? { rotate: [-6, 22, -2, 18, -6], y: [0, -4, 0, -3, 0] } : { rotate: [-6, 6, -6] }}
        transition={{ duration: hovered ? 0.7 : 2, repeat: Infinity, ease: EASE }}>
        <path d="M42,52 Q20,58 12,42 Q6,30 14,24" fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" />
        {/* Pincer top half */}
        <path d="M14,24 Q4,14 10,6 Q18,2 22,14" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
        {/* Pincer bottom half */}
        <path d="M14,24 Q20,32 28,22" fill={`url(#${id}-claw)`} stroke={SHADOW} strokeWidth={1} />
      </motion.g>

      {/* BIG right claw — mirrors the left claw's hover wave. */}
      <motion.g style={BOTTOM}
        animate={hovered ? { rotate: [6, -22, 2, -18, 6], y: [0, -4, 0, -3, 0] } : { rotate: [6, -6, 6] }}
        transition={{ duration: hovered ? 0.7 : 2, repeat: Infinity, ease: EASE }}>
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

      {/* Walking legs — static twigs at rest; while the pet is being dragged
          they scramble in a stepping gait and the whole cluster leans toward
          the drag direction so the feet look like they're carrying it there. */}
      <LobsterLegs color={color} walking={walking} walkDir={walkDir} />

      {/* Body highlight */}
      <path d="M50,68 Q60,62 70,68 Q62,72 50,68 Z" fill={highlight} opacity={0.13} />
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
