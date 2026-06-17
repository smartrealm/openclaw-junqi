/**
 * PetCharacter — orchestrator. Resolves an emotion to its config (pure data in
 * emotion-config), then composes: a body skin (SKIN_REGISTRY) + shared eyes/
 * mouth + a head effect (EFFECT_REGISTRY). Uploaded skins reuse the same
 * emotion pose/breath + head effect, so a custom pet still has expressions.
 * This file stays small — skins and effects live in their own registries
 * (open–closed: add a skin/effect = one registry line, no edit here).
 */
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { PetEmotion } from './pet-states';
import { EMOTION_CFG } from './emotion-config';
import { SKIN_REGISTRY, type PetSkin } from './skins';
import { EFFECT_REGISTRY } from './effects';
import { themeHex } from '@/utils/theme-colors';

export type { PetSkin };

const EASE = [0.22, 1, 0.36, 1] as const;
const INK = '#1b1b2f';
const BOX = { transformBox: 'fill-box' as const, transformOrigin: 'center' };

export function PetCharacter({ emotion = 'idle', progress = 0, skin = 'sprite', customAsset }: {
  emotion?: PetEmotion;
  progress?: number;
  skin?: PetSkin;
  customAsset?: string | null;
}) {
  const cfg = EMOTION_CFG[emotion] ?? EMOTION_CFG.idle;
  const bodyColor = themeHex('primary');
  const Effect = EFFECT_REGISTRY[cfg.effect];

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

  // Uploaded skin: the image is the "body", wrapped in the same emotion pose +
  // breathing, with the head effect overlaid — so a custom pet still reacts.
  if (customAsset) {
    return (
      <motion.div
        style={{ width: 96, height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', position: 'relative' }}
        animate={{ y: [0, -4, 0] }} transition={{ duration: 3.6, repeat: Infinity, ease: EASE }}>
        <motion.div style={BOX}
          animate={{ y: cfg.bodyY, scale: cfg.bodyScale, rotate: cfg.bodyRotate }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
          <motion.div style={BOX}
            animate={{ scale: [1, 1.035, 1] }}
            transition={{ duration: 3 / Math.max(cfg.breath, 0.1), repeat: Infinity, ease: EASE }}>
            <img src={customAsset} alt="pet" draggable={false}
              style={{ width: 96, height: 110, objectFit: 'contain', pointerEvents: 'none', userSelect: 'none' }} />
          </motion.div>
        </motion.div>
        {Effect && (
          <svg width="96" height="110" viewBox="0 0 120 140" style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
            <Effect />
          </svg>
        )}
      </motion.div>
    );
  }

  const Skin = SKIN_REGISTRY[skin] ?? SKIN_REGISTRY.sprite;

  return (
    <motion.div
      style={{ width: 96, height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      animate={{ y: [0, -4, 0] }} transition={{ duration: 3.6, repeat: Infinity, ease: EASE }}>
      <svg width="96" height="110" viewBox="0 0 120 140" style={{ overflow: 'visible' }}>
        {/* ground shadow */}
        <motion.ellipse cx={60} cy={128} rx={30} ry={6} fill="#000" opacity={0.18} style={BOX}
          animate={{ scaleX: [1, 0.92, 1], opacity: [0.18, 0.14, 0.18] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: EASE }} />

        {/* pose (spring) */}
        <motion.g style={BOX}
          animate={{ y: cfg.bodyY, scale: cfg.bodyScale, rotate: cfg.bodyRotate }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
          {/* breathing */}
          <motion.g style={BOX}
            animate={{ scale: [1, 1.035, 1] }}
            transition={{ duration: 3 / Math.max(cfg.breath, 0.1), repeat: Infinity, ease: EASE }}>
            <Skin color={bodyColor} />
            {cfg.cheeks && (
              <>
                <ellipse cx={38} cy={80} rx={6} ry={4} fill="#ff8fab" opacity={0.5} />
                <ellipse cx={82} cy={80} rx={6} ry={4} fill="#ff8fab" opacity={0.5} />
              </>
            )}
            <Eye cx={47} blink={blink} open={cfg.eyeOpen} dx={cfg.pupilDx + gaze} />
            <Eye cx={73} blink={blink} open={cfg.eyeOpen} dx={cfg.pupilDx + gaze} />
            <motion.path d={cfg.mouth} fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round"
              animate={{ d: cfg.mouth }} transition={{ type: 'spring', stiffness: 300, damping: 26 }} />
          </motion.g>
        </motion.g>

        {/* head effect */}
        {Effect && <Effect />}
      </svg>
    </motion.div>
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
