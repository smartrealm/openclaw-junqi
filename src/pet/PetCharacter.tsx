/**
 * SVG-layered desktop companion character.
 *
 * Every layer (body / eyes / mouth / cheeks / effects) is driven from a single
 * emotion config table. The body shape is swappable via `skin` (sprite / robot)
 * without touching expressions, animation, or the state machine. Colors come
 * from theme variables (themeHex / themeAlpha) so the pet re-tints with the
 * active theme / accent color automatically.
 */
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { PetEmotion } from './pet-states';
import { themeAlpha, themeHex } from '@/utils/theme-colors';

const EASE = [0.22, 1, 0.36, 1] as const;

export type PetSkin = 'sprite' | 'robot' | 'lobster';

type EffectKind = 'none' | 'sleep' | 'gear' | 'think' | 'stars' | 'hearts' | 'sweat' | 'book' | 'spark';

interface EmotionCfg {
  mouth: string;
  eyeOpen: number; // 0..1 vertical eye scale
  pupilDx: number; // -2..2 gaze direction
  bodyY: number;
  bodyScale: number;
  bodyRotate: number;
  cheeks: boolean;
  effect: EffectKind;
  breath: number; // breathing speed multiplier
}

const CFG: Record<PetEmotion, EmotionCfg> = {
  idle: { mouth: 'M48,86 Q60,97 72,86', eyeOpen: 1, pupilDx: 0, bodyY: 0, bodyScale: 1, bodyRotate: 0, cheeks: false, effect: 'none', breath: 1 },
  working: { mouth: 'M55,88 Q60,84 65,88 Q60,93 55,88', eyeOpen: 1, pupilDx: 0, bodyY: 0, bodyScale: 1, bodyRotate: 0, cheeks: false, effect: 'gear', breath: 0.7 },
  thinking: { mouth: 'M54,91 L66,91', eyeOpen: 1, pupilDx: 1.6, bodyY: 0, bodyScale: 1, bodyRotate: -3, cheeks: false, effect: 'think', breath: 0.6 },
  typing: { mouth: 'M56,90 Q60,88 64,90', eyeOpen: 0.9, pupilDx: 0, bodyY: 0, bodyScale: 1, bodyRotate: 0, cheeks: false, effect: 'spark', breath: 1.7 },
  happy: { mouth: 'M43,82 Q60,108 77,82', eyeOpen: 0.85, pupilDx: 0, bodyY: -2, bodyScale: 1.04, bodyRotate: 0, cheeks: true, effect: 'stars', breath: 1.3 },
  celebrate: { mouth: 'M43,82 Q60,110 77,82', eyeOpen: 0.8, pupilDx: 0, bodyY: -7, bodyScale: 1.06, bodyRotate: 0, cheeks: true, effect: 'hearts', breath: 1.5 },
  error: { mouth: 'M48,95 Q60,84 72,95', eyeOpen: 0.8, pupilDx: 0, bodyY: 1, bodyScale: 0.98, bodyRotate: 0, cheeks: false, effect: 'sweat', breath: 0.5 },
  sleepy: { mouth: 'M54,90 Q60,93 66,90', eyeOpen: 0.35, pupilDx: 0, bodyY: 2, bodyScale: 1, bodyRotate: 2, cheeks: false, effect: 'none', breath: 0.5 },
  sleep: { mouth: 'M54,90 L66,90', eyeOpen: 0.06, pupilDx: 0, bodyY: 3, bodyScale: 0.99, bodyRotate: 3, cheeks: false, effect: 'sleep', breath: 0.4 },
  memory: { mouth: 'M54,90 Q60,88 66,90', eyeOpen: 1, pupilDx: -1.2, bodyY: 0, bodyScale: 1, bodyRotate: 0, cheeks: false, effect: 'book', breath: 0.8 },
};

const INK = '#1b1b2f';
const BOX = { transformBox: 'fill-box' as const, transformOrigin: 'center' };

