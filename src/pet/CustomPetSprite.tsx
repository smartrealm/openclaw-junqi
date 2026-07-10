import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type { CustomPetPackage } from '@/stores/petStore';
import type { PetEmotion } from './pet-states';
import {
  animationTrackForPet,
  frameAtElapsed,
  lookCellForVector,
  spriteBackgroundGeometry,
} from './customPetAnimation';

export function CustomPetSprite({ pet, emotion, dragging, hovered, walkDir, dragDx, dragDy }: {
  pet: CustomPetPackage;
  emotion: PetEmotion;
  dragging: boolean;
  hovered: boolean;
  walkDir: number;
  dragDx: number;
  dragDy: number;
}) {
  const track = useMemo(
    () => animationTrackForPet({ emotion, dragging, hovered, walkDir }),
    [dragging, emotion, hovered, walkDir],
  );
  const look = !dragging && (emotion === 'drag' || emotion === 'overdrag')
    ? lookCellForVector(dragDx, dragDy)
    : null;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (look) return;
    const startedAt = performance.now();
    let timer = 0;
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      setFrame(frameAtElapsed(track, elapsed));
      timer = window.setTimeout(tick, 48);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [look?.column, look?.row, track]);

  const row = look?.row ?? track.row;
  const column = look?.column ?? frame;
  const geometry = spriteBackgroundGeometry(row, column);

  return (
    <motion.div
      aria-label={pet.displayName}
      animate={{
        y: dragging ? -3 : 0,
        scale: dragging ? 1.05 : 1,
        rotate: dragging ? Math.max(-5, Math.min(5, walkDir * 3)) : 0,
      }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      style={{
        width: geometry.width,
        height: geometry.height,
        backgroundImage: `url(${pet.spritesheetDataUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: geometry.backgroundSize,
        backgroundPosition: geometry.backgroundPosition,
        imageRendering: 'auto',
        pointerEvents: 'none',
        willChange: 'background-position, transform',
      }}
    />
  );
}
