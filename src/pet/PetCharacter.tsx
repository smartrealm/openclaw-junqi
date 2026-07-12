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
import { normalizePetThemeName, resolvePetCharacterPalette, type PetThemeName } from './petTheme';
import type { CustomPetPackage } from '@/stores/petStore';
import { CustomPetSprite } from './CustomPetSprite';

export type { PetSkin };

const EASE = [0.22, 1, 0.36, 1] as const;
const BOX = { transformBox: 'fill-box' as const, transformOrigin: 'center' };

function readPetThemeName(): PetThemeName {
  if (typeof document === 'undefined') return 'aegis-dark';
  const theme = document.documentElement.getAttribute('data-theme');
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  return normalizePetThemeName(theme, systemDark);
}

function usePetCharacterTheme(): PetThemeName {
  const [themeName, setThemeName] = useState(readPetThemeName);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const refresh = () => setThemeName(readPetThemeName());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', refresh);
    refresh();
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', refresh);
    };
  }, []);
  return themeName;
}

export function PetCharacter({ emotion = 'idle', progress = 0, skin = 'robot', customAsset, customPet, dragging = false, hovered = false, walkDir = 0, celebrating = false, dragDx = 0, dragDy = 0, dragRotation = 0 }: {
  emotion?: PetEmotion;
  progress?: number;
  skin?: PetSkin;
  customAsset?: string | null;
  customPet?: CustomPetPackage | null;
  dragging?: boolean;
  /** Cursor is over the pet — skins play a "notice you" reaction and the
   *  eyes widen. */
  hovered?: boolean;
  /** Horizontal hand-drag direction (-1 left / +1 right / 0). Fed to the
   *  skin so its legs stride the way the pet is being carried. */
  walkDir?: number;
  /** True when the pet just completed a pomodoro or task — triggers a bounce + glow. */
  celebrating?: boolean;
  /** Magnetic pull offset (px) during an OS drag — PetWindow feeds the
   *  cursor position relative to the pet so it leans toward the payload. */
  dragDx?: number;
  dragDy?: number;
  /** Tilt (deg) applied on top of the pose rotation — direction the cursor
   *  is pulling the pet. Capped at ±10° to keep the character grounded. */
  dragRotation?: number;
}) {
  const cfg = EMOTION_CFG[emotion] ?? EMOTION_CFG.idle;
  const themeName = usePetCharacterTheme();
  const palette = resolvePetCharacterPalette(themeName, skin);
  const bodyColor = palette.body;
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
  // Drag gaze — when the cursor is pulling the pet, the eyes follow it so
  // the lock-on feels intentional rather than accidental. Capped so the
  // pupil doesn't shoot past the iris edge.
  const dragGaze = Math.max(-2.5, Math.min(2.5, dragDx / 8));
  // Magnitude used for subtle scale-up while the pet is being pulled toward
  // something. Keeps the "leaning in" feel without ballooning the character.
  const pullMag = Math.min(1, Math.hypot(dragDx, dragDy) / 28);
  // Cap rotation so the pet never tilts past 10° either way.
  const cappedRot = Math.max(-10, Math.min(10, dragRotation));

  if (customPet) {
    return (
      <CustomPetSprite
        pet={customPet}
        emotion={emotion}
        dragging={dragging}
        hovered={hovered}
        walkDir={walkDir}
        dragDx={dragDx}
        dragDy={dragDy}
      />
    );
  }

  // Uploaded skin: the image is the "body", wrapped in the same emotion pose +
  // breathing, with the head effect overlaid — so a custom pet still reacts.
  if (customAsset) {
    return (
      <motion.div
        style={{ width: 96, height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', position: 'relative' }}
        animate={{ y: [0, -4, 0] }} transition={{ duration: 3.6, repeat: Infinity, ease: EASE }}>
        <motion.div style={BOX}
          animate={{
            // Stack the magnetic pull on top of the emotion pose so the pet
            // can both "lean back" (cfg.bodyY) AND "tilt toward the cursor".
            // Hand-dragging adds a lean toward the walk direction; hover adds
            // a small perk so even an uploaded pet reacts.
            x: dragDx + (dragging ? walkDir * 2 : 0),
            y: cfg.bodyY + dragDy * 0.6 + (hovered ? -3 : 0),
            scale: cfg.bodyScale + pullMag * 0.04 + (hovered ? 0.03 : 0),
            rotate: cfg.bodyRotate + cappedRot + (dragging ? walkDir * 5 : 0),
          }}
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

  const Skin = SKIN_REGISTRY[skin] ?? SKIN_REGISTRY.robot;

  return (
    <motion.div
      style={{ width: 96, height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', position: 'relative' }}
      // Normal breathing + celebrate bounce (scale spring that pops up then settles)
      animate={celebrating
        ? { y: [-2, -18, -8, -12, -6, -8], scale: [1, 1.18, 1.08, 1.12, 1.04, 1.06, 1] }
        : { y: [0, -4, 0] }
      }
      transition={{
        duration: celebrating ? 0.9 : 3.6,
        repeat: celebrating ? 1 : Infinity,
        ease: EASE,
      }}
    >
      {/* Completion glow ring — a soft colour ring that expands and fades out */}
      {celebrating && (
        <motion.div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'transparent',
            border: `3px solid ${bodyColor}`,
            transform: 'translateY(10px)',
          }}
          initial={{ scale: 0.4, opacity: 0.72 }}
          animate={{ scale: [0.4, 1.6, 2.2], opacity: [0.72, 0.32, 0] }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      )}
      {/* Swallow aura — 4 expanding rings + 6 sparkle dots to convey
          "just ate something". Rendered only while the swallow emotion is
          active (~1.8s) so it's a snappy visual cue, not a decoration. */}
      {emotion === 'swallow' && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <svg width="96" height="110" viewBox="0 0 120 140" style={{ overflow: 'visible' }}>
            <motion.circle cx={60} cy={70} r={20}
              fill="none" stroke={bodyColor} strokeWidth={2}
              initial={{ scale: 0.4, opacity: 0.9 }}
              animate={{ scale: [0.4, 1.6, 2.4], opacity: [0.9, 0.4, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut', delay: 0 }}
            />
            <motion.circle cx={60} cy={70} r={20}
              fill="none" stroke={bodyColor} strokeWidth={1.5}
              initial={{ scale: 0.4, opacity: 0.8 }}
              animate={{ scale: [0.4, 1.6, 2.4], opacity: [0.58, 0.22, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut', delay: 0.35 }}
            />
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const angle = (i / 6) * Math.PI * 2;
              const x = 60 + Math.cos(angle) * 32;
              const y = 70 + Math.sin(angle) * 32;
              return (
                <motion.circle key={i} cx={x} cy={y} r={2.5}
                  fill={palette.sparkle}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: [0, 1, 0], opacity: [0, 1, 0] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeOut' }}
                />
              );
            })}
          </svg>
        </div>
      )}
      <svg width="96" height="110" viewBox="0 0 120 140" style={{ overflow: 'visible' }}>
        {/* ground shadow */}
        <motion.ellipse cx={60} cy={128} rx={30} ry={6} fill="#000" opacity={palette.groundShadowOpacity} style={BOX}
          animate={{ scaleX: [1, 0.92, 1], opacity: [palette.groundShadowOpacity, palette.groundShadowOpacity * 0.75, palette.groundShadowOpacity] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: EASE }} />

        {/* pose (spring) */}
        <motion.g style={BOX}
          animate={{
            // Stack the magnetic pull on top of the emotion pose so the pet
            // can both lean forward (cfg.bodyY) AND tilt toward the cursor.
            x: dragDx + (dragging ? walkDir * 2 : 0),
            y: cfg.bodyY + dragDy * 0.6 + (hovered ? -3 : 0),
            scale: cfg.bodyScale + pullMag * 0.04 + (hovered ? 0.03 : 0),
            rotate: cfg.bodyRotate + cappedRot + (dragging ? walkDir * 5 : 0),
          }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
          {/* breathing */}
          <motion.g style={BOX}
            animate={{ scale: [1, 1.035, 1] }}
            transition={{ duration: 3 / Math.max(cfg.breath, 0.1), repeat: Infinity, ease: EASE }}>
            <Skin color={bodyColor} highlight={palette.highlight} hovered={hovered} walking={dragging} walkDir={walkDir} />
            {cfg.cheeks && (
              <>
                <ellipse cx={38} cy={80} rx={6} ry={4} fill="#ff8fab" opacity={0.5} />
                <ellipse cx={82} cy={80} rx={6} ry={4} fill="#ff8fab" opacity={0.5} />
              </>
            )}
            <Eye cx={47} blink={blink} open={dragging || hovered ? 1 : cfg.eyeOpen} dx={cfg.pupilDx + gaze + dragGaze} ink={palette.ink} eye={palette.eye} highlight={palette.eyeHighlight} />
            <Eye cx={73} blink={blink} open={dragging || hovered ? 1 : cfg.eyeOpen} dx={cfg.pupilDx + gaze + dragGaze} ink={palette.ink} eye={palette.eye} highlight={palette.eyeHighlight} />
            <motion.path d={cfg.mouth} fill="none" stroke={palette.ink} strokeWidth={2.4} strokeLinecap="round"
              animate={{ d: cfg.mouth }} transition={{ type: 'spring', stiffness: 300, damping: 26 }} />
          </motion.g>
        </motion.g>

        {/* head effect */}
        {Effect && <Effect />}
      </svg>
    </motion.div>
  );
}

function Eye({ cx, blink, open, dx, ink, eye, highlight }: { cx: number; blink: boolean; open: number; dx: number; ink: string; eye: string; highlight: string }) {
  const sy = blink ? 0.08 : Math.max(open, 0.05);
  return (
    <motion.g style={BOX} animate={{ scaleY: sy }} transition={{ duration: 0.12, ease: EASE }}>
      <ellipse cx={cx} cy={70} rx={9.5} ry={12} fill={eye} />
      <motion.circle cx={cx} cy={72} r={6} fill={ink} animate={{ cx: cx + dx }} transition={{ duration: 0.6, ease: EASE }} />
      <circle cx={cx - 2} cy={69} r={2} fill={highlight} opacity={0.86} />
    </motion.g>
  );
}