export function PetCharacter({ emotion = 'idle', progress = 0, skin = 'sprite', customAsset }: { emotion?: PetEmotion; progress?: number; skin?: PetSkin; customAsset?: string | null }) {
  // A user-uploaded skin overrides the built-in SVG entirely.
  if (customAsset) {
    return (
      <motion.div
        style={{ width: 96, height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: EASE }}
      >
        <img src={customAsset} alt="pet" draggable={false}
          style={{ width: 96, height: 110, objectFit: 'contain', pointerEvents: 'none', userSelect: 'none' }} />
      </motion.div>
    );
  }
  const cfg = CFG[emotion] ?? CFG.idle;
  const bodyColor = themeHex('primary');
  const cheekColor = themeAlpha('danger', 0.5);

  // Random blink cadence — keeps idle feel alive.
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 120);
      timer = setTimeout(loop, 2600 + Math.round(Math.random() * 3400));
    };
    timer = setTimeout(loop, 2200);
    return () => clearTimeout(timer);
  }, []);

  // gaze drifts slightly with progress, so the pet "watches" the task fill up
  const gaze = Math.max(-2, Math.min(2, (progress - 50) / 25));

  return (
    <motion.div
      style={{ width: 96, height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 3.6, repeat: Infinity, ease: EASE }}
    >
      <svg width="96" height="110" viewBox="0 0 120 140" style={{ overflow: 'visible' }}>
        {/* ground shadow */}
        <motion.ellipse
          cx={60} cy={128} rx={30} ry={6} fill="#000" opacity={0.18} style={BOX}
          animate={{ scaleX: [1, 0.92, 1], opacity: [0.18, 0.14, 0.18] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: EASE }}
        />

        {/* emotion pose (spring) */}
        <motion.g style={BOX}
          animate={{ y: cfg.bodyY, scale: cfg.bodyScale, rotate: cfg.bodyRotate }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
          {/* breathing layer */}
          <motion.g style={BOX}
            animate={{ scale: [1, 1.035, 1] }}
            transition={{ duration: 3 / Math.max(cfg.breath, 0.1), repeat: Infinity, ease: EASE }}>

            <BodySkin skin={skin} color={bodyColor} />

            {cfg.cheeks && (
              <>
                <ellipse cx={38} cy={80} rx={6} ry={4} fill={cheekColor} />
                <ellipse cx={82} cy={80} rx={6} ry={4} fill={cheekColor} />
              </>
            )}

            <Eye cx={47} blink={blink} open={cfg.eyeOpen} dx={cfg.pupilDx + gaze} />
            <Eye cx={73} blink={blink} open={cfg.eyeOpen} dx={cfg.pupilDx + gaze} />

            <motion.path d={cfg.mouth} fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round"
              animate={{ d: cfg.mouth }} transition={{ type: 'spring', stiffness: 300, damping: 26 }} />
          </motion.g>
        </motion.g>

        {/* head effect layer (does not breathe) */}
        <Effect kind={cfg.effect} />
      </svg>
    </motion.div>
  );
}

/** Swappable body shape — only the silhouette + decorations change; eyes/mouth/effects stay. */
function BodySkin({ skin, color }: { skin: PetSkin; color: string }) {
  if (skin === 'robot') return <RobotBody color={color} />;
  if (skin === 'lobster') return <LobsterBody color={color} />;
  return <SpriteBody color={color} />;
}

function SpriteBody({ color }: { color: string }) {
  return (
    <>
      <motion.line x1={60} y1={20} x2={60} y2={8} stroke={color} strokeWidth={2.5} strokeLinecap="round"
        style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
        animate={{ rotate: [-4, 4, -4] }} transition={{ duration: 2.6, repeat: Infinity, ease: EASE }} />
      <circle cx={60} cy={7} r={4} fill={color} />
      <path d="M60,18 C88,18 100,42 100,74 C100,106 82,126 60,126 C38,126 20,106 20,74 C20,42 32,18 60,18 Z"
        fill={color} stroke={themeAlpha('primary', 1)} strokeWidth={1} />
      <ellipse cx={46} cy={48} rx={16} ry={20} fill="#fff" opacity={0.16} />
    </>
  );
}

