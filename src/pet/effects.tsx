/**
 * Head effects — small animated decorations rendered above the character
 * (zZ, gear, stars, hearts, …). Each is an independent component returning SVG
 * nodes (rendered inside the character <svg>). Adding an effect = add a
 * component + one line in EFFECT_REGISTRY (open–closed).
 */
import { motion } from 'framer-motion';
import type { ReactElement } from 'react';
import { themeAlpha, themeHex } from '@/utils/theme-colors';
import type { EffectKind } from './emotion-config';

const EASE = [0.22, 1, 0.36, 1] as const;
const BOX = { transformBox: 'fill-box' as const, transformOrigin: 'center' };
type EffectFn = () => ReactElement;

function SleepZzz(): ReactElement {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <motion.g key={i} initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0], y: [0, -12] }}
          transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.6, ease: EASE }}>
          <text x={68 + i * 5} y={22 - i * 6} fontSize={13 - i * 2} fontWeight={700} fill={themeHex('primary')}>z</text>
        </motion.g>
      ))}
    </>
  );
}

function Gear(): ReactElement {
  return (
    <motion.g style={BOX} animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}>
      <g transform="translate(60,12)">
        <path d="M0,-9 L2,-7 L6,-7 L7,-3 L9,0 L7,3 L6,7 L2,7 L0,9 L-2,7 L-6,7 L-7,3 L-9,0 L-7,-3 L-6,-7 L-2,-7 Z" fill={themeAlpha('warning', 0.95)} />
        <circle r={3} fill={themeHex('primary')} />
      </g>
    </motion.g>
  );
}

function ThinkDots(): ReactElement {
  return (
    <>
      <circle cx={78} cy={26} r={2.5} fill={themeAlpha('primary', 0.6)} />
      <motion.circle cx={72} cy={18} r={3.5} fill={themeAlpha('primary', 0.7)} animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity }} />
      <motion.ellipse cx={66} cy={8} rx={7} ry={5} fill={themeAlpha('primary', 0.18)} stroke={themeAlpha('primary', 0.42)} strokeWidth={1} animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.3 }} />
    </>
  );
}

function Stars(): ReactElement {
  return (
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
  );
}

function Hearts(): ReactElement {
  return (
    <>
      {[-1, 0, 1].map((i) => (
        <motion.g key={i} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], y: [8, -16], scale: [0, 1, 0.5] }} transition={{ duration: 1.8, repeat: Infinity, delay: (i + 1) * 0.25, ease: EASE }}>
          <text x={54 + i * 16} y={16} fontSize={15} fill={themeHex('danger')}>♥</text>
        </motion.g>
      ))}
    </>
  );
}

function Sweat(): ReactElement {
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], y: [-4, 10] }} transition={{ duration: 1.6, repeat: Infinity, ease: EASE }}>
      <path d="M88,14 q-4,6 0,10 q4,-4 0,-10 Z" fill="#7fd4ee" />
    </motion.g>
  );
}

function Book(): ReactElement {
  return (
    <motion.g style={BOX} transform="translate(58,6)" animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 2, repeat: Infinity, ease: EASE }}>
      <rect x={-8} y={-6} width={16} height={12} rx={1.5} fill={themeAlpha('accent', 0.95)} />
      <line x1={0} y1={-6} x2={0} y2={6} stroke="rgb(var(--aegis-text-secondary))" strokeWidth={1.2} />
      <line x1={0} y1={0} x2={8} y2={0} stroke="rgb(var(--aegis-text-secondary))" strokeWidth={0.8} opacity={0.6} />
    </motion.g>
  );
}

function Spark(): ReactElement {
  return (
    <>
      {[-1, 1].map((i) => (
        <motion.g key={i} style={BOX} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], scale: [0, 1.2, 0] }} transition={{ duration: 0.5, repeat: Infinity, delay: (i + 1) * 0.12, ease: EASE }}>
          <text x={56 + i * 16} y={24} fontSize={11} fill={themeHex('warning')}>✧</text>
        </motion.g>
      ))}
    </>
  );
}

/** Registry: effect key → component. 'none' is intentionally absent (caller
 * treats a missing entry as "no effect"). */
export const EFFECT_REGISTRY: Partial<Record<EffectKind, EffectFn>> = {
  sleep: SleepZzz,
  gear: Gear,
  think: ThinkDots,
  stars: Stars,
  hearts: Hearts,
  sweat: Sweat,
  book: Book,
  spark: Spark,
};