function RobotBody({ color }: { color: string }) {
  return (
    <>
      {/* antenna */}
      <motion.line x1={60} y1={24} x2={60} y2={8} stroke={color} strokeWidth={2.5} strokeLinecap="round"
        style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
        animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 2.6, repeat: Infinity, ease: EASE }} />
      <circle cx={60} cy={7} r={4} fill={color} />
      {/* rounded-square chassis */}
      <rect x={24} y={24} width={72} height={100} rx={22} ry={22} fill={color} stroke={themeAlpha('primary', 1)} strokeWidth={1} />
      {/* chest panel (decorative) */}
      <rect x={44} y={40} width={32} height={14} rx={4} fill="#fff" opacity={0.12} />
      <line x1={50} y1={47} x2={70} y2={47} stroke="#fff" strokeWidth={1} opacity={0.3} />
      {/* rivets */}
      <circle cx={34} cy={34} r={2} fill="#fff" opacity={0.3} />
      <circle cx={86} cy={34} r={2} fill="#fff" opacity={0.3} />
      <circle cx={34} cy={114} r={2} fill="#fff" opacity={0.3} />
      <circle cx={86} cy={114} r={2} fill="#fff" opacity={0.3} />
      {/* highlight */}
      <rect x={32} y={58} width={16} height={20} rx={7} fill="#fff" opacity={0.16} />
    </>
  );
}

/** JunQi lobster — nods to OpenClaw ("claw"). Rounded shell, two big claws,
 * wiggling antennae, tail fan. Eyes/mouth/effects are reused from the shared
 * emotion layers, so all expressions still work on this skin. */
function LobsterBody({ color }: { color: string }) {
  const dark = themeAlpha('primary', 1);
  return (
    <>
      {/* antennae */}
      <motion.path d="M50,24 Q42,12 38,6" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round"
        style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
        animate={{ rotate: [-4, 4, -4] }} transition={{ duration: 2.4, repeat: Infinity, ease: EASE }} />
      <motion.path d="M70,24 Q78,12 82,6" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round"
        style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
        animate={{ rotate: [4, -4, 4] }} transition={{ duration: 2.4, repeat: Infinity, ease: EASE }} />
      {/* tail fan */}
      <path d="M44,118 L60,130 L76,118 L70,110 L50,110 Z" fill={color} stroke={dark} strokeWidth={1} />
      {/* shell */}
      <ellipse cx={60} cy={74} rx={30} ry={40} fill={color} stroke={dark} strokeWidth={1} />
      {/* shell segments */}
      <path d="M34,66 Q60,72 86,66" stroke="#fff" strokeWidth={1} fill="none" opacity={0.18} />
      <path d="M34,82 Q60,88 86,82" stroke="#fff" strokeWidth={1} fill="none" opacity={0.18} />
      {/* claws */}
      <ellipse cx={24} cy={88} rx={11} ry={13} fill={color} stroke={dark} strokeWidth={1} />
      <path d="M16,82 L11,78 M16,94 L11,98" stroke={dark} strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={96} cy={88} rx={11} ry={13} fill={color} stroke={dark} strokeWidth={1} />
      <path d="M104,82 L109,78 M104,94 L109,98" stroke={dark} strokeWidth={2} strokeLinecap="round" />
      {/* highlight */}
      <ellipse cx={50} cy={58} rx={10} ry={14} fill="#fff" opacity={0.16} />
    </>
  );
}

function Eye({ cx, blink, open, dx }: { cx: number; blink: boolean; open: number; dx: number }) {
  const sy = blink ? 0.08 : Math.max(open, 0.05);
  return (
    <motion.g style={BOX} animate={{ scaleY: sy }} transition={{ duration: 0.12, ease: EASE }}>
      <ellipse cx={cx} cy={70} rx={9.5} ry={12} fill="#fff" />
      <motion.circle cx={cx} cy={72} r={6} fill={INK} animate={{ cx: cx + dx }} transition={{ duration: 0.6, ease: EASE }} />
      <circle cx={cx - 2} cy={69} r={2} fill="#fff" />
    </motion.g>
  );
}

function Effect({ kind }: { kind: EffectKind }) {
  if (kind === 'none') return null;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {kind === 'sleep' && (
        <>
          {[0, 1, 2].map((i) => (
            <motion.g key={i} initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0], y: [0, -12] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.6, ease: EASE }}>
              <text x={68 + i * 5} y={22 - i * 6} fontSize={13 - i * 2} fontWeight={700} fill={themeHex('primary')}>z</text>
            </motion.g>
          ))}
        </>
      )}
      {kind === 'gear' && (
        <motion.g style={BOX} animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}>
          <g transform="translate(60,12)">
            <path d="M0,-9 L2,-7 L6,-7 L7,-3 L9,0 L7,3 L6,7 L2,7 L0,9 L-2,7 L-6,7 L-7,3 L-9,0 L-7,-3 L-6,-7 L-2,-7 Z" fill={themeAlpha('warning', 0.95)} />
            <circle r={3} fill={themeHex('primary')} />
          </g>
        </motion.g>
      )}
      {kind === 'think' && (
        <>
          <circle cx={78} cy={26} r={2.5} fill={themeAlpha('primary', 0.6)} />
          <motion.circle cx={72} cy={18} r={3.5} fill={themeAlpha('primary', 0.7)} animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity }} />
          <motion.ellipse cx={66} cy={8} rx={7} ry={5} fill="#fff" stroke={themeAlpha('primary', 0.4)} strokeWidth={1} animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.3 }} />
        </>
      )}
      {kind === 'stars' && (
        <>
          {[0, 1, 2, 3].map((i) => {
            const ang = (i / 4) * Math.PI * 2;
            const x = 60 + Math.cos(ang) * 24;
            const y = 72 + Math.sin(ang) * 32;
            return (
              <motion.g key={i} style={BOX} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], scale: [0, 1, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2, ease: EASE }}>
                <text x={x} y={y} fontSize={13} fill={themeHex('warning')}>✦</text>
              </motion.g>
            );
          })}
        </>
      )}
      {kind === 'hearts' && (
        <>
          {[-1, 0, 1].map((i) => (
            <motion.g key={i} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], y: [8, -16], scale: [0, 1, 0.5] }} transition={{ duration: 1.8, repeat: Infinity, delay: (i + 1) * 0.25, ease: EASE }}>
              <text x={54 + i * 16} y={16} fontSize={15} fill={themeHex('danger')}>♥</text>
            </motion.g>
          ))}
        </>
      )}
      {kind === 'sweat' && (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], y: [-4, 10] }} transition={{ duration: 1.6, repeat: Infinity, ease: EASE }}>
          <path d="M88,14 q-4,6 0,10 q4,-4 0,-10 Z" fill="#7fd4ee" />
        </motion.g>
      )}
      {kind === 'book' && (
        <motion.g style={BOX} transform="translate(58,6)" animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 2, repeat: Infinity, ease: EASE }}>
          <rect x={-8} y={-6} width={16} height={12} rx={1.5} fill={themeAlpha('accent', 0.95)} />
          <line x1={0} y1={-6} x2={0} y2={6} stroke="#fff" strokeWidth={1.2} />
          <line x1={0} y1={0} x2={8} y2={0} stroke="#fff" strokeWidth={0.8} opacity={0.6} />
        </motion.g>
      )}
      {kind === 'spark' && (
        <>
          {[-1, 1].map((i) => (
            <motion.g key={i} style={BOX} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], scale: [0, 1.2, 0] }} transition={{ duration: 0.5, repeat: Infinity, delay: (i + 1) * 0.12, ease: EASE }}>
              <text x={56 + i * 16} y={24} fontSize={11} fill={themeHex('warning')}>✧</text>
            </motion.g>
          ))}
        </>
      )}
    </g>
  );
}
